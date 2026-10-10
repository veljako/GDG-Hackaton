import { describe, expect, it } from "vitest";
import { createSeedState } from "../src/seed";
import { toUserDocument } from "./users";
import { sourceHash } from "./embeddings";
import { trainingProfile } from "./training";

describe("training profile export", () => {
  it("keeps structured background and source provenance without account/contact/CV fields", () => {
    const record = toUserDocument({
      ...createSeedState().people[0],
      email: "private@example.com", phone: "+381123456",
      first_name: "Private", last_name: "Name",
      education: [{ institution: "University", degree: "BSc", field: "Computer Science", start_date: null, end_date: null, description: "" }],
      cv_document: { storage_path: "cvs/private/file.pdf", filename: "private.pdf", content_type: "application/pdf", size_bytes: 100, uploaded_at: "2026-10-10T20:00:00Z", extraction_status: "not_started", extracted_at: null },
    });
    const row = trainingProfile(record, "real");
    expect(row.entity_id).toBe(record.user_id);
    expect(row.data_origin).toBe("real");
    expect(row.source_hash).toBe(sourceHash(record));
    expect(row.features.education).toEqual(record.education);
    const output = JSON.stringify(row);
    for (const omitted of ["private@example.com", "+381123456", "Private", "Name", "private.pdf", "cvs/private/file.pdf"])
      expect(output).not.toContain(omitted);
    expect(row).not.toHaveProperty("label");
    expect(row).not.toHaveProperty("target");
  });

  it("namespaces synthetic IDs and records their origin without inventing missing background", () => {
    const record = toUserDocument(createSeedState().people[0]);
    const row = trainingProfile(record, "synthetic");
    expect(row.entity_id).toBe(`synthetic:${record.user_id}`);
    expect(row.data_origin).toBe("synthetic");
    expect(row.features.education).toEqual([]);
    expect(row.features.work_experience).toEqual([]);
    expect(row.features.skills).toEqual(record.skills);
  });
});
