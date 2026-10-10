# Playful GEvents polish

Goal: Extend the existing Google-colored geometric identity into a warmer, more engaging app, as requested by the user.

- Add a noninteractive, responsive SVG background with arches, rings, triangles and small accents; keep opaque reading surfaces.
- Add a shared shape cluster to the hero and community invitation. Emphasize the hero's final word with a hand-drawn underline.
- Add a four-shape CSS loader to real lazy route imports via React Suspense. Do not introduce artificial delays. Show an initial HTML loader while the app bundle loads.
- Refine navigation color, card elevation and pointer feedback; honor reduced motion and touch devices.
- Run domain tests and production build. Check real loading under delayed requests, desktop/mobile layout, keyboard controls and existing app flows with Playwright.

Scope: Visual treatment and page-loading feedback. Existing browser-local data and product behavior remain in place. No new dependencies.
