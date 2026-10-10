#!/usr/bin/env bash
set -euo pipefail
trap 'printf "\nDeployment stopped at line %s. Keep the error above; no credentials are needed in chat.\n" "$LINENO"' ERR
cd "$(dirname "${BASH_SOURCE[0]}")/.."
TASK_PROJECT="gdg-hackathon-d0b85"
TASK_REGION="europe-west1"
TASK_SERVICE="gevents"
TASK_RUNTIME="gevents-runtime@${TASK_PROJECT}.iam.gserviceaccount.com"
TASK_BUILDER="gevents-build@${TASK_PROJECT}.iam.gserviceaccount.com"

echo "Deploying GEvents to Firebase Hosting + Cloud Run in ${TASK_PROJECT}."
echo "Google may ask you to authorize Cloud Shell. Credentials stay in Google."
gcloud config set project "$TASK_PROJECT" --quiet
TASK_BILLING="$(gcloud billing projects describe "$TASK_PROJECT" --format='value(billingEnabled)')"
if [[ "$TASK_BILLING" != "True" && "$TASK_BILLING" != "true" ]]; then
  echo "Billing is not enabled. Enable Blaze, then rerun this command:"
  echo "https://console.firebase.google.com/project/${TASK_PROJECT}/usage/details"
  exit 1
fi
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com iam.googleapis.com \
  identitytoolkit.googleapis.com firebasehosting.googleapis.com \
  firebaserules.googleapis.com --project="$TASK_PROJECT" --quiet

for TASK_ID in gevents-runtime gevents-build; do
  TASK_EMAIL="${TASK_ID}@${TASK_PROJECT}.iam.gserviceaccount.com"
  if [[ -z "$(gcloud iam service-accounts list --project="$TASK_PROJECT" --filter="email=${TASK_EMAIL}" --format='value(email)')" ]]; then
    gcloud iam service-accounts create "$TASK_ID" --display-name="$TASK_ID" --project="$TASK_PROJECT" --quiet
  fi
done
for TASK_ROLE in roles/datastore.user roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "$TASK_PROJECT" \
    --member="serviceAccount:${TASK_RUNTIME}" --role="$TASK_ROLE" --condition=None --quiet >/dev/null
done
gcloud projects add-iam-policy-binding "$TASK_PROJECT" \
  --member="serviceAccount:${TASK_BUILDER}" --role=roles/run.builder --condition=None --quiet >/dev/null

# The default database is created only when the authenticated list confirms
# it is absent. Existing databases and their regions/data are preserved.
gcloud firestore databases list --project="$TASK_PROJECT" --format=json > deploy/databases.local.json
if ! node --input-type=module -e 'import fs from "node:fs"; const rows=JSON.parse(fs.readFileSync("deploy/databases.local.json","utf8")); process.exit(rows.some(db=>db.name.endsWith("/(default)"))?0:1)'; then
  gcloud firestore databases create --database='(default)' --location="$TASK_REGION" \
    --type=firestore-native --project="$TASK_PROJECT" --quiet
fi
node --input-type=module <<'NODE'
import fs from "node:fs";
const web=JSON.parse(fs.readFileSync("deploy/firebase-web.json","utf8"));
const env={
  GEVENTS_BACKEND_MODE:"firebase", GEVENTS_API_HOST:"0.0.0.0",
  FIREBASE_PROJECT_ID:web.projectId, FIREBASE_WEB_API_KEY:web.apiKey,
  FIREBASE_AUTH_DOMAIN:web.authDomain, FIREBASE_WEB_APP_ID:web.appId,
  GEVENTS_ALLOWED_ORIGINS:`https://${web.projectId}.web.app,https://${web.projectId}.firebaseapp.com`,
};
fs.writeFileSync("deploy/cloudrun.env.local.yaml",Object.entries(env).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join("\n")+"\n");
NODE

echo "Building and deploying. This can take several minutes."
gcloud run deploy "$TASK_SERVICE" --source=. --project="$TASK_PROJECT" \
  --region="$TASK_REGION" --service-account="$TASK_RUNTIME" \
  --build-service-account="projects/${TASK_PROJECT}/serviceAccounts/${TASK_BUILDER}" \
  --env-vars-file=deploy/cloudrun.env.local.yaml \
  --allow-unauthenticated --ingress=all --min=0 --max=2 \
  --cpu=1 --memory=512Mi --concurrency=40 --timeout=60 \
  --cpu-throttling --no-cpu-boost --quiet

TASK_RUN_URL="$(gcloud run services describe "$TASK_SERVICE" --project="$TASK_PROJECT" --region="$TASK_REGION" --format='value(status.url)')"
echo "Checking Cloud Run: ${TASK_RUN_URL}"
curl --fail --silent --show-error --retry 5 --retry-delay 5 "${TASK_RUN_URL}/api/health"
echo
node scripts/deploy-hosting.mjs
echo "Checking the permanent Hosting URL. New sites may take a few minutes to propagate."
TASK_HOST_URL="https://${TASK_PROJECT}.web.app"
TASK_VERIFIED=false
for TASK_ATTEMPT in {1..24}; do
  if curl --fail --silent --show-error "${TASK_HOST_URL}/api/config" > deploy/hosting-config.local.json \
    && node --input-type=module -e 'import fs from "node:fs"; const c=JSON.parse(fs.readFileSync("deploy/hosting-config.local.json","utf8")); process.exit(c.mode==="firebase"&&c.firebase?.projectId==="gdg-hackathon-d0b85"?0:1)'; then
    TASK_VERIFIED=true
    break
  fi
  sleep 10
done
if [[ "$TASK_VERIFIED" != true ]]; then
  echo "The Hosting release was published, but public propagation is not verified yet."
  echo "Send this status to Codex so the permanent URL can be checked."
  exit 1
fi
curl --fail --silent --show-error "$TASK_HOST_URL/" > deploy/hosting-home.local.html
node --input-type=module -e 'import fs from "node:fs"; if(fs.readFileSync("deploy/hosting-home.local.html","utf8")!==fs.readFileSync("dist/index.html","utf8"))throw new Error("Hosting build differs from this deployment")'
echo
echo "DEPLOYED AND HTTP VERIFIED: ${TASK_HOST_URL}"
echo "Google login and an authenticated Firestore save still need an end-to-end check."
echo "Enable Google sign-in if needed: https://console.firebase.google.com/project/${TASK_PROJECT}/authentication"
echo "No minimum instances; maximum two. These settings do not cap the total bill."
echo "Budget alerts: https://console.cloud.google.com/billing/budgets?project=${TASK_PROJECT}"
