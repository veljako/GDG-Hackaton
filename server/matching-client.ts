import type { DemoState } from "../src/types";
import { requiresOnboarding } from "../src/onboarding";
export type MatchingOperation =
  | "queue_sync"
  | "search_events"
  | "recommend_events"
  | "team_candidates"
  | "extract_cv"
  | "cv_proposal"
  | "confirm_cv"
  | "remove_cv";
export type MatchingResult = {
  eventId?: string;
  personId?: string;
  similarity?: number;
  reasons: string[];
};
export type MatchingResponse = {
  results: MatchingResult[];
  proposal?: Record<string, unknown>;
  extraction_hash?: string;
  model?: string;
  source?: string;
  warnings?: string[];
  interpreted_filters?: Record<string, unknown>;
};
export interface MatchingClient {
  call(
    operation: MatchingOperation,
    actor: string,
    state: DemoState,
    input: Record<string, unknown>,
  ): Promise<MatchingResponse>;
}
export async function queueMatchingSync(
  client: MatchingClient | undefined,
  repository: { read(): Promise<DemoState>; readFresh?(): Promise<DemoState> },
  actor: string,
  includeEvents = false,
) {
  const state = await (repository.readFresh?.() ?? repository.read());
  const current = state.people.find((p) => p.id === actor);
  if (current && requiresOnboarding(current) && !includeEvents)
    return { matching_sync: "deferred" as const };
  if (!client)
    return {
      matching_sync: "unavailable" as const,
      warnings: [
        "Semantic index updates are unavailable. Structured matching remains available.",
      ],
    };
  try {
    // Reload after commit: concurrent writes must not notify with an old revision.
    await client.call("queue_sync", actor, state, {});
    return { matching_sync: "queued" as const };
  } catch {
    return {
      matching_sync: "unavailable" as const,
      warnings: [
        "Your changes were saved. Semantic index updates are unavailable; structured matching remains available.",
      ],
    };
  }
}
export class MatchingUnavailable extends Error {
  constructor() {
    super(
      "Semantic matching is unavailable. Structured matching remains available.",
    );
  }
}
export class HttpMatchingClient implements MatchingClient {
  constructor(
    private url: string,
    private token: string,
    private timeout = 90000,
  ) {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Invalid matching worker URL.");
  }
  async call(
    operation: MatchingOperation,
    actor_id: string,
    state: DemoState,
    input: Record<string, unknown>,
  ): Promise<MatchingResponse> {
    try {
      const response = await fetch(new URL("/v1/matching", this.url), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(
          operation === "queue_sync"
            ? Math.min(this.timeout, 5000)
            : this.timeout,
        ),
        body: JSON.stringify({
          operation,
          actor_id,
          context: {
            people: state.people,
            events: state.events,
            teams: state.teams,
            applications: state.applications,
          },
          input,
        }),
      });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 512000) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(part.value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !Array.isArray(data.results) ||
        data.results.length > 200 ||
        data.results.some(
          (r: MatchingResult) =>
            !r ||
            !Array.isArray(r.reasons) ||
            r.reasons.length > 20 ||
            r.reasons.some((x) => typeof x !== "string" || x.length > 2000) ||
            (r.similarity !== undefined && !Number.isFinite(r.similarity)),
        )
      )
        throw new Error();
      return data;
    } catch {
      throw new MatchingUnavailable();
    }
  }
}
