"""Offline coverage of the mandatory onboarding candidate boundary."""
import unittest
from unittest.mock import patch
import test_matching_worker as worker_fixtures
from test_firestore_vector_store import DB, cv
from embeddings import LocalHashingEmbeddings
from firestore_vector_store import FirestoreMatchmakingStore
from matching_jobs import EmbeddingJobs
from contracts import RevisionConflict


class OnboardingTests(unittest.TestCase):
    def worker(self):
        fixture = worker_fixtures.WorkerTests()
        fixture.setUp()
        return fixture

    def store(self):
        db = DB()
        encoder = LocalHashingEmbeddings(size=256)
        store = FirestoreMatchmakingStore(encoder, db=db)
        db.documents['gdevPilots/main/users/person'] = {'updated_at': 'v1'}
        return db, encoder, store

    def test_sync_skips_pending_people_and_keeps_events_and_legacy(self):
        fixture = self.worker()
        pending = {**fixture.p, 'id': 'pending', 'onboarding': {'version': 1, 'status': 'required'}}
        completed = {**fixture.p, 'id': 'completed', 'onboarding': {'version': 1, 'status': 'completed'}}
        fixture.context['people'] += [pending, completed]
        fixture.context['events'] = [fixture.event()]
        queued = []
        class Jobs:
            def enqueue(self, kind, value):
                queued.append((kind, value))
                return str(len(queued))
        fixture.service.jobs = Jobs()
        self.assertEqual(fixture.call('queue_sync')['queued_jobs'], 3)
        self.assertEqual([v['candidate_id'] for k, v in queued if k == 'candidate'], ['actor', 'completed'])

    def test_team_candidates_excludes_pending_even_when_accepted(self):
        fixture = self.worker()
        fixture.context['people'] += [{**fixture.p, 'id': 'pending', 'lookingForTeam': True,
            'onboarding': {'version': 1, 'status': 'required'}}]
        fixture.context['events'] = [fixture.event()]
        fixture.context['applications'] = [{'personId': identity, 'eventId': 'e', 'status': 'accepted'} for identity in ['actor', 'pending']]
        self.assertEqual(fixture.call('team_candidates', {'event_id': 'e'})['results'], [])
        self.assertEqual(fixture.store.people, {})

    def test_existing_vectors_disappear_while_onboarding_required(self):
        db, encoder, store = self.store()
        store.upsert_candidate(cv(source_updated_at='v1'))
        db.documents['gdevPilots/main/users/person']['onboarding'] = {'version': 1, 'status': 'required'}
        self.assertIsNone(store.get_candidate('person'))
        self.assertEqual(store.query_candidates(encoder.embed_query('Python'), 5), [])

    def test_pending_source_rejects_index_write_before_embedding(self):
        db, encoder, store = self.store()
        db.documents['gdevPilots/main/users/person']['onboarding'] = {'version': 1, 'status': 'required'}
        with patch.object(encoder, 'embed_documents', side_effect=AssertionError('must not embed')):
            with self.assertRaises(RevisionConflict):
                store.upsert_candidate(cv(source_updated_at='v1'))

    def test_old_queued_job_becomes_stale_when_onboarding_required(self):
        db, encoder, store = self.store()
        jobs = EmbeddingJobs(db, store, 'gdevPilots/main')
        job = jobs.enqueue('candidate', cv(source_updated_at='v1'))
        db.documents['gdevPilots/main/users/person']['onboarding'] = {'version': 1, 'status': 'required'}
        with patch.object(encoder, 'embed_documents', side_effect=AssertionError('must not embed')):
            self.assertEqual(jobs.run(job)['status'], 'stale')

    def test_completed_and_legacy_sources_remain_eligible(self):
        db, encoder, store = self.store()
        self.assertTrue(store._fresh('candidate', 'person', {'updated_at': 'v1'}))
        db.documents['gdevPilots/main/users/person']['onboarding'] = {'version': 1, 'status': 'completed'}
        store.upsert_candidate(cv(source_updated_at='v1'))
        self.assertIsNotNone(store.get_candidate('person'))
