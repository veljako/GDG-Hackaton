import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  UserPlus,
  Check,
  Plus,
  MapPin,
  ArrowUpRight,
} from "@phosphor-icons/react";
import { useDemo } from "../store";
import { admissionFor, isConnected } from "../domain";
import {
  PageTitle,
  Search,
  Chips,
  Avatar,
  Badge,
  Button,
  Empty,
} from "../components/ui";
import { InviteModal, PersonModal } from "../components/forms";
import type { Person } from "../types";
import { Pagination, usePagination } from "../components/pagination";

export default function People() {
  const { state, me, run } = useDemo();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [filter, setFilter] = useState("Everyone");
  const [eventId, setEventId] = useState("gdg-belgrade");
  const [person, setPerson] = useState<Person | null>(null);
  const [invite, setInvite] = useState<Person | null>(null);
  useEffect(() => setQuery(params.get("q") ?? ""), [params]);
  const people = state.people.filter(
    (p) =>
      p.id !== me.id &&
      `${p.name} ${p.title} ${p.skills.join(" ")} ${p.city}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "Looking for a team"
        ? p.lookingForTeam
        : filter === "Accepted participants"
          ? admissionFor(state, eventId, p.id)?.status === "accepted" &&
            p.lookingForTeam
          : filter === "Mentors"
            ? p.roles.includes("Mentor")
            : filter === "Connections"
              ? isConnected(state, me.id, p.id)
              : true),
  );
  const pagination = usePagination(people, `${query}-${filter}-${eventId}`);
  return (
    <>
      <PageTitle
        title="Find your people."
        description="Your next teammate, mentor or friend."
      />
      <div className="people-toolbar">
        <Search
          value={query}
          onChange={setQuery}
          placeholder="Search people, skills, or cities"
          label="Search community profiles"
        />
        {filter === "Accepted participants" && (
          <label className="inline-select">
            <span>Hackathon</span>
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              aria-label="People hackathon filter"
            >
              {state.events
                .filter((e) => e.status === "open")
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <Chips
        values={[
          "Everyone",
          "Looking for a team",
          "Accepted participants",
          "Mentors",
          "Connections",
        ]}
        active={filter}
        onChange={setFilter}
      />
      <div className="results-line">
        <span>
          {people.length} {people.length === 1 ? "person" : "people"} to meet
        </span>
      </div>
      {people.length ? (
        <div className="people-grid">
          {pagination.items.map((p) => {
            const connected = isConnected(state, me.id, p.id);
            return (
              <article className="person-card" key={p.id}>
                <div className={`person-card-accent color-${p.color}`} />
                <div className="person-card-top">
                  <Avatar person={p} size={38} shaped />
                  {p.lookingForTeam ? (
                    <Badge color="green" dot>
                      Open to a team
                    </Badge>
                  ) : (
                    <Badge color="blue">Happy to help</Badge>
                  )}
                </div>
                <button
                  className="person-card-name"
                  onClick={() => setPerson(p)}
                >
                  <h2>{p.name}</h2>
                  <ArrowUpRight size={18} />
                </button>
                <p className="person-title">{p.title}</p>
                <span className="person-location">
                  <MapPin size={15} />
                  {p.city}
                </span>
                <div className="skill-list">
                  {p.skills.slice(0, 3).map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
                <div className="person-card-actions">
                  <button
                    className={`connect-button ${connected ? "is-connected" : ""}`}
                    aria-pressed={connected}
                    onClick={() =>
                      run({
                        type: "TOGGLE_CONNECTION",
                        personId: me.id,
                        otherId: p.id,
                      })
                    }
                  >
                    {connected ? <Check size={17} /> : <UserPlus size={17} />}
                    {connected ? "Connected" : "Connect"}
                  </button>
                  <Button
                    variant="text"
                    icon={<Plus size={17} />}
                    onClick={() => setInvite(p)}
                  >
                    Invite
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title="A different search might spark something"
          description="Try another name, skill, or community filter."
          action={
            <Button
              variant="tonal"
              onClick={async () => {
                setQuery("");
                setFilter("Everyone");
              }}
            >
              Show everyone
            </Button>
          }
        />
      )}
      <Pagination {...pagination} />
      {person && (
        <PersonModal
          person={person}
          onClose={() => setPerson(null)}
          onInvite={(p) => {
            setPerson(null);
            setInvite(p);
          }}
        />
      )}{" "}
      {invite && (
        <InviteModal person={invite} onClose={() => setInvite(null)} />
      )}
    </>
  );
}
