"""
Search engine: hybrid matchmaking of candidates to an event.

1. Hard metadata pre-filter built from the event (age range, seniority, and city
   when the event is not remote).
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
from contracts import validate_event_constraints
from vector_store import UNKNOWN, MatchmakingStore, city_key, event_narrative, seniority_key  # noqa: E402


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

    younger = event.get("min_birth_year")  # minimum age -> latest birth year
    older = event.get("max_birth_year")    # maximum age -> earliest birth year
    if younger is not None and older is not None:
        older, younger = sorted((older, younger))
    if older is not None:
        conditions.append({"birth_year": {"$gte": int(older)}})
    if younger is not None:
        conditions.append({"birth_year": {"$lte": int(younger)}})

    if event.get("seniority"):
        level = seniority_key(event["seniority"])
        if level == UNKNOWN:
            raise ValueError("Unrecognized explicit seniority constraint.")
        conditions.append({"seniority_level": level})

    if not event.get("remote") and event.get("location"):
        city = city_key(event["location"])
        if city != UNKNOWN:
            conditions.append({"city": city})

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
        for candidate_id, similarity in store.query_candidates(vector, k=top_n, where=where)
    ]
