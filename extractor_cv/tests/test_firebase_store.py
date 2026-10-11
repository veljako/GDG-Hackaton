"""Offline Firestore regressions using the real Firebase transaction decorator."""

import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from google.api_core.exceptions import Aborted
from firebase_admin import firestore

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import firebase_store as store


class Snapshot:
    def __init__(self, value):
        self.exists = value is not None
        self._value = copy.deepcopy(value)

    def to_dict(self):
        return copy.deepcopy(self._value)


class Reference:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def get(self, *, transaction=None):
        if transaction is None:
            raise AssertionError("All authorization reads must be transactional")
        if transaction.writes:
            raise AssertionError("Firestore transactions must read before writing")
        return Snapshot(self.db.documents.get(self.path))

    def set(self, *args, **kwargs):
        raise AssertionError("Writes must use the transaction")

    update = delete = set


class Collection:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, doc_id):
        return Reference(self.db, self.path + "/" + doc_id)


class TransactionDouble:
    """Implements the SDK transaction boundary, including an aborted-write retry."""
    _read_only = False
    _max_attempts = 3

    def __init__(self, db):
        self.db = db
        self._id = None
        self.writes = []

    def _clean_up(self):
        self.writes = []
        self._id = None

    def _begin(self, retry_id=None):
        self._id = b"offline-transaction"
        self.db.attempts += 1

    def set(self, ref, document, merge=False):
        self.writes.append(("merge" if merge else "set", ref.path, copy.deepcopy(document)))

    def update(self, ref, document):
        self.writes.append(("merge", ref.path, copy.deepcopy(document)))

    def delete(self, ref):
        self.writes.append(("delete", ref.path, None))

    def _commit(self):
        if self.db.before_commit:
            callback, self.db.before_commit = self.db.before_commit, None
            callback(self.db.documents)
            raise Aborted("Synthetic concurrent modification")
        for operation, path, value in self.writes:
            if operation == "delete":
                self.db.documents.pop(path, None)
            elif operation == "set":
                self.db.documents[path] = value
            else:
                current = self.db.documents.setdefault(path, {})
                for key, field_value in value.items():
                    if field_value == firestore.DELETE_FIELD:
                        current.pop(key, None)
                    else:
                        current[key] = field_value
        self.db.commits += 1

    def _rollback(self):
        self.writes = []


class DatabaseDouble:
    def __init__(self, documents=None):
        self.documents = copy.deepcopy(documents or {})
        self.before_commit = None
        self.attempts = self.commits = 0

    def collection(self, path):
        return Collection(self, path)

    def transaction(self):
        return TransactionDouble(self)


UID = "firebase_UID-42"
PATH = "private-cvs/firebase_UID-42/revision-1.pdf"
USER_PATH = store.WORKSPACE + "/users/" + UID
EXTRACTION_PATH = store.WORKSPACE + "/cvExtractions/" + UID
EVENT_PATH = store.WORKSPACE + "/events/event-1"


def cv(**values):
    return {
        "candidate_id": UID,
        "source": "C:/private/secret-cv.pdf",
        "first_name": "Proposed",
        "last_name": "Person",
        "current_role": "Engineer",
        "education": [{"institution": "University", "kind": "university", "degree": "BSc", "field": "Physics"}],
        "skills": ["Python"],
        "general_description": "Proposed biography",
        "location": "Belgrade",
        "status": "student",
        "birth_year": 2000,
        "experience_level": "junior",
        "cv_filename": "wrong-filename.pdf",
        "cv_text": "PRIVATE FULL CV CONTENT",
        **values,
    }


def profile(**values):
    return {
        "user_id": UID,
        "first_name": "Confirmed",
        "last_name": "Account",
        "name": "Confirmed Account",
        "skills": ["Confirmed Skill"],
        "education": [{"institution": "Confirmed School"}],
        "roles": ["Mentor"],
        "email": "confirmed@example.invalid",
        "email_verified": True,
        "cv": "current.pdf",
        "cv_document": {"storage_path": PATH, "filename": "current.pdf", "extraction_status": "not_started"},
        "updated_at": "profile-version-1",
        **values,
    }


def event(**values):
    return {"event_id": "event-1", "name": "Imported title", "event_type": "meetup", "skills": ["Python"], **values}


class MappingTests(unittest.TestCase):
    def test_event_mapping_rejects_invalid_remote_and_year_criteria(self):
        for changes in ({"remote": "false"}, {"remote": 1}, {"min_birth_year": True},
                        {"max_birth_year": 2000.5}, {"max_birth_year": 1899}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                store.event_document(event(**changes))
    def test_user_mapping_has_no_raw_data_provenance_or_attachment(self):
        doc_id, document = store.user_document(cv())
        self.assertEqual(doc_id, UID)
        self.assertTrue({"candidate_id", "source", "cv_text", "cv", "cv_document"}.isdisjoint(document))
        self.assertNotIn("kind", document["education"][0])

    def test_user_mapping_is_pure_and_does_not_invent_name_from_filename(self):
        with patch.object(store, "_now", side_effect=AssertionError("Pure mapping must not read time")), patch.object(store, "datetime") as clock:
            clock.now.side_effect = AssertionError("Pure mapping must not read time")
            _, document = store.user_document(cv(first_name=None, last_name=None))
        self.assertNotIn("name", document)

    def test_mapped_values_obey_public_schema_bounds(self):
        _, document = store.user_document(cv(
            skills=["x" * 300] * 60,
            general_description="x" * 11000,
            location="x" * 300,
            birth_year=True,
            education=[{"institution": "x" * 300}] * 31,
        ))
        self.assertEqual(len(document["skills"]), 50)
        self.assertEqual(len(document["skills"][0]), 200)
        self.assertEqual(len(document["general_description"]), 10000)
        self.assertEqual(len(document["location"]), 200)
        self.assertEqual(len(document["education"]), 30)
        self.assertNotIn("birth_year", document)

    def test_id_validation_rejects_instead_of_sanitizing_collisions(self):
        self.assertEqual(store.firestore_id(UID), UID)
        for value in ("uploads/cv", "a" * 129, "Иван", "", "space id"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                store.firestore_id(value)

    def test_events_require_supported_kind(self):
        for value in (None, "unsupported", "Hackathon", ""):
            with self.subTest(value=value), self.assertRaises(ValueError):
                store.event_document(event(event_type=value))


class UserTransactionTests(unittest.TestCase):
    def setUp(self):
        self.db = DatabaseDouble({USER_PATH: profile()})
        self.get_db = patch.object(store, "get_db", return_value=self.db)
        self.get_db.start()
        self.addCleanup(self.get_db.stop)

    def write(self, record=None, **values):
        return store.upsert_user(record or cv(), user_id=UID, expected_storage_path=PATH, **values)

    def confirmed_record(self, **values):
        self.write()
        return cv(expected_profile_updated_at="profile-version-1", expected_extraction_hash=self.db.documents[EXTRACTION_PATH]["extraction_hash"], **values)

    def test_changed_private_proposal_requires_saved_revision(self):
        self.write()
        token = self.db.documents[EXTRACTION_PATH]["extraction_hash"]
        with self.assertRaises(ValueError):
            self.write(cv(skills=["Changed proposal"]))
        self.write(cv(skills=["Changed proposal"], expected_extraction_hash=token))
        self.assertEqual(self.db.documents[EXTRACTION_PATH]["proposed_fields"]["skills"], ["Changed proposal"])
        with self.assertRaises(ValueError):
            self.write(cv(skills=["Stale proposal"], expected_extraction_hash=token))

    def test_private_proposal_update_is_rechecked_after_concurrent_change(self):
        self.write()
        token = self.db.documents[EXTRACTION_PATH]["extraction_hash"]
        self.db.before_commit = lambda documents: documents[EXTRACTION_PATH].update(extraction_hash="newer-edit")
        with self.assertRaises(ValueError):
            self.write(cv(skills=["Old extraction"], expected_extraction_hash=token))
        self.assertEqual(self.db.documents[EXTRACTION_PATH]["extraction_hash"], "newer-edit")

    def test_partial_name_confirmation_keeps_display_name_consistent(self):
        record = self.confirmed_record()
        self.write(record, confirmed_fields=["first_name"])
        user = self.db.documents[USER_PATH]
        self.assertEqual(user["last_name"], "Account")
        self.assertEqual(user["name"], "Proposed Account")

    def test_text_writer_cannot_bypass_private_proposal_revision(self):
        self.write()
        token = self.db.documents[EXTRACTION_PATH]["extraction_hash"]
        with self.assertRaises(ValueError):
            store.save_cv_text(UID, "changed.pdf", "Changed text", expected_storage_path=PATH)
        store.save_cv_text(UID, "changed.pdf", "Changed text", expected_storage_path=PATH,
                           expected_extraction_hash=token)
        saved = self.db.documents[EXTRACTION_PATH]
        self.assertNotEqual(saved["extraction_hash"], token)
        self.assertEqual(saved["proposed_fields"], {})

    def test_unchanged_text_writer_preserves_reviewed_proposal(self):
        record = cv()
        self.write(record)
        before = copy.deepcopy(self.db.documents[EXTRACTION_PATH])
        store.save_cv_text(UID, record["cv_filename"], record["cv_text"], expected_storage_path=PATH)
        self.assertEqual(self.db.documents[EXTRACTION_PATH], before)

    def test_text_writer_rechecks_private_version_on_transaction_retry(self):
        self.write()
        token = self.db.documents[EXTRACTION_PATH]["extraction_hash"]
        self.db.before_commit = lambda documents: documents[EXTRACTION_PATH].update(extraction_hash="concurrent-edit")
        with self.assertRaises(ValueError):
            store.save_cv_text(UID, "changed.pdf", "Changed text", expected_storage_path=PATH,
                               expected_extraction_hash=token)
        self.assertEqual(self.db.documents[EXTRACTION_PATH]["extraction_hash"], "concurrent-edit")

    def test_default_write_stores_private_proposal_and_preserves_public_profile(self):
        original = copy.deepcopy(self.db.documents[USER_PATH])
        self.assertEqual(self.write(), UID)
        self.assertEqual(self.db.documents[USER_PATH], original)
        proposal = self.db.documents[EXTRACTION_PATH]
        self.assertEqual(proposal["cv_text"], "PRIVATE FULL CV CONTENT")
        self.assertEqual(proposal["storage_path"], PATH)
        self.assertEqual(proposal["proposed_fields"]["first_name"], "Proposed")
        self.assertEqual(len(proposal["extraction_hash"]), 64)
        self.assertEqual(self.db.commits, 1)

    def test_invalid_identity_and_missing_revision_fail_before_database_access(self):
        with patch.object(store, "get_db", side_effect=AssertionError("No cloud access for invalid input")):
            for identity in ("dataset-" + "a" * 64, "slash/id"):
                with self.subTest(identity=identity), self.assertRaises(ValueError):
                    store.upsert_user(cv(candidate_id=identity), user_id=identity, expected_storage_path=PATH)
            with self.assertRaises(ValueError):
                store.upsert_user(cv(), user_id=UID, expected_storage_path="")
            with self.assertRaises(ValueError):
                store.upsert_user(cv(candidate_id="other"), user_id=UID, expected_storage_path=PATH)

    def test_canonical_account_and_current_attachment_are_required(self):
        for user in (None, profile(user_id="different"), profile(cv_document=None), profile(cv_document={"storage_path": "new.pdf"})):
            with self.subTest(user=user):
                self.db.documents = {} if user is None else {USER_PATH: user}
                with self.assertRaises(ValueError):
                    self.write()
                self.assertNotIn(EXTRACTION_PATH, self.db.documents)

    def test_authorized_write_removes_legacy_private_user_fields(self):
        self.db.documents[USER_PATH].update(cv_text="OLD SECRET", source="private/path", candidate_id="legacy")
        self.write()
        self.assertTrue({"cv_text", "source", "candidate_id"}.isdisjoint(self.db.documents[USER_PATH]))
        self.assertEqual(self.db.documents[USER_PATH]["name"], "Confirmed Account")

    def test_confirmation_applies_selected_fields_and_protects_account_attachment(self):
        record = self.confirmed_record()
        self.write(record, confirmed_fields=["first_name", "skills", "education"])
        saved = self.db.documents[USER_PATH]
        self.assertEqual(saved["first_name"], "Proposed")
        self.assertEqual(saved["skills"], ["Python"])
        self.assertNotIn("kind", saved["education"][0])
        self.assertEqual(saved["last_name"], "Account")
        self.assertEqual(saved["roles"], ["Mentor"])
        self.assertEqual(saved["email"], "confirmed@example.invalid")
        self.assertEqual(saved["cv"], "current.pdf")
        self.assertEqual(saved["cv_document"]["storage_path"], PATH)

    def test_confirmation_rejects_protected_and_unknown_fields_before_database_access(self):
        for field in ("email", "roles", "cv", "cv_document", "cv_text", "source", "unknown"):
            with self.subTest(field=field), patch.object(store, "get_db", side_effect=AssertionError("Validate first")), self.assertRaises(ValueError):
                self.write(confirmed_fields=[field])

    def test_confirmation_rejects_non_sequence_field_input_before_database_access(self):
        record = self.confirmed_record()
        for fields in ("skills", 42, {"skills": True}):
            with self.subTest(fields=fields), patch.object(store, "get_db", side_effect=AssertionError("Validate first")), self.assertRaises(ValueError):
                self.write(record, confirmed_fields=fields)

    def test_invalid_record_input_fails_before_database_access(self):
        with patch.object(store, "get_db", side_effect=AssertionError("Validate first")), self.assertRaises(ValueError):
            store.upsert_user(None, user_id=UID, expected_storage_path=PATH)

    def test_sparse_proposal_does_not_erase_confirmed_values(self):
        sparse = cv(first_name=None, last_name=None, skills=[], education=[])
        self.write(sparse)
        sparse.update(expected_profile_updated_at="profile-version-1", expected_extraction_hash=self.db.documents[EXTRACTION_PATH]["extraction_hash"])
        original = copy.deepcopy(self.db.documents[USER_PATH])
        self.write(sparse, confirmed_fields=["first_name", "last_name", "name", "skills", "education"])
        saved = self.db.documents[USER_PATH]
        for key in ("first_name", "last_name", "name", "skills", "education", "cv"):
            self.assertEqual(saved.get(key), original.get(key))

    def test_confirmation_requires_profile_and_extraction_revision(self):
        for record in (cv(), cv(expected_profile_updated_at="profile-version-1")):
            with self.subTest(record=record), self.assertRaises(ValueError):
                self.write(record, confirmed_fields=["skills"])

    def test_confirmation_rejects_stale_private_proposal(self):
        record = self.confirmed_record()
        self.write(cv(skills=["New proposal"], expected_extraction_hash=record["expected_extraction_hash"]))
        with self.assertRaises(ValueError):
            self.write(record, confirmed_fields=["skills"])
        self.assertEqual(self.db.documents[USER_PATH]["skills"], ["Confirmed Skill"])

    def test_same_revision_default_write_preserves_concurrent_profile_edit_on_retry(self):
        self.db.before_commit = lambda documents: documents[USER_PATH].update(first_name="Concurrent", updated_at="profile-version-2")
        self.write()
        self.assertEqual(self.db.documents[USER_PATH]["first_name"], "Concurrent")
        self.assertEqual(self.db.attempts, 2)

    def test_confirmation_rejects_concurrent_profile_edit_on_retry(self):
        record = self.confirmed_record()
        self.db.before_commit = lambda documents: documents[USER_PATH].update(skills=["Concurrent skill"], updated_at="profile-version-2")
        with self.assertRaises(ValueError):
            self.write(record, confirmed_fields=["skills"])
        self.assertEqual(self.db.documents[USER_PATH]["skills"], ["Concurrent skill"])

    def test_attachment_replacement_between_read_and_commit_is_rechecked(self):
        self.db.before_commit = lambda documents: documents[USER_PATH].update(cv_document={"storage_path": "revision-2.pdf"})
        with self.assertRaises(ValueError):
            self.write()
        self.assertNotIn(EXTRACTION_PATH, self.db.documents)

    def test_save_text_is_private_and_revision_guarded(self):
        original = copy.deepcopy(self.db.documents[USER_PATH])
        self.assertTrue(store.save_cv_text(UID, "private.pdf", "PRIVATE TEXT", expected_storage_path=PATH))
        self.assertEqual(self.db.documents[USER_PATH], original)
        self.assertEqual(self.db.documents[EXTRACTION_PATH]["cv_text"], "PRIVATE TEXT")
        with self.assertRaises(ValueError):
            store.save_cv_text(UID, "stale.pdf", "OLD", expected_storage_path="old.pdf")
        self.assertEqual(self.db.documents[EXTRACTION_PATH]["cv_text"], "PRIVATE TEXT")

    def test_delete_extraction_requires_matching_profile_and_private_revision(self):
        self.write()
        with self.assertRaises(ValueError):
            store.delete_user_extraction(UID, "old.pdf")
        self.assertIn(EXTRACTION_PATH, self.db.documents)
        self.assertTrue(store.delete_user_extraction(UID, PATH))
        self.assertNotIn(EXTRACTION_PATH, self.db.documents)
        self.assertFalse(store.delete_user_extraction(UID, PATH))

    def test_delete_does_not_remove_a_newer_private_revision(self):
        self.write()
        self.db.documents[EXTRACTION_PATH]["storage_path"] = "new.pdf"
        with self.assertRaises(ValueError):
            store.delete_user_extraction(UID, PATH)
        self.assertIn(EXTRACTION_PATH, self.db.documents)


class EventTransactionTests(unittest.TestCase):
    def setUp(self):
        self.db = DatabaseDouble()
        patcher = patch.object(store, "get_db", return_value=self.db)
        patcher.start()
        self.addCleanup(patcher.stop)

    def existing(self):
        self.db.documents[EVENT_PATH] = {
            "id": "event-1", "title": "Published title", "kind": "conference", "status": "open", "publishedAt": "2026-10-01",
            "date": "2027-03-01", "endDate": "2027-03-02", "deadline": "2027-02-01", "updated_at": "event-version-1",
        }

    def test_new_import_is_a_transactional_draft(self):
        self.assertEqual(store.upsert_event(event()), "event-1")
        self.assertEqual(self.db.documents[EVENT_PATH]["kind"], "meetup")
        self.assertEqual(self.db.documents[EVENT_PATH]["status"], "draft")

    def test_existing_event_requires_version_before_modifying_fields(self):
        self.existing()
        original = copy.deepcopy(self.db.documents[EVENT_PATH])
        with self.assertRaises(ValueError):
            store.upsert_event(event())
        self.assertEqual(self.db.documents[EVENT_PATH], original)

    def test_authorized_update_preserves_published_status_and_dates(self):
        self.existing()
        store.upsert_event(event(), expected_updated_at="event-version-1")
        saved = self.db.documents[EVENT_PATH]
        self.assertEqual(saved["title"], "Imported title")
        self.assertEqual(saved["status"], "open")
        self.assertEqual(saved["publishedAt"], "2026-10-01")
        self.assertEqual(saved["date"], "2027-03-01")
        self.assertEqual(saved["endDate"], "2027-03-02")
        self.assertEqual(saved["deadline"], "2027-02-01")

    def test_concurrent_event_edit_is_rechecked_after_transaction_retry(self):
        self.existing()
        self.db.before_commit = lambda documents: documents[EVENT_PATH].update(title="Concurrent organizer edit", updated_at="event-version-2")
        with self.assertRaises(ValueError):
            store.upsert_event(event(), expected_updated_at="event-version-1")
        self.assertEqual(self.db.documents[EVENT_PATH]["title"], "Concurrent organizer edit")


if __name__ == "__main__":
    unittest.main()
