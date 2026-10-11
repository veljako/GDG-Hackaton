import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createSeedState } from "../src/seed";
import { normalizeState } from "../src/discovery";
import type { DemoState, Transition } from "../src/types";
import type { Firestore } from "firebase-admin/firestore";
import type { Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { emptyWorkspace, entityCollections } from "./dataset";
import { toUserDocument, fromUserDocument, type UserDocument } from "./users";
import { requiresOnboarding, type OnboardingDraft } from "../src/onboarding";

export type CvExtractionGuard = {
  personId: string;
  storagePath: string;
  extractionHash: string;
  sourceUpdatedAt: string | null;
  completeOnboarding?: { draftVersion: number };
};
export class DraftConflict extends Error {}
type DraftContent = Omit<OnboardingDraft, "version">;
function validateDraftSource(
  person:
    | {
        updated_at?: string | null;
        cv_document?: { storage_path: string } | null;
        onboarding?: import("../src/types").Person["onboarding"];
      }
    | undefined,
  draft: DraftContent,
) {
  if (
    !person ||
    !requiresOnboarding(person) ||
    person.cv_document?.storage_path !== draft.cv_path ||
    (person.updated_at ?? null) !== draft.expected_profile_updated_at
  )
    throw new DraftConflict(
      "Your profile or CV changed. Reload the review before saving.",
    );
}
export interface Repository {
  supportsCvExtractionGuard?: boolean;
  read(): Promise<DemoState>;
  update(
    fn: (state: DemoState) => Transition,
    guard?: CvExtractionGuard,
  ): Promise<Transition>;
  loadOnboardingDraft?(uid: string): Promise<OnboardingDraft | null>;
  saveOnboardingDraft?(
    uid: string,
    draft: DraftContent,
    expectedVersion: number | null,
  ): Promise<OnboardingDraft>;
}
export class FileRepository implements Repository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private filename: string) {}
  async read(): Promise<DemoState> {
    await this.queue;
    return this.load();
  }
  private async load(): Promise<DemoState> {
    try {
      return normalizeState(JSON.parse(await readFile(this.filename, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return createSeedState();
      throw error; // Corrupt data must never be silently reset.
    }
  }
  private async drafts(): Promise<Record<string, OnboardingDraft>> {
    try {
      return JSON.parse(
        await readFile(`${this.filename}.onboarding.json`, "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }
  async loadOnboardingDraft(uid: string): Promise<OnboardingDraft | null> {
    await this.queue;
    return (await this.drafts())[uid] ?? null;
  }
  saveOnboardingDraft(
    uid: string,
    draft: DraftContent,
    expectedVersion: number | null,
  ): Promise<OnboardingDraft> {
    const job = this.queue.then(async () => {
      validateDraftSource(
        (await this.load()).people.find((p) => p.id === uid),
        draft,
      );
      const records = await this.drafts();
      const current = records[uid];
      const sameSource =
        current?.cv_path === draft.cv_path &&
        current?.extraction_hash === draft.extraction_hash &&
        current.expected_profile_updated_at ===
          draft.expected_profile_updated_at;
      if ((sameSource ? current.version : null) !== expectedVersion)
        throw new DraftConflict(
          "Your review changed in another session. Reload it before saving.",
        );
      const saved = { ...draft, version: (current?.version ?? 0) + 1 };
      records[uid] = saved;
      await mkdir(dirname(this.filename), { recursive: true });
      await writeFile(
        `${this.filename}.onboarding.json.tmp`,
        JSON.stringify(records),
        "utf8",
      );
      await rename(
        `${this.filename}.onboarding.json.tmp`,
        `${this.filename}.onboarding.json`,
      );
      return saved;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
  update(
    fn: (state: DemoState) => Transition,
    guard?: CvExtractionGuard,
  ): Promise<Transition> {
    const job = this.queue.then(async () => {
      if (guard)
        return {
          state: await this.load(),
          error: "Atomic CV confirmation is unavailable.",
        };
      const result = fn(await this.load());
      if (!result.error) {
        await mkdir(dirname(this.filename), { recursive: true });
        await writeFile(
          `${this.filename}.tmp`,
          JSON.stringify(result.state),
          "utf8",
        );
        await rename(`${this.filename}.tmp`, this.filename);
      }
      return result;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}
export class FirestoreRepository implements Repository {
  readonly supportsCvExtractionGuard = true;
  constructor(
    private db: Firestore,
    private document = "gdevPilots/main",
  ) {}
  private documents(state: DemoState): Map<string, object> {
    const records = new Map<string, object>();
    for (const key of entityCollections)
      for (const record of state[key]) {
        if (!record.id || record.id.includes("/"))
          throw Error("Invalid Firestore document ID.");
        // JSON serialization drops optional undefined fields rejected by Firestore.
        records.set(
          `${this.document}/${key === "people" ? "users" : key}/${record.id}`,
          JSON.parse(
            JSON.stringify(
              key === "people"
                ? toUserDocument(record as DemoState["people"][number])
                : record,
            ),
          ),
        );
      }
    for (const key of state.connections) {
      const id = createHash("sha256").update(key).digest("hex");
      records.set(`${this.document}/connections/${id}`, { key });
    }
    return records;
  }
  private async load(transaction: Transaction) {
    const parent = await transaction.get(this.db.doc(this.document));
    if (
      parent.exists &&
      parent.get("schemaVersion") !== undefined &&
      ![2, 3].includes(parent.get("schemaVersion"))
    )
      throw Error("Unsupported workspace schema. Data was preserved.");
    const schemaVersion = parent.get("schemaVersion");
    const collections: (
      (typeof entityCollections)[number] | "users" | "connections"
    )[] = [
      "users",
      ...entityCollections.filter((key) => key !== "people"),
      "connections",
      ...(schemaVersion === 3 ? [] : ["people" as const]),
    ];
    const snapshots = await Promise.all(
      collections.map((key) =>
        transaction.get(this.db.collection(`${this.document}/${key}`)),
      ),
    );
    const stored = new Map<string, object>();
    const state = emptyWorkspace();
    for (let index = 0; index < collections.length; index++) {
      const key = collections[index];
      for (const doc of snapshots[index].docs) {
        const record = doc.data();
        // Schema-2 people are retained as a recovery snapshot, not active records.
        if (key !== "people") stored.set(doc.ref.path, record);
        if (key === "connections") state.connections.push(record.key);
        else if (key === "users" || key === "people") {
          if (state.people.some((person) => person.id === doc.id))
            throw Error(
              "User and legacy people IDs overlap. Data was preserved.",
            );
          if (key === "people" && record.id && record.id !== doc.id)
            throw Error(
              `Document ID does not match its record: ${doc.ref.path}`,
            );
          state.people.push(
            key === "users"
              ? fromUserDocument(record as UserDocument, doc.id)
              : ({ ...record, id: doc.id } as DemoState["people"][number]),
          );
        } else {
          if (record.id && record.id !== doc.id)
            throw Error(
              `Document ID does not match its record: ${doc.ref.path}`,
            );
          (state[key] as object[]).push({ ...record, id: doc.id });
        }
      }
    }
    const legacy = [2, 3].includes(schemaVersion)
      ? undefined
      : (parent.get("payload") as string | undefined);
    if (legacy && (stored.size || state.people.length))
      throw Error(
        "Legacy and collection data overlap. Resolve the workspace before migrating.",
      );
    return {
      state: legacy
        ? (normalizeState(JSON.parse(legacy)) as DemoState)
        : normalizeState(state),
      stored,
      legacy,
      revision: Number(parent.get("revision") ?? 0),
    };
  }
  async read(): Promise<DemoState> {
    return this.db.runTransaction(
      async (transaction) => (await this.load(transaction)).state,
      { readOnly: true },
    );
  }
  async loadOnboardingDraft(uid: string): Promise<OnboardingDraft | null> {
    if (!/^[\w-]{1,128}$/.test(uid)) throw Error("Invalid draft owner.");
    return this.db.runTransaction(
      async (tx) => {
        const snap = await tx.get(
          this.db.doc(`${this.document}/onboardingDrafts/${uid}`),
        );
        return snap.exists ? (snap.data() as OnboardingDraft) : null;
      },
      { readOnly: true },
    );
  }
  async saveOnboardingDraft(
    uid: string,
    draft: DraftContent,
    expectedVersion: number | null,
  ): Promise<OnboardingDraft> {
    if (!/^[\w-]{1,128}$/.test(uid)) throw Error("Invalid draft owner.");
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(`${this.document}/onboardingDrafts/${uid}`);
      const [user, extraction, prior] = await Promise.all([
        tx.get(this.db.doc(`${this.document}/users/${uid}`)),
        tx.get(this.db.doc(`${this.document}/cvExtractions/${uid}`)),
        tx.get(ref),
      ]);
      validateDraftSource(
        user.exists ? (user.data() as UserDocument) : undefined,
        draft,
      );
      const row = extraction.exists ? extraction.data() : undefined;
      if (
        !row ||
        row.user_id !== uid ||
        row.storage_path !== draft.cv_path ||
        row.extraction_hash !== draft.extraction_hash ||
        (row.source_updated_at ?? null) !== draft.expected_profile_updated_at
      )
        throw new DraftConflict(
          "Your extraction changed. Review the current CV again.",
        );
      const current = prior.exists ? (prior.data() as OnboardingDraft) : null;
      const sameSource =
        current?.cv_path === draft.cv_path &&
        current?.extraction_hash === draft.extraction_hash &&
        current.expected_profile_updated_at ===
          draft.expected_profile_updated_at;
      if ((sameSource ? current.version : null) !== expectedVersion)
        throw new DraftConflict(
          "Your review changed in another session. Reload it before saving.",
        );
      const saved = { ...draft, version: (current?.version ?? 0) + 1 };
      tx.set(ref, JSON.parse(JSON.stringify(saved)));
      return saved;
    });
  }
  async update(
    fn: (state: DemoState) => Transition,
    guard?: CvExtractionGuard,
  ): Promise<Transition> {
    return this.db.runTransaction(async (transaction) => {
      const before = await this.load(transaction);
      let extractionRecord: Record<string, unknown> | undefined;
      if (guard) {
        if (!guard.personId || guard.personId.includes("/"))
          throw Error("Invalid extraction owner.");
        const extraction = await transaction.get(
          this.db.doc(`${this.document}/cvExtractions/${guard.personId}`),
        );
        const row = extraction.exists ? extraction.data() : undefined;
        if (
          !row ||
          row.user_id !== guard.personId ||
          row.storage_path !== guard.storagePath ||
          row.extraction_hash !== guard.extractionHash ||
          (row.source_updated_at ?? null) !== guard.sourceUpdatedAt
        )
          return {
            state: before.state,
            error: "Your extraction changed. Review it again.",
          };
        extractionRecord = row;
        if (guard.completeOnboarding) {
          const draft = await transaction.get(
            this.db.doc(`${this.document}/onboardingDrafts/${guard.personId}`),
          );
          const saved = draft.exists ? (draft.data() as OnboardingDraft) : null;
          if (
            !saved ||
            saved.version !== guard.completeOnboarding.draftVersion ||
            saved.cv_path !== guard.storagePath ||
            saved.extraction_hash !== guard.extractionHash ||
            saved.expected_profile_updated_at !== guard.sourceUpdatedAt
          )
            return {
              state: before.state,
              error: "Your review changed. Reload it before finishing setup.",
            };
        }
      }
      const result = fn(structuredClone(before.state));
      if (result.error) return result;
      const state = {
        ...result.state,
        currentPersonId: "",
        mode: "attendee" as const,
      };
      delete state.recommendations;
      const after = this.documents(state);
      const changed = [...after].filter(
        ([path, record]) =>
          JSON.stringify(record) !== JSON.stringify(before.stored.get(path)),
      );
      const removed = [...before.stored.keys()].filter(
        (path) => !after.has(path),
      );
      if (changed.length + removed.length > 450)
        throw Error(
          "Too many records for one pilot transaction. Split the import before continuing.",
        );
      if (before.legacy)
        transaction.set(this.db.doc(`${this.document}/backups/legacy-v1`), {
          payload: before.legacy,
          migratedAt: new Date().toISOString(),
        });
      for (const [path, record] of changed)
        transaction.set(this.db.doc(path), record);
      for (const path of removed) transaction.delete(this.db.doc(path));
      if (guard?.completeOnboarding && extractionRecord) {
        transaction.set(
          this.db.doc(`${this.document}/cvExtractions/${guard.personId}`),
          {
            ...extractionRecord,
            confirmed: true,
            reviewed_profile_updated_at:
              state.people.find((p) => p.id === guard.personId)?.updated_at ??
              null,
          },
        );
        transaction.delete(
          this.db.doc(`${this.document}/onboardingDrafts/${guard.personId}`),
        );
      }
      transaction.set(this.db.doc(this.document), {
        schemaVersion: 3,
        revision: before.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      return { ...result, state };
    });
  }
}
