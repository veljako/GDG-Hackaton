# Firebase data and real-user registration

Requested scope: move the current mock dataset into Firebase, enable real users to register, and defer onboarding until the team prepares its dataset.

Use the existing server API, Firebase Auth and Admin SDK rather than adding a second backend. Email/password registration and login join existing Google login; passwords go directly to Firebase Auth and never to the application API. Registration creates one profile per verified Firebase UID. Sample people are dataset records only and never receive passwords or organizer permissions. Authentication errors must be readable, and a successful Auth login whose API call fails must offer a retry without creating another account.

Persist each entity as an editable document under `gdevPilots/main/{people,events,teams,applications,invitations,notifications,connections}`. Server transactions read a consistent workspace and apply only changed documents. Keep metadata in the parent and support migration from the existing payload document while retaining a legacy backup. The API remains the permission boundary; direct browser Firestore access stays denied. This remains a small pilot: transactions read the workspace and API polling is unchanged, so this is not a claim of large-scale readiness.

Provide an explicit, dry-run-by-default import command, selecting the configured project and either the source seed or an existing local demo snapshot. Import only into an empty workspace, validate identifiers and references, and reject rather than overwrite existing real data. Produce a source dataset JSON the team can inspect. Do not automatically seed on registration or server startup.

Keep new profiles minimal with empty interests/skills. No onboarding wizard, dataset-driven profile defaults, or trained model is included.

Validation: tests for transaction persistence, legacy migration, import refusal and reference validation, Firebase UID ownership and role authorization; frontend registration SDK failure/retry behavior; full existing checks; desktop/mobile registration gate rendered with an isolated test API. Real cloud acceptance additionally requires account access, enabled Auth providers, backend ADC, import/readback and real-user sign-in from an authorized hostname.

Alternatives considered: retaining the JSON payload is smaller but prevents practical dataset editing; browser-direct Firestore would replace existing authorization and requires a broader redesign. Editable collections through the existing API best fit the team's next step.
