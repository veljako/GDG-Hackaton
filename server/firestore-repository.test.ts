import { expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { FirestoreRepository } from "./repository";
import { createSeedState } from "../src/seed";
import { importDataset } from "./dataset";
import { normalizePerson } from "../src/user-profile";

// A transaction double is needed here; cloud credentials are deliberately absent.
function database(initial: Record<string, unknown> = {}) {
  const records = new Map(Object.entries(initial));
  const doc = (path: string) => ({ path, id: path.split("/").at(-1) });
  const collection = (path: string) => ({ path, collection: true });
  const snapshot = (ref: ReturnType<typeof doc>) => ({
    ...ref,
    ref,
    exists: records.has(ref.path),
    data: () => structuredClone(records.get(ref.path)),
    get: (key: string) =>
      (records.get(ref.path) as Record<string, unknown>)?.[key],
  });
  const db = {
    doc,
    collection,
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: (() => void)[] = [];
      const result = await fn({
        get: async (ref: ReturnType<typeof doc> & { collection?: boolean }) => {
          if (writes.length) throw Error("Read after write");
          return ref.collection
            ? {
                docs: [...records.keys()]
                  .filter(
                    (path) =>
                      path.startsWith(ref.path + "/") &&
                      path.split("/").length === ref.path.split("/").length + 1,
                  )
                  .map((path) => snapshot(doc(path))),
              }
            : snapshot(ref);
        },
        set: (ref: ReturnType<typeof doc>, value: unknown) =>
          writes.push(() => records.set(ref.path, structuredClone(value))),
        delete: (ref: ReturnType<typeof doc>) =>
          writes.push(() => records.delete(ref.path)),
      });
      writes.forEach((write) => write());
      return result;
    },
  } as unknown as Firestore;
  return { db, records };
}

it("stores editable documents and preserves data across repository instances", async () => {
  const { db, records } = database();
  const repo = new FirestoreRepository(db);
  await repo.update(() => ({ state: createSeedState() }));
  expect(records.get("gdevPilots/main/events/gdg-belgrade")).toMatchObject({
    title: expect.any(String),
  });
  expect(records.get("gdevPilots/main")).not.toHaveProperty("payload");
  const restarted = new FirestoreRepository(db);
  expect((await restarted.read()).people).toHaveLength(
    createSeedState().people.length,
  );
  await restarted.update((state) => {
    state.people[0].bio = "Saved by the real repository";
    return { state };
  });
  expect((await repo.read()).people[0].bio).toBe(
    "Saved by the real repository",
  );
});
it("retains direct dataset edits and removes documents deleted by a domain change", async () => {
  const { db, records } = database();
  const repo = new FirestoreRepository(db);
  await repo.update(() => ({ state: createSeedState() }));
  const path = "gdevPilots/main/events/gdg-belgrade";
  records.set(path, {
    ...(records.get(path) as object),
    title: "Team-prepared event",
  });
  expect(
    (await repo.read()).events.find((event) => event.id === "gdg-belgrade")
      ?.title,
  ).toBe("Team-prepared event");
  await repo.update((state) => ({ state: { ...state, notifications: [] } }));
  expect(
    [...records.keys()].some((key) => key.includes("/notifications/")),
  ).toBe(false);
  expect((records.get(path) as { title: string }).title).toBe(
    "Team-prepared event",
  );
});

it("reads legacy payload and backs it up when converting to collections", async () => {
  const payload = JSON.stringify(createSeedState());
  const { db, records } = database({ "gdevPilots/main": { payload } });
  const repo = new FirestoreRepository(db);
  expect((await repo.read()).events).toHaveLength(
    createSeedState().events.length,
  );
  await repo.update((state) => ({ state }));
  expect(records.get("gdevPilots/main/backups/legacy-v1")).toMatchObject({
    payload,
  });
  expect(records.get("gdevPilots/main")).toMatchObject({ schemaVersion: 3 });
});

it("does not write on a rejected domain action", async () => {
  const { db, records } = database();
  const repo = new FirestoreRepository(db);
  await repo.update((state) => ({ state, error: "Denied" }));
  expect(records.size).toBe(0);
});
it("stores the requested user fields and maps them back to application profiles", async () => {
  const { db, records } = database();
  const repo = new FirestoreRepository(db);
  const state = createSeedState();
  Object.assign(state.people[0], {
    status: "Student",
    birth_year: 2002,
    experience_level: "Junior",
    first_name: "Luka",
    last_name: "Petrović",
    email: "luka@example.com",
    email_verified: true,
    phone: "+381601234567",
    education: [
      {
        institution: "University of Belgrade",
        degree: "BSc",
        field: "Engineering",
        start_date: "2020-09",
        end_date: "2024-06",
        description: "",
      },
    ],
    work_experience: [
      {
        company: "Example",
        position: "Developer",
        location: "Belgrade",
        start_date: "2024-07",
        end_date: null,
        description: "Web products",
      },
    ],
    languages: ["Serbian", "English"],
    cv_document: {
      storage_path: "cvs/private/cv.pdf",
      filename: "cv.pdf",
      content_type: "application/pdf",
      size_bytes: 42,
      uploaded_at: "2026-10-10T12:00:00.000Z",
      extraction_status: "not_started",
      extracted_at: null,
    },
  });
  await repo.update(() => ({ state }));
  const user = records.get(`gdevPilots/main/users/${state.people[0].id}`);
  expect(user).toMatchObject({
    user_id: state.people[0].id,
    location: state.people[0].city,
    general_description: state.people[0].bio,
    skills: state.people[0].skills,
    status: "Student",
    birth_year: 2002,
    experience_level: "Junior",
    first_name: "Luka",
    last_name: "Petrović",
    email: "luka@example.com",
    education: state.people[0].education,
    work_experience: state.people[0].work_experience,
    cv_document: state.people[0].cv_document,
  });
  expect(user).not.toHaveProperty("city");
  expect(
    (await repo.read()).people.find((p) => p.id === state.people[0].id),
  ).toEqual(normalizePerson(state.people[0]));
  expect(records.get("gdevPilots/main")).toMatchObject({ schemaVersion: 3 });
});
it("migrates schema-2 people without losing fields or removing the recovery documents", async () => {
  const person = createSeedState().people[0];
  const oldPath = `gdevPilots/main/people/${person.id}`;
  const { db, records } = database({
    "gdevPilots/main": { schemaVersion: 2 },
    [oldPath]: person,
  });
  const repo = new FirestoreRepository(db);
  await repo.update((state) => ({ state }));
  expect(records.get(oldPath)).toEqual(person);
  expect(records.get(`gdevPilots/main/users/${person.id}`)).toMatchObject({
    user_id: person.id,
    status: null,
    birth_year: null,
    experience_level: null,
  });
  expect((await repo.read()).people).toEqual([normalizePerson(person)]);
});
it("refuses conflicting users and old people before migration", async () => {
  const person = createSeedState().people[0];
  const { db, records } = database({
    "gdevPilots/main": { schemaVersion: 2 },
    [`gdevPilots/main/people/${person.id}`]: person,
    [`gdevPilots/main/users/${person.id}`]: { user_id: person.id },
  });
  await expect(
    new FirestoreRepository(db).update((state) => ({ state })),
  ).rejects.toThrow(/overlap/i);
  expect(records.size).toBe(3);
});
it("imports and reads back the dataset once without overwriting it on a repeated import", async () => {
  const { db } = database();
  const repo = new FirestoreRepository(db);
  const counts = await importDataset(repo, createSeedState());
  expect(counts.people).toBe(12);
  expect(counts.events).toBe(7);
  await expect(importDataset(repo, createSeedState())).rejects.toThrow(
    /empty/i,
  );
  expect((await repo.read()).people).toHaveLength(12);
});
it("refuses ambiguous legacy and collection data instead of overwriting either", async () => {
  const { db, records } = database({
    "gdevPilots/main": { payload: JSON.stringify(createSeedState()) },
    "gdevPilots/main/people/new-user": {
      ...createSeedState().people[0],
      id: "new-user",
    },
  });
  await expect(
    new FirestoreRepository(db).update((state) => ({ state })),
  ).rejects.toThrow(/overlap/i);
  expect(records.size).toBe(2);
});
