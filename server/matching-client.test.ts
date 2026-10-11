import { describe, it, expect, vi, afterEach } from "vitest";
import {
  HttpMatchingClient,
  MatchingUnavailable,
  queueMatchingSync,
} from "./matching-client";
import { createSeedState } from "../src/seed";
afterEach(() => vi.unstubAllGlobals());
describe("private matching client", () => {
  it("defers matching for an unfinished actor even when its profile has usable fields", async () => {
    const state = createSeedState();
    state.people[0].onboarding = {
      version: 1,
      status: "required",
      completed_at: null,
    };
    const call = vi.fn();
    expect(
      await queueMatchingSync(
        { call },
        { read: async () => state },
        state.people[0].id,
      ),
    ).toEqual({ matching_sync: "deferred" });
    expect(call).not.toHaveBeenCalled();
  });
  it("queues a freshly read authoritative snapshot after a canonical commit", async () => {
    const state = createSeedState();
    state.people[0].updated_at = "latest-committed";
    const read = vi.fn().mockResolvedValue(state);
    const call = vi.fn().mockResolvedValue({ results: [] });
    expect(
      await queueMatchingSync({ call }, { read }, state.people[0].id),
    ).toEqual({ matching_sync: "queued" });
    expect(call).toHaveBeenCalledWith(
      "queue_sync",
      state.people[0].id,
      state,
      {},
    );
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("queues event snapshots for an unfinished organization actor while retaining the worker candidate gate", async () => {
    const state = createSeedState();
    state.people[0].onboarding = {
      version: 1,
      status: "required",
      completed_at: null,
    };
    const call = vi.fn().mockResolvedValue({ results: [] });
    expect(
      await queueMatchingSync(
        { call },
        { read: async () => state },
        state.people[0].id,
        true,
      ),
    ).toEqual({ matching_sync: "queued" });
    expect(call).toHaveBeenCalledWith(
      "queue_sync",
      state.people[0].id,
      state,
      {},
    );
    expect(state.people[0].onboarding.status).toBe("required");
  });
  it("reports queue delivery failure without rejecting saved changes", async () => {
    const state = createSeedState();
    const call = vi.fn().mockRejectedValue(new Error("private credentials"));
    const result = await queueMatchingSync(
      { call },
      { read: async () => state },
      state.people[0].id,
    );
    expect(result.matching_sync).toBe("unavailable");
    expect(result.warnings?.join()).toContain("changes were saved");
    expect(result.warnings?.join()).not.toContain("credentials");
  });
  it("sends server actor and authoritative context with private token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    vi.stubGlobal("fetch", fetch);
    await new HttpMatchingClient("http://localhost:9000", "secret").call(
      "search_events",
      "owner",
      createSeedState(),
      { query: "science" },
    );
    const init = fetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer secret");
    const payload = JSON.parse(init.body);
    expect(payload.actor_id).toBe("owner");
    expect(payload.context.people.length).toBeGreaterThan(0);
  });
  it("sanitizes worker outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret stack")),
    );
    await expect(
      new HttpMatchingClient("http://localhost:9000", "secret").call(
        "recommend_events",
        "owner",
        createSeedState(),
        {},
      ),
    ).rejects.toBeInstanceOf(MatchingUnavailable);
  });
  it("rejects malformed inference output", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ results: [{ reasons: "private" }] })),
        ),
    );
    await expect(
      new HttpMatchingClient("http://localhost:9000", "secret").call(
        "search_events",
        "owner",
        createSeedState(),
        {},
      ),
    ).rejects.toBeInstanceOf(MatchingUnavailable);
  });
});
