import { z } from "zod";
import type { Repository } from "./repository";
import type { CvStorage } from "./cv-storage";
import { profileSchema } from "./schema";
import { requiresOnboarding } from "../src/onboarding";
import { execute, view, type Session } from "./service";
import {
  registrationOpen,
  searchEvents,
  recommendationsFor,
} from "../src/discovery";
import {
  MatchingUnavailable,
  queueMatchingSync,
  type MatchingClient,
  type MatchingResponse,
} from "./matching-client";
export class MatchingRouteError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const query = z
  .object({
    query: z.string().max(2000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    event_id: z.string().max(128).optional(),
    team_id: z.string().max(128).optional(),
    filters: z
      .object({
        kind: z.string().max(100).optional(),
        topic: z.string().max(100).optional(),
        city: z.string().max(100).optional(),
        format: z.string().max(100).optional(),
        from: z.string().max(20).optional(),
        to: z.string().max(20).optional(),
        available: z.boolean().optional(),
        past: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
type Proposal = {
  response: MatchingResponse;
  path: string;
  revision: string | null | undefined;
};
export function matchingRoutes(
  repository: Repository,
  client?: MatchingClient,
  storage?: CvStorage,
) {
  const proposals = new Map<string, Proposal>();
  function invalid(message: string, status = 400): never {
    throw new MatchingRouteError(status, message);
  }
  return {
    invalidate(uid: string) {
      proposals.delete(uid);
    },
    async handle(route: string, session: Session, raw: unknown) {
      const state = await repository.read();
      const person = state.people.find((p) => p.id === session.personId)!;
      if (!person) invalid("Profile not found.", 404);
      if (
        requiresOnboarding(person) &&
        !["cv/extract", "cv/proposal"].includes(route)
      )
        invalid("Finish your profile setup before finding matches.", 403);
      if (route === "cv/proposal") {
        if (!client || !person.cv_document) throw new MatchingUnavailable();
        const response = await client.call("cv_proposal", person.id, state, {
          storage_path: person.cv_document.storage_path,
        });
        if (!response.proposal || !response.extraction_hash)
          invalid("Extract your current CV before reviewing it.", 409);
        if (!profileSchema.safeParse(response.proposal).success)
          throw new MatchingUnavailable();
        const saved = {
          response,
          path: person.cv_document.storage_path,
          revision: person.updated_at,
        };
        proposals.set(person.id, saved);
        return {
          ...saved.response,
          expected_profile_updated_at: saved.revision,
        };
      }
      if (route === "cv/extract") {
        if (!z.object({}).strict().safeParse(raw).success)
          invalid("Invalid extraction request.");
        if (!client || !storage) throw new MatchingUnavailable();
        const path = person.cv_document?.storage_path;
        if (!path) invalid("Upload a PDF CV first.");
        const bytes = await storage.read(person.id, path);
        if (bytes.length > 5 * 1024 * 1024) invalid("CV is too large.");
        const response = await client.call("extract_cv", person.id, state, {
          pdf_base64: bytes.toString("base64"),
          storage_path: path,
        });
        const current = (await (repository.readFresh?.() ?? repository.read())).people.find(
          (p) => p.id === person.id,
        );
        if (!profileSchema.safeParse(response.proposal).success)
          throw new MatchingUnavailable();
        if (
          current?.cv_document?.storage_path !== path ||
          current.updated_at !== person.updated_at
        )
          invalid(
            "Your profile or CV changed during extraction. Extract again.",
            409,
          );
        if (
          !response.proposal ||
          typeof response.extraction_hash !== "string" ||
          response.extraction_hash.length > 256
        )
          throw new MatchingUnavailable();
        proposals.set(person.id, {
          response,
          path,
          revision: person.updated_at,
        });
        return { ...response, expected_profile_updated_at: person.updated_at };
      }
      if (route === "cv/confirm") {
        const parsed = z
          .object({
            confirmed_fields: z.record(z.string(), z.unknown()),
            expected_profile_updated_at: z.string().nullable(),
            expected_extraction_hash: z.string().max(256),
          })
          .strict()
          .safeParse(raw);
        if (!parsed.success) invalid("Invalid confirmation.");
        const input = parsed.data;
        const saved = proposals.get(person.id);
        if (
          !saved ||
          saved.path !== person.cv_document?.storage_path ||
          saved.revision !== person.updated_at ||
          input.expected_profile_updated_at !== (person.updated_at ?? null) ||
          input.expected_extraction_hash !== saved.response.extraction_hash
        )
          invalid("Your profile or CV changed. Extract again.", 409);
        if (!client) throw new MatchingUnavailable();
        const privateProposal = await client.call(
          "cv_proposal",
          person.id,
          state,
          { storage_path: saved.path },
        );
        if (privateProposal.extraction_hash !== saved.response.extraction_hash)
          invalid("Your extraction changed. Review it again.", 409);
        // Only fields offered by the private extraction can be confirmed; execute validates the public profile schema.
        if (
          Object.keys(input.confirmed_fields).some(
            (k) =>
              !(k in saved.response.proposal!) ||
              JSON.stringify(input.confirmed_fields[k]) !==
                JSON.stringify(saved.response.proposal![k]) ||
              ["id", "cv", "cv_document", "email", "email_verified"].includes(
                k,
              ),
          )
        )
          invalid("Choose fields from the CV proposal.");
        if (!repository.supportsCvExtractionGuard)
          throw new MatchingUnavailable();
        const result = await repository.update(
          (current) => {
            const p = current.people.find((p) => p.id === person.id);
            if (
              p?.updated_at !== saved.revision ||
              p?.cv_document?.storage_path !== saved.path
            )
              return {
                state: current,
                error: "Your profile or CV changed. Extract again.",
              };
            const applied = execute(current, session, {
              type: "UPDATE_PROFILE",
              personId: person.id,
              changes: input.confirmed_fields,
            });
            if (!applied.error) {
              const target = applied.state.people.find(
                (p) => p.id === person.id,
              )!;
              if (target.cv_document) {
                target.cv_document.extraction_status = "completed";
                target.cv_document.extracted_at = new Date().toISOString();
              }
            }
            return applied;
          },
          {
            personId: person.id,
            storagePath: saved.path,
            extractionHash: input.expected_extraction_hash,
            sourceUpdatedAt: saved.revision ?? null,
          },
        );
        if (result.error) invalid(result.error, 409);
        proposals.delete(person.id);
        await client
          .call("confirm_cv", person.id, result.state, {
            ...input,
            storage_path: saved.path,
          })
          .catch(() => console.error("CV review acknowledgement unavailable."));
        return {
          state: view(result.state, session),
          message: "CV fields confirmed.",
          ...(await queueMatchingSync(client, repository, person.id)),
        };
      }
      const parsed = query.safeParse(raw);
      if (!parsed.success) invalid("Invalid matching request.");
      const input = parsed.data;
      if (route === "team") {
        const team = state.teams.find((t) => t.id === input.team_id);
        const eventId = team?.eventId ?? input.event_id;
        const event = state.events.find((e) => e.id === eventId);
        const access = team
          ? team.memberIds.includes(person.id) && !team.archived
          : state.applications.some(
              (a) =>
                a.eventId === eventId &&
                a.personId === person.id &&
                a.status === "accepted",
            );
        if (!access || !event || !registrationOpen(event))
          invalid(
            "Join an eligible event or team before finding teammates.",
            403,
          );
        if (!client) throw new MatchingUnavailable();
        const response = await client.call(
          "team_candidates",
          person.id,
          state,
          { ...input, event_id: eventId },
        );
        const current = await repository.read();
        const currentTeam = input.team_id
          ? current.teams.find((t) => t.id === input.team_id)
          : undefined;
        const currentEvent = current.events.find((e) => e.id === eventId);
        const currentAccess = input.team_id
          ? currentTeam &&
            !currentTeam.archived &&
            currentTeam.eventId === eventId &&
            currentTeam.memberIds.includes(person.id)
          : current.applications.some(
              (a) =>
                a.eventId === eventId &&
                a.personId === person.id &&
                a.status === "accepted",
            );
        if (
          !current.people.some((p) => p.id === person.id) ||
          !currentAccess ||
          !currentEvent ||
          !registrationOpen(currentEvent)
        )
          invalid("Event or team access changed.", 403);
        const visible = view(current, session).people;
        return {
          model: response.model,
          source: "semantic",
          warnings: response.warnings,
          results: response.results
            .filter(
              (r) =>
                visible.some((p) => p.id === r.personId && p.lookingForTeam) &&
                r.personId !== person.id &&
                current.applications.some(
                  (a) =>
                    a.eventId === eventId &&
                    a.personId === r.personId &&
                    a.status === "accepted",
                ) &&
                !current.teams.some(
                  (t) =>
                    !t.archived &&
                    t.eventId === eventId &&
                    t.memberIds.includes(r.personId!),
                ),
            )
            .slice(0, input.limit ?? 20),
        };
      }
      if (!["search", "recommendations"].includes(route))
        invalid("Not found.", 404);
      const eligible = (current: typeof state, filters = input.filters) =>
        searchEvents(current, { ...filters, q: "" }).filter(
          (e) =>
            registrationOpen(e) &&
            current.applications.filter(
              (a) => a.eventId === e.id && a.status !== "rejected",
            ).length < e.capacity,
        );
      try {
        if (!client) throw new MatchingUnavailable();
        const response = await client.call(
          route === "search" ? "search_events" : "recommend_events",
          person.id,
          state,
          input,
        );
        const interpreted = query.shape.filters.safeParse(
          response.interpreted_filters,
        );
        if (!interpreted.success) throw new MatchingUnavailable();
        const explicit = Object.fromEntries(
          Object.entries(input.filters ?? {}).filter(([, value]) =>
            typeof value === "string"
              ? value.trim().length > 0
              : value !== undefined && value !== null,
          ),
        );
        const effectiveFilters = { ...interpreted.data, ...explicit };
        const allowed = eligible(await repository.read(), effectiveFilters);
        return {
          model: response.model,
          warnings: response.warnings,
          source: "semantic",
          results: response.results
            .filter((r) => allowed.some((e) => e.id === r.eventId))
            .slice(0, input.limit ?? 20),
        };
      } catch (error) {
        if (!(error instanceof MatchingUnavailable)) throw error;
        const current = await repository.read();
        const allowed = eligible(current);
        const currentPerson = current.people.find((p) => p.id === person.id);
        if (!currentPerson) invalid("Profile not found.", 404);
        const results =
          route === "recommendations"
            ? recommendationsFor(current, currentPerson).filter((r) =>
                allowed.some((e) => e.id === r.eventId),
              )
            : searchEvents(current, { ...input.filters, q: input.query })
                .filter((e) => allowed.some((a) => a.id === e.id))
                .map((e) => ({ eventId: e.id, reasons: [] }));
        return {
          source: "structured",
          results: results.slice(0, input.limit ?? 20),
          warnings: [error.message],
        };
      }
    },
  };
}
