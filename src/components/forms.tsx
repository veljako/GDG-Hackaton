import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PaperPlaneTilt,
  UsersThree,
  Plus,
  Check,
  LinkSimple,
  UserPlus,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDemo } from "../store";
import { admissionFor, isConnected, isPastTeam } from "../domain";
import { hasTeams } from "../discovery";
import type { Hackathon, Person, Role, Team } from "../types";
import {
  Modal,
  Field,
  Button,
  Avatar,
  Badge,
  Search,
  Empty,
  submitHandler,
} from "./ui";

export function ApplyModal({
  event,
  onClose,
}: {
  event: Hackathon;
  onClose: () => void;
}) {
  const { state, me, run } = useDemo();
  const navigate = useNavigate();
  const [choice, setChoice] = useState("solo");
  const teams = state.teams.filter(
    (t) => t.eventId === event.id && t.memberIds.includes(me.id),
  );
  const oldTeams = state.teams.filter(
    (t) => isPastTeam(state, t) && t.memberIds.includes(me.id),
  );
  return (
    <Modal
      title={`Apply to ${event.title}`}
      description={
        hasTeams(event)
          ? "Tell the organizers a little about yourself. You can bring a team or find your people after joining."
          : "Register individually to learn, connect and explore."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button form="apply-form" icon={<PaperPlaneTilt size={18} />}>
            {!hasTeams(event) && event.registration === "automatic"
              ? "Confirm registration"
              : "Send application"}
          </Button>
        </>
      }
    >
      <form
        id="apply-form"
        className="form-stack"
        onSubmit={submitHandler(async (data) => {
          const teamId = choice.startsWith("team:")
            ? choice.slice(5)
            : undefined;
          const role = data.get("role") as Role;
          const motivation = String(data.get("motivation"));
          if (choice === "new") {
            const result = await run({
              type: "CREATE_TEAM",
              eventId: event.id,
              personId: me.id,
              name: String(data.get("teamName")),
              description: "A new team, ready to build together.",
              skills: [],
              role,
              motivation,
            });
            if (result.error) return;
          } else if (choice.startsWith("reuse:")) {
            const result = await run({
              type: "REUSE_TEAM",
              teamId: choice.slice(6),
              eventId: event.id,
              personId: me.id,
              role,
              motivation,
            });
            if (result.error) return;
          } else {
            const result = await run({
              type: "SUBMIT_APPLICATION",
              eventId: event.id,
              personId: me.id,
              role,
              motivation,
              teamId,
            });
            if (result.error) return;
          }
          onClose();
          navigate("/activity");
        })}
      >
        <div className="form-person">
          <Avatar person={me} />
          <div>
            <strong>{me.name}</strong>
            <span>{me.title}</span>
          </div>
          <Badge color="blue">Your profile</Badge>
        </div>
        <Field label="I'd like to join as">
          <select name="role" defaultValue="Participant">
            {(["Participant", "Mentor", "Speaker", "Judge"] as Role[]).map(
              (r) => (
                <option key={r}>{r}</option>
              ),
            )}
          </select>
        </Field>
        {hasTeams(event) && (
          <Field label="How are you joining?">
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="solo">On my own · find a team later</option>
              <option value="new">With a new team</option>
              {teams.map((t) => (
                <option key={t.id} value={`team:${t.id}`}>
                  With {t.name}
                </option>
              ))}
              {oldTeams.map((t) => (
                <option key={t.id} value={`reuse:${t.id}`}>
                  Reunite {t.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {choice === "new" && (
          <Field label="Team name">
            <input
              name="teamName"
              required
              maxLength={45}
              placeholder="Give your team a name"
            />
          </Field>
        )}
        {choice.startsWith("reuse:") && (
          <p className="form-note">
            Your former teammates will each receive a fresh invitation. Their
            participation is confirmed after they accept and get approved.
          </p>
        )}
        <Field
          label={
            hasTeams(event)
              ? "What would you like to build or contribute?"
              : "What would you like to learn or explore?"
          }
          hint="A few sentences are enough."
        >
          <textarea
            name="motivation"
            required
            minLength={10}
            maxLength={1200}
            rows={3}
            placeholder="I'm interested in…"
          />
        </Field>
        <p className="form-note">
          {!hasTeams(event) && event.registration === "automatic"
            ? "Your place is confirmed immediately if capacity is available."
            : "Organizers review every application. You'll see your status in My activity."}
        </p>
      </form>
    </Modal>
  );
}
export function CreateTeamModal({
  eventId,
  onClose,
  reuse,
}: {
  eventId?: string;
  onClose: () => void;
  reuse?: Team;
}) {
  const { state, me, run } = useDemo();
  const navigate = useNavigate();
  const eligible = state.events.filter(
    (e) =>
      hasTeams(e) &&
      e.status === "open" &&
      !state.teams.some(
        (t) =>
          t.eventId === e.id &&
          !isPastTeam(state, t) &&
          t.memberIds.includes(me.id),
      ),
  );
  return (
    <Modal
      title={reuse ? `Bring ${reuse.name} back` : "A new team starts with you"}
      description={
        reuse
          ? "Choose your next event. Everyone gets a fresh invitation."
          : "Pick an event, give your team a name, and invite your people."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="team-form"
            disabled={!eligible.length}
            icon={<Plus size={18} />}
          >
            {reuse ? "Reunite team" : "Create team"}
          </Button>
        </>
      }
    >
      {eligible.length ? (
        <form
          id="team-form"
          className="form-stack"
          onSubmit={submitHandler(async (data) => {
            const action = reuse
              ? {
                  type: "REUSE_TEAM" as const,
                  teamId: reuse.id,
                  eventId: String(data.get("event")),
                  personId: me.id,
                }
              : {
                  type: "CREATE_TEAM" as const,
                  eventId: String(data.get("event")),
                  personId: me.id,
                  name: String(data.get("name")),
                  description: String(data.get("description")),
                  skills: String(data.get("skills"))
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                };
            const result = await run(action);
            if (!result.error && result.createdId) {
              onClose();
              navigate(`/teams/${result.createdId}`);
            }
          })}
        >
          <Field label="Hackathon">
            <select
              name="event"
              defaultValue={
                eventId && eligible.some((e) => e.id === eventId)
                  ? eventId
                  : eligible[0].id
              }
            >
              {eligible.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </Field>
          {!reuse && (
            <>
              <Field label="Team name">
                <input
                  name="name"
                  required
                  maxLength={45}
                  placeholder="e.g. The Sunday Builders"
                />
              </Field>
              <Field label="What brings you together?">
                <textarea
                  name="description"
                  required
                  maxLength={300}
                  rows={3}
                  placeholder="Your idea, interests, or what you'd like to explore."
                />
              </Field>
              <Field
                label="Skills you're looking for"
                hint="Separate skills with commas."
              >
                <input name="skills" placeholder="Design, Python, frontend" />
              </Field>
            </>
          )}
          {reuse && (
            <div className="reuse-members">
              {reuse.memberIds
                .map((id) => state.people.find((p) => p.id === id)!)
                .map((p) => (
                  <div className="person-mini" key={p.id}>
                    <Avatar person={p} />
                    <span>{p.name}</span>
                    {p.id === me.id ? (
                      <Badge color="blue">You</Badge>
                    ) : (
                      <Badge>Will be invited</Badge>
                    )}
                  </div>
                ))}
            </div>
          )}
        </form>
      ) : (
        <Empty
          title="You're already on a team"
          description="You have a team for every open event. Explore those teams or publish another event in organizer view."
        />
      )}
    </Modal>
  );
}
export function InviteModal({
  team: initialTeam,
  person: initialPerson,
  onClose,
}: {
  team?: Team;
  person?: Person;
  onClose: () => void;
}) {
  const { state, me, run } = useDemo();
  const [query, setQuery] = useState("");
  const teams = state.teams.filter(
    (t) => !isPastTeam(state, t) && t.memberIds.includes(me.id),
  );
  const [teamId, setTeamId] = useState(initialTeam?.id ?? teams[0]?.id ?? "");
  const team = state.teams.find((t) => t.id === teamId);
  const [personId, setPersonId] = useState(initialPerson?.id ?? "");
  const eligiblePeople = state.people.filter(
    (p) =>
      p.id !== me.id &&
      !team?.memberIds.includes(p.id) &&
      !state.teams.some(
        (t) =>
          t.eventId === team?.eventId &&
          t.id !== teamId &&
          t.memberIds.includes(p.id),
      ) &&
      !state.invitations.some(
        (i) =>
          i.teamId === teamId && i.personId === p.id && i.status === "pending",
      ),
  );
  const candidates = eligiblePeople.filter((p) =>
    `${p.name} ${p.skills.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Modal
      title="Good teams start with an invitation"
      description="Invite a connection or meet someone new. People who aren't admitted yet can accept and apply."
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!team || !eligiblePeople.some((p) => p.id === personId)}
            icon={<PaperPlaneTilt size={18} />}
            onClick={async () => {
              if (!team) return;
              const result = await run({
                type: "INVITE_PERSON",
                teamId: team.id,
                personId,
                fromId: me.id,
              });
              if (!result.error) onClose();
            }}
          >
            Send invitation
          </Button>
        </>
      }
    >
      {!teams.length ? (
        <Empty
          title="Create a team first"
          description="Once you have a team, you can invite any profile from the community."
        />
      ) : (
        <div className="form-stack">
          <Field label="Invite to">
            <select
              aria-label="Invite to team"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setPersonId(initialPerson?.id ?? "");
              }}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ·{" "}
                  {state.events.find((e) => e.id === t.eventId)?.title}
                </option>
              ))}
            </select>
          </Field>
          <Search
            value={query}
            onChange={setQuery}
            placeholder="Find someone by name or skill"
            label="Find an invitee"
          />
          <div className="invite-list">
            {candidates.length ? (
              candidates.map((p) => {
                const approved =
                  admissionFor(state, teamId ? team!.eventId : "", p.id)
                    ?.status === "accepted";
                return (
                  <button
                    key={p.id}
                    className={`invite-choice ${personId === p.id ? "selected" : ""}`}
                    onClick={() => setPersonId(p.id)}
                  >
                    <Avatar person={p} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.title}</small>
                    </span>
                    <Badge color={approved ? "green" : "neutral"}>
                      {approved
                        ? "Accepted"
                        : isConnected(state, me.id, p.id)
                          ? "Connection"
                          : "Community"}
                    </Badge>
                    <span className="selection-circle">
                      {personId === p.id && <Check size={14} weight="bold" />}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="muted">
                No matching profiles. Try another name or skill.
              </p>
            )}
          </div>
          {team && (
            <button
              className="copy-link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}${window.location.pathname}#/teams/${team.id}`,
                  );
                  toast.success("Local demo team link copied");
                } catch {
                  toast.error(
                    "Copy unavailable. Use the team URL in your address bar.",
                  );
                }
              }}
            >
              <LinkSimple size={18} />
              Copy local team link
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
export function PersonModal({
  person,
  onClose,
  onInvite,
}: {
  person: Person;
  onClose: () => void;
  onInvite?: (p: Person) => void;
}) {
  const { state, me, run } = useDemo();
  const connected = isConnected(state, me.id, person.id);
  return (
    <Modal
      title="Community profile"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Close
          </Button>
          {person.id !== me.id && (
            <Button
              variant="outlined"
              icon={<UserPlus size={18} />}
              onClick={() =>
                run({
                  type: "TOGGLE_CONNECTION",
                  personId: me.id,
                  otherId: person.id,
                })
              }
            >
              {connected ? "Connected" : "Connect"}
            </Button>
          )}
          {onInvite && person.id !== me.id && (
            <Button
              icon={<UsersThree size={18} />}
              onClick={() => onInvite(person)}
            >
              Invite to team
            </Button>
          )}
        </>
      }
    >
      <div className={`profile-cover cover-${person.color}`}>
        <span className="cover-circle" />
        <span className="cover-pill" />
        <span className="cover-triangle" />
      </div>
      <div className="person-profile-header">
        <Avatar person={person} size={84} />
        <div>
          <h2>{person.name}</h2>
          <p>{person.title}</p>
        </div>
        {person.lookingForTeam && (
          <Badge color="green" dot>
            Open to a team
          </Badge>
        )}
      </div>
      <p className="profile-bio">{person.bio}</p>
      <div className="profile-meta">
        <span>{person.city}</span>
        <span>{person.school}</span>
        <span>{person.experience}</span>
      </div>
      <h3 className="detail-label">What I bring</h3>
      <div className="skill-list">
        {person.skills.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      <h3 className="detail-label">Happy to join as</h3>
      <div className="skill-list">
        {person.roles.map((r) => (
          <Badge key={r} color="blue">
            {r}
          </Badge>
        ))}
      </div>
      <h3 className="detail-label">Things I'm curious about</h3>
      <p className="muted">{person.interests.join(", ")}</p>
    </Modal>
  );
}
