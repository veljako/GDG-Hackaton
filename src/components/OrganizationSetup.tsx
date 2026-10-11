import { useEffect, useState } from "react";
import type { Person } from "../types";
import type {
  Organization,
  OrganizationMembership,
  OrganizationMember,
  OrganizationInvitation,
} from "../organizations";
import {
  createOrganization,
  joinOrganization,
  getOrganizations,
  getOrganizationMembers,
  inviteOrganizationMember,
  sendVerificationEmail,
  refreshEmailVerification,
} from "../backend";
import { BRAND } from "../config";
import { Button, Field } from "./ui";
import "../organization.css";

type Props = {
  person: Person;
  invite?: string;
  organizations: Organization[];
  memberships: OrganizationMembership[];
  onRefresh: () => Promise<void>;
  onWorkspace: () => Promise<void>;
  onAttendee: () => Promise<void>;
  logout: () => Promise<void>;
};
export function OrganizationSetup({
  person,
  invite = "",
  organizations: initialOrganizations,
  memberships: initialMemberships,
  onRefresh,
  onWorkspace,
  onAttendee,
  logout,
}: Props) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [memberships, setMemberships] = useState(initialMemberships);
  const [tab, setTab] = useState(
    invite ? "join" : initialOrganizations.length ? "manage" : "create",
  );
  const [token, setToken] = useState(invite);
  const [selected, setSelected] = useState(initialOrganizations[0]?.id ?? "");
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitation, setInvitation] = useState<OrganizationInvitation | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(person.email_verified ?? false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const admin = memberships.some(
    (m) =>
      m.organizationId === selected &&
      m.personId === person.id &&
      m.role === "admin",
  );
  useEffect(() => {
    let active = true;
    void getOrganizations()
      .then((next) => {
        if (!active) return;
        setOrganizations(next.organizations);
        setMemberships(next.memberships);
        setSelected((id) => id || next.organizations[0]?.id || "");
        if (!invite && next.organizations.length) setTab("manage");
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [person.id, invite]);
  useEffect(() => {
    setMembers([]);
    setInvitation(null);
    setCopied(false);
    if (!admin || !selected) return;
    let active = true;
    setMembersLoading(true);
    void getOrganizationMembers(selected)
      .then((next) => {
        if (active) setMembers(next.members);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setMembersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, admin]);
  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saved(next: {
    organizations: Organization[];
    memberships: OrganizationMembership[];
  }) {
    setOrganizations(next.organizations);
    setMemberships(next.memberships);
    setSelected(next.organizations[0]?.id ?? "");
    await onWorkspace();
  }
  const invitationLink = invitation
    ? `${window.location.origin}${window.location.pathname}#/organizations?invite=${encodeURIComponent(invitation.token)}`
    : "";
  return (
    <main className="organization-gate">
      <div className="organization-topbar">
        <a href="#/" aria-label={`${BRAND.name} home`}>
          <img src={BRAND.icon} alt="" width="32" height="32" />
          {BRAND.name}
        </a>
        <button disabled={busy} onClick={() => void logout()}>
          Sign out
        </button>
      </div>
      <section className="organization-content" aria-busy={busy || loading}>
        <div className="organization-heading">
          <span className="organization-eyebrow">Your community, together</span>
          <h1>Make room for your next event.</h1>
          <p>
            Create an organization or join the people you already work with.
            Everyone can draft events; admins approve them before they go live.
          </p>
        </div>
        <div
          className="organization-tabs"
          role="tablist"
          aria-label="Organization setup"
        >
          {[
            ["create", "Create organization"],
            ["join", "Join organization"],
            ...(organizations.length ? [["manage", "Your organizations"]] : []),
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`organization-${id}`}
              disabled={busy}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p className="organization-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="organization-message" role="status">
            {message}
          </p>
        )}
        {loading ? (
          <p role="status">Loading your organizations…</p>
        ) : (
          <div
            className="organization-panel"
            id={`organization-${tab}`}
            role="tabpanel"
          >
            {tab === "create" && (
              <form
                id="organization-create-form"
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void perform(async () =>
                    saved(
                      await createOrganization({
                        name: String(data.get("name")).trim(),
                        website: String(data.get("website")).trim(),
                        city: String(data.get("city")).trim(),
                        description: String(data.get("description")).trim(),
                      }),
                    ),
                  );
                }}
              >
                <h2>A home for the events you host</h2>
                <p className="form-note">
                  You’ll become the organization’s admin. You can invite
                  colleagues after creating it.
                </p>
                <Field label="Organization name">
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    placeholder="e.g. Belgrade Science Society"
                    disabled={busy}
                  />
                </Field>
                <div className="form-columns">
                  <Field label="Website (optional)">
                    <input
                      name="website"
                      type="url"
                      maxLength={300}
                      placeholder="https://"
                      disabled={busy}
                    />
                  </Field>
                  <Field label="City">
                    <input
                      name="city"
                      required
                      maxLength={100}
                      placeholder="Belgrade"
                      disabled={busy}
                    />
                  </Field>
                </div>
                <Field label="About your organization">
                  <textarea
                    name="description"
                    required
                    maxLength={1000}
                    rows={3}
                    placeholder="What brings your community together?"
                    disabled={busy}
                  />
                </Field>
                <p className="form-note">
                  This creates your workspace. It does not verify your
                  organization’s legal or business status.
                </p>
                <Button form="organization-create-form" disabled={busy}>
                  {busy ? "Creating organization…" : "Create organization"}
                </Button>
              </form>
            )}
            {tab === "join" && (
              <form
                id="organization-join-form"
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () =>
                    saved(await joinOrganization(token.trim())),
                  );
                }}
              >
                <h2>Join your organization</h2>
                <p>
                  Ask an admin for an invitation link or token. Invitations work
                  once, expire, and are tied to your email.
                </p>
                <Field label="Invitation token">
                  <input
                    value={token}
                    onChange={(e) => {
                      const value = e.target.value;
                      try {
                        setToken(
                          new URLSearchParams(
                            new URL(value).hash.split("?")[1],
                          ).get("invite") ?? value,
                        );
                      } catch {
                        setToken(value);
                      }
                    }}
                    required
                    autoComplete="off"
                    disabled={busy}
                  />
                </Field>
                <p className="form-note">
                  Signed in as {person.email ?? person.name}.
                </p>
                {!verified && (
                  <div className="organization-verification">
                    <h3>Verify your email to join</h3>
                    <p>Open the verification email, then check again here.</p>
                    <div className="organization-actions">
                      <Button
                        variant="outlined"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await sendVerificationEmail();
                            setMessage(
                              "Verification email sent. Check your inbox.",
                            );
                          })
                        }
                      >
                        Send verification email
                      </Button>
                      <Button
                        variant="text"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            const next = await refreshEmailVerification();
                            const user = next.state.people.find(
                              (p) => p.id === next.state.currentPersonId,
                            );
                            setVerified(user?.email_verified ?? false);
                            await onRefresh();
                            setMessage(
                              user?.email_verified
                                ? "Your email is verified. You can join now."
                                : "Your email is not verified yet. Open the link in your email, then check again.",
                            );
                          })
                        }
                      >
                        I’ve verified my email
                      </Button>
                    </div>
                  </div>
                )}
                <Button
                  form="organization-join-form"
                  disabled={busy || !verified}
                >
                  {busy ? "Joining organization…" : "Join organization"}
                </Button>
              </form>
            )}
            {tab === "manage" && (
              <div className="form-stack">
                <h2>Your organizations</h2>
                <Field label="Organization">
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    disabled={busy}
                  >
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="form-note">
                  {admin
                    ? "Admin · Review event drafts and invite your colleagues."
                    : "Member · Draft events and submit them for admin approval."}
                </p>
                <Button
                  disabled={busy}
                  onClick={() => void perform(onWorkspace)}
                >
                  Open organizer workspace
                </Button>
                {admin && (
                  <>
                    <hr />
                    <h3>Organization members</h3>
                    {membersLoading ? (
                      <p role="status">Loading members…</p>
                    ) : (
                      <ul className="organization-members">
                        {members.map((member) => (
                          <li key={member.id}>
                            <span>
                              <strong>{member.name}</strong>
                              <small>{member.email}</small>
                            </span>
                            <span>
                              {member.role === "admin" ? "Admin" : "Member"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form
                      id="organization-invite-form"
                      className="form-stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        void perform(async () => {
                          const result = await inviteOrganizationMember(
                            selected,
                            String(data.get("email")),
                            data.get("role") as "admin" | "member",
                          );
                          setInvitation(result.invitation);
                          setCopied(false);
                          setMessage(
                            "Invitation created. Share it with the colleague below.",
                          );
                        });
                      }}
                    >
                      <h3>Invite a colleague</h3>
                      <div className="form-columns">
                        <Field label="Colleague’s email">
                          <input
                            name="email"
                            type="email"
                            required
                            maxLength={254}
                            disabled={busy}
                          />
                        </Field>
                        <Field label="Role">
                          <select name="role" disabled={busy}>
                            <option value="member">
                              Member · Draft events
                            </option>
                            <option value="admin">
                              Admin · Approve events
                            </option>
                          </select>
                        </Field>
                      </div>
                      <Button form="organization-invite-form" disabled={busy}>
                        {busy ? "Creating invitation…" : "Create invitation"}
                      </Button>
                    </form>
                    {invitation && (
                      <div className="organization-invitation">
                        <p>
                          For <strong>{invitation.email}</strong> · expires{" "}
                          {new Date(invitation.expires_at).toLocaleString()}
                        </p>
                        <Field label="Invitation link">
                          <input
                            readOnly
                            value={invitationLink}
                            onFocus={(e) => e.target.select()}
                          />
                        </Field>
                        <Button
                          disabled={busy}
                          variant="outlined"
                          onClick={() =>
                            void perform(async () => {
                              if (!navigator.clipboard?.writeText) {
                                setMessage(
                                  "Select and copy the invitation link above.",
                                );
                                return;
                              }
                              try {
                                await navigator.clipboard.writeText(
                                  invitationLink,
                                );
                                setCopied(true);
                              } catch {
                                setMessage(
                                  "Select and copy the invitation link above.",
                                );
                              }
                            })
                          }
                        >
                          {copied ? "Link copied" : "Copy invitation link"}
                        </Button>
                        <p className="form-note">
                          No invitation email is sent. Share this link yourself.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <button
          className="organization-attendee"
          disabled={busy}
          onClick={() => void perform(onAttendee)}
        >
          Continue as an attendee
        </button>
      </section>
    </main>
  );
}
