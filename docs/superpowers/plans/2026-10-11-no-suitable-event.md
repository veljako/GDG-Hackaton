# No suitable event

Authorized by the user after the real local seven-CV/two-event evaluation.

Use one shared, versioned policy with an initial semantic minimum cosine similarity of 0.45. This is a provisional model-specific operational default, not production calibration or a probability. The worker filters recommendations before returning them; the Node API independently enforces the same floor after current eligibility checks. Empty successful recommendations return `outcome: no_suitable_event`; model outages retain their structured fallback warning. Browse/search and teammate retrieval retain their existing behavior.

Structured recommendations retain existing weights, score and evidence thresholds but require positive topic/acquired-skill/learning-skill overlap. Shared format, role or goal alone cannot create a personalized recommendation. The home page never pads personalized picks with unrelated events. Personal discovery and matching controls display a clear empty state and let users browse all events.

- [x] Write failing Python and Node tests for cutoff boundaries, invalid scores, positive retention, genuine empty results, browse behavior and structured fallback.
- [x] Implement shared policy, worker/API outcome, fallback content evidence and frontend empty states.
- [x] Rerun the unchanged real-extraction fixtures with fresh EmbeddingGemma inference and strengthen checks against weak secondary recommendations: 50/50 checks passed.
- [x] Run full tests/build and desktop/mobile browser fixtures: 190 Node tests, 265 Python tests, production build, and 12 browser checks passed. Scope and limitations recorded in `docs/local-matching-evaluation-2026-10-11.md`; no Firebase use or live worker restart during this local follow-up.
