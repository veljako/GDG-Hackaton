import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { validateDataset } from "./dataset";
import { toUserDocument, type UserDocument } from "./users";
import { trainingProfile } from "./training";

const { values } = parseArgs({ options: {
  project: { type: "string" },
  output: { type: "string" },
  "synthetic-source": { type: "string" },
  "synthetic-only": { type: "boolean", default: false },
} });
const envFile = existsSync(".env.server.local") ? ".env.server.local" : ".env.firebase.local";
if (existsSync(envFile)) loadEnvFile(envFile);
if (!values.project || values.project !== process.env.FIREBASE_PROJECT_ID)
  throw Error("Pass --project matching FIREBASE_PROJECT_ID.");
if (!values.output || !values.output.endsWith(".jsonl"))
  throw Error("Pass --output with a private .jsonl destination.");
if (existsSync(values.output)) throw Error("Output exists; choose a new path to preserve it.");
if (values["synthetic-only"] && !values["synthetic-source"])
  throw Error("Synthetic-only export requires an explicitly supplied synthetic dataset.");

const rows: ReturnType<typeof trainingProfile>[] = [];
if (values["synthetic-source"]) {
  const state = validateDataset(JSON.parse(await readFile(values["synthetic-source"], "utf8")));
  rows.push(...state.people.map(person => trainingProfile(toUserDocument(person), "synthetic")));
}
let skippedUnregistered = 0;
if (!values["synthetic-only"]) {
  const app = initializeApp({ projectId: values.project, credential: applicationDefault() });
  const db = getFirestore(app);
  try {
    const snapshots = await db.collection("gdevPilots/main/users").get();
    // Imported demo records without Auth accounts must not be presented as real users.
    for (let offset = 0; offset < snapshots.docs.length; offset += 100) {
      const docs = snapshots.docs.slice(offset, offset + 100);
      const registered = new Set((await getAuth(app).getUsers(docs.map(doc => ({ uid: doc.id })))).users.map(user => user.uid));
      for (const doc of docs) {
        if (!registered.has(doc.id)) { skippedUnregistered++; continue; }
        const record = doc.data() as UserDocument;
        if (record.user_id !== doc.id) throw Error("Canonical user identity mismatch; migrate users before export.");
        rows.push(trainingProfile(record, "real"));
      }
    }
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}
if (new Set(rows.map(row => row.entity_id)).size !== rows.length)
  throw Error("Duplicate training entity IDs; output was not written.");
await mkdir(dirname(values.output), { recursive: true });
await writeFile(values.output, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ output: values.output, real: rows.filter(row => row.data_origin === "real").length, synthetic: rows.filter(row => row.data_origin === "synthetic").length, skippedUnregistered, cloudWrite: false }));
