# Event Auto-invite Implementation Plan

**Goal:** Deliver the approved organizer count-based automatic event invitations.

**Architecture:** Add optional event invitation storage and a publication-only server selector using recommendationsFor. Add recipient response transitions and reuse SUBMIT_APPLICATION for admission rules. Render organizer settings/results and attendee invitations.

**Tech Stack:** React, TypeScript, Zod, Vitest, existing file/Firestore repositories, Playwright.

## Constraints

- Preserve existing matching algorithm and team invitation behavior.
- No outreach before publication, no repeat on edits, no email sending.
- Profiles must be complete, opted in, eligible and meet existing relevance gates.
- Invitations do not reserve seats; acceptance rechecks eligibility/deadline/capacity.

## Tasks

- [x] Add failing service tests in server/event-invitations.test.ts for ranked publication, count and shortfall, drafts/approval, edits, authorization, acceptance/review, decline, changed eligibility/deadline/capacity, scoped views, and persisted readback.
- [x] Run `npx.cmd vitest run server/event-invitations.test.ts` and confirm failures demonstrate missing behavior.
- [x] Add EventInvitation, optional DemoState.eventInvitations, GEventsEvent.autoInviteCount, and RESPOND_EVENT_INVITATION in src/types.ts; validate through server/schema.ts and server/dataset.ts. Normalize older states in src/discovery.ts and persist through server/repository.ts collection defaults.
- [x] Add publication selector in server/event-invitations.ts, invoke once in server/service.ts, scope views, and implement recipient responses in src/domain.ts through SUBMIT_APPLICATION.
- [x] Add form checkbox/count and organizer status list in src/pages/Organizer.tsx; add event cards in src/components/EventInvitationCards.tsx and src/pages/Activity.tsx; update badges in src/App.tsx and src/pages/Home.tsx.
- [x] Run focused tests, then `npm.cmd run check`; fix all failures introduced by this feature.
- [x] Add and run scripts/verify-event-auto-invite.mjs against a dedicated local demo server to verify actual creation, organizer results and independent attendee responses at 1440px/390px.
- [x] Review the focused diff and report implemented behavior and verified limits.

## Verification results

- npm.cmd run check: 216 tests passed; server TypeScript check and production build passed.
- node --import tsx scripts/verify-event-auto-invite.mjs: all 5 end-to-end browser checks passed at 1440px and 390px, with no overflow or page errors.
- File persistence and Firestore transaction-double persistence passed; no real invitations or test accounts were created in the live Firebase workspace.
- Existing Firebase preview backend restarted with the updated implementation; local and public current-build/sign-in checks passed at both widths.
- Live backend reports Firebase quota exhaustion, so live database operations remain subject to that provider limit.
