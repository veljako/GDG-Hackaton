import type { UserDocument } from "./users";
import { sourceHash } from "./embeddings";

/** Feature export only. Training targets and splits belong to the model pipeline. */
export function trainingProfile(record: UserDocument, origin: "real" | "synthetic") {
  return {
    entity_id: origin === "synthetic" ? `synthetic:${record.user_id}` : record.user_id,
    data_origin: origin,
    input_version: "user-profile-v2",
    source_hash: sourceHash(record),
    features: {
      title: record.title,
      location: record.location,
      general_description: record.general_description,
      status: record.status ?? null,
      experience_level: record.experience_level ?? null,
      experience: record.experience,
      skills: record.skills,
      learningSkills: record.learningSkills ?? [],
      country: record.country ?? "",
      interests: record.interests,
      roles: record.roles,
      languages: record.languages ?? [],
      education: record.education ?? [],
      work_experience: record.work_experience ?? [],
      preferences: record.preferences ?? null,
    },
  };
}
