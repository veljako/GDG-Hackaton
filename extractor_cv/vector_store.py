"""
DB handlers: narrative text, metadata, and ChromaDB storage for candidates and events.

Candidates and events live in separate collections that use cosine distance. Each
collection name includes the embedding model id, so vectors of different models
(and sizes) never end up in the same collection.
"""

import hashlib
import json
import sys
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from langchain_chroma import Chroma
from langchain_core.embeddings import Embeddings

sys.path.insert(0, str(Path(__file__).resolve().parent))

from embeddings import embedding_model_id  # noqa: E402
from event_candidate_finder import seniority_bucket  # noqa: E402
from extractors import CvDict, EventDict, slugify  # noqa: E402

UNKNOWN = "unknown"
CITY_ALIASES = {"beograd": "belgrade", "bec": "vienna"}


# ============================================================================
# Metadata keys used for exact filtering
# ============================================================================
def city_key(location: Optional[str]) -> str:
    """'Niš, Serbia' -> 'nis'; 'Beograd' -> 'belgrade'. Missing -> 'unknown'."""
    if not location or not location.strip():
        return UNKNOWN
    city = location.split(",")[0]
    folded = unicodedata.normalize("NFKD", city.casefold())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    folded = " ".join(folded.split())
    if not folded:
        return UNKNOWN
    return CITY_ALIASES.get(folded, folded)


def seniority_key(level: Optional[str]) -> str:
    """'Student / Junior' -> 'junior', 'Medior' -> 'mid'. Missing -> 'unknown'."""
    return seniority_bucket(level) or UNKNOWN


# ============================================================================
# Narrative text for embeddings
# ============================================================================
def _sentence(text: str) -> str:
    text = text.strip()
    return text if text.endswith((".", "!", "?")) else f"{text}."


def candidate_narrative(cv: CvDict) -> str:
    """Skills, experience, and profile description. Location and age are filters, not semantics."""
    parts: List[str] = []
    if cv.get("current_role"):
        parts.append(f"Current role: {cv['current_role']}.")
    elif cv.get("experience_level"):
        parts.append(f"{cv['experience_level']} professional.")
    schools = [item["institution"] for item in cv.get("education") or [] if item.get("institution")]
    if schools:
        parts.append(f"Education: {', '.join(schools)}.")
    if cv.get("skills"):
        parts.append(f"Skills: {', '.join(cv['skills'])}.")
    if cv.get("status"):
        parts.append(f"Current status: {cv['status']}.")
    if cv.get("general_description"):
        parts.append(f"Profile: {_sentence(cv['general_description'])}")
    return " ".join(parts) or "No CV details available."


def event_narrative(event: EventDict) -> str:
    """The event described as its ideal candidate, so it embeds close to matching CVs."""
    parts: List[str] = []
    seniority = event.get("seniority")
    parts.append(f"The ideal candidate is a {seniority} professional." if seniority else "The ideal candidate:")
    if event.get("skills"):
        parts.append(f"They are skilled in {', '.join(event['skills'])}.")
    kind = event.get("event_type") or "event"
    if event.get("name"):
        parts.append(f"They will take part in the {kind} {event['name']}.")
    else:
        parts.append(f"They will take part in a {kind}.")
    if event.get("short_description"):
        parts.append(f"Event summary: {_sentence(event['short_description'])}")
    return " ".join(parts)


def event_id_for(event: EventDict) -> str:
    """Stable id from the event content, so re-adding the same event updates it."""
    content = {k: v for k, v in event.items() if k != "event_id"}
    digest = hashlib.sha1(json.dumps(content, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    label = slugify(event.get("name") or event.get("event_type") or "event")
    return f"{label}-{digest[:10]}"


# ============================================================================
# Chroma store
# ============================================================================
class MatchmakingStore:
    """Candidates and events with their embeddings and filterable metadata."""

    def __init__(
        self,
        embeddings: Embeddings,
        persist_directory: Optional[str] = None,
        namespace: str = "matchmaking",
    ) -> None:
        self.embeddings = embeddings
        model = slugify(embedding_model_id(embeddings))
        self.candidates = Chroma(
            collection_name=f"{namespace}_candidates_{model}",
            embedding_function=embeddings,
            persist_directory=persist_directory,
            collection_metadata={"hnsw:space": "cosine"},
        )
        self.events = Chroma(
            collection_name=f"{namespace}_events_{model}",
            embedding_function=embeddings,
            persist_directory=persist_directory,
            collection_metadata={"hnsw:space": "cosine"},
        )

    # ---- candidates --------------------------------------------------------
    @staticmethod
    def candidate_metadata(cv: CvDict) -> Dict[str, Any]:
        # Chroma rejects None values, so unknowns use sentinels and has_birth_year.
        metadata: Dict[str, Any] = {
            "candidate_id": cv["candidate_id"],
            "source": cv.get("source") or "",
            "city": city_key(cv.get("location")),
            "seniority_level": seniority_key(cv.get("experience_level")),
            "has_birth_year": cv.get("birth_year") is not None,
            "payload": json.dumps(cv, ensure_ascii=False),
        }
        if cv.get("birth_year") is not None:
            metadata["birth_year"] = int(cv["birth_year"])
        return metadata

    def upsert_candidate(self, cv: CvDict) -> str:
        narrative = candidate_narrative(cv)
        vector = self.embeddings.embed_documents([narrative])[0]
        self.candidates._collection.upsert(
            ids=[cv["candidate_id"]],
            embeddings=[vector],
            documents=[narrative],
            metadatas=[self.candidate_metadata(cv)],
        )
        return cv["candidate_id"]

    def get_candidate(self, candidate_id: str) -> Optional[CvDict]:
        result = self.candidates._collection.get(ids=[candidate_id], include=["metadatas"])
        if not result["ids"]:
            return None
        return json.loads(result["metadatas"][0]["payload"])

    def count_candidates(self, where: Optional[Dict[str, Any]] = None) -> int:
        if where is None:
            return self.candidates._collection.count()
        return len(self.candidates._collection.get(where=where, include=[])["ids"])

    def query_candidates(
        self,
        vector: List[float],
        k: int,
        where: Optional[Dict[str, Any]] = None,
    ) -> List[Tuple[str, float]]:
        """Return (candidate_id, cosine similarity) for the k nearest candidates that pass `where`."""
        available = self.count_candidates(where)
        if available == 0 or k <= 0:
            return []
        result = self.candidates._collection.query(
            query_embeddings=[vector],
            n_results=min(k, available),
            where=where,
            include=["distances"],
        )
        # With hnsw:space=cosine Chroma returns cosine distance, so similarity is 1 - distance.
        return [
            (candidate_id, round(1.0 - float(distance), 4))
            for candidate_id, distance in zip(result["ids"][0], result["distances"][0])
        ]

    # ---- events ------------------------------------------------------------
    def upsert_event(self, event: EventDict) -> str:
        event_id = event.get("event_id") or event_id_for(event)
        stored: EventDict = dict(event, event_id=event_id)  # type: ignore[assignment]
        narrative = event_narrative(stored)
        # The event is the search query side, so it uses the query embedding.
        vector = self.embeddings.embed_query(narrative)
        self.events._collection.upsert(
            ids=[event_id],
            embeddings=[vector],
            documents=[narrative],
            metadatas=[{"event_id": event_id, "payload": json.dumps(stored, ensure_ascii=False)}],
        )
        return event_id

    def get_event(self, event_id: str) -> Optional[Tuple[EventDict, List[float]]]:
        result = self.events._collection.get(ids=[event_id], include=["metadatas", "embeddings"])
        if not result["ids"]:
            return None
        event = json.loads(result["metadatas"][0]["payload"])
        vector = [float(x) for x in result["embeddings"][0]]
        return event, vector
