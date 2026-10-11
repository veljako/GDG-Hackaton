import { z } from "zod";
import { eventSchema, profileSchema } from "./schema";
import { normalizeState } from "../src/discovery";
import type { DemoState } from "../src/types";
import type { Repository } from "./repository";

export const entityCollections = [
  "people",
  "events",
  "teams",
  "applications",
  "invitations",
  "notifications",
] as const;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
const short = z.string().max(200);
const text = z.string().max(10000);
const color = z.enum(["blue", "red", "yellow", "green"]);
const person = profileSchema
  .required({
    name: true,
    title: true,
    city: true,
    school: true,
    bio: true,
    skills: true,
    interests: true,
    roles: true,
    experience: true,
    lookingForTeam: true,
    linkedin: true,
    kaggle: true,
  })
  .extend({
    id,
    color,
    avatar: z.string().max(2000),
    // This is a trusted import schema, distinct from public UPDATE_PROFILE.
    first_name: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    email: z.email().nullable().optional(),
    email_verified: z.boolean().optional(),
    created_at: z.iso.datetime().nullable().optional(),
    updated_at: z.iso.datetime().nullable().optional(),
    cv_document: z
      .object({
        storage_path: z
          .string()
          .regex(/^cvs\/[a-f0-9]{64}\/[a-f0-9-]{36}\.pdf$/),
        filename: z
          .string()
          .min(1)
          .max(200)
          .regex(/\.pdf$/i),
        content_type: z.literal("application/pdf"),
        size_bytes: z
          .number()
          .int()
          .positive()
          .max(5 * 1024 * 1024),
        uploaded_at: z.iso.datetime(),
        extraction_status: z.enum([
          "not_started",
          "processing",
          "completed",
          "failed",
        ]),
        extracted_at: z.iso.datetime().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
  });
const datasetSchema = z
  .object({
    version: z.literal(1),
    people: z.array(person),
    events: z.array(
      eventSchema.extend({
        id,
        publishedAt: short.optional(),
        createdBy: id.optional(),
        publicationStatus: z.enum(["draft", "pending", "approved"]).optional(),
      }),
    ),
    teams: z.array(
      z
        .object({
          id,
          eventId: id,
          name: short.min(1),
          description: text,
          skills: z.array(short),
          memberIds: z.array(id),
          captainId: id,
          archived: z.boolean(),
        })
        .strict(),
    ),
    applications: z.array(
      z
        .object({
          id,
          eventId: id,
          personId: id,
          teamId: id.optional(),
          status: z.enum(["pending", "accepted", "rejected"]),
          role: z.enum(["Participant", "Mentor", "Speaker", "Judge"]),
          motivation: text,
          submittedAt: short,
        })
        .strict(),
    ),
    invitations: z.array(
      z
        .object({
          id,
          teamId: id,
          personId: id,
          fromId: id,
          status: z.enum(["pending", "accepted", "declined"]),
          createdAt: short,
        })
        .strict(),
    ),
    notifications: z.array(
      z
        .object({
          id,
          eventId: id.optional(),
          personId: id,
          title: short,
          body: text,
          read: z.boolean(),
          href: z.string().max(2000),
        })
        .strict(),
    ),
    connections: z.array(z.string().max(257)),
    currentPersonId: z.string().default(""),
    mode: z.enum(["attendee", "organizer"]).default("attendee"),
    recommendations: z.unknown().optional(),
  })
  .strict();

export function emptyWorkspace(): DemoState {
  return {
    version: 1,
    people: [],
    events: [],
    teams: [],
    applications: [],
    invitations: [],
    notifications: [],
    connections: [],
    currentPersonId: "",
    mode: "attendee",
  };
}
export function datasetCounts(state: DemoState) {
  return Object.fromEntries(
    [...entityCollections, "connections" as const].map((key) => [
      key,
      state[key].length,
    ]),
  );
}
export function validateDataset(input: unknown): DemoState {
  const parsed = datasetSchema.parse(input);
  const state = normalizeState({
    ...parsed,
    currentPersonId: "",
    mode: "attendee",
    recommendations: undefined,
  } as DemoState);
  delete state.recommendations;
  const sets = Object.fromEntries(
    entityCollections.map((key) => {
      const ids = state[key].map((record) => record.id);
      if (new Set(ids).size !== ids.length)
        throw Error(`Duplicate IDs in ${key}.`);
      return [key, new Set(ids)];
    }),
  ) as Record<(typeof entityCollections)[number], Set<string>>;
  const reference = (key: keyof typeof sets, value: string) => {
    if (!sets[key].has(value))
      throw Error(`Broken reference: ${key}/${value}.`);
  };
  for (const team of state.teams) {
    reference("events", team.eventId);
    reference("people", team.captainId);
    team.memberIds.forEach((member) => reference("people", member));
    if (
      !team.memberIds.includes(team.captainId) ||
      new Set(team.memberIds).size !== team.memberIds.length
    )
      throw Error(`Invalid team members: ${team.id}.`);
  }
  for (const application of state.applications) {
    reference("events", application.eventId);
    reference("people", application.personId);
    if (application.teamId) {
      reference("teams", application.teamId);
      if (
        state.teams.find((team) => team.id === application.teamId)?.eventId !==
        application.eventId
      )
        throw Error(
          `Broken reference: application ${application.id} has a team from another event.`,
        );
    }
  }
  for (const invitation of state.invitations) {
    reference("teams", invitation.teamId);
    reference("people", invitation.personId);
    reference("people", invitation.fromId);
  }
  for (const notice of state.notifications) {
    reference("people", notice.personId);
    if (notice.eventId) reference("events", notice.eventId);
  }
  if (new Set(state.connections).size !== state.connections.length)
    throw Error("Duplicate connections.");
  for (const key of state.connections) {
    const pair = key.split(":");
    if (pair.length !== 2 || pair[0] === pair[1])
      throw Error(`Invalid connection: ${key}.`);
    pair.forEach((personId) => reference("people", personId));
  }
  return state;
}
export async function importDataset(repository: Repository, input: unknown) {
  const dataset = validateDataset(input);
  const result = await repository.update((current) => {
    if (Object.values(datasetCounts(current)).some((count) => count > 0))
      return {
        state: current,
        error:
          "Import requires an empty workspace. Existing data was preserved.",
      };
    return { state: structuredClone(dataset) };
  });
  if (result.error) throw Error(result.error);
  return datasetCounts(result.state);
}
