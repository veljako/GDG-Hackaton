# Organizations and event hosting

GEvents uses one personal Firebase account for attending and hosting. Organization membership grants access to that organization's organizer workspace. It does not grant access to another organization's events or bypass attendee CV setup.

The signup screen offers Join events and Host with an organization. Hosting leads to organization registration or an invitation. Existing signed-in users can open Organizations. Registering an organization creates its first admin membership. Organizations have a name, city, description and optional website; registration is not legal/business verification.

Admins create email-bound invitation links. Invites expire after seven days, are consumed once, and require the invited person's authenticated, verified email. Only token hashes are persisted. No invitation emails are sent automatically: admins copy and share the link themselves. Member lists and emails are private to organization admins.

Every member can draft an event and submit it for approval. Admins approve publication or return it to a draft. Members cannot directly publish, edit another person's draft, change event ownership, or review attendee applications. Admins manage events and applications within their own organization. The event displays the stored organization name rather than arbitrary organizer text from a form.

Attendee CV onboarding remains mandatory before participating. A person whose CV setup is incomplete can still register/join an organization and use its hosting workspace; switching back to attending resumes their CV setup. Such profiles remain excluded from attendee discovery and matching candidates. Approved events can still enter the event matching pipeline.

Legacy configured organizers and existing unowned events remain compatible. Google/email authentication and ranking/model contracts remain unchanged. Login and password recovery do not show signup progress or CV instructions.

## Storage and API

Organization data is private and separate from the canonical attendee/event dataset. Firestore stores individual organization, membership and invitation documents under `organizationWorkspaces/main`; local file mode uses a separate organizations file. Invitation redemption and membership creation are transactional. Organizations and memberships are server-owned; profile updates cannot promote a user.

- `GET /api/organizations`: current person's organizations and memberships.
- `POST /api/organizations`: register an organization and its first admin.
- `GET /api/organizations/:id/members`: admin-only member list.
- `POST /api/organizations/:id/invitations`: create an admin/member invitation.
- `POST /api/organizations/join`: redeem an invitation for the signed-in identity.
- `SUBMIT_EVENT_FOR_APPROVAL`: submit the creator's draft.
- `REVIEW_EVENT_PUBLICATION`: organization-admin approval or rejection.

The browser preserves hosting intent and invitation links through authentication. The attendee and hosting paths use the same account; there is no browser-selected organizer privilege.

## Verification on 11 October 2026

163 Node tests, frontend/server TypeScript checks, the production build, and six Python candidate-boundary regressions pass. Production browser fixtures pass at 1440px and 390px for attendee onboarding, login/recovery, organization creation/resume, invitation links, email verification controls, clipboard fallback, member drafts/submission, admin approval, and returning to mandatory attendee CV setup. The existing-account host choice survives switching from registration to email sign-in and reloading.

The fresh review caught and resolved legacy-organizer visibility of another organization's drafts/application text and dropped hosting intent on login. Authenticated HTTP and browser regressions cover those failures. Live isolated Firestore verification exercised organization creation, invitations, replay, admin promotion and private readback; its fictional records were deleted afterward. Browser authentication uses fixtures and does not claim a real Google OAuth account was created.

The current local API and production frontend were restarted and checked at localhost and the existing temporary public tunnel. API health returns 200; unauthenticated organization and onboarding reads return 401. The mock CV download remains available. These are local preview changes, not a permanent cloud deployment.

The Google button uses the official asset and a restrained outlined treatment based on [Google's branding reference](https://developers.google.com/identity/branding-guidelines).
