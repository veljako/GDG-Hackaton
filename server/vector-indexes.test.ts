import { expect, it } from "vitest";
import { vectorIndexConfig } from "./vector-indexes";

it("creates compatible model/dimension vector indexes for both entity kinds", () => {
  const config = vectorIndexConfig(768);
  expect(config.indexes).toHaveLength(2);
  expect(config.indexes.map((i) => i.collectionGroup)).toEqual([
    "userEmbeddings",
    "hackathonEmbeddings",
  ]);
  expect(config.indexes[0].fields).toEqual([
    { fieldPath: "model", order: "ASCENDING" },
    { fieldPath: "dimensions", order: "ASCENDING" },
    { fieldPath: "embedding", vectorConfig: { dimension: 768, flat: {} } },
  ]);
});
it("requires an explicit supported dimension and preserves existing indexes", () => {
  for (const dim of [0, 2049, 1.5, NaN])
    expect(() => vectorIndexConfig(dim)).toThrow();
  const existing = {
    indexes: [
      {
        collectionGroup: "events",
        queryScope: "COLLECTION",
        fields: [{ fieldPath: "status", order: "ASCENDING" }],
      },
    ],
    fieldOverrides: [
      {
        collectionGroup: "users",
        fieldPath: "general_description",
        indexes: [],
      },
    ],
  };
  const first = vectorIndexConfig(768, existing);
  expect(first.indexes).toHaveLength(3);
  expect(first.fieldOverrides).toEqual(existing.fieldOverrides);
  expect(vectorIndexConfig(768, first)).toEqual(first);
  expect(vectorIndexConfig(1024, first).indexes).toHaveLength(5);
});
