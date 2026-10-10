import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";

describe("separate backend address", () => {
  it("keeps local and same-origin deployments working", () => {
    expect(apiUrl("state?mode=attendee", "")).toBe("/api/state?mode=attendee");
  });
  it("uses the configured HTTPS backend origin", () => {
    expect(apiUrl("config", "https://api.example.com/")).toBe("https://api.example.com/api/config");
  });
  it("rejects insecure public URLs and credentials or paths in configuration", () => {
    for (const origin of ["http://api.example.com", "https://user:password@api.example.com", "https://api.example.com/path", "https://api.example.com?token=secret"]) {
      expect(() => apiUrl("config", origin)).toThrow();
    }
    expect(apiUrl("config", "http://127.0.0.1:5181")).toBe("http://127.0.0.1:5181/api/config");
  });
});
