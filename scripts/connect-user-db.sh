#!/usr/bin/env bash
# Run in the project owner's Google Cloud Shell. No credentials are printed.
(
  set -euo pipefail
  umask 077
  trap 'echo "SETUP STOPPED: send the error above, not credential contents."' ERR
  TASK_PROJECT="gdg-hackathon-d0b85"
  TASK_ACCOUNT="gevents-users@${TASK_PROJECT}.iam.gserviceaccount.com"
  TASK_PRIVATE_DIR="$HOME/.config/gevents"
  TASK_KEY_FILE="$TASK_PRIVATE_DIR/gevents-firebase-admin.json"

  grant_backend_role() {
    local TASK_ROLE="$1"
    local TASK_DELAY=2
    local TASK_ATTEMPT
    for TASK_ATTEMPT in 1 2 3 4 5 6 7; do
      if gcloud projects add-iam-policy-binding "$TASK_PROJECT" --member="serviceAccount:$TASK_ACCOUNT" --role="$TASK_ROLE" --condition=None --format='value(projectId)' > "$TASK_PRIVATE_DIR/role-result.log" 2> "$TASK_PRIVATE_DIR/role-error.log"; then
        cat "$TASK_PRIVATE_DIR/role-result.log"
        echo "Granted $TASK_ROLE."
        return 0
      fi
      cat "$TASK_PRIVATE_DIR/role-error.log" >&2
      if ! grep -Eiq 'Service account .* does not exist|NOT_FOUND|ABORTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED' "$TASK_PRIVATE_DIR/role-error.log"; then
        return 1
      fi
      if [[ "$TASK_ATTEMPT" -eq 7 ]]; then
        echo "IAM did not become ready within the retry window." >&2
        return 1
      fi
      echo "Waiting for Google IAM; retrying in $TASK_DELAY seconds."
      sleep "$TASK_DELAY"
      TASK_DELAY=$((TASK_DELAY * 2))
      if [[ "$TASK_DELAY" -gt 32 ]]; then TASK_DELAY=32; fi
    done
  }

  gcloud config set core/user_output_enabled true
  gcloud auth list --filter=status:ACTIVE --format='table(account)'
  gcloud projects describe "$TASK_PROJECT" --format='value(projectId)'
  gcloud services enable firestore.googleapis.com iam.googleapis.com identitytoolkit.googleapis.com --project="$TASK_PROJECT"
  mkdir -p "$TASK_PRIVATE_DIR"
  gcloud firestore databases list --project="$TASK_PROJECT" --format=json > "$TASK_PRIVATE_DIR/databases.json"
  if ! python3 -c 'import json,sys; rows=json.load(open(sys.argv[1])); sys.exit(0 if any(x["name"].endswith("/(default)") for x in rows) else 1)' "$TASK_PRIVATE_DIR/databases.json"; then
    gcloud firestore databases create --database='(default)' --location=eur3 --type=firestore-native --project="$TASK_PROJECT"
  fi
  TASK_EXISTING=$(gcloud iam service-accounts list --project="$TASK_PROJECT" --filter="email=$TASK_ACCOUNT" --format='value(email)')
  if [[ -z "$TASK_EXISTING" ]]; then
    gcloud iam service-accounts create gevents-users --display-name='GEvents user backend' --project="$TASK_PROJECT"
  fi
  for TASK_ROLE in roles/datastore.user roles/firebaseauth.viewer; do
    grant_backend_role "$TASK_ROLE"
  done
  if [[ ! -f "$TASK_KEY_FILE" ]]; then
    gcloud iam service-accounts keys create "$TASK_KEY_FILE" --iam-account="$TASK_ACCOUNT" --project="$TASK_PROJECT"
  fi
  python3 -c 'import json,sys; x=json.load(open(sys.argv[1])); assert x.get("type")=="service_account" and x.get("project_id")==sys.argv[2] and x.get("client_email")==sys.argv[3], "Existing credential belongs to another identity"' "$TASK_KEY_FILE" "$TASK_PROJECT" "$TASK_ACCOUNT"
  chmod 600 "$TASK_KEY_FILE"
  cloudshell download "$TASK_KEY_FILE"
  echo "DOWNLOAD READY: gevents-firebase-admin.json. Keep this file private; tell Codex downloaded."
)
