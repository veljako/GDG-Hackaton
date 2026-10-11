"""
Extractors: turn raw CVs and raw event text into structured dictionaries.

CV extraction reuses extractor.py (PDF/image text + Gemma JSON). Event extraction
reuses event_candidate_finder.event_to_json (Gemma + rule-based normalization).
No database or embedding code lives here.
"""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple, TypedDict

sys.path.insert(0, str(Path(__file__).resolve().parent))

from event_candidate_finder import event_to_json  # noqa: E402
from extractor import API_URL, extract_text_from_file, parse_cv_with_gemma  # noqa: E402

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
    general_description: Optional[str]
    location: Optional[str]
    status: Optional[str]
    birth_year: Optional[int]
    experience_level: Optional[str]
    cv_filename: Optional[str]
    cv_text: Optional[str]


class EventDict(TypedDict, total=False):
    event_id: str
    name: Optional[str]
    short_description: Optional[str]
    event_type: Optional[str]
    skills: List[str]
    location: Optional[str]
    remote: bool
    seniority: Optional[str]
    # max_birth_year is the smaller year (oldest participant); see event_candidate_finder.py.
    min_birth_year: Optional[int]
    max_birth_year: Optional[int]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or "item"


def _clean_str(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text or None


def _clean_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


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
    """Keep the CV's own wording. Whitespace inside the text stays; only a hard cap is applied."""
    if not isinstance(value, str):
        return None
    text = value.replace("\x00", "").strip()
    return text[:100_000] or None


def _clean_skills(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    skills: List[str] = []
    seen = set()
    for value in values:
        skill = _clean_str(value)
        if skill and skill.casefold() not in seen:
            seen.add(skill.casefold())
            skills.append(skill)
    return skills


def normalize_cv_dict(raw: Dict[str, Any], candidate_id: str, source: str) -> CvDict:
    """Coerce extractor JSON (or hand-written JSON) into a CvDict with clean types."""
    return CvDict(
        candidate_id=candidate_id,
        source=source,
        first_name=_clean_str(raw.get("first_name")),
        last_name=_clean_str(raw.get("last_name")),
        current_role=_clean_str(raw.get("current_role")),
        education=_clean_education(raw.get("education")),
        skills=_clean_skills(raw.get("skills")),
        general_description=_clean_str(raw.get("general_description")),
        location=_clean_str(raw.get("location")),
        status=_clean_str(raw.get("status")),
        birth_year=_clean_int(raw.get("birth_year")),
        experience_level=_clean_str(raw.get("experience_level")),
        cv_filename=_clean_str(raw.get("cv_filename")),
        cv_text=_clean_cv_text(raw.get("cv_text")),
    )


def candidate_id_for(path: Path, index: Optional[int] = None) -> str:
    """Readable, stable id from the parent folder and file name, e.g. 'tr_cv/luka-prlincevic-cv'."""
    base = f"{path.parent.name}/{slugify(path.stem)}"
    return f"{base}-{index:02d}" if index is not None else base


def extract_cv_info(file_path: str, candidate_id: Optional[str] = None, api_url: str = API_URL) -> CvDict:
    """
    Extract one CV into a CvDict.

    PDF/JPG/PNG files go through OCR/text extraction and Gemma. A .json file must hold
    a single already-extracted CV object; use iter_cv_records() for JSON lists or folders.
    """
    path = Path(file_path)
    suffix = path.suffix.lower()
    cv_id = candidate_id or candidate_id_for(path)

    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"'{path.name}' holds {type(payload).__name__}; use iter_cv_records() for lists.")
        return normalize_cv_dict(payload, cv_id, str(path))

    if suffix not in RAW_CV_EXTENSIONS:
        raise ValueError(f"Unsupported CV file: {path.name}")

    text = extract_text_from_file(str(path))
    if not text:
        raise ValueError(f"No text found in '{path.name}'.")
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


def _json_cv_items(path: Path) -> List[Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("cvs"), list):
        payload = payload["cvs"]
    items = payload if isinstance(payload, list) else [payload]
    return [item for item in items if isinstance(item, dict) and "error" not in item]


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
            items = _json_cv_items(path)
            for index, item in enumerate(items, start=1):
                cv_id = candidate_id_for(path, index if len(items) > 1 else None)
                yield cv_id, normalize_cv_dict(item, cv_id, f"{path}#{index}"), None
        elif suffix in RAW_CV_EXTENSIONS:
            if max_raw_files is not None and raw_done >= max_raw_files:
                continue
            raw_done += 1
            cv_id = candidate_id_for(path)
            try:
                yield cv_id, extract_cv_info(str(path), cv_id, api_url), None
            except Exception as err:
                yield cv_id, None, str(err)


def extract_event_info(raw_text: str, api_url: str = API_URL) -> EventDict:
    """
    Extract structured event criteria from free text with Gemma.

    Returns skills, event_type, location, remote, seniority, and a birth-year range
    (a hackathon without a stated age gets the 18-25 default from event_candidate_finder).
    """
    criteria = event_to_json(raw_text, api_url)
    return EventDict(
        name=_clean_str(criteria.get("name")),
        short_description=_clean_str(criteria.get("short_description")),
        event_type=_clean_str(criteria.get("event_type")),
        skills=_clean_skills(criteria.get("skills")),
        location=_clean_str(criteria.get("location")),
        remote=criteria.get("remote") is True,
        seniority=_clean_str(criteria.get("seniority")),
        min_birth_year=_clean_int(criteria.get("min_birth_year")),
        max_birth_year=_clean_int(criteria.get("max_birth_year")),
    )
