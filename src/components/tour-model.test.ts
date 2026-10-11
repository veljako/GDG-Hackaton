import { describe, expect, it } from "vitest";
import { buildTour, spotlightRect, captionPosition } from "./tour-model";

describe("guided tour", () => {
  it("omits the organizer journey for accounts without permission", () => {
    expect(buildTour(false).some((step) => step.mode === "organizer")).toBe(
      false,
    );
    expect(
      buildTour(true).filter((step) => step.mode === "organizer"),
    ).toHaveLength(2);
  });
  it("uses the actual team when available and a useful overview otherwise", () => {
    expect(
      buildTour(true, "team-4").find((step) => step.id === "team")?.route,
    ).toBe("/teams/team-4");
    expect(buildTour(false).find((step) => step.id === "team")?.route).toBe(
      "/teams",
    );
  });
  it("keeps the complete presentation walkthrough under two minutes", () => {
    const steps = buildTour(true, "team-4");
    expect(steps.reduce((total, step) => total + step.seconds, 0)).toBe(100);
    expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
  });
  it("clips offscreen and oversized targets into the visible viewport", () => {
    const rect = spotlightRect(
      { left: -100, top: -10, width: 800, height: 900 },
      390,
      844,
    );
    expect(rect.left).toBeGreaterThanOrEqual(8);
    expect(rect.top).toBeGreaterThanOrEqual(8);
    expect(rect.left + rect.width).toBeLessThanOrEqual(382);
    expect(rect.top + rect.height).toBeLessThanOrEqual(836);
    expect(rect.width).toBeGreaterThan(0);
  });
  it("keeps captions fully on screen even for a full-width target", () => {
    for (const [width, height] of [
      [390, 844],
      [1440, 900],
      [375, 500],
    ]) {
      const rect = spotlightRect(
        { left: 10, top: 10, width, height: 200 },
        width,
        height,
      );
      const position = captionPosition(
        rect,
        width,
        height,
        Math.min(420, width - 24),
        250,
      );
      expect(position.left).toBeGreaterThanOrEqual(12);
      expect(position.top).toBeGreaterThanOrEqual(12);
      expect(position.left + Math.min(420, width - 24)).toBeLessThanOrEqual(
        width - 12,
      );
      expect(position.top + 250).toBeLessThanOrEqual(height - 12);
    }
  });
});
