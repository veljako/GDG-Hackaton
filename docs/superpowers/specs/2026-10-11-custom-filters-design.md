# GEvents custom filters

Design approved by the user on 2026-10-11.

## Outcome

Make filtering feel native to GEvents using its existing geometric identity, typography, light and dark theme tokens, rounded surfaces, and blue selection color.

## Recommended direction

Use shared custom dropdowns and calendars for discovery controls. Native controls with new styling would leave their browser menus unchanged. Showing every dropdown option as chips would consume too much space for topics and event names.

## Event discovery

- Keep search at the top, followed by a clearly styled Filters disclosure with an active-filter count.
- Replace Event type, Topic, and Format selects with themed dropdown menus. Each menu displays the current selection, a chevron, and a checkmark beside the selected option. Long lists scroll within the menu.
- Keep City as a text field so partial city searches remain possible.
- Replace From date and To date browser pickers with compact themed calendars, including month navigation, an explicit selected day, and a clear-date action. Preserve YYYY-MM-DD URL values and the existing end-date minimum and invalid-range feedback.
- Present Available places only and Past events as selectable chips with checkmarks.
- Show removable active-filter chips and Clear filters. Clearing filters retains the For you view. The filter disclosure remains independently collapsible with active filters.
- Keep the existing pending URL-parameter reference and single commit path to preserve combined and rapid updates.

## Shared filters

- Use the same dropdown for the People hackathon filter and Organizer event selector.
- Update the shared Chips component so Activity, Teams, People, and Organizer use consistent spacing, touch targets, blue selected surfaces, checkmarks, and focus states.
- Use the same rounded, themed field treatment for filter text inputs.
- Keep form inputs for registration, onboarding, profile editing, and event creation outside this filter-specific change.

## Interaction and accessibility

Dropdowns support keyboard opening, arrow-key navigation, Home/End, type-ahead, Enter selection, Escape dismissal, and focus restoration. Menus dismiss on outside interaction and do not escape the viewport. Calendar controls have descriptive date names, visible keyboard focus, and keyboard date navigation. Shared filter chips retain native button semantics and aria-pressed. Decorative icons are hidden from assistive technology.

Use existing theme tokens rather than a new palette. Touch targets are at least 44 pixels where practical. Menus fit at 390 pixels and at 320 pixels. Motion is limited to short state transitions and respects reduced motion.

## Verification

Run npm.cmd run check and exercise rendered filters against a dedicated local demo with fictional data. Check combined filters, individual chip removal, clear-all retaining For you, reload persistence, invalid ranges, calendar month changes, dropdown keyboard interaction and dismissal, the People and Organizer selectors, and shared chip bars. Inspect screenshots at 1440 and 390 pixels in light and dark themes, and check for horizontal overflow and browser errors. Do not mutate Firebase or change matching logic.
