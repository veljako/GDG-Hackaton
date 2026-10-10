# Firebase users and supplied embeddings

Implemented locally; live migration, vector index deployment and cloud nearest-neighbor readback require authorized Firebase access. The embedding model and dimensions have not been selected. No synthetic vectors or model API calls are created by this feature.

## Collections

The complete identity/background fields and private CV storage contract are in [user database](user-database.md). Name parts, authenticated email, education/work history, languages and CV metadata are compatible additions to schema 3.

```text
gdevPilots/main                           schemaVersion: 3
  users/{firebaseAuthUid}                 canonical user profile
  events/{eventId}                        existing events, including hackathons
  userEmbeddings/{firebaseAuthUid}        native user vector and metadata
  hackathonEmbeddings/{eventId}           native hackathon vector and metadata
  people/{oldPersonId}                    retained schema-2 recovery snapshot, if migrated
```

Firestore has collections/documents rather than SQL tables. Collections appear after their first document write. Registering a real account through the Firebase API creates the user keyed by verified UID. The new backend must be running/deployed for this layout to be used.

Each user contains `user_id`, `location`, `status`, `birth_year`, `experience_level`, `skills`, and `general_description`, plus the existing name, avatar, roles, links and preference fields. Status is Student/Employed/Freelancer; experience_level is Junior/Mid/Senior. Unknown status, year and level are null. `birth_year` accepts integer years from 1900 through the current year. Existing `experience` free text and `preferences.level` retain their distinct meanings and do not infer the new level.

The API continues to accept `UPDATE_PROFILE` with `personId` and `changes`. Existing `city` and `bio` map to Firestore `location` and `general_description`. New changes may include `status`, `birth_year` and `experience_level`; null clears these values. Existing profile ownership checks apply, and user_id comes from verified identity, never a editable request field. Direct browser Firestore access remains denied by `firestore.rules`.

## Migrate existing users

Stop old schema-2 backend instances before deploying the new backend: old servers do not understand schema 3. Take the usual production backup. The new repository reads schema-2 people and legacy JSON without modifying them. A successful write migrates active profiles to users and sets schemaVersion to 3. Old people documents are retained as recovery data and ignored by schema-3 reads; edits to them no longer affect active users. Legacy payload conversion retains `backups/legacy-v1`.

An explicit trusted migration is also available:

```powershell
# Cloud read and migration preview, no write:
npm.cmd run firebase:vectors -- --operation migrate-users --project gdg-hackathon-d0b85
# Transactional migration and canonical user readback:
npm.cmd run firebase:vectors -- --operation migrate-users --project gdg-hackathon-d0b85 --apply
```

If users and old people overlap before migration, the command refuses before writing. Resolve the conflict deliberately; it never chooses one record silently. The pilot's 450 changed-record transaction limit still applies. Embedded vectors live separately and are not loaded or overwritten by workspace mutations, resets or polling.

## Store vectors from your algorithm

Use backend ADC/IAM as described in `firebase-setup.md`. The CLI loads `.env.server.local` if present, otherwise `.env.firebase.local`. `--project` must match FIREBASE_PROJECT_ID.

1. Read the current canonical record and fingerprint:

```powershell
npm.cmd run firebase:vectors -- --operation source --kind user --id USER_UID --project gdg-hackathon-d0b85
```

2. Your algorithm chooses which fields to embed and generates the vector. Prepare a JSON file with this shape (three dimensions shown only as a format example):

```json
{
  "entity_id": "USER_UID",
  "model": "your-model-and-input-version",
  "source_hash": "THE_64_HEX_CHARACTER_HASH_FROM_SOURCE",
  "vector": [0.12, 0.34, -0.56]
}
```

3. Validate locally, then upsert the real supplied vector:

```powershell
npm.cmd run firebase:vectors -- --operation upsert --kind user --project gdg-hackathon-d0b85 --source user-vector.json
npm.cmd run firebase:vectors -- --operation upsert --kind user --project gdg-hackathon-d0b85 --source user-vector.json --apply
```

The no-apply command validates the file without cloud access. The apply command uses a transaction to verify source existence/hash, then stores `embedding` as `FieldValue.vector`, with entity_id, model, dimensions, source_hash and updated_at. Changing a profile while a worker generates its vector causes the stale write to be refused. A later profile change makes its old vector ineligible for repository search until refreshed. The hash is a fingerprint of the whole source record; it does not mean all fields are embedded. Include input recipe/version in the model identifier so different embedding spaces cannot mix.

Use `--kind hackathon --id EVENT_ID` for hackathon sources and `--kind hackathon` for vector upserts. The source must be a hackathon (including legacy hackathon events); conference/meetup/festival events are rejected. Each entity currently holds one active vector; a new upsert replaces it. Vectors must have 1–2048 finite components and must be nonzero for cosine search.

## Indexes and nearest-neighbor queries

Once your algorithm's output dimension is known, generate both indexes. Example for an explicitly chosen 768-dimensional model:

```powershell
# Preview JSON, no filesystem/cloud mutation:
npm.cmd run firebase:vectors -- --operation indexes --dimensions 768
# Add both vector indexes to the existing file; preserve other indexes:
npm.cmd run firebase:vectors -- --operation indexes --dimensions 768 --apply
# With an authorized Firebase CLI, deploy and inspect index readiness:
firebase deploy --only firestore:indexes --project gdg-hackathon-d0b85
firebase firestore:indexes --project gdg-hackathon-d0b85
```

`firestore.indexes.json` starts empty because no embedding dimension has been approved. Do not deploy that empty file against a project with existing unmanaged indexes; first export/sync its index configuration. The generator preserves existing indexes and can add a different dimension without removing previous ones. Each generated index has model and dimensions ascending fields, followed by the embedding vector field. Wait for indexes to finish building before running search.

For search, prepare a JSON file with `model`, `vector`, and optional `limit` (default 10, maximum 1000). Use the same embedding space/model and dimension as the stored vectors:

```powershell
npm.cmd run firebase:vectors -- --operation search --kind user --project gdg-hackathon-d0b85 --source query-vector.json
npm.cmd run firebase:vectors -- --operation search --kind hackathon --project gdg-hackathon-d0b85 --source query-vector.json
```

Search uses COSINE distance and returns entity_id/distance only. Lower distance means closer vectors; it is not a probability. Query filters isolate model/dimensions; source readback removes deleted, stale and invalid entities. This may return fewer than limit results and does not backfill beyond the requested candidate count. Additional user metadata filters and combining vector scores with the existing event recommendations are separate algorithm work. There is no public vector endpoint and no automatic generation.

Local verification: `npm.cmd run check` covers profile validation, migration, model/dimension guards, native vector serialization, stale writes/results and index configuration. Tests use a Firestore transaction/query double; they do not verify cloud IAM or actual Firestore KNN execution.

References: [Firestore vector search](https://firebase.google.com/docs/firestore/vector-search), [index JSON format](https://firebase.google.com/docs/reference/firestore/indexes).
