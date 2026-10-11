"""
Firestore writes for extracted users and events.

Documents go to the existing workspace the app already reads:
  gdevPilots/main/users/{id}
  gdevPilots/main/events/{id}

Uses Application Default Credentials (same as scripts/firestore-connection-check.mjs).
Does not print credentials. A missing document is created with the fields the app
expects; an existing document is updated only with the extracted profile or event
fields, so a later import does not wipe name, roles, dates, or publication status.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import firebase_admin
from firebase_admin import credentials, firestore

from event_candidate_finder import seniority_bucket
from extractors import CvDict, EventDict
from vector_store import event_id_for

PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "gdg-hackathon-d0b85")
WORKSPACE = os.environ.get("FIREBASE_WORKSPACE", "gdevPilots/main")

_STATUSES = {"student": "Student", "employed": "Employed", "freelancer": "Freelancer"}
_LEVELS = {"junior": "Junior", "mid": "Mid", "senior": "Senior"}
_KINDS = {"hackathon", "conference", "meetup", "festival"}
_APP_LEVELS = {"junior": "Beginner", "mid": "Intermediate", "senior": "Advanced"}

_USER_UPDATE_FIELDS = (
    "first_name",
    "last_name",
    "name",
    "location",
    "general_description",
    "skills",
    "status",
    "birth_year",
    "experience_level",
    "title",
    "school",
    "education",
    "source",
    "candidate_id",
    "cv",
    "cv_text",
    "updated_at",
)
_EVENT_UPDATE_FIELDS = (
    "title",
    "description",
    "location",
    "venue",
    "format",
    "kind",
    "tags",
    "theme",
    "audience",
    "remote",
    "seniority",
    "min_birth_year",
    "max_birth_year",
    "short_description",
    "updated_at",
)


def firestore_id(raw: str) -> str:
    """Firestore document ids cannot contain '/'. Keep only letters, digits, '_' and '-'."""
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", raw).strip("-")
    if not safe:
        safe = "item"
    if len(safe) > 128:
        safe = safe[:128].rstrip("-")
    return safe


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _person_name(cv: CvDict) -> Tuple[str, str, str]:
    """Return first name, last name, and the display name. Falls back to the file id when the CV has no name."""
    first = (cv.get("first_name") or "")[:100]
    last = (cv.get("last_name") or "")[:100]
    full = " ".join(part for part in (first, last) if part)
    return first, last, (full or _display_name(cv["candidate_id"]))[:200]


def _display_name(candidate_id: str) -> str:
    leaf = candidate_id.replace("\\", "/").rstrip("/").split("/")[-1]
    words = re.sub(r"[-_]+", " ", leaf).strip()
    return words[:200] or "Imported candidate"


def _status(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return _STATUSES.get(value.strip().casefold())


_SCHOOL_RANK = {"university": 3, "college": 2, "high school": 1}


def _education_records(cv: CvDict) -> List[Dict[str, Any]]:
    """App education entries. kind stays on the record so high school and college remain distinct."""
    records: List[Dict[str, Any]] = []
    for item in cv.get("education") or []:
        records.append({
            "institution": item["institution"][:200],
            "kind": item.get("kind"),
            "degree": (item.get("degree") or "")[:200],
            "field": (item.get("field") or "")[:200],
            "start_date": None,
            "end_date": None,
            "description": "",
        })
    return records


def _primary_school(education: List[Dict[str, Any]]) -> str:
    """Prefer a university or college over a high school when the CV lists more than one."""
    if not education:
        return ""
    best = max(education, key=lambda item: _SCHOOL_RANK.get(item.get("kind") or "", 0))
    return best["institution"][:200]


def _experience_level(value: Optional[str]) -> Optional[str]:
    bucket = seniority_bucket(value)
    if not bucket:
        return None
    return _LEVELS.get(bucket)


def user_document(cv: CvDict) -> Tuple[str, Dict[str, Any]]:
    """Map an extracted CV onto the app's user document. user_id matches the document id."""
    doc_id = firestore_id(cv["candidate_id"])
    level = _experience_level(cv.get("experience_level"))
    first_name, last_name, name = _person_name(cv)
    education = _education_records(cv)
    role = (cv.get("current_role") or "")[:200]
    now = _now()
    document: Dict[str, Any] = {
        "user_id": doc_id,
        "candidate_id": cv["candidate_id"],
        "source": cv.get("source") or "",
        "first_name": first_name,
        "last_name": last_name,
        "email": None,
        "email_verified": False,
        "phone": "",
        "education": education,
        "work_experience": [],
        "languages": [],
        "cv_document": None,
        "created_at": now,
        "updated_at": now,
        "status": _status(cv.get("status")),
        "birth_year": cv.get("birth_year"),
        "experience_level": level,
        "name": name,
        "title": role or level or "",
        "location": cv.get("location") or "",
        "school": _primary_school(education),
        "general_description": cv.get("general_description") or "",
        "skills": list(cv.get("skills") or [])[:50],
        "interests": [],
        "roles": ["Participant"],
        "experience": "",
        "color": "blue",
        "avatar": "",
        "lookingForTeam": False,
        "linkedin": "",
        "kaggle": "",
        "cv": (cv.get("cv_filename") or "")[:200],
        "cv_text": cv.get("cv_text") or "",
    }
    return doc_id, document


def event_document(event: EventDict) -> Tuple[str, Dict[str, Any]]:
    """Map an extracted event onto the app's event document. New events stay drafts."""
    raw_id = event.get("event_id") or event_id_for(event)
    doc_id = firestore_id(raw_id)
    skills = list(event.get("skills") or [])[:50]
    remote = bool(event.get("remote"))
    kind = event.get("event_type") if event.get("event_type") in _KINDS else "hackathon"
    bucket = seniority_bucket(event.get("seniority"))
    audience_level = _APP_LEVELS.get(bucket) if bucket else None
    location = (event.get("location") or "").strip() or ("Remote" if remote else "Unknown")
    now = _now()
    today = now[:10]
    document: Dict[str, Any] = {
        "id": doc_id,
        "kind": kind,
        "registration": "review",
        "audience": {
            "skills": skills,
            "goals": [],
            "roles": ["Participant"],
            "levels": [audience_level] if audience_level else [],
        },
        "title": (event.get("name") or "Untitled event")[:200],
        "organizer": "Imported",
        "date": today,
        "endDate": today,
        "deadline": today,
        "location": location[:200],
        "venue": "",
        "description": event.get("short_description") or "",
        "theme": (event.get("name") or kind)[:200],
        "tags": skills,
        "color": "blue",
        "format": "Online" if remote else "In person",
        "capacity": 100,
        "minTeamSize": 1,
        "maxTeamSize": 4,
        "status": "draft",
        "schedule": [],
        "publishedAt": None,
        "remote": remote,
        "seniority": event.get("seniority"),
        "min_birth_year": event.get("min_birth_year"),
        "max_birth_year": event.get("max_birth_year"),
        "short_description": event.get("short_description"),
        "created_at": now,
        "updated_at": now,
    }
    return doc_id, document


def get_db():
    """Application Default Credentials. Does not print credential contents."""
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.ApplicationDefault(), {"projectId": PROJECT_ID})
    return firestore.client()


def _upsert(collection: str, doc_id: str, document: Dict[str, Any], update_fields: Tuple[str, ...]) -> str:
    ref = get_db().collection(f"{WORKSPACE}/{collection}").document(doc_id)
    existing = ref.get()
    if existing.exists:
        ref.update({field: document[field] for field in update_fields})
    else:
        ref.set(document)
    return doc_id


def upsert_user(cv: CvDict) -> str:
    """Create or update one user from an extracted CV. Returns the Firestore document id."""
    doc_id, document = user_document(cv)
    return _upsert("users", doc_id, document, _USER_UPDATE_FIELDS)


def save_cv_text(doc_id: str, filename: str, cv_text: str) -> bool:
    """Store the CV filename and its full text on an existing user. Returns False if the user is missing."""
    ref = get_db().collection(f"{WORKSPACE}/users").document(firestore_id(doc_id))
    if not ref.get().exists:
        return False
    ref.update({
        "cv": filename[:200],
        "cv_text": cv_text[:100_000],
        "updated_at": _now(),
    })
    return True


def upsert_event(event: EventDict) -> str:
    """Create or update one event from extracted event info. Returns the Firestore document id."""
    doc_id, document = event_document(event)
    return _upsert("events", doc_id, document, _EVENT_UPDATE_FIELDS)
