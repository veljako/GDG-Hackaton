"""
Embedding backends shared by the matchmaking pipeline and candidate_matcher.py.

Order of preference in build_embeddings():
  1. EmbeddingGemma through the /embed route on the Gemma server (gemma_embed_route.py)
  2. OpenAI text-embedding-3-small when OPENAI_API_KEY is set
  3. LocalHashingEmbeddings: offline, lexical (shared words), not semantic
"""

import hashlib
import math
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import List, Optional, Sequence
from urllib.parse import urlsplit

import requests
from langchain_core.embeddings import Embeddings
from langchain_openai import OpenAIEmbeddings

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractor import API_URL as GEMMA_GENERATE_URL, HEADERS  # noqa: E402

_gemma_base = urlsplit(GEMMA_GENERATE_URL)
GEMMA_EMBED_URL = os.environ.get("GEMMA_EMBED_URL") or f"{_gemma_base.scheme}://{_gemma_base.netloc}/embed"

OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"


class GemmaServerEmbeddings(Embeddings):
    """Embeddings from the /embed route on the Gemma server (see gemma_embed_route.py)."""

    model_id = "embeddinggemma"

    def __init__(self, embed_url: str = GEMMA_EMBED_URL, batch_size: int = 32, timeout: int = 120) -> None:
        # batch_size must stay at or below MAX_TEXTS_PER_REQUEST on the server.
        self.embed_url = embed_url
        self.batch_size = batch_size
        self.timeout = timeout

    def _embed(self, texts: Sequence[str], task: str, timeout: Optional[int] = None) -> List[List[float]]:
        vectors: List[List[float]] = []
        for start in range(0, len(texts), self.batch_size):
            batch = list(texts[start:start + self.batch_size])
            response = requests.post(
                self.embed_url,
                json={"texts": batch, "task": task},
                headers=HEADERS,
                timeout=timeout or self.timeout,
            )
            if response.status_code != 200:
                raise RuntimeError(f"Embedding server error: {response.status_code} {response.text[:300]}")
            batch_vectors = response.json()["embeddings"]
            if len(batch_vectors) != len(batch):
                raise RuntimeError(f"Embedding server returned {len(batch_vectors)} vectors for {len(batch)} texts.")
            vectors.extend(batch_vectors)
        return vectors

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        return self._embed(texts, task="document")

    def embed_query(self, text: str) -> List[float]:
        return self._embed([text], task="query")[0]

    def is_available(self) -> bool:
        try:
            self._embed(["ping"], task="query", timeout=15)
            return True
        except Exception:
            return False


_STOPWORDS = frozenset(
    """
    a an and are as at be by for from has have in into is it its of on or our that the their them this to
    was we will with who you your they he she his her i my me
    candidate candidates ideal skills skilled skill profile event summary level participant participants
    professional current status take part called
    """.split()
)


class LocalHashingEmbeddings(Embeddings):
    """
    Offline bag-of-words embeddings: unigrams and bigrams hashed into a fixed-size vector.

    Cosine similarity then measures shared vocabulary (e.g. "Python", "machine learning"),
    so rankings are meaningful for skill overlap but do not understand synonyms.
    """

    def __init__(self, size: int = 1024) -> None:
        self.size = size
        self.model_id = f"local-hashing-{size}"

    @staticmethod
    def _tokens(text: str) -> List[str]:
        folded = unicodedata.normalize("NFKD", text.casefold())
        folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
        words = [w.strip(".") for w in re.findall(r"[a-z0-9+#.]+", folded)]
        return [w for w in words if w and w not in _STOPWORDS]

    def _bucket(self, feature: str) -> tuple:
        digest = hashlib.md5(feature.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "little") % self.size
        sign = 1.0 if digest[4] & 1 else -1.0
        return index, sign

    def _embed(self, text: str) -> List[float]:
        words = self._tokens(text)
        features = words + [f"{a} {b}" for a, b in zip(words, words[1:])]
        counts: dict = {}
        for feature in features:
            counts[feature] = counts.get(feature, 0) + 1

        vector = [0.0] * self.size
        for feature, count in counts.items():
            index, sign = self._bucket(feature)
            vector[index] += sign * (1.0 + math.log(count))

        norm = math.sqrt(sum(x * x for x in vector))
        if norm == 0.0:
            # Cosine distance is undefined for a zero vector.
            vector[0] = 1.0
            return vector
        return [x / norm for x in vector]

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [self._embed(text) for text in texts]

    def embed_query(self, text: str) -> List[float]:
        return self._embed(text)


def embedding_model_id(embeddings: Embeddings) -> str:
    """Stable id of the embedding model, used to keep vectors of different models in separate collections."""
    explicit = getattr(embeddings, "model_id", None)
    if explicit:
        return str(explicit)
    model = getattr(embeddings, "model", None)
    if isinstance(embeddings, OpenAIEmbeddings) and model:
        return f"openai-{model}"
    return type(embeddings).__name__.lower()


def build_embeddings() -> Embeddings:
    """
    Gemma server embeddings when /embed responds, then OpenAI if OPENAI_API_KEY is set,
    otherwise offline LocalHashingEmbeddings.

    Each option has a different vector size, so a persisted Chroma collection must
    always be built and queried with the same one.
    """
    gemma = GemmaServerEmbeddings()
    if gemma.is_available():
        return gemma
    if os.environ.get("OPENAI_API_KEY"):
        print(f"Warning: Gemma /embed at {GEMMA_EMBED_URL} is unavailable. Using OpenAI embeddings.\n")
        return OpenAIEmbeddings(model=OPENAI_EMBEDDING_MODEL)
    print(
        f"Warning: Gemma /embed at {GEMMA_EMBED_URL} is unavailable and OPENAI_API_KEY is not set. "
        "Using offline lexical embeddings: scores reflect shared words, not meaning.\n"
    )
    return LocalHashingEmbeddings()
