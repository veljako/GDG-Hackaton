# GEvents event discovery implementation plan

> For agentic workers: execute inline using executing-plans. Follow test-driven-development and verification-before-completion; requesting-code-review supplies the final independent review.

**Goal:** Business, study and science events with personal recommendations, advanced search and in-app publication notices.

**Architecture:** Extend the existing event model compatibly. Pure discovery functions score allowed events; the server computes private session results and deduplicated notices inside existing repository transactions. Existing forms use the same authenticated API.

**Tech Stack:** React, TypeScript, Node, Zod, Vitest, Playwright; existing Firebase adapter.

## Constraints

No BelPal code changes here. No trained-model claims, email/push sending or ticket payments. Recommendation does not grant admission. Preserve all existing hackathon data and team flows. Publish the verified build through Cloudflare; show the plan inline. This directory has no Git repository, so no commits are possible.

## 1. Domain and discovery

Files: `src/types.ts`, `src/discovery.ts`, `src/discovery.test.ts`, `src/event-domain.test.ts`, `src/domain.ts`.

- [x] Write tests for match reasons/cold start, combined filters, registration and no teams for non-hackathons.
- [x] Run `npm.cmd test -- src/discovery.test.ts src/event-domain.test.ts`; observe missing behavior.
- [x] Add EventKind, goals, private preferences and event audience. Missing kind defaults to hackathon and missing registration defaults to review. `recommendEvent(event, person)` returns score/reasons/evidence; `searchEvents(state, filters, today)` combines all filters.
- [x] Implement individual registration with review or automatic confirmation; disallow non-hackathon teams and changing kind on an event with existing teams.
- [x] Rerun tests, including original domain tests.

## 2. Server preferences and notifications

Files: `server/schema.ts`, `server/service.ts`, `server/discovery.test.ts`, `server/repository.ts`.

- [x] Test first publication, draft privacy, duplicate suppression, opt-out and private preference isolation.
- [x] Run `npm.cmd test -- server/discovery.test.ts`; observe failures.
- [x] Validate new fields; normalize old stored events. Generate notices for score >=60 with >=2 evidence categories, enabled preference, open registration and no existing application. Store deterministic user/event notice identity and publication marker.
- [x] Compute session-only recommendations and remove other people’s private preferences in both attendee and organizer views.
- [x] Run server tests and TypeScript check.

## 3. Frontend and realistic fictional demo

Files: `src/pages/Hackathons.tsx`, `src/pages/Home.tsx`, `src/pages/Profile.tsx`, `src/pages/Organizer.tsx`, `src/components/events.tsx`, `src/components/forms.tsx`, `src/App.tsx`, `src/seed.ts`, `src/discovery.css`.

- [x] Add For you / All events with URL-backed text, kind, topic, city, format, date and availability fields; retain older event URLs.
- [x] Render event type and up to three recommendation reasons; cold start links to profile.
- [x] Profile edits goals/type/format/location/level and opt-in. Organizer edits event kind/audience/registration. Team options appear only for hackathons.
- [x] Add fictional business conference, science meetup and science festival without removing existing events or people.
- [x] Build and run meaningful browser checks for filters, direct routes, registration, profile and publishing across two sessions.

## 4. Review and delivery

- [x] `npm.cmd run check` passes; independent code review issues resolved.
- [x] Rebuild/restart the known public origin and verify actual rendered Cloudflare content on desktop and mobile.
- [x] Record verification, update README and the 46-hour plan. Firebase cloud verification remains pending user configuration.


Verification: 64 tests + server/frontend TypeScript + build; 28 existing workflow checks, 8 backend checks, 10 event checks; 6 read-only Cloudflare checks. Both independent review passes resolved all important findings. Evidence: artifacts/events/verification.json and artifacts/events/public-verification.json. Public origin PID 13768; tunnel PID 16980. Existing fictional records preserved with pre-event-expansion.json backup.
