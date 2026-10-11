"""
Hybrid candidate-to-event matching: metadata pre-filtering (hard constraints)
followed by cosine similarity on text embeddings.

CVs are turned into narrative strings, embedded with EmbeddingGemma through the
/embed route on the Gemma server (OpenAI text-embedding-3-small as a fallback),
and stored in ChromaDB together with lokacija, senioritet, and godine as metadata.
An event is turned into a narrative the same way; Chroma filters on the metadata
first and ranks only the remaining candidates by cosine similarity.
"""

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

sys.path.insert(0, str(Path(__file__).resolve().parent))

from embeddings import GemmaServerEmbeddings, build_embeddings  # noqa: E402,F401

DEFAULT_COLLECTION = "candidates"
MISSING = "nije navedeno"


def normalize_key(value: Optional[str]) -> Optional[str]:
    """Lowercase and trim a value used for exact metadata matching. Empty becomes None."""
    if value is None:
        return None
    text = " ".join(str(value).split()).casefold()
    return text or None


def _join(values: Sequence[str]) -> str:
    cleaned = [v.strip() for v in values if isinstance(v, str) and v.strip()]
    return ", ".join(cleaned) if cleaned else MISSING


def _or_missing(value: Any) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        return MISSING
    return str(value).strip()


# ============================================================================
# Data models
# ============================================================================
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

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EventProfile":
        return cls(
            tip_eventa=data.get("tip_eventa"),
            kratak_opis=data.get("kratak_opis"),
            potrebni_skillovi=list(data.get("potrebni_skillovi") or []),
            lokacija=data.get("lokacija"),
            is_remote=bool(data.get("is_remote", False)),
            senioritet=data.get("senioritet"),
            min_godine=data.get("min_godine"),
            max_godine=data.get("max_godine"),
        )


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

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CandidateProfile":
        if not data.get("id_kandidata"):
            raise ValueError("CV JSON is missing 'id_kandidata'.")
        return cls(
            id_kandidata=str(data["id_kandidata"]),
            detaljan_opis=data.get("detaljan_opis"),
            lokacija=data.get("lokacija"),
            jezik=list(data.get("jezik") or []),
            senioritet=data.get("senioritet"),
            zaposlen=data.get("zaposlen"),
            skillovi=list(data.get("skillovi") or []),
            prosli_hackathoni=list(data.get("prosli_hackathoni") or []),
            godine=data.get("godine"),
        )


@dataclass
class CandidateMatch:
    id_kandidata: str
    similarity: float
    metadata: Dict[str, Any] = field(default_factory=dict)
    narrative: str = ""


# ============================================================================
# Step A: narrative templates
# ============================================================================
class NarrativeBuilder:
    """Turns event and CV records into unified narrative strings for embedding."""

    @staticmethod
    def event_narrative(event: EventProfile) -> str:
        remote = "da" if event.is_remote else "ne"
        narrative = (
            f"Traži se {_or_missing(event.senioritet)} učesnik za {_or_missing(event.tip_eventa)}. "
            f"Događaj se održava u {_or_missing(event.lokacija)} (Remote: {remote}). "
            f"Od kandidata se očekuje poznavanje sledećih veština: {_join(event.potrebni_skillovi)}. "
            f"Ciljna grupa su takmičari u rasponu od {_or_missing(event.min_godine)} "
            f"do {_or_missing(event.max_godine)} godina."
        )
        # A missing description is left out rather than written as "nije navedeno",
        # so it adds no noise to the event embedding.
        if event.kratak_opis and event.kratak_opis.strip():
            narrative += f" Kratak opis događaja: {' '.join(event.kratak_opis.split())}"
        return narrative

    @staticmethod
    def cv_narrative(cv: CandidateProfile) -> str:
        if cv.zaposlen is None:
            status = MISSING
        else:
            status = "zaposlen" if cv.zaposlen else "nije zaposlen"
        return (
            f"{_or_missing(cv.senioritet)} kandidat. "
            f"Lokacija: {_or_missing(cv.lokacija)}. "
            f"Kandidat poseduje sledeće veštine: {_join(cv.skillovi)}. "
            f"Govori {_join(cv.jezik)} jezik. "
            f"Trenutni status: {status}. "
            f"Prethodno iskustvo na takmičenjima: {_join(cv.prosli_hackathoni)}. "
            f"Detaljan opis profila: {_or_missing(cv.detaljan_opis)}. "
            f"Godište: {_or_missing(cv.godine)}."
        )


# ============================================================================
# Step B: vectorization and storage
# ============================================================================
class CandidateVectorStore:
    """ChromaDB collection of CV narratives with filterable metadata, using cosine distance."""

    def __init__(
        self,
        embeddings: Embeddings,
        collection_name: str = DEFAULT_COLLECTION,
        persist_directory: Optional[str] = None,
    ) -> None:
        self.embeddings = embeddings
        self.store = Chroma(
            collection_name=collection_name,
            embedding_function=embeddings,
            persist_directory=persist_directory,
            collection_metadata={"hnsw:space": "cosine"},
        )

    @staticmethod
    def _metadata(cv: CandidateProfile) -> Dict[str, Any]:
        # Chroma rejects None values, so missing fields are left out. A CV without
        # godine then never passes an age range filter, which is the intended hard constraint.
        metadata: Dict[str, Any] = {"id_kandidata": cv.id_kandidata}
        lokacija = normalize_key(cv.lokacija)
        senioritet = normalize_key(cv.senioritet)
        if lokacija is not None:
            metadata["lokacija"] = lokacija
        if senioritet is not None:
            metadata["senioritet"] = senioritet
        if isinstance(cv.godine, int):
            metadata["godine"] = cv.godine
        return metadata

    def add_candidates(self, cvs: Sequence[CandidateProfile]) -> List[str]:
        """Embed and upsert CVs. Re-adding the same id_kandidata replaces the stored entry."""
        documents = [
            Document(page_content=NarrativeBuilder.cv_narrative(cv), metadata=self._metadata(cv))
            for cv in cvs
        ]
        ids = [cv.id_kandidata for cv in cvs]
        return self.store.add_documents(documents, ids=ids)

    def search_by_vector(
        self,
        query_vector: List[float],
        k: int,
        metadata_filter: Optional[Dict[str, Any]],
    ) -> List[CandidateMatch]:
        results = self.store.similarity_search_by_vector_with_relevance_scores(
            embedding=query_vector,
            k=k,
            filter=metadata_filter,
        )
        # With hnsw:space=cosine Chroma returns cosine distance, so similarity is 1 - distance.
        return [
            CandidateMatch(
                id_kandidata=str(doc.metadata.get("id_kandidata", "")),
                similarity=round(1.0 - float(distance), 4),
                metadata=dict(doc.metadata),
                narrative=doc.page_content,
            )
            for doc, distance in results
        ]


# ============================================================================
# Step C: hybrid matchmaking
# ============================================================================
class HardConstraintFilter:
    """Builds a Chroma `where` filter from the event's hard constraints."""

    @staticmethod
    def build(event: EventProfile) -> Optional[Dict[str, Any]]:
        conditions: List[Dict[str, Any]] = []

        if event.min_godine is not None:
            conditions.append({"godine": {"$gte": int(event.min_godine)}})
        if event.max_godine is not None:
            conditions.append({"godine": {"$lte": int(event.max_godine)}})

        senioritet = normalize_key(event.senioritet)
        if senioritet is not None:
            conditions.append({"senioritet": {"$eq": senioritet}})

        lokacija = normalize_key(event.lokacija)
        if not event.is_remote and lokacija is not None:
            conditions.append({"lokacija": {"$eq": lokacija}})

        # Chroma requires at least two conditions inside $and.
        if not conditions:
            return None
        if len(conditions) == 1:
            return conditions[0]
        return {"$and": conditions}


class CandidateMatcher:
    """Matches candidates to an event: metadata pre-filter, then cosine similarity ranking."""

    def __init__(self, vector_store: CandidateVectorStore) -> None:
        self.vector_store = vector_store

    def add_cvs(self, cv_jsons: Sequence[Dict[str, Any]]) -> List[str]:
        return self.vector_store.add_candidates([CandidateProfile.from_dict(cv) for cv in cv_jsons])

    def find_best_candidates(self, event_json: Dict[str, Any], top_k: int = 5) -> List[CandidateMatch]:
        event = EventProfile.from_dict(event_json)
        metadata_filter = HardConstraintFilter.build(event)
        query_vector = self.vector_store.embeddings.embed_query(NarrativeBuilder.event_narrative(event))
        return self.vector_store.search_by_vector(query_vector, k=top_k, metadata_filter=metadata_filter)


# ============================================================================
# EXAMPLE USAGE
# ============================================================================
if __name__ == "__main__":
    import json

    mock_cvs = [
        {
            "id_kandidata": "123",
            "detaljan_opis": "Strastveni inženjer podataka sa fokusom na optimizaciju modela.",
            "lokacija": "Beograd",
            "jezik": ["Srpski", "Engleski"],
            "senioritet": "Medior",
            "zaposlen": True,
            "skillovi": ["Python", "XGBoost", "LangChain", "SQL"],
            "prosli_hackathoni": ["OmniMo Hackathon 2026"],
            "godine": 23,
        },
        {
            "id_kandidata": "456",
            "detaljan_opis": "ML inženjer koji gradi RAG sisteme nad internom dokumentacijom.",
            "lokacija": "beograd",
            "jezik": ["Srpski", "Engleski", "Nemački"],
            "senioritet": "Medior",
            "zaposlen": False,
            "skillovi": ["Python", "Pandas", "RAG", "LangChain", "ChromaDB"],
            "prosli_hackathoni": ["Data Science Hackathon Beograd 2025", "AI Bootcamp Hack"],
            "godine": 25,
        },
        {
            "id_kandidata": "789",
            "detaljan_opis": "Senior backend developer, distribuirani sistemi i Kubernetes.",
            "lokacija": "Novi Sad",
            "jezik": ["Srpski"],
            "senioritet": "Senior",
            "zaposlen": True,
            "skillovi": ["Go", "Kubernetes", "PostgreSQL"],
            "prosli_hackathoni": [],
            "godine": 31,
        },
    ]

    mock_event = {
        "tip_eventa": "Data Science Hackathon",
        "kratak_opis": "Dvodnevni hakaton na kom timovi grade RAG asistenta nad dokumentacijom.",
        "potrebni_skillovi": ["Python", "Pandas", "RAG", "LangChain"],
        "lokacija": "Beograd",
        "is_remote": False,
        "senioritet": "Medior",
        "min_godine": 20,
        "max_godine": 26,
    }

    store = CandidateVectorStore(embeddings=build_embeddings(), collection_name="demo_candidates")
    matcher = CandidateMatcher(store)
    matcher.add_cvs(mock_cvs)

    event = EventProfile.from_dict(mock_event)
    print("Event narrative:")
    print(NarrativeBuilder.event_narrative(event))
    print("\nMetadata pre-filter:")
    print(json.dumps(HardConstraintFilter.build(event), indent=2, ensure_ascii=False))

    matches = matcher.find_best_candidates(mock_event, top_k=5)
    print(f"\nTop {len(matches)} candidates:")
    for rank, match in enumerate(matches, start=1):
        print(f"{rank}. id={match.id_kandidata} similarity={match.similarity:.4f} metadata={match.metadata}")
