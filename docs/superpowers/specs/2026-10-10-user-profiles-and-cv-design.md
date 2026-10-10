# User database and CV storage

User-approved scope: finish user persistence, with CV as the import source. LinkedIn import is deferred. This work establishes the database and private file persistence; automatic extraction and the onboarding wizard follow separately.

Canonical documents remain `gdevPilots/main/users/{firebaseAuthUid}`. Preserve existing display names, IDs, preferences, entity relationships and schema-2 recovery snapshots. Add explicit first/last names, authenticated email/verification, private phone, structured education/work history, languages, private CV metadata and server timestamps. Unknown legacy values remain empty or null without inventing name parts or creation dates. Compatible additions retain workspace schema version 3.

Authenticated profile writes validate bounded fields and date periods. Only verified token claims set account email; clients cannot set UID, email, verification, timestamps or CV storage paths. Names collected at signup and profile edits are stored independently and compose the displayed name. Email, phone, timestamps and CV object paths are removed from other users' views, including organizer views.

CV files are PDF-only, at most 5 MiB. Store immutable files outside public assets in demo mode and in an explicitly configured private Cloud Storage bucket in Firebase mode. Ownership uses verified UID, never a submitted person ID. Upload writes the file before committing metadata; failed commits remove the new file. Replacement/removal commits before cleaning the old file. Missing storage returns an actionable error. Downloads require the owner's authenticated session and are attachments with no caching. No public download URL is issued. Extraction status starts at `not_started` because no parser worker runs yet.

Verify validation, identity authority, private views, legacy migration, structured round trips, authenticated upload/download/removal, replacement cleanup, failed writes and browser profile saves at desktop/phone sizes. Cloud activation requires backend credentials, a private bucket and updated deployment; local tests must never be reported as cloud verification.
