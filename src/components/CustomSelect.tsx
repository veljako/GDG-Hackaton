import { useEffect, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { useFilterPopover } from "./filter-popover";

export type SelectOption = { value: string; label: string };

export function CustomSelect({
  label,
  value,
  onChange,
  options,
  hideLabel = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  hideLabel?: boolean;
}) {
  const menu = useFilterPopover();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const typed = useRef({ text: "", time: 0 });
  const selected = options.findIndex((option) => option.value === value);
  const [active, setActive] = useState(Math.max(0, selected));
  useEffect(() => {
    if (menu.open) {
      setActive(Math.max(0, selected));
      (optionRefs.current[Math.max(0, selected)] ?? menu.popup.current)?.focus({
        preventScroll: true,
      });
    }
  }, [menu.open, selected, menu.popup]);

  return (
    <div className="field filter-field">
      {!hideLabel && <span>{label}</span>}
      <button
        type="button"
        ref={menu.trigger}
        role="combobox"
        data-value={value}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={menu.open}
        aria-controls={menu.id}
        className={`filter-control ${value ? "has-value" : ""}`}
        onClick={menu.toggle}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            menu.show();
          }
        }}
        disabled={!options.length}
      >
        <span>{options[selected]?.label ?? "No options available"}</span>
        <CaretDown size={16} aria-hidden="true" />
      </button>
      <div
        {...menu.popupProps}
        className="filter-popup select-popup"
        role="listbox"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            menu.close(true);
            return;
          }
          const current = optionRefs.current.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          let next = current;
          if (event.key === "ArrowDown") next = (current + 1) % options.length;
          else if (event.key === "ArrowUp")
            next = (current - 1 + options.length) % options.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = options.length - 1;
          else if (
            event.key.length === 1 &&
            event.key !== " " &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const now = Date.now();
            typed.current.text =
              (now - typed.current.time < 700 ? typed.current.text : "") +
              event.key.toLowerCase();
            typed.current.time = now;
            next = options.findIndex((option) =>
              option.label.toLowerCase().startsWith(typed.current.text),
            );
          } else return;
          event.preventDefault();
          if (next >= 0) optionRefs.current[next]?.focus();
        }}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="option"
            data-value={option.value}
            aria-selected={option.value === value}
            tabIndex={index === active ? 0 : -1}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            onFocus={() => setActive(index)}
            onClick={() => {
              onChange(option.value);
              menu.close(true);
            }}
          >
            <span>{option.label}</span>
            {option.value === value && (
              <Check size={18} weight="bold" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
