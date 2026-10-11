import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
const text = z.string().max(10000);
const short = z.string().max(200);
const list = z.array(short).max(50);
const role = z.enum(["Participant", "Mentor", "Speaker", "Judge"]);
const kind = z.enum(["hackathon", "conference", "meetup", "festival"]);
const goal = z.enum([
  "Learning",
  "Networking",
  "Building",
  "Career",
  "Research",
]);
const level = z.enum(["Beginner", "Intermediate", "Advanced"]);
const format = z.enum(["In person", "Hybrid", "Online"]);
const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .nullable();
const period = <
  T extends { start_date: string | null; end_date: string | null },
>(
  value: T,
) => !value.start_date || !value.end_date || value.start_date <= value.end_date;
export const eventSchema = z
  .object({
    kind: kind.optional(),
    organizationId: id.optional(),
    registration: z.enum(["review", "automatic"]).optional(),
    audience: z
      .object({
        skills: list,
        goals: z.array(goal).max(5),
        roles: z.array(role).max(4),
        levels: z.array(level).max(3),
      })
      .strict()
      .optional(),
    title: short.min(1),
    organizer: short.min(1),
    date: short,
    endDate: short,
    deadline: short,
    location: short.min(1),
    venue: short,
    description: text,
    theme: short,
    tags: list,
    color: z.enum(["blue", "red", "yellow", "green"]),
    format: z.enum(["In person", "Hybrid", "Online"]),
    capacity: z.number().int().positive().max(100000),
    minTeamSize: z.number().int().positive().max(100),
    maxTeamSize: z.number().int().positive().max(100),
    status: z.enum(["open", "past", "draft"]),
    schedule: z
      .array(
        z.object({ time: short, title: short, description: text }).strict(),
      )
      .max(100),
  })
  .strict();
export const profileSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(50),
    education: z
      .array(
        z
          .object({
            institution: short.min(1),
            degree: short,
            field: short,
            start_date: month,
            end_date: month,
            description: text,
          })
          .strict()
          .refine(period, "End date must follow start date."),
      )
      .max(30),
    work_experience: z
      .array(
        z
          .object({
            company: short.min(1),
            position: short,
            location: short,
            start_date: month,
            end_date: month,
            description: text,
          })
          .strict()
          .refine(period, "End date must follow start date."),
      )
      .max(50),
    languages: list,
    status: z.enum(["Student", "Employed", "Freelancer"]).nullable(),
    birth_year: z
      .number()
      .int()
      .min(1900)
      .refine((year) => year <= new Date().getUTCFullYear())
      .nullable(),
    experience_level: z.enum(["Junior", "Mid", "Senior"]).nullable(),
    name: short.min(1),
    title: short,
    city: short,
    school: short,
    bio: text,
    skills: list,
    interests: list,
    roles: z.array(role).min(1).max(4),
    experience: short,
    lookingForTeam: z.boolean(),
    linkedin: short,
    kaggle: short,
    cv: short,
    preferences: z
      .object({
        goals: z.array(goal).max(5),
        kinds: z.array(kind).max(4),
        formats: z.array(format).max(3),
        location: short,
        level: level.optional(),
        notify: z.boolean(),
      })
      .strict(),
  })
  .partial()
  .strict();
const application = { eventId: id, personId: id, role, motivation: text };
const event = eventSchema;
const profile = profileSchema;
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_EVENT"), event }).strict(),
  z
    .object({
      type: z.literal("UPDATE_EVENT"),
      eventId: id,
      changes: event.omit({ organizationId: true }).partial(),
    })
    .strict(),
  z
    .object({ type: z.literal("SUBMIT_EVENT_FOR_APPROVAL"), eventId: id })
    .strict(),
  z
    .object({
      type: z.literal("REVIEW_EVENT_PUBLICATION"),
      eventId: id,
      decision: z.enum(["approve", "reject"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("SUBMIT_APPLICATION"),
      ...application,
      teamId: id.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("WITHDRAW_APPLICATION"), applicationId: id })
    .strict(),
  z
    .object({
      type: z.literal("REVIEW_APPLICATION"),
      applicationId: id,
      status: z.enum(["accepted", "rejected"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("CREATE_TEAM"),
      eventId: id,
      personId: id,
      name: short.min(1),
      description: text,
      skills: list,
      role: role.optional(),
      motivation: text.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("REUSE_TEAM"),
      eventId: id,
      personId: id,
      teamId: id,
      role: role.optional(),
      motivation: text.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("INVITE_PERSON"),
      teamId: id,
      personId: id,
      fromId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("RESPOND_INVITATION"),
      invitationId: id,
      response: z.enum(["accepted", "declined"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("CANCEL_INVITATION"),
      invitationId: id,
      actorId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("REMOVE_MEMBER"),
      teamId: id,
      personId: id,
      actorId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("UPDATE_PROFILE"),
      personId: id,
      changes: profile,
    })
    .strict(),
  z
    .object({ type: z.literal("TOGGLE_CONNECTION"), personId: id, otherId: id })
    .strict(),
  z
    .object({ type: z.literal("MARK_NOTIFICATIONS_READ"), personId: id })
    .strict(),
  z.object({ type: z.literal("RESET") }).strict(),
]);
