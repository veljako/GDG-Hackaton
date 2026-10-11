import { describe, expect, it } from "vitest";
import { calendarDays, dateFromIso, dateToIso, moveMonth } from "./calendar";

describe("filter calendar dates", () => {
  it("keeps local calendar dates in ISO format", () => {
    expect(dateToIso(dateFromIso("2026-10-11"))).toBe("2026-10-11");
    expect(dateFromIso("2026-02-30")).toBeNull();
    expect(dateFromIso("")).toBeNull();
  });
  it("starts weeks on Monday and includes leap day", () => {
    const days = calendarDays(new Date(2024, 1, 1));
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(1);
    expect(days.map(dateToIso)).toContain("2024-02-29");
  });
  it("clamps month navigation instead of overflowing into another month", () => {
    expect(dateToIso(moveMonth(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
    expect(dateToIso(moveMonth(new Date(2024, 0, 31), 1))).toBe("2024-02-29");
    expect(dateToIso(moveMonth(new Date(2026, 0, 10), -1))).toBe("2025-12-10");
  });
});
