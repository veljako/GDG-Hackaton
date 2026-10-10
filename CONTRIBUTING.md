# Team workflow

Use Node.js 22 and install the locked dependencies with `npm ci` (`npm.cmd ci` on Windows). Copy `.env.example` to `.env.server.local` for local settings. Keep credentials and real user data out of Git.

Create a feature branch from the latest default branch. Use short names such as `feat/event-discovery`, `fix/invitation-deadline`, or `docs/firebase-setup`. Keep one concern per commit and use Conventional Commit messages: `feat(events): add topic filters`, `fix(teams): enforce invitation deadlines`, `test(api): cover authorization`, or `docs(setup): explain Firebase credentials`.

Before publishing, run `npm run check`, `node --test scripts/deploy-hosting.test.mjs`, and `git diff --check`. CI runs these checks for pushes and pull requests. Browser verification is documented in the README; mutation scripts require an isolated fictional demo workspace.

Open a pull request against the team's default branch with the problem, resulting behavior, and verification results. Ask a teammate to review it. Agree on ownership of overlapping files before editing and coordinate changes to shared types and API contracts. Preserve meaningful semantic commits when integrating work.

Fetch before updating a shared branch. Resolve conflicts locally and rerun the checks. Do not force-push a teammate's branch or rewrite shared history. Repository owners can enable required CI and review checks in GitHub branch protection.
