import { transition } from "../src/domain";
import type { DemoState, Transition } from "../src/types";
import { actionSchema } from "./schema";
import { recommendationsFor, registrationOpen } from "../src/discovery";

export type Session = {
  personId: string;
  organizer: boolean;
  mode: "attendee" | "organizer";
  demo: boolean;
};
export function execute(
  state: DemoState,
  session: Session,
  input: unknown,
): Transition {
  const fail = (error: string) => ({ state, error });
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success)
    return fail("Invalid request. Check the fields and try again.");
  const action = parsed.data;
  if (!state.people.some((p) => p.id === session.personId))
    return fail("Profile not found. Sign in again.");
  const asOrganizer = session.organizer && session.mode === "organizer";
  if (
    ["CREATE_EVENT", "UPDATE_EVENT", "REVIEW_APPLICATION", "RESET"].includes(
      action.type,
    ) &&
    !asOrganizer
  )
    return fail("Only an organizer can perform this action.");
  if (action.type === "RESET" && !session.demo)
    return fail("Reset is available only for the local demo.");
  if ("fromId" in action && action.fromId !== session.personId)
    return fail("You cannot send an invitation as another person.");
  if ("actorId" in action && action.actorId !== session.personId)
    return fail("You cannot act as another person.");
  if (
    [
      "SUBMIT_APPLICATION",
      "CREATE_TEAM",
      "REUSE_TEAM",
      "UPDATE_PROFILE",
      "TOGGLE_CONNECTION",
      "MARK_NOTIFICATIONS_READ",
    ].includes(action.type) &&
    "personId" in action &&
    action.personId !== session.personId
  )
    return fail("You can change only your own data.");
  if (action.type === "UPDATE_PROFILE") {
    const current = state.people.find((p) => p.id === session.personId)!;
    if (
      current.cv_document &&
      action.changes.cv !== undefined &&
      action.changes.cv !== current.cv
    )
      return fail(
        "Use the CV upload or removal control to change your stored CV.",
      );
    if (
      action.changes.first_name !== undefined ||
      action.changes.last_name !== undefined
    ) {
      const first = action.changes.first_name ?? current.first_name ?? "";
      const last = action.changes.last_name ?? current.last_name ?? "";
      // Explicit name parts become the display name; untouched legacy names survive.
      action.changes.name = [first, last].filter(Boolean).join(" ");
    }
  }
  if (
    action.type === "SUBMIT_APPLICATION" ||
    action.type === "CREATE_TEAM" ||
    action.type === "REUSE_TEAM"
  ) {
    const event = state.events.find((e) => e.id === action.eventId);
    if (event && !registrationOpen(event))
      return fail("Registration is closed for this event.");
  }
  if (action.type === "RESPOND_INVITATION" && action.response === "accepted") {
    const invitation = state.invitations.find(
      (i) => i.id === action.invitationId && i.personId === session.personId,
    );
    const team = state.teams.find((t) => t.id === invitation?.teamId);
    const event = state.events.find((e) => e.id === team?.eventId);
    const registered = state.applications.some(
      (a) => a.eventId === event?.id && a.personId === session.personId,
    );
    if (event && !registered && !registrationOpen(event))
      return fail("Registration is closed for this event.");
  }
  const result = transition(
    {
      ...state,
      currentPersonId: session.personId,
      mode: asOrganizer ? "organizer" : "attendee",
    },
    action,
  );
  if (result.error) return fail(result.error);
  const now = new Date().toISOString();
  if (action.type === "UPDATE_PROFILE")
    result.state.people.find((p) => p.id === session.personId)!.updated_at =
      now;
  if (action.type === "CREATE_EVENT" || action.type === "UPDATE_EVENT") {
    const eventId =
      action.type === "CREATE_EVENT" ? result.createdId : action.eventId;
    const event = result.state.events.find((e) => e.id === eventId);
    const previous = state.events.find((e) => e.id === eventId);
    if (
      event &&
      previous &&
      previous.status !== "draft" &&
      !previous.publishedAt
    )
      event.publishedAt = "legacy";
    // Legacy open events are already published; editing them cannot send a new blast.
    const firstPublication =
      !previous || (!previous.publishedAt && previous.status === "draft");
    if (event && event.status === "open" && firstPublication) {
      event.publishedAt = now;
      if (registrationOpen(event))
        for (const person of result.state.people) {
          if (!person.preferences?.notify) continue;
          const match = recommendationsFor(result.state, person).find(
            (r) => r.eventId === event.id,
          );
          const noticeId = `recommend-${event.id}-${person.id}`;
          if (
            !match ||
            result.state.notifications.some((n) => n.id === noticeId)
          )
            continue;
          result.state.notifications.unshift({
            id: noticeId,
            eventId: event.id,
            personId: person.id,
            title: "A new event for you",
            body: `${event.title} · ${match.reasons.join(" · ")}`,
            read: false,
            href: `/events/${event.id}`,
          });
        }
    }
  }
  const oldApplications = new Set(state.applications.map((a) => a.id));
  const oldInvitations = new Set(state.invitations.map((i) => i.id));
  for (const application of result.state.applications)
    if (!oldApplications.has(application.id)) application.submittedAt = now;
  for (const invitation of result.state.invitations)
    if (!oldInvitations.has(invitation.id)) invitation.createdAt = now;
  // Actor/view belong to a session; they must never be persisted as shared identity.
  return {
    ...result,
    ...(action.type === "RESET" ? { message: "Shared demo restored." } : {}),
    state: {
      ...result.state,
      currentPersonId: state.currentPersonId,
      mode: state.mode,
    },
  };
}
export function view(state: DemoState, session: Session): DemoState {
  const result = structuredClone(state);
  const current = state.people.find((p) => p.id === session.personId);
  result.recommendations = current ? recommendationsFor(state, current) : [];
  result.people = result.people.map((p) => {
    if (p.id === session.personId) return p;
    const {
      preferences: _preferences,
      email: _email,
      email_verified: _verified,
      phone: _phone,
      cv_document: _document,
      created_at: _created,
      updated_at: _updated,
      ...publicProfile
    } = p;
    return publicProfile;
  });
  result.currentPersonId = session.personId;
  result.mode =
    session.organizer && session.mode === "organizer"
      ? "organizer"
      : "attendee";
  result.notifications = result.notifications.filter(
    (n) => n.personId === session.personId,
  );
  result.connections = result.connections.filter((c) =>
    c.split(":").includes(session.personId),
  );
  if (result.mode !== "organizer") {
    result.events = result.events.filter((e) => e.status !== "draft");
    const events = new Set(result.events.map((e) => e.id));
    result.teams = result.teams.filter((t) => events.has(t.eventId));
    result.applications = result.applications
      .filter((a) => events.has(a.eventId))
      .map((a) =>
        a.personId === session.personId ? a : { ...a, motivation: "" },
      );
    result.people = result.people.map((p) => {
      if (p.id === session.personId) return p;
      const { cv: _cv, ...publicProfile } = p;
      return publicProfile;
    });
    result.invitations = result.invitations.filter(
      (i) =>
        i.personId === session.personId ||
        result.teams.some(
          (t) => t.id === i.teamId && t.memberIds.includes(session.personId),
        ),
    );
  }
  return result;
}
