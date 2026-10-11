# GEvents pitch and guided tour

The user authorized a one-shot implementation, a separate branch, and immediate publication. The clean checkout at `2e05d88` is the base of `feat/gevents-pitch-tour`.

## Deliverables

- English presenter script with a 6:45 core, optional 45-second expansion, a criterion/evidence map, and live/video/static fallback cues.
- Editable 16:9 PowerPoint using GEvents colors and actual application screenshots. Speaker notes contain the script and source disclosures.
- Opt-in guided app tour: dark surrounding mask, measured spotlight, contextual captions, keyboard/manual navigation, explicit timed playback, and a URL entry point.
- Silent recorded walkthrough of the real fictional demo for presenter narration, plus playback instructions. The existing brand launch remains the opening.

## Tour behavior

Navigate across existing profile, event discovery, matching reasons, community/team, organizer and activity views. Organizer steps require existing permission. Mode switching changes only the current session view and restores the original view on exit. Never submit a profile, publish an event, send an invitation, admit someone, reset shared data, switch identity, or manufacture matching results.

Render through a body portal. Make the underlying app inert during the tour. Focus stays in the dialog and returns to its trigger. Escape exits, arrows step, and playback pauses when the page becomes hidden. Respect reduced motion, lazy route loading, resized windows and mobile screens. A missing target has an explicit contextual fallback rather than waiting forever.

## Pitch claims

The algorithm is the central story. Distinguish technical diagnostics on synthetic data from real user research. Present pricing, revenue and cost numbers as hypotheses, never traction. Google technologies reflect code and local evidence; deployment and scalability remain qualified. The recording explicitly identifies fictional data and structured demo recommendations.

## Verification

The user subsequently requested a more playful tour in the app's design. Reuse `BrandGeometry`, the existing blue/yellow/coral/mint tokens, bold typography and asymmetric hero corners. Keep narration panels tied to the app's light/dark surface colours. Shorten tour copy and use brief step/press feedback with reduced-motion support. Refresh the recorded tour, screenshots and embedded deck video without changing pitch timing or claims.

Test viewport geometry and permission-sensitive step selection. Verify the actual running tutorial at desktop and mobile sizes, including focus, exit/restore, playback, empty states and missing targets. Run full application checks before committing. Validate PPTX integrity, render and inspect every slide, verify script word count and video duration. Push only the requested feature branch and verify the remote SHA.
