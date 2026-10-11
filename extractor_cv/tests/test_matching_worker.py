"""Exercise real service, transactions and HTTP handler with explicit offline dependencies."""
import base64
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from matching_worker import MatchingService, handler_for, event_dict, grounded_filters, BudgetedGemma
from contracts import RevisionConflict
from test_firebase_store import DatabaseDouble

class Embeddings:
    model_id = 'google/embeddinggemma-test-only'
    dimensions = 2
    def embed_query(self, text):
        self.query = text
        return [1., 0.]

class Store:
    contract = {'recipe': 'matching-narrative-v3'}
    candidates = 'candidates'
    def __init__(self):
        self.events, self.people, self.row = {}, {}, {}
        self.deleted = []
    def event_source_hash(self, uid): return None
    def candidate_source_hash(self, uid): return None
    def upsert_event(self, event, *, expected_source_hash): self.events[event['event_id']] = event
    def upsert_candidate(self, cv, *, expected_source_hash): self.people[cv['candidate_id']] = cv
    def query_events(self, vector, k): return [('rogue', .99)] + [(uid, .8) for uid in self.events]
    def query_candidates(self, vector, k): return [('rogue', .99)] + [(uid, .7) for uid in self.people]
    def _read(self, collection, uid): return self.row
    def delete_candidate(self, uid, *, expected_source_hash): self.deleted.append((uid, expected_source_hash))

class WorkerTests(unittest.TestCase):
    def test_recommendations_reject_weak_and_invalid_scores_without_filling_results(self):
        self.context['events'] = [self.event(uid) for uid in ['strong', 'boundary', 'weak', 'bad', 'too-high']]
        self.store.query_events = lambda vector, k: [('weak', .3036), ('bad', float('nan')), ('too-high', 1.01), ('strong', .628), ('boundary', .45)]
        result = self.call('recommend_events', {'limit': 5})
        self.assertEqual([r['eventId'] for r in result['results']], ['strong', 'boundary'])
        self.assertEqual(result['outcome'], 'matched')
        self.store.query_events = lambda vector, k: [('weak', .3036)]
        result = self.call('recommend_events')
        self.assertEqual(result['results'], [])
        self.assertEqual(result['outcome'], 'no_suitable_event')

    def test_relevance_floor_does_not_hide_browse_results(self):
        self.context['events'] = [self.event('weak')]
        self.store.query_events = lambda vector, k: [('weak', .26)]
        self.assertEqual([r['eventId'] for r in self.call('search_events')['results']], ['weak'])
    def setUp(self):
        self.p = {'id': 'actor', 'updated_at': 'v1', 'title': 'Engineer', 'skills': ['Python'], 'bio': 'Builds systems', 'cv_document': {'storage_path': 'private-cvs/actor/v1.pdf'}}
        self.context = {'people': [self.p], 'events': [], 'teams': [], 'applications': []}
        self.db = DatabaseDouble({'gdevPilots/main/users/actor': self.p})
        self.store, self.embeddings = Store(), Embeddings()
        self.service = MatchingService(self.db, self.store, self.embeddings, generator=lambda q: {'skills': ['Python']},
            text_extractor=lambda path: 'Private email secret@example.org CV text',
            cv_parser=lambda text: {'skills': ['Python'], 'location': 'Belgrade', 'general_description': 'Developer'})
    def call(self, op, input=None):
        return self.service.call({'operation': op, 'actor_id': 'actor', 'context': self.context, 'input': input or {}})
    def extract(self):
        return self.call('extract_cv', {'storage_path': self.p['cv_document']['storage_path'], 'pdf_base64': base64.b64encode(b'%PDF-test').decode()})
    def event(self, uid='e', kind='hackathon', **updates):
        return {'id': uid, 'title': 'Python event', 'kind': kind, 'status': 'open', 'date': '2099-01-01', 'endDate': '2099-01-02', 'deadline': '2099-01-01', 'capacity': 10, 'description': 'Build Python systems', 'tags': ['Python'], **updates}
    def test_proposal_is_public_and_revision_bound(self):
        result = self.extract()
        self.assertEqual(result['proposal'], {'skills': ['Python'], 'city': 'Belgrade', 'bio': 'Developer'})
        self.assertNotIn('secret', json.dumps(result))
        self.assertEqual(self.call('cv_proposal', {'storage_path': self.p['cv_document']['storage_path']})['extraction_hash'], result['extraction_hash'])
        self.p['updated_at'] = 'v2'
        with self.assertRaises(RevisionConflict): self.call('cv_proposal', {'storage_path': self.p['cv_document']['storage_path']})
    def test_transaction_rejects_source_changed_during_extraction(self):
        self.db.documents['gdevPilots/main/users/actor']['updated_at'] = 'new'
        with self.assertRaises(RevisionConflict): self.extract()
    def test_confirmation_acknowledges_without_mutating_public_profile(self):
        result = self.extract()
        self.p['updated_at'] = 'v2'
        self.db.documents['gdevPilots/main/users/actor']['updated_at'] = 'v2'
        self.call('confirm_cv', {'storage_path': self.p['cv_document']['storage_path'], 'expected_profile_updated_at': 'v1',
            'expected_extraction_hash': result['extraction_hash'], 'confirmed_fields': {'skills': ['Python']}})
        self.assertTrue(self.db.documents['gdevPilots/main/cvExtractions/actor']['confirmed'])
        self.assertEqual(self.db.documents['gdevPilots/main/users/actor']['updated_at'], 'v2')
    def test_online_event_survives_city_query_filter(self):
        self.context['events'] = [self.event(format='Online', location='Paris')]
        self.assertEqual(len(self.call('search_events', {'query': 'Python', 'filters': {'city': 'Belgrade'}})['results']), 1)
    def test_grounded_constraint_spans_reject_invented_values(self):
        text='Online in Paris from 2099-01-01'
        result={'constraints':[{'field':'format','value':'Online','start':0,'end':6},
            {'field':'city','value':'Paris','start':10,'end':15},
            {'field':'from','value':'2099-01-01','start':21,'end':31},
            {'field':'to','value':'2099-02-01','start':21,'end':31}]}
        self.assertEqual(grounded_filters(text,result),{'format':'Online','city':'Paris','from':'2099-01-01'})
    def test_ui_empty_filters_preserve_interpreted_constraints(self):
        query='In person Paris from 2099-01-01 to 2099-01-02'
        self.service.generator=lambda q: {'skills':[], 'constraints':[
            {'field':'format','value':'In person','start':0,'end':9},
            {'field':'city','value':'Paris','start':10,'end':15},
            {'field':'from','value':'2099-01-01','start':21,'end':31},
            {'field':'to','value':'2099-01-02','start':35,'end':45}]}
        self.context['events']=[self.event('wanted',format='In person',location='Paris'),
            self.event('other-city',format='In person',location='Belgrade'),
            self.event('other-format',format='Online',location='Paris'),
            self.event('later',format='In person',location='Paris',date='2099-02-01')]
        result=self.call('search_events',{'query':query,'filters':{'city':'','from':'','to':'','format':'','kind':'','topic':'','available':False,'past':False}})
        self.assertEqual([r['eventId'] for r in result['results']],['wanted'])
    def test_nonempty_ui_filter_overrides_interpreted_city(self):
        self.service.generator=lambda q: {'skills':[],'constraints':[{'field':'city','value':'Paris','start':0,'end':5}]}
        self.context['events']=[self.event('paris',location='Paris'),self.event('belgrade',location='Belgrade')]
        result=self.call('search_events',{'query':'Paris','filters':{'city':'Belgrade','from':'','to':'','format':''}})
        self.assertEqual([r['eventId'] for r in result['results']],['belgrade'])
    def test_exact_budget_rejects_before_generate(self):
        from unittest.mock import Mock, patch
        gemma=BudgetedGemma.__new__(BudgetedGemma)
        gemma.model='gemma-pinned'; gemma.context=100; gemma.output=20; gemma.tokenizer=None; gemma.token_url='http://local/tokenize'
        response=Mock(); response.json.return_value={'tokens':81}
        with patch('matching_worker.requests.post',return_value=response),patch('matching_worker._call_json_generate') as generate:
            with self.assertRaises(ValueError): gemma.generate('prompt',{'type':'object'})
            generate.assert_not_called()
    def test_remove_preserves_replacement_proposal_and_vector(self):
        self.extract()
        self.store.row = {'source_markers': {'storage_path': 'new.pdf'}, 'source_hash': 'new'}
        self.call('remove_cv', {'storage_path': 'old.pdf'})
        self.assertIn('gdevPilots/main/cvExtractions/actor', self.db.documents)
        self.assertEqual(self.store.deleted, [])
    def test_remove_old_attachment_after_node_removes_it(self):
        self.extract()
        path = self.p.pop('cv_document')['storage_path']
        self.store.row = {'source_markers': {'storage_path': path}, 'source_hash': 'old'}
        self.call('remove_cv', {'storage_path': path})
        self.assertNotIn('gdevPilots/main/cvExtractions/actor', self.db.documents)
        self.assertEqual(self.store.deleted, [('actor', 'old')])
    def test_all_event_types_and_authoritative_retrieval(self):
        self.context['events'] = [self.event(kind, kind) for kind in ['hackathon', 'meetup', 'conference', 'festival']] + [self.event('draft', status='draft'), self.event('full', capacity=0), self.event('expired', deadline='2000-01-01')]
        result = self.call('search_events', {'query': 'Python'})
        self.assertEqual({r['eventId'] for r in result['results']}, {'hackathon', 'meetup', 'conference', 'festival'})
        self.assertTrue(all(0 <= r['similarity'] <= 1 and r['reasons'] for r in result['results']))
        self.assertEqual({e['event_type'] for e in self.store.events.values()}, {'hackathon', 'meetup', 'conference', 'festival'})
    def test_explicit_generation_failure_retains_vector_search_warning(self):
        self.context['events'] = [self.event()]
        self.service.generator = lambda q: (_ for _ in ()).throw(RuntimeError('offline'))
        self.assertIn('vectors only', self.call('search_events', {'query': 'Python'})['warnings'][0])
    def test_team_complements_and_filters(self):
        self.context['events'] = [self.event(tags=['Python', 'Design'], capacity=2)]
        self.context['people'] += [{'id': 'designer', 'title': 'Designer', 'skills': ['Design'], 'lookingForTeam': True}, {'id': 'outsider', 'title': 'Designer', 'skills': ['Design'], 'lookingForTeam': True}]
        self.context['applications'] = [{'eventId': 'e', 'personId': uid, 'status': 'accepted'} for uid in ['actor', 'designer']]
        result = self.call('team_candidates', {'event_id': 'e'})
        self.assertEqual([r['personId'] for r in result['results']], ['designer'])
        self.assertIn('Missing skills: Design', self.embeddings.query)
        self.assertEqual(self.call('search_events')['results'], [])
        for status in ['draft', 'closed', 'archived']:
            self.context['events'][0]['status'] = status
            with self.assertRaises(ValueError): self.call('team_candidates', {'event_id': 'e'})
    def test_strict_actor_operation_input(self):
        for payload in [{'operation': 'unknown', 'actor_id': 'actor', 'context': self.context, 'input': {}}, {'operation': 'search_events', 'actor_id': 'stranger', 'context': self.context, 'input': {}}, {'operation': 'search_events', 'actor_id': 'actor', 'context': self.context, 'input': {'email': 'x'}}]:
            with self.assertRaises(ValueError): self.service.call(payload)
    def test_real_http_authentication_and_actor_validation(self):
        token = 'test-token-' + 'x' * 32
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.service, token))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for auth, actor, expected in [('wrong', 'actor', 401), ('Bearer ' + token, 'stranger', 400), ('Bearer ' + token, 'actor', 200)]:
                conn = http.client.HTTPConnection('127.0.0.1', server.server_port)
                conn.request('POST', '/v1/matching', json.dumps({'operation': 'search_events', 'actor_id': actor, 'context': self.context, 'input': {'query': 'Python'}}), {'Authorization': auth, 'Content-Type': 'application/json'})
                response = conn.getresponse()
                self.assertEqual(response.status, expected)
                response.read()
                conn.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
    def test_cloud_tasks_retryable_job_http_status(self):
        from unittest.mock import Mock
        token='token-'+'x'*32
        self.service.jobs=Mock()
        server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.service,token))
        thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            for job,expected in [({'status':'pending','retry_after':4},503),({'status':'deferred','retry_after':30},503),({'status':'failed'},200),({'status':'completed'},200)]:
                self.service.jobs.run.return_value=job
                conn=http.client.HTTPConnection('127.0.0.1',server.server_port)
                conn.request('POST','/v1/jobs/run',json.dumps({'job_id':'job'}),{'Authorization':'Bearer '+token,'Content-Type':'application/json'})
                response=conn.getresponse()
                self.assertEqual(response.status,expected)
                if expected==503:
                    self.assertEqual(response.getheader('Retry-After'),str(job['retry_after']))
                body=json.loads(response.read()); self.assertEqual(body['status'],job['status'])
                conn.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__': unittest.main()
