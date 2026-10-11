# GEvents local demo

User approved implementation after the planning discussion. Build a polished browser-only React app in C:/GDG with fictional seed data. Algorithm development and Firebase are deferred. The social mini-feature is optional and replaceable.

## Product flows
- Solo applications and applications associated with a new or previous team.
- Organizer creates/edits events and individually approves/rejects applications.
- Every team member may invite any profile, including a person not accepted to the event.
- Accepted invitees join immediately; outsiders accept and apply, remaining visibly pending until organizer approval.
- A confirmed team retains its status while a candidate awaits approval. Attendance approval is independent of invitation acceptance.
- Reusing a previous team creates invitations for the previous members; it never silently enrolls them.
- Profiles support participants, prospective mentors, speakers and judges; editable skills/experience and fictional import previews.
- Browser-local persistence, role/person switching, demo reset and notification feedback.

## Design
GEvents is a temporary name in a central branding configuration. Light Google-inspired Material 3 interface. Palette: #4285F4, #EA4335, #FBBC05, #34A853 with neutral text and pale surfaces. User's notebook sketch is the signature interactive team view: differently shaped colored people connected around Team 4. Use quiet lists for organizer review and richer diagrams for team details. Responsive sidebar on desktop and bottom navigation on mobile. Fast state-driven animations, keyboard focus and reduced-motion support.

## Rules
Event-specific capacity and team size bounds. Invitations reserve open places to avoid overbooking. Duplicate invitations/applications are rejected. Only accepted applicants count as confirmed team members; teams below minimum accepted membership remain forming. Applicants may withdraw pending applications; organizer can change review decisions. Every state error is surfaced as actionable feedback.

## Acceptance
Runs via npm run dev at localhost:5180. Build and domain tests pass. Browser verification at 1440x1000 and 390x844 covers discovery, solo application, organizer approval, new team creation, outside invitation/acceptance/admission, team reuse, profile edit and persistence/reset. No browser errors or horizontal overflow. All principal visible controls perform an action.
