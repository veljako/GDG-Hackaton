import {
  createElement,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
} from "react";
import type { ReactNode, FormEvent } from "react";
import { X, ArrowRight, MagnifyingGlass, Sparkle } from "@phosphor-icons/react";
import type { MdDialog } from "@material/web/dialog/dialog";
import { useReducedMotion } from "motion/react";
import type { Color, Person } from "../types";
import { useBackendBusy } from "../store";

export function Button({
  children,
  icon,
  variant = "filled",
  onClick,
  disabled,
  form,
  className = "",
}: {
  children: ReactNode;
  icon?: ReactNode;
  variant?: "filled" | "tonal" | "outlined" | "text";
  onClick?: () => void;
  disabled?: boolean;
  form?: string;
  className?: string;
}) {
  const saving = useBackendBusy();
  const tag =
    variant === "tonal" ? "md-filled-tonal-button" : `md-${variant}-button`;
  return createElement(
    tag,
    {
      className: `md-button ${className}`,
      disabled: disabled || saving,
      type: "button",
      onClick: () => {
        if (disabled || saving) return;
        if (form)
          (
            document.getElementById(form) as HTMLFormElement | null
          )?.requestSubmit();
        else onClick?.();
      },
    },
    icon ? <span slot="icon">{icon}</span> : null,
    children,
  );
}
export function IconButton({
  children,
  label,
  onClick,
  className = "",
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Avatar({
  person,
  size = 40,
  shaped = false,
}: {
  person: Person;
  size?: number;
  shaped?: boolean;
}) {
  return (
    <span
      className={`avatar ${shaped ? `shaped shape-${person.color}` : ""}`}
      style={{
        width: size,
        height: size,
        background: `var(--${person.color}-soft)`,
      }}
    >
      {person.avatar && (
        <img
          src={person.avatar}
          alt={person.name}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <span className="avatar-fallback" aria-hidden="true">
        {person.name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")}
      </span>
    </span>
  );
}
export function Badge({
  children,
  color = "neutral",
  dot = false,
}: {
  children: ReactNode;
  color?: Color | "neutral";
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${color}`}>
      {dot && <span className="status-dot" />}
      {children}
    </span>
  );
}
export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<MdDialog>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const reduce = useReducedMotion();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const closed = () => closeRef.current();
    dialog.addEventListener("closed", closed);
    void dialog.show();
    return () => {
      dialog.removeEventListener("closed", closed);
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createElement(
    "md-dialog",
    {
      ref,
      className: `gevents-dialog ${wide ? "dialog-wide" : ""}`,
      quick: !!reduce,
      "aria-label": title,
    },
    <div slot="headline" className="dialog-headline">
      <h2>{title}</h2>
      <IconButton label="Close dialog" onClick={onClose}>
        <X size={22} />
      </IconButton>
    </div>,
    <div slot="content" className="dialog-content">
      {description && <p className="dialog-description">{description}</p>}
      {children}
    </div>,
    <div slot="actions" className="dialog-actions">
      {footer ?? (
        <Button variant="text" onClick={onClose}>
          Close
        </Button>
      )}
    </div>,
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const hintId = useId();
  const control = isValidElement<{
    "aria-label"?: string;
    "aria-describedby"?: string;
  }>(children)
    ? cloneElement(children, {
        "aria-label": children.props["aria-label"] ?? label,
        "aria-describedby": hint ? hintId : children.props["aria-describedby"],
      })
    : children;
  return (
    <label className="field">
      <span>{label}</span>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}
export function Search({
  value,
  onChange,
  placeholder = "Search",
  label = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="search-field">
      <MagnifyingGlass size={20} />
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X size={16} />
        </button>
      )}
    </label>
  );
}
export function Chips({
  values,
  active,
  onChange,
}: {
  values: string[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="chips" aria-label="Filter">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={`chip ${active === value ? "active" : ""}`}
          aria-pressed={active === value}
          onClick={() => onChange(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Sparkle size={30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="text-link" onClick={onClick}>
      {children}
      <ArrowRight size={17} />
    </button>
  );
}
export function submitHandler(callback: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    callback(new FormData(event.currentTarget));
  };
}
export function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  return new Intl.DateTimeFormat("en-GB", options).format(
    new Date(`${date}T12:00:00`),
  );
}
