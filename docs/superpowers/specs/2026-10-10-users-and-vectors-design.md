# Firebase users and vector storage

The user requested a Firebase user table with the seven supplied fields and separate vector storage for users and future hackathons. Generating embeddings and selecting embedding inputs/model are outside this change.

## Storage

Under `gdevPilots/main`, `users/{uid}` replaces active `people` documents. Fields are `user_id`, `location`, `status`, `birth_year`, `experience_level`, `skills`, `general_description`, plus existing application profile fields. Unknown status, birth year and experience level are null, never inferred from a name or free text. The frontend still uses `Person.id`, `city` and `bio`; the persistence adapter maps them to the canonical fields.

Schema 3 reads users. Schema 2/legacy workspaces read previous people/payload and migrate on a successful transaction. Previous people documents remain as a recovery snapshot; legacy payload retains its existing backup. Ambiguous overlapping user/people IDs cause a refusal before writing.

`userEmbeddings/{uid}` and `hackathonEmbeddings/{eventId}` contain native Firestore vector values, model, dimensions, source hash and update time. A trusted server repository supports upsert and cosine nearest-neighbor queries. Writes require an existing entity and a matching source hash. Queries restrict model/dimensions and omit missing or changed sources. Vector documents never join the full-workspace polling reads.

## Operations and verification

Trusted CLI commands validate vector JSON before cloud writes, read sources/hashes, upsert supplied vectors and search either collection. Index configuration is generated for an explicitly selected dimension (1–2048); no model/dimension is guessed. Direct browser access stays denied. Firebase UID remains immutable through existing authenticated profile updates.

Regression tests cover migration, field mapping, profile validation, stale vectors, model isolation, native vector serialization and both entity kinds. Run `npm.cmd run check`. Cloud activation needs backend ADC/IAM and index deployment; report it separately from local verification. This folder has no Git repository, so no commit/worktree is available.
