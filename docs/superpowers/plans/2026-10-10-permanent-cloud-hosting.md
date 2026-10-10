# Permanent cloud hosting implementation plan

**Goal:** Deploy the existing GEvents app to Firebase Hosting and Cloud Run in
`gdg-hackathon-d0b85`, with a permanent URL and Firebase server identity.

**Architecture:** Firebase Hosting serves `dist` and rewrites `/api/**` to the
`gevents` Cloud Run service in `europe-west1`. Cloud Run uses its own service account
for Firestore and token revocation checks. A Cloud Shell deployment package lets
the project owner authorize deployment from a phone without sharing credentials.

**Constraints:** No algorithm changes. No private credentials in source,
packages, frontend configuration, or chat. Keep the existing preview working.
Use request-based Cloud Run billing, zero minimum and two maximum instances.
Limits and budget alerts are not a hard spending cap. The owner must enable
billing and authorize Cloud Shell; this machine is not signed into Google.

## Tasks

- [x] Add `firebase.json` Hosting configuration and `deploy/firebase-web.json`.
- [x] Add `scripts/deploy-cloud.sh`: check billing; enable APIs; create limited
  runtime/build identities; create default Firestore only if missing; deploy the
  existing Dockerfile; publish Hosting and rules through Google-authorized APIs.
- [x] Add `scripts/deploy-hosting.mjs` using the official Hosting REST API and
  Cloud Shell's `gcloud auth print-access-token`, never printing credentials.
- [x] Test the Hosting API sequence with mocked requests, including upload
  failure preventing publication, API rewrites, file hashes, and secret exclusion.
- [x] Run `npm.cmd run check`; validate Bash syntax and source package contents.
- [x] Create a temporary phone handoff page with a verified download checksum,
  copyable command, billing and Cloud Shell links, and the precise deployed roles.
- [ ] Owner enables billing and authorizes/runs the command in Cloud Shell.
- [ ] Verify the permanent URL, actual build, Google login, API authorization,
  Firestore persistence, and mobile/desktop behavior before claiming deployment.
