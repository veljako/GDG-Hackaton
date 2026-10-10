import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { FirestoreRepository } from "./repository";
import { CloudCvStorage, FileCvStorage } from "./cv-storage";

const { values } = parseArgs({ options: { project: { type: "string" } } });
const envFile = existsSync(".env.server.local")
  ? ".env.server.local"
  : ".env.firebase.local";
if (existsSync(envFile)) loadEnvFile(envFile);
if (!values.project || values.project !== process.env.FIREBASE_PROJECT_ID)
  throw Error("Pass --project matching FIREBASE_PROJECT_ID.");
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
if (bucketName && (bucketName.includes("/") || bucketName.startsWith("gs:")))
  throw Error("Set FIREBASE_STORAGE_BUCKET to the private bucket name.");
if (!bucketName && !process.env.GEVENTS_CV_DIRECTORY)
  throw Error("Configure a private FIREBASE_STORAGE_BUCKET or an explicit persistent GEVENTS_CV_DIRECTORY.");

const app = initializeApp({ projectId: values.project, credential: applicationDefault() });
const db = getFirestore(app);
try {
  const state = await new FirestoreRepository(db).read();
  // Check the same Auth read permission used by verifyIdToken(token, true).
  // Do not print account identifiers, emails, credentials or profile contents.
  await getAuth(app).listUsers(1);
  const cvStorage = bucketName
    ? new CloudCvStorage(getStorage(app).bucket(bucketName))
    : new FileCvStorage(resolve(process.env.GEVENTS_CV_DIRECTORY!));
  const probeUid = `readiness-${randomUUID()}`;
  const bytes = Buffer.from("%PDF-1.4\n% GEvents disposable storage readiness probe\n%%EOF\n");
  const path = await cvStorage.save(probeUid, bytes);
  try {
    if (!(await cvStorage.read(probeUid, path)).equals(bytes))
      throw Error("CV storage readback differs from the uploaded probe.");
  } finally {
    await cvStorage.remove(probeUid, path);
  }
  console.log(JSON.stringify({
    project: values.project,
    firestoreRead: true,
    authRead: true,
    privateCvWriteReadDelete: true,
    cvStorage: bucketName ? "cloud" : "server-disk",
    counts: { users: state.people.length, events: state.events.length, teams: state.teams.length },
    accountLoginVerified: false,
  }, null, 2));
} finally {
  await db.terminate();
  await deleteApp(app);
}
