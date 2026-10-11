import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { readOnlySnapshot } from "./firestore-read";
import type {
  Organization,
  OrganizationInput,
  OrganizationMembership,
  OrganizationSnapshot,
  OrganizationInvitation,
} from "../src/organizations";

type StoredInvitation = Omit<OrganizationInvitation, "token"> & {
  consumedBy?: string;
};
type Records = {
  organizations: Organization[];
  memberships: OrganizationMembership[];
  invitations: Record<string, StoredInvitation>;
};
const empty = (): Records => ({
  organizations: [],
  memberships: [],
  invitations: {},
});
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class OrganizationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface OrganizationStore {
  snapshot(uid: string): Promise<OrganizationSnapshot>;
  create(uid: string, input: OrganizationInput): Promise<OrganizationSnapshot>;
  members(
    uid: string,
    organizationId: string,
  ): Promise<OrganizationMembership[]>;
  invite(
    uid: string,
    organizationId: string,
    email: string,
    role: "admin" | "member",
  ): Promise<OrganizationInvitation>;
  join(
    uid: string,
    email: string | null,
    verified: boolean,
    token: string,
  ): Promise<OrganizationSnapshot>;
}
function snapshot(records: Records, uid: string): OrganizationSnapshot {
  const memberships = records.memberships.filter((m) => m.personId === uid);
  return {
    memberships,
    organizations: records.organizations.filter((o) =>
      memberships.some((m) => m.organizationId === o.id),
    ),
  };
}
function admin(records: Records, uid: string, organizationId: string) {
  if (
    !records.memberships.some(
      (m) =>
        m.personId === uid &&
        m.organizationId === organizationId &&
        m.role === "admin",
    )
  )
    throw new OrganizationError(
      403,
      "Only this organization's admins can manage members.",
    );
}
/** Organization records remain separate from the canonical event/user dataset. */
abstract class BaseOrganizationStore implements OrganizationStore {
  protected abstract read(): Promise<Records>;
  protected abstract update<T>(fn: (records: Records) => T): Promise<T>;
  async snapshot(uid: string) {
    return snapshot(await this.read(), uid);
  }
  create(uid: string, input: OrganizationInput) {
    return this.update((records) => {
      const now = new Date().toISOString();
      const organization = {
        ...input,
        id: `org-${randomUUID()}`,
        created_at: now,
      };
      records.organizations.push(organization);
      records.memberships.push({
        id: `membership-${randomUUID()}`,
        organizationId: organization.id,
        personId: uid,
        role: "admin",
        joined_at: now,
      });
      return snapshot(records, uid);
    });
  }
  async members(uid: string, organizationId: string) {
    const records = await this.read();
    admin(records, uid, organizationId);
    return records.memberships.filter(
      (m) => m.organizationId === organizationId,
    );
  }
  invite(
    uid: string,
    organizationId: string,
    email: string,
    role: "admin" | "member",
  ) {
    return this.update((records) => {
      admin(records, uid, organizationId);
      const token = randomBytes(32).toString("hex");
      const invitation: OrganizationInvitation = {
        token,
        organizationId,
        email: email.trim().toLowerCase(),
        role,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
      const { token: _token, ...stored } = invitation;
      // Retain consumed invites for same-user idempotency, prune expired ones on writes.
      for (const [key, value] of Object.entries(records.invitations))
        if (Date.parse(value.expires_at) <= Date.now())
          delete records.invitations[key];
      records.invitations[hash(token)] = stored;
      return invitation;
    });
  }
  join(uid: string, email: string | null, verified: boolean, token: string) {
    return this.update((records) => {
      if (!email || !verified)
        throw new OrganizationError(
          403,
          "Verify your sign-in email before accepting an invitation.",
        );
      const invite = records.invitations[hash(token)];
      if (!invite || Date.parse(invite.expires_at) <= Date.now())
        throw new OrganizationError(
          400,
          "This invitation has expired or is invalid.",
        );
      if (invite.email !== email.trim().toLowerCase())
        throw new OrganizationError(
          403,
          "Sign in with the email invited to this organization.",
        );
      if (invite.consumedBy && invite.consumedBy !== uid)
        throw new OrganizationError(
          409,
          "This invitation has already been used.",
        );
      if (!records.organizations.some((o) => o.id === invite.organizationId))
        throw new OrganizationError(404, "Organization not found.");
      const member = records.memberships.find(
        (m) => m.personId === uid && m.organizationId === invite.organizationId,
      );
      if (!member)
        records.memberships.push({
          id: `membership-${randomUUID()}`,
          organizationId: invite.organizationId,
          personId: uid,
          role: invite.role,
          joined_at: new Date().toISOString(),
        });
      else if (invite.role === "admin") member.role = "admin";
      invite.consumedBy = uid;
      return snapshot(records, uid);
    });
  }
}
export class FileOrganizationStore extends BaseOrganizationStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private filename: string) {
    super();
  }
  private async load(): Promise<Records> {
    try {
      return JSON.parse(await readFile(this.filename, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }
  protected async read() {
    await this.queue;
    return this.load();
  }
  protected update<T>(fn: (records: Records) => T): Promise<T> {
    const job = this.queue.then(async () => {
      const records = await this.load();
      const result = fn(records);
      await mkdir(dirname(this.filename), { recursive: true });
      await writeFile(`${this.filename}.tmp`, JSON.stringify(records), {
        mode: 0o600,
      });
      await rename(`${this.filename}.tmp`, this.filename);
      return result;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}
export class FirestoreOrganizationStore implements OrganizationStore {
  constructor(
    private db: Firestore,
    private document = "organizationWorkspaces/main",
  ) {}
  private ref(collection: string, id: string) {
    return this.db.doc(`${this.document}/${collection}/${id}`);
  }
  private memberRef(uid: string, organizationId: string) {
    return this.ref("memberships", hash(`${organizationId}\0${uid}`));
  }
  private async requireAdmin(
    tx: Transaction,
    uid: string,
    organizationId: string,
  ) {
    const member = (
      await tx.get(this.memberRef(uid, organizationId))
    ).data() as OrganizationMembership | undefined;
    if (member?.role !== "admin")
      throw new OrganizationError(
        403,
        "Only this organization's admins can manage members.",
      );
  }
  async snapshot(uid: string): Promise<OrganizationSnapshot> {
    return this.db.runTransaction(
      async (tx) => {
        const found = await tx.get(
          this.db
            .collection(`${this.document}/memberships`)
            .where("personId", "==", uid),
        );
        const memberships = found.docs.map(
          (doc) => doc.data() as OrganizationMembership,
        );
        const organizations = await Promise.all(
          memberships.map(
            async (m) =>
              (
                await tx.get(this.ref("organizations", m.organizationId))
              ).data() as Organization | undefined,
          ),
        );
        return {
          memberships,
          organizations: organizations.filter((o): o is Organization => !!o),
        };
      },
      readOnlySnapshot(),
    );
  }
  async create(uid: string, input: OrganizationInput) {
    const now = new Date().toISOString();
    const organization = {
      ...input,
      id: `org-${randomUUID()}`,
      created_at: now,
    };
    const ref = this.memberRef(uid, organization.id);
    await this.db.runTransaction(async (tx) => {
      tx.set(this.ref("organizations", organization.id), organization);
      tx.set(ref, {
        id: ref.id,
        organizationId: organization.id,
        personId: uid,
        role: "admin",
        joined_at: now,
      });
    });
    return this.snapshot(uid);
  }
  async members(uid: string, organizationId: string) {
    return this.db.runTransaction(
      async (tx) => {
        await this.requireAdmin(tx, uid, organizationId);
        const found = await tx.get(
          this.db
            .collection(`${this.document}/memberships`)
            .where("organizationId", "==", organizationId),
        );
        return found.docs.map((doc) => doc.data() as OrganizationMembership);
      },
      readOnlySnapshot(),
    );
  }
  async invite(
    uid: string,
    organizationId: string,
    email: string,
    role: "admin" | "member",
  ) {
    const token = randomBytes(32).toString("hex");
    const invitation: OrganizationInvitation = {
      token,
      organizationId,
      email: email.trim().toLowerCase(),
      role,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
    await this.db.runTransaction(async (tx) => {
      await this.requireAdmin(tx, uid, organizationId);
      const { token: _token, ...stored } = invitation;
      tx.set(this.ref("invitations", hash(token)), stored);
    });
    return invitation;
  }
  async join(
    uid: string,
    email: string | null,
    verified: boolean,
    token: string,
  ) {
    if (!email || !verified)
      throw new OrganizationError(
        403,
        "Verify your sign-in email before accepting an invitation.",
      );
    await this.db.runTransaction(async (tx) => {
      const invitationRef = this.ref("invitations", hash(token));
      const invite = (await tx.get(invitationRef)).data() as
        StoredInvitation | undefined;
      if (!invite || Date.parse(invite.expires_at) <= Date.now())
        throw new OrganizationError(
          400,
          "This invitation has expired or is invalid.",
        );
      if (invite.email !== email.trim().toLowerCase())
        throw new OrganizationError(
          403,
          "Sign in with the email invited to this organization.",
        );
      if (invite.consumedBy && invite.consumedBy !== uid)
        throw new OrganizationError(
          409,
          "This invitation has already been used.",
        );
      const ref = this.memberRef(uid, invite.organizationId);
      const [member, organization] = await Promise.all([
        tx.get(ref),
        tx.get(this.ref("organizations", invite.organizationId)),
      ]);
      if (!organization.exists)
        throw new OrganizationError(404, "Organization not found.");
      // All reads precede writes. Token + deterministic membership are committed together.
      if (!member.exists)
        tx.set(ref, {
          id: ref.id,
          organizationId: invite.organizationId,
          personId: uid,
          role: invite.role,
          joined_at: new Date().toISOString(),
        });
      else if (invite.role === "admin" && member.get("role") !== "admin")
        tx.set(ref, { ...member.data(), role: "admin" });
      tx.set(invitationRef, { ...invite, consumedBy: uid });
    });
    return this.snapshot(uid);
  }
}
