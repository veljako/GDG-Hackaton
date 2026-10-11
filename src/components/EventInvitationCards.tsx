import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarBlank,
  EnvelopeSimple,
} from "@phosphor-icons/react";
import { useDemo } from "../store";
import { admissionFor } from "../domain";
import { registrationOpen } from "../discovery";
import { Badge, Button, formatDate } from "./ui";
import type { EventInvitation } from "../types";

export function EventInvitationCards({
  invitations,
}: {
  invitations: EventInvitation[];
}) {
  const { state, me, run, busy } = useDemo();
  const navigate = useNavigate();
  return invitations.map((invitation) => {
    const event = state.events.find((e) => e.id === invitation.eventId);
    if (!event) return null;
    const admission = admissionFor(state, event.id, me.id);
    const unavailable = !registrationOpen(event);
    return (
      <article className="panel activity-invite-card" key={invitation.id}>
        <div className="activity-invite-heading">
          <EnvelopeSimple size={32} aria-hidden="true" />
          <div>
            <strong>{event.organizer} invited you</strong>
            <p>An event selected for your interests and skills.</p>
          </div>
          <Badge color="blue">Event invitation</Badge>
        </div>
        <button
          className="activity-event-link"
          onClick={() => navigate(`/events/${event.id}`)}
        >
          <CalendarBlank size={18} />
          <span>
            {event.title} · {formatDate(event.date)}
          </span>
          <ArrowRight size={17} />
        </button>
        <p className="muted">
          Why you were invited: {invitation.reasons.join(" · ")}
        </p>
        <p className="muted">
          {unavailable
            ? "Registration is closed. You can still decline this invitation."
            : admission
              ? "You already applied. Accepting keeps your existing application status."
              : event.registration === "automatic" &&
                  (event.kind ?? "hackathon") !== "hackathon"
                ? "Accept to register if a place is available. Invitations do not reserve places."
                : "Accept to apply. The organizer reviews your application; invitations do not reserve places."}
        </p>
        <div className="activity-card-actions">
          <Button
            disabled={busy || unavailable}
            onClick={() =>
              void run({
                type: "RESPOND_EVENT_INVITATION",
                invitationId: invitation.id,
                response: "accepted",
              })
            }
          >
            {admission ? "Accept invitation" : "Accept and apply"}
          </Button>
          <Button
            variant="text"
            disabled={busy}
            onClick={() =>
              void run({
                type: "RESPOND_EVENT_INVITATION",
                invitationId: invitation.id,
                response: "declined",
              })
            }
          >
            Decline
          </Button>
        </div>
      </article>
    );
  });
}
