"""
/embed route for the Gemma FastAPI server, backed by EmbeddingGemma.

Add it to the existing server app next to /generate:

    from gemma_embed_route import router as embed_router
    app.include_router(embed_router)

Server requirements: sentence-transformers>=5, access to google/embeddinggemma-300m,
and GEMMA_EMBED_REVISION set to an immutable 40-character model commit.
"""

from functools import lru_cache
import math
import os
import re
from numbers import Real
from threading import BoundedSemaphore, Lock
from typing import Annotated, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

EMBEDDING_MODEL_ID = "google/embeddinggemma-300m"
MAX_TEXTS_PER_REQUEST = 64
MAX_TEXT_CHARACTERS = 12_000
MAX_TOTAL_TEXT_CHARACTERS = 48_000
EMBEDDING_DIMENSIONS = 768
# Allow escaped Unicode within the character budget while bounding JSON decoding.
MAX_REQUEST_BODY_BYTES = MAX_TOTAL_TEXT_CHARACTERS * 12 + 16_384
_MODEL_LOAD_LOCK = Lock()
_INFERENCE_GATE = BoundedSemaphore(1)


class PrivateValidationRoute(APIRoute):
    """Bound request decoding and omit private input values from validation errors."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded_handler(request: Request):
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_REQUEST_BODY_BYTES:
                    raise HTTPException(413, "Embedding request is too large.")
                body.extend(chunk)
            request._body = bytes(body)
            try:
                return await handler(request)
            except RequestValidationError:
                raise HTTPException(422, "Invalid embedding request.") from None

        return bounded_handler


router = APIRouter(route_class=PrivateValidationRoute)


class EmbedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    texts: List[Annotated[str, StringConstraints(strict=True, min_length=1,
                                                max_length=MAX_TEXT_CHARACTERS)]] = Field(
        ..., min_length=1, max_length=MAX_TEXTS_PER_REQUEST)
    # EmbeddingGemma uses different prompts for search queries and for stored documents.
    task: Literal["query", "document"] = "document"

    @field_validator("texts")
    @classmethod
    def bounded_texts(cls, texts):
        if any(not text.strip() for text in texts):
            raise ValueError("Embedding text must contain a non-whitespace character.")
        if sum(map(len, texts)) > MAX_TOTAL_TEXT_CHARACTERS:
            raise ValueError("Embedding request exceeds the total character budget.")
        return texts


class EmbedResponse(BaseModel):
    model: Literal["google/embeddinggemma-300m"]
    revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    dimensions: Literal[768]
    embeddings: List[List[float]]


@lru_cache(maxsize=1)
def _load_embedding_model(revision: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(EMBEDDING_MODEL_ID, revision=revision, trust_remote_code=False)


def _configured_revision() -> str:
    revision = os.environ.get("GEMMA_EMBED_REVISION", "")
    if not re.fullmatch(r"[a-fA-F0-9]{40}", revision):
        raise ValueError("GEMMA_EMBED_REVISION must be an immutable model commit.")
    return revision.lower()


def get_embedding_model(revision: Optional[str] = None):
    revision = revision if revision is not None else _configured_revision()
    if not re.fullmatch(r"[a-fA-F0-9]{40}", revision):
        raise ValueError("An immutable model commit is required.")
    # lru_cache alone does not serialize concurrent misses.
    with _MODEL_LOAD_LOCK:
        return _load_embedding_model(revision.lower())


def _validated_embeddings(vectors, count: int) -> List[List[float]]:
    if len(vectors) != count:
        raise ValueError("Invalid embedding count.")
    embeddings = []
    for vector in vectors:
        if len(vector) != EMBEDDING_DIMENSIONS:
            raise ValueError("Invalid embedding dimensions.")
        values = []
        for value in vector:
            if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value):
                raise ValueError("Invalid embedding values.")
            values.append(float(value))
        norm = math.hypot(*values)
        if not math.isfinite(norm) or norm == 0:
            raise ValueError("Invalid embedding norm.")
        embeddings.append(values)
    return embeddings


@router.post("/embed", response_model=EmbedResponse)
def embed_texts(request: EmbedRequest) -> EmbedResponse:
    if not _INFERENCE_GATE.acquire(blocking=False):
        raise HTTPException(503, "Embedding service is busy.", headers={"Retry-After": "1"})
    try:
        revision = _configured_revision()
        model = get_embedding_model(revision)
        encode = model.encode_query if request.task == "query" else model.encode_document
        embeddings = _validated_embeddings(encode(request.texts, normalize_embeddings=True), len(request.texts))
        return EmbedResponse(model=EMBEDDING_MODEL_ID, revision=revision,
                             dimensions=EMBEDDING_DIMENSIONS, embeddings=embeddings)
    except Exception:
        raise HTTPException(503, "Embedding service is unavailable.") from None
    finally:
        _INFERENCE_GATE.release()
