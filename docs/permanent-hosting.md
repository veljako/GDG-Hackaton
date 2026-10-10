# Permanent GEvents hosting

The current choice is Kaggle for training and temporary session hosting, with
Firebase Spark Hosting for the frontend. Kaggle sign-in and the model/dataset
details are still needed. See [kaggle-backend.md](kaggle-backend.md). The independent
machine setup remains available in [self-hosted-backend.md](self-hosted-backend.md).
The Google/Cloud Run option below is a legacy alternative, not the active plan.

The current Cloudflare Quick Tunnel is a temporary preview. No permanent cloud
deployment has been completed. The project owner is using a phone remotely.

## Free option: Render and Firebase Spark

`render.yaml` declares one Free Docker web service in Frankfurt. It serves both
the built React app and `/api` from the existing Dockerfile, using Render's
assigned `PORT`. No extra frontend domain or cross-origin API is required.

Deploy the sanitized application source to a Git provider repository, then
connect that repository to Render. The Git provider and Render account must be
authorized by the project owner. Choose the Hobby workspace and Free compute.
No repo has been published or Render account authorized in this session.

The web configuration is staged in `.env.firebase.local`. In Render's
Environment page, supply `FIREBASE_WEB_API_KEY` from that public configuration.
Set up a dedicated Firebase service account with Firestore read/write and
Firebase Authentication viewer permissions. Add its credential directly to
Render as the secret file `firebase-admin.json`; do not send it in chat, commit
it, or put it in frontend variables. The existing Node server reads the file
through `GOOGLE_APPLICATION_CREDENTIALS` and Firebase Admin ADC.

Enable Firebase Google Authentication and create the default Firestore
database. Publish `firestore.rules`; browser database access stays denied and
the authenticated API enforces application permissions. Add the exact Render
hostname to Firebase Authentication's authorized domains after deployment.

Free Render services sleep after 15 idle minutes and take about one minute to
wake. The included compute allowance is 750 hours per workspace per month.
Without a payment method, exhausting bandwidth suspends services and exhausting
build minutes pauses new builds instead of buying additional usage. Keep
Firestore on Spark: quota exhaustion can block operations. The app polls state
every two seconds while mounted, so database usage needs a live check before
claiming that any particular number of users fits those quotas.

## Google option: Firebase Hosting and Cloud Run

This legacy paid route was superseded by the separate-machine choice. Deployment is prepared in
`scripts/deploy-cloud.sh`, `scripts/deploy-hosting.mjs`, and `firebase.json`.
It requires the owner to enable Blaze and authorize Cloud Shell from their phone.
No cloud deployment has yet been run or verified.

The temporary phone handoff is recorded in `.runtime/deploy/handoff.json`.
Its command downloads an explicitly selected source package, checks SHA-256,
extracts into a new Cloud Shell directory, and executes the deployment script.
The package contains public Firebase web configuration, not private credentials.
Run `node scripts/package-phone-deploy.mjs` after rebuilding to make a fresh
handoff; preserve the existing handoff while the owner is using it. The download
uses the temporary Cloudflare preview, which must stay running until downloaded.

Deployment checks billing, enables required APIs, creates a dedicated runtime
identity with `roles/datastore.user` and `roles/firebaseauth.viewer`, and a build
identity with `roles/run.builder`. It creates default Firestore in Belgium only
if missing, deploys Cloud Run, publishes Firestore rules and Firebase Hosting,
adds permanent Auth domains when Auth is initialized, and checks public config
and exact homepage content. If a fresh IAM grant has not propagated, wait a few
minutes and rerun the command. Google sign-in may still require enabling its
provider in the Firebase Console before the end-to-end check.

Cloud Run uses request-based billing, zero minimum instances and two maximum
instances. These limits do not cap the total bill. Cloud Build, Artifact Registry,
networking, and Firestore have separate charges and quotas. Set a $10 budget
alert in Google Cloud Billing; alerts do not stop spending. The algorithm is
unchanged. The expected address after successful deployment is
`https://gdg-hackathon-d0b85.web.app`.

## Verification before announcing a permanent URL

- Public homepage loads at desktop and phone widths with the expected intro.
- `/api/health` is healthy and `/api/config` reports Firebase mode.
- A signed-in user can save data and recover it after a backend restart.
- `/api/state` rejects missing credentials and `/api/demo-session` returns 404.
- Google login works from the permanent authorized domain.
- The announced deployment corresponds to the expected build.

Sources: https://render.com/docs/free,
https://render.com/docs/blueprint-spec,
https://render.com/docs/configure-environment-variables,
https://firebase.google.com/docs/hosting/cloud-run,
https://cloud.google.com/run/pricing.
