import { z } from "zod";

export type IndexConfig = {
  indexes: Record<string, unknown>[];
  fieldOverrides?: Record<string, unknown>[];
};

/** Add rather than replace indexes, preserving existing production configuration. */
export function vectorIndexConfig(
  dimensions: number,
  existing: IndexConfig = { indexes: [] },
): IndexConfig {
  z.number().int().min(1).max(2048).parse(dimensions);
  const indexes = [...existing.indexes];
  for (const collectionGroup of ["userEmbeddings", "hackathonEmbeddings", "eventEmbeddings"]) {
    const index = {
      collectionGroup,
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "model", order: "ASCENDING" },
        { fieldPath: "dimensions", order: "ASCENDING" },
        {
          fieldPath: "embedding",
          vectorConfig: { dimension: dimensions, flat: {} },
        },
      ],
    };
    if (
      !indexes.some(
        (item) =>
          item.collectionGroup === collectionGroup &&
          item.queryScope === index.queryScope &&
          JSON.stringify(item.fields) === JSON.stringify(index.fields),
      )
    )
      indexes.push(index);
  }
  return { ...existing, indexes };
}
