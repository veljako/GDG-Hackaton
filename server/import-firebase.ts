import { parseArgs } from "node:util";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createSeedState } from "../src/seed";
import { datasetCounts, importDataset, validateDataset } from "./dataset";
import { FirestoreRepository } from "./repository";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    source: { type: "string" },
    export: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
const localEnv = existsSync(".env.server.local")
  ? ".env.server.local"
  : ".env.firebase.local";
if (existsSync(localEnv)) loadEnvFile(localEnv);
const configuredProject = process.env.FIREBASE_PROJECT_ID;
if (!values.project || values.project !== configuredProject)
  throw Error(
    "Pass --project matching FIREBASE_PROJECT_ID. No cloud data was changed.",
  );
if (values.apply && values.export)
  throw Error("Use --export separately from --apply.");
const state = validateDataset(
  values.source
    ? JSON.parse(await readFile(values.source, "utf8"))
    : createSeedState(),
);
console.log(
  JSON.stringify(
    {
      project: values.project,
      source: values.source ?? "src/seed.ts",
      counts: datasetCounts(state),
    },
    null,
    2,
  ),
);
if (values.export) {
  await writeFile(values.export, JSON.stringify(state, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    `Dataset exported to ${values.export}. No cloud data was changed.`,
  );
} else if (!values.apply) {
  console.log(
    "Dry run: source validated; cloud access was not attempted. Add --apply to import into an empty workspace.",
  );
} else {
  const { initializeApp, applicationDefault, deleteApp } =
    await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: values.project,
  });
  const db = getFirestore(app);
  try {
    console.log(
      "Imported:",
      await importDataset(new FirestoreRepository(db), state),
    );
    const actual = await new FirestoreRepository(db).read();
    console.log("Firestore readback:", datasetCounts(actual));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}
