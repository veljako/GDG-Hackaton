import { useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { MatchingControls } from "../components/MatchingControls";
import type { SemanticResponse } from "../backend";
import { useDemo } from "../store";
import { eventKinds, formats, searchEvents, kindLabel } from "../discovery";
import { EventCard } from "../components/events";
import { PageTitle, Search, Field, Button, Empty } from "../components/ui";
import "../discovery.css";
import { Pagination, usePagination } from "../components/pagination";

export default function Events() {
  const { state } = useDemo();
  const [params, setParams] = useSearchParams();
  const pendingParams = useRef(params);
  useEffect(() => {
    pendingParams.current = params;
  }, [params]);
  const commitParams = (next: URLSearchParams) => {
    pendingParams.current = next;
    setParams(next, { replace: true });
  };
  const get = (key: string) => params.get(key) ?? "";
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(pendingParams.current);
    if (value) next.set(key, value);
    else next.delete(key);
    commitParams(next);
  };
  const personal = get("view") === "for-you";
  const [semantic, setSemantic] = useState<{
    key: string;
    result: SemanticResponse;
  } | null>(null);
  const semanticKey = params.toString();
  const matches = new Map(
    (state.recommendations ?? []).map((r) => [r.eventId, r]),
  );
  const found = searchEvents(state, {
    q: get("q"),
    kind: get("kind"),
    topic: get("topic"),
    city: get("city"),
    format: get("format"),
    from: get("from"),
    to: get("to"),
    available: get("available") === "1",
    past: get("past") === "1",
  });
  const structured = personal
    ? found
        .filter((e) => matches.has(e.id))
        .sort(
          (a, b) =>
            (matches.get(b.id)?.score ?? 0) - (matches.get(a.id)?.score ?? 0),
        )
    : found;
  const events =
    semantic?.key === semanticKey
      ? semantic.result.results.flatMap((r) =>
          state.events.filter((e) => e.id === r.eventId),
        )
      : structured;
  const topics = [
    ...new Set(
      state.events.filter((e) => e.status !== "draft").flatMap((e) => e.tags),
    ),
  ].sort();
  const invalidDates = !!get("from") && !!get("to") && get("from") > get("to");
  const pagination = usePagination(events, params.toString());
  return (
    <>
      <PageTitle
        title="Find your next thing."
        description="Conferences, meetups, hackathons and festivals."
      />
      <div className="tabs" aria-label="Event discovery">
        <button aria-pressed={!personal} onClick={() => change("view", "")}>
          All events
        </button>
        <button
          aria-pressed={personal}
          onClick={() => change("view", "for-you")}
        >
          For you
        </button>
      </div>
      <MatchingControls
        route={personal ? "recommendations" : "search"}
        input={{
          query: get("q"),
          filters: {
            kind: get("kind"),
            topic: get("topic"),
            city: get("city"),
            format: get("format"),
            from: get("from"),
            to: get("to"),
            available: get("available") === "1",
            past: get("past") === "1",
          },
        }}
        onResults={(result) => setSemantic({ key: semanticKey, result })}
      />
      <section
        className="panel event-search-panel"
        aria-label="Advanced event search"
      >
        <Search
          value={get("q")}
          onChange={(q) => change("q", q)}
          placeholder="Search topics, organizations or events"
          label="Search events"
        />
        <details
          open={
            [
              "kind",
              "topic",
              "city",
              "format",
              "from",
              "to",
              "available",
              "past",
            ].some((k) => !!get(k)) || undefined
          }
        >
          <summary>Advanced filters</summary>
          <div className="event-search-fields">
            <Field label="Event type">
              <select
                value={get("kind")}
                onChange={(e) => change("kind", e.target.value)}
              >
                <option value="">All types</option>
                {eventKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabel({ kind })}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Topic">
              <select
                value={get("topic")}
                onChange={(e) => change("topic", e.target.value)}
              >
                <option value="">All topics</option>
                {topics.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="City">
              <input
                value={get("city")}
                placeholder="Any city"
                onChange={(e) => change("city", e.target.value)}
              />
            </Field>
            <Field label="Format">
              <select
                value={get("format")}
                onChange={(e) => change("format", e.target.value)}
              >
                <option value="">All formats</option>
                {formats.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="From date">
              <input
                type="date"
                value={get("from")}
                onChange={(e) => change("from", e.target.value)}
              />
            </Field>
            <Field label="To date">
              <input
                type="date"
                value={get("to")}
                min={get("from") || undefined}
                onChange={(e) => change("to", e.target.value)}
              />
            </Field>
          </div>
          <div className="event-search-options">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={get("available") === "1"}
                onChange={(e) =>
                  change("available", e.target.checked ? "1" : "")
                }
              />
              <span>Available places only</span>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={get("past") === "1"}
                onChange={(e) => change("past", e.target.checked ? "1" : "")}
              />
              <span>Past events</span>
            </label>
          </div>
        </details>
        {[...params.keys()].some((k) => k !== "view") && (
          <Button
            variant="text"
            onClick={() =>
              commitParams(
                new URLSearchParams(personal ? { view: "for-you" } : {}),
              )
            }
          >
            Clear filters
          </Button>
        )}
        {invalidDates && (
          <p role="status" className="field-error">
            The end of your search range must be after the start.
          </p>
        )}
      </section>
      {personal && (
        <p className="recommendation-intro">
          Matched to your interests, skills and goals.{" "}
          <a href="#/profile">Tune your profile</a>
        </p>
      )}
      <div className="results-line">
        <span role="status">
          {invalidDates ? 0 : events.length}{" "}
          {events.length === 1 && !invalidDates ? "event" : "events"} to explore
        </span>
      </div>
      {!invalidDates && events.length ? (
        <div className="events-grid discover-events">
          {pagination.items.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      ) : (
        <Empty
          title={
            personal
              ? "Let’s find your next opportunity"
              : "No events match these filters"
          }
          description={
            personal
              ? "Add interests, skills and goals to your profile, or explore all events. A match is a suggestion, not an entry requirement."
              : "Try a broader topic, city or date range."
          }
          action={
            <Button
              variant="tonal"
              onClick={() => commitParams(new URLSearchParams())}
            >
              Explore all events
            </Button>
          }
        />
      )}
      {!invalidDates && <Pagination {...pagination} />}
    </>
  );
}
