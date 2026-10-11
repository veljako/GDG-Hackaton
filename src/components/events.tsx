import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarBlank,
  MapPin,
  ArrowUpRight,
  BookmarkSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Hackathon } from "../types";
import { useDemo } from "../store";
import { admissionFor } from "../domain";
import { kindLabel } from "../discovery";
import "../discovery.css";
import { Badge, IconButton, formatDate } from "./ui";
import { migrateStorageKey } from "../storage";

export function EventCard({ event }: { event: Hackathon }) {
  const navigate = useNavigate();
  const { state, me } = useDemo();
  const key = `gevents-saved-${me.id}`;
  const [saved, setSaved] = useState(() => {
    try {
      return (
        JSON.parse(
          migrateStorageKey(localStorage, key, `gdev-saved-${me.id}`) ?? "[]",
        ) as string[]
      ).includes(event.id);
    } catch {
      return false;
    }
  });
  const admission = admissionFor(state, event.id, me.id);
  const match = state.recommendations?.find((r) => r.eventId === event.id);
  function toggleSaved() {
    try {
      const ids = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
      localStorage.setItem(
        key,
        JSON.stringify(
          saved
            ? ids.filter((id) => id !== event.id)
            : [...new Set([...ids, event.id])],
        ),
      );
      setSaved(!saved);
      toast.success(
        saved ? "Event removed from saved" : "Event saved to your browser",
      );
    } catch {
      toast.error("Could not save this event in your browser.");
    }
  }
  return (
    <article className="event-card">
      <button
        className={`event-art-button event-symbol symbol-${event.color}`}
        onClick={() => navigate(`/events/${event.id}`)}
        aria-label={`View ${event.title}`}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          {event.color === "blue" ? (
            <path d="M50 3C50 36 36 50 3 50c33 0 47 14 47 47 0-33 14-47 47-47-33 0-47-14-47-47Z" />
          ) : event.color === "green" ? (
            <path d="M5 55a45 45 0 0 1 90 0v35H5Z" />
          ) : event.color === "yellow" ? (
            <circle
              cx="50"
              cy="50"
              r="34"
              fill="none"
              stroke="currentColor"
              strokeWidth="20"
            />
          ) : (
            <path d="m50 8 45 80H5Z" />
          )}
        </svg>
      </button>
      <div className="event-card-body">
        <div className="event-kind-label">{kindLabel(event)}</div>
        <div className="event-card-top">
          <Badge
            color={
              event.status === "past"
                ? "neutral"
                : admission?.status === "accepted"
                  ? "green"
                  : event.color
            }
          >
            {event.status === "past"
              ? "Past event"
              : admission?.status === "accepted"
                ? "You're accepted"
                : admission?.status === "pending"
                  ? "Applied"
                  : event.format ?? "Format to be confirmed"}
          </Badge>
          <IconButton
            label={saved ? `Unsave ${event.title}` : `Save ${event.title}`}
            onClick={toggleSaved}
          >
            <BookmarkSimple size={19} weight={saved ? "fill" : "regular"} />
          </IconButton>
        </div>
        <button
          className="card-title-button"
          onClick={() => navigate(`/events/${event.id}`)}
        >
          <h3>{event.title}</h3>
          <ArrowUpRight size={21} />
        </button>
        <p>{event.theme}</p>
        <div className="event-card-meta">
          <span>
            <CalendarBlank size={16} />
            {formatDate(event.date, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          <span>
            <MapPin size={16} />
            {event.location}
          </span>
        </div>
        {match && (
          <details className="match-reasons">
            <summary>Why this fits you</summary>
            <ul>
              {match.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}
