import { useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { CaretDown, Check, SlidersHorizontal, X } from "@phosphor-icons/react";
import { MatchingControls } from "../components/MatchingControls";
import type { SemanticResponse } from "../backend";
import { useDemo } from "../store";
import { eventKinds, formats, searchEvents, kindLabel } from "../discovery";
import { EventCard } from "../components/events";
import { PageTitle, Search, Field, Button, Empty } from "../components/ui";
import { CustomSelect } from "../components/CustomSelect";
import { DateFilter } from "../components/DateFilter";
import { dateFromIso } from "../components/calendar";
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
  const filterLabels: Record<string, string> = {
    kind: "Type",
    topic: "Topic",
    city: "City",
    format: "Format",
    from: "From",
    to: "To",
    available: "Available places only",
    past: "Past events",
  };
  const activeFilters = Object.keys(filterLabels).filter((key) => !!get(key));
  const [filtersOpen, setFiltersOpen] = useState(
    () => activeFilters.length > 0,
  );
  function clearFilters() {
    commitParams(new URLSearchParams(personal ? { view: "for-you" } : {}));
  }
  function filterValue(key: string) {
    if (key === "kind")
      return kindLabel({ kind: get(key) as (typeof eventKinds)[number] });
    if (key === "from" || key === "to") {
      const date = dateFromIso(get(key));
      return date
        ? new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(date)
        : get(key);
    }
    return get(key);
  }
  const pagination = usePagination(events, params.toString());
  return (
    <>
      <PageTitle
        title="Find your next thing."
        description="Conferences, meetups, workshops, hackathons and festivals."
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
        <div className="event-filter-heading">
          <button
            type="button"
            className="filter-disclosure"
            aria-expanded={filtersOpen}
            aria-controls="event-filter-fields"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            Filters
            {!!activeFilters.length && (
              <span className="filter-count">{activeFilters.length}</span>
            )}
            <CaretDown size={16} aria-hidden="true" />
          </button>
          {(activeFilters.length > 0 || get("q")) && (
            <button
              type="button"
              className="clear-filters"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>
        <div
          id="event-filter-fields"
          className="event-filter-body"
          hidden={!filtersOpen}
        >
          <div className="event-search-fields">
            <CustomSelect
              label="Event type"
              value={get("kind")}
              onChange={(value) => change("kind", value)}
              options={[
                { value: "", label: "All types" },
                ...eventKinds.map((kind) => ({
                  value: kind,
                  label: kindLabel({ kind }),
                })),
              ]}
            />
            <CustomSelect
              label="Topic"
              value={get("topic")}
              onChange={(value) => change("topic", value)}
              options={[
                { value: "", label: "All topics" },
                ...topics.map((topic) => ({ value: topic, label: topic })),
              ]}
            />
            <Field label="City">
              <input
                value={get("city")}
                placeholder="Any city"
                onChange={(e) => change("city", e.target.value)}
              />
            </Field>
            <CustomSelect
              label="Format"
              value={get("format")}
              onChange={(value) => change("format", value)}
              options={[
                { value: "", label: "All formats" },
                ...formats.map((format) => ({ value: format, label: format })),
              ]}
            />
            <DateFilter
              label="From date"
              value={get("from")}
              onChange={(value) => change("from", value)}
              invalid={invalidDates}
              describedBy={invalidDates ? "event-date-error" : undefined}
            />
            <DateFilter
              label="To date"
              value={get("to")}
              min={get("from")}
              onChange={(value) => change("to", value)}
              invalid={invalidDates}
              describedBy={invalidDates ? "event-date-error" : undefined}
            />
          </div>
          <div className="event-search-options">
            {["available", "past"].map((key) => (
              <button
                key={key}
                type="button"
                className={`chip ${get(key) === "1" ? "active" : ""}`}
                aria-pressed={get(key) === "1"}
                onClick={() => change(key, get(key) === "1" ? "" : "1")}
              >
                <span className="filter-check" aria-hidden="true">
                  {get(key) === "1" && <Check size={13} weight="bold" />}
                </span>
                {filterLabels[key]}
              </button>
            ))}
          </div>
        </div>
        {!!activeFilters.length && (
          <div className="active-filter-list" aria-label="Active filters">
            {activeFilters.map((key) => (
              <button
                type="button"
                key={key}
                className="active-filter"
                aria-label={`Remove ${filterLabels[key]} filter`}
                onClick={() => change(key, "")}
              >
                <span>
                  {filterLabels[key]}
                  {key !== "available" && key !== "past" && (
                    <strong>: {filterValue(key)}</strong>
                  )}
                </span>
                <X size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        {invalidDates && (
          <p role="status" id="event-date-error" className="field-error">
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
              ? "No suitable event right now"
              : "No events match these filters"
          }
          description={
            personal
              ? "Explore all events, adjust your filters, or update your interests and learning goals."
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
