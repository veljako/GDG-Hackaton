# Kaggle backend session

The current selection is Kaggle for model training and hosting. There is no
trained model, training code or dataset in this application yet; its event
recommendations are deterministic. Model training cannot start until the model,
objective and dataset are specified. The prepared notebook hosts the existing
Node API in Firebase mode. It does not fabricate or train a recommendation model.

`deploy/kaggle-backend.ipynb` is a ready-to-import notebook. Its source archive is
`.runtime/kaggle/gevents-backend.tgz`, with a SHA-256 checksum embedded in the notebook.
It includes application source and public Firebase configuration. Local env
files, credentials, runtime data and temporary phone deployment pages are excluded.

## Account setup

Sign in to Kaggle. Upload the archive as a **private** dataset and attach it to
the notebook. Turn Internet on. GPU acceleration is not necessary for the Node
API; select a GPU when running an actual model training workload.

Add `GEVENTS_FIREBASE_ADMIN_JSON` in Kaggle Secrets, containing a dedicated Firebase
service account credential for `gdg-hackathon-d0b85`, and attach the secret to the
notebook. Give that identity `roles/datastore.user` and
`roles/firebaseauth.viewer`. Do not paste this credential into a notebook cell,
source archive or chat. The notebook writes it only into a private temporary
directory, outside notebook output. The public web config comes from the archive.

Also attach `GEVENTS_FIREBASE_STORAGE_BUCKET` containing the existing private CV
bucket name without `gs://`. Grant the backend identity `roles/storage.objectUser`
on that bucket. The notebook now refuses startup without that setting and checks
Firestore reads, Auth reads and a disposable private PDF upload/read/delete before
opening the tunnel. It does not create the bucket or enable billing.

For organizer access, optionally attach the secret `GEVENTS_ORGANIZER_UIDS` with the
comma-separated Firebase user IDs. Without it, no user gains organizer privileges.
Create the default Firestore database, enable Google sign-in and publish the
existing deny-by-default Firestore rules before using real accounts.

## Run and connect

Run the notebook. It verifies the source checksum, downloads Node 24 from the
official distribution with its SHA-256 check, installs locked dependencies,
builds the app and starts the API on loopback. It uses the official Cloudflare
Quick Tunnel binary to expose that API over HTTPS. It checks the public config
and unauthenticated-state rejection before printing an address.

The final cell waits for the API process while serving requests. Interrupting it
stops the backend and tunnel and removes the temporary credential. Stopping the
Kaggle session also takes the API offline. The notebook does not automate quota
resets or attempt to bypass runtime limits.

Use the printed HTTPS origin as `VITE_API_ORIGIN` when building the frontend and
deploy with `firebase.self-hosted.json`; see `docs/self-hosted-backend.md` for the
exact Firebase Hosting command. The notebook trusts only the `.web.app` and
`.firebaseapp.com` frontend origins. Add custom frontend origins explicitly if used.

Kaggle CPU/GPU notebook sessions have a 12-hour execution limit, and a Quick Tunnel
address changes after restart. This is a temporary endpoint. Save trained model
checkpoints as notebook output or a private Kaggle dataset before the session
ends. A stable unattended API needs persistent hosting.

## Verification status

The application checks and backend type checks cover the local implementation. A browser
check on separate local frontend/API ports loaded the app and saved a profile
through the API; the change was confirmed in its isolated backend state file.
The notebook's Python syntax, structure and matching source checksum are checked.
No Kaggle notebook has been
uploaded or executed, no model has been trained, and real Firebase login/data
access has not been verified. The available Kaggle browser is signed out.

References: https://www.kaggle.com/docs/notebooks,
https://github.com/Kaggle/kaggle-cli/blob/main/docs/kernels.md,
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/.
