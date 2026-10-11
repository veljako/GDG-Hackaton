# Custom filters implementation plan

**Goal:** Give Events and shared filter bars controls that match GEvents.

**Architecture:** Shared select and calendar controls use native popovers for top-layer rendering and light dismissal. Controlled values flow into each page's existing filtering state. The existing event URL commit path stays authoritative.

**Tech stack:** React 19, TypeScript, Phosphor icons, CSS, Vitest, Playwright.

## Constraints

Use existing light/dark theme tokens. Preserve filtering logic and YYYY-MM-DD dates. Keep registration and editing forms outside this change. Use keyboard navigation, visible focus, named controls, and reduced-motion support. Do not mutate Firebase.

## Tasks

- [x] Add and run failing coverage for calendar date arithmetic: leap-month day counts, month transitions, month clamping, and ISO values using local dates.
- [x] Implement calendar helpers, shared popover positioning, CustomSelect, and DateFilter. Menus stay inside viewport bounds; selections close and restore trigger focus; outside clicks and Escape dismiss.
- [x] Replace event dropdowns and date fields. Add a controlled Filters disclosure, active count, removable chips, selectable boolean filters, and invalid-date feedback. Preserve pendingParams and commitParams.
- [x] Replace People and Organizer filter selects, and polish shared Chips for Activity, Teams, People, and Organizer.
- [x] Run npm.cmd run check. Exercise actual combined filters, reload, clear, date bounds, rapid changes, keyboard navigation, light dismissal, and shared filter bars on a dedicated fictional demo.
- [x] Inspect 1440px and 390px screenshots in both themes; check 320px reflow, browser errors, and overflow. Review the final diff and leave the feature branch ready for review.

## Verification commands

`npm.cmd test -- src/components/calendar.test.ts` first fails before the helpers exist, then passes after implementation.

`npm.cmd run check` must pass the test suite, server type checking, and production build.

`node scripts/verify-filters.mjs` exercises the approved filters against a dedicated local demo; screenshots and results go to artifacts/filters.

## Results

All 193 tests, server type checking, and the production build pass. Custom-filter browser checks pass at 1440, 390, and 320 pixels in light and dark themes with no page or console errors. Existing event discovery and organization browser checks pass against an isolated local demo. Independent review identified a malformed URL date focus bug; its reproduction failed before the fix and passes after date validation. No remaining review findings.
