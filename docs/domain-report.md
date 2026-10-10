# GEvents domain implementation report

Implemented only `src/seed.ts`, `src/domain.ts`, `src/domain.test.ts` and this report. Shared types/configuration/UI remain owned by the primary agent.

## Delivered

- Twelve fictional people with local avatar paths, believable skills, interests, experience and participant/mentor/speaker/judge roles. Required seed IDs are present, including the portrait IDs sara, nikola, jovan and ivana.
- Four events: GDG Belgrade on 11 October 2026 (hackathon organization theme, teams 2–4), Gemini Build Lab, the online Design for Good Sprint and archived Weekend Build 2025.
- Team 4 starts with accepted Luka and Mila and two unreserved places. Byte Club has accepted members. Sunday Builders has Luka’s pending invitation. Weekend Merge preserves Luka, Marko and Ana’s previous team history.
- All typed actions implemented, including the subsequently added `CANCEL_INVITATION` action. All team members can send/cancel pending invitations; only the recipient can answer. Captain/self/organizer controls membership removal.
- Invitations reserve team places. Pending and accepted applications reserve event places; rejection and withdrawal release event places. Membership and admission stay separate. Only accepted attendees count toward confirmed teams, and confirmed teams remain confirmed with pending candidates.
- A person can belong to only one team per event. Joining declines their competing invitations for that event. New team/reuse/outsider acceptance creates a pending application when one does not exist. Reuse copies team metadata and invites former members without enrolling them or changing history.
- Profile ownership, immutable identity, event bounds, calendar dates, duplicate applications/invitations and invalid IDs are validated. Invalid actions return the original state and an actionable error; successful transitions clone state and return a message plus created ID when relevant.
- Deterministic transition IDs/timestamps support a pure local demo. Notices link to `/hackathons/:id`, `/teams/:id` or `/people`. Connections use lexically sorted IDs joined by `:`.

## Behavioral validation

Tests were written before implementation. Initial contract stubs produced 27 expected failures out of 28; after completing seed fixtures, 26 behavior assertions failed because transitions/helpers were not implemented. Initial implementation then passed all 28 tests.

An additional edge-case pass tested atomic full-event acceptance, competing invitations, withdrawal cleanup, revised organizer decisions, reserved team-size editing, malformed required-field edits, impossible calendar dates, deterministic results and cancellation. Three failures demonstrated the missing cancellation action and two edit-validation defects before their fixes.

Final fresh `npm.cmd test` at 04:40 local time on 10 October 2026:

```text
RUN v5.0.3 C:/GDG
Test Files  1 passed (1)
Tests       37 passed (37)
Duration    217ms
```

Vitest initially hit sandbox `EPERM` resolving local installed files. Running the same local test commands with approved escalation resolved the tool limitation. No test workaround or dependency/config change was made by this agent.

`npx.cmd tsc -p tsconfig.app.json --noEmit` reports only `src/main.tsx(14,17): Cannot find module './App'` while the primary agent is still creating that UI file. No domain/seed/test type errors are reported. Final app build and browser validation belong to the primary agent.

## Explicit policies and limits

- Accepting a team invitation never reverses an existing rejected admission. Such a person joins with visibly rejected attendance; an organizer can revise the application. A fresh outsider instead receives a pending application.
- Withdrawal of a pending team application also removes the candidate’s membership; leaving a team alone preserves admission. Empty teams archive and release outgoing invitations.
- Multiple incoming invitations for different teams are allowed until the recipient chooses one; acceptance releases alternatives and keeps the one-team-per-event invariant.
- Event status controls whether applications/team actions are open. Dates are validated for consistency; the local demo does not run a clock-driven closing scheduler.
- Timestamps use a fixed demo date. CV data and social links are profile metadata only. There is no backend, matching algorithm, actual external invitation or messaging.
