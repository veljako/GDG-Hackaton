import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarBlank,
  MapPin,
  UsersThree,
  Clock,
  ArrowRight,
  CheckCircle,
  DownloadSimple,
} from "@phosphor-icons/react";
import { useDemo } from "../store";
import { admissionFor } from "../domain";
import { BRAND, organizerName } from "../config";
import { hasTeams, kindLabel, registrationOpen } from "../discovery";
import {
  SectionTitle,
  Button,
  Badge,
  Avatar,
  Empty,
  formatDate,
} from "../components/ui";
import { BrandMark, EventArt, TeamStatusBadge } from "../components/visuals";
import { ApplyModal, PersonModal, CreateTeamModal } from "../components/forms";
import { MatchingEventDetails } from "../components/MatchingEventDetails";
import type { Person } from "../types";

export function HackathonDetail() {
  const { id } = useParams();
  const { state, me } = useDemo();
  const navigate = useNavigate();
  const [tab, setTab] = useState("Overview");
  const [apply, setApply] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [create, setCreate] = useState(false);
  const event = state.events.find((e) => e.id === id);
  if (!event)
    return (
      <Empty
        title="This event isn't here"
        description="Explore the available events to find your next one."
        action={
          <Button onClick={() => navigate("/events")}>Explore events</Button>
        }
      />
    );
  const application = admissionFor(state, event.id, me.id);
  const roster = state.applications
    .filter((a) => a.eventId === event.id && a.status === "accepted")
    .map((a) => state.people.find((p) => p.id === a.personId)!)
    .filter(Boolean);
  const teams = state.teams.filter((t) => t.eventId === event.id);
  function downloadCalendar() {
    const escape = (text: string) =>
      text
        .replaceAll("\\", "\\\\")
        .replaceAll("\n", "\\n")
        .replaceAll(",", "\\,")
        .replaceAll(";", "\\;");
    const end = new Date(`${event!.endDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const data = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//${BRAND.name}//Local Demo//EN\r\nBEGIN:VEVENT\r\nUID:${event!.id}@gevents.demo\r\nDTSTAMP:20261010T000000Z\r\nDTSTART;VALUE=DATE:${event!.date.replaceAll("-", "")}\r\nDTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replaceAll("-", "")}\r\nSUMMARY:${escape(event!.title)}\r\nLOCATION:${escape(event!.venue)}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const url = URL.createObjectURL(
      new Blob([data], { type: "text/calendar" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${event!.id}.ics`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <button className="back-link" onClick={() => navigate("/events")}>
        <ArrowLeft size={18} />
        All events
      </button>
      <div className="event-detail-banner">
        <EventArt event={event} />
        <div className="event-banner-info">
          <Badge color={event.color}>{organizerName(event.organizer)}</Badge>
          <Badge>{kindLabel(event)}</Badge>
          <h1>{event.title}</h1>
          <p>{event.theme}</p>
        </div>
      </div>
      <div className="event-detail-layout">
        <div className="event-detail-main">
          <div className="event-facts">
            <div>
              <CalendarBlank size={22} />
              <span>
                <strong>
                  {formatDate(event.date, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </strong>
                <small>
                  {event.date === event.endDate
                    ? "One day of possibilities"
                    : `Until ${formatDate(event.endDate)}`}
                </small>
              </span>
            </div>
            <div>
              <MapPin size={22} />
              <span>
                <strong>{event.location}</strong>
                <small>{event.venue}</small>
              </span>
            </div>
            <div>
              <UsersThree size={22} />
              <span>
                <strong>
                  {hasTeams(event)
                    ? `${event.minTeamSize}–${event.maxTeamSize} people per team`
                    : "Individual attendance"}
                </strong>
                <small>
                  {hasTeams(event)
                    ? "Solo applications welcome"
                    : event.registration === "automatic"
                      ? "Immediate confirmation"
                      : "Organizer reviews applications"}
                </small>
              </span>
            </div>
          </div>
          <div className="tabs" aria-label="Event details">
            {(hasTeams(event)
              ? ["Overview", "Agenda", "People", "Teams"]
              : ["Overview", "Agenda", "People"]
            ).map((t) => (
              <button
                aria-pressed={tab === t}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "People" && <span>{roster.length}</span>}
              </button>
            ))}
          </div>
          {tab === "Overview" && (
            <div className="event-overview">
              <p>{event.description}</p>
              <MatchingEventDetails event={event} />
              <h3>What to bring</h3>
              <p>
                {hasTeams(event)
                  ? "Bring your laptop. Apply solo or with a team."
                  : "Bring your questions. Check the agenda for sessions."}
              </p>
              <h3>Things we'll explore</h3>
              <div className="skill-list">
                {event.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="event-info-note">
                <CheckCircle size={24} />
                <p>
                  <strong>
                    {!hasTeams(event) && event.registration === "automatic"
                      ? "Register to confirm your place."
                      : "Participation is reviewed by the organizers."}
                  </strong>
                  <br />
                  {hasTeams(event)
                    ? "Team invitations and event admission are separate. "
                    : ""}
                  Your application status is always visible in My activity.
                </p>
              </div>
            </div>
          )}
          {tab === "Agenda" && (
            <div className="agenda-list">
              {event.schedule.map((item, index) => (
                <div key={index} className="agenda-item">
                  <span className="agenda-time">{item.time}</span>
                  <span
                    className={`agenda-marker marker-${["blue", "red", "yellow", "green"][index % 4]}`}
                  />
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "People" &&
            (roster.length ? (
              <div className="event-roster">
                {roster.map((p) => (
                  <button
                    className="roster-person"
                    key={p.id}
                    onClick={() => setPerson(p)}
                  >
                    <Avatar person={p} size={52} />
                    <div>
                      <strong>{p.name}</strong>
                      <span>{p.title}</span>
                    </div>
                    <Badge color="green">Accepted</Badge>
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                title="The community is taking shape"
                description="Accepted participants will appear here."
              />
            ))}
          {hasTeams(event) && tab === "Teams" && (
            <>
              <SectionTitle
                title="Meet the teams"
                action={
                  event.status === "open" ? (
                    <Button variant="tonal" onClick={() => setCreate(true)}>
                      Create a team
                    </Button>
                  ) : undefined
                }
              />
              {teams.length ? (
                <div className="event-team-list">
                  {teams.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => navigate(`/teams/${t.id}`)}
                    >
                      <div className="avatar-stack">
                        {t.memberIds.slice(0, 3).map((pid) => (
                          <Avatar
                            key={pid}
                            person={state.people.find((p) => p.id === pid)!}
                          />
                        ))}
                      </div>
                      <div>
                        <strong>{t.name}</strong>
                        <small>{t.description}</small>
                      </div>
                      <TeamStatusBadge team={t} />
                      <ArrowRight size={20} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Be the first to bring people together"
                  description="Create a team and invite your connections."
                />
              )}
            </>
          )}
        </div>
        <aside className="event-detail-aside">
          <div className="panel apply-panel">
            <span className="apply-panel-art">
              <BrandMark />
            </span>
            <Badge
              color={
                application?.status === "accepted"
                  ? "green"
                  : application?.status === "pending"
                    ? "yellow"
                    : "blue"
              }
            >
              {application?.status === "accepted"
                ? "You're accepted"
                : application?.status === "pending"
                  ? "Application in review"
                  : application?.status === "rejected"
                    ? "Not accepted"
                    : event.status === "past"
                      ? "Event finished"
                      : registrationOpen(event)
                        ? "Applications open"
                        : "Registration closed"}
            </Badge>
            <h2>
              {application?.status === "accepted"
                ? "You're on the list."
                : application?.status === "pending"
                  ? "Your next chapter is pending."
                  : application?.status === "rejected"
                    ? "A different opportunity awaits."
                    : event.status === "past"
                      ? "Good ideas live on."
                      : "There’s a place for your ideas."}
            </h2>
            <p>
              {application?.status === "accepted"
                ? hasTeams(event)
                  ? "Find your teammates and get ready to build something great."
                  : "Your attendance is confirmed. Check the agenda and get ready to learn and connect."
                : application?.status === "pending"
                  ? "The organizers will review your profile and let you know."
                  : application?.status === "rejected"
                    ? "You can explore other events or review your application details."
                    : "Bring your skills and curiosity. Join on your own or with your people."}
            </p>
            <div className="apply-details">
              <span>
                Participation
                <strong>
                  {event.price
                    ? event.price.amount === 0
                      ? "Free"
                      : `${event.price.amount} ${event.price.currency}`
                    : "Not specified"}
                </strong>
              </span>
              <span>
                Confirmed people
                <strong>
                  {roster.length} / {event.capacity}
                </strong>
              </span>
              <span>
                <Clock size={15} /> Apply by
                <strong>{formatDate(event.deadline)}</strong>
              </span>
            </div>
            {application ? (
              <Button
                onClick={() =>
                  navigate(
                    application.status === "accepted" && hasTeams(event)
                      ? "/teams"
                      : "/activity",
                  )
                }
              >
                {application.status === "accepted"
                  ? hasTeams(event)
                    ? "Find your team"
                    : "View registration"
                  : "View application"}
              </Button>
            ) : (
              <Button
                disabled={!registrationOpen(event)}
                onClick={() => setApply(true)}
                icon={<ArrowRight size={18} />}
              >
                {hasTeams(event) ? "Apply to hackathon" : "Register for event"}
              </Button>
            )}
            <Button
              variant="text"
              onClick={downloadCalendar}
              icon={<DownloadSimple size={17} />}
            >
              Add to calendar
            </Button>
          </div>
          <div className="event-organizer">
            <Avatar
              person={
                state.people.find((p) => p.id === "ana") ?? state.people[0]
              }
            />
            <div>
              <small>Your hosts</small>
              <strong>{organizerName(event.organizer)}</strong>
            </div>
            <Badge>Community</Badge>
          </div>
        </aside>
      </div>
      {apply && <ApplyModal event={event} onClose={() => setApply(false)} />}{" "}
      {person && (
        <PersonModal person={person} onClose={() => setPerson(null)} />
      )}{" "}
      {create && (
        <CreateTeamModal eventId={event.id} onClose={() => setCreate(false)} />
      )}
    </>
  );
}
