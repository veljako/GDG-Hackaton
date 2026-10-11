import { describe, expect, it, vi } from "vitest";
import { Firestore } from "firebase-admin/firestore";
import { readOnlySnapshot } from "./firestore-read";
import { FirestoreRepository } from "./repository";
import { createSeedState } from "../src/seed";

describe("Firestore read failures and polling", () => {
  it("handles a first-read quota failure through the actual SDK without an orphaned rejection", async () => {
    const db = new Firestore({ projectId: "quota-regression" });
    const query = db.collection("quota-regression");
    const quota = Object.assign(
      new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."),
      { code: 8 },
    );
    // Keep the SDK's real transaction implementation, replacing only the network query.
    vi.spyOn(
      query as unknown as { _get(): Promise<unknown> },
      "_get",
    ).mockRejectedValue(quota);
    await expect(
      db.runTransaction((tx) => tx.get(query), readOnlySnapshot()),
    ).rejects.toBe(quota);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await db.terminate();
  });

  it("shares reads, isolates callers, and invalidates cached data after writes", async () => {
    const state = createSeedState();
    const runTransaction = vi.fn(async () => ({
      ...state,
      mode: "attendee" as const,
    }));
    const db = { runTransaction } as unknown as Firestore;
    const repo = new FirestoreRepository(db);
    const [first, second] = await Promise.all([repo.read(), repo.read()]);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    first.people[0].name = "Must not leak";
    expect(second.people[0].name).not.toBe("Must not leak");
    expect((await repo.read()).people[0].name).not.toBe("Must not leak");
    expect(runTransaction).toHaveBeenCalledTimes(1);
    await repo.readFresh();
    expect(runTransaction).toHaveBeenCalledTimes(2);
    await repo.update((current) => ({ state: current }));
    await repo.read();
    expect(runTransaction).toHaveBeenCalledTimes(4);
  });

  it("backs off quota failures instead of repeatedly reading the entire workspace", async () => {
    const quota = Object.assign(new Error("Quota exceeded."), { code: 8 });
    const runTransaction = vi.fn().mockRejectedValue(quota);
    const repo = new FirestoreRepository({
      runTransaction,
    } as unknown as Firestore);
    await expect(repo.read()).rejects.toBe(quota);
    await expect(repo.read()).rejects.toBe(quota);
    await expect(repo.update((state) => ({ state }))).rejects.toBe(quota);
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });
});
