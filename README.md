# GEvents

A business, learning and science event pilot for the GDG Belgrade pitch. Discover hackathons, conferences, meetups and science festivals, with profile-based recommendations and combined search filters. The React interface uses a shared authenticated API for registration, invitations, teams and profiles. Google-inspired colors, Material controls and the geometric team spaces remain. BelPal is a separate product for social activities and entertainment.

The GEvents rename includes the interface, logo, browser metadata, documentation and deployment packages. Existing browser sessions, theme preferences and saved events migrate automatically. Configuration uses `GEVENTS_*`; legacy `GDEV_*` backend and development settings and `GHUB_*` Kaggle secrets remain accepted. The Firebase project ID `gdg-hackathon-d0b85` and existing Firestore namespace `gdevPilots/main` remain stable so the rename keeps existing data connected. New deployment resource defaults use `gevents`; existing cloud resources must retain their configured IDs.

## Launch

Project preview preference: use a public Cloudflare URL for user review, verify the rendered app and API together, and show plans directly in the conversation. Do not treat localhost as the delivered preview. Quick Tunnel links depend on the origin computer and tunnel continuing to run.

Double-click **start-demo.cmd**, or run from this directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Open **http://localhost:5180**. `npm run dev` starts both Vite (5180) and the API (5181). Stop any older process on those ports first. Local demo changes are shared across browsers through `.runtime/backend/state.json`; the file survives server restarts.

`npm.cmd run build` creates `dist`. For preview, run `npm.cmd run server` and `npm.cmd run preview` in separate terminals. The API can also serve `dist` directly: `http://127.0.0.1:5181`. It binds only to localhost by default.

The user-facing preview is delivered through Cloudflare. Its current URL and tunnel/origin PIDs are in `.runtime/cloudflare-backend.json`. The origin serves frontend and API together on port 5191. A Quick Tunnel requires the origin computer and cloudflared process to stay running; a restarted tunnel may have a new URL.

## Firebase preparation

User identity includes explicit first/last names, account email from verified sign-in, private phone, education/work history, languages and server timestamps. PDF CVs persist privately with authenticated upload/download/removal. New attendee accounts complete mandatory CV upload, automatic extraction, editable review, and interests before joining the app or entering matching. See [attendee onboarding](docs/onboarding.md) and [the user database contract](docs/user-database.md).

User storage now uses `gdevPilots/main/users` with the structured location/status/birth_year/experience_level/skills/general_description fields. Separate `userEmbeddings` and `hackathonEmbeddings` collections support supplied native Firestore vectors through the trusted `firebase:vectors` CLI. See [users and vector storage](docs/firebase-vectors.md) for migration, upserts and dimension-specific index setup. No embedding model, automatic generation or live vector index deployment is included.

Follow [Firebase setup](docs/firebase-setup.md) and the [dataset/registration guide](docs/firebase-dataset.md). Configure Firebase public web settings and backend Application Default Credentials, and use `GEVENTS_BACKEND_MODE=firebase`. Google and email/password accounts supply verified identity; organizer UIDs come from server configuration. Account creation and password reset are available in the Firebase gate. Import reviewed samples into an empty workspace before opening registration; demo actor switching and reset are unavailable in Firebase mode. Onboarding requires the configured private CV storage and Gemma worker. Organization onboarding is deferred.

The Firebase adapter and authentication integration are implemented. The owner confirmed that Firestore and sign-in providers exist in `gdg-hackathon-d0b85`; authorized backend credentials and live readback are still required for cloud verification. No Firebase resources were created or deployed from this workstation.

The implementation and hackathon schedule are in [the 46-hour plan](docs/superpowers/plans/2026-10-10-backend-and-46h.md).

## A two-minute walkthrough

1. Start as Luka on Home, then open **Team 4** to show the geometric team space.
2. **Invite a teammate** → search **Žarko** → send the invitation. Team 4 stays confirmed.
3. Click the avatar in the top-right corner. Switch the demo person to **Žarko**, close the controls, and open **My activity**. Accept the invitation; event admission remains pending.
4. Open the avatar controls and choose **Organizer**. Review Žarko under GDG Belgrade, then **Accept applicant**.
5. Switch back to Luka and Attendee. Open Team 4: Žarko is confirmed. This demonstrates the difference between accepting an invitation and getting event admission.
6. Explore Community filters, event discovery, solo applications, profile editing, and **Previous teams → Reunite**.

The avatar controls include **Reset demo** for another clean presentation.

## Included

- Home dashboard, hackathon discovery and detail pages with agenda, attendees, teams, and calendar export.
- Solo applications or applications with a new/previous team; participant, mentor, speaker and judge roles.
- Team creation, invitations by any member, outside invitee applications, organizer review, membership removal, and invitation cancellation.
- Previous-team history and fresh invitations when reusing a team.
- Searchable community, accepted attendees looking for a team, mentors, and local connections.
- Editable profiles with separate first/last names, private PDF CV upload/download/removal, and explicit fictional import previews in demo mode.
- Organizer event creation/editing, review filters, capacity and team-size validation.
- Shared notifications and server persistence; explicit fictional demo actor switching and organizer-only reset.
- Responsive desktop/mobile layouts, accessible dialogs, keyboard focus, and reduced-motion support.

## Demo boundaries

Local demo mode uses fictional sample data on the backend. Demo tokens let you act as sample profiles and are not production user authentication. This mode refuses to start with `NODE_ENV=production`. Firebase mode uses Google or email/password accounts, Firebase ID token verification, server authorization and Firestore transactions. Browsers connected to the same server share invitations, admission decisions and team changes. The API filters private motivations, CV metadata, connections and notifications for attendees.

Event recommendations use deterministic weighted matches of interests, goals, skills, roles/experience and location/format/type. An optional [Gemma matching worker](docs/gemma-matching.md) adds semantic event search, recommendations, teammate retrieval and reviewed CV extraction using Google EmbeddingGemma and native Firestore vectors. The structured recommender remains available when inference is unavailable. Cards show concrete reasons; scores are not probabilities of admission. New publication notices require opt-in, a score of at least 60 and two evidence categories; edits do not repeat a notice. Private discovery preferences are removed from other users' API views, including organizer views. Email/push messaging, LinkedIn/Kaggle OAuth import and code/project upload are not implemented. CV PDFs are stored privately, with a configured Cloud Storage bucket required in Firebase mode. Firestore stores editable entity documents under `gdevPilots/main`, with transactionally consistent workspace reads and a 450 changed-record guard per write/import. This remains a small pilot; measure quota and performance before scaling. Local file persistence supports one server process. State updates poll the API approximately every two seconds; model inference runs only on explicit requests and durable refresh jobs.

`/#/events` supports All events and For you. Advanced filters combine words, type, topic, city, format, date range and available places; the URL preserves the selection. Old `/#/hackathons` routes remain supported. Hackathons retain team workflows. Other event types use individual applications with organizer review or immediate confirmation, always subject to server capacity and registration deadlines. Existing stored events migrate as hackathons without losing teams or applications; `publishedAt: "legacy"` marks already-public records without inventing a publication timestamp.

The lightweight conversation starter is optional and can be replaced later. It is not the core feature.

Dates are fixed sample dates for the October 2026 presentation. Event venues and people are fictional; they do not describe the actual GDG event.

## Checks

```powershell
npm.cmd run check
$env:GEVENTS_URL='http://127.0.0.1:5191'
node scripts/verify-backend.mjs
node scripts/verify.mjs
node scripts/verify-events.mjs
```

The first command runs domain and server tests, frontend/server TypeScript checks and the production build. Backend browser verification exercises separate attendee and organizer sessions, mobile synchronization, failed saves and an empty workspace. The broader browser script tests the existing workflows. Event verification checks discovery, private preferences, individual registration and publication across sessions. Mutation scripts reset fictional data, so use a dedicated test server/data file. For public event verification set `GEVENTS_EVENTS_READONLY=1` and `GEVENTS_URL` to the Cloudflare URL. Evidence and screenshots are saved in `artifacts/`.

Browser verification uses Playwright. On another computer, install Chromium with `npx.cmd playwright install chromium`; the script detects the cached browser on this machine or accepts `GEVENTS_CHROMIUM`. Set `GEVENTS_URL` to test another preview address.

## Where to change things

- `src/config.ts`: temporary app name and brand copy.
- `src/seed.ts`: sample people, events, teams and notices.
- `src/domain.ts`: pure state transitions and team/admission rules.
- `src/store.tsx` and `src/backend.ts`: asynchronous API state, session handling and UI feedback.
- `server/`: request validation, server authorization, local/Firestore repositories and HTTP API.
- `src/pages/`: app screens.
- `src/styles.css`: Google palette, geometric illustrations and responsive layouts.

Built with React, TypeScript, Vite, Material Web, Motion, Phosphor icons and Sonner. Fonts are bundled locally. Sample portraits from Random User are stored locally under `public/avatars`; the demo makes no image/font API requests.
