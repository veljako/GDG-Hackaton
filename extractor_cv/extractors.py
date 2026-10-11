"""
Extractors: turn raw CVs and raw event text into structured dictionaries.

CV extraction reuses extractor.py (PDF/image text + Gemma JSON). Event extraction
reuses event_candidate_finder.event_to_json (Gemma + rule-based normalization).
No database or embedding code lives here.
"""

import json
import hashlib
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple, TypedDict

sys.path.insert(0, str(Path(__file__).resolve().parent))

from event_candidate_finder import event_to_json  # noqa: E402
from extractor import API_URL, MAX_CV_CHARACTERS, extract_text_from_file, parse_cv_with_gemma, read_bounded_file, validate_cv_text  # noqa: E402
from contracts import dataset_id_for, validate_id  # noqa: E402
from cv_grounding import NULL_WORDS, key, skill_name, ground_cv

RAW_CV_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
SKIP_DIRS = {"venv", "__pycache__", ".git", "chroma_db"}


class EducationDict(TypedDict):
    institution: str
    kind: Optional[str]
    degree: Optional[str]
    field: Optional[str]


class CvDict(TypedDict):
    candidate_id: str
    source: str
    first_name: Optional[str]
    last_name: Optional[str]
    current_role: Optional[str]
    education: List[EducationDict]
    skills: List[str]
    learning_skills: List[str]
    country: Optional[str]
    birth_date: Optional[str]
    interests: List[str]
    roles: List[str]
    preferences: Dict[str, Any]
    bio: Optional[str]
    general_description: Optional[str]
    location: Optional[str]
    status: Optional[str]
    birth_year: Optional[int]
    experience_level: Optional[str]
    cv_filename: Optional[str]
    cv_text: Optional[str]


class EventDict(TypedDict, total=False):
    date: Optional[str]
    end_date: Optional[str]
    deadline: Optional[str]
    criteria_version: int
    format: Optional[str]
    description: Optional[str]
    topics: List[str]
    taught_skills: List[str]
    required_skills: List[str]
    goals: List[str]
    roles: List[str]
    levels: List[str]
    seniorities: List[str]
    statuses: List[str]
    country: Optional[str]
    languages: List[str]
    price: Optional[Dict[str, Any]]
    min_age: Optional[int]
    max_age: Optional[int]
    event_id: str
    name: Optional[str]
    short_description: Optional[str]
    event_type: Optional[str]
    skills: List[str]
    location: Optional[str]
    remote: bool
    seniority: Optional[str]
    # Version 2 bounds use conventional ascending order.
    min_birth_year: Optional[int]
    max_birth_year: Optional[int]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or "item"


def _clean_str(value: Any, limit: int = 200) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    if key(text) in NULL_WORDS:
        return None
    return text[:limit] or None


def _clean_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _clean_birth_year(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError("Birth year must be an integer between 1900 and the current year.")
    if isinstance(value, str) and not re.fullmatch(r"[0-9]{4}", value):
        raise ValueError("Birth year must be an integer between 1900 and the current year.")
    year = int(value)
    if not 1900 <= year <= date.today().year:
        raise ValueError("Birth year must be between 1900 and the current year.")
    return year


_SCHOOL_KINDS = {
    "high school": "high school",
    "highschool": "high school",
    "secondary": "high school",
    "secondary school": "high school",
    "gimnazija": "high school",
    "srednja": "high school",
    "srednja skola": "high school",
    "college": "college",
    "university": "university",
    "faculty": "university",
    "fakultet": "university",
    "univerzitet": "university",
}


def _clean_school_kind(value: Any) -> Optional[str]:
    text = _clean_str(value)
    if not text:
        return None
    return _SCHOOL_KINDS.get(text.casefold())


def _clean_education(values: Any) -> List[EducationDict]:
    if not isinstance(values, list):
        return []
    schools: List[EducationDict] = []
    seen = set()
    for value in values:
        if not isinstance(value, dict):
            continue
        institution = _clean_str(value.get("institution"))
        if not institution:
            continue
        key = institution.casefold()
        if key in seen:
            continue
        seen.add(key)
        schools.append(EducationDict(
            institution=institution,
            kind=_clean_school_kind(value.get("kind")),
            degree=_clean_str(value.get("degree")),
            field=_clean_str(value.get("field")),
        ))
        if len(schools) == 30:
            break
    return schools


def _clean_cv_text(value: Any) -> Optional[str]:
    """Keep the CV's own wording and reject excess content before processing."""
    if not isinstance(value, str):
        return None
    if len(value) > MAX_CV_CHARACTERS or value.strip():
        validate_cv_text(value)
    text = value.replace("\x00", "").strip()
    return text or None


def _clean_skills(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    skills: List[str] = []
    seen = set()
    for value in values:
        skill = _clean_str(value)
        if skill:
            skill = skill_name(skill)
        if skill and skill.casefold() not in seen:
            seen.add(skill.casefold())
            skills.append(skill)
            if len(skills) == 50:
                break
    return skills


def normalize_cv_dict(raw: Dict[str, Any], candidate_id: str, source: str) -> CvDict:
    """Coerce extractor JSON (or hand-written JSON) into a CvDict with clean types."""
    validate_id(candidate_id)
    if not isinstance(raw, dict) or "error" in raw:
        raise ValueError("CV record must be a successful JSON object.")
    if isinstance(raw.get('cv_text'), str) and raw['cv_text'].strip():
        raw = ground_cv(raw, raw['cv_text'], enforce_seniority=False)
    birth_date = raw.get("birth_date")
    year = _clean_birth_year(raw.get("birth_year"))
    if birth_date is not None:
        if not isinstance(birth_date, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", birth_date):
            raise ValueError("Birth date must be a valid ISO date.")
        try:
            parsed_birth = date.fromisoformat(birth_date)
        except ValueError:
            raise ValueError("Birth date must be a valid ISO date.") from None
        if parsed_birth > date.today() or parsed_birth.year < 1900:
            raise ValueError("Birth date is outside the supported range.")
        if year is not None and year != parsed_birth.year:
            raise ValueError("Birth date and birth year disagree.")
        year = parsed_birth.year
    return CvDict(
        candidate_id=candidate_id,
        source=source,
        first_name=_clean_str(raw.get("first_name"), 100),
        last_name=_clean_str(raw.get("last_name"), 100),
        current_role=_clean_str(raw.get("current_role")),
        education=_clean_education(raw.get("education")),
        skills=_clean_skills(raw.get("skills")),
        learning_skills=_clean_skills(raw.get("learning_skills", raw.get("learningSkills"))),
        country=_clean_str(raw.get("country")),
        birth_date=birth_date,
        interests=_clean_skills(raw.get("interests")),
        roles=_clean_skills(raw.get("roles")),
        preferences=dict(raw["preferences"]) if isinstance(raw.get("preferences"), dict) else {},
        bio=_clean_str(raw.get("bio"), 10_000),
        general_description=_clean_str(raw.get("general_description") or raw.get("bio"), 10_000),
        location=_clean_str(raw.get("location")),
        status=_clean_str(raw.get("status")),
        birth_year=year,
        experience_level=_clean_str(raw.get("experience_level")),
        cv_filename=_clean_str(raw.get("cv_filename")),
        cv_text=_clean_cv_text(raw.get("cv_text")),
    )


def candidate_id_for(path: Path, index: Optional[int] = None) -> str:
    """Opaque dataset identity, distinct from a trusted authenticated account UID."""
    return dataset_id_for(path, index)


def _json_record_id(path: Path, item: Any) -> str:
    if isinstance(item, dict) and "candidate_id" in item:
        return validate_id(item["candidate_id"])
    # Content identity survives record reordering; explicit immutable IDs are preferred.
    canonical = json.dumps(item, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return dataset_id_for(path, hashlib.sha256(canonical.encode("utf-8")).hexdigest())


def _read_json(path: Path) -> Any:
    try:
        return json.loads(read_bounded_file(path).decode("utf-8"))
    except Exception:
        raise ValueError("CV JSON file could not be read or parsed.") from None


def extract_cv_info(file_path: str, candidate_id: Optional[str] = None, api_url: str = API_URL) -> CvDict:
    """
    Extract one CV into a CvDict.

    PDF/JPG/PNG files go through OCR/text extraction and Gemma. A .json file must hold
    a single already-extracted CV object; use iter_cv_records() for JSON lists or folders.
    """
    path = Path(file_path)
    suffix = path.suffix.lower()
    cv_id = validate_id(candidate_id) if candidate_id is not None else candidate_id_for(path)

    if suffix == ".json":
        payload = _read_json(path)
        if not isinstance(payload, dict):
            raise ValueError("CV JSON must hold one object; use iter_cv_records() for lists.")
        if candidate_id is None:
            cv_id = _json_record_id(path, payload)
        return normalize_cv_dict(payload, cv_id, str(path))

    if suffix not in RAW_CV_EXTENSIONS:
        raise ValueError(f"Unsupported CV file: {path.name}")

    text = extract_text_from_file(str(path))
    if not text:
        raise ValueError(f"No text found in '{path.name}'.")
    validate_cv_text(text)
    parsed = parse_cv_with_gemma(text, api_url)
    if isinstance(parsed, dict) and "error" not in parsed:
        parsed["cv_filename"] = path.name
        parsed["cv_text"] = text
    if not isinstance(parsed, dict) or "error" in parsed:
        reason = parsed.get("error") if isinstance(parsed, dict) else "unexpected response"
        attempts = parsed.get("attempts") if isinstance(parsed, dict) else None
        detail = f"{reason}: {attempts[0]}" if attempts else str(reason)
        raise ValueError(f"CV extraction failed for '{path.name}': {detail}")
    return normalize_cv_dict(parsed, cv_id, str(path))


def _json_cv_items(path: Path) -> List[Any]:
    payload = _read_json(path)
    if isinstance(payload, dict) and isinstance(payload.get("cvs"), list):
        payload = payload["cvs"]
    items = payload if isinstance(payload, list) else [payload]
    return items


def iter_cv_records(
    source: str,
    max_raw_files: Optional[int] = None,
    api_url: str = API_URL,
) -> Iterator[Tuple[str, Optional[CvDict], Optional[str]]]:
    """
    Yield (candidate_id, cv_dict, error) for every CV under a file or folder.

    JSON files are loaded directly (no LLM call). PDF/image files are extracted with
    Gemma; max_raw_files caps how many of them are processed per source.
    Extraction failures are yielded with cv_dict=None instead of stopping the run.
    """
    root = Path(source)
    if root.is_dir():
        files = [
            p for p in sorted(root.rglob("*"))
            if p.is_file() and not any(part in SKIP_DIRS for part in p.parts)
        ]
    elif root.is_file():
        files = [root]
    else:
        raise FileNotFoundError(f"No such path: {root}")

    raw_done = 0
    for path in files:
        suffix = path.suffix.lower()
        if suffix == ".json":
            try:
                items = _json_cv_items(path)
            except Exception:
                yield candidate_id_for(path), None, "CV JSON file could not be read or parsed."
                continue
            for index, item in enumerate(items, start=1):
                cv_id = candidate_id_for(path, index)
                try:
                    cv_id = _json_record_id(path, item)
                    cv = normalize_cv_dict(item, cv_id, f"{path}#{index}")
                except Exception:
                    yield cv_id, None, "CV record validation failed."
                else:
                    yield cv_id, cv, None
        elif suffix in RAW_CV_EXTENSIONS:
            if max_raw_files is not None and raw_done >= max_raw_files:
                continue
            raw_done += 1
            cv_id = candidate_id_for(path)
            try:
                yield cv_id, extract_cv_info(str(path), cv_id, api_url), None
            except Exception:
                yield cv_id, None, "CV file extraction failed."


def extract_event_info(raw_text: str, api_url: str = API_URL) -> EventDict:
    """
    Extract structured event criteria from free text with Gemma.

    Returns skills, event_type, location, remote, seniority, and only explicitly
    requested birth-year limits, including one-sided limits.
    """
    criteria = event_to_json(raw_text, api_url)
    return EventDict(**criteria)
