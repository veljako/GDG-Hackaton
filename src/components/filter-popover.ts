import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, ToggleEvent } from "react";

// Native popovers render above scroll containers and dialogs without a portal.
export function useFilterPopover() {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});

  function close(restoreFocus = false) {
    popup.current?.hidePopover();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function show() {
    const button = trigger.current;
    const panel = popup.current;
    if (!button || !panel) return;
    panel.showPopover();
    const anchor = button.getBoundingClientRect();
    const width = Math.min(
      Math.max(anchor.width, panel.offsetWidth),
      innerWidth - 24,
    );
    const below = innerHeight - anchor.bottom - 12;
    const above = anchor.top - 12;
    const upwards = below < Math.min(panel.scrollHeight, 280) && above > below;
    const maxHeight = Math.max(80, upwards ? above - 8 : below - 8);
    const height = Math.min(panel.scrollHeight, maxHeight);
    setPosition({
      width,
      maxHeight,
      left: Math.max(12, Math.min(anchor.left, innerWidth - width - 12)),
      top: upwards ? anchor.top - height - 8 : anchor.bottom + 8,
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target))
        return;
      close();
    };
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  return {
    id,
    trigger,
    popup,
    open,
    show,
    close,
    toggle: () => (open ? close(true) : show()),
    popupProps: {
      id,
      ref: popup,
      popover: "auto" as const,
      style: position,
      onToggle: (event: ToggleEvent<HTMLDivElement>) =>
        setOpen(event.newState === "open"),
      onBlur: (event: FocusEvent<HTMLDivElement>) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          close();
      },
    },
  };
}
