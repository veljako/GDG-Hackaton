import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Sliders,
  UsersThree,
  CheckCircle,
  Clock,
  ArrowUpRight,
  PencilSimple,
  ArrowRight,
} from "@phosphor-icons/react";
import { useDemo } from "../store";
import { teamStatus } from "../domain";
import { organizerName } from "../config";
import {
  PageTitle,
  SectionTitle,
  Chips,
  Search,
  Button,
  Badge,
  Avatar,
  Empty,
  Modal,
  Field,
  submitHandler,
  formatDate,
} from "../components/ui";
import { TeamStatusBadge, EventArt } from "../components/visuals";
import type { Application, Hackathon, Role, Color } from "../types";
import type { EventKind, Goal, Level } from "../types";
import { eventKinds, goals, levels, hasTeams } from "../discovery";
import { CustomSelect } from "../components/CustomSelect";

export default function Organizer() {
  const { state, run, me, memberships, busy, startOrganization } = useDemo();
  const navigate = useNavigate();
  const [eventId, setEventId] = useState("gdg-belgrade");
  const [tab, setTab] = useState("Applications");
  const [filter, setFilter] = useState("Pending");
  const [query, setQuery] = useState("");
  const [review, setReview] = useState<Application | null>(null);
  const [edit, setEdit] = useState<Hackathon | "new" | null>(null);
  const event = state.events.find((e) => e.id === eventId) ?? state.events[0];
  const organizationAdmin =
    !event?.organizationId ||
    memberships.some(
      (m) =>
        m.organizationId === event.organizationId &&
        m.personId === me.id &&
        m.role === "admin",
    );
  const mayEdit =
    organizationAdmin ||
    (event?.createdBy === me.id &&
      event.status === "draft" &&
      !event.publishedAt &&
      event.publicationStatus !== "pending");
  const maySubmit =
    !!event?.organizationId &&
    event.status === "draft" &&
    !event.publishedAt &&
    event.publicationStatus !== "pending" &&
    event.createdBy === me.id;
  const applications = state.applications.filter(
    (a) => a.eventId === event?.id,
  );
  const teams = state.teams.filter((t) => t.eventId === event?.id);
  const shown = (organizationAdmin ? applications : []).filter(
    (a) =>
      (filter === "All" || a.status === filter.toLowerCase()) &&
      `${state.people.find((p) => p.id === a.personId)?.name} ${a.role}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (state.mode !== "organizer")
    return (
      <Empty
        title="A space for the people who bring us together"
        description="Open the organizer workspace to create events and review participation."
        action={
          <Button onClick={() => run({ type: "SET_MODE", mode: "organizer" })}>
            Open organizer workspace
          </Button>
        }
      />
    );
  if (!event)
    return (
      <>
        <div className="organization-actions">
          <Button variant="text" onClick={startOrganization}>
            Organizations
          </Button>
        </div>
        <Empty
          title="Your first event starts here"
          description="Create a business, learning or science event and bring your community together."
          action={<Button onClick={() => setEdit("new")}>Create event</Button>}
        />
        {edit && (
          <EventEditor onClose={() => setEdit(null)} onCreated={setEventId} />
        )}
      </>
    );
  return (
    <>
      <PageTitle
        title="Bring good people together."
        description="A little organization. A lot of possibilities."
        action={
          <div className="organization-actions">
            <Button variant="text" onClick={startOrganization}>
              Organizations
            </Button>
            <Button icon={<Plus size={18} />} onClick={() => setEdit("new")}>
              Create event
            </Button>
          </div>
        }
      />
      <div className="organizer-event-picker">
        <div className="inline-select">
          <span>Managing</span>
          <CustomSelect
            label="Manage event"
            hideLabel
            value={event.id}
            onChange={setEventId}
            options={state.events.map((e) => ({
              value: e.id,
              label:
                e.title +
                (e.publicationStatus === "pending"
                  ? " · Awaiting approval"
                  : e.publicationStatus === "draft"
                    ? " · Draft"
                    : ""),
            }))}
          />
        </div>
        <div>
          <Badge color={event.status === "open" ? "green" : "neutral"}>
            {event.status === "open"
              ? "Applications open"
              : event.status === "draft"
                ? "Draft"
                : "Past event"}
          </Badge>
          <Button
            variant="text"
            icon={<PencilSimple size={17} />}
            disabled={!mayEdit}
            onClick={() => setEdit(event)}
          >
            Edit event
          </Button>
          <IconLink onClick={() => navigate(`/hackathons/${event.id}`)} />
        </div>
      </div>
      {event.organizationId && (
        <div className="organization-publication">
          <Badge
            color={
              event.publicationStatus === "pending"
                ? "yellow"
                : event.publicationStatus === "approved"
                  ? "green"
                  : "neutral"
            }
          >
            {event.publicationStatus === "pending"
              ? "Awaiting admin approval"
              : event.publicationStatus === "approved"
                ? "Approved"
                : "Draft"}
          </Badge>
          <p>
            {event.publicationStatus === "pending"
              ? "An organization admin will review this event before publication."
              : event.publicationStatus === "approved"
                ? "Your organization approved this event for publication."
                : "Draft events appear to your organization. Submit this event when it is ready."}
          </p>
          {maySubmit && (
            <Button
              disabled={busy}
              variant="tonal"
              onClick={() =>
                void run({
                  type: "SUBMIT_EVENT_FOR_APPROVAL",
                  eventId: event.id,
                })
              }
            >
              Submit for approval
            </Button>
          )}
          {organizationAdmin && event.publicationStatus === "pending" && (
            <>
              <Button
                disabled={busy}
                variant="outlined"
                onClick={() =>
                  void run({
                    type: "REVIEW_EVENT_PUBLICATION",
                    eventId: event.id,
                    decision: "reject",
                  })
                }
              >
                Return to draft
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run({
                    type: "REVIEW_EVENT_PUBLICATION",
                    eventId: event.id,
                    decision: "approve",
                  })
                }
              >
                Approve and publish
              </Button>
            </>
          )}
        </div>
      )}
      <div className="organizer-summary">
        <Metric
          icon={<UsersThree size={23} />}
          color="blue"
          value={applications.length}
          label="Applications"
        />
        <Metric
          icon={<Clock size={23} />}
          color="yellow"
          value={applications.filter((a) => a.status === "pending").length}
          label="Awaiting review"
        />
        <Metric
          icon={<CheckCircle size={23} />}
          color="green"
          value={applications.filter((a) => a.status === "accepted").length}
          label={`Accepted · ${event.capacity} capacity`}
        />
        <Metric
          icon={<Sliders size={23} />}
          color="red"
          value={
            teams.filter((t) => teamStatus(state, t) === "confirmed").length
          }
          label="Confirmed teams"
        />
      </div>
      <div className="tabs" aria-label="Organizer sections">
        {(hasTeams(event)
          ? ["Applications", "Teams", "Event overview"]
          : ["Applications", "Event overview"]
        ).map((t) => (
          <button
            aria-pressed={tab === t}
            className={tab === t ? "selected" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Applications" && !organizationAdmin && (
        <Empty
          title="Application review is managed by admins"
          description="You can draft events and submit them for your organization’s approval."
        />
      )}
      {tab === "Applications" && organizationAdmin && (
        <section className="panel applications-panel">
          <SectionTitle
            title="Every good team starts with people"
            subtitle="Review the person first. Team status follows their admission automatically."
          />
          <div className="filter-toolbar">
            <Chips
              values={["Pending", "Accepted", "Rejected", "All"]}
              active={filter}
              onChange={setFilter}
            />
            <Search
              value={query}
              onChange={setQuery}
              label="Search applications"
              placeholder="Find an applicant"
            />
          </div>
          {shown.length ? (
            <div className="application-table">
              <div className="table-header">
                <span>Applicant</span>
                <span>Joining as</span>
                <span>Team</span>
                <span>Status</span>
                <span />
              </div>
              {shown.map((a) => {
                const p = state.people.find((p) => p.id === a.personId)!;
                return (
                  <button
                    className="application-row"
                    key={a.id}
                    onClick={() => setReview(a)}
                  >
                    <span className="application-person">
                      <Avatar person={p} size={43} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.title}</small>
                      </span>
                    </span>
                    <span>{a.role}</span>
                    <span>
                      {state.teams.find((t) => t.id === a.teamId)?.name ??
                        "Applying solo"}
                    </span>
                    <Badge
                      color={
                        a.status === "accepted"
                          ? "green"
                          : a.status === "pending"
                            ? "yellow"
                            : "red"
                      }
                    >
                      {a.status}
                    </Badge>
                    <span className="review-link">
                      Review <ArrowRight size={16} />
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty
              title={
                filter === "Pending"
                  ? "You're all caught up"
                  : "No applications here"
              }
              description={
                filter === "Pending"
                  ? "New applicants will appear here when they apply."
                  : "Try another status or applicant name."
              }
            />
          )}
        </section>
      )}
      {hasTeams(event) && tab === "Teams" && (
        <section className="panel">
          <SectionTitle
            title="Ideas are finding their people"
            subtitle="Admission and team size determine which teams are confirmed."
          />
          {teams.length ? (
            <div className="organizer-teams">
              {teams.map((t) => (
                <button key={t.id} onClick={() => navigate(`/teams/${t.id}`)}>
                  <div className="avatar-stack">
                    {t.memberIds.map((pid) => (
                      <Avatar
                        key={pid}
                        person={state.people.find((p) => p.id === pid)!}
                      />
                    ))}
                  </div>
                  <div>
                    <strong>{t.name}</strong>
                    <small>
                      {t.memberIds.length} members · {t.skills.join(", ")}
                    </small>
                  </div>
                  <TeamStatusBadge team={t} />
                  <ArrowUpRight size={20} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="The teams are yet to come"
              description="Attendees can apply alone, create a team, or accept a fresh invitation."
            />
          )}
        </section>
      )}
      {tab === "Event overview" && (
        <div className="organizer-overview">
          <EventArt event={event} />
          <section className="panel">
            <Badge color={event.color}>{organizerName(event.organizer)}</Badge>
            <h2>{event.title}</h2>
            <p>{event.description}</p>
            <dl className="overview-facts">
              <div>
                <dt>Date</dt>
                <dd>
                  {formatDate(event.date, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </dd>
              </div>
              <div>
                <dt>Place</dt>
                <dd>{event.venue}</dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>{event.format ?? "Format to be confirmed"}</dd>
              </div>
              <div>
                <dt>{hasTeams(event) ? "Team size" : "Registration"}</dt>
                <dd>
                  {hasTeams(event)
                    ? `${event.minTeamSize}–${event.maxTeamSize} people`
                    : event.registration === "automatic"
                      ? "Immediate confirmation"
                      : "Organizer review"}
                </dd>
              </div>
              <div>
                <dt>Apply by</dt>
                <dd>{formatDate(event.deadline)}</dd>
              </div>
            </dl>
            <Button
              variant="tonal"
              disabled={!mayEdit}
              onClick={() => setEdit(event)}
              icon={<PencilSimple size={17} />}
            >
              Edit details
            </Button>
          </section>
        </div>
      )}
      {review && (
        <ReviewModal
          application={
            state.applications.find((a) => a.id === review.id) ?? review
          }
          onClose={() => setReview(null)}
        />
      )}{" "}
      {edit && (
        <EventEditor
          event={edit === "new" ? undefined : edit}
          onClose={() => setEdit(null)}
          onCreated={setEventId}
        />
      )}
    </>
  );
}
function IconLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="icon-button"
      aria-label="Preview event"
      onClick={onClick}
    >
      <ArrowUpRight size={21} />
    </button>
  );
}
function Metric({
  icon,
  color,
  value,
  label,
}: {
  icon: React.ReactNode;
  color: Color;
  value: number;
  label: string;
}) {
  return (
    <div className="metric">
      <span className={`metric-icon color-${color}`}>{icon}</span>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function ReviewModal({
  application: a,
  onClose,
}: {
  application: Application;
  onClose: () => void;
}) {
  const { state, run } = useDemo();
  const p = state.people.find((p) => p.id === a.personId)!;
  const team = state.teams.find((t) => t.id === a.teamId);
  async function decide(status: "accepted" | "rejected") {
    const result = await run({
      type: "REVIEW_APPLICATION",
      applicationId: a.id,
      status,
    });
    if (!result.error) onClose();
  }
  return (
    <Modal
      wide
      title="A new person, a new possibility"
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Close
          </Button>
          {a.status !== "rejected" && (
            <Button variant="outlined" onClick={() => decide("rejected")}>
              Decline application
            </Button>
          )}
          {a.status !== "accepted" && (
            <Button
              icon={<CheckCircle size={18} />}
              onClick={() => decide("accepted")}
            >
              Accept applicant
            </Button>
          )}
        </>
      }
    >
      <div className="review-profile">
        <Avatar person={p} size={76} />
        <div>
          <h2>{p.name}</h2>
          <p>{p.title}</p>
          <small>
            {p.city} · {p.school}
          </small>
        </div>
        <Badge
          color={
            a.status === "accepted"
              ? "green"
              : a.status === "pending"
                ? "yellow"
                : "red"
          }
        >
          {a.status}
        </Badge>
      </div>
      <p className="profile-bio">{p.bio}</p>
      <h3 className="detail-label">What I bring</h3>
      <div className="skill-list">
        {p.skills.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      <h3 className="detail-label">Experience</h3>
      <p>{p.experience}</p>
      <div className="review-application">
        <Badge color="blue">{a.role as Role}</Badge>
        <Badge>{team ? `Joining ${team.name}` : "Applying on their own"}</Badge>
        <h3>Why I'd like to join</h3>
        <p>{a.motivation || "No additional note."}</p>
        {p.cv && (
          <p className="form-note">
            CV attachment: {p.cv} (filename stored for this demo)
          </p>
        )}
      </div>
      <p className="form-note">
        Approving this applicant confirms their event attendance. Existing
        teammates keep their own admission status.
      </p>
    </Modal>
  );
}
function EventEditor({
  event,
  onClose,
  onCreated,
}: {
  event?: Hackathon;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { run, organizations, memberships, me } = useDemo();
  const [organizationId, setOrganizationId] = useState(
    event ? (event.organizationId ?? "") : (organizations[0]?.id ?? ""),
  );
  const organization = organizations.find((o) => o.id === organizationId);
  const organizationAdmin = memberships.some(
    (m) =>
      m.organizationId === organizationId &&
      m.personId === me.id &&
      m.role === "admin",
  );
  const [kind, setKind] = useState<EventKind>(event?.kind ?? "hackathon");
  const [formError, setFormError] = useState("");
  const split = (value: FormDataEntryValue | null) => [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  const numeric = (data: FormData, key: string) =>
    String(data.get(key) ?? "").trim() === "" ? null : Number(data.get(key));
  return (
    <Modal
      wide
      title={
        event
          ? "Make a few thoughtful changes"
          : "Create a reason to come together"
      }
      description={
        organizationId
          ? "Set the essentials, then submit your draft for an organization admin to approve."
          : "Set the essentials. Participants can discover your event as soon as you open applications."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button form="event-form">
            {event ? "Save changes" : "Create event"}
          </Button>
        </>
      }
    >
      <form
        id="event-form"
        className="form-stack"
        onSubmit={submitHandler(async (data) => {
          const minAge = numeric(data, "minAge"),
            maxAge = numeric(data, "maxAge"),
            minBirthYear = numeric(data, "minBirthYear"),
            maxBirthYear = numeric(data, "maxBirthYear");
          if (
            (minAge !== null && maxAge !== null && minAge > maxAge) ||
            (minBirthYear !== null &&
              maxBirthYear !== null &&
              minBirthYear > maxBirthYear)
          ) {
            setFormError(
              "Minimum age and birth year must not exceed their maximum.",
            );
            return;
          }
          if (
            String(data.get("endDate")) < String(data.get("date")) ||
            String(data.get("deadline")) > String(data.get("date"))
          ) {
            setFormError(
              "End date must be on or after the start date, and the application deadline on or before it.",
            );
            return;
          }
          setFormError("");
          const details: Omit<Hackathon, "id"> = {
            matchingVersion: 2,
            topics: split(data.get("topics")),
            country: String(data.get("country") ?? "").trim(),
            languages: split(data.get("languages")),
            price:
              numeric(data, "priceAmount") === null
                ? null
                : {
                    amount: Number(data.get("priceAmount")),
                    currency: String(data.get("priceCurrency") || "EUR")
                      .trim()
                      .toUpperCase(),
                  },
            eligibility: {
              requiredSkills: split(data.get("requiredSkills")),
              seniorities: data.getAll("seniorities") as NonNullable<
                Hackathon["eligibility"]
              >["seniorities"],
              statuses: data.getAll("statuses") as NonNullable<
                Hackathon["eligibility"]
              >["statuses"],
              minAge,
              maxAge,
              minBirthYear,
              maxBirthYear,
            },
            kind,
            registration:
              kind === "hackathon"
                ? "review"
                : (data.get("registration") as "review" | "automatic"),
            audience: {
              skills: String(data.get("audienceSkills") ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              taughtSkills: split(data.get("taughtSkills")),
              goals: data.getAll("audienceGoals") as Goal[],
              roles: data.getAll("audienceRoles") as Role[],
              levels: data.getAll("audienceLevels") as Level[],
            },
            title: String(data.get("title")),
            organizer: organization?.name ?? String(data.get("organizer")),
            description: String(data.get("description")),
            theme: String(data.get("theme")),
            date: String(data.get("date")),
            endDate: String(data.get("endDate")),
            deadline: String(data.get("deadline")),
            location: String(data.get("location")),
            venue: String(data.get("venue")),
            format: data.get("format") as Hackathon["format"],
            status:
              organizationId &&
              (!event ||
                !organizationAdmin ||
                event.publicationStatus !== "approved")
                ? "draft"
                : (data.get("status") as Hackathon["status"]),
            capacity: Number(data.get("capacity")),
            minTeamSize: kind === "hackathon" ? Number(data.get("min")) : 1,
            maxTeamSize: kind === "hackathon" ? Number(data.get("max")) : 1,
            color: data.get("color") as Color,
            tags: String(data.get("tags"))
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
            schedule:
              event?.schedule ??
              (kind !== "hackathon"
                ? [
                    {
                      time: "09:00",
                      title: "Welcome and introductions",
                      description:
                        "Meet the community and explore the program.",
                    },
                    {
                      time: "10:00",
                      title: "Sessions and discussion",
                      description: "Learn, exchange ideas and connect.",
                    },
                  ]
                : [
                    {
                      time: "09:00",
                      title: "Meet the community",
                      description:
                        "Check in and get to know the people around you.",
                    },
                    {
                      time: "10:00",
                      title: "Build together",
                      description:
                        "Form your teams and turn an idea into a prototype.",
                    },
                    {
                      time: "17:00",
                      title: "Share your work",
                      description: "Show what you built and celebrate the day.",
                    },
                  ]),
          };
          const result = await run(
            event
              ? { type: "UPDATE_EVENT", eventId: event.id, changes: details }
              : {
                  type: "CREATE_EVENT",
                  event: {
                    ...details,
                    ...(organizationId ? { organizationId } : {}),
                  },
                },
          );
          if (!result.error) {
            if (result.createdId) onCreated(result.createdId);
            onClose();
          }
        })}
      >
        {!!organizations.length && (
          <Field label="Hosting organization">
            <select
              aria-label="Hosting organization"
              value={organizationId}
              disabled={!!event}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              {event && !event.organizationId && (
                <option value="">Existing organizer</option>
              )}
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Event type">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as EventKind)}
          >
            {eventKinds.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        {kind !== "hackathon" && (
          <Field label="Registration">
            <select
              name="registration"
              defaultValue={event?.registration ?? "review"}
            >
              <option value="review">Organizer reviews applications</option>
              <option value="automatic">
                Confirm immediately when a place is available
              </option>
            </select>
          </Field>
        )}
        <Field label="Event name">
          <input
            name="title"
            required
            maxLength={80}
            defaultValue={event?.title}
            placeholder="Your next build day"
          />
        </Field>
        <div className="form-columns">
          <Field label="Organizer">
            <input
              name="organizer"
              required
              readOnly={!!organizationId}
              key={organizationId}
              defaultValue={
                organization?.name ?? event?.organizer ?? "GDG Belgrade"
              }
            />
          </Field>
          <Field label="Theme">
            <input
              name="theme"
              required
              defaultValue={event?.theme}
              placeholder="What will people explore?"
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            name="description"
            required
            rows={3}
            defaultValue={event?.description}
          />
        </Field>
        <div className="form-columns three">
          <Field label="Starts">
            <input
              type="date"
              name="date"
              required
              defaultValue={event?.date ?? "2026-10-25"}
            />
          </Field>
          <Field label="Ends">
            <input
              type="date"
              name="endDate"
              required
              defaultValue={event?.endDate ?? "2026-10-25"}
            />
          </Field>
          <Field label="Apply by">
            <input
              type="date"
              name="deadline"
              required
              defaultValue={event?.deadline ?? "2026-10-23"}
            />
          </Field>
        </div>
        <div className="form-columns">
          <Field label="City or online">
            <input
              name="location"
              required
              defaultValue={event?.location ?? "Belgrade"}
            />
          </Field>
          <Field label="Venue">
            <input
              name="venue"
              required
              defaultValue={event?.venue}
              placeholder="Where to meet"
            />
          </Field>
        </div>
        <div className="form-columns three">
          <Field label="Capacity">
            <input
              name="capacity"
              type="number"
              min="1"
              max="5000"
              required
              defaultValue={event?.capacity ?? 60}
            />
          </Field>
          {kind === "hackathon" && (
            <Field label="Minimum team">
              <input
                name="min"
                type="number"
                min="1"
                max="6"
                required
                defaultValue={event?.minTeamSize ?? 2}
              />
            </Field>
          )}
          {kind === "hackathon" && (
            <Field label="Maximum team">
              <input
                name="max"
                type="number"
                min="1"
                max="6"
                required
                defaultValue={event?.maxTeamSize ?? 4}
              />
            </Field>
          )}
        </div>
        <div className="form-columns three">
          <Field label="Format">
            <select name="format" required defaultValue={event?.format ?? ""}>
              <option value="">Choose a format</option>
              <option>In person</option>
              <option>Hybrid</option>
              <option>Online</option>
            </select>
          </Field>
          <Field label="Applications">
            <select
              name="status"
              disabled={
                !!organizationId &&
                (!event ||
                  !organizationAdmin ||
                  event.publicationStatus !== "approved")
              }
              defaultValue={
                event?.status ?? (organizationId ? "draft" : "open")
              }
            >
              <option value="open">Open</option>
              <option value="draft">Save as draft</option>
              <option value="past">Past event</option>
            </select>
          </Field>
          <Field label="Event color">
            <select name="color" defaultValue={event?.color ?? "blue"}>
              {["blue", "red", "yellow", "green"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}
        <div className="form-grid">
          <Field label="Country" hint="Optional.">
            <input
              name="country"
              maxLength={100}
              defaultValue={event?.country ?? ""}
            />
          </Field>
          <Field label="Event languages" hint="Separate languages with commas.">
            <input
              name="languages"
              maxLength={400}
              defaultValue={(event?.languages ?? []).join(", ")}
            />
          </Field>
          <Field
            label="Ticket price"
            hint="Optional. Blank means not specified; zero means free."
          >
            <input
              name="priceAmount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={event?.price?.amount ?? ""}
            />
          </Field>
          <Field label="Price currency">
            <input
              name="priceCurrency"
              minLength={3}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              defaultValue={event?.price?.currency ?? "EUR"}
            />
          </Field>
        </div>
        <Field label="Event topics" hint="Separate topics with commas.">
          <input
            name="topics"
            maxLength={600}
            defaultValue={(event?.topics ?? event?.tags ?? []).join(", ")}
          />
        </Field>
        <Field label="Display tags" hint="Separate tags with commas.">
          <input
            name="tags"
            defaultValue={event?.tags.join(", ")}
            placeholder="Community, Web, Social impact"
          />
        </Field>
        <fieldset className="discovery-preferences">
          <legend>Who will benefit?</legend>
          <p className="form-note">
            These help people discover your event. They do not restrict
            registration. Leave a criterion empty to welcome everyone.
          </p>
          <Field
            label="Skills practiced"
            hint="Useful skills, not prerequisites. Separate skills with commas."
          >
            <input
              name="audienceSkills"
              defaultValue={event?.audience?.skills.join(", ") ?? ""}
              placeholder="React, Data analysis, Research"
            />
          </Field>
          <Field
            label="Skills taught"
            hint="What attendees will learn. Separate skills with commas."
          >
            <input
              name="taughtSkills"
              maxLength={600}
              defaultValue={(event?.audience?.taughtSkills ?? []).join(", ")}
            />
          </Field>
          <h3 className="detail-label">Goals</h3>
          <div className="role-checkboxes">
            {goals.map((g) => (
              <label key={g}>
                <input
                  type="checkbox"
                  name="audienceGoals"
                  value={g}
                  defaultChecked={event?.audience?.goals.includes(g)}
                />
                <span>{g}</span>
              </label>
            ))}
          </div>
          <h3 className="detail-label">Roles</h3>
          <div className="role-checkboxes">
            {(["Participant", "Mentor", "Speaker", "Judge"] as Role[]).map(
              (r) => (
                <label key={r}>
                  <input
                    type="checkbox"
                    name="audienceRoles"
                    value={r}
                    defaultChecked={event?.audience?.roles.includes(r)}
                  />
                  <span>{r}</span>
                </label>
              ),
            )}
          </div>
          <h3 className="detail-label">Relevant experience levels</h3>
          <p className="form-note">
            Leave empty for all levels. This does not restrict admission.
          </p>
          <div className="role-checkboxes">
            {levels.map((l) => (
              <label key={l}>
                <input
                  type="checkbox"
                  name="audienceLevels"
                  value={l}
                  defaultChecked={event?.audience?.levels.includes(l)}
                />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="discovery-preferences">
          <legend>Eligibility requirements</legend>
          <p className="form-note">
            Only add explicit admission restrictions. Leave these empty to
            welcome everyone. Missing required profile information prevents
            eligibility confirmation.
          </p>
          <Field
            label="Prerequisite skills"
            hint="Skills attendees must already have. Separate skills with commas."
          >
            <input
              name="requiredSkills"
              maxLength={600}
              defaultValue={(event?.eligibility?.requiredSkills ?? []).join(
                ", ",
              )}
            />
          </Field>
          <h3 className="detail-label">Required professional seniority</h3>
          <div className="role-checkboxes">
            {(["Junior", "Mid", "Senior"] as const).map((value) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name="seniorities"
                  value={value}
                  defaultChecked={event?.eligibility?.seniorities?.includes(
                    value,
                  )}
                />
                <span>{value}</span>
              </label>
            ))}
          </div>
          <h3 className="detail-label">Required current status</h3>
          <div className="role-checkboxes">
            {(["Student", "Employed", "Freelancer"] as const).map((value) => (
              <label key={value}>
                <input
                  type="checkbox"
                  name="statuses"
                  value={value}
                  defaultChecked={event?.eligibility?.statuses?.includes(value)}
                />
                <span>{value}</span>
              </label>
            ))}
          </div>
          <div className="form-grid">
            {(
              [
                ["minAge", "Minimum age"],
                ["maxAge", "Maximum age"],
                ["minBirthYear", "Earliest birth year"],
                ["maxBirthYear", "Latest birth year"],
              ] as const
            ).map(([name, label]) => (
              <Field key={name} label={label} hint="Optional.">
                <input
                  name={name}
                  type="number"
                  min={name.includes("BirthYear") ? 1900 : 0}
                  max={
                    name.includes("BirthYear") ? new Date().getFullYear() : 130
                  }
                  step="1"
                  defaultValue={event?.eligibility?.[name] ?? ""}
                />
              </Field>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
