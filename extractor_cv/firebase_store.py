"""Revision-checked Firestore writes for private CV proposals and imported events.

CV extraction never creates accounts or changes a public profile by default.
Reviewed fields require both the profile revision and the saved proposal hash.
All cloud reads and writes for authorization happen in Firebase transactions.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Sequence as SequenceABC
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence, Tuple

import firebase_admin
from firebase_admin import credentials, firestore

from contracts import RevisionConflict, validate_id
from event_candidate_finder import seniority_bucket

if TYPE_CHECKING:
    from extractors import CvDict, EventDict

PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "gdg-hackathon-d0b85")
WORKSPACE = os.environ.get("FIREBASE_WORKSPACE", "gdevPilots/main")

_STATUSES = {"student": "Student", "employed": "Employed", "freelancer": "Freelancer"}
_LEVELS = {"junior": "Junior", "mid": "Mid", "senior": "Senior"}
_KINDS = {"hackathon", "conference", "meetup", "festival"}
_APP_LEVELS = {"junior": "Beginner", "mid": "Intermediate", "senior": "Advanced"}
_CONFIRMABLE_FIELDS = frozenset({
    "first_name", "last_name", "name", "location", "general_description", "skills",
    "status", "birth_year", "experience_level", "title", "school", "education",
})
_LEGACY_PRIVATE_FIELDS = ("cv_text", "source", "candidate_id")
_EVENT_UPDATE_FIELDS = (
    "title", "description", "location", "format", "kind", "tags", "theme", "audience",
    "remote", "seniority", "min_birth_year", "max_birth_year", "short_description",
)
_SCHOOL_RANK = {"university": 3, "college": 2, "high school": 1}
_REFERENCE_YEAR = datetime.now(timezone.utc).year


def firestore_id(raw: str) -> str:
    """Compatibility alias: reject invalid identities, never rewrite them."""
    return validate_id(raw)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any, limit: int = 200) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _strings(value: Any, count: int = 50) -> List[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return [_text(item) for item in value if _text(item)][:count]


def _education_records(cv: CvDict) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    items = cv.get("education")
    if not isinstance(items, (list, tuple)):
        return records
    for item in items:
        if not isinstance(item, dict) or not _text(item.get("institution")):
            continue
        records.append({
            "institution": _text(item["institution"]), "degree": _text(item.get("degree")),
            "field": _text(item.get("field")), "start_date": None, "end_date": None,
            "description": "",
        })
        if len(records) == 30:
            break
    return records


def _primary_school(cv: CvDict) -> str:
    items = cv.get("education")
    valid = [item for item in items if isinstance(item, dict) and _text(item.get("institution"))] if isinstance(items, (list, tuple)) else []
    if not valid:
        return ""
    best = max(valid, key=lambda item: _SCHOOL_RANK.get(item.get("kind"), 0))
    return _text(best["institution"])


def user_document(cv: CvDict) -> Tuple[str, Dict[str, Any]]:
    """Pure public-field proposal mapping; no attachment, raw text or provenance.

    Empty or invalid extraction values are omitted, so confirmation cannot erase
    an existing profile. This mapping does not create an account document.
    """
    if not isinstance(cv, dict):
        raise ValueError("CV record must be a dictionary")
    doc_id = validate_id(cv.get("candidate_id"))
    first = _text(cv.get("first_name"), 100)
    last = _text(cv.get("last_name"), 100)
    bucket = seniority_bucket(_text(cv.get("experience_level")))
    document: Dict[str, Any] = {
        "user_id": doc_id, "first_name": first, "last_name": last,
        "name": " ".join(part for part in (first, last) if part)[:200],
        "title": _text(cv.get("current_role")), "education": _education_records(cv),
        "school": _primary_school(cv), "skills": _strings(cv.get("skills")),
        "location": _text(cv.get("location")),
        "general_description": _text(cv.get("general_description"), 10000),
        "status": _STATUSES.get(_text(cv.get("status")).casefold()),
        "experience_level": _LEVELS.get(bucket),
    }
    year = cv.get("birth_year")
    if isinstance(year, int) and not isinstance(year, bool) and 1900 <= year <= _REFERENCE_YEAR:
        document["birth_year"] = year
    return doc_id, {key: value for key, value in document.items() if value is not None and value != "" and value != []}


def _canonical_user(user_id: str) -> str:
    uid = validate_id(user_id)
    if uid.startswith("dataset-"):
        raise ValueError("Dataset identities cannot address canonical user accounts")
    return uid


def _revision(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    return value


def _current_user(snapshot, user_id: str, expected_storage_path: str) -> Dict[str, Any]:
    if not snapshot.exists:
        raise ValueError("An existing canonical user is required")
    user = snapshot.to_dict()
    if user.get("user_id") != user_id:
        raise ValueError("User identity does not match its document")
    attachment = user.get("cv_document")
    if not isinstance(attachment, dict) or attachment.get("storage_path") != expected_storage_path:
        raise ValueError("CV attachment revision no longer matches")
    return user


def _legacy_cleanup(user: Dict[str, Any]) -> Dict[str, Any]:
    return {field: firestore.DELETE_FIELD for field in _LEGACY_PRIVATE_FIELDS if field in user}


def _extraction_document(cv: CvDict, uid: str, storage_path: str, proposed: Dict[str, Any]) -> Dict[str, Any]:
    document = {
        "user_id": uid, "candidate_id": uid, "storage_path": storage_path,
        "source": _text(cv.get("source"), 2048), "cv_filename": _text(cv.get("cv_filename")),
        "cv_text": _text(cv.get("cv_text"), 100000),
        "proposed_fields": {key: value for key, value in proposed.items() if key != "user_id"},
    }
    document["extraction_hash"] = hashlib.sha256(json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
    return document


def get_db():
    """Application Default Credentials. Does not print credential contents."""
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.ApplicationDefault(), {"projectId": PROJECT_ID})
    return firestore.client()


def upsert_user(cv: CvDict, *, user_id: str, expected_storage_path: str, confirmed_fields: Optional[Sequence[str]] = None) -> str:
    """Save a private proposal; apply only explicitly reviewed public fields.

    Confirmation requires ``expected_profile_updated_at`` and
    ``expected_extraction_hash`` in ``cv``, from the user's reviewed snapshot.
    The proposal must have already been saved. Protected account and attachment
    fields are never confirmation targets.
    """
    uid = _canonical_user(user_id)
    storage_path = _revision(expected_storage_path, "expected_storage_path")
    doc_id, proposed = user_document(cv)
    if doc_id != uid:
        raise ValueError("Candidate identity must equal the explicit user ID")
    if confirmed_fields is not None and (isinstance(confirmed_fields, (str, bytes)) or not isinstance(confirmed_fields, SequenceABC)):
        raise ValueError("confirmed_fields must be a sequence of public field names")
    fields = tuple(confirmed_fields or ())
    if any(not isinstance(field, str) or field not in _CONFIRMABLE_FIELDS for field in fields):
        raise ValueError("Only supported public proposal fields may be confirmed")
    profile_revision = extraction_revision = None
    if fields:
        profile_revision = _revision(cv.get("expected_profile_updated_at"), "expected_profile_updated_at")
        extraction_revision = _revision(cv.get("expected_extraction_hash"), "expected_extraction_hash")
    proposal = _extraction_document(cv, uid, storage_path, proposed)
    db = get_db()
    user_ref = db.collection(f"{WORKSPACE}/users").document(uid)
    extraction_ref = db.collection(f"{WORKSPACE}/cvExtractions").document(uid)

    @firestore.transactional
    def write(transaction):
        user = _current_user(user_ref.get(transaction=transaction), uid, storage_path)
        saved = extraction_ref.get(transaction=transaction)
        extraction = saved.to_dict() if saved.exists else {}
        changes = _legacy_cleanup(user)
        if fields:
            if user.get("updated_at") != profile_revision:
                raise ValueError("Profile changed after review")
            if extraction.get("user_id") != uid or extraction.get("storage_path") != storage_path or extraction.get("extraction_hash") != extraction_revision or proposal["extraction_hash"] != extraction_revision:
                raise ValueError("Extraction proposal changed after review")
            reviewed = {field: proposed[field] for field in fields if field in proposed}
            if "first_name" in reviewed or "last_name" in reviewed:
                displayed = " ".join(part for part in (
                    reviewed.get("first_name", _text(user.get("first_name"), 100)),
                    reviewed.get("last_name", _text(user.get("last_name"), 100))) if part)[:200]
                if "name" in reviewed and reviewed["name"] != displayed:
                    raise ValueError("Display name includes unconfirmed name parts")
                reviewed["name"] = displayed
            elif "name" in reviewed:
                raise ValueError("Confirm explicit name parts to change a CV-derived display name")
            if reviewed:
                changes.update(reviewed)
                changes["updated_at"] = _now()
        else:
            if extraction and extraction.get("user_id") != uid:
                raise ValueError("Private proposal identity does not match its document")
            prior_hash = extraction.get("extraction_hash")
            if extraction.get("storage_path") == storage_path and prior_hash != proposal["extraction_hash"]:
                if prior_hash is not None and cv.get("expected_extraction_hash") != prior_hash:
                    raise RevisionConflict("Private proposal changed; reload before replacing it")
            if extraction.get("storage_path") != storage_path or prior_hash != proposal["extraction_hash"]:
                transaction.set(extraction_ref, {**proposal, "updated_at": _now()})
        if changes:
            transaction.update(user_ref, changes)
        return uid

    return write(db.transaction())


def save_cv_text(user_id: str, filename: str, cv_text: str, *, expected_storage_path: str,
                 expected_extraction_hash: Optional[str] = None) -> bool:
    """Save text privately for the current CV revision, preserving its public attachment."""
    uid = _canonical_user(user_id)
    storage_path = _revision(expected_storage_path, "expected_storage_path")
    if not isinstance(filename, str) or not isinstance(cv_text, str):
        raise ValueError("Filename and CV text must be strings")
    db = get_db()
    user_ref = db.collection(f"{WORKSPACE}/users").document(uid)
    extraction_ref = db.collection(f"{WORKSPACE}/cvExtractions").document(uid)

    @firestore.transactional
    def write(transaction):
        user = _current_user(user_ref.get(transaction=transaction), uid, storage_path)
        snapshot = extraction_ref.get(transaction=transaction)
        saved = snapshot.to_dict() if snapshot.exists else {}
        if saved and saved.get("user_id") != uid:
            raise ValueError("Private extraction identity does not match its document")
        same_attachment = saved.get("storage_path") == storage_path
        if expected_extraction_hash is not None and (not same_attachment or saved.get("extraction_hash") != expected_extraction_hash):
            raise RevisionConflict("Private extraction changed before text replacement")
        unchanged = same_attachment and saved.get("cv_text") == _text(cv_text, 100000) and saved.get("cv_filename") == _text(filename)
        # A text replacement invalidates any previous proposal confirmation hash.
        if not unchanged:
            if same_attachment and saved.get("extraction_hash") != expected_extraction_hash:
                raise RevisionConflict("Private extraction revision is required for text replacement")
            document = _extraction_document({"cv_filename": filename, "cv_text": cv_text}, uid, storage_path, {})
            transaction.set(extraction_ref, {**document, "updated_at": _now()})
        cleanup = _legacy_cleanup(user)
        if cleanup:
            transaction.update(user_ref, cleanup)
        return True

    return write(db.transaction())


def delete_user_extraction(user_id: str, expected_storage_path: str) -> bool:
    """Delete only a private extraction belonging to the current attachment revision."""
    uid = _canonical_user(user_id)
    storage_path = _revision(expected_storage_path, "expected_storage_path")
    db = get_db()
    user_ref = db.collection(f"{WORKSPACE}/users").document(uid)
    extraction_ref = db.collection(f"{WORKSPACE}/cvExtractions").document(uid)

    @firestore.transactional
    def remove(transaction):
        user = _current_user(user_ref.get(transaction=transaction), uid, storage_path)
        snapshot = extraction_ref.get(transaction=transaction)
        if snapshot.exists:
            extraction = snapshot.to_dict()
            if extraction.get("user_id") != uid or extraction.get("storage_path") != storage_path:
                raise ValueError("Private extraction revision no longer matches")
            transaction.delete(extraction_ref)
        cleanup = _legacy_cleanup(user)
        if cleanup:
            transaction.update(user_ref, cleanup)
        return snapshot.exists

    return remove(db.transaction())


def event_document(event: EventDict) -> Tuple[str, Dict[str, Any]]:
    """Map a supported event kind; newly imported events remain drafts."""
    if not isinstance(event, dict):
        raise ValueError("Event record must be a dictionary")
    if "remote" in event and not isinstance(event["remote"], bool):
        raise ValueError("Event remote flag must be a boolean")
    for field in ("min_birth_year", "max_birth_year"):
        value = event.get(field)
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 1900 <= value <= _REFERENCE_YEAR):
            raise ValueError("Event birth-year criteria must be valid integer years")
    kind = event.get("event_type")
    if not isinstance(kind, str) or kind not in _KINDS:
        raise ValueError("A supported event_type is required")
    raw_id = event.get("event_id")
    if raw_id is None:
        from vector_store import event_id_for
        raw_id = event_id_for(event)
    doc_id = validate_id(raw_id)
    skills = _strings(event.get("skills"))
    remote = bool(event.get("remote"))
    bucket = seniority_bucket(_text(event.get("seniority")))
    audience_level = _APP_LEVELS.get(bucket)
    location = _text(event.get("location")) or ("Remote" if remote else "Unknown")
    now = _now()
    today = now[:10]
    document: Dict[str, Any] = {
        "id": doc_id, "kind": kind, "registration": "review",
        "audience": {"skills": skills, "goals": [], "roles": ["Participant"], "levels": [audience_level] if audience_level else []},
        "title": _text(event.get("name")) or "Untitled event", "organizer": "Imported",
        "date": today, "endDate": today, "deadline": today, "location": location,
        "venue": "", "description": _text(event.get("short_description"), 10000),
        "theme": _text(event.get("name")) or kind, "tags": skills, "color": "blue",
        "format": "Online" if remote else "In person", "capacity": 100,
        "minTeamSize": 1, "maxTeamSize": 4, "status": "draft", "schedule": [],
        "publishedAt": None, "remote": remote, "seniority": event.get("seniority"),
        "min_birth_year": event.get("min_birth_year"), "max_birth_year": event.get("max_birth_year"),
        "short_description": _text(event.get("short_description"), 10000),
        "created_at": now, "updated_at": now,
    }
    return doc_id, document


def upsert_event(event: EventDict, *, expected_updated_at: Optional[str] = None) -> str:
    """Create a draft, or version-check an existing event and preserve its lifecycle."""
    doc_id, document = event_document(event)
    if expected_updated_at is not None:
        _revision(expected_updated_at, "expected_updated_at")
    db = get_db()
    ref = db.collection(f"{WORKSPACE}/events").document(doc_id)

    @firestore.transactional
    def write(transaction):
        snapshot = ref.get(transaction=transaction)
        if snapshot.exists:
            current = snapshot.to_dict()
            if expected_updated_at is None or current.get("updated_at") != expected_updated_at:
                raise ValueError("An unchanged event revision is required for updates")
            transaction.update(ref, {**{field: document[field] for field in _EVENT_UPDATE_FIELDS}, "updated_at": _now()})
        else:
            if expected_updated_at is not None:
                raise ValueError("The expected existing event is missing")
            transaction.set(ref, document)
        return doc_id

    return write(db.transaction())
