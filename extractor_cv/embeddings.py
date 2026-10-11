"""Explicit, validated embedding backends. A failure never changes the model."""

import hashlib
import math
import os
import re
import unicodedata
from typing import List, Optional, Sequence
from urllib.parse import urlsplit

import requests
from langchain_core.embeddings import Embeddings
from langchain_openai import OpenAIEmbeddings
from http_utils import read_json_response

_base = urlsplit(os.environ.get("GEMMA_GENERATE_URL", "http://localhost:8000/generate"))
GEMMA_EMBED_URL = os.environ.get("GEMMA_EMBED_URL", f"{_base.scheme}://{_base.netloc}/embed")
GEMMA_MODEL = "google/embeddinggemma-300m"
MAX_TEXT_CHARS = 12000
OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"


class EmbeddingServiceError(RuntimeError):
    """A shared service failure; retry the batch, never fan out into per-CV calls."""


def validate_vector(vector, dimensions: int) -> List[float]:
    if not isinstance(vector, (list, tuple)) or len(vector) != dimensions:
        raise ValueError("Embedding dimension does not match the index contract.")
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in vector):
        raise ValueError("Embedding contains invalid numeric values.")
    values = [float(x) for x in vector]
    norm = math.hypot(*values)
    if not math.isfinite(norm) or not norm:
        raise ValueError("Embedding norm must be finite and nonzero.")
    return [x / norm for x in values]


def _validate_texts(texts: Sequence[str]) -> None:
    if any(not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS for text in texts):
        raise ValueError(f"Embedding texts must contain 1-{MAX_TEXT_CHARS} characters.")


class GemmaServerEmbeddings(Embeddings):
    def __init__(self, embed_url: str = GEMMA_EMBED_URL, batch_size: int = 32,
                 timeout: int = 120, dimensions: int = 768, revision: Optional[str] = None) -> None:
        revision = revision or os.environ.get("GEMMA_EMBED_REVISION")
        if not revision or not re.fullmatch(r"[a-fA-F0-9]{40}", revision):
            raise ValueError("GEMMA_EMBED_REVISION must be an immutable 40-character model commit.")
        if not 1 <= batch_size <= 64 or not 1 <= dimensions <= 4096 or timeout <= 0:
            raise ValueError("Invalid embedding batch size, dimensions, or timeout.")
        self.embed_url, self.batch_size, self.timeout = embed_url, batch_size, timeout
        self.dimensions, self.revision = dimensions, revision.lower()
        self.model_id = f"{GEMMA_MODEL}@{self.revision}:{dimensions}:query-document-v1"

    def _embed(self, texts: Sequence[str], task: str, timeout: Optional[int] = None) -> List[List[float]]:
        _validate_texts(texts)
        vectors = []
        start = 0
        while start < len(texts):
            batch, characters = [], 0
            while start < len(texts) and len(batch) < self.batch_size:
                if characters + len(texts[start]) > 48000:
                    break
                batch.append(texts[start])
                characters += len(texts[start])
                start += 1
            for attempt in range(2):
                try:
                    response = requests.post(self.embed_url, json={"texts": batch, "task": task},
                                             timeout=(5, timeout or self.timeout), stream=True)
                except (requests.Timeout, requests.ConnectionError):
                    if attempt == 0:
                        continue
                    raise EmbeddingServiceError("Embedding service unavailable; retry this job with the same model.") from None
                except requests.RequestException:
                    raise EmbeddingServiceError("Embedding request failed.") from None
                if response.status_code in (429, 502, 503, 504) and attempt == 0:
                    response.close()
                    continue
                break
            try:
                if response.status_code != 200:
                    raise EmbeddingServiceError(f"Embedding service rejected request (HTTP {response.status_code}).")
                payload = read_json_response(response, max_bytes=2_097_152)
                if (payload["model"] != GEMMA_MODEL or payload["revision"] != self.revision
                        or payload["dimensions"] != self.dimensions):
                    raise ValueError("Embedding service model contract changed.")
                batch_vectors = payload["embeddings"]
                if not isinstance(batch_vectors, list) or len(batch_vectors) != len(batch):
                    raise ValueError("Embedding service returned the wrong batch size.")
                vectors.extend(validate_vector(vector, self.dimensions) for vector in batch_vectors)
            except (KeyError, TypeError, ValueError, requests.RequestException):
                raise EmbeddingServiceError("Embedding service returned an invalid or incompatible response.") from None
            finally:
                response.close()
        return vectors

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self._embed(texts, "document")

    def embed_query(self, text: str) -> List[float]:
        return self._embed([text], "query")[0]

    def is_available(self) -> bool:
        try:
            self._embed(["ping"], "query", timeout=15)
            return True
        except (RuntimeError, ValueError):
            return False


_STOPWORDS = frozenset("a an and are as at be by for from has have in into is it its of on or our that the their them this to was we will with who you your they he she his her i my me candidate candidates ideal skills skilled skill profile event summary level participant participants professional current status take part called".split())


class LocalHashingEmbeddings(Embeddings):
    """Explicit offline lexical backend; supports Unicode but does not infer synonyms."""

    def __init__(self, size: int = 1024) -> None:
        if isinstance(size, bool) or not isinstance(size, int) or not 32 <= size <= 4096:
            raise ValueError("Local dimensions must be between 32 and 4096.")
        self.size = self.dimensions = size
        self.model_id = f"local-hashing-unicode-v2:{size}"

    @staticmethod
    def _tokens(text: str) -> List[str]:
        folded = unicodedata.normalize("NFKD", text.casefold())
        folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
        words = [w.strip(".") for w in re.findall(r"[^\W_]+(?:[+#.][^\W_]*)*", folded)]
        return [w for w in words if w and w not in _STOPWORDS]

    def _embed(self, text: str) -> List[float]:
        _validate_texts([text])
        words = self._tokens(text)
        features = words + [f"{a} {b}" for a, b in zip(words, words[1:])]
        counts = {}
        for feature in features:
            counts[feature] = counts.get(feature, 0) + 1
        vector = [0.0] * self.size
        for feature, count in counts.items():
            digest = hashlib.sha256(feature.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "little") % self.size
            vector[index] += (1 if digest[4] & 1 else -1) * (1 + math.log(count))
        norm = math.sqrt(sum(x*x for x in vector))
        if not norm:
            raise ValueError("Text has no usable lexical features.")
        return [x / norm for x in vector]

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [self._embed(text) for text in texts]

    def embed_query(self, text: str) -> List[float]:
        return self._embed(text)


class OllamaGemmaEmbeddings(Embeddings):
    """Local Google EmbeddingGemma inference pinned to the actual converted model digest.

    This explicit development runtime never impersonates a Hugging Face revision
    or shares the SentenceTransformers index contract.
    """
    dimensions = 768

    def __init__(self, url: str = 'http://127.0.0.1:11434', model: str = 'embeddinggemma',
                 digest: Optional[str] = None):
        if model not in ('embeddinggemma', 'embeddinggemma:latest'):
            raise ValueError('Only Google EmbeddingGemma is supported by this adapter.')
        digest = digest or os.environ.get('GEMMA_OLLAMA_EMBED_DIGEST', '')
        digest = digest.removeprefix('sha256:')
        if not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('Pin GEMMA_OLLAMA_EMBED_DIGEST to the installed model SHA256.')
        self.url, self.model, self.digest = url.rstrip('/'), 'embeddinggemma:latest', digest
        self.model_id = f'google/embeddinggemma-300m:ollama-sha256-{digest}:768:query-document-v1'

    def _embed(self, texts: List[str], task: str) -> List[List[float]]:
        _validate_texts(texts)
        if not texts:
            return []
        if len(texts) > 64:
            raise ValueError('Embedding requests accept at most 64 texts.')
        try:
            tags = requests.get(self.url + '/api/tags', timeout=(5, 10))
            tags.raise_for_status()
            models = tags.json().get('models', [])
            if not any(item.get('name') == self.model and item.get('digest') == self.digest for item in models):
                raise ValueError('Pinned Google model is missing or changed.')
            prompt = 'task: search result | query: ' if task == 'query' else 'title: none | text: '
            response = requests.post(self.url + '/api/embed', json={
                'model': self.model, 'input': [prompt + text for text in texts],
                'truncate': False, 'keep_alive': '5m',
            }, timeout=(5, 120))
            response.raise_for_status()
            payload = response.json()
            vectors = payload['embeddings']
            if len(vectors) != len(texts):
                raise ValueError('Incomplete vector response.')
            return [validate_vector(vector, self.dimensions) for vector in vectors]
        except (requests.RequestException, KeyError, TypeError, ValueError):
            raise EmbeddingServiceError('Pinned Google EmbeddingGemma runtime unavailable or incompatible.') from None

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self._embed(texts, 'document')

    def embed_query(self, text: str) -> List[float]:
        return self._embed([text], 'query')[0]


class OpenAIModelEmbeddings(Embeddings):
    """Bound provider retries and classify shared outages for batch recovery."""
    dimensions = 1536
    model_id = "openai-text-embedding-3-small:1536:v1"

    def __init__(self):
        self.provider = OpenAIEmbeddings(model=OPENAI_EMBEDDING_MODEL, dimensions=self.dimensions,
                                         request_timeout=(5, 45), max_retries=1)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        _validate_texts(texts)
        if not texts:
            return []
        if len(texts) > 256:
            raise ValueError("Embedding batch exceeds 256 texts.")
        try:
            vectors = self.provider.embed_documents(texts)
            if len(vectors) != len(texts):
                raise ValueError("Incomplete embedding batch.")
            return [validate_vector(vector, self.dimensions) for vector in vectors]
        except Exception:
            raise EmbeddingServiceError("OpenAI embeddings unavailable or incompatible; retry this batch.") from None

    def embed_query(self, text: str) -> List[float]:
        return self.embed_documents([text])[0]


def embedding_model_id(embeddings: Embeddings) -> str:
    explicit = getattr(embeddings, "model_id", None)
    if explicit:
        return str(explicit)
    if isinstance(embeddings, OpenAIEmbeddings):
        return f"openai-{embeddings.model}:{embeddings.dimensions}:v1"
    raise ValueError("Custom embeddings must declare a stable model_id and dimensions.")


def build_embeddings(backend: Optional[str] = None) -> Embeddings:
    backend = backend or os.environ.get("CV_EMBEDDING_BACKEND", "gemma")
    if backend == "local":
        return LocalHashingEmbeddings()
    if backend == "ollama-gemma":
        return OllamaGemmaEmbeddings(url=os.environ.get('GEMMA_OLLAMA_URL', 'http://127.0.0.1:11434'))
    if backend == "openai":
        if not os.environ.get("OPENAI_API_KEY"):
            raise ValueError("The OpenAI backend requires OPENAI_API_KEY.")
        return OpenAIModelEmbeddings()
    if backend != "gemma":
        raise ValueError("CV_EMBEDDING_BACKEND must be gemma, openai, or local.")
    model = GemmaServerEmbeddings()
    if not model.is_available():
        raise RuntimeError("Configured Gemma model unavailable. No alternate index was opened.")
    return model
