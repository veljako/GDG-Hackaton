import { normalizeEvent } from "../src/matching-data";
import type { GEventsEvent } from "../src/types";
import { eventSchema, profileSchema } from "./schema";
import { sourceHash } from "./embeddings";
import type { Firestore } from "firebase-admin/firestore";

/** Return only additive matching changes, preserving imported and private source fields. */
export function matchingMigrationPatch(
  kind: "user" | "event",
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const desired =
    kind === "user"
      ? {
          learningSkills: raw.learningSkills ?? [],
          country: raw.country ?? "",
          birth_date: raw.birth_date ?? null,
        }
      : (() => {
          const event = normalizeEvent(raw as unknown as GEventsEvent);
          return {
            matchingVersion: event.matchingVersion,
            topics: event.topics,
            country: event.country,
            languages: event.languages,
            price: event.price,
            eligibility: event.eligibility,
            format: event.format,
            ...(event.audience ? { audience: event.audience } : {}),
          };
        })();
  const schema =
    kind === "user"
      ? profileSchema.pick({
          learningSkills: true,
          country: true,
          birth_date: true,
        })
      : eventSchema.pick({
          matchingVersion: true,
          topics: true,
          country: true,
          languages: true,
          price: true,
          eligibility: true,
          format: true,
          audience: true,
        });
  const valid = schema.parse(desired);
  return Object.fromEntries(
    Object.entries(valid).filter(
      ([field, value]) =>
        sourceHash(raw[field] ?? null) !== sourceHash(value) || !(field in raw),
    ),
  );
}

export async function migrateMatching(
  db: Firestore,
  workspace: string,
  apply = false,
) {
  const report = {
    users: 0,
    events: 0,
    usersChanged: 0,
    eventsChanged: 0,
    applied: 0,
    readbackVerified: 0,
    conflicts: 0,
  };
  for (const [collection, kind] of [
    ["users", "user"],
    ["events", "event"],
  ] as const) {
    const snapshots = await db.collection(`${workspace}/${collection}`).get();
    report[collection] = snapshots.size;
    for (const snapshot of snapshots.docs) {
      const raw = snapshot.data();
      if ((kind === "user" ? raw.user_id : raw.id) !== snapshot.id)
        throw Error(
          "Source identity does not match its document. Data was preserved.",
        );
      const patch = matchingMigrationPatch(kind, raw);
      if (!Object.keys(patch).length) continue;
      report[kind === "user" ? "usersChanged" : "eventsChanged"]++;
      if (!apply) continue;
      const expected = sourceHash(raw);
      const applied = await db.runTransaction(async (tx) => {
        const current = await tx.get(snapshot.ref);
        if (!current.exists || sourceHash(current.data()) !== expected)
          return false;
        // Revision changes invalidate in-flight embeddings; rebase unchanged CV review bindings.
        const prior = Date.parse(String(raw.updated_at ?? ""));
        const updated_at = new Date(
          Math.max(Date.now(), Number.isFinite(prior) ? prior + 1 : 0),
        ).toISOString();
        const draftRef =
          kind === "user"
            ? db.doc(`${workspace}/onboardingDrafts/${snapshot.id}`)
            : undefined;
        const extractionRef =
          kind === "user"
            ? db.doc(`${workspace}/cvExtractions/${snapshot.id}`)
            : undefined;
        const draft = draftRef ? await tx.get(draftRef) : undefined;
        const extraction = extractionRef
          ? await tx.get(extractionRef)
          : undefined;
        const path = (raw.cv_document as { storage_path?: string } | null)
          ?.storage_path;
        if (
          path &&
          draft?.exists &&
          draft.get("cv_path") === path &&
          (draft.get("expected_profile_updated_at") ?? null) ===
            (raw.updated_at ?? null)
        )
          tx.update(draftRef!, { expected_profile_updated_at: updated_at });
        if (
          path &&
          extraction?.exists &&
          extraction.get("storage_path") === path &&
          (extraction.get("source_updated_at") ?? null) ===
            (raw.updated_at ?? null)
        )
          tx.update(extractionRef!, { source_updated_at: updated_at });
        tx.update(snapshot.ref, { ...patch, updated_at });
        tx.set(
          db.doc(`${workspace}/matchingMigrations/v2`),
          { pending: true, recipe: "matching-narrative-v3", updated_at },
          { merge: true },
        );
        return true;
      });
      if (!applied) {
        report.conflicts++;
        continue;
      }
      report.applied++;
      const saved = await snapshot.ref.get();
      if (
        !saved.exists ||
        Object.keys(matchingMigrationPatch(kind, saved.data()!)).length
      )
        throw Error(
          "Matching migration readback changed. Inspect current data before retrying.",
        );
      report.readbackVerified++;
    }
  }
  return report;
}
