import sys
import unittest
import copy
import math
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from firestore_vector_store import FirestoreMatchmakingStore, vector_index_config
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from test_firebase_store import DatabaseDouble, Reference, Collection, Snapshot
from embeddings import LocalHashingEmbeddings
from contracts import RevisionConflict

class ReadReference(Reference):
    def get(self, *, transaction=None):
        if transaction is not None and transaction.writes:
            raise AssertionError('Read after write')
        return Snapshot(self.db.documents.get(self.path))

def accepts(filter, row):
    if hasattr(filter, 'filters'):
        values = [accepts(f, row) for f in filter.filters]
        return any(values) if filter.__class__.__name__ == 'Or' else all(values)
    actual, expected = row.get(filter.field_path), filter.value
    op = filter.op_string
    if op == '==': return actual == expected
    if actual is None: return False
    return {'>=': lambda: actual >= expected, '<=': lambda: actual <= expected,
            '>':lambda: actual > expected,'<':lambda: actual < expected,
            '!=':lambda: actual != expected,'in':lambda: actual in expected,
            'not-in':lambda: actual not in expected}[op]()

class Query(Collection):
    def __init__(self, db, path, filters=()):
        super().__init__(db,path)
        self.filters = filters
    def document(self, doc_id): return ReadReference(self.db,self.path+'/'+doc_id)
    def where(self, *, filter): return Query(self.db,self.path,self.filters+(filter,))
    def find_nearest(self, **kwargs):
        self.db.last_query = kwargs
        assert isinstance(kwargs['query_vector'],Vector)
        assert kwargs['distance_measure'] == DistanceMeasure.COSINE
        self.nearest = kwargs
        return self
    def stream(self):
        result=[]
        for path,row in self.db.documents.items():
            if path.startswith(self.path+'/') and all(accepts(f,row) for f in self.filters):
                row=copy.deepcopy(row)
                vector=list(row['embedding']); query=list(self.nearest['query_vector'])
                distance=1-sum(a*b for a,b in zip(vector,query))/(math.hypot(*vector)*math.hypot(*query))
                row[self.nearest['distance_result_field']]=distance
                result.append((distance,row))
        return [Snapshot(row) for _,row in sorted(result,key=lambda item:item[0])[:self.nearest['limit']]]

class DB(DatabaseDouble):
    def collection(self,path): return Query(self,path)

def cv(identity='person', **fields):
    return {'candidate_id':identity,'current_role':'Engineer','skills':['Python'],
            'location':'Belgrade','experience_level':'Junior','birth_year':2002,**fields}

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.encoder=LocalHashingEmbeddings(size=256)
        self.db=DB()
        self.store=FirestoreMatchmakingStore(self.encoder,db=self.db,workspace='evaluation/run',allow_unbound_sources=True)

    def test_native_vector_private_payload_and_cache(self):
        with patch.object(self.encoder,'embed_documents',wraps=self.encoder.embed_documents) as embed:
            self.store.upsert_candidate(cv(cv_text='private',cv_filename='secret.pdf'))
            self.store.upsert_candidate(cv(cv_text='private',cv_filename='secret.pdf'))
            self.assertEqual(embed.call_count,1)
        row=next(iter(self.db.documents.values()))
        self.assertIsInstance(row['embedding'],Vector)
        self.assertNotIn('cv_text',row['payload'])
        self.assertNotIn('cv_filename',row['payload'])
        self.assertEqual(self.store.get_candidate('person')['candidate_id'],'person')

    def test_native_serialization_and_index_config(self):
        from google.cloud.firestore_v1._helpers import encode_value
        encoded=encode_value(Vector([1.,0.]))
        self.assertEqual(encoded.map_value.fields['__type__'].string_value,'__vector__')
        index=vector_index_config(256,['city','birth_year'])
        self.assertEqual(index['fields'][-1],{'fieldPath':'embedding','vectorConfig':{'dimension':256,'flat':{}}})
        self.assertIn({'fieldPath':'recipe','order':'ASCENDING'},index['fields'])
        with self.assertRaises(ValueError): vector_index_config(4096)

    def test_matching_payload_reuses_vector_on_canonical_revision_change(self):
        path='evaluation/run/users/person'
        self.db.documents[path]={'updated_at':'v1'}
        self.store.upsert_candidate(cv(source_updated_at='v1'))
        token=self.store.candidate_source_hash('person')
        self.db.documents[path]['updated_at']='v2'
        with patch.object(self.encoder,'embed_documents',side_effect=AssertionError('must reuse')):
            self.store.upsert_candidate(cv(source_updated_at='v2'),expected_source_hash=token)

    def test_cosine_contract_and_metadata_filter(self):
        self.store.upsert_candidates([cv(),cv('older',birth_year=1980)])
        result=self.store.query_candidates(self.encoder.embed_query('Python Engineer'),5,{'birth_year':{'$gte':2000}})
        self.assertEqual([identity for identity,_ in result],['person'])
        self.assertEqual(self.db.last_query['distance_measure'],DistanceMeasure.COSINE)
        # Incompatible namespace is isolated even in the same collections.
        other=FirestoreMatchmakingStore(self.encoder,db=self.db,workspace='evaluation/run',namespace='other',allow_unbound_sources=True)
        self.assertEqual(other.query_candidates(self.encoder.embed_query('Python'),5),[])

    def test_explicit_tokens_and_removal(self):
        self.store.upsert_candidate(cv())
        token=self.store.candidate_source_hash('person')
        with self.assertRaises(RevisionConflict): self.store.upsert_candidate(cv(skills=['Java']))
        self.store.upsert_candidate(cv(skills=['Java']),expected_source_hash=token)
        with self.assertRaises(RevisionConflict): self.store.delete_candidate('person',expected_source_hash=token)
        token=self.store.candidate_source_hash('person')
        self.assertTrue(self.store.delete_candidate('person',expected_source_hash=token))
        self.assertFalse(self.store.delete_candidate('person',expected_source_hash=token))
        self.assertIsNone(self.store.get_candidate('person'))

    def test_removal_during_embedding_cannot_resurrect(self):
        original=self.encoder.embed_documents
        def embed(texts):
            self.store.delete_candidate('person',expected_source_hash=None)
            return original(texts)
        with patch.object(self.encoder,'embed_documents',side_effect=embed):
            with self.assertRaises(RevisionConflict): self.store.upsert_candidate(cv())

    def test_canonical_freshness_and_attachment(self):
        path='evaluation/run/users/person'
        self.db.documents[path]={'updated_at':'v1','cv_document':{'storage_path':'file'}}
        value=cv(source_updated_at='v1',source_storage_path='file')
        self.store.upsert_candidate(value)
        self.db.documents[path]['updated_at']='v2'
        self.assertIsNone(self.store.get_candidate('person'))
        self.assertEqual(self.store.query_candidates(self.encoder.embed_query('Python'),5),[])
        with self.assertRaises(RevisionConflict): self.store.upsert_candidate(value)
        token=self.store.candidate_source_hash('person')
        self.store.upsert_candidate(cv(source_updated_at='v2',source_storage_path='file'),expected_source_hash=token)
        self.assertIsNotNone(self.store.get_candidate('person'))
        del self.db.documents[path]
        self.assertIsNone(self.store.get_candidate('person'))

    def test_failed_embedding_keeps_old_index(self):
        self.store.upsert_candidate(cv())
        token=self.store.candidate_source_hash('person')
        with patch.object(self.encoder,'embed_documents',side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError): self.store.upsert_candidate(cv(skills=['Java']),expected_source_hash=token)
        self.assertEqual(self.store.candidate_source_hash('person'),token)

    def test_events_require_explicit_updates_and_filter_deleted_sources(self):
        path='evaluation/run/events/event'
        self.db.documents[path]={'updated_at':'v1','status':'published'}
        event={'event_id':'event','name':'Python Meetup','event_type':'meetup','source_updated_at':'v1'}
        self.store.upsert_event(event)
        with self.assertRaises(RevisionConflict): self.store.upsert_event({**event,'name':'Java Meetup'})
        self.store.upsert_event({**event,'name':'Java Meetup'},expected_source_hash=self.store.event_source_hash('event'))
        self.db.documents[path]['status']='draft'
        self.assertIsNone(self.store.get_event('event'))
        self.assertEqual(self.store.query_events(self.encoder.embed_query('Python'),10),[])

    def test_transaction_retry_rechecks_canonical(self):
        path='evaluation/run/users/person'
        self.db.documents[path]={'updated_at':'v1'}
        self.db.before_commit=lambda documents: documents[path].update(updated_at='v2')
        with self.assertRaises(RevisionConflict): self.store.upsert_candidate(cv(source_updated_at='v1'))
        self.assertEqual(len(self.db.documents),1)

    def test_all_event_kinds_cache_and_document_encoding(self):
        for kind in ['hackathon','conference','meetup','festival']:
            event={'event_id':kind,'name':'Python '+kind,'event_type':kind,'skills':['Python']}
            with patch.object(self.encoder,'embed_documents',wraps=self.encoder.embed_documents) as embed:
                self.store.upsert_event(event); self.store.upsert_event(event)
                self.assertEqual(embed.call_count,1)
            self.assertEqual(self.store.get_event(kind)[0]['event_type'],kind)
        self.assertEqual(len(self.store.query_events(self.encoder.embed_query('Python'),10)),4)

    def test_search_event_uses_cached_query_encoding(self):
        from search_engine import find_best_matches
        self.store.upsert_candidate(cv())
        self.store.upsert_event({'event_id':'event','name':'Python Meetup','event_type':'meetup'})
        with patch.object(self.encoder,'embed_query',wraps=self.encoder.embed_query) as embed:
            self.assertEqual(find_best_matches(self.store,'event')[0].candidate_id,'person')
            find_best_matches(self.store,'event')
            self.assertEqual(embed.call_count,1)

    def test_limits_and_invalid_inputs(self):
        with self.assertRaises(ValueError): self.store.upsert_candidates([cv(str(i)) for i in range(257)])
        with self.assertRaises(ValueError): self.store.upsert_candidates([cv(),cv()])
        with self.assertRaises(ValueError): self.store.get_candidate('../x')
        with self.assertRaises(ValueError): self.store.upsert_candidate(None)
        with self.assertRaises(ValueError): self.store.query_candidates([0]*256,5)
        with self.assertRaises(ValueError): self.store.query_candidates([1]*256,True)
        with self.assertRaises(ValueError): self.store.query_candidates([1]*256,5,{'payload':{'$eq':'bad'}})
        with self.assertRaises(ValueError): self.store.upsert_event({'name':'x'*65000})

    def test_pipeline_firestore_and_explicit_local(self):
        from pipeline import configure_store
        self.assertIsInstance(configure_store(embeddings=self.encoder,db=self.db),FirestoreMatchmakingStore)
        from vector_store import MatchmakingStore
        self.assertIsInstance(configure_store(None,embeddings=self.encoder,storage_backend='chroma'),MatchmakingStore)

class StartupTests(unittest.TestCase):
    def test_custom_production_workspace_requires_bound_canonical_sources(self):
        db=DB(); encoder=LocalHashingEmbeddings(size=256)
        store=FirestoreMatchmakingStore(encoder,db=db,workspace='pilots/custom')
        self.assertFalse(store._fresh('candidate','person',{}))
        db.documents['pilots/custom/users/person']={'id':'person'}
        self.assertTrue(store._fresh('candidate','person',{}))
        db.documents['pilots/custom/users/person']['updated_at']='new-version'
        self.assertFalse(store._fresh('candidate','person',{}))
        with self.assertRaises(ValueError):
            FirestoreMatchmakingStore(encoder,db=db,workspace='pilots/custom',allow_unbound_sources=True)
    def test_native_index_uses_firestore_equality_order_and_range_last(self):
        from firestore_vector_store import vector_index_config
        base=vector_index_config()
        self.assertEqual([f['fieldPath'] for f in base['fields']],['deleted','dimensions','model','namespace','recipe','embedding'])
        age=vector_index_config(filter_fields=('seniority_level','birth_year','city'))
        self.assertEqual([f['fieldPath'] for f in age['fields']],['city','deleted','dimensions','model','namespace','recipe','seniority_level','birth_year','embedding'])
    def test_invalid_namespace(self):
        with self.assertRaises(ValueError):
            FirestoreMatchmakingStore(None, namespace='../bad')
