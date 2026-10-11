import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { BRAND } from "../config";
import "./launch-intro.css";

type Shape =
  | "star"
  | "circle"
  | "ring"
  | "triangle"
  | "arch"
  | "diamond"
  | "capsule"
  | "square"
  | "cross";
const colors = ["#3255ff", "#ff745e", "#ffdb39", "#82efc5", "#b6a5ff"];
const shapes: Shape[] = [
  "star",
  "circle",
  "triangle",
  "ring",
  "arch",
  "diamond",
  "capsule",
  "square",
  "cross",
];
// A composed field, rather than random positions that can bunch up or collide.
const positions = [
  [-42, -32, 88],
  [-18, -40, 46],
  [14, -34, 66],
  [39, -30, 96],
  [-34, -12, 58],
  [-12, -17, 80],
  [22, -13, 42],
  [43, -4, 55],
  [-43, 16, 50],
  [-23, 9, 92],
  [7, 17, 60],
  [32, 15, 76],
  [-35, 34, 94],
  [-9, 36, 48],
  [17, 35, 88],
  [41, 33, 52],
  [-28, -34, 32],
  [1, -43, 36],
  [30, -41, 40],
  [-44, -2, 30],
  [-3, -7, 32],
  [34, 0, 34],
  [-17, 25, 30],
  [28, 28, 34],
  [-39, 1, 24],
  [-5, -30, 24],
  [10, -22, 30],
  [44, 22, 28],
  [-25, 40, 26],
  [4, 41, 34],
  [25, -28, 26],
  [-30, 22, 28],
];
function Geometry({ shape }: { shape: Shape }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {shape === "star" && (
        <path d="M50 2C50 36 36 50 2 50c34 0 48 14 48 48 0-34 14-48 48-48-34 0-48-14-48-48Z" />
      )}
      {shape === "circle" && <circle cx="50" cy="50" r="44" />}
      {shape === "ring" && (
        <circle
          cx="50"
          cy="50"
          r="35"
          fill="none"
          stroke="currentColor"
          strokeWidth="18"
        />
      )}
      {shape === "triangle" && <path d="m50 7 46 82H4Z" />}
      {shape === "arch" && <path d="M5 58a45 45 0 0 1 90 0v30H5Z" />}
      {shape === "diamond" && <path d="m50 3 47 47-47 47L3 50Z" />}
      {shape === "capsule" && (
        <rect x="4" y="27" width="92" height="46" rx="23" />
      )}
      {shape === "square" && (
        <rect x="10" y="10" width="80" height="80" rx="16" />
      )}
      {shape === "cross" && <path d="M36 7h28v29h29v28H64v29H36V64H7V36h29Z" />}
    </svg>
  );
}

function AssemblingLogo() {
  const pieces = [
    {
      name: "blue",
      color: "#4285F4",
      path: "M14 6h8v52h-8a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6Z",
    },
    { name: "red", color: "#EA4335", path: "M14 6h36a6 6 0 0 1 0 12H22Z" },
    { name: "yellow", color: "#FBBC05", path: "M16 26h28a6 6 0 0 1 0 12H22Z" },
    { name: "green", color: "#34A853", path: "M22 46h28a6 6 0 0 1 0 12H14Z" },
  ];
  return (
    <svg
      className="intro-mark"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      {pieces.map((piece) => (
        <g
          key={piece.name}
          className={`intro-logo-piece intro-logo-${piece.name}`}
        >
          <path fill={piece.color} d={piece.path} />
        </g>
      ))}
    </svg>
  );
}

/** Mounted above the router's pages: one intro per document, never per route. */
export function LaunchIntro({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(true);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const complete = useCallback(() => {
    setActive(false);
  }, []);
  useEffect(() => {
    if (!active) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timeout = window.setTimeout(complete, reduced ? 650 : 3650);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReduced(media.matches);
    media.addEventListener("change", preference);
    return () => {
      document.body.style.overflow = before;
      window.clearTimeout(timeout);
      media.removeEventListener("change", preference);
    };
  }, [active, reduced, complete]);
  return (
    <>
      <div
        className="intro-app"
        inert={active}
        aria-hidden={active || undefined}
      >
        {children}
      </div>
      {active && (
        <div
          className={`intro-screen ${reduced ? "intro-screen--reduced" : ""}`}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) complete();
          }}
        >
          <span className="sr-only" role="status">
            Opening {BRAND.name}
          </span>
          <div className="intro-field" aria-hidden="true">
            {positions.map(([x, y, size], i) => (
              <span
                key={i}
                className="intro-particle"
                style={
                  {
                    "--from-x": `${x}vw`,
                    "--from-y": `${y}vh`,
                    "--orbit-x": `${x * 0.58 - y * 0.18}vw`,
                    "--orbit-y": `${y * 0.58 + x * 0.12}vh`,
                    "--lock-x": `${i % 2 ? 27 : -27}px`,
                    "--lock-y": `${i % 4 < 2 ? -25 : 25}px`,
                    "--rotation": `${i * 37 - 140}deg`,
                    "--spin": `${i * 37 + 115}deg`,
                    "--size": `${size}px`,
                    "--delay": `${(i % 8) * 25}ms`,
                    color: colors[i % colors.length],
                  } as CSSProperties
                }
              >
                <Geometry shape={shapes[i % shapes.length]} />
              </span>
            ))}
          </div>
          <div className="intro-lockup" aria-hidden="true">
            <div className="intro-logo-position">
              <AssemblingLogo />
            </div>
            <span className="intro-wordmark">{BRAND.name}</span>
            <span className="intro-tagline">{BRAND.tagline}</span>
          </div>
        </div>
      )}
    </>
  );
}
