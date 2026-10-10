# Dataset and real-user registration

The code and local tests are ready. No live Firebase import, provider activation or deployment has been performed in this task. Google console access was blocked by automatic approval review, and this machine has no configured backend Application Default Credentials.

## Data your team can edit

`firebase-sample-dataset.json` contains the validated current source samples: 12 people, 7 events, 4 teams, 13 applications, 1 invitation, 3 notifications and 3 connections. It comes from `src/seed.ts`; if the running demo has newer changes, use its state file with `--source` instead. Dry-run validation checks required fields, duplicate IDs and references.

The Firestore layout is:

```text
gdevPilots/main                     schemaVersion, revision, updatedAt
  users/{personId}                  canonical profile; user_id equals verified UID
  userEmbeddings/{personId}         supplied native vector and model/source metadata
  hackathonEmbeddings/{eventId}     supplied native hackathon vector and metadata
  events/{eventId}                  event details and audience criteria
  teams/{teamId}                    event, captain and member references
  applications/{applicationId}     person/event/team and admission status
  invitations/{invitationId}       sender, recipient, team and response
  notifications/{noticeId}         recipient, message and read state
  connections/{sha256}              key = personId:otherId
  backups/legacy-v1                 retained old payload after legacy conversion
```

Document fields are ordinary Firestore fields, not a JSON payload. Keep each entity's `id` equal to its document ID; users use `user_id` instead. The dataset/API still uses people/id/city/bio, mapped to users/user_id/location/general_description on persistence. Keep referenced IDs consistent. Real profiles are keyed by Firebase Auth UID. Sample people remain fictional dataset records, have no login accounts and cannot receive actionable invitations as real users. For a real pilot, prepare an empty or event-only dataset before the first live import, or use a separate test project for the full samples. See [users and vectors](firebase-vectors.md) for schema-3 migration, user metadata and vector operations.

Private preferences, applications and notifications stay behind the existing authorized API. The supplied Firestore rules deny direct browser access; use Firebase Console/IAM for trusted dataset maintenance. The browser never holds Admin credentials.

## Import deliberately, before opening registration

Configure `.env.firebase.local` or `.env.server.local` with the project's public web settings and `FIREBASE_PROJECT_ID=gdg-hackathon-d0b85`. Configure backend ADC or a service-account file outside this repository. Do not send private credentials in chat. The import reads `.env.server.local` when present, otherwise `.env.firebase.local`; environment variables take precedence.

```powershell
# Validate the reviewed file; no cloud connection or writes.
npm.cmd run firebase:import -- --project gdg-hackathon-d0b85 --source docs/firebase-sample-dataset.json

# Explicit import into an EMPTY workspace, followed by Firestore readback.
npm.cmd run firebase:import -- --project gdg-hackathon-d0b85 --source docs/firebase-sample-dataset.json --apply

# Or preserve a specific running demo's saved data instead of the source samples.
npm.cmd run firebase:import -- --project gdg-hackathon-d0b85 --source .runtime/backend/state.json
```

The `--project` argument must match the configured project. Existing workspace records cause an atomic refusal; no overwrite or reset flag is provided. Do not register the first real account before the initial import, because even one profile makes the workspace nonempty. Export a new sample file with `--export <new-path>`; existing files are never overwritten.

A legacy `gdevPilots/main.payload` workspace is read normally and converts to entity documents on its next successful server write; the old payload is retained under `backups/legacy-v1`. Do not combine an unconverted legacy payload with manually created collection data.

## Activate registration

In Firebase Authentication > Sign-in method, enable **Email/Password** (password accounts, not email-link login) and **Google**. Add the actual frontend hostname to Authorized domains. Enable email enumeration protection and configure an appropriate password policy in Firebase. The frontend asks for at least eight characters and Firebase enforces the project's policy. See [Firebase password authentication](https://firebase.google.com/docs/auth/web/password-auth).

After importing, start the backend in Firebase mode using its public configuration and backend identity:

```powershell
npm.cmd run server:firebase
```

This command uses `.env.firebase.local`; its configured API port is separate from the demo preview. For the combined development server, put Firebase mode/config in `.env.server.local` and use `npm.cmd run dev`. For remote hosting, deploy the changed source/backend and frontend using the existing hosting instructions. A build alone does not switch a running demo API to Firebase.

The registration gate offers Google, email sign-in, account creation and password reset. Passwords go directly to Firebase Auth. The API verifies the ID token, creates one minimal profile per UID and derives organizer access only from server-configured UIDs. A failed API connection after account creation offers Retry connection, including after reload; it does not recreate the Auth account.

## Verification and next step

`npm.cmd run check` checks the implementation and existing domain permissions. `node --import tsx scripts/verify-registration.mjs` checks the real browser SDK and UI with intercepted Firebase responses; set `GEVENTS_URL` to an isolated preview. It creates no cloud accounts. Live acceptance still requires provider activation, an authorized frontend domain, working backend IAM/ADC, actual Firestore import/readback and a real signup/login plus saved-profile check.

The repository reads the seven active workspace collections in a transaction so current domain operations remain consistent, and reads legacy people during schema-2 migration. Vector collections are excluded. Polling remains approximately every two seconds. This is a small pilot; quota and performance need measurement before expanding usage. One import/update is limited to 450 changed/deleted entity records; no scalability claim is implied.

Onboarding is deferred. New users start with empty skills, interests and bio. Your team can prepare its taxonomy, required profile fields and model dataset before defining the onboarding flow.

The user database now also supports explicit first/last names, authenticated email, private phone, structured education/work history, languages and private CV metadata. Unknown legacy names/timestamps are preserved rather than guessed. See [the user database contract](user-database.md). PDF file persistence is implemented; automatic extraction remains deferred.
