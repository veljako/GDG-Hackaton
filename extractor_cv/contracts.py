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
