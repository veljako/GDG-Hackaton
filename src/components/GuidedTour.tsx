import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Pause,
  Play,
  Presentation,
  X,
} from "@phosphor-icons/react";
import { useDemo } from "../store";
import { buildTour, captionPosition, spotlightRect } from "./tour-model";
import type { TourRect } from "./tour-model";
import { BrandGeometry } from "./playful";
import "./guided-tour.css";

/** A read-only walkthrough: only navigation and the session's view mode change. */
export function GuidedTour() {
  const { state, me, backendMode, organizer, run } = useDemo();
  const navigate = useNavigate();
  const location = useLocation();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const entry = useRef({
    route: location.pathname + location.search,
    mode: state.mode,
  });
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [rect, setRect] = useState<TourRect | null>(null);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [cardSize, setCardSize] = useState({ width: 420, height: 280 });
  const canOrganize = backendMode === "demo" || organizer;
  const teamId = state.teams.find(
    (team) =>
      team.memberIds.includes(me.id) &&
      state.events.some(
        (event) => event.id === team.eventId && event.status === "open",
      ),
  )?.id;
  const steps = useMemo(
    () => buildTour(canOrganize, teamId),
    [canOrganize, teamId],
  );
  const step = steps[Math.min(index, steps.length - 1)];
  const ready = active && readyId === step.id;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (active || new URLSearchParams(location.search).get("tour") !== "1")
      return;
    const timer = window.setInterval(() => {
      if (document.querySelector(".intro-app[inert]")) return;
      entry.current = {
        route: location.pathname + location.search,
        mode: stateRef.current.mode,
      };
      setIndex(0);
      setReadyId(null);
      setPlaying(false);
      setActive(true);
      window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [active, location.pathname, location.search]);

  const close = useCallback(async () => {
    activeRef.current = false;
    setActive(false);
    setPlaying(false);
    const original = entry.current;
    if (stateRef.current.mode !== original.mode)
      await run({ type: "SET_MODE", mode: original.mode }, true);
    const [path, search = ""] = original.route.split("?");
    const params = new URLSearchParams(search);
    params.delete("tour");
    params.delete("autoplay");
    navigate(path + (params.size ? `?${params}` : ""), { replace: true });
    window.requestAnimationFrame(() => trigger.current?.focus());
  }, [navigate, run]);

  function start() {
    entry.current = {
      route: location.pathname + location.search,
      mode: state.mode,
    };
    setIndex(0);
    setReadyId(null);
    setRect(null);
    setPlaying(false);
    setActive(true);
  }
  const advance = useCallback(() => {
    if (index === steps.length - 1) void close();
    else setIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [index, steps.length, close]);

  useEffect(() => {
    if (!active) return;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    const oldInert = shell?.inert ?? false;
    if (shell) {
      shell.inert = true;
      shell.setAttribute("data-guided-tour", "active");
    }
    const focusFrame = window.requestAnimationFrame(() =>
      panel.current?.focus(),
    );
    const hidden = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      if (shell) {
        shell.inert = oldInert;
        shell.removeAttribute("data-guided-tour");
      }
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let target: HTMLElement | null = null;
    let detail: HTMLDetailsElement | null = null;
    let detailWasOpen = false;
    let attempts = 0;
    let interval = 0;
    let frame = 0;
    const observer = new ResizeObserver(() => schedule());
    setReadyId(null);
    setRect(null);
    setNotice("");
    function update() {
      if (cancelled || !target?.isConnected) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport({ width, height });
      const bounds = target.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0)
        setRect(spotlightRect(bounds, width, height));
    }
    function schedule() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    }
    function find() {
      if (cancelled) return;
      attempts++;
      const matches = step.target
        .split(",")
        .flatMap((selector) => [
          ...document.querySelectorAll<HTMLElement>(selector.trim()),
        ]);
      target =
        matches.find((element) => element.getBoundingClientRect().height > 0) ??
        null;
      if (!target && attempts < 60) return;
      if (!target) {
        target = document.getElementById("main-content");
        setNotice(
          "This section has no content yet. You can continue the tour or explore it later.",
        );
      }
      window.clearInterval(interval);
      if (target) {
        detail =
          step.revealDetails && target instanceof HTMLDetailsElement
            ? target
            : null;
        if (detail) {
          detailWasOpen = detail.open;
          detail.open = true;
        }
        target.scrollIntoView({
          block: window.innerWidth < 600 ? "start" : "center",
          behavior: "instant",
        });
        observer.observe(target);
        update();
        // Route entrance motion can change bounds without changing element dimensions.
        frame = window.requestAnimationFrame(update);
      }
      setReadyId(step.id);
    }
    async function open() {
      if (stateRef.current.mode !== step.mode) {
        const result = await run({ type: "SET_MODE", mode: step.mode }, true);
        if (cancelled || !activeRef.current) return;
        if (result.error) {
          setNotice(
            "This view could not open. Continue to another section or close the tour and try again.",
          );
          setReadyId(step.id);
          return;
        }
      }
      if (cancelled || !activeRef.current) return;
      navigate(step.route, { replace: true });
      interval = window.setInterval(find, 100);
    }
    void open();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (detail) detail.open = detailWasOpen;
      window.clearInterval(interval);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [active, step, navigate, run]);

  useEffect(() => {
    if (!active || !panel.current) return;
    const observer = new ResizeObserver(() => {
      if (panel.current)
        setCardSize({
          width: panel.current.offsetWidth,
          height: panel.current.offsetHeight,
        });
    });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (!active || !playing || !ready) return;
    const timer = window.setTimeout(advance, step.seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [active, playing, ready, step, advance]);

  const position = rect
    ? captionPosition(
        rect,
        viewport.width,
        viewport.height,
        cardSize.width,
        cardSize.height,
      )
    : {
        left: Math.max(
          12,
          (viewport.width - Math.min(420, viewport.width - 24)) / 2,
        ),
        top: Math.max(12, (viewport.height - cardSize.height) / 2),
      };
  return (
    <>
      <button
        ref={trigger}
        className="icon-button tour-trigger"
        type="button"
        aria-label="Start guided tour"
        title="Guided tour"
        onClick={start}
      >
        <Presentation size={21} />
      </button>
      {active &&
        createPortal(
          <div
            className="guided-tour"
            data-tour-step={step.id}
            data-tour-ready={ready}
          >
            <svg
              className="tour-mask"
              width="100%"
              height="100%"
              aria-hidden="true"
            >
              <defs>
                <mask id="gevents-tour-mask">
                  <rect width="100%" height="100%" fill="white" />
                  {rect && (
                    <rect
                      x={rect.left}
                      y={rect.top}
                      width={rect.width}
                      height={rect.height}
                      rx="14"
                      fill="black"
                    />
                  )}
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                fill="#080d1b"
                fillOpacity="0.78"
                mask="url(#gevents-tour-mask)"
              />
            </svg>
            {rect && (
              <div className="tour-outline" style={rect} aria-hidden="true" />
            )}
            <div
              ref={panel}
              className="tour-caption"
              style={position}
              role="dialog"
              aria-modal="true"
              aria-labelledby="tour-title"
              aria-describedby="tour-body"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  void close();
                }
                if (event.key === "ArrowRight" && ready) {
                  event.preventDefault();
                  advance();
                }
                if (event.key === "ArrowLeft" && ready) {
                  event.preventDefault();
                  setIndex((value) => Math.max(0, value - 1));
                }
                if (event.key === "Tab") {
                  const buttons = [
                    ...panel.current!.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ];
                  const first = buttons[0];
                  const last = buttons[buttons.length - 1];
                  if (
                    event.shiftKey &&
                    (document.activeElement === first ||
                      document.activeElement === panel.current)
                  ) {
                    event.preventDefault();
                    last?.focus();
                  } else if (
                    !event.shiftKey &&
                    (document.activeElement === last ||
                      document.activeElement === panel.current)
                  ) {
                    event.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <div className="tour-hero">
                <div className="tour-caption-top">
                  <span className="tour-step-count">
                    {index + 1} of {steps.length}
                  </span>
                  <span className="tour-name">A little GEvents adventure</span>
                  <button
                    type="button"
                    aria-label="Close guided tour"
                    onClick={() => void close()}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="tour-heading" key={step.id}>
                  <h2 id="tour-title">{step.title}</h2>
                </div>
                <BrandGeometry />
              </div>
              <div className="tour-progress" aria-hidden="true">
                {steps.map((item, i) => (
                  <span
                    key={item.id}
                    className={
                      i === index ? "current" : i < index ? "passed" : ""
                    }
                  />
                ))}
              </div>
              <div
                className="tour-copy"
                aria-live="polite"
                aria-atomic="true"
              >
                <div className="tour-copy-content" key={step.id}>
                  <span className="tour-sr-only">{step.title}</span>
                  <p id="tour-body">{step.body}</p>
                  {notice && <p className="tour-notice">{notice}</p>}
                </div>
              </div>
              <div className="tour-controls">
                <button
                  type="button"
                  className="tour-back"
                  disabled={!index || !ready}
                  onClick={() => setIndex((value) => Math.max(0, value - 1))}
                >
                  <ArrowLeft size={17} /> Back
                </button>
                <button
                  type="button"
                  className="tour-play"
                  disabled={!ready}
                  onClick={() => setPlaying((value) => !value)}
                  aria-label={
                    playing ? "Pause tour playback" : "Play tour automatically"
                  }
                >
                  {playing ? <Pause size={17} /> : <Play size={17} />}
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  className="tour-next"
                  disabled={!ready}
                  onClick={advance}
                >
                  {!ready
                    ? "Opening…"
                    : index === steps.length - 1
                      ? "Finish"
                      : "Next"}
                  <ArrowRight size={17} />
                </button>
              </div>
              <p className="tour-footnote">
                {backendMode === "demo"
                  ? "Fictional demo profiles. Structured recommendations."
                  : "Your actual account and available events."}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
