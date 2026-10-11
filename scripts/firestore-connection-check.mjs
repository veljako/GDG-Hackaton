/**
 * Disposable Firestore access check for gdg-hackathon-d0b85.
 *
 * Uses Application Default Credentials. Does not read application data.
 * Creates, reads, updates, and deletes one document in `_connection_checks`.
 *
 *   gcloud auth application-default login
 *   gcloud auth application-default set-quota-project gdg-hackathon-d0b85
 *   node scripts/firestore-connection-check.mjs
 */
import { randomUUID } from "node:crypto";
import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "gdg-hackathon-d0b85";
const collection = "_connection_checks";
const docId = `check-${Date.now()}-${randomUUID()}`;

const app = initializeApp({
  projectId,
  credential: applicationDefault(),
});
const db = getFirestore(app);
const ref = db.collection(collection).doc(docId);

const steps = { create: false, read: false, update: false, delete: false };

try {
  await ref.create({
    purpose: "temporary connection check",
    createdAt: new Date().toISOString(),
  });
  steps.create = true;

  const created = await ref.get();
  steps.read = created.exists && created.get("purpose") === "temporary connection check";

  await ref.update({ updated: true });
  const updated = await ref.get();
  steps.update = updated.exists && updated.get("updated") === true;

  await ref.delete();
  const gone = await ref.get();
  steps.delete = !gone.exists;
} finally {
  await deleteApp(app);
}

const ok = Object.values(steps).every(Boolean);
console.log(JSON.stringify({ projectId, collection, docId, steps, ok }, null, 2));
if (!ok) process.exit(1);
