# GEvents Pitch and Guided Tour Implementation Plan

> Execute sequentially in this session. The user explicitly requested one-shot completion and immediate branch publication.

**Goal:** Deliver a rehearsable pitch, editable deck, and actual application spotlight tutorial.

**Architecture:** A portal overlay consumes a pure tour definition and viewport geometry helpers. Existing routes and session view switching supply actual content. A separate local demo supplies screenshots and video for an Artifact Tool deck.

**Tech Stack:** React, TypeScript, CSS, Vitest, Playwright, Artifact Tool.

## Global constraints

- Use `feat/gevents-pitch-tour`, based on clean `2e05d88`.
- Preserve the matching algorithms, canonical records and existing launch animation.
- No invented interviews, paying customers, production accuracy or live deployment.
- English script, 405-second core budget, optional extension to 450 seconds.
- Live tour, silent recording, and static slides share the same narration.

## Task 1: Spotlight tutorial

- [x] Create `src/components/tour-model.ts` and failing `tour-model.test.ts` for permission selection, playback duration and geometry bounds.
- [x] Implement `src/components/GuidedTour.tsx` and `guided-tour.css` with measured SVG mask, keyboard/focus lifecycle, loading fallback and explicit playback.
- [x] Add a header trigger and stable `data-tour` anchors to existing views without changing business behavior.
- [x] Run model tests and actual desktop/mobile browser checks through `scripts/verify-guided-tour.mjs`.

## Task 2: Pitch package

- [x] Author `presentation/pitch.json` as the shared source of slide text, spoken script, optional lines and cues.
- [x] Generate `presentation/PRESENTER-SCRIPT.md` with timestamps and criteria coverage.
- [x] Record the actual fictional app tour and capture screenshots.
- [x] Build an editable PowerPoint through `scripts/build-pitch.mjs`, validate its package and inspect each rendered slide.
- [x] Write `presentation/README.md` covering live, video, static, seven-minute and eight-minute presentation scenarios.

## Task 3: Publication

- [x] Run `npm.cmd run check`, browser verification, deck validation and video metadata verification.
- [x] Commit only this feature and its presentation package.
- [x] Push `feat/gevents-pitch-tour` to origin and verify the remote commit.
- [x] Deliver clickable deck, script, video and branch links.
