import { parseArgs } from "node:util";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import {
  initializeApp,
  applicationDefault,
  deleteApp,
} from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { migrateMatching } from "./matching-migration";
import { HttpMatchingClient } from "./matching-client";
import { FirestoreRepository } from "./repository";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    workspace: { type: "string", default: "gdevPilots/main" },
    apply: { type: "boolean", default: false },
  },
});
if (existsSync(".env.firebase.local")) loadEnvFile(".env.firebase.local");
if (existsSync(".env.server.local")) loadEnvFile(".env.server.local");
if (!values.project || values.project !== process.env.FIREBASE_PROJECT_ID)
  throw Error(
    "Pass --project matching FIREBASE_PROJECT_ID. No data was changed.",
  );
if (!/^gdevPilots\/[\w-]+$/.test(values.workspace))
  throw Error("Pass an explicit pilot workspace.");
const app = initializeApp({
  credential: applicationDefault(),
  projectId: values.project,
});
const db = getFirestore(app);
try {
  const report = await migrateMatching(db, values.workspace, values.apply);
  let reindex = "not-requested";
  if (values.apply) {
    const marker = db.doc(`${values.workspace}/matchingMigrations/v2`);
    const row = await marker.get();
    reindex = row.get("pending") ? "pending" : "unchanged";
    if (
      row.get("pending") &&
      process.env.GEMMA_WORKER_URL &&
      process.env.GEMMA_WORKER_TOKEN
    ) {
      const state = await new FirestoreRepository(db, values.workspace).read();
      const actor = state.people.find(
        (p) => p.onboarding?.status !== "required",
      );
      if (actor) {
        try {
          const receipt = await new HttpMatchingClient(
            process.env.GEMMA_WORKER_URL,
            process.env.GEMMA_WORKER_TOKEN,
          ).call("queue_sync", actor.id, state, {});
          if (receipt.recipe !== "matching-narrative-v3")
            throw Error(
              "Update the worker before acknowledging the new narrative recipe.",
            );
          await db.runTransaction(async (tx) => {
            const current = await tx.get(marker);
            if (current.get("updated_at") === row.get("updated_at"))
              tx.update(marker, {
                pending: false,
                queued_at: new Date().toISOString(),
              });
          });
          reindex = "queued";
        } catch {
          reindex = "pending";
        }
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        project: values.project,
        workspace: values.workspace,
        mode: values.apply ? "apply" : "dry-run",
        matchingVersion: 2,
        recipe: "matching-narrative-v3",
        ...report,
        reindex,
      },
      null,
      2,
    ),
  );
  if (report.conflicts) process.exitCode = 2;
} catch (error) {
  // Provider errors are summarized without credential/source data.
  const code = (error as { code?: unknown })?.code;
  console.error(
    JSON.stringify({
      migration: "failed",
      code:
        typeof code === "number" || typeof code === "string"
          ? code
          : "unavailable",
      message:
        code === 8
          ? "Firestore read/write quota exhausted. No completion was confirmed."
          : "Migration could not finish. Validate authentication, source data and provider availability before retrying.",
    }),
  );
  process.exitCode = 1;
} finally {
  await db.terminate();
  await deleteApp(app);
}
