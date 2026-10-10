import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  UsersThree,
  CalendarBlank,
  EnvelopeSimple,
} from "@phosphor-icons/react";
import { useDemo } from "../store";
import { teamStatus, isPastTeam } from "../domain";
import { Button, Avatar, SectionTitle, TextLink } from "../components/ui";
import { TeamStatusBadge } from "../components/visuals";
import { EventCard } from "../components/events";
import { BrandGeometry } from "../components/playful";

export default function Home() {
  const { state, me } = useDemo();
  const navigate = useNavigate();
  const ownTeams = state.teams.filter(
    (t) => !isPastTeam(state, t) && t.memberIds.includes(me.id),
  );
  const team =
    ownTeams.find((t) => teamStatus(state, t) === "confirmed") ?? ownTeams[0];
  const recommended = (state.recommendations ?? []).flatMap((r) => {
    const event = state.events.find(
      (e) => e.id === r.eventId && e.status === "open",
    );
    return event ? [event] : [];
  });
  const upcoming = [
    ...recommended,
    ...state.events.filter(
      (e) => e.status === "open" && !recommended.some((r) => r.id === e.id),
    ),
  ].slice(0, 2);
  const applications = state.applications.filter((a) => a.personId === me.id);
  const invites = state.invitations.filter(
    (i) => i.personId === me.id && i.status === "pending",
  );
  return (
    <div className="home-page compact-home">
      <div className="welcome-line">
        <h1>
          Hey, {me.name.split(" ")[0]}
          <span className="welcome-dot" />
        </h1>
        <TextLink onClick={() => navigate("/profile")}>Your profile</TextLink>
      </div>
      <section className="bold-hero">
        <div className="bold-hero-copy">
          <h2>
            Big ideas.
            <br />
            Your kind of people.
          </h2>
          <p>Find an event. Meet your crew. Make it happen.</p>
          <Button
            onClick={() => navigate("/events")}
            icon={<ArrowUpRight size={19} />}
          >
            Explore events
          </Button>
        </div>
        <BrandGeometry />
      </section>
      <div className="home-workspace">
        <section className="home-picks">
          <SectionTitle
            title={recommended.length ? "Picked for you" : "Coming up"}
            action={
              <TextLink onClick={() => navigate("/events?view=for-you")}>
                View events
              </TextLink>
            }
          />
          <div className="events-grid dashboard-events">
            {upcoming.map((e) => (
              <EventCard event={e} key={e.id} />
            ))}
          </div>
        </section>
        <section className="home-team">
          <SectionTitle
            title="Your crew"
            action={
              <TextLink onClick={() => navigate("/teams")}>Teams</TextLink>
            }
          />
          <div className="crew-card">
            {team ? (
              <>
                <TeamStatusBadge team={team} />
                <h3>{team.name}</h3>
                <p>{state.events.find((e) => e.id === team.eventId)?.title}</p>
                <div className="crew-members">
                  {team.memberIds.slice(0, 5).map((id) => {
                    const person = state.people.find((p) => p.id === id);
                    return person ? (
                      <button
                        key={id}
                        aria-label={`Open ${team.name} with ${person.name}`}
                        onClick={() => navigate(`/teams/${team.id}`)}
                      >
                        <Avatar person={person} size={38} />
                      </button>
                    ) : null;
                  })}
                  <span>{team.memberIds.length} members</span>
                </div>
                <Button
                  variant="outlined"
                  onClick={() => navigate(`/teams/${team.id}`)}
                  icon={<ArrowRight size={17} />}
                >
                  Open team space
                </Button>
              </>
            ) : (
              <>
                <UsersThree size={36} />
                <h3>Make room for your people.</h3>
                <p>Join a team or start your own.</p>
                <Button variant="outlined" onClick={() => navigate("/teams")}>
                  Find a team
                </Button>
              </>
            )}
          </div>
        </section>
      </div>
      <div className="quick-actions">
        <button onClick={() => navigate("/activity")}>
          <CalendarBlank size={21} />
          <strong>{applications.length}</strong>
          <span>Applications</span>
          <ArrowUpRight size={17} />
        </button>
        <button onClick={() => navigate("/activity")}>
          <EnvelopeSimple size={21} />
          <strong>{invites.length}</strong>
          <span>Invitations</span>
          <ArrowUpRight size={17} />
        </button>
        <button onClick={() => navigate("/people")}>
          <UsersThree size={21} />
          <span>Meet the community</span>
          <ArrowUpRight size={17} />
        </button>
      </div>
    </div>
  );
}
