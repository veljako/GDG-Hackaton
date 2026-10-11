"""Private native Firestore vector index, with transaction-checked source revisions.

Vector indexes need equality fields namespace/model/dimensions/recipe/deleted plus
the requested metadata filters, and embedding (COSINE, declared dimensions).
Firestore reports the exact gcloud index creation command for a missing shape.
"""
import json
import uuid
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.base_query import FieldFilter, And, Or
from contracts import RevisionConflict, validate_id, validate_event_constraints, normalize_event_constraints
from embeddings import embedding_model_id, validate_vector
from vector_store import MatchmakingStore, RECIPE, _EVENT_FIELDS, _hash, candidate_narrative, event_narrative, event_id_for, city_key


class FirestoreMatchmakingStore:
    def __init__(self, embeddings, db=None, workspace='gdevPilots/main', namespace='gemma-v1', *, allow_unbound_sources=False):
        validate_id(namespace)
        pieces = workspace.split('/') if isinstance(workspace, str) else []
        if not pieces or len(pieces) % 2 or any(validate_id(p) != p for p in pieces):
            raise ValueError('Workspace must be a Firestore document path.')
        dimensions = getattr(embeddings, 'dimensions', None)
        if isinstance(dimensions, bool) or not isinstance(dimensions, int) or not 1 <= dimensions <= 2048:
            raise ValueError('Firestore embedding dimensions must be 1-2048.')
        self.embeddings, self.dimensions = embeddings, dimensions
        self.contract = dict(namespace=namespace, model=embedding_model_id(embeddings), dimensions=dimensions, recipe=RECIPE)
        if db is None:
            from firebase_store import get_db
            db = get_db()
        self.db, self.workspace = db, workspace
        self.allow_unbound_sources = allow_unbound_sources
        if allow_unbound_sources and not workspace.startswith(('gdevEvaluations/', 'evaluation/')):
            raise ValueError('Unbound sources are restricted to explicit evaluation workspaces.')
        self._event_queries = {}
        self.candidates = db.collection(workspace + '/userEmbeddings')
        self.events = db.collection(workspace + '/eventEmbeddings')

    def _ref(self, collection, identity):
        return collection.document(_hash({'contract': self.contract, 'id': validate_id(identity)}))

    def _read(self, collection, identity, transaction=None):
        snapshot = self._ref(collection, identity).get(transaction=transaction)
        return snapshot.to_dict() if snapshot.exists else {}

    @staticmethod
    def _markers(source):
        result = {}
        for target, keys in [('updated_at', ('source_updated_at', 'expected_updated_at', 'updated_at')),
                             ('storage_path', ('source_storage_path', 'storage_path'))]:
            for key in keys:
                if key in source and source[key] is not None:
                    value = source[key]
                    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
                        raise ValueError('Invalid canonical source marker.')
                    result[target] = value
                    break
        return result

    def _fresh(self, kind, identity, markers, transaction=None):
        if not markers and self.allow_unbound_sources:
            return True
        snapshot = self.db.collection(self.workspace + ('/users' if kind == 'candidate' else '/events')).document(identity).get(transaction=transaction)
        source = snapshot.to_dict() if snapshot.exists else None
        if not source or source.get('deleted') or source.get('deleted_at'):
            return False
        if kind == 'candidate' and (source.get('onboarding') or {}).get('status') == 'required':
            return False
        if kind == 'event' and (source.get('status') in ('draft', 'cancelled', 'archived') or source.get('published') is False):
            return False
        if 'updated_at' in markers and source.get('updated_at') != markers['updated_at']:
            return False
        if 'updated_at' not in markers and source.get('updated_at') is not None:
            # Legacy unstamped sources cease to be current after the first edit.
            return False
        if 'storage_path' in markers and (source.get('cv_document') or {}).get('storage_path') != markers['storage_path']:
            return False
        return True

    def _active(self, collection, kind, identity):
        row = self._read(collection, identity)
        if row.get('deleted') or any(row.get(field) != value for field, value in self.contract.items()) or not self._fresh(kind, identity, row.get('source_markers', {})):
            return None
        return row or None

    def candidate_source_hash(self, identity):
        row = self._read(self.candidates, identity)
        return None if row.get('deleted') else row.get('source_hash')

    def event_source_hash(self, identity):
        row = self._read(self.events, identity)
        return None if row.get('deleted') else row.get('source_hash')

    def get_candidate(self, identity):
        row = self._active(self.candidates, 'candidate', identity)
        return row['payload'] if row else None

    def get_event(self, identity):
        row = self._active(self.events, 'event', identity)
        return (row['payload'], list(row['embedding'])) if row else None

    def event_query_vector(self, identity):
        """Candidate retrieval needs query encoding, distinct from event indexing."""
        row = self._active(self.events, 'event', identity)
        if row is None:
            raise KeyError('Event is missing or stale.')
        key = _hash(row['payload'])
        if key not in self._event_queries:
            self._event_queries[key] = validate_vector(self.embeddings.embed_query(event_narrative(row['payload'])), self.dimensions)
            if len(self._event_queries) > 256:
                self._event_queries.pop(next(iter(self._event_queries)))
        return list(self._event_queries[key])

    def upsert_candidate(self, cv, *, expected_source_hash=None):
        if not isinstance(cv, dict):
            raise ValueError('Candidate must be a dictionary.')
        return self.upsert_candidates([cv], expected_source_hashes={cv['candidate_id']: expected_source_hash})[0]

    def upsert_candidates(self, cvs, *, expected_source_hashes=None):
        if not isinstance(cvs, (list, tuple)):
            raise ValueError('Candidates must be a bounded list.')
        if len(cvs) > 256:
            raise ValueError('Index write batch exceeds 256 candidates.')
        rows = []
        for cv in cvs:
            if not isinstance(cv, dict):
                raise ValueError('Candidate must be a dictionary.')
            payload, revision = MatchmakingStore._prepare(cv)
            markers = self._markers(cv)
            revision = _hash({'matching': revision, 'markers': markers})
            metadata = MatchmakingStore.candidate_metadata(payload, revision)
            metadata.pop('payload')
            rows.append((payload['candidate_id'], payload, revision, markers, metadata))
        return self._upsert(self.candidates, 'candidate', rows, expected_source_hashes or {})

    def upsert_event(self, event, *, expected_source_hash=None):
        validate_event_constraints(event)
        event = normalize_event_constraints(event)
        identity = validate_id(event.get('event_id') or event_id_for(event))
        payload = {key: event.get(key) for key in _EVENT_FIELDS}
        payload['event_id'] = identity
        if payload.get('remote') is None:
            payload.pop('remote', None)
        markers = self._markers(event)
        revision = _hash({'payload': payload, 'markers': markers})
        metadata = {'event_id': identity, 'event_type': payload.get('event_type') or 'event',
                    'remote': bool(payload.get('remote')), 'city': city_key(payload.get('location')),
                    'location': payload.get('location')}
        return self._upsert(self.events, 'event', [(identity, payload, revision, markers, metadata)], {identity: expected_source_hash})[0]

    def _upsert(self, collection, kind, rows, tokens):
        ids = [row[0] for row in rows]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate IDs in one batch.')
        pending = []
        for identity, payload, revision, markers, metadata in rows:
            if len(json.dumps(payload, ensure_ascii=False).encode()) > 64000:
                raise ValueError('Matching metadata exceeds 64KB.')
            previous = self._read(collection, identity)
            current = None if previous.get('deleted') else previous.get('source_hash')
            token = tokens.get(identity)
            if token is not None and token != current:
                raise RevisionConflict('Source revision changed.')
            if not self._fresh(kind, identity, markers):
                raise RevisionConflict('Canonical source changed or was removed.')
            if current == revision:
                continue
            if current is not None and token != current:
                raise RevisionConflict('Replacing a record requires its current source hash.')
            pending.append((identity, payload, revision, markers, metadata, previous))
        if not pending:
            return ids
        builder = candidate_narrative if kind == 'candidate' else event_narrative
        narratives = [builder(row[1]) for row in pending]
        fresh_indices = [i for i, row in enumerate(pending)
                         if row[5].get('payload') != row[1] or 'embedding' not in row[5]]
        # Stored events and candidates both use document encoding; retrieval uses query encoding.
        fresh_vectors = self.embeddings.embed_documents([narratives[i] for i in fresh_indices]) if fresh_indices else []
        if len(fresh_vectors) != len(fresh_indices):
            raise ValueError('Embedding backend returned an incomplete batch.')
        generated = {i: Vector(validate_vector(v, self.dimensions)) for i, v in zip(fresh_indices, fresh_vectors)}
        vectors = [generated[i] if i in generated else Vector(validate_vector(list(row[5]['embedding']), self.dimensions))
                   for i, row in enumerate(pending)]
        @firestore.transactional
        def commit(transaction):
            # Read every source/index first: Firestore forbids reads after writes.
            for identity, _, _, markers, _, previous in pending:
                if self._read(collection, identity, transaction) != previous or not self._fresh(kind, identity, markers, transaction):
                    raise RevisionConflict('Source changed or was removed while embedding.')
            for row, vector in zip(pending, vectors):
                identity, payload, revision, markers, metadata, _ = row
                transaction.set(self._ref(collection, identity), {**self.contract, **metadata, 'identity': identity, 'payload': payload,
                    'source_hash': revision, 'source_markers': markers, 'embedding': vector, 'deleted': False})
        commit(self.db.transaction())
        return ids

    def delete_candidate(self, identity, *, expected_source_hash):
        validate_id(identity)
        @firestore.transactional
        def remove(transaction):
            row = self._read(self.candidates, identity, transaction)
            current = None if row.get('deleted') else row.get('source_hash')
            if current is None:
                if expected_source_hash is not None and row.get('removed_source_hash') != expected_source_hash:
                    raise RevisionConflict('Expected candidate revision is missing.')
            elif not expected_source_hash or current != expected_source_hash:
                raise RevisionConflict('Refusing stale deletion.')
            transaction.set(self._ref(self.candidates, identity), {**self.contract, 'identity': identity, 'deleted': True,
                'removed_source_hash': current or row.get('removed_source_hash'), 'removal_epoch': uuid.uuid4().hex})
            return current is not None
        return remove(self.db.transaction())

    def _filter(self, where):
        if not isinstance(where, dict) or not where:
            raise ValueError('Invalid metadata filter.')
        filters = []
        operators = {'$eq':'==', '$ne':'!=', '$gte':'>=', '$lte':'<=', '$gt':'>', '$lt':'<', '$in':'in', '$nin':'not-in'}
        allowed = {'city','seniority_level','birth_year','has_birth_year','event_type','remote','location'}
        for field, value in where.items():
            if field in ('$and', '$or'):
                if not isinstance(value, list) or len(value) < 2:
                    raise ValueError('Invalid compound metadata filter.')
                filters.append((And if field == '$and' else Or)([self._filter(item) for item in value]))
            elif field in allowed:
                if isinstance(value, dict):
                    for op, operand in value.items():
                        if op not in operators:
                            raise ValueError('Unsupported metadata operator.')
                        if op in ('$in', '$nin') and (not isinstance(operand, list) or not 1 <= len(operand) <= 10):
                            raise ValueError('Metadata membership needs 1-10 values.')
                        filters.append(FieldFilter(field, operators[op], operand))
                else:
                    filters.append(FieldFilter(field, '==', value))
            else:
                raise ValueError('Unsupported metadata field.')
        if not filters:
            raise ValueError('Invalid metadata filter.')
        return filters[0] if len(filters) == 1 else And(filters)

    def _query(self, collection, kind, vector, k, where):
        if isinstance(k, bool) or not isinstance(k, int) or not 0 <= k <= 1000:
            raise ValueError('Requested result count must be 0-1000.')
        vector = Vector(validate_vector(vector, self.dimensions))
        if not k:
            return []
        query = collection
        for field, value in {**self.contract, 'deleted': False}.items():
            query = query.where(filter=FieldFilter(field, '==', value))
        if where:
            query = query.where(filter=self._filter(where))
        nearest = query.find_nearest(vector_field='embedding', query_vector=vector, distance_measure=DistanceMeasure.COSINE,
                                     limit=min(1000, max(k, k * 4)), distance_result_field='vector_distance')
        results = []
        for snapshot in nearest.stream():
            row = snapshot.to_dict()
            if self._fresh(kind, row['identity'], row.get('source_markers', {})):
                results.append((row['identity'], round(1.0 - float(row['vector_distance']), 4)))
                if len(results) == k:
                    break
        return results

    def query_candidates(self, vector, k, where=None):
        return self._query(self.candidates, 'candidate', vector, k, where)

    def query_events(self, vector, k, where=None):
        return self._query(self.events, 'event', vector, k, where)


def vector_index_config(dimensions=768, filter_fields=(), collection_group='userEmbeddings'):
    """One Firebase CLI index entry; deploy both collections and each filter shape.

    Example: {"indexes": [vector_index_config(collection_group='userEmbeddings'),
                          vector_index_config(collection_group='eventEmbeddings')]}
    Additional hard filters require extra entries with their fields supplied.
    """
    if isinstance(dimensions, bool) or not isinstance(dimensions, int) or not 1 <= dimensions <= 2048:
        raise ValueError('Invalid vector index dimensions.')
    if collection_group not in ('userEmbeddings', 'eventEmbeddings'):
        raise ValueError('Unsupported vector collection group.')
    allowed = {'city','seniority_level','birth_year','has_birth_year','event_type','remote','location'}
    if isinstance(filter_fields, str) or any(field not in allowed for field in filter_fields):
        raise ValueError('Unsupported vector index filter field.')
    # Firestore's equality-only vector planner requires canonical field order.
    # The birth-year range segment follows all equality segments.
    names = set(['namespace','model','dimensions','recipe','deleted', *filter_fields])
    fields = sorted(names - {'birth_year'}) + (['birth_year'] if 'birth_year' in names else [])
    return {'collectionGroup':collection_group, 'queryScope':'COLLECTION', 'fields':[
        *[{'fieldPath':field,'order':'ASCENDING'} for field in fields],
        {'fieldPath':'embedding','vectorConfig':{'dimension':dimensions,'flat':{}}}]}
