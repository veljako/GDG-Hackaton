import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarBlank,
  CheckCircle,
  Clock,
  EnvelopeSimple,
  MapPin,
  UsersThree,
} from "@phosphor-icons/react";
import { useDemo } from "../store";
import { admissionFor } from "../domain";
import {
  Avatar,
  Badge,
  Button,
  Chips,
  Empty,
  Modal,
  PageTitle,
  SectionTitle,
  formatDate,
} from "../components/ui";
import type { Admission } from "../types";
import { EventInvitationCards } from "../components/EventInvitationCards";

const admissionLabels: Record<Admission, string> = {
  accepted: "Accepted",
  pending: "Awaiting review",
  rejected: "Not accepted",
};

export function Activity() {
  const { me } = useDemo();
  return <ActivityContent key={me.id} />;
}

function ActivityContent() {
  const { state, me, run } = useDemo();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("Everything");
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  const applications = state.applications.filter((a) => a.personId === me.id);
  const invitations = state.invitations.filter(
    (i) => i.personId === me.id && i.status === "pending",
  );
  const eventInvitations = (state.eventInvitations ?? []).filter(
    (i) => i.personId === me.id && i.status === "pending",
  );
  const withdrawing = applications.find((a) => a.id === withdrawId);
  const withdrawalEvent = state.events.find(
    (e) => e.id === withdrawing?.eventId,
  );
  const upcoming = applications.filter(
    (a) =>
      a.status === "accepted" &&
      state.events.find((e) => e.id === a.eventId)?.status === "open",
  ).length;

  return (
    <>
      <PageTitle
        title="Your activity."
        description="Applications and invitations, in one place."
        action={
          <Button
            variant="tonal"
            icon={<ArrowRight size={18} />}
            onClick={() => navigate("/hackathons")}
          >
            Explore events
          </Button>
        }
      />
      <div className="activity-summary" data-tour="activity">
        <div className="activity-summary-item">
          <span className="color-green">
            <CheckCircle size={23} />
          </span>
          <strong>{upcoming}</strong>
          <span>Upcoming accepted events</span>
        </div>
        <div className="activity-summary-item">
          <span className="color-yellow">
            <Clock size={23} />
          </span>
          <strong>
            {applications.filter((a) => a.status === "pending").length}
          </strong>
          <span>Applications in review</span>
        </div>
        <div className="activity-summary-item">
          <span className="color-blue">
            <EnvelopeSimple size={23} />
          </span>
          <strong>{invitations.length + eventInvitations.length}</strong>
          <span>Invitations</span>
        </div>
      </div>
      <div className="filter-toolbar">
        <Chips
          values={["Everything", "Applications", "Invitations"]}
          active={filter}
          onChange={setFilter}
        />
      </div>

      <div className="activity-board">
        {filter !== "Applications" && (
          <section className="activity-section">
            <SectionTitle title="Invitations" />
            {invitations.length || eventInvitations.length ? (
              <div className="activity-invitations">
                <EventInvitationCards invitations={eventInvitations} />
                {invitations.map((invitation) => {
                  const team = state.teams.find(
                    (t) => t.id === invitation.teamId,
                  );
                  const event = state.events.find(
                    (e) => e.id === team?.eventId,
                  );
                  const sender = state.people.find(
                    (p) => p.id === invitation.fromId,
                  );
                  if (!team || !event || !sender) return null;
                  const admission = admissionFor(state, event.id, me.id);
                  const unavailable = team.archived || event.status !== "open";
                  return (
                    <article
                      className="panel activity-invite-card"
                      key={invitation.id}
                    >
                      <div className="activity-invite-heading">
                        <Avatar person={sender} size={48} />
                        <div>
                          <strong>{sender.name} invited you</strong>
                          <p>
                            Build together with{" "}
                            <button
                              className="text-link"
                              onClick={() => navigate(`/teams/${team.id}`)}
                            >
                              {team.name}
                            </button>
                          </p>
                        </div>
                        <Badge color="blue">Place reserved</Badge>
                      </div>
                      <button
                        className="activity-event-link"
                        onClick={() => navigate(`/hackathons/${event.id}`)}
                      >
                        <CalendarBlank size={18} />
                        <span>
                          {event.title} · {formatDate(event.date)}
                        </span>
                        <ArrowRight size={17} />
                      </button>
                      <p className="muted">
                        {unavailable
                          ? "This event is closed. You can release the invitation by declining."
                          : admission?.status === "accepted"
                            ? "You’re accepted for this event. Accepting joins the team immediately."
                            : admission?.status === "pending"
                              ? "Your event application is already in review. Accepting adds you as a pending team member."
                              : admission?.status === "rejected"
                                ? "Your application was not accepted. You can join the team, but the organizer must revise your admission before your place is confirmed."
                                : "Accepting sends an event application and adds you as a pending member. The organizer confirms attendance."}
                      </p>
                      <div className="activity-card-actions">
                        <Button
                          disabled={unavailable}
                          icon={<UsersThree size={18} />}
                          onClick={() =>
                            run({
                              type: "RESPOND_INVITATION",
                              invitationId: invitation.id,
                              response: "accepted",
                            })
                          }
                        >
                          {admission ? "Accept invitation" : "Accept and apply"}
                        </Button>
                        <Button
                          variant="text"
                          onClick={() =>
                            run({
                              type: "RESPOND_INVITATION",
                              invitationId: invitation.id,
                              response: "declined",
                            })
                          }
                        >
                          Decline
                        </Button>
                        <Button
                          variant="text"
                          onClick={() => navigate(`/teams/${team.id}`)}
                        >
                          Meet the team
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="No invitations waiting"
                description="Meet people in the community, or create a team and start the conversation."
                action={
                  <Button variant="text" onClick={() => navigate("/people")}>
                    Meet the community
                  </Button>
                }
              />
            )}
          </section>
        )}

        {filter !== "Invitations" && (
          <section className="activity-section">
            <SectionTitle title="Your applications" />
            {applications.length ? (
              <div className="activity-applications">
                {[...applications]
                  .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
                  .map((application) => {
                    const event = state.events.find(
                      (e) => e.id === application.eventId,
                    );
                    const team = state.teams.find(
                      (t) => t.id === application.teamId,
                    );
                    if (!event) return null;
                    return (
                      <article
                        className="panel application-card"
                        key={application.id}
                      >
                        <div className="application-card-heading">
                          <span
                            className={`application-event-icon color-${event.color}`}
                          >
                            <CalendarBlank size={25} />
                          </span>
                          <div>
                            <button
                              className="application-title"
                              onClick={() =>
                                navigate(`/hackathons/${event.id}`)
                              }
                            >
                              <h3>{event.title}</h3>
                              <ArrowRight size={18} />
                            </button>
                            <p>
                              {application.role} ·{" "}
                              {event.status === "past"
                                ? "Past event"
                                : `${formatDate(event.date)} · ${event.format}`}
                            </p>
                          </div>
                          <Badge
                            color={
                              application.status === "accepted"
                                ? "green"
                                : application.status === "rejected"
                                  ? "red"
                                  : "yellow"
                            }
                            dot
                          >
                            {admissionLabels[application.status]}
                          </Badge>
                        </div>
                        <details className="application-more">
                          <summary>Application details</summary>
                          <div className="application-details">
                            <span>
                              <MapPin size={16} />
                              {event.location}
                            </span>
                            <span>
                              <UsersThree size={16} />
                              {team ? (
                                <button
                                  className="text-link"
                                  onClick={() => navigate(`/teams/${team.id}`)}
                                >
                                  {team.name}
                                </button>
                              ) : (
                                "Solo application"
                              )}
                            </span>
                          </div>
                          {application.motivation && (
                            <div className="application-motivation">
                              <p>{application.motivation}</p>
                            </div>
                          )}
                          <div className="application-state-note">
                            {application.status === "pending"
                              ? "The organizer is reviewing your application. Only accepted attendees count toward a confirmed team."
                              : application.status === "accepted"
                                ? event.status === "past"
                                  ? "A completed chapter. Your team history is saved for another event."
                                  : "Your attendance is confirmed. You can still find or invite teammates."
                                : "Your attendance is not confirmed. Explore another event, or wait for the organizer to revise the decision."}
                          </div>
                        </details>
                        <div className="activity-card-actions">
                          {team ? (
                            <Button
                              variant="tonal"
                              onClick={() => navigate(`/teams/${team.id}`)}
                            >
                              View team
                            </Button>
                          ) : application.status === "accepted" &&
                            event.status === "open" ? (
                            <Button
                              variant="tonal"
                              onClick={() => navigate("/teams")}
                            >
                              Find your team
                            </Button>
                          ) : (
                            <Button
                              variant="text"
                              onClick={() =>
                                navigate(`/hackathons/${event.id}`)
                              }
                            >
                              View hackathon
                            </Button>
                          )}
                          {application.status === "pending" && (
                            <Button
                              variant="text"
                              onClick={() => setWithdrawId(application.id)}
                            >
                              Withdraw application
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
              </div>
            ) : (
              <Empty
                title="Your first chapter is waiting"
                description="Find a hackathon that interests you and apply as a participant, mentor, speaker, or judge."
                action={
                  <Button
                    variant="tonal"
                    onClick={() => navigate("/hackathons")}
                  >
                    Explore hackathons
                  </Button>
                }
              />
            )}
          </section>
        )}
      </div>
      {withdrawing && (
        <Modal
          title="Withdraw this application?"
          description={
            withdrawing.teamId
              ? "Your event place and pending team membership will be released. You can apply again while applications are open."
              : "Your reserved event place will be released. You can apply again while applications are open."
          }
          onClose={() => setWithdrawId(null)}
          footer={
            <>
              <Button variant="text" onClick={() => setWithdrawId(null)}>
                Keep application
              </Button>
              <Button
                onClick={async () => {
                  const result = await run({
                    type: "WITHDRAW_APPLICATION",
                    applicationId: withdrawing.id,
                  });
                  if (!result.error) setWithdrawId(null);
                }}
              >
                Withdraw application
              </Button>
            </>
          }
        >
          <div className="withdrawal-summary">
            <strong>{withdrawalEvent?.title}</strong>
            <Badge color="yellow">Awaiting review</Badge>
          </div>
        </Modal>
      )}
    </>
  );
}
