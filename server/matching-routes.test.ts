import { describe, it, expect, vi } from "vitest";
import { matchingRoutes } from "./matching-routes";
import { createSeedState } from "../src/seed";
import type { Repository } from "./repository";
function fixture() {
  let state = createSeedState();
  const session = {
    personId: state.people[0].id,
    organizer: false,
    mode: "attendee" as const,
    demo: true,
  };
  const repository: Repository = {
    read: async () => structuredClone(state),
    update: async (fn) => {
      const r = fn(structuredClone(state));
      if (!r.error) state = r.state;
      return r;
    },
  };
  return { state, session, repository };
}
describe("authoritative matching routes", () => {
  it("enforces recommendation relevance independently of worker responses and reports a genuine empty outcome", async () => {
    const f = fixture();
    await f.repository.update((state) => {
      state.applications = [];
      state.events = [state.events[0], state.events[1]].map((e, i) => ({
        ...e,
        id: i ? "weak" : "strong",
        status: "open",
        date: "2099-01-01",
        endDate: "2099-01-01",
        deadline: "2099-01-01",
        capacity: 10000,
        eligibility: {},
      }));
      return { state };
    });
    const call = vi.fn().mockResolvedValue({
      results: [
        { eventId: "weak", similarity: 0.3036, reasons: [] },
        { eventId: "strong", similarity: 0.628, reasons: [] },
      ],
      interpreted_filters: {},
    });
    const routes = matchingRoutes(f.repository, { call });
    expect(await routes.handle("recommendations", f.session, {})).toMatchObject(
      {
        source: "semantic",
        outcome: "matched",
        results: [{ eventId: "strong" }],
      },
    );
    call.mockResolvedValue({
      results: [{ eventId: "weak", similarity: 0.3036, reasons: [] }],
      interpreted_filters: {},
    });
    expect(await routes.handle("recommendations", f.session, {})).toMatchObject(
      { source: "semantic", outcome: "no_suitable_event", results: [] },
    );
    expect(await routes.handle("search", f.session, {})).toMatchObject({
      results: [{ eventId: "weak" }],
    });
    call.mockResolvedValue({
      results: [{ eventId: "strong", similarity: 0.45, reasons: [] }],
      interpreted_filters: {},
    });
    expect(await routes.handle("recommendations", f.session, {})).toMatchObject(
      { outcome: "matched", results: [{ eventId: "strong" }] },
    );
    for (const similarity of [0.4499, NaN, Infinity, 1.01, undefined]) {
      call.mockResolvedValue({
        results: [{ eventId: "strong", similarity, reasons: [] }],
        interpreted_filters: {},
      });
      expect(
        await routes.handle("recommendations", f.session, {}),
      ).toMatchObject({ outcome: "no_suitable_event", results: [] });
    }
    call.mockImplementation(async () => {
      await f.repository.update((state) => {
        state.events[0].status = "draft";
        return { state };
      });
      return {
        results: [{ eventId: "strong", similarity: 0.9, reasons: [] }],
        interpreted_filters: {},
        outcome: "matched",
      };
    });
    expect(await routes.handle("recommendations", f.session, {})).toMatchObject(
      { outcome: "no_suitable_event", results: [] },
    );
  });

  it("returns an explicit empty structured fallback without mistaking a worker outage for semantic success", async () => {
    const f = fixture();
    await f.repository.update((state) => {
      state.events = [];
      return { state };
    });
    expect(
      await matchingRoutes(f.repository).handle(
        "recommendations",
        f.session,
        {},
      ),
    ).toMatchObject({
      source: "structured",
      outcome: "no_suitable_event",
      results: [],
      warnings: [expect.any(String)],
    });
  });
  it("revalidates inferred city and date constraints against changes during inference despite empty UI filters", async () => {
    const f = fixture();
    const eventId = f.state.events[0].id;
    await f.repository.update((state) => {
      Object.assign(state.events[0], {
        status: "open",
        date: "2099-01-15",
        endDate: "2099-01-15",
        deadline: "2099-01-14",
        location: "Belgrade",
        capacity: 10000,
      });
      return { state };
    });
    const call = vi.fn().mockImplementation(async () => {
      await f.repository.update((state) => {
        state.events[0].location = "Novi Sad";
        return { state };
      });
      return {
        results: [{ eventId, reasons: [] }],
        interpreted_filters: {
          city: "Belgrade",
          from: "2099-01-01",
          to: "2099-01-31",
        },
      };
    });
    expect(
      await matchingRoutes(f.repository, { call }).handle("search", f.session, {
        query: "events in Belgrade in January",
        filters: { city: "", from: "", to: "", format: "" },
      }),
    ).toMatchObject({ source: "semantic", results: [] });
  });
  it("allows nonempty UI filters to override inferred filters", async () => {
    const f = fixture();
    const eventId = f.state.events[0].id;
    await f.repository.update((state) => {
      Object.assign(state.events[0], {
        status: "open",
        date: "2099-01-15",
        endDate: "2099-01-15",
        deadline: "2099-01-14",
        location: "Novi Sad",
        capacity: 10000,
      });
      return { state };
    });
    const call = vi.fn().mockResolvedValue({
      results: [{ eventId, reasons: [] }],
      interpreted_filters: { city: "Belgrade" },
    });
    expect(
      await matchingRoutes(f.repository, { call }).handle("search", f.session, {
        query: "Belgrade events",
        filters: { city: "Novi Sad" },
      }),
    ).toMatchObject({ results: [{ eventId }] });
  });
  it("rejects private extraction replacement at the atomic confirmation boundary", async () => {
    const f = fixture();
    await f.repository.update((state) => {
      state.people[0].updated_at = "v1";
      state.people[0].cv_document = {
        storage_path: "cv.pdf",
        filename: "cv.pdf",
        content_type: "application/pdf",
        size_bytes: 10,
        uploaded_at: "today",
        extraction_status: "not_started",
        extracted_at: null,
      };
      return { state };
    });
    let hash = "reviewed";
    const update = f.repository.update.bind(f.repository);
    f.repository.supportsCvExtractionGuard = true;
    f.repository.update = async (fn, guard) => {
      if (guard && hash !== guard.extractionHash)
        return {
          state: await f.repository.read(),
          error: "Your extraction changed. Review it again.",
        };
      return update(fn);
    };
    let proposalCalls = 0;
    const call = vi.fn().mockImplementation(async () => {
      const response = {
        results: [],
        proposal: { skills: ["Python"] },
        extraction_hash: "reviewed",
      };
      if (++proposalCalls === 2) hash = "replacement";
      return response;
    });
    const routes = matchingRoutes(f.repository, { call });
    await routes.handle("cv/proposal", f.session, {});
    const original = (await f.repository.read()).people[0].skills;
    await expect(
      routes.handle("cv/confirm", f.session, {
        confirmed_fields: { skills: ["Python"] },
        expected_profile_updated_at: "v1",
        expected_extraction_hash: "reviewed",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.repository.read()).people[0].skills).toEqual(original);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it.each(["draft", "closed", "full"])(
    "rechecks %s events after inference",
    async (change) => {
      const f = fixture();
      const call = vi.fn().mockImplementation(async () => {
        await f.repository.update((state) => {
          const e = state.events[0];
          if (change === "full") e.capacity = 0;
          else if (change === "closed") e.deadline = "2000-01-01";
          else e.status = "draft";
          return { state };
        });
        return { results: [{ eventId: f.state.events[0].id, reasons: [] }] };
      });
      expect(
        await matchingRoutes(f.repository, { call }).handle(
          "search",
          f.session,
          {},
        ),
      ).toMatchObject({ results: [] });
    },
  );
  it("rechecks admitted participant access after inference", async () => {
    const f = fixture();
    const eventId = f.state.events[0].id;
    await f.repository.update((state) => {
      state.events[0].status = "open";
      state.events[0].deadline = "2099-01-01";
      state.events[0].endDate = "2099-01-02";
      state.applications.push({
        id: "admission",
        eventId,
        personId: f.session.personId,
        status: "accepted",
      } as (typeof state.applications)[number]);
      return { state };
    });
    const call = vi.fn().mockImplementation(async () => {
      await f.repository.update((state) => ({
        state: { ...state, applications: [] },
      }));
      return { results: [] };
    });
    await expect(
      matchingRoutes(f.repository, { call }).handle("team", f.session, {
        event_id: eventId,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rechecks team membership after inference", async () => {
    const f = fixture();
    const eventId = f.state.events[0].id;
    await f.repository.update((state) => {
      state.events[0].status = "open";
      state.events[0].deadline = "2099-01-01";
      state.events[0].endDate = "2099-01-02";
      state.teams.push({
        id: "review-team",
        eventId,
        memberIds: [f.session.personId],
        archived: false,
      } as (typeof state.teams)[number]);
      return { state };
    });
    const call = vi.fn().mockImplementation(async () => {
      await f.repository.update((state) => {
        state.teams.find((t) => t.id === "review-team")!.memberIds = [];
        return { state };
      });
      return { results: [] };
    });
    await expect(
      matchingRoutes(f.repository, { call }).handle("team", f.session, {
        team_id: "review-team",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects a CV replaced while extraction is running", async () => {
    const f = fixture();
    await f.repository.update((state) => {
      state.people[0].updated_at = "revision1";
      state.people[0].cv_document = {
        storage_path: "old.pdf",
        filename: "cv.pdf",
        content_type: "application/pdf",
        size_bytes: 10,
        uploaded_at: "today",
        extraction_status: "not_started",
        extracted_at: null,
      };
      return { state };
    });
    const call = vi.fn().mockImplementation(async () => {
      await f.repository.update((state) => {
        state.people[0].cv_document!.storage_path = "new.pdf";
        return { state };
      });
      return {
        results: [],
        proposal: { skills: ["Python"] },
        extraction_hash: "hash",
      };
    });
    const storage = {
      read: async () => Buffer.from("%PDF-1.4"),
      save: async () => "path",
      remove: async () => {},
    };
    await expect(
      matchingRoutes(f.repository, { call }, storage).handle(
        "cv/extract",
        f.session,
        {},
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await f.repository.read()).people[0].cv_document?.storage_path,
    ).toBe("new.pdf");
  });
  it("rejects actor spoofing before worker call", async () => {
    const f = fixture();
    const call = vi.fn();
    await expect(
      matchingRoutes(f.repository, { call }).handle("search", f.session, {
        actor_id: "other",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(call).not.toHaveBeenCalled();
  });
  it("exposes explicit structured fallback", async () => {
    const f = fixture();
    expect(
      await matchingRoutes(f.repository).handle("search", f.session, {}),
    ).toMatchObject({ source: "structured", warnings: expect.any(Array) });
  });
  it("filters worker IDs against authoritative registration state", async () => {
    const f = fixture();
    const call = vi.fn().mockResolvedValue({
      results: [
        { eventId: "invented", reasons: [] },
        { eventId: f.state.events[0].id, reasons: [] },
      ],
    });
    await f.repository.update((state) => {
      state.events[0].status = "draft";
      return { state };
    });
    expect(
      await matchingRoutes(f.repository, { call }).handle(
        "search",
        f.session,
        {},
      ),
    ).toMatchObject({ results: [] });
    expect(call.mock.calls[0][1]).toBe(f.session.personId);
  });
  it("denies team candidate visibility without event membership", async () => {
    const f = fixture();
    await expect(
      matchingRoutes(f.repository, { call: vi.fn() }).handle(
        "team",
        f.session,
        { event_id: "invented" },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects stale CV confirmation", async () => {
    const f = fixture();
    await expect(
      matchingRoutes(f.repository).handle("cv/confirm", f.session, {
        confirmed_fields: { skills: ["Python"] },
        expected_profile_updated_at: null,
        expected_extraction_hash: "old",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
