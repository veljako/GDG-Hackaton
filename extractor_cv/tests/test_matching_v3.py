import sys
from pathlib import Path
import unittest
from datetime import date
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from matching_worker import person_cv, event_dict
from vector_store import candidate_narrative, event_narrative, MatchmakingStore
from search_engine import build_hard_filter

class MatchingV3Tests(unittest.TestCase):
    def test_profile_preferences_change_source_and_narrative(self):
        p = {'id':'person','title':'Developer','skills':[], 'learningSkills':['Rust'], 'interests':['Robotics'], 'roles':['Designer'], 'preferences':{'goals':['Learn'], 'kinds':['workshop'], 'formats':['Online'], 'level':'Beginner'}, 'country':'Serbia','birth_date':'2000-10-11'}
        cv = person_cv(p)
        narrative = candidate_narrative(cv)
        for value in ('Rust','Robotics','Designer','Learn','workshop','Online','Beginner'):
            self.assertIn(value, narrative)
        self.assertNotIn('2000-10-11', narrative)
        before = MatchmakingStore._prepare(cv)[1]
        p['interests'] = ['Astronomy']
        self.assertNotEqual(before, MatchmakingStore._prepare(person_cv(p))[1])

    def test_event_adapter_preserves_explicit_criteria(self):
        e = {'id':'event','title':'Learning','kind':'workshop','format':'Hybrid','topics':['Robotics'],'country':'Serbia','languages':['English'], 'audience':{'skills':['Python'],'taughtSkills':['Rust'],'levels':[]}, 'eligibility':{'requiredSkills':['Python'],'statuses':['Student'],'minBirthYear':2000}}
        result = event_dict(e)
        self.assertEqual(result['criteria_version'],2)
        self.assertEqual(result['format'],'hybrid')
        self.assertEqual(result['required_skills'], ['Python'])
        self.assertEqual(result['min_birth_year'],2000)
        self.assertIn('Rust',event_narrative(result))
        self.assertNotIn('They are skilled',event_narrative(result))

    def test_location_is_not_eligibility(self):
        self.assertIsNone(build_hard_filter({'criteria_version':2,'location':'Berlin','format':'in_person'}))

    def test_conventional_one_sided_year(self):
        self.assertEqual(build_hard_filter({'criteria_version':2,'min_birth_year':2000}), {'birth_year':{'$gte':2000}})

    def test_eligibility_known_evidence_and_age_boundary(self):
        from matching_eligibility import candidate_eligible
        event = {'criteria_version':2,'required_skills':['Python'],'statuses':['Student'],'min_age':18}
        self.assertFalse(candidate_eligible({},event,today=date(2026,10,11)))
        p = {'skills':['Python'],'status':'Student','birth_year':2008}
        self.assertFalse(candidate_eligible(p,event,today=date(2026,10,11)))
        p['birth_date']='2008-10-11'
        self.assertTrue(candidate_eligible(p,event,today=date(2026,10,11)))
        p['birth_date']='2008-10-12'
        self.assertFalse(candidate_eligible(p,event,today=date(2026,10,11)))

    def test_firebase_import_full_event_contract(self):
        from firebase_store import event_document
        _, result = event_document({'event_id':'learning','event_type':'workshop','criteria_version':2,'format':None,'taught_skills':['Rust'],'topics':['Robotics'],'required_skills':['Python'],'min_birth_year':2000,'country':'Serbia','languages':['English']})
        self.assertEqual(result['matchingVersion'],2)
        self.assertIsNone(result['format'])
        self.assertEqual(result['audience']['taughtSkills'],['Rust'])
        self.assertEqual(result['eligibility']['minBirthYear'],2000)
        self.assertEqual(result['eligibility']['requiredSkills'],['Python'])

    def test_jobs_keep_all_matching_fields_and_revision_changes(self):
        from matching_jobs import EmbeddingJobs
        from test_firebase_store import DatabaseDouble
        from test_matching_jobs import Store
        db, store = DatabaseDouble(), Store()
        queue = EmbeddingJobs(db,store,'test/main')
        payload = {'event_id':'event','criteria_version':2,'format':None,'topics':['Robotics'],'taught_skills':['Rust'],'required_skills':['Python'],'statuses':['Student'],'min_age':18,'min_birth_year':2000}
        first = queue.enqueue('event',payload)
        row = db.documents['test/main/embeddingJobs/'+first]
        self.assertEqual(row['payload'],payload)
        payload['required_skills'] = ['Rust']
        self.assertNotEqual(first,queue.enqueue('event',payload))

    def test_firestore_roundtrip_new_fields_and_recipe_rejection(self):
        from firestore_vector_store import FirestoreMatchmakingStore
        from test_firestore_vector_store import DB
        from embeddings import LocalHashingEmbeddings
        db = DB()
        store = FirestoreMatchmakingStore(LocalHashingEmbeddings(),db=db,workspace='evaluation/run',allow_unbound_sources=True)
        event = {'event_id':'event','criteria_version':2,'name':'Learning','format':None,'taught_skills':['Rust'],'required_skills':['Python'],'min_birth_year':2000}
        store.upsert_event(event)
        saved,_ = store.get_event('event')
        self.assertEqual(saved['min_birth_year'],2000)
        self.assertEqual(saved['taught_skills'],['Rust'])
        token = store.event_source_hash('event')
        event['required_skills'] = ['Rust']
        store.upsert_event(event,expected_source_hash=token)
        self.assertNotEqual(token,store.event_source_hash('event'))
        row = next(v for v in db.documents.values() if v.get('identity') == 'event')
        row['recipe'] = 'matching-narrative-v2'
        self.assertIsNone(store.get_event('event'))

    def test_worker_excludes_ineligible_even_when_ranked_high(self):
        from test_matching_worker import WorkerTests
        fixture = WorkerTests()
        fixture.setUp()
        fixture.context['events'] = [{'id':'event','title':'Learning','status':'open','capacity':100,'date':'2099-01-01','endDate':'2099-01-01','deadline':'2099-01-01','eligibility':{'requiredSkills':['Rust']},'matchingVersion':2}]
        self.assertEqual(fixture.call('recommend_events')['results'],[])
        fixture.p['skills'].append('Rust')
        self.assertEqual(len(fixture.call('recommend_events')['results']),1)

    def test_no_prerequisite_from_taught_or_practiced_skills(self):
        from matching_eligibility import candidate_eligible
        self.assertTrue(candidate_eligible({'learning_skills':['Rust']},{'criteria_version':2,'skills':['Python'],'taught_skills':['Rust']}))
        self.assertFalse(candidate_eligible({'status':'Student'},{'criteria_version':2,'seniorities':['Junior']}))
        self.assertTrue(candidate_eligible({'status':'Student'},{'criteria_version':2,'statuses':['Student']}))


    def test_public_compatibility_match_metadata_omits_exact_birth_date(self):
        from candidate_matcher import CandidateVectorStore, CandidateMatcher
        from embeddings import LocalHashingEmbeddings
        adapter = CandidateVectorStore(LocalHashingEmbeddings())
        matcher = CandidateMatcher(adapter)
        matcher.add_cvs([{'candidate_id':'person','skills':['Python'],'birth_date':'2000-10-11'}])
        match = matcher.find_best_candidates({'name':'Learning','criteria_version':2})[0]
        self.assertNotIn('2000-10-11',str(match.metadata))

    def test_event_narrative_includes_format_languages_country(self):
        narrative = event_narrative({'name':'Learning','format':'hybrid','country':'Serbia','languages':['English'],'price':{'amount':10,'currency':'EUR'}})
        for value in ('hybrid','Serbia','English','EUR'):
            self.assertIn(value,narrative)

    def test_age_eligibility_uses_event_date(self):
        from matching_eligibility import candidate_eligible
        p = {'birth_date':'2008-12-01'}
        self.assertTrue(candidate_eligible(p,{'criteria_version':2,'date':'2026-12-02','min_age':18}, today=None))
        self.assertFalse(candidate_eligible(p,{'criteria_version':2,'date':'2028-12-02','max_age':18}, today=None))
        self.assertFalse(candidate_eligible(p,{'criteria_version':2,'min_age':18}))

    def test_birth_date_validation_and_year_consistency(self):
        from extractors import normalize_cv_dict
        cv = normalize_cv_dict({'skills':['Python'],'birth_date':'2000-10-11'},'person','')
        self.assertEqual(cv['birth_year'],2000)
        for value in ('2000-02-30','2099-01-01','20001011'):
            with self.assertRaises(ValueError):
                normalize_cv_dict({'birth_date':value},'person','')
        with self.assertRaises(ValueError):
            normalize_cv_dict({'birth_date':'2000-10-11','birth_year':2001},'person','')

    def test_legacy_seniority_becomes_explicit_eligibility(self):
        from firebase_store import event_document
        _, result = event_document({'event_id':'event','event_type':'meetup','seniority':'Medior'})
        self.assertEqual(result['eligibility']['seniorities'],['Mid'])
        _, result = event_document({'event_id':'event','event_type':'meetup','seniority':'Student'})
        self.assertEqual(result['eligibility']['statuses'],['Student'])
        self.assertFalse(result['eligibility']['seniorities'])

    def test_event_contract_rejects_invalid_lists_and_vocabulary(self):
        from contracts import normalize_event_constraints
        for value in ({'required_skills':['Python',3]}, {'statuses':['Junior']}, {'seniorities':['Student']}, {'goals':['junior']}, {'levels':['Junior']}, {'roles':['developer']}):
            with self.assertRaises(ValueError):
                normalize_event_constraints({'criteria_version':2,**value})

    def test_legacy_job_cannot_reindex_with_new_recipe(self):
        from matching_jobs import EmbeddingJobs
        from test_matching_jobs import Store
        from test_firebase_store import DatabaseDouble
        db,store = DatabaseDouble(),Store()
        queue = EmbeddingJobs(db,store,'test/main')
        uid = queue.enqueue('candidate',{'candidate_id':'person','skills':['Python']})
        row = db.documents['test/main/embeddingJobs/'+uid]
        self.assertEqual(row['contract'],store.contract)
        row.pop('contract')
        self.assertEqual(queue.run(uid)['status'],'stale')
        self.assertFalse(store.calls)

    def test_extraction_rejects_unstated_format_and_negated_prerequisite(self):
        from event_candidate_finder import _normalize_format, _merge_scraped_skills
        data = {'format':'online','skills':['Python'],'required_skills':['Docker'],'taught_skills':['Docker']}
        _normalize_format('Python workshop for students',data)
        self.assertIsNone(data['format'])
        _merge_scraped_skills('Python workshop. No Docker knowledge required. Learn Docker.',data,{})
        self.assertEqual(data['required_skills'],[])
        self.assertEqual(data['taught_skills'],['Docker'])

    def test_worker_receipt_and_canonical_topic_browse(self):
        from test_matching_worker import WorkerTests
        fixture = WorkerTests()
        fixture.setUp()
        fixture.context['events'] = [{'id':'event','title':'Learning','status':'open','capacity':100,'date':'2099-01-01','endDate':'2099-01-01','deadline':'2099-01-01','topics':['Robotics'],'tags':['Python'],'eligibility':{'requiredSkills':['Rust']},'matchingVersion':2}]
        fixture.service.jobs = type('Jobs',(),{'enqueue':lambda self,*args:'job'})()
        self.assertEqual(fixture.call('queue_sync')['recipe'],'matching-narrative-v3')
        self.assertEqual(len(fixture.call('search_events',{'filters':{'topic':'Robotics'}})['results']),1)
        self.assertEqual(fixture.call('recommend_events',{'filters':{'topic':'Robotics'}})['results'],[])
        fixture.context['events'][0]['topics'] = []
        self.assertEqual(fixture.call('search_events',{'filters':{'topic':'Python'}})['results'],[])

    def test_future_draft_dates_and_extraction_preserve_known_iso_dates(self):
        from firebase_store import event_document
        from extractors import extract_event_info
        from unittest.mock import patch
        _, result = event_document({'event_id':'event','event_type':'meetup','criteria_version':2,'date':'2099-10-11'})
        self.assertEqual(result['date'],'2099-10-11')
        self.assertEqual(result['endDate'],'2099-10-11')
        self.assertEqual(result['deadline'],'2099-10-11')
        with patch('extractors.event_to_json',return_value={'criteria_version':2,'date':'2099-10-11','end_date':'2099-10-12','deadline':'2099-10-01'}):
            event = extract_event_info('Meetup starts 2099-10-11, ends 2099-10-12, deadline 2099-10-01.')
        self.assertEqual(event['date'],'2099-10-11')
        self.assertEqual(event['end_date'],'2099-10-12')
        self.assertEqual(event['deadline'],'2099-10-01')

    def test_event_dates_must_be_valid_and_explicit(self):
        from contracts import normalize_event_constraints
        from event_candidate_finder import _normalize_dates
        with self.assertRaises(ValueError):
            normalize_event_constraints({'criteria_version':2,'date':'2099-02-30'})
        data = {'date':'2099-10-11','end_date':'2099-10-12','deadline':None}
        _normalize_dates('Meetup 2099-10-11',data)
        self.assertEqual(data['date'],'2099-10-11')
        self.assertIsNone(data['end_date'])
