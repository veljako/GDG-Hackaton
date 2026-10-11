import { parseArgs } from "node:util";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  FirestoreEmbeddings,
  embeddingSchema,
  type EmbeddingKind,
} from "./embeddings";
import { vectorIndexConfig, type IndexConfig } from "./vector-indexes";
import { FirestoreRepository } from "./repository";

const { values } = parseArgs({
  options: {
    operation: { type: "string" },
    project: { type: "string" },
    kind: { type: "string" },
    id: { type: "string" },
    source: { type: "string" },
    dimensions: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
const operation = z
  .enum(["source", "upsert", "search", "indexes", "migrate-users"])
  .parse(values.operation);

if (operation === "indexes") {
  const dimensions = z.coerce
    .number()
    .int()
    .min(1)
    .max(2048)
    .parse(values.dimensions);
  const path = "firestore.indexes.json";
  const previous: IndexConfig = existsSync(path)
    ? JSON.parse(await readFile(path, "utf8"))
    : { indexes: [] };
  const config = vectorIndexConfig(dimensions, previous);
  if (values.apply) {
    await writeFile(path, JSON.stringify(config, null, 2) + "\n");
    console.log(
      `Prepared ${path} for ${dimensions} dimensions. No cloud indexes were deployed.`,
    );
  } else console.log(JSON.stringify(config, null, 2));
} else {
  const localEnv = existsSync(".env.server.local")
    ? ".env.server.local"
    : ".env.firebase.local";
  if (existsSync(localEnv)) loadEnvFile(localEnv);
  if (!values.project || values.project !== process.env.FIREBASE_PROJECT_ID)
    throw Error(
      "Pass --project matching FIREBASE_PROJECT_ID. No cloud data was changed.",
    );
  const kind =
    operation === "migrate-users"
      ? undefined
      : (z.enum(["user", "hackathon"]).parse(values.kind) as EmbeddingKind);
  let input: unknown;
  if (operation === "upsert" || operation === "search") {
    if (!values.source)
      throw Error(
        "Pass --source with a JSON file containing the supplied vector.",
      );
    input = JSON.parse(await readFile(values.source, "utf8"));
    if (operation === "upsert") {
      input = embeddingSchema.parse(input);
      if (!values.apply) {
        const parsed = embeddingSchema.parse(input);
        console.log(
          JSON.stringify({
            validated: true,
            entity_id: parsed.entity_id,
            model: parsed.model,
            dimensions: parsed.vector.length,
            cloudAccess: false,
          }),
        );
        process.exit(0);
      }
    }
  }
  const { initializeApp, applicationDefault, deleteApp } =
    await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({
    projectId: values.project,
    credential: applicationDefault(),
  });
  const db = getFirestore(app);
  try {
    const repo = new FirestoreEmbeddings(db);
    if (operation === "source") {
      if (!values.id) throw Error("Pass --id for the existing source entity.");
      console.log(JSON.stringify(await repo.source(kind!, values.id), null, 2));
    } else if (operation === "upsert") {
      console.log(JSON.stringify(await repo.upsert(kind!, input), null, 2));
    } else if (operation === "search") {
      console.log(JSON.stringify(await repo.nearest(kind!, input), null, 2));
    } else {
      const workspace = new FirestoreRepository(db);
      const before = await workspace.read();
      if (!values.apply)
        console.log(
          JSON.stringify({ users: before.people.length, cloudWrite: false }),
        );
      else {
        await workspace.update((state) => ({ state }));
        const after = await workspace.read();
        const snapshots = after.people.length
          ? await db.getAll(
              ...after.people.map((person) =>
                db.doc(`gdevPilots/main/users/${person.id}`),
              ),
            )
          : [];
        if (
          snapshots.some(
            (snapshot) =>
              !snapshot.exists ||
              snapshot.get("user_id") !== snapshot.id ||
              [
                "first_name",
                "last_name",
                "email",
                "email_verified",
                "phone",
                "education",
                "work_experience",
                "languages",
                "cv_document",
                "created_at",
                "updated_at",
              ].some((field) => snapshot.get(field) === undefined),
          )
        )
          throw Error(
            "User migration readback failed: identity or profile fields are missing.",
          );
        console.log(
          JSON.stringify({
            migratedUsers: after.people.length,
            schemaVersion: 3,
            readback: true,
          }),
        );
      }
    }
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}
