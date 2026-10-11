"""
Matchmaking pipeline: the public entry points that connect extractors, the DB, and search.

CV flow:    extract_cv_info -> private proposal -> add_user_to_db
            optional: add_user_to_firebase with trusted UID/attachment revision
Confirmation requires explicit fields and saved profile/proposal revisions.
Event flow: extract_event_info -> add_event_to_db
            optional: add_event_to_firebase
Matching:   find_best_matches

All DB functions use one shared MatchmakingStore. configure_store() picks the persist
directory and embeddings; otherwise the first call builds the default store.
"""

import sys
from pathlib import Path
from dataclasses import dataclass
from itertools import islice
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Tuple, Union

from langchain_core.embeddings import Embeddings

sys.path.insert(0, str(Path(__file__).resolve().parent))

from embeddings import EmbeddingServiceError, build_embeddings  # noqa: E402
from contracts import RevisionConflict, validate_id
from extractors import CvDict, EventDict, extract_cv_info, extract_event_info  # noqa: E402,F401
from search_engine import MatchResult, build_hard_filter  # noqa: E402,F401
from search_engine import find_best_matches as _search  # noqa: E402
from vector_store import MatchmakingStore  # noqa: E402

DEFAULT_PERSIST_DIR = Path(__file__).resolve().parent / "chroma_db"

_store: Optional[MatchmakingStore] = None


def configure_store(
    persist_directory: Optional[str] = str(DEFAULT_PERSIST_DIR),
    embeddings: Optional[Embeddings] = None,
    *, backend: Optional[str] = None,
    namespace: str = "matchmaking",
    storage_backend: Optional[str] = None,
    db=None,
    workspace: str = "gdevPilots/main",
) -> MatchmakingStore:
    """Create the shared store. persist_directory=None keeps everything in memory."""
    global _store
    selected = storage_backend or ('chroma' if backend == 'local' or persist_directory is None else 'firestore')
    encoder = embeddings or build_embeddings(backend)
    if selected == 'firestore':
        from firestore_vector_store import FirestoreMatchmakingStore
        _store = FirestoreMatchmakingStore(encoder, db=db, workspace=workspace, namespace=namespace)
    elif selected == 'chroma':
        _store = MatchmakingStore(encoder, persist_directory=persist_directory, namespace=namespace)
    else:
        raise ValueError('storage_backend must be firestore or chroma.')
    return _store


def get_store() -> MatchmakingStore:
    return _store or configure_store()


# ============================================================================
# 1. CV processing
# ============================================================================
def human_in_the_loop_enrichment(cv_dict: CvDict) -> CvDict:
    """
    Compatibility hook returning an unconfirmed proposal. This is not approval.
    Canonical profile confirmation is an explicit, version-checked Firebase call.
    """
    return dict(cv_dict)


def add_user_to_db(cv_dict: CvDict, store: Optional[MatchmakingStore] = None,
                   *, expected_source_hash: Optional[str] = None) -> str:
    """Embed the candidate narrative and upsert the candidate with its metadata. Returns candidate_id."""
    return (store or get_store()).upsert_candidate(cv_dict, expected_source_hash=expected_source_hash)


def add_user_to_firebase(cv_dict: CvDict, *, user_id: str, expected_storage_path: str,
                         confirmed_fields: Optional[Sequence[str]] = None) -> str:
    """Save a private proposal; explicit review fields require profile/proposal tokens."""
    from firebase_store import upsert_user

    return upsert_user(cv_dict, user_id=user_id, expected_storage_path=expected_storage_path,
                       confirmed_fields=confirmed_fields)


def process_cv(file_path: str, store: Optional[MatchmakingStore] = None, *,
               candidate_id: Optional[str] = None, expected_source_hash: Optional[str] = None) -> str:
    """Index one extraction. Account callers provide their trusted UID and index token."""
    cv = extract_cv_info(file_path, candidate_id=candidate_id)
    return add_user_to_db(cv, store, expected_source_hash=expected_source_hash)


@dataclass(frozen=True)
class IngestionResult:
    candidate_id: str
    status: str
    error: Optional[str] = None


def ingest_records(records: Iterable[Tuple[str, Optional[CvDict], Optional[str]]],
                   store: Optional[MatchmakingStore] = None, *, batch_size: int = 32,
                   expected_source_hashes: Optional[Dict[str, str]] = None,
                   firebase_bindings: Optional[Dict[str, Dict[str, str]]] = None) -> Iterator[IngestionResult]:
    """Bounded embedding batches, per-record recovery and sanitized failure results.

    Optional private Firebase proposals are saved before indexing. A cloud failure
    prevents that record's vector write; an index failure leaves a retryable private
    proposal. No public profile is automatically confirmed.
    """
    if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 256:
        raise ValueError("batch_size must be between 1 and 256.")
    records = iter(records)
    tokens = expected_source_hashes or {}
    shared_failure = None
    while True:
        chunk = list(islice(records, batch_size))
        if not chunk:
            return
        results = [None] * len(chunk)
        pending = []
        seen = set()
        for index, (identity, cv, error) in enumerate(chunk):
            if cv is None or error:
                results[index] = IngestionResult(identity, "failed", "extraction_failed")
                continue
            try:
                validate_id(identity)
                if cv.get("candidate_id") != identity or identity in seen:
                    raise ValueError("Duplicate or inconsistent record identity.")
                seen.add(identity)
            except ValueError:
                results[index] = IngestionResult(identity, "failed", "identity_invalid")
                continue
            if firebase_bindings is not None:
                try:
                    binding = firebase_bindings[identity]
                    add_user_to_firebase(cv, user_id=binding["user_id"],
                                         expected_storage_path=binding["expected_storage_path"])
                    cv = dict(cv, storage_path=binding["expected_storage_path"])
                except Exception:
                    results[index] = IngestionResult(identity, "failed", "private_proposal_failed")
                    continue
            pending.append((index, identity, cv))
        if pending:
            if shared_failure:
                for index, identity, _ in pending:
                    results[index] = IngestionResult(identity, "failed", shared_failure)
                yield from results
                continue
            try:
                db = store or get_store()
            except Exception:
                shared_failure = "index_startup_failed"
                for index, identity, _ in pending:
                    results[index] = IngestionResult(identity, "failed", "index_startup_failed")
                yield from results
                continue
            try:
                db.upsert_candidates([cv for _, _, cv in pending], expected_source_hashes=tokens)
            except EmbeddingServiceError:
                shared_failure = "embedding_service_failed"
                for index, identity, _ in pending:
                    results[index] = IngestionResult(identity, "failed", "embedding_service_failed")
            except RevisionConflict:
                for index, identity, _ in pending:
                    results[index] = IngestionResult(identity, "failed", "index_revision_conflict")
            except Exception:
                # A bad record or one failed embedding must not stop later records.
                for index, identity, cv in pending:
                    try:
                        db.upsert_candidate(cv, expected_source_hash=tokens.get(identity))
                    except Exception:
                        results[index] = IngestionResult(identity, "failed", "index_write_failed")
                    else:
                        results[index] = IngestionResult(identity, "indexed")
            else:
                for index, identity, _ in pending:
                    results[index] = IngestionResult(identity, "indexed")
        yield from results


# ============================================================================
# 2. Event processing
# ============================================================================
def add_event_to_db(event_dict: EventDict, store: Optional[MatchmakingStore] = None,
                    *, expected_source_hash: Optional[str] = None) -> str:
    """Embed the event as its ideal-candidate narrative and upsert it. Returns event_id."""
    return (store or get_store()).upsert_event(event_dict, expected_source_hash=expected_source_hash)


def add_event_to_firebase(event_dict: EventDict, *, expected_updated_at: Optional[str] = None) -> str:
    """Write the extracted event to Firestore (gdevPilots/main/events). Returns the document id."""
    from firebase_store import upsert_event

    return upsert_event(event_dict, expected_updated_at=expected_updated_at)


# ============================================================================
# 3. Matchmaking
# ============================================================================
def find_best_matches(
    event_id_or_dict: Union[str, EventDict],
    top_n: int = 5,
    store: Optional[MatchmakingStore] = None,
    apply_hard_filters: bool = True,
) -> List[MatchResult]:
    """Hard metadata filter, then cosine similarity. Returns candidate ids with scores, best first."""
    return _search(store or get_store(), event_id_or_dict, top_n=top_n, apply_hard_filters=apply_hard_filters)
