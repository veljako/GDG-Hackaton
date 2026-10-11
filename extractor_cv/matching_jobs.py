"""Durable versioned embedding jobs; private source text never enters the queue."""
import base64
import hashlib
import json
import os
import time
import uuid
from google.cloud import firestore
from contracts import RevisionConflict, validate_id

class EmbeddingJobs:
    def __init__(self, db, store, workspace, clock=time.time, dispatcher=None):
        self.db, self.store, self.workspace, self.clock = db, store, workspace, clock
        self.collection = db.collection(workspace + '/embeddingJobs')
        self.dispatcher = dispatcher

    def enqueue(self, kind, payload):
        if kind not in ('candidate', 'event') or not isinstance(payload, dict):
            raise ValueError('Invalid embedding job.')
        identity = validate_id(payload.get('candidate_id' if kind == 'candidate' else 'event_id'))
        from vector_store import _MATCHING_FIELDS, _EVENT_FIELDS
        allowed = set(_MATCHING_FIELDS if kind == 'candidate' else _EVENT_FIELDS + ('event_id',))
        clean = {k: v for k, v in payload.items() if k in allowed | {'source_updated_at', 'source_storage_path'}}
        contract = getattr(self.store, 'contract', {})
        revision = hashlib.sha256(json.dumps({'kind':kind,'payload':clean,'contract':contract}, sort_keys=True).encode()).hexdigest()
        job_id = hashlib.sha256((kind + ':' + identity + ':' + revision).encode()).hexdigest()
        ref = self.collection.document(job_id)
        now = self.clock()
        @firestore.transactional
        def add(tx):
            snap = ref.get(transaction=tx)
            if snap.exists:
                return False
            tx.set(ref, {'kind':kind,'identity':identity,'payload':clean,'revision':revision,'contract':dict(contract),'status':'pending',
                'attempts':0,'available_at':now,'created_at':now,'lease_until':0})
            return True
        created = add(self.db.transaction())
        if self.dispatcher and created:
            # Durable row survives a failed Cloud Tasks dispatch; poll runner recovers it.
            try:
                self.dispatcher(job_id)
            except Exception:
                pass
        return job_id

    def run(self, job_id):
        validate_id(job_id)
        ref, now, lease = self.collection.document(job_id), self.clock(), uuid.uuid4().hex
        @firestore.transactional
        def claim(tx):
            snap = ref.get(transaction=tx)
            row = snap.to_dict() if snap.exists else {}
            if not row:
                return {'_skip':'missing'}
            if row.get('status') in ('completed','stale','failed'):
                return {'_skip':row['status']}
            if row.get('available_at',0) > now or row.get('lease_until',0) > now:
                return {'_skip':'deferred','retry_after':max(1,int(max(row.get('available_at',0),row.get('lease_until',0))-now)+1)}
            tx.update(ref, {'status':'running','lease':lease,'lease_until':now+300,'attempts':row.get('attempts',0)+1})
            return row
        row = claim(self.db.transaction())
        if '_skip' in row:
            return {'status':row['_skip'], **({'retry_after':row['retry_after']} if 'retry_after' in row else {})}
        status, error = 'completed', None
        try:
            if row.get('contract') != getattr(self.store, 'contract', {}):
                raise RevisionConflict('Embedding recipe or model contract changed.')
            identity, payload, kind = row['identity'], row['payload'], row['kind']
            markers = self.store._markers(payload)
            if not self.store._fresh(kind, identity, markers):
                raise RevisionConflict('Canonical source changed.')
            if kind == 'candidate':
                token = self.store.candidate_source_hash(identity)
                self.store.upsert_candidate(payload, expected_source_hash=token)
            else:
                token = self.store.event_source_hash(identity)
                self.store.upsert_event(payload, expected_source_hash=token)
        except RevisionConflict:
            status = 'stale'
        except Exception:
            status, error = ('failed' if row.get('attempts',0)+1 >= 5 else 'pending'), 'Embedding unavailable; retry same model.'
        @firestore.transactional
        def finish(tx):
            snap = ref.get(transaction=tx)
            saved = snap.to_dict() if snap.exists else {}
            if saved.get('lease') != lease:
                return False
            tx.update(ref, {'status':status,'lease_until':0,'available_at':self.clock()+min(300,2**(row.get('attempts',0)+1)),
                'error':error,'finished_at':self.clock()})
            return True
        accepted = finish(self.db.transaction())
        result = {'status':status if accepted else 'lease_lost'}
        if status == 'pending' or not accepted:
            result['retry_after'] = min(300,2**(row.get('attempts',0)+1)) if accepted else 5
        return result

    def retry_failed(self, job_id, *, expected_attempts):
        """Operator-only deliberate recovery; never reset the automatic retry limit."""
        validate_id(job_id)
        if isinstance(expected_attempts,bool) or not isinstance(expected_attempts,int) or expected_attempts < 5:
            raise ValueError('Inspect the terminal job attempt count before retrying.')
        ref = self.collection.document(job_id)
        @firestore.transactional
        def recover(tx):
            snap = ref.get(transaction=tx)
            row = snap.to_dict() if snap.exists else {}
            if row.get('status') != 'failed' or row.get('attempts') != expected_attempts:
                raise RevisionConflict('Terminal job changed; inspect it again.')
            tx.update(ref, {'status':'pending','attempts':0,'lease_until':0,'available_at':self.clock(),
                'error':None,'operator_retries':row.get('operator_retries',0)+1})
        recover(self.db.transaction())
        if self.dispatcher:
            self.dispatcher(job_id)

    def run_pending(self, limit=20):
        # Filter locally for the bounded pilot; production can add an available_at index.
        ran = []
        for snap in self.collection.stream():
            row = snap.to_dict()
            if row.get('status') in ('pending','running') and row.get('available_at',0) <= self.clock() and row.get('lease_until',0) <= self.clock():
                ran.append(self.run(snap.id))
                if len(ran) >= limit:
                    break
        return ran

def cloud_tasks_dispatcher(queue_path, worker_url, worker_token):
    """Google ADC OAuth authorizes queue creation; private worker bearer authorizes execution."""
    if not queue_path.startswith('projects/') or '/locations/' not in queue_path or '/queues/' not in queue_path:
        raise ValueError('Invalid Cloud Tasks queue path.')
    if not worker_url.startswith('https://'):
        raise ValueError('Cloud Tasks requires an HTTPS worker URL.')
    def dispatch(job_id):
        import google.auth
        from google.auth.transport.requests import AuthorizedSession
        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        request = {'httpMethod':'POST','url':worker_url.rstrip('/')+'/v1/jobs/run',
            'headers':{'Content-Type':'application/json','Authorization':'Bearer '+worker_token},
            'body':base64.b64encode(json.dumps({'job_id':job_id}).encode()).decode()}
        with AuthorizedSession(credentials) as session:
            response = session.post('https://cloudtasks.googleapis.com/v2/'+queue_path+'/tasks',
                json={'task':{'name':queue_path+'/tasks/'+job_id+'-'+uuid.uuid4().hex,'httpRequest':request}}, timeout=20)
            if response.status_code not in (200,409):
                raise RuntimeError('Cloud Tasks dispatch unavailable.')
    return dispatch

if __name__ == '__main__':
    import argparse
    from firebase_store import get_db, WORKSPACE
    parser = argparse.ArgumentParser(description='Deliberately retry one inspected terminal failed embedding job.')
    parser.add_argument('--retry-failed',required=True,metavar='JOB_ID')
    parser.add_argument('--expected-attempts',required=True,type=int)
    args = parser.parse_args()
    token = os.environ.get('GEMMA_WORKER_TOKEN','')
    dispatch = cloud_tasks_dispatcher(os.environ['GEMMA_TASKS_QUEUE'],os.environ['GEMMA_WORKER_PUBLIC_URL'],token) if os.environ.get('GEMMA_TASKS_QUEUE') else None
    queue = EmbeddingJobs(get_db(),None,os.environ.get('FIREBASE_WORKSPACE',WORKSPACE),dispatcher=dispatch)
    queue.retry_failed(args.retry_failed,expected_attempts=args.expected_attempts)
    print('Inspected terminal job requeued; canonical source guards remain active.')
