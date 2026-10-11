"""Compatibility adapter for Serbian records and the canonical matchmaking pipeline.

Legacy public profile/match classes remain available. Storage, narratives,
eligibility and ranking use the same implementation as the extraction pipeline.
Embeddings must be selected explicitly and declare stable model/dimension data.
"""

import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from langchain_core.embeddings import Embeddings

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contracts import validate_id
from embeddings import GemmaServerEmbeddings, build_embeddings  # compatibility exports
from extractors import normalize_cv_dict
from search_engine import build_hard_filter, find_best_matches
from vector_store import UNKNOWN, MatchmakingStore, candidate_narrative, event_narrative, seniority_key

DEFAULT_COLLECTION = "candidates"
MISSING = "nije navedeno"


def normalize_key(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return " ".join(str(value).split()).casefold() or None


def _record(data):
    if not isinstance(data, dict):
        raise ValueError("Profile input must be a dictionary")
    return data


def _pick(data, canonical, legacy, default=None):
    return data[canonical] if canonical in data else data.get(legacy, default)


def _list(value):
    if value is None:
        return []
    if not isinstance(value, (list, tuple)) or any(not isinstance(item, str) for item in value):
        raise ValueError("Profile list fields must contain strings")
    return list(value)


def _age(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= date.today().year - 1900:
        raise ValueError("Age must be an integer within the supported birth-year range")
    return value


def _birth_year(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1900 <= value <= date.today().year:
        raise ValueError("Birth year must be between 1900 and the current year")
    return value


def _year_bound(data, canonical, legacy):
    age = _age(data.get(legacy))
    if canonical in data:
        year = _birth_year(data[canonical])
        if age is not None and year != date.today().year - age:
            raise ValueError("Age and birth-year fields disagree")
        return year
    return date.today().year - age if age is not None else None


def _level(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Seniority must be a string")
    bucket = seniority_key(value)
    # Preserve unknown explicit levels so the canonical strict filter rejects them.
    return bucket if bucket != UNKNOWN else normalize_key(value)


def _remote(data):
    value = _pick(data, "remote", "is_remote", False)
    if not isinstance(value, bool):
        raise ValueError("remote/is_remote must be an actual boolean")
    if "remote" in data and "is_remote" in data and data["is_remote"] is not value:
        raise ValueError("Remote fields disagree")
    return value


@dataclass
class EventProfile:
    tip_eventa: Optional[str]
    kratak_opis: Optional[str]
    potrebni_skillovi: List[str]
    lokacija: Optional[str]
    is_remote: bool
    senioritet: Optional[str]
    min_godine: Optional[int]
    max_godine: Optional[int]
    _original: Dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EventProfile":
        _record(data)
        younger = _year_bound(data, "min_birth_year", "min_godine")
        older = _year_bound(data, "max_birth_year", "max_godine")
        return cls(
            tip_eventa=_pick(data, "event_type", "tip_eventa"),
            kratak_opis=_pick(data, "short_description", "kratak_opis"),
            potrebni_skillovi=_list(_pick(data, "skills", "potrebni_skillovi")),
            lokacija=_pick(data, "location", "lokacija"), is_remote=_remote(data),
            senioritet=_level(_pick(data, "seniority", "senioritet")),
            min_godine=date.today().year - younger if younger is not None else None,
            max_godine=date.today().year - older if older is not None else None,
            _original=dict(data),
        )

    def to_event_dict(self) -> Dict[str, Any]:
        if not isinstance(self.is_remote, bool):
            raise ValueError("is_remote must be an actual boolean")
        min_age, max_age = _age(self.min_godine), _age(self.max_godine)
        adapted = dict(self._original)
        adapted.update(event_type=self.tip_eventa, short_description=self.kratak_opis,
            skills=_list(self.potrebni_skillovi), location=self.lokacija,
            remote=self.is_remote, seniority=_level(self.senioritet),
            min_birth_year=_birth_year(self._original["min_birth_year"]) if "min_birth_year" in self._original else date.today().year - min_age if min_age is not None else None,
            max_birth_year=_birth_year(self._original["max_birth_year"]) if "max_birth_year" in self._original else date.today().year - max_age if max_age is not None else None)
        return adapted


@dataclass
class CandidateProfile:
    id_kandidata: str
    detaljan_opis: Optional[str]
    lokacija: Optional[str]
    jezik: List[str]
    senioritet: Optional[str]
    zaposlen: Optional[bool]
    skillovi: List[str]
    prosli_hackathoni: List[str]
    godine: Optional[int]
    _original: Dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CandidateProfile":
        _record(data)
        identity = validate_id(_pick(data, "candidate_id", "id_kandidata"))
        if "candidate_id" in data and "id_kandidata" in data and data["id_kandidata"] != identity:
            raise ValueError("Candidate identity fields disagree")
        year = _year_bound(data, "birth_year", "godine")
        employed = data.get("zaposlen")
        if employed is not None and not isinstance(employed, bool):
            raise ValueError("zaposlen must be a boolean or null")
        if "status" in data:
            employed = True if normalize_key(data["status"]) == "employed" else None
        return cls(identity, _pick(data, "general_description", "detaljan_opis"),
            _pick(data, "location", "lokacija"), _list(_pick(data, "languages", "jezik")),
            _level(_pick(data, "experience_level", "senioritet")), employed,
            _list(_pick(data, "skills", "skillovi")), _list(data.get("prosli_hackathoni")),
            date.today().year - year if year is not None else None, dict(data))

    def to_cv_dict(self) -> Dict[str, Any]:
        identity = validate_id(self.id_kandidata)
        age = _age(self.godine)
        adapted = dict(self._original)
        adapted.update(candidate_id=identity, general_description=self.detaljan_opis,
            location=self.lokacija, experience_level=_level(self.senioritet), skills=_list(self.skillovi),
            birth_year=_birth_year(self._original["birth_year"]) if "birth_year" in self._original else date.today().year - age if age is not None else None)
        if "status" not in adapted and self.zaposlen is True:
            adapted["status"] = "employed"
        normalized = normalize_cv_dict(adapted, identity, adapted.get("source") or "")
        # These private values participate only in the canonical source revision.
        for key in ("storage_path", "cv_document"):
            if key in adapted:
                normalized[key] = adapted[key]
        return normalized


@dataclass
class CandidateMatch:
    id_kandidata: str
    similarity: float
    metadata: Dict[str, Any] = field(default_factory=dict)
    narrative: str = ""


def _candidate(cv):
    return cv.to_cv_dict() if isinstance(cv, CandidateProfile) else CandidateProfile.from_dict(cv).to_cv_dict()


def _event(event):
    return event.to_event_dict() if isinstance(event, EventProfile) else EventProfile.from_dict(event).to_event_dict()


class NarrativeBuilder:
    @staticmethod
    def event_narrative(event: EventProfile) -> str:
        return event_narrative(_event(event))

    @staticmethod
    def cv_narrative(cv: CandidateProfile) -> str:
        return candidate_narrative(_candidate(cv))


class CandidateVectorStore:
    def __init__(self, embeddings: Embeddings, collection_name: str = DEFAULT_COLLECTION,
                 persist_directory: Optional[str] = None) -> None:
        self.embeddings = embeddings
        self.store = MatchmakingStore(embeddings, persist_directory=persist_directory, namespace=collection_name)

    @staticmethod
    def _metadata(cv: CandidateProfile) -> Dict[str, Any]:
        payload, source_hash = MatchmakingStore._prepare(_candidate(cv))
        return MatchmakingStore.candidate_metadata(payload, source_hash)

    def add_candidates(self, cvs: Sequence[CandidateProfile], *, expected_source_hashes: Optional[Dict[str, str]] = None) -> List[str]:
        return self.store.upsert_candidates([_candidate(cv) for cv in cvs], expected_source_hashes=expected_source_hashes)

    def _matches(self, ranked) -> List[CandidateMatch]:
        if not ranked:
            return []
        if hasattr(self.store, 'get_candidate'):
            matches = []
            for identity, similarity in ranked:
                payload = self.store.get_candidate(identity)
                if payload is not None:
                    metadata = MatchmakingStore.candidate_metadata(payload, self.store.candidate_source_hash(identity))
                    matches.append(CandidateMatch(identity, similarity, metadata, candidate_narrative(payload)))
            return matches
        # Only fetch the bounded top-k results, never materialize the population.
        saved = self.store.candidates.get(ids=[identity for identity, _ in ranked], include=["metadatas", "documents"])
        payloads = {identity: (metadata, narrative) for identity, metadata, narrative in zip(saved["ids"], saved["metadatas"], saved["documents"])}
        return [CandidateMatch(identity, similarity, dict(payloads[identity][0]), payloads[identity][1])
                for identity, similarity in ranked if identity in payloads]

    def search_by_vector(self, query_vector: List[float], k: int,
                         metadata_filter: Optional[Dict[str, Any]]) -> List[CandidateMatch]:
        return self._matches(self.store.query_candidates(query_vector, k, where=metadata_filter))


class HardConstraintFilter:
    @staticmethod
    def build(event: EventProfile) -> Optional[Dict[str, Any]]:
        return build_hard_filter(_event(event))


class CandidateMatcher:
    def __init__(self, vector_store: CandidateVectorStore) -> None:
        self.vector_store = vector_store

    def add_cvs(self, cv_jsons: Sequence[Dict[str, Any]], *, expected_source_hashes: Optional[Dict[str, str]] = None) -> List[str]:
        return self.vector_store.add_candidates(cv_jsons, expected_source_hashes=expected_source_hashes)

    def find_best_candidates(self, event_json: Dict[str, Any], top_k: int = 5) -> List[CandidateMatch]:
        ranked = find_best_matches(self.vector_store.store, _event(event_json), top_n=top_k)
        return self.vector_store._matches([(match.candidate_id, match.similarity) for match in ranked])
