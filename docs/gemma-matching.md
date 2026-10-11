# Gemma matching runtime

The website now supports semantic event search, profile-based event recommendations, teammate retrieval and reviewed CV extraction. Public profiles and events remain canonical in Firestore. Native vectors live in `userEmbeddings` and `eventEmbeddings` in the same database. No second production database is required.

Gemma generates structured extraction/query proposals; Google EmbeddingGemma generates 768-dimensional retrieval vectors. Generated CV fields require explicit confirmation. Authentication, capacity, membership, dates and eligibility are enforced by the Node API against fresh canonical state after inference. Similarity is a retrieval score, not a probability.

## Services

Configure the Node API with `GEMMA_WORKER_URL=http://127.0.0.1:8001` and a random `GEMMA_WORKER_TOKEN` of at least 24 characters. Keep the same token in the Python worker environment, outside tracked files. Start the worker with `python -m matching_worker` from `extractor_cv`, or `python scripts/python-project.py -m matching_worker` for this workspace's bundled development runtime.

The worker requires Google Application Default Credentials, `FIREBASE_PROJECT_ID` and optionally `FIREBASE_WORKSPACE` (default `gdevPilots/main`). Firestore rules deny direct client reads of vectors, proposals and jobs. Never send worker credentials to the browser.

Generation configuration:

```text
GEMMA_GENERATE_URL=https://YOUR-GEMMA-SERVICE/generate
GEMMA_GENERATION_MODEL=YOUR-EXACT-GEMMA-MODEL-ID
GEMMA_GENERATION_HEALTH_URL=https://YOUR-GEMMA-SERVICE/health
GEMMA_TOKENIZE_URL=https://YOUR-GEMMA-SERVICE/tokenize
GEMMA_GENERATION_CONTEXT_TOKENS=8192
GEMMA_GENERATION_MAX_OUTPUT_TOKENS=1800
```

The generation adapter accepts `{prompt}` and returns `{response: "JSON object as text"}`. Health reports the exact configured model. Tokenization accepts `{prompt, model}` and returns `{tokens: integer}` for the complete chat framing; a deployed local tokenizer can instead be configured with `GEMMA_TOKENIZER_PATH`. Context and output budgets must agree with the inference service. Overflow refuses inference rather than truncating CVs silently.

For Google-hosted inference, deploy Gemma and EmbeddingGemma on Google GPU infrastructure and expose these adapter contracts privately. The existing `gemma_embed_route.py` provides the EmbeddingGemma `/embed` contract. Configure `GEMMA_WORKER_EMBED_BACKEND=gemma`, `GEMMA_EMBED_URL`, and the actual immutable 40-character Hugging Face `GEMMA_EMBED_REVISION` on both sides. Model/revision/dimensions/narrative recipe form an isolated vector contract.

Development verification can use Google weights in the installed Ollama runtime: `GEMMA_WORKER_EMBED_BACKEND=ollama-gemma`, `GEMMA_OLLAMA_EMBED_DIGEST=<actual 64-character SHA-256>`, and `gemma_local_bridge.py` configured with `GEMMA_OLLAMA_GENERATION_MODEL` and `GEMMA_OLLAMA_GENERATION_DIGEST`. This is a local inference runner, not a Google-hosted deployment. Its token preflight uses the actual runtime's prompt evaluation; a count saturated by context clipping is rejected by the reserved output budget. Production workers reject OpenAI and lexical test embeddings.

## Indexes and durable refresh

Preview `python scripts/prepare-gemma-indexes.py`; apply with `--apply --project YOUR-PROJECT`. Deployment adds required index shapes and preserves existing indexes. The credential needs permission to create Firestore indexes, such as Cloud Datastore Index Admin. Wait until index state is READY before nearest-neighbor queries.

Successful canonical profile, event and CV changes notify `queue_sync` with fresh authoritative context. Deterministic `embeddingJobs` survive worker restart; transactions protect leases and source revisions. Unchanged vectors reuse cached embeddings. Failed notifications preserve the saved canonical change and return a visible warning. Retrieval also fills cold indexes for the bounded pilot.

The local worker polls durable jobs. Optional Google Cloud Tasks delivery uses `GEMMA_TASKS_QUEUE=projects/.../locations/.../queues/...` and HTTPS `GEMMA_WORKER_PUBLIC_URL`. Use a private, authenticated worker deployment. Retryable jobs return HTTP 503 with `Retry-After`; terminal states are acknowledged explicitly. Failed jobs stop after five attempts. After investigating and fixing the service, an operator can run `python -m matching_jobs --retry-failed JOB_ID --expected-attempts 5` with the same workspace/credentials to start a new bounded retry cycle. A canonical matching-field edit creates a new revision/job. Do not change model contracts to bypass an outage.

## Verification

Run `npm run check` and Python unittest discovery. The fictional PDF/live model/Firestore evaluation and baseline comparison are documented in [gemma-matching-evaluation.md](gemma-matching-evaluation.md). Offline tests explicitly mock inference; they do not prove semantic model quality. Live evaluations use a separate workspace and delete only their own vector documents.
