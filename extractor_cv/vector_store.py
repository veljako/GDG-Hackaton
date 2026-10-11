"""Private, versioned Chroma indexes with a persisted embedding contract."""
import hashlib
import json
import sys
import threading
import uuid
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from filelock import FileLock
from langchain_core.embeddings import Embeddings

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contracts import RevisionConflict, canonical_city, validate_id, validate_event_constraints, normalize_event_constraints
from embeddings import embedding_model_id, validate_vector
from event_candidate_finder import seniority_bucket
from extractors import CvDict, EventDict, normalize_cv_dict

UNKNOWN = "unknown"
RECIPE = "matching-narrative-v3"
_MATCHING_FIELDS = ("candidate_id", "current_role", "education", "skills", "general_description",
                    "location", "status", "birth_year", "experience_level", "learning_skills",
                    "interests", "roles", "preferences", "country", "birth_date")
_EVENT_FIELDS = ("name", "event_type", "short_description", "location", "remote", "seniority",
                 "skills", "criteria_version", "format", "topics", "taught_skills", "required_skills",
                 "goals", "roles", "levels", "seniorities", "statuses", "min_age", "max_age",
                 "min_birth_year", "max_birth_year", "country", "languages", "price",
                 "date", "end_date", "deadline", "status")


def city_key(location: Optional[str]) -> str:
    return canonical_city(location)


def seniority_key(level: Optional[str]) -> str:
    return seniority_bucket(level) or UNKNOWN


def _sentence(text: str) -> str:
    return text if text.endswith((".", "!", "?")) else f"{text}."


def candidate_narrative(cv: CvDict) -> str:
    parts = []
    if cv.get("current_role"):
        parts.append(f"Current role: {cv['current_role']}.")
    elif cv.get("experience_level"):
        parts.append(f"{cv['experience_level']} professional.")
    schools = [item["institution"] for item in cv.get("education") or [] if item.get("institution")]
    if schools:
        parts.append(f"Education: {', '.join(schools)}.")
    if cv.get("skills"):
        parts.append(f"Skills: {', '.join(cv['skills'])}.")
    for field, label in (("learning_skills", "Wants to learn"), ("interests", "Interests"), ("roles", "Preferred roles")):
        if cv.get(field):
            parts.append(f"{label}: {', '.join(cv[field])}.")
    preferences = cv.get("preferences") or {}
    for field in ("goals", "kinds", "formats", "level"):
        value = preferences.get(field)
        if value:
            parts.append(f"Preferred {field}: {', '.join(value) if isinstance(value, list) else value}.")
    if cv.get("status"):
        parts.append(f"Current status: {cv['status']}.")
    if cv.get("general_description"):
        parts.append(f"Profile: {_sentence(cv['general_description'])}")
    if not parts:
        raise ValueError("Candidate has no usable matching details.")
    return " ".join(parts)


def event_narrative(event: EventDict) -> str:
    parts = []
    if event.get("seniority"):
        parts.append(f"Relevant seniority: {event['seniority']}.")
    if event.get("skills"):
        parts.append(f"Participants practice and use {', '.join(event['skills'])}.")
    for field, label in (("taught_skills", "Participants learn"), ("topics", "Topics"), ("goals", "Participant goals"), ("roles", "Relevant roles"), ("levels", "Relevant levels")):
        if event.get(field):
            parts.append(f"{label}: {', '.join(event[field])}.")
    for field, label in (("format", "Format"), ("country", "Country"), ("languages", "Languages")):
        value = event.get(field)
        if value:
            parts.append(f"{label}: {', '.join(value) if isinstance(value, list) else value}.")
    price = event.get("price")
    if isinstance(price, dict) and price.get("amount") is not None and price.get("currency"):
        parts.append(f"Price: {price['amount']} {price['currency']}.")
    if event.get("name"):
        parts.append(f"They will take part in the {event.get('event_type') or 'event'} {event['name']}.")
    if event.get("short_description"):
        parts.append(f"Event summary: {_sentence(event['short_description'])}")
    if not parts:
        raise ValueError("Event has no usable matching details.")
    return " ".join(parts)


def _hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def event_id_for(event: EventDict) -> str:
    return "event-" + _hash({k: v for k, v in event.items() if k != "event_id"})


class MatchmakingStore:
    def __init__(self, embeddings: Embeddings, persist_directory: Optional[str] = None,
                 namespace: str = "matchmaking") -> None:
        import chromadb
        from chromadb.config import Settings
        validate_id(namespace)
        self.embeddings = embeddings
        dimensions = getattr(embeddings, "dimensions", None)
        if isinstance(dimensions, bool) or not isinstance(dimensions, int) or dimensions <= 0:
            raise ValueError("Embedding backend must declare fixed dimensions.")
        self.dimensions = dimensions
        contract = {"model": embedding_model_id(embeddings), "dimensions": dimensions, "recipe": RECIPE}
        self._mutex = threading.RLock()
        self._file_lock = nullcontext()
        self._removals = {}
        self._removal_directory = None
        if persist_directory:
            directory = Path(persist_directory).resolve()
            directory.mkdir(parents=True, exist_ok=True)
            self._file_lock = FileLock(str(directory / f"{namespace}.lock"), timeout=30)
            self._removal_directory = directory / f"{namespace}.removals"
            self._removal_directory.mkdir(exist_ok=True)
            manifest = directory / f"{namespace}.index.json"
            with self._file_lock:
                client = chromadb.PersistentClient(path=str(directory), settings=Settings(anonymized_telemetry=False))
                if manifest.exists():
                    if json.loads(manifest.read_text(encoding="utf-8")) != contract:
                        raise ValueError("Index model or narrative changed. Rebuild in a new directory before switching.")
                else:
                    if any(collection.name.startswith(f"{namespace}_") for collection in client.list_collections()):
                        raise ValueError("Legacy index has no model contract. Rebuild in a new directory.")
                    temporary = manifest.with_suffix(".tmp")
                    temporary.write_text(json.dumps(contract, sort_keys=True), encoding="utf-8")
                    temporary.replace(manifest)
            prefix = namespace
        else:
            client = chromadb.EphemeralClient(settings=Settings(anonymized_telemetry=False))
            prefix = f"{namespace}_{uuid.uuid4().hex}"
        suffix = _hash(contract)[:24]
        self.candidates = client.get_or_create_collection(f"{prefix}_candidates_{suffix}",
            metadata={"hnsw:space": "cosine"}, embedding_function=None)
        self.events = client.get_or_create_collection(f"{prefix}_events_{suffix}",
            metadata={"hnsw:space": "cosine"}, embedding_function=None)

    @staticmethod
    def _prepare(cv: CvDict) -> Tuple[Dict[str, Any], str]:
        identity = validate_id(cv.get("candidate_id"))
        normalized = normalize_cv_dict(cv, identity, "")
        payload = {key: normalized.get(key) for key in _MATCHING_FIELDS}
        # Provenance and raw text affect the revision but are never persisted in Chroma.
        revision = {"payload": payload, "cv_text": cv.get("cv_text"),
                    "storage_path": cv.get("storage_path") or (cv.get("cv_document") or {}).get("storage_path"),
                    "cv_filename": cv.get("cv_filename")}
        return payload, _hash(revision)

    @staticmethod
    def candidate_metadata(cv: CvDict, source_hash: str) -> Dict[str, Any]:
        metadata = {"candidate_id": cv["candidate_id"], "city": city_key(cv.get("location")),
                    "seniority_level": seniority_key(cv.get("experience_level")),
                    "has_birth_year": cv.get("birth_year") is not None, "source_hash": source_hash,
                    "payload": json.dumps(cv, ensure_ascii=False, allow_nan=False)}
        if cv.get("birth_year") is not None:
            metadata["birth_year"] = cv["birth_year"]
        return metadata

    def candidate_source_hash(self, candidate_id: str) -> Optional[str]:
        result = self.candidates.get(ids=[validate_id(candidate_id)], include=["metadatas"])
        return result["metadatas"][0]["source_hash"] if result["ids"] else None

    def _removal(self, identity):
        if self._removal_directory is None:
            return self._removals.get(identity, {})
        marker = self._removal_directory / _hash(identity)
        return json.loads(marker.read_text(encoding="utf-8")) if marker.exists() else {}

    def _mark_removed(self, identity, source_hash):
        marker = {"epoch": uuid.uuid4().hex, "source_hash": source_hash}
        if self._removal_directory is None:
            self._removals[identity] = marker
        else:
            target = self._removal_directory / _hash(identity)
            temporary = target.with_suffix(".tmp")
            temporary.write_text(json.dumps(marker), encoding="utf-8")
            temporary.replace(target)

    def upsert_candidate(self, cv: CvDict, *, expected_source_hash: Optional[str] = None) -> str:
        return self.upsert_candidates([cv], expected_source_hashes={cv["candidate_id"]: expected_source_hash})[0]

    def upsert_candidates(self, cvs: List[CvDict], *, expected_source_hashes: Optional[Dict[str, str]] = None) -> List[str]:
        if len(cvs) > 256:
            raise ValueError("Index write batch exceeds 256 candidates.")
        prepared = [self._prepare(cv) for cv in cvs]
        ids = [payload["candidate_id"] for payload, _ in prepared]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate candidate IDs in one batch.")
        tokens = expected_source_hashes or {}
        pending = []
        with self._mutex, self._file_lock:
            for payload, revision in prepared:
                identity = payload["candidate_id"]
                current = self.candidate_source_hash(identity)
                if tokens.get(identity) is not None and tokens[identity] != current:
                    raise RevisionConflict("Candidate revision changed; reload before retrying.")
                if current == revision:
                    continue
                if current is not None and tokens.get(identity) != current:
                    raise RevisionConflict("Replacing a candidate requires its current source hash.")
                pending.append((payload, revision, current, self._removal(identity).get("epoch")))
        # All external work succeeds before any record changes. Failed writes preserve previous data.
        narratives = [candidate_narrative(payload) for payload, _, _, _ in pending]
        if not pending:
            return ids
        vectors = self.embeddings.embed_documents(narratives)
        if len(vectors) != len(pending):
            raise ValueError("Embedding backend returned an incomplete batch.")
        vectors = [validate_vector(vector, self.dimensions) for vector in vectors]
        with self._mutex, self._file_lock:
            for payload, _, previous, epoch in pending:
                identity = payload["candidate_id"]
                if self.candidate_source_hash(identity) != previous or self._removal(identity).get("epoch") != epoch:
                    raise RevisionConflict("Candidate changed or was removed while embedding; reload before retrying.")
            self.candidates.upsert(ids=[payload["candidate_id"] for payload, _, _, _ in pending],
                embeddings=vectors, documents=narratives,
                metadatas=[self.candidate_metadata(payload, revision) for payload, revision, _, _ in pending])
        return ids

    def get_candidate(self, candidate_id: str) -> Optional[CvDict]:
        result = self.candidates.get(ids=[validate_id(candidate_id)], include=["metadatas"])
        return json.loads(result["metadatas"][0]["payload"]) if result["ids"] else None

    def delete_candidate(self, candidate_id: str, *, expected_source_hash: Optional[str]) -> bool:
        candidate_id = validate_id(candidate_id)
        with self._mutex, self._file_lock:
            current = self.candidate_source_hash(candidate_id)
            if current is None:
                marker = self._removal(candidate_id)
                if expected_source_hash is not None and marker.get("source_hash") != expected_source_hash:
                    raise RevisionConflict("Expected candidate revision is missing.")
                self._mark_removed(candidate_id, marker.get("source_hash"))
                return False
            if not expected_source_hash or expected_source_hash != current:
                raise RevisionConflict("Candidate revision changed; refusing stale deletion.")
            self._mark_removed(candidate_id, current)
            self.candidates.delete(ids=[candidate_id])
            return True

    def count_candidates(self, where: Optional[Dict[str, Any]] = None) -> int:
        if where is None:
            return self.candidates.count()
        # Diagnostic only; bounded pages avoid materializing the entire index.
        count = 0
        while True:
            page = self.candidates.get(where=where, include=[], limit=256, offset=count)["ids"]
            count += len(page)
            if len(page) < 256:
                return count

    def query_candidates(self, vector: List[float], k: int,
                         where: Optional[Dict[str, Any]] = None) -> List[Tuple[str, float]]:
        if isinstance(k, bool) or not isinstance(k, int) or not 0 <= k <= 1000:
            raise ValueError("Requested candidate count must be between 0 and 1000.")
        available = self.candidates.count()
        if not available or not k:
            return []
        result = self.candidates.query(query_embeddings=[validate_vector(vector, self.dimensions)],
            n_results=min(k, available), where=where, include=["distances"])
        return [(identity, round(1.0 - float(distance), 4))
                for identity, distance in zip(result["ids"][0], result["distances"][0])]

    def upsert_event(self, event: EventDict, *, expected_source_hash: Optional[str] = None) -> str:
        validate_event_constraints(event)
        event = normalize_event_constraints(event)
        event_id = validate_id(event.get("event_id") or event_id_for(event))
        stored = {key: event.get(key) for key in _EVENT_FIELDS}
        stored["event_id"] = event_id
        if stored.get("remote") is None:
            stored.pop("remote", None)
        revision = _hash(stored)
        def current_hash():
            result = self.events.get(ids=[event_id], include=["metadatas"])
            return result["metadatas"][0]["source_hash"] if result["ids"] else None
        with self._mutex, self._file_lock:
            previous = current_hash()
            if expected_source_hash is not None and previous != expected_source_hash:
                raise RevisionConflict("Event revision changed.")
            if previous == revision:
                return event_id
            if previous is not None and previous != expected_source_hash:
                raise RevisionConflict("Replacing an event requires its current source hash.")
        narrative = event_narrative(stored)
        vector = validate_vector(self.embeddings.embed_query(narrative), self.dimensions)
        with self._mutex, self._file_lock:
            if current_hash() != previous:
                raise RevisionConflict("Event changed while embedding.")
            self.events.upsert(ids=[event_id], embeddings=[vector], documents=[narrative],
                metadatas=[{"event_id": event_id, "source_hash": revision,
                            "payload": json.dumps(stored, ensure_ascii=False)}])
        return event_id

    def event_source_hash(self, event_id: str) -> Optional[str]:
        result = self.events.get(ids=[validate_id(event_id)], include=["metadatas"])
        return result["metadatas"][0]["source_hash"] if result["ids"] else None

    def get_event(self, event_id: str) -> Optional[Tuple[EventDict, List[float]]]:
        result = self.events.get(ids=[validate_id(event_id)], include=["metadatas", "embeddings"])
        if not result["ids"]:
            return None
        return json.loads(result["metadatas"][0]["payload"]), [float(x) for x in result["embeddings"][0]]
