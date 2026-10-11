import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  UsersThree,
  MapPin,
  Clock,
  Trash,
  SignOut,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { useDemo } from "../store";
import { admissionFor, memberState, isPastTeam } from "../domain";
import {
  PageTitle,
  Chips,
  Button,
  Badge,
  Avatar,
  Empty,
  Modal,
  IconButton,
} from "../components/ui";
import { TeamScene, TeamStatusBadge } from "../components/visuals";
import {
  CreateTeamModal,
  InviteModal,
  PersonModal,
  ApplyModal,
} from "../components/forms";
import type { Person, Team } from "../types";
import { MatchingControls } from "../components/MatchingControls";

export function Teams() {
  const { state, me } = useDemo();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("My teams");
  const [create, setCreate] = useState(false);
  const [reuse, setReuse] = useState<Team | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const teams = state.teams.filter((t) =>
    filter === "Previous teams"
      ? isPastTeam(state, t) && t.memberIds.includes(me.id)
      : !isPastTeam(state, t) &&
        (filter === "My teams" ? t.memberIds.includes(me.id) : true),
  );
  return (
    <>
      <PageTitle
        title="Your team space."
        description="Find a crew. Build together."
        action={
          <Button icon={<Plus size={18} />} onClick={() => setCreate(true)}>
            Create a team
          </Button>
        }
      />
      <div className="filter-toolbar">
        <Chips
          values={["My teams", "Meet the teams", "Previous teams"]}
          active={filter}
          onChange={setFilter}
        />
        <span className="muted">
          {teams.length} {teams.length === 1 ? "team" : "teams"}
        </span>
      </div>
      {teams.length ? (
        <div className="teams-grid">
          {teams.map((t) => (
            <article
              className={`team-card ${isPastTeam(state, t) ? "team-card-archived" : ""}`}
              key={t.id}
            >
              <div className="team-card-heading">
                <div>
                  <button onClick={() => navigate(`/teams/${t.id}`)}>
                    <h2>{t.name}</h2>
                    <ArrowUpRight size={19} />
                  </button>
                  <p>{state.events.find((e) => e.id === t.eventId)?.title}</p>
                </div>
                <TeamStatusBadge team={t} />
              </div>
              <TeamScene compact team={t} onPerson={setPerson} />
              <p className="team-card-description">{t.description}</p>
              <div className="team-card-footer">
                <span>
                  {t.memberIds.length} people ·{" "}
                  {state.events.find((e) => e.id === t.eventId)?.location}
                </span>
                {isPastTeam(state, t) ? (
                  <Button
                    variant="tonal"
                    icon={<ArrowsClockwise size={17} />}
                    onClick={() => setReuse(t)}
                  >
                    Reunite
                  </Button>
                ) : (
                  <Button
                    variant="text"
                    icon={<ArrowRight size={17} />}
                    onClick={() => navigate(`/teams/${t.id}`)}
                  >
                    Open team
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            filter === "Previous teams"
              ? "Your team story is just beginning"
              : "Your people are out there"
          }
          description={
            filter === "Previous teams"
              ? "Teams from past hackathons will be saved here, ready for another adventure."
              : "Create a team, accept an invitation, or meet the community."
          }
          action={
            <Button variant="tonal" onClick={() => setCreate(true)}>
              Create a team
            </Button>
          }
        />
      )}{" "}
      {create && <CreateTeamModal onClose={() => setCreate(false)} />}{" "}
      {reuse && (
        <CreateTeamModal reuse={reuse} onClose={() => setReuse(null)} />
      )}{" "}
      {person && (
        <PersonModal person={person} onClose={() => setPerson(null)} />
      )}
    </>
  );
}
export function TeamDetail() {
  const { id } = useParams();
  const { state, me, run } = useDemo();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(false);
  const [invitePerson, setInvitePerson] = useState<Person | undefined>();
  const [person, setPerson] = useState<Person | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const [apply, setApply] = useState(false);
  const [reuse, setReuse] = useState(false);
  const team = state.teams.find((t) => t.id === id);
  if (!team)
    return (
      <Empty
        title="This team isn't here"
        description="Explore your teams to find the right space."
        action={<Button onClick={() => navigate("/teams")}>View teams</Button>}
      />
    );
  const event = state.events.find((e) => e.id === team.eventId)!;
  const isMember = team.memberIds.includes(me.id);
  const captain = state.people.find((p) => p.id === team.captainId);
  const pendingInvites = state.invitations.filter(
    (i) => i.teamId === team.id && i.status === "pending",
  );
  const incoming = pendingInvites.find((i) => i.personId === me.id);
  const ownApp = admissionFor(state, event.id, me.id);
  const accepted = team.memberIds.filter(
    (pid) => memberState(state, team, pid) === "accepted",
  ).length;
  return (
    <>
      <button className="back-link" onClick={() => navigate("/teams")}>
        <ArrowLeft size={18} />
        All teams
      </button>
      <PageTitle
        title={team.name}
        description={team.description}
        action={
          isPastTeam(state, team) && isMember ? (
            <Button
              icon={<ArrowsClockwise size={18} />}
              onClick={() => setReuse(true)}
            >
              Bring the team back
            </Button>
          ) : isMember ? (
            <Button icon={<Plus size={18} />} onClick={() => setInvite(true)}>
              Invite a teammate
            </Button>
          ) : undefined
        }
      />
      <div className="team-detail-layout">
        {isMember && !isPastTeam(state, team) && (
          <MatchingControls
            route="team"
            input={{ team_id: team.id }}
            names={Object.fromEntries(state.people.map((p) => [p.id, p.name]))}
          />
        )}
        <section className="panel team-space">
          <div className="team-space-top">
            <TeamStatusBadge team={team} />
            <button
              className="event-context-link"
              onClick={() => navigate(`/hackathons/${event.id}`)}
            >
              <MapPin size={16} />
              {event.title}
              <ArrowUpRight size={15} />
            </button>
          </div>
          <TeamScene
            team={team}
            onPerson={setPerson}
            onInvite={
              isMember && !isPastTeam(state, team)
                ? () => setInvite(true)
                : undefined
            }
          />
          <div className="team-space-footer">
            <span>
              <span className="legend-dot color-green" />
              Confirmed member
            </span>
            <span>
              <span className="legend-dot legend-pending" />
              Waiting for confirmation
            </span>
            <span>{event.maxTeamSize - accepted} unconfirmed places</span>
          </div>
        </section>
        <aside className="team-detail-aside">
          <section className="panel team-at-a-glance">
            <h2>The next chapter</h2>
            <div className="team-event-mini">
              <span className={`event-initial color-${event.color}`}>
                <UsersThree size={24} />
              </span>
              <div>
                <strong>{event.title}</strong>
                <small>
                  {event.location} ·{" "}
                  {event.date.slice(5).split("-").reverse().join("/")}
                </small>
              </div>
            </div>
            <div className="team-progress-label">
              <strong>{accepted} confirmed</strong>
              <span>Up to {event.maxTeamSize} people</span>
            </div>
            <div className="team-slot-track">
              {Array.from({ length: event.maxTeamSize }, (_, i) => (
                <span key={i} className={i < accepted ? "filled" : ""} />
              ))}
            </div>
            <p className="muted">
              {isPastTeam(state, team)
                ? "Your previous team is saved. Reunite for another event whenever you like."
                : accepted >= event.minTeamSize
                  ? "Your team meets the minimum size. You can still invite people to the open places."
                  : `You need ${event.minTeamSize - accepted} more approved ${event.minTeamSize - accepted === 1 ? "person" : "people"} to confirm this team.`}
            </p>
            <h3>What we're interested in</h3>
            <div className="skill-list">
              {team.skills.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
            {isMember && !ownApp && !isPastTeam(state, team) && (
              <Button onClick={() => setApply(true)}>
                Apply to this hackathon
              </Button>
            )}
            {isMember && ownApp?.status === "pending" && (
              <div className="inline-status">
                <Clock size={19} />
                <span>Your attendance is awaiting organizer approval.</span>
              </div>
            )}
            {isMember && ownApp?.status === "rejected" && (
              <div className="inline-status status-rejected">
                <span>
                  Your application was not accepted. Your place isn't confirmed.
                </span>
              </div>
            )}
            {incoming && (
              <div className="incoming-invite">
                <h3>There's a place for you</h3>
                <p>
                  {
                    state.people
                      .find((p) => p.id === incoming.fromId)
                      ?.name.split(" ")[0]
                  }{" "}
                  invited you to join.
                </p>
                <Button
                  disabled={isPastTeam(state, team) || event.status !== "open"}
                  onClick={() =>
                    run({
                      type: "RESPOND_INVITATION",
                      invitationId: incoming.id,
                      response: "accepted",
                    })
                  }
                >
                  {ownApp ? "Accept invitation" : "Accept and apply"}
                </Button>
                <Button
                  variant="text"
                  onClick={() =>
                    run({
                      type: "RESPOND_INVITATION",
                      invitationId: incoming.id,
                      response: "declined",
                    })
                  }
                >
                  Decline
                </Button>
              </div>
            )}
            {!isMember && !incoming && captain && (
              <Button variant="outlined" onClick={() => setPerson(captain)}>
                Meet the team captain
              </Button>
            )}
          </section>
        </aside>
      </div>
      <div className="team-lower-layout">
        <details className="panel team-members-panel">
          <summary>Member details and team controls</summary>
          {team.memberIds.map((pid) => {
            const p = state.people.find((p) => p.id === pid)!;
            const status = memberState(state, team, pid);
            return (
              <div className="team-member-row" key={pid}>
                <button
                  className="member-profile-link"
                  onClick={() => setPerson(p)}
                >
                  <Avatar person={p} size={46} />
                  <span>
                    <strong>
                      {p.name}
                      {p.id === me.id && <small> (you)</small>}
                    </strong>
                    <small>{p.title}</small>
                  </span>
                </button>
                <div className="member-row-status">
                  {pid === team.captainId && <Badge>Captain</Badge>}
                  <Badge
                    color={
                      status === "accepted"
                        ? "green"
                        : status === "rejected"
                          ? "red"
                          : "yellow"
                    }
                  >
                    {status === "accepted"
                      ? "Accepted"
                      : status === "rejected"
                        ? "Not admitted"
                        : "Awaiting admission"}
                  </Badge>
                  {isMember &&
                    !isPastTeam(state, team) &&
                    (me.id === team.captainId || pid === me.id) && (
                      <IconButton
                        label={
                          pid === me.id ? "Leave team" : `Remove ${p.name}`
                        }
                        onClick={() => setRemove(pid)}
                      >
                        {pid === me.id ? (
                          <SignOut size={18} />
                        ) : (
                          <Trash size={18} />
                        )}
                      </IconButton>
                    )}
                </div>
              </div>
            );
          })}
          {pendingInvites.map((i) => {
            const p = state.people.find((p) => p.id === i.personId)!;
            return (
              <div className="team-member-row pending-member-row" key={i.id}>
                <button
                  className="member-profile-link"
                  onClick={() => setPerson(p)}
                >
                  <Avatar person={p} size={46} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>Invitation waiting for a reply</small>
                  </span>
                </button>
                <Badge color="blue">Invited</Badge>
                {isMember && (
                  <IconButton
                    label={`Cancel invitation to ${p.name}`}
                    onClick={() =>
                      run({
                        type: "CANCEL_INVITATION",
                        invitationId: i.id,
                        actorId: me.id,
                      })
                    }
                  >
                    <Trash size={18} />
                  </IconButton>
                )}
              </div>
            );
          })}
          {isMember && !isPastTeam(state, team) && (
            <button
              className="invite-member-row"
              onClick={() => setInvite(true)}
            >
              <span>
                <Plus size={21} />
              </span>
              Bring someone new into the conversation
              <ArrowRight size={19} />
            </button>
          )}
        </details>
      </div>
      {invite && (
        <InviteModal
          team={team}
          person={invitePerson}
          onClose={() => {
            setInvite(false);
            setInvitePerson(undefined);
          }}
        />
      )}{" "}
      {person && (
        <PersonModal
          person={person}
          onClose={() => setPerson(null)}
          onInvite={
            isMember && !isPastTeam(state, team)
              ? (p) => {
                  setPerson(null);
                  setInvitePerson(p);
                  setInvite(true);
                }
              : undefined
          }
        />
      )}{" "}
      {apply && <ApplyModal event={event} onClose={() => setApply(false)} />}{" "}
      {reuse && (
        <CreateTeamModal reuse={team} onClose={() => setReuse(false)} />
      )}
      {remove && (
        <Modal
          title={remove === me.id ? "Leave this team?" : "Remove this member?"}
          description="Event admission stays unchanged. The team place becomes available for someone else."
          onClose={() => setRemove(null)}
          footer={
            <>
              <Button variant="text" onClick={() => setRemove(null)}>
                Keep member
              </Button>
              <Button
                onClick={async () => {
                  const result = await run({
                    type: "REMOVE_MEMBER",
                    teamId: team.id,
                    personId: remove,
                    actorId: me.id,
                  });
                  if (!result.error) {
                    setRemove(null);
                    if (remove === me.id) navigate("/teams");
                  }
                }}
              >
                {remove === me.id ? "Leave team" : "Remove member"}
              </Button>
            </>
          }
        >
          <div className="form-person">
            <Avatar person={state.people.find((p) => p.id === remove)!} />
            <strong>{state.people.find((p) => p.id === remove)?.name}</strong>
          </div>
        </Modal>
      )}
    </>
  );
}
