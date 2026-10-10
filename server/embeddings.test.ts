import { expect, it } from "vitest";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { FirestoreEmbeddings, embeddingSchema, sourceHash } from "./embeddings";

function database() {
  const records = new Map<string, Record<string, unknown>>([
    [
      "gdevPilots/main/users/alice",
      {
        user_id: "alice",
        general_description: "Builds accessible tools",
        skills: ["Python"],
      },
    ],
    [
      "gdevPilots/main/events/hack",
      { id: "hack", kind: "hackathon", title: "Build together" },
    ],
    [
      "gdevPilots/main/events/talk",
      { id: "talk", kind: "conference", title: "Talk" },
    ],
  ]);
  let queryOptions: Record<string, unknown> = {};
  const ref = (path: string) => ({ path, id: path.split("/").at(-1)! });
  const snapshot = (path: string) => ({
    id: ref(path).id,
    exists: records.has(path),
    data: () => records.get(path),
  });
  const db = {
    doc: ref,
    getAll: async (...refs: { path: string }[]) =>
      refs.map((r) => snapshot(r.path)),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: (() => void)[] = [];
      const result = await fn({
        get: async (r: { path: string }) => snapshot(r.path),
        set: (r: { path: string }, value: Record<string, unknown>) =>
          writes.push(() => records.set(r.path, value)),
      });
      writes.forEach((fn) => fn());
      return result;
    },
    collection: (path: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        where: (field: string, _op: string, value: unknown) => {
          filters.push([field, value]);
          return query;
        },
        findNearest: (options: Record<string, unknown>) => {
          queryOptions = options;
          return {
            get: async () => ({
              docs: [...records.entries()]
                .filter(
                  ([key, value]) =>
                    key.startsWith(path + "/") &&
                    filters.every(([f, v]) => value[f] === v),
                )
                .map(([key, value]) => ({
                  id: ref(key).id,
                  data: () => ({ ...value, vector_distance: 0.1 }),
                })),
            }),
          };
        },
      };
      return query;
    },
  } as unknown as Firestore;
  return { db, records, options: () => queryOptions };
}

it("validates supplied vectors without guessing a model or accepting invalid cosine input", () => {
  const input = {
    entity_id: "alice",
    model: "team-model-v1",
    source_hash: "a".repeat(64),
    vector: [1, 0, 0],
  };
  expect(embeddingSchema.parse(input)).toEqual(input);
  for (const vector of [
    [],
    [0, 0],
    [NaN, 1],
    [Infinity, 1],
    Array(2049).fill(1),
  ])
    expect(embeddingSchema.safeParse({ ...input, vector }).success).toBe(false);
  expect(embeddingSchema.safeParse({ ...input, model: "" }).success).toBe(
    false,
  );
  expect(
    embeddingSchema.safeParse({ ...input, entity_id: "../other" }).success,
  ).toBe(false);
});
it("hashes sources consistently across object field ordering", () => {
  expect(sourceHash({ b: 2, a: { z: 1, y: 2 } })).toBe(
    sourceHash({ a: { y: 2, z: 1 }, b: 2 }),
  );
});
it("upserts a native vector per user and records the exact source version", async () => {
  const { db, records } = database();
  const repo = new FirestoreEmbeddings(db);
  const source = await repo.source("user", "alice");
  await repo.upsert("user", {
    entity_id: "alice",
    model: "team-model-v1",
    source_hash: source.source_hash,
    vector: [1, 2, 3],
  });
  const stored = records.get("gdevPilots/main/userEmbeddings/alice")!;
  expect(stored.embedding).toEqual(FieldValue.vector([1, 2, 3]));
  expect(stored).toMatchObject({
    entity_id: "alice",
    model: "team-model-v1",
    dimensions: 3,
    source_hash: source.source_hash,
  });
  expect(stored.updated_at).toEqual(expect.any(String));
  await repo.upsert("user", {
    entity_id: "alice",
    model: "team-model-v1",
    source_hash: source.source_hash,
    vector: [3, 2, 1],
  });
  expect(
    records.get("gdevPilots/main/userEmbeddings/alice")!.embedding,
  ).toEqual(FieldValue.vector([3, 2, 1]));
});
it("refuses missing entities and vectors generated before a profile change", async () => {
  const { db, records } = database();
  const repo = new FirestoreEmbeddings(db);
  const { source_hash } = await repo.source("user", "alice");
  records.get("gdevPilots/main/users/alice")!.general_description = "Changed";
  await expect(
    repo.upsert("user", {
      entity_id: "alice",
      model: "m",
      source_hash,
      vector: [1],
    }),
  ).rejects.toThrow(/changed/i);
  await expect(repo.source("user", "missing")).rejects.toThrow(/not found/i);
  expect(records.has("gdevPilots/main/userEmbeddings/alice")).toBe(false);
});
it("supports hackathon vectors separately and refuses non-hackathon events", async () => {
  const { db, records } = database();
  const repo = new FirestoreEmbeddings(db);
  const { source_hash } = await repo.source("hackathon", "hack");
  await repo.upsert("hackathon", {
    entity_id: "hack",
    model: "m",
    source_hash,
    vector: [1],
  });
  expect(records.has("gdevPilots/main/hackathonEmbeddings/hack")).toBe(true);
  await expect(repo.source("hackathon", "talk")).rejects.toThrow(/hackathon/i);
});
it("searches only compatible vectors and omits stale or deleted source records", async () => {
  const { db, records, options } = database();
  const repo = new FirestoreEmbeddings(db);
  const { source_hash } = await repo.source("user", "alice");
  await repo.upsert("user", {
    entity_id: "alice",
    model: "m",
    source_hash,
    vector: [1, 2],
  });
  records.set("gdevPilots/main/userEmbeddings/missing", {
    entity_id: "missing",
    model: "m",
    dimensions: 2,
    source_hash,
  });
  expect(
    await repo.nearest("user", {
      model: "different",
      vector: [1, 2],
      limit: 10,
    }),
  ).toEqual([]);
  expect(
    await repo.nearest("user", { model: "m", vector: [1], limit: 10 }),
  ).toEqual([]);
  expect(
    await repo.nearest("user", { model: "m", vector: [1, 2], limit: 10 }),
  ).toEqual([{ entity_id: "alice", distance: 0.1 }]);
  expect(options()).toMatchObject({
    distanceMeasure: "COSINE",
    vectorField: "embedding",
    distanceResultField: "vector_distance",
  });
  records.get("gdevPilots/main/users/alice")!.skills = ["React"];
  expect(
    await repo.nearest("user", { model: "m", vector: [1, 2], limit: 10 }),
  ).toEqual([]);
  await expect(
    repo.nearest("user", { model: "m", vector: [1, 2], limit: 0 }),
  ).rejects.toThrow();
});
