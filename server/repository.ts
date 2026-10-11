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

export type CvExtractionGuard = { personId: string; storagePath: string; extractionHash: string; sourceUpdatedAt: string | null };
export interface Repository {
  supportsCvExtractionGuard?: boolean;
  read(): Promise<DemoState>;
  update(fn: (state: DemoState) => Transition, guard?: CvExtractionGuard): Promise<Transition>;
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
  update(fn: (state: DemoState) => Transition, guard?: CvExtractionGuard): Promise<Transition> {
    const job = this.queue.then(async () => {
      if (guard) return { state: await this.load(), error: "Atomic CV confirmation is unavailable." };
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
  async update(fn: (state: DemoState) => Transition, guard?: CvExtractionGuard): Promise<Transition> {
    return this.db.runTransaction(async (transaction) => {
      const before = await this.load(transaction);
      if (guard) {
        if (!guard.personId || guard.personId.includes("/")) throw Error("Invalid extraction owner.");
        const extraction = await transaction.get(this.db.doc(`${this.document}/cvExtractions/${guard.personId}`));
        const row = extraction.exists ? extraction.data() : undefined;
        if (!row || row.user_id !== guard.personId || row.storage_path !== guard.storagePath || row.extraction_hash !== guard.extractionHash || (row.source_updated_at ?? null) !== guard.sourceUpdatedAt)
          return { state: before.state, error: "Your extraction changed. Review it again." };
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
      transaction.set(this.db.doc(this.document), {
        schemaVersion: 3,
        revision: before.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      return { ...result, state };
    });
  }
}
