import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from matching_jobs import EmbeddingJobs
from test_firebase_store import DatabaseDouble

class Store:
    contract = {'model':'embeddinggemma-test'}
    def __init__(self): self.calls, self.fresh, self.fail = [], True, False
    def _markers(self, p): return {'updated_at':p.get('source_updated_at')}
    def _fresh(self, *args): return self.fresh
    def candidate_source_hash(self, uid): return 'expected'
    def event_source_hash(self, uid): return 'expected'
    def upsert_candidate(self, p, *, expected_source_hash):
        if self.fail: raise RuntimeError('offline')
        self.calls.append((p,expected_source_hash))
    upsert_event = upsert_candidate

class JobTests(unittest.TestCase):
    def setUp(self):
        self.db,self.store,self.now = DatabaseDouble(),Store(),1000
        self.queue = EmbeddingJobs(self.db,self.store,'test/main',clock=lambda:self.now)
        self.payload = {'candidate_id':'u','skills':['Python'],'source_updated_at':'v1','cv_text':'SECRET','email':'secret@example.org','source_storage_path':'private/u.pdf'}
    def row(self, uid): return self.db.documents['test/main/embeddingJobs/'+uid]
    def test_deduplicated_sanitized_durable_payload(self):
        uid = self.queue.enqueue('candidate',self.payload)
        self.assertEqual(uid,self.queue.enqueue('candidate',self.payload))
        self.assertNotIn('cv_text',self.row(uid)['payload'])
        self.assertNotIn('email',self.row(uid)['payload'])
        self.payload['source_updated_at']='v2'
        self.assertNotEqual(uid,self.queue.enqueue('candidate',self.payload))
    def test_run_and_redelivery_are_idempotent(self):
        uid=self.queue.enqueue('candidate',self.payload)
        self.assertEqual(self.queue.run(uid)['status'],'completed')
        self.assertEqual(self.queue.run(uid)['status'],'completed')
        self.assertEqual(len(self.store.calls),1)
        self.assertEqual(self.store.calls[0][1],'expected')
    def test_stale_job_never_upserts(self):
        uid=self.queue.enqueue('candidate',self.payload)
        self.store.fresh=False
        self.assertEqual(self.queue.run(uid)['status'],'stale')
        self.assertEqual(self.store.calls,[])
    def test_lease_expiry_and_retry(self):
        uid=self.queue.enqueue('candidate',self.payload)
        self.row(uid).update(status='running',lease_until=1100)
        self.assertEqual(self.queue.run(uid)['status'],'deferred')
        self.now=1101
        self.store.fail=True
        self.assertEqual(self.queue.run(uid)['status'],'pending')
        self.assertEqual(self.queue.run(uid)['status'],'deferred')
        self.now+=3
        self.store.fail=False
        self.assertEqual(self.queue.run(uid)['status'],'completed')
    def test_dispatch_failure_does_not_lose_durable_job(self):
        self.queue.dispatcher=lambda uid: (_ for _ in ()).throw(RuntimeError('queue unavailable'))
        uid=self.queue.enqueue('candidate',self.payload)
        self.assertEqual(self.row(uid)['status'],'pending')
    def test_lost_lease_cannot_finish_over_new_claim(self):
        uid=self.queue.enqueue('candidate',self.payload)
        original=self.store.upsert_candidate
        def replace(p, **kw):
            original(p,**kw)
            self.row(uid)['lease']='other-owner'
        self.store.upsert_candidate=replace
        self.assertEqual(self.queue.run(uid)['status'],'lease_lost')
        self.assertEqual(self.row(uid)['status'],'running')
    def test_operator_recovery_is_explicit_version_checked(self):
        from contracts import RevisionConflict
        uid=self.queue.enqueue('candidate',self.payload)
        self.row(uid).update(status='failed',attempts=5)
        with self.assertRaises(RevisionConflict): self.queue.retry_failed(uid,expected_attempts=6)
        self.queue.retry_failed(uid,expected_attempts=5)
        self.assertEqual(self.row(uid)['status'],'pending')
        self.assertEqual(self.row(uid)['operator_retries'],1)
        self.assertEqual(self.queue.run(uid)['status'],'completed')

if __name__=='__main__': unittest.main()
