# Gemma matching validation — 11 October 2026

The implemented pipeline passes the generated sample and live service checks after correcting failures found during testing. It uses Gemma for extraction/query interpretation, Google EmbeddingGemma for retrieval, and native vectors in the existing Firestore database. Inference currently runs locally on the development PC; it has not been deployed to Google GPU hosting.

## Generated CV comparison

Eight fictional PDF CVs cover English and Serbian Latin, Python/data, frontend, senior engineering, design, machine learning and science. Names are seeded randomly; known skills and eligibility labels are authored before inference. The actual Gemma2 2B run passes all 32 checked extraction fields: skills, city, status and seniority across eight CVs. Deliberately absent fields remain absent. This does not measure every possible CV field or scanned-PDF OCR quality.

The twenty-case matching run uses those unchanged real extraction records, actual pinned EmbeddingGemma 300M vectors and the live `gdg-hackathon-d0b85` Firestore database. Each run uses a separate `gdevEvaluations/<uuid>` workspace; test vector documents are removed by exact reference. Matching replay is explicit: extraction is not called again during that comparison, and no mocked extraction or lexical vectors are substituted.

| Retriever | Expected result first | Expected result within top three |
|---|---:|---:|
| EmbeddingGemma semantic retrieval | 18/20 | 20/20 |
| Exact skill/tag overlap baseline | 14/20 | 17/20 |

All twenty required ranking/exclusion cases pass; direct queries require rank one and seven paraphrase cases permit the top three. There are zero explicit city, age or seniority eligibility violations. Identical candidate/event upserts reuse embeddings, and test cleanup passes. The baseline uses the same extracted records and hard constraints; it is not the complete existing application recommender.

Eight real CV extractions took about 170 seconds on this PC (about 21 seconds each). The separate Firestore matching replay took about 31 seconds including indexing and cleanup; twenty matching cases accounted for about 20 seconds. These are sample-run timings, not production latency guarantees.

## Application and worker verification

- 228 Python tests and 135 Node tests pass. Server/frontend typechecks and production build pass.
- Actual private worker HTTP checks pass for unauthorized-request rejection, budgeted Gemma PDF extraction, saved-proposal recovery, reviewed-field confirmation, durable job deduplication, real EmbeddingGemma refresh, Gemma query interpretation, Firestore event search/recommendations, and safe CV replacement. Its Node confirmation transaction is emulated; actual Node authorization and race behavior are tested separately.
- Desktop 1440px and phone 390px browser checks pass for loading, unavailable-model fallback, CV review and horizontal overflow. The public Firebase build/auth screen and unauthorized matching endpoint protection pass with no browser errors. No real user sign-in is impersonated by these checks.
- All nine required collection-specific vector index shapes are READY. Existing index definitions are preserved.

Testing caught and fixed Serbian labelled-field omissions, guessed missing seniority, copied skill headings, stale authorization after inference, non-atomic proposal confirmation, full-event teammate access, empty UI filters cancelling interpreted constraints, premature Cloud Tasks acknowledgement and index deployment matching/order errors.

This small synthetic dataset supports a measurable improvement over exact skill overlap. It does not establish population-wide accuracy. Two paraphrases still place another candidate first, although the expected candidate appears within the top three. CV proposals remain subject to user review. Google-hosted model deployment and managed Cloud Tasks dispatch have not been live-deployed; the local worker's durable Firestore poller is active.

## Evidence and reproduction

See [runtime setup](gemma-matching.md) and [evaluation commands](gemma-matching-evaluation.md). Local generated evidence:

- [Actual extraction output](../.runtime/gemma-firestore-final.json) — extraction passes; its original matching phase records the then-missing cloud index honestly.
- [Final Firestore comparison](../.runtime/gemma-firestore-matching-final.md) and [numeric output](../.runtime/gemma-firestore-matching-final.json).
- [Actual worker integration](../.runtime/gemma-worker-live-verification.json), [desktop/mobile UI](../.runtime/gemma-ui-verification.json), and [public build/auth verification](../.runtime/gemma-public-verification.json).
- [Example Python CV](../.runtime/synthetic-cvs-e49d74ffe0cc4e8dae706896a4dba32b/synthetic-python.pdf) and [Serbian science CV](../.runtime/synthetic-cvs-e49d74ffe0cc4e8dae706896a4dba32b/synthetic-science.pdf).
