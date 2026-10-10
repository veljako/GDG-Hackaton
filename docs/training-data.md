# User profile training export

The selected dataset combines real account profiles with explicitly supplied
synthetic profiles. Export is a trusted backend command, not a public API. It
reads canonical Firestore users, confirms the corresponding Firebase Auth account
exists, and writes a private JSONL file. Imported records without Auth accounts
are skipped instead of being labelled real.

```powershell
npm.cmd run firebase:export-training -- --project gdg-hackathon-d0b85 --synthetic-source docs/firebase-sample-dataset.json --output .runtime/training/mixed-profiles.jsonl
```

Each line has `entity_id`, `data_origin` (`real` or `synthetic`), `input_version`,
`source_hash`, and structured `features`. Synthetic IDs use a `synthetic:` prefix.
Synthetic examples stay in the export; they are not inserted into the live users
collection or given login accounts. Outputs are never overwritten.

Features include headline, location, biography, status, professional experience,
skills, interests, roles, languages, education, work history and preferences.
The export omits dedicated names, email, phone, links, CV filename/object path and
raw PDF bytes. Account IDs and user-written text remain: this is a private feature
dataset, not a guarantee of anonymization. Keep it private when transferring to
the training environment.

The hash for real records fingerprints the exact stored canonical document, so
the existing embedding upsert can reject stale generated vectors. No labels,
outcomes, vectors, filled-in background or model targets are invented. Incomplete
profiles remain incomplete. CV parsing must populate reviewed structured fields
before those fields become useful training inputs.

For a local format check without credentials:

```powershell
npm.cmd run firebase:export-training -- --project gdg-hackathon-d0b85 --synthetic-source docs/firebase-sample-dataset.json --synthetic-only --output .runtime/training/synthetic-profiles.jsonl
```

The bundled synthetic profiles are a small set of demo examples, not sufficient
evidence of a trained model. The model pipeline still needs to select its target,
input recipe and real/synthetic sampling ratio. Keep synthetic-derived examples
and copies of the same source user together when selecting train/evaluation splits.
