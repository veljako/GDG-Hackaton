import { expect, it } from "vitest";
import { matchingMigrationPatch, migrateMatching } from "./matching-migration";
import { createSeedState } from "../src/seed";
import { toUserDocument } from "./users";
import type { Firestore } from "firebase-admin/firestore";

it("migrates only matching fields and preserves source records and private metadata", () => {
  const raw = {
    ...createSeedState().events[0],
    min_birth_year: 2008,
    max_birth_year: 2000,
    extra_import_metadata: "retain",
  };
  const before = structuredClone(raw);
  const patch = matchingMigrationPatch("event", raw);
  expect(patch).toMatchObject({
    matchingVersion: 2,
    eligibility: { minBirthYear: 2000, maxBirthYear: 2008 },
  });
  expect(patch).not.toHaveProperty("id");
  expect(patch).not.toHaveProperty("extra_import_metadata");
  expect(raw).toEqual(before);
  expect(matchingMigrationPatch("event", { ...raw, ...patch })).toEqual({});
});

function database() {
  const records = new Map<string, Record<string, unknown>>();
  let concurrent: (() => void) | undefined;
  const snap = (path: string) => {
    const data = structuredClone(records.get(path));
    return {
      id: path.split("/").at(-1)!,
      ref: { path, get: async () => snap(path) },
      exists: !!data,
      data: () => data!,
      get: (field: string) => data?.[field],
    };
  };
  const db = {
    doc: (path: string) => ({ path, get: async () => snap(path) }),
    collection: (prefix: string) => ({
      get: async () => {
        const docs = [...records.keys()]
          .filter((path) => path.startsWith(prefix + "/"))
          .map(snap);
        return { size: docs.length, docs };
      },
    }),
    runTransaction: async (fn: (tx: unknown) => unknown) => {
      concurrent?.();
      concurrent = undefined;
      let wrote = false;
      const tx = {
        get: async (ref: { path: string }) => {
          if (wrote) throw Error("Read after write.");
          return snap(ref.path);
        },
        update: (ref: { path: string }, patch: Record<string, unknown>) => {
          wrote = true;
          records.set(ref.path, { ...records.get(ref.path), ...patch });
        },
        set: (ref: { path: string }, value: Record<string, unknown>) => {
          wrote = true;
          records.set(ref.path, { ...records.get(ref.path), ...value });
        },
      };
      return fn(tx);
    },
  };
  return {
    db: db as unknown as Firestore,
    records,
    changeBeforeTransaction: (fn: () => void) => {
      concurrent = fn;
    },
  };
}
it("dry-runs without writes, then bumps revisions, preserves reviews and records a durable reindex", async () => {
  const { db, records } = database();
  const uid = "luka",
    prefix = "gdevPilots/main";
  records.set(`${prefix}/users/${uid}`, {
    ...toUserDocument(createSeedState().people[0]),
    country: undefined,
    updated_at: "2026-10-10T12:00:00.000Z",
    cv_document: { storage_path: "private/cv.pdf" },
  });
  records.set(`${prefix}/events/event`, {
    ...createSeedState().events[0],
    id: "event",
    updated_at: "2026-10-10T12:00:00.000Z",
  });
  records.set(`${prefix}/onboardingDrafts/${uid}`, {
    cv_path: "private/cv.pdf",
    expected_profile_updated_at: "2026-10-10T12:00:00.000Z",
    profile: { learningSkills: ["Rust"] },
  });
  records.set(`${prefix}/cvExtractions/${uid}`, {
    storage_path: "private/cv.pdf",
    source_updated_at: "2026-10-10T12:00:00.000Z",
    extraction_hash: "retain",
  });
  const before = structuredClone([...records]);
  const dry = await migrateMatching(db, prefix);
  expect(dry.applied).toBe(0);
  expect([...records]).toEqual(before);
  const applied = await migrateMatching(db, prefix, true);
  expect(applied).toMatchObject({
    applied: 2,
    readbackVerified: 2,
    conflicts: 0,
  });
  const revision = records.get(`${prefix}/users/${uid}`)!.updated_at;
  expect(revision).not.toBe("2026-10-10T12:00:00.000Z");
  expect(records.get(`${prefix}/onboardingDrafts/${uid}`)).toMatchObject({
    expected_profile_updated_at: revision,
    profile: { learningSkills: ["Rust"] },
  });
  expect(records.get(`${prefix}/cvExtractions/${uid}`)).toMatchObject({
    source_updated_at: revision,
    extraction_hash: "retain",
  });
  expect(records.get(`${prefix}/matchingMigrations/v2`)).toMatchObject({
    pending: true,
    recipe: "matching-narrative-v3",
  });
  expect((await migrateMatching(db, prefix, true)).applied).toBe(0);
});
it("preserves a concurrently edited source instead of overwriting it", async () => {
  const { db, records, changeBeforeTransaction } = database();
  const prefix = "gdevPilots/main",
    path = `${prefix}/events/event`;
  records.set(path, { ...createSeedState().events[0], id: "event" });
  changeBeforeTransaction(() => {
    records.get(path)!.description = "Concurrent change";
  });
  expect(await migrateMatching(db, prefix, true)).toMatchObject({
    conflicts: 1,
    applied: 0,
  });
  expect(records.get(path)!.description).toBe("Concurrent change");
  expect(records.has(`${prefix}/matchingMigrations/v2`)).toBe(false);
});
it("adds empty matching defaults without overwriting confirmed user preferences", () => {
  const raw = {
    ...toUserDocument(createSeedState().people[0]),
    learningSkills: ["Python"],
    birth_date: "2000-03-10",
    private_field: "retain",
  };
  delete raw.country;
  expect(matchingMigrationPatch("user", raw)).toEqual({ country: "" });
  expect(raw.learningSkills).toEqual(["Python"]);
  expect(raw.birth_date).toBe("2000-03-10");
});
