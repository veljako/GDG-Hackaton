"""
Matchmaking pipeline: the public entry points that connect extractors, the DB, and search.

CV flow:    extract_cv_info -> human_in_the_loop_enrichment -> add_user_to_db
            optional: add_user_to_firebase
Event flow: extract_event_info -> add_event_to_db
            optional: add_event_to_firebase
Matching:   find_best_matches

All DB functions use one shared MatchmakingStore. configure_store() picks the persist
directory and embeddings; otherwise the first call builds the default store.
"""

import sys
from pathlib import Path
from typing import List, Optional, Union

from langchain_core.embeddings import Embeddings

sys.path.insert(0, str(Path(__file__).resolve().parent))

from embeddings import build_embeddings  # noqa: E402
from extractors import CvDict, EventDict, extract_cv_info, extract_event_info  # noqa: E402,F401
from search_engine import MatchResult, build_hard_filter  # noqa: E402,F401
from search_engine import find_best_matches as _search  # noqa: E402
from vector_store import MatchmakingStore  # noqa: E402

DEFAULT_PERSIST_DIR = Path(__file__).resolve().parent / "chroma_db"

_store: Optional[MatchmakingStore] = None


def configure_store(
    persist_directory: Optional[str] = str(DEFAULT_PERSIST_DIR),
    embeddings: Optional[Embeddings] = None,
) -> MatchmakingStore:
    """Create the shared store. persist_directory=None keeps everything in memory."""
    global _store
    _store = MatchmakingStore(embeddings or build_embeddings(), persist_directory=persist_directory)
    return _store


def get_store() -> MatchmakingStore:
    return _store or configure_store()


# ============================================================================
# 1. CV processing
# ============================================================================
def human_in_the_loop_enrichment(cv_dict: CvDict) -> CvDict:
    """
    Placeholder for manual review: the user will confirm or edit the extracted CV here.
    Until that UI exists, the extracted dictionary passes through unchanged.
    """
    return cv_dict


def add_user_to_db(cv_dict: CvDict, store: Optional[MatchmakingStore] = None) -> str:
    """Embed the candidate narrative and upsert the candidate with its metadata. Returns candidate_id."""
    return (store or get_store()).upsert_candidate(cv_dict)


def add_user_to_firebase(cv_dict: CvDict) -> str:
    """Write the extracted user profile to Firestore (gdevPilots/main/users). Returns the document id."""
    from firebase_store import upsert_user

    return upsert_user(cv_dict)


def process_cv(file_path: str, store: Optional[MatchmakingStore] = None) -> str:
    """Run one CV file through extraction, enrichment, and storage."""
    return add_user_to_db(human_in_the_loop_enrichment(extract_cv_info(file_path)), store)


# ============================================================================
# 2. Event processing
# ============================================================================
def add_event_to_db(event_dict: EventDict, store: Optional[MatchmakingStore] = None) -> str:
    """Embed the event as its ideal-candidate narrative and upsert it. Returns event_id."""
    return (store or get_store()).upsert_event(event_dict)


def add_event_to_firebase(event_dict: EventDict) -> str:
    """Write the extracted event to Firestore (gdevPilots/main/events). Returns the document id."""
    from firebase_store import upsert_event

    return upsert_event(event_dict)


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
