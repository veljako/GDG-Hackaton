"""
/embed route for the Gemma FastAPI server, backed by EmbeddingGemma.

Add it to the existing server app next to /generate:

    from gemma_embed_route import router as embed_router
    app.include_router(embed_router)

Server requirements: sentence-transformers>=5 and access to google/embeddinggemma-300m
on Hugging Face (accept the model license, then log in with a Hugging Face token).
"""

from functools import lru_cache
from typing import List, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

EMBEDDING_MODEL_ID = "google/embeddinggemma-300m"
MAX_TEXTS_PER_REQUEST = 64

router = APIRouter()


class EmbedRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1, max_length=MAX_TEXTS_PER_REQUEST)
    # EmbeddingGemma uses different prompts for search queries and for stored documents.
    task: Literal["query", "document"] = "document"


class EmbedResponse(BaseModel):
    model: str
    dimensions: int
    embeddings: List[List[float]]


@lru_cache(maxsize=1)
def get_embedding_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(EMBEDDING_MODEL_ID)


@router.post("/embed", response_model=EmbedResponse)
def embed_texts(request: EmbedRequest) -> EmbedResponse:
    model = get_embedding_model()
    encode = model.encode_query if request.task == "query" else model.encode_document
    vectors = encode(request.texts, normalize_embeddings=True)
    embeddings = [[float(x) for x in vector] for vector in vectors]
    return EmbedResponse(
        model=EMBEDDING_MODEL_ID,
        dimensions=len(embeddings[0]),
        embeddings=embeddings,
    )
