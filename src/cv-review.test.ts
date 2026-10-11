import { describe, it, expect } from "vitest";
import {
  cvReviewValue,
  cvFieldLabel,
  reviewableCvFields,
  matchingSourceLabel,
} from "./cv-review";
describe("CV review formatting", () => {
  it("renders education and work records without JSON or missing dates", () => {
    expect(
      cvReviewValue([
        {
          institution: "University",
          degree: "BSc",
          field: "Computer science",
          start_date: "2020-09",
          end_date: null,
          description: "Research project",
        },
      ]),
    ).toBe("University · BSc · Computer science — 2020-09 — Research project");
    expect(
      cvReviewValue([
        {
          company: "Example",
          position: "Engineer",
          location: "Belgrade",
          start_date: null,
          end_date: null,
          description: "",
        },
      ]),
    ).toBe("Example · Engineer · Belgrade");
  });
  it("omits absent extracted values so empty fields cannot overwrite a profile", () => {
    expect(
      reviewableCvFields({
        skills: [],
        city: "",
        education: null,
        languages: ["English"],
      }),
    ).toEqual([["languages", ["English"]]]);
    expect(cvReviewValue(["Python", "SQL"])).toBe("Python, SQL");
  });
  it("uses product labels for fields and matching source", () => {
    expect(cvFieldLabel("work_experience")).toBe("Work experience");
    expect(matchingSourceLabel("structured-fallback")).toBe(
      "Profile and event filters",
    );
  });
});
