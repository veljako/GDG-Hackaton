# Backend on a separate machine

This prepared alternative uses Firebase Hosting on Spark for the frontend and the existing
Node backend on an independently managed machine. Firebase Auth and Firestore
remain in use. No Cloud Run service or Blaze upgrade is needed for this route.
The user's latest selection is Kaggle for training and temporary hosting instead.

Kaggle is unsuitable for a persistent API because CPU/GPU notebook sessions have
a 12-hour runtime limit: https://www.kaggle.com/docs/notebooks.

## Current deployment status

No remote deployment has been completed. On 2026-10-10, `Quanta3` accepted an SSH
connection but rejected authentication for `zki`. `nova_Z8_sa_3090` timed out.
The current Windows SSH directory contains no private key file. Working SSH
access, a Firebase backend credential and a public HTTPS API address are still
required. Never send private keys or service account JSON through chat.

## Start the backend on a Linux machine

Install Docker Engine with the Compose plugin. Transfer the prepared source
archive to a new directory and extract it. The Dockerfile uses Node 24 and builds
the existing app; the backend also serves the frontend for a same-origin check.

Copy `deploy/backend.env.example` to `deploy/backend.env`. Fill in the public
Firebase web API key from `deploy/firebase-web.json`, and the actual organizer
UIDs. The other Firebase values are already set to `gdg-hackathon-d0b85`.

Create a dedicated Firebase service account with `roles/datastore.user` and
`roles/firebaseauth.viewer`. Store its credential outside the source directory,
accessible only to the deployment user. The credential is mounted read-only into
the container and excluded from source packaging. Do not put it in a Vite variable.

From the extracted source directory:

```bash
export GEVENTS_FIREBASE_CREDENTIALS="$HOME/.config/gevents/firebase-admin.json"
docker compose -f deploy/compose.self-hosted.yaml up --build -d
curl --fail http://127.0.0.1:5181/api/health
curl --fail http://127.0.0.1:5181/api/config
docker compose -f deploy/compose.self-hosted.yaml logs --tail=50 backend
```

The credential path must point to an existing service-account file. The Compose
service uses Firebase mode, restarts after a crash/reboot when Docker is running,
and exposes port 5181 only on the machine's loopback interface. Firestore stores
application data across container restarts. The container's health probe checks
HTTP responsiveness; a signed-in read/write check is still needed to prove
Firestore and Firebase Authentication permissions work.

Put an HTTPS reverse proxy or a persistent named tunnel in front of that loopback
port. Configure its public hostname as the API origin. A Cloudflare Quick Tunnel
can be used for a temporary check, but its address is not a permanent deployment.
This server uses no GPU; sufficient uptime and working access matter more than
GPU power for the current application.

## Connect the Firebase-hosted frontend

`src/backend.ts` reads `VITE_API_ORIGIN` at build time. An empty value preserves
the existing same-origin local workflow. For separate hosting, set it to the
backend's HTTPS origin without a path, credentials or query string.

In PowerShell, once the real HTTPS API origin has been selected:

```powershell
$env:VITE_API_ORIGIN = Read-Host 'Public HTTPS backend origin'
npm.cmd run build
npx.cmd firebase-tools deploy --project gdg-hackathon-d0b85 --config firebase.self-hosted.json --only hosting,firestore:rules
```

Use `firebase.self-hosted.json` explicitly: it contains static hosting and SPA
routing without a Cloud Run rewrite. The legacy `firebase.json` still describes
the old Cloud Run route. Firebase CLI authentication must belong to the project
owner. The frontend build excludes `dist/deploy` from Hosting to avoid publishing
temporary deployment archives.

The backend's `GEVENTS_ALLOWED_ORIGINS` lists the exact `.web.app` and `.firebaseapp.com`
frontend origins. If a custom frontend domain is used, add its exact HTTPS origin
and restart the container. Also authorize the frontend hostname in Firebase
Authentication and enable Google sign-in. API requests retain bearer-token
authentication; CORS does not grant access to private state or organizer actions.

## Acceptance checks

- `/api/health` and `/api/config` work over the public HTTPS API origin in Firebase mode.
- An unauthenticated `/api/state` request returns 401; demo login returns 404.
- The Firebase frontend loads at desktop and phone widths with no browser errors.
- Google sign-in, profile save, event registration and organizer permissions work.
- A saved change remains after a backend restart.
- Untrusted browser origins cannot call authenticated mutations.

Local unit tests cover API URL configuration, preflight requests, trusted reads
and writes, anonymous access rejection and untrusted origins. Local browser
verification uses isolated demo state and distinct frontend/backend ports; it
does not claim remote Firebase credentials or persistence have been verified.
