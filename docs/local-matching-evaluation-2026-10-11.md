# Real local matching evaluation — 11 October 2026

**The relevance gate now passes all 50 checks.** Five suitable profiles receive only their intended event; the two unrelated profiles receive an empty result with `outcome: no_suitable_event`. Before the gate, the extraction-corrected run passed 41 of 43 checks and still recommended weak matches. This is a small diagnostic sample, not an estimate of production accuracy.

Two synthetic events were used: an online machine-learning workshop with no prerequisites, and an online React/TypeScript hackathon requiring acquired React skills. Seven fictional CVs were generated as PDFs and parsed through the actual extractor. Interests, desired learning skills and preferences were supplied as explicit fictional onboarding answers, separately from the model's acquired-skill extraction.

Gemma `gemma2:2b` performed the real extraction. Google EmbeddingGemma produced actual 768-dimensional vectors using the configured immutable Ollama digest. The production narrative functions, eligibility helper, candidate search and `MatchingService.recommend_events` ran against ephemeral local Chroma storage. Event documents and retrieval queries used distinct document/query encoding, matching the production worker's convention. Firebase client construction and non-model network requests were blocked; no Firebase credentials or cloud data were loaded.

| Fictional profile                         | Intended event                      | AI cosine score |   Web cosine score | Worker recommendations |
| ----------------------------------------- | ----------------------------------- | --------------: | -----------------: | ---------------------- |
| Python data analyst                       | AI workshop                         |          0.6328 | 0.3343, ineligible | AI                     |
| Statistics student                        | AI workshop                         |          0.5841 | 0.3303, ineligible | AI                     |
| Excel beginner wanting to learn Python/ML | AI workshop                         |          0.6280 | 0.3451, ineligible | AI                     |
| React/TypeScript frontend developer       | Web hackathon                       |          0.2863 |             0.6646 | Web                    |
| React/Node full-stack developer           | Web hackathon                       |          0.2862 |             0.6085 | Web                    |
| Biologist/microscopy researcher           | Neither                             |          0.2626 | 0.3045, ineligible | None                   |
| Figma/UX designer wanting to learn React  | Neither under current prerequisites |          0.3036 | 0.5430, ineligible | None                   |

Scores are cosine similarities, not probabilities or percentages. User-to-event scores use profile query encoding against event document encoding. Event-to-user retrieval has its own query direction, so those numeric scores differ.

All five intended positive profiles ranked the correct event first, even before eligibility filtering. In the opposite direction, the AI event's top three were the learner, data analyst and statistics student; the web event's unfiltered top two were the frontend and full-stack developers. React eligibility excluded all five profiles lacking acquired React, including the designer who wants to learn it. All seven acquired-skill lists matched their declared lists without invented skills.

## Problems found

1. **Unrelated recommendations previously remained.** The biologist and designer received the AI workshop despite low scores, and frontend profiles received AI as a weak secondary result. The worker and API now independently require a finite cosine similarity of at least 0.45 for recommendations. This shared, versioned setting is a provisional operational default; further labeled positive, negative and borderline examples are needed for production calibration. Eligibility remains a separate requirement, so the designer's 0.543 Web similarity does not override the acquired React prerequisite. Search and teammate retrieval keep their existing behavior. Successful empty results do not trigger outage fallback; structured fallback requires real topic or skill overlap, and the UI never pads personal picks with unrelated events.
2. **Unrestricted eligibility was mis-extracted.** The model interpreted “all seniorities/statuses” and “no age restrictions” as explicit restrictions. One event also gained a Student restriction, incorrectly excluding employed React developers. Source-grounded normalization now clears these restrictions when the source explicitly says the audience is unrestricted. Regression tests cover both this case and genuinely restricted events.
3. **Literal metadata was lost.** The model omitted English and changed the stated Intermediate audience to Beginner. Normalization now recovers the explicitly labeled audience level and stated delivery language. The full Python regression suite passed: **263 tests**.
4. **CPU inference exceeded the current timeout.** The initial run stopped at event extraction with the normal 45-second client timeout. A separate run using a 240-second test-only timeout completed real extraction and embedding in about 253 seconds. Production timeout behavior was not changed and is not claimed to pass.

The final rerun reused recorded real extractions for identical PDF text/event sources, applied the normalization corrections, and recomputed actual embeddings and retrieval. Expectations and source texts were kept unchanged. The model and ranking weights were preserved; no relevance cutoff was added.

## Evidence and rerun

The reusable harness is `extractor_cv/evaluate_local_matching.py`.

- `.runtime/local-matching-evaluation/failure.json`: initial timeout failure.
- `.runtime/local-matching-evaluation-extended/`: original actual model output, seven PDF CVs, two event texts, original failed checks and vectors.
- `.runtime/local-matching-evaluation-final/report.md` and `report.json`: 41/43 checks before relevance filtering, rankings, pair scores, source records, explicit onboarding answers and allowed network call audit.
- `.runtime/local-matching-evaluation-final/vectors.json`: seven candidate vectors, two event query vectors and two event document vectors.
- `.runtime/local-matching-evaluation-gated/report.md`, `report.json`, and `vectors.json`: 50/50 checks after the relevance gate. This rerun reused the recorded real Gemma extraction for unchanged PDF text and event sources, then generated all eleven vectors again through actual EmbeddingGemma inference. Expectations remained unchanged; added checks also reject weak secondary recommendations and require the explicit empty outcome.
- `.runtime/no-suitable-event-browser/`: screenshots and 12 passing desktop/mobile checks at 1440px and 390px. This separate UI test uses synthetic scores and a loopback in-memory API; it verifies home/For you empty states, one positive pick without padding, no semantic-empty fallback, all-event browsing, and no browser errors or horizontal overflow.

The full application check passed 190 Node tests, both TypeScript checks, and the production build; the Python suite passed 265 tests. No Firebase or live worker restart was used for this follow-up. No schema migration or re-embedding is required for the relevance policy.

The shared cutoff is in `src/recommendation-policy.json`. To rerun the isolated UI checks:

```powershell
node --import tsx scripts/verify-no-suitable-event.mjs
```

From `C:\GDG`, with the existing local model services running:

```powershell
$env:GEMMA_OLLAMA_EMBED_DIGEST='85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1'
& 'C:\Users\urosd\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/python-project.py extractor_cv/evaluate_local_matching.py --generation-timeout 240 --output .runtime/local-matching-evaluation-rerun
```

Omit `--generation-timeout 240` to test the existing 45-second timeout. Add `--reuse-extraction .runtime/local-matching-evaluation-final/report.json` to reuse the recorded real extraction for unchanged sources while regenerating embeddings and retrieval. The model harness does not exercise live Firestore, HTTP authentication, durable queues, or provider source-revision guards. The separate browser harness exercises the local demo HTTP API. The production worker was not restarted or deployed during this Firebase-free test.
