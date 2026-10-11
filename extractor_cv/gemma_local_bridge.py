"""Loopback development bridge for the existing /generate extraction protocol.

Uses real Google Gemma weights in an already installed local runtime. Production
may supply the same response contract from a Google-hosted inference service.
"""
import json
import os
import re
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()

class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    prompt: str = Field(min_length=1, max_length=60000)

class TokenRequest(GenerateRequest):
    model: str

@app.post('/tokenize')
def tokenize(body: TokenRequest):
    """Count the actual chat prompt through the pinned runtime's tokenizer.

    Ollama does not expose its tokenizer. A one-token preflight evaluates the
    identical chat framing and reports prompt_eval_count. Any context clipping
    produces a saturated count and is rejected by the reserved output budget.
    """
    health()
    base, model, _ = configuration()
    if body.model != model:
        raise HTTPException(400, 'Tokenizer model mismatch.')
    try:
        result = requests.post(base + '/api/chat', json={
            'model': model, 'messages': [{'role': 'user', 'content': body.prompt}],
            'stream': False, 'think': False, 'keep_alive': '5m',
            'options': {'temperature': 0, 'num_ctx': 8192, 'num_predict': 1},
        }, timeout=(5, 120))
        result.raise_for_status()
        payload = result.json()
        count = payload.get('prompt_eval_count')
        if payload.get('model') != model or isinstance(count, bool) or not isinstance(count, int) or count <= 0:
            raise ValueError()
        return {'tokens': count, 'model': model, 'count_source': 'runtime-prompt-evaluation', 'context': 8192}
    except (requests.RequestException, ValueError):
        raise HTTPException(503, 'Pinned Gemma tokenizer unavailable.') from None

def configuration():
    model = os.environ.get('GEMMA_OLLAMA_GENERATION_MODEL', '')
    digest = os.environ.get('GEMMA_OLLAMA_GENERATION_DIGEST', '')
    if not re.fullmatch(r'gemma[0-9]+:[A-Za-z0-9_.-]+', model) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise HTTPException(503, 'A Google Gemma model and immutable digest must be configured.')
    return os.environ.get('GEMMA_OLLAMA_URL', 'http://127.0.0.1:11434').rstrip('/'), model, digest

@app.get('/health')
def health():
    base, model, digest = configuration()
    try:
        tags = requests.get(base + '/api/tags', timeout=(5, 10))
        tags.raise_for_status()
        if not any(row.get('name') == model and row.get('digest') == digest for row in tags.json().get('models', [])):
            raise ValueError()
    except (requests.RequestException, ValueError):
        raise HTTPException(503, 'Pinned Gemma model unavailable.') from None
    return {'status': 'ok', 'model': model, 'digest': digest, 'inference': 'real-local-google-model'}

@app.post('/generate')
def generate(body: GenerateRequest):
    identity = health()
    base, model, _ = configuration()
    schema = 'json'
    marker = 'The object must match this schema:\n'
    if marker in body.prompt:
        try:
            schema, _ = json.JSONDecoder().raw_decode(body.prompt.rsplit(marker, 1)[1])
        except ValueError:
            raise HTTPException(400, 'Invalid extraction schema.') from None
    try:
        response = requests.post(base + '/api/chat', json={
            'model': model, 'messages': [{'role': 'user', 'content': body.prompt}],
            'format': schema, 'stream': False, 'think': False, 'keep_alive': '5m',
            'options': {'temperature': 0, 'seed': 41, 'num_ctx': 8192, 'num_predict': 1800},
        }, timeout=(5, 240))
        response.raise_for_status()
        payload = response.json()
        if payload.get('model') != model or not isinstance(payload.get('message', {}).get('content'), str):
            raise ValueError()
        return {'response': payload['message']['content'], 'model': model, 'model_digest': identity['digest']}
    except (requests.RequestException, ValueError):
        raise HTTPException(503, 'Gemma generation failed; retry with the same model.') from None
