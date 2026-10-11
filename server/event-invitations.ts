import { createHash } from "node:crypto";
import { recommendationsFor, registrationOpen } from "../src/discovery";
import { requiresOnboarding } from "../src/onboarding";
import type { DemoState, Hackathon } from "../src/types";

/** Called inside the publication transaction, never from client-controlled recipients. */
export function autoInviteForEvent(
  state: DemoState,
  event: Hackathon,
  fromId: string,
  now: string,
): number {
  if (!event.autoInviteCount || !registrationOpen(event)) return 0;
  const invitations = (state.eventInvitations ??= []);
  const occupied = state.applications.filter(
    (a) => a.eventId === event.id && a.status !== "rejected",
  ).length;
  const candidates = state.people
    .flatMap((person) => {
      if (
        person.id === fromId ||
        person.id === event.createdBy ||
        requiresOnboarding(person) ||
        !person.preferences?.notify ||
        invitations.some(
          (i) => i.eventId === event.id && i.personId === person.id,
        )
      )
        return [];
      const match = recommendationsFor(
        { ...state, events: [event] },
        person,
      )[0];
      return match ? [{ personId: person.id, ...match }] : [];
    })
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) || a.personId.localeCompare(b.personId),
    )
    .slice(
      0,
      Math.max(0, Math.min(event.autoInviteCount, event.capacity - occupied)),
    );
  for (const candidate of candidates) {
    const id =
      "event-invite-" +
      createHash("sha256")
        .update(`${event.id}:${candidate.personId}`)
        .digest("hex")
        .slice(0, 32);
    invitations.push({
      id,
      eventId: event.id,
      personId: candidate.personId,
      fromId,
      status: "pending",
      createdAt: now,
      reasons: candidate.reasons,
    });
    state.notifications.unshift({
      id: `${id}-notice`,
      eventId: event.id,
      personId: candidate.personId,
      title: "An event invitation",
      body: `${event.organizer} invited you to ${event.title}. ${candidate.reasons.join(" · ")}`,
      read: false,
      href: "/activity",
    });
  }
  return candidates.length;
}
