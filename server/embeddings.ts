import { createHash } from "node:crypto";
import { z } from "zod";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type EmbeddingKind = "user" | "hackathon";
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
const model = z.string().trim().min(1).max(200);
const vector = z
  .array(z.number().finite())
  .min(1)
  .max(2048)
  .refine(
    (values) => values.some((value) => value !== 0),
    "Cosine vectors must be nonzero.",
  );
export const embeddingSchema = z
  .object({
    entity_id: id,
    model,
    vector,
    source_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const searchSchema = z
  .object({
    model,
    vector,
    limit: z.number().int().min(1).max(1000).default(10),
  })
  .strict();

/** Fingerprint the source, not the embedding input: inputs are decided by the worker. */
export function sourceHash(record: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(record)))
    .digest("hex");
}

function collections(kind: EmbeddingKind) {
  if (kind === "user") return { source: "users", vectors: "userEmbeddings" };
  if (kind === "hackathon")
    return { source: "events", vectors: "hackathonEmbeddings" };
  throw Error("Embedding kind must be user or hackathon.");
}
function validSource(
  kind: EmbeddingKind,
  record: Record<string, unknown>,
  entityId: string,
) {
  return kind === "user"
    ? record.user_id === entityId
    : record.id === entityId && (record.kind ?? "hackathon") === "hackathon";
}

/** Trusted server/worker access only; never expose this repository directly to browsers. */
export class FirestoreEmbeddings {
  constructor(
    private db: Firestore,
    private workspace = "gdevPilots/main",
  ) {}

  async source(kind: EmbeddingKind, entityId: string) {
    id.parse(entityId);
    const path = `${this.workspace}/${collections(kind).source}/${entityId}`;
    return this.db.runTransaction(
      async (tx) => {
        const snapshot = await tx.get(this.db.doc(path));
        if (!snapshot.exists)
          throw Error(
            "Embedding source not found. Migrate users first if this is a legacy workspace.",
          );
        const record = snapshot.data()!;
        if (!validSource(kind, record, entityId))
          throw Error("Invalid user identity or non-hackathon source.");
        return { record, source_hash: sourceHash(record) };
      },
      { readOnly: true },
    );
  }

  async upsert(kind: EmbeddingKind, input: unknown) {
    const value = embeddingSchema.parse(input);
    const paths = collections(kind);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(
        this.db.doc(`${this.workspace}/${paths.source}/${value.entity_id}`),
      );
      if (!snapshot.exists) throw Error("Embedding source not found.");
      const record = snapshot.data()!;
      if (!validSource(kind, record, value.entity_id))
        throw Error("Invalid user identity or non-hackathon source.");
      if (sourceHash(record) !== value.source_hash)
        throw Error(
          "Source changed. Regenerate the embedding from the current source.",
        );
      const metadata = {
        entity_id: value.entity_id,
        model: value.model,
        dimensions: value.vector.length,
        source_hash: value.source_hash,
        updated_at: new Date().toISOString(),
      };
      tx.set(
        this.db.doc(`${this.workspace}/${paths.vectors}/${value.entity_id}`),
        {
          ...metadata,
          embedding: FieldValue.vector(value.vector),
        },
      );
      return metadata;
    });
  }

  async nearest(
    kind: EmbeddingKind,
    input: unknown,
  ): Promise<{ entity_id: string; distance: number }[]> {
    const value = searchSchema.parse(input);
    const paths = collections(kind);
    const snapshot = await this.db
      .collection(`${this.workspace}/${paths.vectors}`)
      .where("model", "==", value.model)
      .where("dimensions", "==", value.vector.length)
      .findNearest({
        vectorField: "embedding",
        queryVector: value.vector,
        distanceMeasure: "COSINE",
        limit: value.limit,
        distanceResultField: "vector_distance",
      })
      .get();
    if (!snapshot.docs.length) return [];
    const sources = await this.db.getAll(
      ...snapshot.docs.map((doc) =>
        this.db.doc(`${this.workspace}/${paths.source}/${doc.id}`),
      ),
    );
    return snapshot.docs.flatMap((doc, index) => {
      const embedding = doc.data();
      const source = sources[index];
      const record = source.data();
      if (
        !source.exists ||
        !record ||
        !validSource(kind, record, doc.id) ||
        embedding.entity_id !== doc.id ||
        sourceHash(record) !== embedding.source_hash ||
        !Number.isFinite(embedding.vector_distance)
      )
        return [];
      return [
        { entity_id: doc.id, distance: embedding.vector_distance as number },
      ];
    });
  }
}
