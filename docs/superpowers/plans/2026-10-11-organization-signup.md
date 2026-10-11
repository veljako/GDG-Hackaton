# Organization signup and auth polish

Authorized by the user's requested improvements and standing instruction to implement without another spec approval round.

## Design

Login and password recovery have no onboarding steps or CV requirements. Attendee signup retains the four-step CV flow. Google auth gets the official multicolor G, balanced padding, and a clear surface matching Google's current button guidance and the app.

People authenticate using the existing email/Google methods. Organization registration creates a separate organization and a server-owned admin membership. Existing organizations are joined using expiring, single-use, email-bound invitations. Members draft events and submit them for admin approval before publication. Admins manage organization members and only their organization's events. A pending attendee can register an organization and use the organizer workspace; participating as an attendee still requires the CV flow. Organizations do not represent legal/business verification.

Events store organizationId and display the canonical organization name. Existing configured organizers and unowned legacy events remain compatible. Membership and invitation data is private and never accepted through UPDATE_PROFILE. No messages or emails are sent; invitation links are copied by the admin. Model and ranking contracts remain unchanged.

The user confirmed that all organization members may create events with admin approval. Draft creation and submission are available to members; publication approval is restricted to organization admins.

## Tasks

- [x] Backend organization store, routes, membership-derived access and event ownership; meaningful auth/ownership/invite tests.
- [x] Organization signup/setup and member UI, auth intent/resume, navigation, organization event editor and browser contracts.
- [x] Login-only progress removal, official Google asset/button polish, light/dark/mobile inspection.
- [x] Whole-change review, tests, production build, restart the current local host and verify the existing public link.

## Constraints

- Do not publish or merge to master. Preserve the user's test PDF in output/.
- Preserve Firebase identity and existing attendee CV gating.
- Creator is organization admin; ordinary membership never grants global organizer privileges. Members draft/submit; admins approve publication.
- Single-use invites bind to the authenticated, verified email and expire.
- No cross-organization edit, application review, or ownership transfer.
- Existing public preview must be rebuilt/restarted on completion, with actual browser verification.
