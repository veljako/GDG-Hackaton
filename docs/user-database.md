# User database

The user schema and private CV persistence are implemented. Automatic CV extraction and the onboarding wizard follow separately. LinkedIn import is deferred.

The trusted [training export](training-data.md) combines real account profiles and
explicitly labelled synthetic examples without inserting fake login users.

## Canonical record

One document per verified Firebase Auth UID at `gdevPilots/main/users/{uid}`:

| Fields | Meaning |
| --- | --- |
| `user_id` | Verified Firebase UID, equal to the document ID; never client-editable |
| `first_name`, `last_name`, `name` | Explicit name parts and composed display name; original unsplit names are preserved until the user supplies parts |
| `email`, `email_verified` | Verified sign-in token claims; never accepted from profile edits |
| `phone` | Optional private contact number |
| `location`, `birth_year`, `status` | Location, nullable birth year and Student/Employed/Freelancer status |
| `title`, `general_description`, `school` | Headline, biography and existing school/organization text |
| `experience_level`, `experience` | Nullable Junior/Mid/Senior level and free-text background |
| `skills`, `interests`, `roles`, `languages` | Bounded arrays of profile details |
| `education` | Array of institution, degree, field, start/end date and description |
| `work_experience` | Array of company, position, location, start/end date and description |
| `avatar`, `color`, `lookingForTeam`, `preferences` | Existing presentation, team availability and private discovery preferences |
| `linkedin`, `kaggle` | Existing optional links; no OAuth import |
| `cv`, `cv_document` | Compatible display filename and authoritative private file metadata |
| `created_at`, `updated_at` | Server timestamps; unknown historical times remain null |

Education/work dates are `YYYY-MM` or null; end cannot precede start. Names are trimmed and limited to 100 characters each. Authenticated `UPDATE_PROFILE` accepts structured background for the future CV review screen. Existing `city`/`bio` API fields map to Firestore `location`/`general_description`.

Email, verification, phone, CV metadata/object paths, timestamps and preferences are removed from other users' API views, including organizer views. PDF download is owner-only. Account identity, CV metadata and timestamps cannot be forged through profile writes. Direct browser Firestore access remains denied.

## CV persistence

- `POST /api/cv?filename=your-cv.pdf`: raw `application/pdf` bytes with the normal Bearer ID token; maximum 5 MiB. The server checks the PDF header and generates an immutable key `cvs/{sha256(uid)}/{uuid}.pdf`. The filename never becomes a disk path.
- `GET /api/cv`: the signed-in user's file, returned as a private uncached attachment; no target user parameter or public download token.
- `POST /api/cv/remove` with `{}`: clears metadata then deletes the previous object.

Metadata contains `storage_path`, `filename`, `content_type`, `size_bytes`, `uploaded_at`, `extraction_status` and `extracted_at`. A failed metadata write cleans the new file and preserves the previous record. Replacement commits before deleting the old file. Cleanup failures are logged for maintenance.

Extraction starts at `not_started`. No extraction job, model call or fabricated extracted data is produced. Later onboarding will validate proposals through the profile schema, show changes for review and save only confirmed fields.

Demo files persist in `.runtime/backend/private-cvs`, outside public assets. `GEVENTS_CV_DIRECTORY` can select another private directory. Demo files and state must never be included in deployment archives.

In Firebase mode, set `FIREBASE_STORAGE_BUCKET` to an existing **private** Cloud Storage bucket name without `gs://`. The server uses its existing ADC identity. Grant that runtime identity `roles/storage.objectUser` on the bucket; enforce public access prevention and uniform bucket-level access. Firestore permissions alone do not grant file access. No bucket is created automatically. Without a configured bucket the API returns 503. Storage provisioning may require billing; it has not been performed from this machine.

For the temporary Windows backend, Firebase mode also accepts an explicitly set
`GEVENTS_CV_DIRECTORY` as private persistent server-disk storage when no cloud
bucket is set. Login and user profiles still use Firebase. Keep the directory out
of public assets, retain it when restarting and back it up with the database
metadata. This is a single-machine option: another backend cannot download these
files unless they are transferred. Do not use ephemeral notebook disk for this
option. Kaggle deployment continues to require the cloud bucket.

## Migration and activation

These additions retain workspace schema version 3. Old users normalize on read to empty names/arrays, null CV/email/timestamps and unverified email, without guessing name parts or creation dates. Original display names and relationship IDs remain intact. A successful transaction persists the defaults; legacy recovery documents remain untouched. New Firebase profiles get actual server creation timestamps.

After project authorization, the existing trusted migration CLI persists defaults and reads back canonical users:

```powershell
# Read-only preview:
npm.cmd run firebase:vectors -- --operation migrate-users --project gdg-hackathon-d0b85
# Apply and read back:
npm.cmd run firebase:vectors -- --operation migrate-users --project gdg-hackathon-d0b85 --apply
```

Stop old backend instances before switching builds and retain the usual backup. The 450 changed-record transaction guard still applies. Profile changes invalidate old embedding source hashes; regenerate embeddings through the algorithm when needed.

Before starting the Firebase backend, verify its actual runtime credential and
private CV bucket (this reads existing profiles without printing them and creates,
reads, then removes one randomly named disposable PDF probe):

```powershell
npm.cmd run firebase:check -- --project gdg-hackathon-d0b85
```

This checks backend access, not an end user's login. The Kaggle notebook runs the
same check before exposing its API. Real registration, profile persistence and CV
ownership still require the acceptance flow with a signed-in account.

Live cloud writes remain unverified: this workstation has no backend ADC or configured credential file, and no signed-in Firebase browser session is available to this task. The owner previously confirmed Firestore creation and enabled sign-in providers. Deploy the updated backend with project authorization and configure its private bucket before cloud CV acceptance.

## Verification

`npm.cmd run check` covers validation, token identity, privacy, structured Firestore round trips, migration, private CV upload/removal, invalid/oversized files, cross-user access, Cloud Storage adapter behavior and failed-write cleanup.

`node scripts/verify-user-db.mjs` targets a separate fictional-data server on port 5197 and checks desktop/phone profile persistence and CV upload/download/removal. `node --import tsx scripts/verify-registration.mjs` checks signup retry and saved name parts with intercepted Firebase responses. Neither browser check creates real cloud accounts.
