"""
Search engine: hybrid matchmaking of candidates to an event.

1. Hard metadata pre-filter for explicit birth-year and seniority constraints,
   followed by complete required-skill/status/age eligibility checks.
2. Cosine similarity between the event's "ideal candidate" embedding and the
   embeddings of the candidates that passed the filter.

Explicit eligibility constraints require known, matching metadata.
"""

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractors import EventDict  # noqa: E402
from contracts import validate_event_constraints, normalize_event_constraints
from matching_eligibility import candidate_eligible
from vector_store import UNKNOWN, MatchmakingStore, event_narrative, seniority_key  # noqa: E402


@dataclass
class MatchResult:
    candidate_id: str
    similarity: float


def _combine(conditions: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    # Chroma requires at least two conditions inside $and.
    if not conditions:
        return None
    if len(conditions) == 1:
        return conditions[0]
    return {"$and": conditions}


def build_hard_filter(event: EventDict) -> Optional[Dict[str, Any]]:
    """Chroma `where` clause for the event's hard constraints, or None when there are none."""
    validate_event_constraints(event)
    conditions: List[Dict[str, Any]] = []

    event = normalize_event_constraints(event)
    if event.get('min_birth_year') is not None:
        conditions.append({'birth_year': {'$gte': event['min_birth_year']}})
    if event.get('max_birth_year') is not None:
        conditions.append({'birth_year': {'$lte': event['max_birth_year']}})
    seniorities = event.get('seniorities') or []
    if not seniorities and event.get('seniority'):
        seniorities = [event['seniority']]
    if seniorities:
        levels = [seniority_key(value) for value in seniorities]
        if UNKNOWN in levels:
            raise ValueError('Unrecognized explicit seniority constraint.')
        conditions.append({'seniority_level': {'$in': levels}} if len(levels) > 1 else {'seniority_level':levels[0]})

    return _combine(conditions)


def find_best_matches(
    store: MatchmakingStore,
    event_id_or_dict: Union[str, EventDict],
    top_n: int = 5,
    apply_hard_filters: bool = True,
) -> List[MatchResult]:
    """
    Top-n candidates for an event, best first.

    A string is looked up as a stored event id and reuses its stored embedding;
    a dict is embedded on the fly.
    """
    if isinstance(top_n, bool) or not isinstance(top_n, int) or not 0 <= top_n <= 1000:
        raise ValueError("top_n must be between 0 and 1000.")
    if top_n == 0:
        return []
    if isinstance(event_id_or_dict, str):
        stored = store.get_event(event_id_or_dict)
        if stored is None:
            raise KeyError(f"No event with id '{event_id_or_dict}'.")
        event, vector = stored
        if hasattr(store, 'event_query_vector'):
            vector = store.event_query_vector(event_id_or_dict)
    else:
        event = event_id_or_dict
        validate_event_constraints(event)
        where = build_hard_filter(event) if apply_hard_filters else None
        vector = store.embeddings.embed_query(event_narrative(event))

    where = build_hard_filter(event) if apply_hard_filters else None
    return [
        MatchResult(candidate_id=candidate_id, similarity=similarity)
        for candidate_id, similarity in store.query_candidates(vector, k=1000 if apply_hard_filters else top_n, where=where)
        if not apply_hard_filters or candidate_eligible(store.get_candidate(candidate_id) or {}, event)
    ][:top_n]
