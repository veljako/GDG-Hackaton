"""Identity and exact location keys shared by extraction and persistence."""
import hashlib
import os
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Optional, Union


class RevisionConflict(ValueError):
    """The caller's snapshot is stale; automatic reload-and-overwrite is unsafe."""


def validate_event_constraints(event: dict) -> None:
    if not isinstance(event, dict):
        raise ValueError("Event must be a dictionary.")
    if "remote" in event and not isinstance(event["remote"], bool):
        raise ValueError("Event remote flag must be a boolean.")
    for field in ("min_birth_year", "max_birth_year"):
        value = event.get(field)
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 1900 <= value <= date.today().year):
            raise ValueError("Event birth-year criteria must be valid integer years.")
    for field in ("location", "seniority"):
        value = event.get(field)
        if value is not None and not isinstance(value, str):
            raise ValueError("Event location and seniority must be strings.")
    vocabularies = {"goals": {"Learning", "Networking", "Building", "Career", "Research"},
                    "roles": {"Participant", "Mentor", "Speaker", "Judge"},
                    "levels": {"Beginner", "Intermediate", "Advanced"},
                    "seniorities": {"Junior", "Mid", "Senior"},
                    "statuses": {"Student", "Employed", "Freelancer"}}
    for field in ("skills", "topics", "taught_skills", "required_skills", "goals", "roles", "levels", "seniorities", "statuses", "languages"):
        values = event.get(field)
        if values is not None:
            if not isinstance(values, list) or len(values) > 50 or any(not isinstance(v, str) or not v.strip() or len(v) > 200 for v in values):
                raise ValueError("Event list fields must contain bounded nonempty strings.")
            if field in vocabularies and any(v not in vocabularies[field] for v in values):
                raise ValueError("Event audience or eligibility vocabulary is invalid.")
    for field in ("date", "end_date", "deadline"):
        value = event.get(field)
        if value is not None:
            if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
                raise ValueError("Event dates must be ISO calendar dates.")
            try:
                date.fromisoformat(value)
            except ValueError:
                raise ValueError("Event dates must be valid calendar dates.") from None
    if event.get("date") and event.get("end_date") and event["end_date"] < event["date"]:
        raise ValueError("Event end date must not precede its start.")
    if event.get("format") not in (None, "online", "in_person", "hybrid"):
        raise ValueError("Event format is invalid.")
    for field in ("min_age", "max_age"):
        value = event.get(field)
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 130):
            raise ValueError("Event age criteria must be valid integer ages.")
    for lower, upper in (("min_age", "max_age"), ("min_birth_year", "max_birth_year")):
        if (event.get("criteria_version") == 2 or lower == "min_age") and event.get(lower) is not None and event.get(upper) is not None and event[lower] > event[upper]:
            raise ValueError("Event constraint bounds must be ascending.")


def validate_id(value: str) -> str:
    """Preserve an explicit identity exactly; rewriting it could merge accounts."""
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise ValueError("Identity must contain 1–128 ASCII letters, digits, underscores or hyphens.")
    return value


def dataset_id_for(path: Path, index: Optional[Union[int, str]] = None) -> str:
    """Dataset identity is distinct from account identity and independent of display slugs."""
    canonical = unicodedata.normalize("NFC", os.path.normcase(str(path.resolve())))
    digest = hashlib.sha256(f"{canonical}\0{index if index is not None else ''}".encode("utf-8")).hexdigest()
    return f"dataset-{digest}"


_CYRILLIC = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "dj", "е": "e",
    "ж": "z", "з": "z", "и": "i", "ј": "j", "к": "k", "л": "l", "љ": "lj",
    "м": "m", "н": "n", "њ": "nj", "о": "o", "п": "p", "р": "r", "с": "s",
    "т": "t", "ћ": "c", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "c",
    "џ": "dz", "ш": "s", "đ": "dj",
})


def canonical_city(value: Optional[str]) -> str:
    if not value or not value.strip():
        return "unknown"
    city = value.split(",", 1)[0].casefold().translate(_CYRILLIC)
    city = unicodedata.normalize("NFKD", city)
    city = "".join(ch for ch in city if not unicodedata.combining(ch))
    city = " ".join(city.split())
    return {"beograd": "belgrade", "bec": "vienna"}.get(city, city) or "unknown"


def normalize_event_constraints(event: dict) -> dict:
    """Convert unversioned reversed birth bounds explicitly, including open ends."""
    result = dict(event)
    if result.get("criteria_version") != 2:
        result["min_birth_year"], result["max_birth_year"] = event.get("max_birth_year"), event.get("min_birth_year")
        result["criteria_version"] = 2
        seniority = event.get("seniority")
        if isinstance(seniority, str) and seniority.strip():
            value = seniority.strip().casefold()
            if "student" in value:
                result.setdefault("statuses", ["Student"])
                result["seniority"] = None
            else:
                aliases = {"junior":"Junior", "intern":"Junior", "mid":"Mid", "medior":"Mid", "intermediate":"Mid", "senior":"Senior"}
                level = aliases.get(value)
                if level:
                    result.setdefault("seniorities", [level])
        result.setdefault("seniorities", [])
        if "format" not in result and isinstance(result.get("remote"), bool):
            result["format"] = "online" if result["remote"] else "in_person"
    result.setdefault("format", None)
    validate_event_constraints(result)
    return result
