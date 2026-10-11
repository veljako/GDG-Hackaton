# Event auto-invite

User authorization: “Ok do that right now that P0” approves the previously described choose-count, find-suitable-people, automatically-invite flow.

The creation/editor form offers an opt-in checkbox and an integer invite count from 1 through event capacity (maximum 5000). The setting is saved on drafts and runs once on first publication, including organization admin approval. Published events retain immutable outreach settings, so edits never resend invitations.

Use the existing structured recommendation algorithm, content relevance gate, score >= 60 and evidence >= 2. Rank descending by score with person ID as a stable tie-breaker. Only invite completed profiles with matching notifications enabled; exclude publisher, event creator, existing applicants and previously invited people. Send up to the requested count and available event places, without lowering suitability requirements to fill the count. Display actual and requested counts and recipient statuses to the organizer.

Persist event invitations separately from team invitations. Each records event, recipient, sender, status, timestamp and match reasons. Invitation responses are recipient-only. Accept creates an individual application using existing registration/review rules, never a team membership. Recheck registration deadline, eligibility and capacity at acceptance; invitations do not reserve seats. Decline creates no application. Already registered attendees may accept without duplicating their application. Responded invitations cannot be answered twice.

The Activity page displays event invitation cards with match reasons and Accept/Decline, and invitation badges include both types. Scope views to the recipient and authorized organization admins. Existing storage remains compatible through an empty default for older records. Firebase uses a new eventInvitations collection under the existing workspace; all changes remain within the repository transaction. No email delivery is introduced.

Verification covers ranking/count, shortfalls, opt-out and eligibility, draft/admin publication, replay prevention, response authorization, deadline/capacity changes, persistence and privacy. Browser checks cover creation, organizer counts, recipient acceptance/decline, and desktop/mobile rendering.
