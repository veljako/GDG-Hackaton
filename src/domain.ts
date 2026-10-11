import type {
  Action,
  Application,
  DemoState,
  Hackathon,
  Role,
  Team,
  Transition,
} from "./types";
import { createSeedState } from "./seed";
import { hasTeams, registrationOpen } from './discovery';
import { eventEligibility, matchingEventError, matchingProfileError, normalizeEvent } from "./matching-data";

export function admissionFor(
  state: DemoState,
  eventId: string,
  personId: string,
): Application | undefined {
  return state.applications.find(
    (a) => a.eventId === eventId && a.personId === personId,
  );
}
export function isPastTeam(state: DemoState, team: Team): boolean {
  return (
    team.archived ||
    state.events.find((e) => e.id === team.eventId)?.status === "past"
  );
}
export function memberState(
  state: DemoState,
  team: Team,
  personId: string,
): "accepted" | "pending" | "rejected" | "not-applied" {
  return admissionFor(state, team.eventId, personId)?.status ?? "not-applied";
}
export function teamStatus(
  state: DemoState,
  team: Team,
): "confirmed" | "forming" | "pending" | "archived" {
  const event = state.events.find((e) => e.id === team.eventId);
  if (team.archived || event?.status === "past") return "archived";
  const accepted = team.memberIds.filter(
    (id) => memberState(state, team, id) === "accepted",
  ).length;
  if (event && accepted >= event.minTeamSize) return "confirmed";
  return accepted > 0 ? "forming" : "pending";
}
const connectionKey = (a: string, b: string) => [a, b].sort().join(":");
export function isConnected(state: DemoState, a: string, b: string): boolean {
  return a !== b && state.connections.includes(connectionKey(a, b));
}
const roles: Role[] = ["Participant", "Mentor", "Speaker", "Judge"];
const demoTime = "2026-10-10T09:00:00.000Z";
function nextId(state: DemoState, prefix: string): string {
  const ids = new Set(
    [
      ...state.people,
      ...state.events,
      ...state.teams,
      ...state.applications,
      ...state.invitations,
      ...(state.eventInvitations ?? []),
      ...state.notifications,
    ].map((x) => x.id),
  );
  let suffix = ids.size + 1;
  while (ids.has(`${prefix}-${suffix}`)) suffix++;
  return `${prefix}-${suffix}`;
}
function notify(
  state: DemoState,
  personId: string,
  title: string,
  body: string,
  href: string,
) {
  state.notifications.unshift({
    id: nextId(state, "notice"),
    personId,
    title,
    body,
    read: false,
    href,
  });
}
const eventPlaces = (state: DemoState, eventId: string) =>
  state.applications.filter(
    (a) => a.eventId === eventId && a.status !== "rejected",
  ).length;
function reservedPlaces(state: DemoState, team: Team): number {
  return new Set([
    ...team.memberIds,
    ...state.invitations
      .filter((i) => i.teamId === team.id && i.status === "pending")
      .map((i) => i.personId),
  ]).size;
}
const otherTeam = (
  state: DemoState,
  eventId: string,
  personId: string,
  exceptId?: string,
) =>
  state.teams.find(
    (t) =>
      t.eventId === eventId &&
      t.id !== exceptId &&
      t.memberIds.includes(personId),
  );
function validateEvent(event: Omit<Hackathon, "id">): string | undefined {
  if (
    event.autoInviteCount !== undefined &&
    (!Number.isInteger(event.autoInviteCount) ||
      event.autoInviteCount < 0 ||
      event.autoInviteCount > 5000 ||
      (!event.publishedAt && event.autoInviteCount > event.capacity))
  )
    return "Auto-invite count must be a whole number from zero through event capacity (maximum 5000).";
  if (
    [event.title, event.organizer, event.location].some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  )
    return "Add an event title, organizer and location.";
  if (
    ![event.capacity, event.minTeamSize, event.maxTeamSize].every(
      (n) => Number.isInteger(n) && n > 0,
    )
  )
    return "Capacity and team sizes must be positive whole numbers.";
  if (
    event.minTeamSize > event.maxTeamSize ||
    event.minTeamSize > event.capacity
  )
    return "Minimum team size cannot exceed maximum size or event capacity.";
  const dates = [event.date, event.endDate, event.deadline].map((d) =>
    Date.parse(d),
  );
  if (
    dates.some((d) => !Number.isFinite(d)) ||
    dates[1] < dates[0] ||
    dates[2] > dates[0]
  )
    return "Use valid dates: deadline before the start, and end on or after the start.";
  if (
    [event.date, event.endDate, event.deadline].some(
      (d) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        new Date(d).toISOString().slice(0, 10) !== d,
    )
  )
    return "Use valid calendar dates in YYYY-MM-DD format.";
  if (!["open", "past", "draft"].includes(event.status))
    return "Choose a valid event status.";
  if (event.status !== "draft" && !["In person", "Hybrid", "Online"].includes(event.format ?? ""))
    return "Choose an attendance format before publishing this event.";
  return matchingEventError(event);
}
function ensureAdmission(
  state: DemoState,
  event: Hackathon,
  personId: string,
  teamId: string,
): Application {
  const existing = admissionFor(state, event.id, personId);
  if (existing) {
    existing.teamId = teamId;
    return existing;
  }
  const person = state.people.find((p) => p.id === personId)!;
  const app: Application = {
    id: nextId(state, "application"),
    eventId: event.id,
    personId,
    teamId,
    status: "pending",
    role: person.roles[0] ?? "Participant",
    motivation: "I would like to join this team and build together.",
    submittedAt: demoTime,
  };
  state.applications.push(app);
  notify(
    state,
    personId,
    "Application received",
    `${event.title}: attendance is waiting for organizer review.`,
    `/hackathons/${event.id}`,
  );
  return app;
}
function detachMember(state: DemoState, team: Team, personId: string) {
  team.memberIds = team.memberIds.filter((id) => id !== personId);
  const app = admissionFor(state, team.eventId, personId);
  if (app?.teamId === team.id) delete app.teamId;
  if (team.captainId === personId) team.captainId = team.memberIds[0] ?? "";
  if (!team.memberIds.length) {
    team.archived = true;
    state.invitations
      .filter((i) => i.teamId === team.id && i.status === "pending")
      .forEach((i) => {
        i.status = "declined";
      });
  }
}

/** Invalid actions preserve the original state. IDs and timestamps are deterministic for this local demo. */
export function transition(state: DemoState, action: Action): Transition {
  if (action.type === "RESET")
    return {
      state: createSeedState(),
      message: "Demo reset. Welcome back, Luka.",
    };
  const next = structuredClone(state);
  const fail = (error: string): Transition => ({ state, error });
  const success = (message: string, createdId?: string): Transition => ({
    state: next,
    message,
    ...(createdId ? { createdId } : {}),
  });
  const person = (id: string) => next.people.find((p) => p.id === id);
  const own = (id: string) => id === state.currentPersonId && !!person(id);
  const organizer = () => state.mode === "organizer";
  const eventById = (id: string) => next.events.find((e) => e.id === id);
  const teamById = (id: string) => next.teams.find((t) => t.id === id);
  const closed = (team: Team, event: Hackathon) =>
    team.archived || event.status !== "open";

  switch (action.type) {
    case "SET_PERSON":
      if (!person(action.personId))
        return fail("Profile not found. Choose a demo person.");
      next.currentPersonId = action.personId;
      return success(`Now viewing as ${person(action.personId)!.name}.`);
    case "SET_MODE":
      if (!["attendee", "organizer"].includes(action.mode))
        return fail("Choose attendee or organizer mode.");
      next.mode = action.mode;
      return success(
        action.mode === "organizer"
          ? "Organizer workspace enabled."
          : "Attendee workspace enabled.",
      );
    case "CREATE_EVENT": {
      if (!organizer())
        return fail("Switch to organizer mode to create an event.");
      const error = validateEvent(action.event);
      if (error) return fail(error);
      const event: Hackathon = {
        ...structuredClone(action.event),
        id: nextId(next, "event"),
      };
      next.events.push(normalizeEvent(event));
      return success("Event created.", event.id);
    }
    case "UPDATE_EVENT": {
      if (!organizer())
        return fail("Switch to organizer mode to edit an event.");
      const event = eventById(action.eventId);
      if (!event) return fail("Event not found.");
      if (
        (event.publishedAt || event.status !== "draft") &&
        action.changes.autoInviteCount !== undefined &&
        action.changes.autoInviteCount !== (event.autoInviteCount ?? 0)
      )
        return fail("Auto-invite settings cannot change after publication.");
      if (action.changes.id && action.changes.id !== event.id)
        return fail("Event identity cannot be changed.");
      const edited = {
        ...event,
        ...structuredClone(action.changes),
        id: event.id,
      };
      const error = validateEvent(edited);
      if (error) return fail(error);
      if (!hasTeams(edited) && next.teams.some(t => t.eventId === event.id))
        return fail('Events with existing teams must remain hackathons. Create a separate event instead.');
      if (edited.capacity < eventPlaces(next, event.id))
        return fail(
          "Capacity cannot be lower than occupied and pending event places.",
        );
      if (
        next.teams.some(
          (t) =>
            t.eventId === event.id &&
            !t.archived &&
            reservedPlaces(next, t) > edited.maxTeamSize,
        )
      )
        return fail(
          "Team size cannot be lower than existing members and reserved places.",
        );
      Object.assign(event, normalizeEvent(edited));
      return success("Event details updated.");
    }
    case "RESPOND_EVENT_INVITATION": {
      const invitation = next.eventInvitations?.find(
        (i) => i.id === action.invitationId,
      );
      if (!invitation) return fail("Event invitation not found.");
      if (!own(invitation.personId))
        return fail(
          "Only the recipient can respond to their own event invitation.",
        );
      if (invitation.status !== "pending")
        return fail("This invitation has already been answered.");
      if (action.response === "declined") {
        invitation.status = "declined";
        return success("Event invitation declined.");
      }
      const event = eventById(invitation.eventId);
      if (!event || !registrationOpen(event))
        return fail("Registration is closed for this event.");
      const eligibility = eventEligibility(event, person(invitation.personId)!);
      if (!eligibility.eligible) return fail(eligibility.reasons.join(" "));
      if (admissionFor(next, event.id, invitation.personId)) {
        invitation.status = "accepted";
        return success(
          "Invitation accepted. Your existing application status is unchanged.",
        );
      }
      const applied = transition(next, {
        type: "SUBMIT_APPLICATION",
        eventId: event.id,
        personId: invitation.personId,
        role: "Participant",
        motivation: "Accepted the organizer’s event invitation.",
      });
      if (applied.error) return fail(applied.error);
      applied.state.eventInvitations!.find(
        (i) => i.id === invitation.id,
      )!.status = "accepted";
      return { ...applied, message: `Invitation accepted. ${applied.message}` };
    }
    case "SUBMIT_APPLICATION": {
      const event = eventById(action.eventId);
      if (!event || !person(action.personId))
        return fail("Event or profile not found.");
      if (!own(action.personId))
        return fail("Apply as your current demo profile.");
      if (event.status !== "open")
        return fail(
          "This event is closed for applications. Choose an open event.",
        );
      if (!roles.includes(action.role))
        return fail("Choose a participant, mentor, speaker or judge role.");
      if (admissionFor(next, event.id, action.personId))
        return fail(
          "You already have an application for this event. Check its status.",
        );
      const eligibility = eventEligibility(event, person(action.personId)!, action.role);
      if (!eligibility.eligible) return fail(eligibility.reasons.join(" "));
      if (eventPlaces(next, event.id) >= event.capacity)
        return fail(
          "This event is full, including pending applications. Try another event.",
        );
      const membership = otherTeam(next, event.id, action.personId);
      if (!hasTeams(event) && (action.teamId || membership))
        return fail('This event uses individual registration.');
      const chosen = action.teamId ? teamById(action.teamId) : membership;
      if (
        action.teamId &&
        (!chosen ||
          chosen.eventId !== event.id ||
          !chosen.memberIds.includes(action.personId) ||
          chosen.archived)
      )
        return fail("Join this event team before applying with it.");
      const app: Application = {
        id: nextId(next, "application"),
        eventId: event.id,
        personId: action.personId,
        ...(chosen ? { teamId: chosen.id } : {}),
        status: !hasTeams(event) && event.registration === 'automatic' ? 'accepted' : 'pending',
        role: action.role,
        motivation: action.motivation.trim(),
        submittedAt: demoTime,
      };
      next.applications.push(app);
      notify(
        next,
        action.personId,
        app.status === 'accepted' ? 'Registration confirmed' : 'Application received',
        `${event.title}: ${app.status === 'accepted' ? 'your place is confirmed.' : 'waiting for organizer review.'}`,
        `/hackathons/${event.id}`,
      );
      return success(app.status === 'accepted' ? 'Registration confirmed.' : 'Application submitted. Await organizer review.', app.id);
    }
    case "WITHDRAW_APPLICATION": {
      const app = next.applications.find((a) => a.id === action.applicationId);
      if (!app) return fail("Application not found.");
      if (!own(app.personId))
        return fail("You can only withdraw your own application.");
      if (app.status !== "pending")
        return fail("Only pending applications can be withdrawn.");
      const t = app.teamId ? teamById(app.teamId) : undefined;
      if (t?.memberIds.includes(app.personId))
        detachMember(next, t, app.personId);
      next.applications = next.applications.filter((a) => a.id !== app.id);
      notify(
        next,
        app.personId,
        "Application withdrawn",
        "Your place is released. You can apply again while the event is open.",
        `/hackathons/${app.eventId}`,
      );
      return success("Application withdrawn and your place released.");
    }
    case "REVIEW_APPLICATION": {
      if (!organizer())
        return fail("Switch to organizer mode to review applications.");
      const app = next.applications.find((a) => a.id === action.applicationId);
      if (!app) return fail("Application not found.");
      const event = eventById(app.eventId);
      if (!event) return fail("Application event not found.");
      if (!["accepted", "rejected"].includes(action.status))
        return fail("Choose accept or reject.");
      if (action.status === "accepted" && app.status !== "accepted") {
        const eligibility = eventEligibility(event, person(app.personId)!, app.role);
        if (!eligibility.eligible) return fail(eligibility.reasons.join(" "));
      }
      if (
        app.status === "rejected" &&
        action.status === "accepted" &&
        eventPlaces(next, event.id) >= event.capacity
      )
        return fail(
          "The event is full. Increase capacity or release a place first.",
        );
      app.status = action.status;
      notify(
        next,
        app.personId,
        action.status === "accepted" ? "You’re in!" : "Application decision",
        `${event.title}: your application is ${action.status}.`,
        app.teamId ? `/teams/${app.teamId}` : `/hackathons/${event.id}`,
      );
      return success(
        action.status === "accepted"
          ? "Applicant accepted. Team status updates automatically."
          : "Application rejected. The event place is released.",
      );
    }
    case "CREATE_TEAM":
    case "REUSE_TEAM": {
      const event = eventById(action.eventId);
      if (!event || !person(action.personId))
        return fail("Event or profile not found.");
      if (!hasTeams(event)) return fail('This event uses individual registration, without teams.');
      if (!own(action.personId))
        return fail("Create a team as your current demo profile.");
      if (action.role && !roles.includes(action.role))
        return fail("Choose a valid application role.");
      if (event.status !== "open")
        return fail("Choose an open event for your new team.");
      const eligibility = eventEligibility(event, person(action.personId)!, action.role);
      if (!eligibility.eligible) return fail(eligibility.reasons.join(" "));
      if (otherTeam(next, event.id, action.personId))
        return fail(
          "You already belong to a team for this event. Leave it before creating another.",
        );
      const previous =
        action.type === "REUSE_TEAM" ? teamById(action.teamId) : undefined;
      if (action.type === "REUSE_TEAM") {
        if (!previous) return fail("Previous team not found.");
        if (!previous.memberIds.includes(action.personId))
          return fail("You can only reuse a team you belonged to.");
        if (previous.eventId === event.id)
          return fail("Choose a different event to reuse a previous team.");
        if (previous.memberIds.length > event.maxTeamSize)
          return fail(
            "Your previous team exceeds this event’s maximum team size. Create a smaller team instead.",
          );
        if (previous.memberIds.some((id) => otherTeam(next, event.id, id)))
          return fail(
            "A previous member already belongs to another team for this event. Create a new team and invite available people.",
          );
      }
      const name =
        action.type === "CREATE_TEAM" ? action.name.trim() : previous!.name;
      if (!name) return fail("Give your team a name.");
      if (
        !admissionFor(next, event.id, action.personId) &&
        eventPlaces(next, event.id) >= event.capacity
      )
        return fail(
          "The event is full. Your team application needs an available place.",
        );
      const t: Team = {
        id: nextId(next, "team"),
        eventId: event.id,
        name,
        description:
          action.type === "CREATE_TEAM"
            ? action.description.trim()
            : previous!.description,
        skills:
          action.type === "CREATE_TEAM"
            ? [...action.skills]
            : [...previous!.skills],
        memberIds: [action.personId],
        captainId: action.personId,
        archived: false,
      };
      next.teams.push(t);
      const admission = ensureAdmission(next, event, action.personId, t.id);
      if (action.role) admission.role = action.role;
      if (action.motivation !== undefined)
        admission.motivation = action.motivation.trim();
      if (previous)
        for (const id of previous.memberIds.filter(
          (id) => id !== action.personId,
        )) {
          next.invitations.push({
            id: nextId(next, "invitation"),
            teamId: t.id,
            personId: id,
            fromId: action.personId,
            status: "pending",
            createdAt: demoTime,
          });
          notify(
            next,
            id,
            "Build together again?",
            `${person(action.personId)!.name} invited you to ${t.name} at ${event.title}.`,
            `/teams/${t.id}`,
          );
        }
      return success(
        previous
          ? "Fresh team created. Former members have invitations to accept."
          : "Team created. Invite people to build with you.",
        t.id,
      );
    }
    case "INVITE_PERSON": {
      const t = teamById(action.teamId);
      const recipient = person(action.personId);
      const actor = person(action.fromId);
      if (!t || !recipient || !actor) return fail("Team or profile not found.");
      const event = eventById(t.eventId);
      if (!event) return fail("Team event not found.");
      if (!own(action.fromId) || !t.memberIds.includes(action.fromId))
        return fail(
          "Invite from a team you belong to as your current profile.",
        );
      if (closed(t, event))
        return fail(
          "This team is archived or its event is closed. Reuse it for an open event.",
        );
      if (t.memberIds.includes(action.personId))
        return fail("This person is already a team member.");
      if (otherTeam(next, event.id, action.personId, t.id))
        return fail(
          "This person already belongs to another team for this event.",
        );
      if (
        next.invitations.some(
          (i) =>
            i.teamId === t.id &&
            i.personId === action.personId &&
            i.status === "pending",
        )
      )
        return fail("An invitation is already pending for this person.");
      if (reservedPlaces(next, t) >= event.maxTeamSize)
        return fail(
          "Your team is full, including reserved invitation seats. Wait for a reply or free a place.",
        );
      const i = {
        id: nextId(next, "invitation"),
        teamId: t.id,
        personId: action.personId,
        fromId: action.fromId,
        status: "pending" as const,
        createdAt: demoTime,
      };
      next.invitations.push(i);
      notify(
        next,
        action.personId,
        "A team invitation",
        `${actor.name} invited you to ${t.name}. Your place is reserved until you respond.`,
        `/teams/${t.id}`,
      );
      return success(
        `Invitation sent locally to ${recipient.name}. A team place is reserved.`,
        i.id,
      );
    }
    case "RESPOND_INVITATION": {
      const i = next.invitations.find((i) => i.id === action.invitationId);
      if (!i) return fail("Invitation not found.");
      if (!own(i.personId))
        return fail("Switch to the invited person to respond.");
      if (i.status !== "pending")
        return fail("This invitation has already been answered.");
      if (!["accepted", "declined"].includes(action.response))
        return fail("Choose accept or decline.");
      const t = teamById(i.teamId);
      const event = t ? eventById(t.eventId) : undefined;
      if (!t || !event) return fail("Invitation team or event not found.");
      if (action.response === "declined") {
        i.status = "declined";
        notify(
          next,
          i.fromId,
          "Invitation declined",
          `${person(i.personId)!.name} declined the invitation to ${t.name}. The place is free.`,
          `/teams/${t.id}`,
        );
        return success("Invitation declined. The reserved place is released.");
      }
      if (closed(t, event))
        return fail(
          "This team’s event is closed. Ask for an invitation to an open event.",
        );
      if (admissionFor(next, event.id, i.personId)?.status !== "accepted") {
        const eligibility = eventEligibility(event, person(i.personId)!);
        if (!eligibility.eligible) return fail(eligibility.reasons.join(" "));
      }
      if (otherTeam(next, event.id, i.personId, t.id))
        return fail(
          "You already belong to another team for this event. Leave it before accepting.",
        );
      if (t.memberIds.includes(i.personId))
        return fail("You already belong to this team.");
      if (
        reservedPlaces(next, t) > event.maxTeamSize ||
        t.memberIds.length >= event.maxTeamSize
      )
        return fail("The team is full. Ask a member to free a place.");
      if (
        !admissionFor(next, event.id, i.personId) &&
        eventPlaces(next, event.id) >= event.capacity
      )
        return fail(
          "The event is full. Ask the organizer to free a place before accepting.",
        );
      i.status = "accepted";
      t.memberIds.push(i.personId);
      const app = ensureAdmission(next, event, i.personId, t.id);
      next.invitations
        .filter(
          (other) =>
            other.personId === i.personId &&
            other.status === "pending" &&
            teamById(other.teamId)?.eventId === event.id,
        )
        .forEach((other) => {
          other.status = "declined";
        });
      notify(
        next,
        i.fromId,
        "A new teammate",
        `${person(i.personId)!.name} accepted your invitation. Attendance: ${app.status}.`,
        `/teams/${t.id}`,
      );
      return success(
        app.status === "accepted"
          ? "You joined the team. You’re accepted for the event."
          : app.status === "pending"
            ? "Team invitation accepted. Your event application awaits organizer approval."
            : "Team invitation accepted. Your event application is rejected; ask the organizer to review it.",
      );
    }
    case "CANCEL_INVITATION": {
      const invitation = next.invitations.find(
        (i) => i.id === action.invitationId,
      );
      if (!invitation) return fail("Invitation not found.");
      const t = teamById(invitation.teamId);
      if (!t || !own(action.actorId) || !t.memberIds.includes(action.actorId))
        return fail("Only a current team member can cancel its invitation.");
      if (invitation.status !== "pending")
        return fail("Only pending invitations can be cancelled.");
      invitation.status = "declined";
      notify(
        next,
        invitation.personId,
        "Invitation cancelled",
        `${t.name} released your reserved place. Your event application is unchanged.`,
        `/teams/${t.id}`,
      );
      return success(
        "Invitation cancelled. The reserved team place is released.",
      );
    }
    case "REMOVE_MEMBER": {
      const t = teamById(action.teamId);
      const event = t ? eventById(t.eventId) : undefined;
      if (!t || !event || !person(action.personId))
        return fail("Team or profile not found.");
      if (!own(action.actorId))
        return fail("Use your current demo profile for this action.");
      if (!t.memberIds.includes(action.personId))
        return fail("This person is not a team member.");
      if (closed(t, event))
        return fail("Archived or closed teams cannot be changed.");
      if (
        action.actorId !== action.personId &&
        action.actorId !== t.captainId &&
        !organizer()
      )
        return fail(
          "Only the captain or organizer can remove another member. You can leave yourself.",
        );
      detachMember(next, t, action.personId);
      notify(
        next,
        action.personId,
        "Team membership updated",
        `You left ${t.name}. Your event admission is unchanged.`,
        `/hackathons/${event.id}`,
      );
      return success("Member removed. Their event admission is unchanged.");
    }
    case "UPDATE_PROFILE": {
      const p = person(action.personId);
      if (!p) return fail("Profile not found.");
      if (!own(action.personId))
        return fail("You can only edit your current demo profile.");
      if (action.changes.id && action.changes.id !== p.id)
        return fail("Profile identity cannot be changed.");
      const edited = { ...p, ...structuredClone(action.changes), id: p.id };
      const profileError = matchingProfileError(edited);
      if (profileError) return fail(profileError);
      if (typeof edited.name !== "string" || !edited.name.trim())
        return fail("Add a name to your profile.");
      if (
        !Array.isArray(edited.roles) ||
        !edited.roles.length ||
        edited.roles.some((r) => !roles.includes(r))
      )
        return fail("Choose at least one valid profile role.");
      Object.assign(p, edited);
      return success("Profile saved in this browser.");
    }
    case "TOGGLE_CONNECTION": {
      if (!own(action.personId))
        return fail("Connect as your current demo profile.");
      if (!person(action.otherId)) return fail("Profile not found.");
      if (action.personId === action.otherId)
        return fail("Choose another person to connect with.");
      const key = connectionKey(action.personId, action.otherId);
      const connected = next.connections.includes(key);
      next.connections = connected
        ? next.connections.filter((k) => k !== key)
        : [...next.connections, key];
      if (!connected)
        notify(
          next,
          action.otherId,
          "A new connection",
          `${person(action.personId)!.name} connected with you in this local demo.`,
          "/people",
        );
      return success(
        connected
          ? "Connection removed."
          : "Connected locally. Say hello when you meet at the event.",
      );
    }
    case "MARK_NOTIFICATIONS_READ":
      if (!own(action.personId))
        return fail("You can only mark your own notifications read.");
      next.notifications
        .filter((n) => n.personId === action.personId)
        .forEach((n) => {
          n.read = true;
        });
      return success("Notifications marked as read.");
    default:
      return fail("This action is not supported.");
  }
}
