import { useEffect, useState } from "react";
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { calendarDays, dateFromIso, dateToIso, moveMonth } from "./calendar";
import { useFilterPopover } from "./filter-popover";

const fullDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const monthName = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

export function DateFilter({
  label,
  value,
  onChange,
  min: requestedMin = "",
  invalid = false,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const menu = useFilterPopover();
  const min = dateFromIso(requestedMin) ? requestedMin : "";
  const today = dateToIso(new Date());
  const [focused, setFocused] = useState(today);
  const [month, setMonth] = useState(new Date());
  const selected = dateFromIso(value);
  useEffect(() => {
    if (menu.open)
      menu.popup.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
        ?.focus({ preventScroll: true });
  }, [menu.open, focused, month, menu.popup]);

  function openCalendar() {
    const initial =
      selected && (!min || value >= min) ? value : min > today ? min : today;
    setFocused(initial);
    setMonth(dateFromIso(initial) ?? new Date());
    menu.show();
  }
  function choose(date: string) {
    onChange(date);
    menu.close(true);
  }
  function navigate(offset: number) {
    let next = moveMonth(dateFromIso(focused) ?? month, offset);
    if (min && dateToIso(next) < min) next = dateFromIso(min)!;
    setMonth(next);
    setFocused(dateToIso(next));
  }
  const previousMonth = moveMonth(month, -1);
  const previousLast = dateToIso(
    new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0, 12),
  );

  return (
    <div className="field filter-field">
      <span>{label}</span>
      <button
        type="button"
        ref={menu.trigger}
        className={`filter-control ${value ? "has-value" : ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={menu.open}
        aria-controls={menu.id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => (menu.open ? menu.close(true) : openCalendar())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openCalendar();
          }
        }}
      >
        <span>{selected ? shortDate.format(selected) : "Any date"}</span>
        <CalendarBlank size={18} aria-hidden="true" />
      </button>
      <div
        {...menu.popupProps}
        className="filter-popup calendar-popup"
        role="dialog"
        aria-label={`Choose ${label.toLowerCase()}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            menu.close(true);
            return;
          }
          const current = dateFromIso(
            (event.target as HTMLElement).dataset.date ?? "",
          );
          if (!current) return;
          let next = new Date(current);
          const offsets: Record<string, number> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -7,
            ArrowDown: 7,
          };
          if (event.key in offsets)
            next.setDate(next.getDate() + offsets[event.key]);
          else if (event.key === "Home")
            next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
          else if (event.key === "End")
            next.setDate(next.getDate() + 6 - ((next.getDay() + 6) % 7));
          else if (event.key === "PageUp" || event.key === "PageDown")
            next = moveMonth(next, event.key === "PageUp" ? -1 : 1);
          else return;
          event.preventDefault();
          if (min && dateToIso(next) < min) next = dateFromIso(min)!;
          setFocused(dateToIso(next));
          setMonth(next);
        }}
      >
        <div className="calendar-heading">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!!min && previousLast < min}
            onClick={() => navigate(-1)}
          >
            <CaretLeft size={18} aria-hidden="true" />
          </button>
          <strong aria-live="polite">{monthName.format(month)}</strong>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => navigate(1)}
          >
            <CaretRight size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-days" role="group" aria-label="Days">
          {calendarDays(month).map((day) => {
            const iso = dateToIso(day);
            return (
              <button
                key={iso}
                type="button"
                data-date={iso}
                className={`${day.getMonth() !== month.getMonth() ? "outside-month" : ""} ${iso === today ? "is-today" : ""}`}
                aria-label={fullDate.format(day)}
                aria-pressed={iso === value}
                aria-current={iso === today ? "date" : undefined}
                tabIndex={iso === focused ? 0 : -1}
                disabled={!!min && iso < min}
                onFocus={() => setFocused(iso)}
                onClick={() => choose(iso)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
        <div className="calendar-footer">
          <button type="button" disabled={!value} onClick={() => choose("")}>
            Clear date
          </button>
          <button
            type="button"
            disabled={!!min && today < min}
            onClick={() => choose(today)}
          >
            Today
          </button>
        </div>
      </div>
    </div>
  );
}
