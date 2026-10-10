import { motion, useReducedMotion } from "motion/react";
import { Plus, Check, ArrowUpRight } from "@phosphor-icons/react";
import { useDemo } from "../store";
import { memberState, teamStatus } from "../domain";
import { BRAND, organizerName } from "../config";
import { Avatar, Badge } from "./ui";
import type { Color, Hackathon, Person, Team } from "../types";

export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand-mark ${large ? "large" : ""}`} aria-hidden="true">
      <img src={BRAND.icon} alt="" />
    </span>
  );
}
export function EventArt({
  event,
  small = false,
}: {
  event: Hackathon;
  small?: boolean;
}) {
  return (
    <div
      className={`event-art art-${event.color} ${small ? "art-small" : ""}`}
      aria-hidden="true"
    >
      <div className="art-shape art-circle" />
      <div className="art-shape art-dome" />
      <div className="art-shape art-pill" />
      <div className="art-shape art-triangle" />
      <span className="art-word">
        {event.kind === "conference" ? (
          <>
            Ideas meet
            <br />
            opportunity.
          </>
        ) : event.kind === "meetup" ? (
          <>
            Learn.
            <br />
            Connect.
          </>
        ) : event.kind === "festival" ? (
          <>
            Science
            <br />
            for everyone.
          </>
        ) : event.id === "gdg-belgrade" ? (
          <>
            Build
            <br />
            together.
          </>
        ) : event.color === "green" ? (
          <>
            Make it
            <br />
            intelligent.
          </>
        ) : event.color === "yellow" ? (
          <>
            Design
            <br />
            for everyone.
          </>
        ) : (
          <>
            Ideas
            <br />
            in motion.
          </>
        )}
      </span>
      <span className="art-signature">
        <BrandMark />
        {organizerName(event.organizer)}
      </span>
      <ArrowUpRight className="art-arrow" size={27} />
    </div>
  );
}
const spots = [
  { x: 18, y: 23 },
  { x: 81, y: 23 },
  { x: 20, y: 79 },
  { x: 80, y: 79 },
  { x: 50, y: 8 },
  { x: 50, y: 91 },
];
export function TeamScene({
  team,
  onPerson,
  onInvite,
  compact = false,
}: {
  team: Team;
  onPerson?: (p: Person) => void;
  onInvite?: () => void;
  compact?: boolean;
}) {
  const { state } = useDemo();
  const event = state.events.find((e) => e.id === team.eventId)!;
  const reduce = useReducedMotion();
  const members = team.memberIds.map((id) => ({
    person: state.people.find((p) => p.id === id)!,
    status: memberState(state, team, id) as string,
  }));
  const invitations = state.invitations
    .filter(
      (i) =>
        i.teamId === team.id &&
        i.status === "pending" &&
        !team.memberIds.includes(i.personId),
    )
    .map((i) => ({
      person: state.people.find((p) => p.id === i.personId)!,
      status: "invited",
    }));
  const nodes = [...members, ...invitations];
  const count = Math.min(event.maxTeamSize, 6);
  const status = teamStatus(state, team);
  return (
    <div
      className={`team-scene ${compact ? "scene-compact" : ""}`}
      aria-label={`${team.name}, ${status}`}
    >
      <svg
        className="team-connections"
        viewBox="0 0 500 340"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {spots.slice(0, count).map((s, i) => (
          <path
            key={i}
            className={
              nodes[i]?.status === "accepted"
                ? "line-confirmed"
                : "line-pending"
            }
            d={`M250 170 Q${250 + (s.x - 50) * 2} ${170 + (s.y - 50) * 1.5} ${s.x * 5} ${s.y * 3.4}`}
          />
        ))}
      </svg>
      <div className="team-center">
        <BrandMark />
        <strong>{team.name}</strong>
        <span>
          {nodes.filter((n) => n.status === "accepted").length} /{" "}
          {event.maxTeamSize} confirmed
        </span>
        {status === "confirmed" && (
          <span className="team-center-check">
            <Check size={13} weight="bold" />
          </span>
        )}
      </div>
      {spots.slice(0, count).map((s, i) => {
        const node = nodes[i];
        return (
          <motion.div
            key={node?.person.id ?? `slot-${i}`}
            className="team-node"
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
            initial={
              reduce
                ? false
                : { opacity: 0, transform: "translate(-50%, -50%) scale(0.95)" }
            }
            animate={{
              opacity: 1,
              transform: "translate(-50%, -50%) scale(1)",
            }}
            transition={{
              duration: 0.24,
              delay: i * 0.035,
              ease: [0.23, 1, 0.32, 1],
            }}
          >
            {node ? (
              <button
                className={`person-node color-${node.person.color} ${node.status !== "accepted" ? "node-pending" : ""}`}
                onClick={() => onPerson?.(node.person)}
                aria-label={`View ${node.person.name}, ${node.status}`}
              >
                <span
                  className={`person-shape person-shape-${node.person.color}`}
                >
                  <Avatar person={node.person} size={compact ? 38 : 51} />
                  {node.status === "accepted" && (
                    <span className="node-check">
                      <Check size={10} weight="bold" />
                    </span>
                  )}
                </span>
                <strong>{node.person.name.split(" ")[0]}</strong>
                <small>
                  {node.status === "accepted"
                    ? node.person.title.split(" · ")[0]
                    : node.status === "invited"
                      ? "Invite sent"
                      : node.status === "rejected"
                        ? "Not admitted"
                        : "Awaiting approval"}
                </small>
              </button>
            ) : (
              <button
                className="empty-node"
                onClick={onInvite}
                disabled={!onInvite}
                aria-label={`Invite a person to ${team.name}`}
              >
                <span>
                  <Plus size={25} />
                </span>
                <strong>Open spot</strong>
                <small>Meet your next teammate</small>
              </button>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
export function TeamStatusBadge({ team }: { team: Team }) {
  const { state } = useDemo();
  const status = teamStatus(state, team);
  const colors: Record<string, Color | "neutral"> = {
    confirmed: "green",
    forming: "blue",
    pending: "yellow",
    archived: "neutral",
  };
  return (
    <Badge color={colors[status]} dot>
      {status === "confirmed"
        ? "Confirmed team"
        : status === "forming"
          ? "Finding teammates"
          : status === "pending"
            ? "Awaiting approval"
            : "Previous team"}
    </Badge>
  );
}
