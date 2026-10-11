import { transition } from "../src/domain";
import type { Action, DemoState, Transition } from "../src/types";
import { actionSchema } from "./schema";
import { recommendationsFor, registrationOpen } from "../src/discovery";
import { publicPerson } from "./users";
import { requiresOnboarding } from "../src/onboarding";
import type { OrganizationSnapshot } from "../src/organizations";

export type Session = {
  personId: string;
  organizer: boolean;
  mode: "attendee" | "organizer";
  demo: boolean;
  legacyOrganizer?: boolean;
  organizations?: OrganizationSnapshot["organizations"];
  memberships?: OrganizationSnapshot["memberships"];
  identityEmail?: string | null;
  identityEmailVerified?: boolean;
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
  let action: Action = parsed.data;
  const management = [
    "CREATE_EVENT",
    "UPDATE_EVENT",
    "SUBMIT_EVENT_FOR_APPROVAL",
    "REVIEW_EVENT_PUBLICATION",
    "REVIEW_APPLICATION",
  ];
  const asOrganizer = session.organizer && session.mode === "organizer";
  const legacy =
    session.legacyOrganizer ??
    (session.organizer && !session.memberships?.length);
  if (!state.people.some((p) => p.id === session.personId))
    return fail("Profile not found. Sign in again.");
  if (
    requiresOnboarding(state.people.find((p) => p.id === session.personId)!) &&
    action.type !== "UPDATE_PROFILE" &&
    !(
      asOrganizer &&
      (legacy || session.memberships?.length) &&
      management.includes(action.type)
    )
  )
    return fail("Finish your profile setup before joining the community.");
  if ([...management, "RESET"].includes(action.type) && !asOrganizer)
    return fail("Only an organizer can perform this action.");
  const membership = (organizationId: string | undefined) =>
    session.memberships?.find(
      (m) =>
        m.organizationId === organizationId && m.personId === session.personId,
    );
  if (action.type === "CREATE_EVENT") {
    const organizationId =
      action.event.organizationId ??
      (session.memberships?.length === 1
        ? session.memberships[0].organizationId
        : undefined);
    if (organizationId) {
      const member = membership(organizationId);
      const organization = session.organizations?.find(
        (o) => o.id === organizationId,
      );
      if (!member || !organization)
        return fail("Choose an organization you belong to.");
      Object.assign(action.event, {
        organizationId,
        organizer: organization.name,
        createdBy: session.personId,
        publicationStatus:
          member.role === "admin" && action.event.status !== "draft"
            ? "approved"
            : "draft",
      });
      if (member.role !== "admin") action.event.status = "draft";
    } else if (!legacy)
      return fail("Choose an organization to host this event.");
  }
  if (
    [
      "UPDATE_EVENT",
      "SUBMIT_EVENT_FOR_APPROVAL",
      "REVIEW_EVENT_PUBLICATION",
      "REVIEW_APPLICATION",
    ].includes(action.type)
  ) {
    const applicationId =
      action.type === "REVIEW_APPLICATION" ? action.applicationId : undefined;
    const eventId =
      "eventId" in action
        ? action.eventId
        : state.applications.find((a) => a.id === applicationId)?.eventId;
    const event = state.events.find((e) => e.id === eventId);
    if (!event) return fail("Event not found.");
    const member = membership(event.organizationId);
    if (event.organizationId ? !member : !legacy)
      return fail("You cannot manage another organization's event.");
    if (
      action.type === "REVIEW_APPLICATION" &&
      event.organizationId &&
      member?.role !== "admin"
    )
      return fail("Only organization admins can review applications.");
    if (action.type === "UPDATE_EVENT" && event.organizationId) {
      if (
        member?.role !== "admin" &&
        (event.createdBy !== session.personId ||
          event.status !== "draft" ||
          event.publishedAt ||
          event.publicationStatus === "pending")
      )
        return fail("Members can edit only their own unpublished drafts.");
      if (
        member?.role !== "admin" &&
        action.changes.status &&
        action.changes.status !== "draft"
      )
        return fail("An organization admin must approve publication.");
      action.changes.organizer =
        session.organizations?.find((o) => o.id === event.organizationId)
          ?.name ?? event.organizer;
    }
    if (action.type === "SUBMIT_EVENT_FOR_APPROVAL") {
      if (
        !event.organizationId ||
        event.createdBy !== session.personId ||
        event.status !== "draft" ||
        event.publishedAt ||
        event.publicationStatus === "pending"
      )
        return fail("Submit your own unpublished draft for approval.");
      const next = structuredClone(state);
      next.events.find((e) => e.id === event.id)!.publicationStatus = "pending";
      return { state: next, message: "Event submitted for admin approval." };
    }
    if (action.type === "REVIEW_EVENT_PUBLICATION") {
      if (
        !event.organizationId ||
        member?.role !== "admin" ||
        event.status !== "draft" ||
        event.publishedAt
      )
        return fail(
          "Only an organization admin can approve an unpublished event.",
        );
      action = {
        type: "UPDATE_EVENT",
        eventId: event.id,
        changes: {
          status: action.decision === "approve" ? "open" : "draft",
          publicationStatus:
            action.decision === "approve" ? "approved" : "draft",
        },
      };
    }
  }
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
  const nextRevision = (previous: unknown): string => {
    const prior = typeof previous === "string" ? Date.parse(previous) : NaN;
    const current = Date.parse(now);
    return new Date(
      Number.isFinite(prior) && prior >= current ? prior + 1 : current,
    ).toISOString();
  };
  if (action.type === "UPDATE_PROFILE")
    result.state.people.find((p) => p.id === session.personId)!.updated_at =
      nextRevision(
        state.people.find((p) => p.id === session.personId)?.updated_at,
      );
  if (action.type === "CREATE_EVENT" || action.type === "UPDATE_EVENT") {
    const eventId =
      action.type === "CREATE_EVENT" ? result.createdId : action.eventId;
    const event = result.state.events.find((e) => e.id === eventId);
    const previous = state.events.find((e) => e.id === eventId);
    if (event) {
      if (event.organizationId && event.status === "open")
        event.publicationStatus = "approved";
      Object.assign(event, {
        updated_at: nextRevision(Reflect.get(previous ?? {}, "updated_at")),
      });
    }
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
  result.recommendations =
    current && !requiresOnboarding(current)
      ? recommendationsFor(state, current)
      : [];
  result.people = result.people
    .filter((p) => p.id === session.personId || !requiresOnboarding(p))
    .map((p) => {
      if (p.id === session.personId) return p;
      return publicPerson(p);
    });
  result.currentPersonId = session.personId;
  result.mode =
    session.organizer && session.mode === "organizer"
      ? "organizer"
      : "attendee";
  if (result.mode === "organizer") {
    const legacy =
      session.legacyOrganizer ??
      (session.organizer && !session.memberships?.length);
    const organizationIds = new Set(
      session.memberships?.map((m) => m.organizationId),
    );
    result.events = result.events.filter((e) =>
      e.organizationId ? organizationIds.has(e.organizationId) : legacy,
    );
    const eventIds = new Set(result.events.map((e) => e.id));
    const adminIds = new Set(
      session.memberships
        ?.filter((m) => m.role === "admin")
        .map((m) => m.organizationId),
    );
    const reviewedIds = new Set(
      result.events
        .filter((e) =>
          e.organizationId ? adminIds.has(e.organizationId) : legacy,
        )
        .map((e) => e.id),
    );
    result.teams = result.teams.filter((t) => eventIds.has(t.eventId));
    result.applications = result.applications.filter(
      (a) =>
        reviewedIds.has(a.eventId) ||
        (a.personId === session.personId && eventIds.has(a.eventId)),
    );
    result.invitations = result.invitations.filter((i) =>
      result.teams.some((t) => t.id === i.teamId),
    );
  }
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
