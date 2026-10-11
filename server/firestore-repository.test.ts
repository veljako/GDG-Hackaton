import { expect, it, vi } from "vitest";
import { createApi } from "./http";
import type { Firestore } from "firebase-admin/firestore";
import { FirestoreRepository } from "./repository";
import { createSeedState } from "../src/seed";
import { importDataset } from "./dataset";
import { normalizePerson } from "../src/user-profile";
import { initialReviewedProfile } from "../src/onboarding";
import { onboardingRoutes } from "./onboarding-routes";
import { view, execute } from "./service";

// A transaction double is needed here; cloud credentials are deliberately absent.
function database(initial: Record<string, unknown> = {}) {
  const records = new Map(Object.entries(initial));
  const doc = (path: string) => ({ path, id: path.split("/").at(-1) });
  const collection = (path: string) => ({
    path,
    collection: true,
    where: (field: string, _operator: string, value: unknown) => ({
      limit: (count: number) => ({
        get: async () => ({
          docs: [...records.keys()]
            .filter(
              (key) =>
                key.startsWith(path + "/") &&
                key.split("/").length === path.split("/").length + 1,
            )
            .map((key) => snapshot(doc(key)))
            .filter(
              (row) =>
                field
                  .split(".")
                  .reduce<unknown>(
                    (current, key) =>
                      (current as Record<string, unknown> | undefined)?.[key],
                    row.data(),
                  ) === value,
            )
            .slice(0, count),
        }),
      }),
    }),
  });
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

async function onboardingFixture() {
  const { db, records } = database();
  const repo = new FirestoreRepository(db);
  const seed = createSeedState();
  const person = seed.people[0];
  person.onboarding = { version: 1, status: "required", completed_at: null };
  person.updated_at = "v1";
  person.cv_document = {
    storage_path: "private-cv.pdf",
    filename: "cv.pdf",
    content_type: "application/pdf",
    size_bytes: 200,
    uploaded_at: "today",
    extraction_status: "not_started",
    extracted_at: null,
  };
  await repo.update(() => ({ state: seed }));
  const extractionPath = `gdevPilots/main/cvExtractions/${person.id}`;
  records.set(extractionPath, {
    user_id: person.id,
    storage_path: "private-cv.pdf",
    source_updated_at: "v1",
    extraction_hash: "original-extraction",
    proposal: { skills: ["Wrong skill"] },
  });
  const profile = initialReviewedProfile(person, {
    first_name: "Ada",
    last_name: "Lovelace",
  });
  Object.assign(profile, {
    city: "Belgrade",
    title: "Research student",
    bio: "Building science projects",
    skills: ["Python"],
    interests: ["Science"],
    roles: ["Participant"],
    status: null,
    birth_year: null,
    experience_level: null,
    preferences: {
      goals: ["Research"],
      kinds: ["hackathon"],
      formats: ["Online"],
      location: "",
      notify: false,
    },
  });
  const input = {
    profile,
    step: "interests" as const,
    expected_extraction_hash: "original-extraction",
    expected_profile_updated_at: "v1",
    expected_draft_version: null as number | null,
  };
  const session = {
    personId: person.id,
    organizer: false,
    mode: "attendee" as const,
    demo: false,
  };
  const routes = onboardingRoutes(repo);
  return {
    db,
    repo,
    records,
    person,
    profile,
    input,
    session,
    routes,
    extractionPath,
  };
}

it("keeps unfinished attendees out of public discovery and blocks participation", async () => {
  const f = await onboardingFixture();
  const state = await f.repo.read();
  const other = { ...f.session, personId: state.people[1].id };
  expect(view(state, other).people.some((p) => p.id === f.person.id)).toBe(
    false,
  );
  expect(
    execute(state, f.session, {
      type: "TOGGLE_CONNECTION",
      personId: f.person.id,
      otherId: state.people[1].id,
    }).error,
  ).toMatch(/finish.*setup/i);
});

it("saves private drafts without updating or exposing the canonical profile", async () => {
  const f = await onboardingFixture();
  const before = (await f.repo.read()).people[0];
  const saved = await f.routes.handle("draft", f.session, f.input);
  expect(saved).toMatchObject({
    draft: { version: 1, profile: { skills: ["Python"] } },
  });
  expect((await f.repo.read()).people[0]).toEqual(before);
  expect(
    await onboardingRoutes(
      new FirestoreRepository(database(Object.fromEntries(f.records)).db),
    ).handle("draft", f.session),
  ).toMatchObject({ draft: { version: 1 } });
  expect(
    (
      await f.routes.handle("draft", {
        ...f.session,
        personId: (await f.repo.read()).people[1].id,
      })
    ).draft,
  ).toBeNull();
});

it("atomically completes corrected and manually added values only after a saved review", async () => {
  const f = await onboardingFixture();
  await expect(
    f.routes.handle("complete", f.session, {
      ...f.input,
      expected_draft_version: 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await f.routes.handle("draft", f.session, f.input);
  const result = await f.routes.handle("complete", f.session, {
    ...f.input,
    expected_draft_version: 1,
  });
  expect(result).toMatchObject({
    state: {
      people: expect.arrayContaining([
        expect.objectContaining({
          id: f.person.id,
          skills: ["Python"],
          onboarding: expect.objectContaining({
            version: 1,
            status: "completed",
            completed_at: expect.any(String),
          }),
        }),
      ]),
    },
  });
  expect(f.records.get(f.extractionPath)).toMatchObject({ confirmed: true });
  expect(await f.repo.loadOnboardingDraft(f.person.id)).toBeNull();
  const after = (await f.repo.read()).people[0];
  await f.routes.handle("complete", f.session, {
    ...f.input,
    expected_draft_version: 1,
    profile: { ...f.profile, skills: ["Stale retry"] },
  });
  expect((await f.repo.read()).people[0]).toEqual(after);
});

it.each(["extraction", "attachment", "profile", "draft"])(
  "rejects a changed %s without partial completion",
  async (change) => {
    const f = await onboardingFixture();
    await f.routes.handle("draft", f.session, f.input);
    if (change === "extraction")
      f.records.set(f.extractionPath, {
        ...(f.records.get(f.extractionPath) as object),
        extraction_hash: "replacement",
      });
    else if (change === "draft")
      await f.routes.handle("draft", f.session, {
        ...f.input,
        expected_draft_version: 1,
      });
    else
      await f.repo.update((state) => {
        if (change === "attachment")
          state.people[0].cv_document!.storage_path = "replacement.pdf";
        else state.people[0].updated_at = "v2";
        return { state };
      });
    await expect(
      f.routes.handle("complete", f.session, {
        ...f.input,
        expected_draft_version: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.repo.read()).people[0].onboarding?.status).toBe("required");
    expect(f.records.get(f.extractionPath)).not.toHaveProperty("confirmed");
  },
);

it("rejects missing matching fields and forged authority fields", async () => {
  const f = await onboardingFixture();
  await f.routes.handle("draft", f.session, f.input);
  await expect(
    f.routes.handle("complete", f.session, {
      ...f.input,
      expected_draft_version: 1,
      profile: { ...f.profile, skills: [] },
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    f.routes.handle("draft", f.session, {
      ...f.input,
      expected_draft_version: 1,
      profile: {
        ...f.profile,
        email: "forged@example.com",
        onboarding: { status: "completed" },
      },
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect((await f.repo.read()).people[0].onboarding?.status).toBe("required");
});

it("persists undelivered onboarding matching and safely retries it after service recovery", async () => {
  const f = await onboardingFixture();
  await f.routes.handle("draft", f.session, f.input);
  const complete = { ...f.input, expected_draft_version: 1 };
  expect(await f.routes.handle("complete", f.session, complete)).toMatchObject({
    matching_sync: "unavailable",
  });
  expect((await f.repo.read()).people[0].onboarding).toMatchObject({
    status: "completed",
    matching_sync: "pending",
  });
  const approved = (await f.repo.read()).people[0].skills;
  let calls = 0;
  const recovered = onboardingRoutes(f.repo, {
    call: async (operation, _actor, state) => {
      expect(operation).toBe("queue_sync");
      expect(state.people[0].skills).toEqual(approved);
      ++calls;
      return { results: [] };
    },
  });
  expect(await recovered.handle("retry-matching", f.session, {})).toMatchObject(
    { matching_sync: "queued" },
  );
  expect((await f.repo.read()).people[0].onboarding).toMatchObject({
    matching_sync: "queued",
  });
  expect(await recovered.handle("complete", f.session, complete)).toMatchObject(
    { message: "Your setup is already complete." },
  );
  expect(calls).toBe(1);
  expect((await f.repo.read()).people[0].skills).toEqual(approved);
});

it("recovers persisted profile matching automatically on API restart without a browser request", async () => {
  const f = await onboardingFixture();
  await f.routes.handle("draft", f.session, f.input);
  await f.routes.handle("complete", f.session, {
    ...f.input,
    expected_draft_version: 1,
  });
  const restarted = new FirestoreRepository(f.db);
  const call = vi.fn().mockResolvedValue({ results: [] });
  const server = createApi({
    repository: restarted,
    mode: "firebase",
    publicConfig: {},
    matchingClient: { call },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await vi.waitFor(async () =>
      expect((await restarted.read()).people[0].onboarding?.matching_sync).toBe(
        "queued",
      ),
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe("queue_sync");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("atomically rejects a replaced private extraction before saving public fields", async () => {
  const { db, records } = database();
  const repo = new FirestoreRepository(db);
  const seed = createSeedState();
  const id = seed.people[0].id;
  await repo.update(() => ({ state: seed }));
  const path = `gdevPilots/main/cvExtractions/${id}`;
  records.set(path, {
    user_id: id,
    storage_path: "cv.pdf",
    source_updated_at: "v1",
    extraction_hash: "replacement",
  });
  const before = structuredClone(records.get(`gdevPilots/main/users/${id}`));
  const result = await repo.update(
    (state) => {
      state.people[0].skills = ["Obsolete proposal"];
      return { state };
    },
    {
      personId: id,
      storagePath: "cv.pdf",
      extractionHash: "reviewed",
      sourceUpdatedAt: "v1",
    },
  );
  expect(result.error).toMatch(/extraction changed/i);
  expect(records.get(`gdevPilots/main/users/${id}`)).toEqual(before);
  records.set(path, {
    user_id: id,
    storage_path: "cv.pdf",
    source_updated_at: "v1",
    extraction_hash: "reviewed",
  });
  expect(
    (
      await repo.update(
        (state) => {
          state.people[0].skills = ["Current proposal"];
          return { state };
        },
        {
          personId: id,
          storagePath: "cv.pdf",
          extractionHash: "reviewed",
          sourceUpdatedAt: "v1",
        },
      )
    ).error,
  ).toBeUndefined();
});

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
