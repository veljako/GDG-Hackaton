"""
Search engine: hybrid matchmaking of candidates to an event.

1. Hard metadata pre-filter built from the event (age range, seniority, and city
   when the event is not remote).
2. Cosine similarity between the event's "ideal candidate" embedding and the
   embeddings of the candidates that passed the filter.

A hard filter excludes only candidates known to violate it. A CV with no birth year,
seniority, or location cannot be checked, so it stays in and is ranked by similarity.
"""

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractors import EventDict  # noqa: E402
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
    conditions: List[Dict[str, Any]] = []

    years = [y for y in (event.get("min_birth_year"), event.get("max_birth_year")) if y is not None]
    if years:
        # The two fields may arrive in either numeric order, so use the real bounds.
        oldest, youngest = min(years), max(years)
        in_range = _combine([
            {"birth_year": {"$gte": int(oldest)}},
            {"birth_year": {"$lte": int(youngest)}},
        ])
        conditions.append({"$or": [{"has_birth_year": False}, in_range]})

    if event.get("seniority"):
        conditions.append({"seniority_level": {"$in": [seniority_key(event["seniority"]), UNKNOWN]}})

    if not event.get("remote") and event.get("location"):
        city = city_key(event["location"])
        if city != UNKNOWN:
            conditions.append({"city": {"$in": [city, UNKNOWN]}})

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
    if isinstance(event_id_or_dict, str):
        stored = store.get_event(event_id_or_dict)
        if stored is None:
            raise KeyError(f"No event with id '{event_id_or_dict}'.")
        event, vector = stored
    else:
        event = event_id_or_dict
        vector = store.embeddings.embed_query(event_narrative(event))

    where = build_hard_filter(event) if apply_hard_filters else None
    return [
        MatchResult(candidate_id=candidate_id, similarity=similarity)
        for candidate_id, similarity in store.query_candidates(vector, k=top_n, where=where)
    ]
