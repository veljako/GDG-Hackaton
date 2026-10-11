import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Optional
from datetime import date

import requests
from jsonschema import Draft202012Validator

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractor import (  # noqa: E402
    API_URL,
    HEADERS,
    extract_text_from_file,
    parse_cv_with_gemma,
    _call_json_generate,
    MAX_CV_CHARACTERS,
    MAX_HTTP_RETRIES,
)
from contracts import canonical_city, validate_event_constraints, normalize_event_constraints  # noqa: E402

RAW_CV_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
SKIP_DIRS = {"venv", "__pycache__", ".git"}

CSV_FIELDS = ["name", "short_description", "skills", "location", "seniority", "min_birth_year", "max_birth_year", "birth_year", "remote", "event_type", "source"]

# Schema for the criteria the agent extracts from an event description.
# Extraction is independent of the current candidate dataset.
EVENT_SCHEMA = {
    "type": "object",
    "properties": {
        "skills": {"type": "array", "items": {"type": "string"}},
        "location": {"type": ["string", "null"]},
        "seniority": {"type": ["string", "null"]},
        "min_birth_year": {"type": ["integer", "null"]},
        "max_birth_year": {"type": ["integer", "null"]},
        "name": {"type": ["string", "null"]},
        "short_description": {"type": ["string", "null"]},
        "remote": {"type": "boolean"},
        "event_type": {"type": ["string", "null"]},
    },
    "required": [
        "skills",
        "location",
        "seniority",
        "min_birth_year",
        "max_birth_year",
        "name",
        "short_description",
        "remote",
        "event_type",
    ],
    "additionalProperties": False,
}

EVENT_SCHEMA["properties"].update({
    "criteria_version": {"const": 2},
    "format": {"enum": ["online", "in_person", "hybrid", None]},
    "description": {"type": ["string", "null"]},
    "country": {"type": ["string", "null"]},
    "min_age": {"type": ["integer", "null"], "minimum": 0, "maximum": 130},
    "max_age": {"type": ["integer", "null"], "minimum": 0, "maximum": 130},
    "price": {"type": ["object", "null"], "properties": {"amount": {"type": "number", "minimum": 0}, "currency": {"type": "string"}}, "required": ["amount", "currency"], "additionalProperties": False},
})
for _field_name in ("topics", "taught_skills", "required_skills", "goals", "roles", "levels", "seniorities", "statuses", "languages"):
    EVENT_SCHEMA["properties"][_field_name] = {"type": "array", "items": {"type": "string"}}
for _field_name, _values in {"goals": ["Learning", "Networking", "Building", "Career", "Research"],
                             "roles": ["Participant", "Mentor", "Speaker", "Judge"],
                             "levels": ["Beginner", "Intermediate", "Advanced"]}.items():
    EVENT_SCHEMA["properties"][_field_name]["items"] = {"enum": _values}
EVENT_SCHEMA["properties"]["seniorities"]["items"] = {"enum": ["Junior", "Mid", "Senior"]}
EVENT_SCHEMA["properties"]["statuses"]["items"] = {"enum": ["Student", "Employed", "Freelancer"]}
for _field_name in ("date", "end_date", "deadline"):
    EVENT_SCHEMA["properties"][_field_name] = {"type": ["string", "null"], "pattern": r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"}
EVENT_SCHEMA["required"].remove("remote")

_VALIDATOR = Draft202012Validator(EVENT_SCHEMA)


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def _as_int(value) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_json_object(text: str) -> dict:
    """Pull the first {...} block out of text, tolerating markdown fences."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        raise json.JSONDecodeError("The response does not contain a JSON object", text, 0)
    return json.loads(match.group(0))


def _schema_errors(data: dict) -> list:
    return ["Event response does not match the schema." for _ in _VALIDATOR.iter_errors(data)]


def _field(raw: dict, *keys):
    for key in keys:
        if key in raw and raw[key] is not None:
            return raw[key]
    return None


def _clean_cv(raw: dict, source: str) -> Optional[dict]:
    """Turn extractor JSON into the record the matcher uses."""
    if not isinstance(raw, dict) or "error" in raw:
        return None
    skill_values = _field(raw, "skills", "skillovi")
    if not isinstance(skill_values, list):
        return None

    skills = []
    for skill in skill_values:
        if isinstance(skill, str) and skill.strip():
            skills.append(skill.strip())

    location = _field(raw, "location", "lokacija")
    seniority = _field(raw, "experience_level", "seniority", "nivo_iskustva", "senioritet")

    return {
        "source": str(_field(raw, "source", "izvor") or source),
        "skills": skills,
        "location": location if isinstance(location, str) and location.strip() else None,
        "seniority": seniority if isinstance(seniority, str) and seniority.strip() else None,
        "birth_year": _as_int(_field(raw, "birth_year", "godiste")),
    }


def _read_json_cvs(path: Path) -> list:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("cvs"), list):
        items = payload["cvs"]
    elif isinstance(payload, list):
        items = payload
    else:
        items = [payload]

    cvs = []
    for index, item in enumerate(items, start=1):
        cleaned = _clean_cv(item, f"{path.stem}#{index}" if len(items) > 1 else path.stem)
        if cleaned:
            cvs.append(cleaned)
    return cvs


def _parse_raw_cv(path: Path, api_url: str) -> Optional[dict]:
    text = extract_text_from_file(str(path))
    if not text:
        print(f"Skipping '{path.name}': the file has no text.")
        return None
    parsed = parse_cv_with_gemma(text, api_url)
    if isinstance(parsed, dict) and "error" in parsed:
        print(f"Skipping '{path.name}': {parsed['error']}")
        return None
    return _clean_cv(parsed, path.name)


def load_cvs(paths: list, api_url: str) -> list:
    """Load already extracted CV JSON and, when needed, raw PDF or image files."""
    files = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            for candidate in sorted(path.rglob("*")):
                if not candidate.is_file():
                    continue
                if any(part in SKIP_DIRS for part in candidate.parts):
                    continue
                files.append(candidate)
        elif path.is_file():
            files.append(path)
        else:
            raise FileNotFoundError(f"No such path: {path}")

    cvs = []
    for path in files:
        suffix = path.suffix.lower()
        if suffix == ".json":
            cvs.extend(_read_json_cvs(path))
        elif suffix in RAW_CV_EXTENSIONS:
            cleaned = _parse_raw_cv(path, api_url)
            if cleaned:
                cvs.append(cleaned)
    return cvs


def skill_vocabulary(cvs: list) -> dict:
    """Map a normalized skill to the exact string from a CV. The first occurrence wins."""
    vocabulary = {}
    for cv in cvs:
        for skill in cv["skills"]:
            key = norm(skill)
            if key and key not in vocabulary:
                vocabulary[key] = skill
    return vocabulary


def _unique(values: list) -> list:
    seen = set()
    unique = []
    for value in values:
        if not value:
            continue
        key = norm(value)
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique


def build_event_prompt(event_text: str, cvs: list) -> str:
    if not isinstance(event_text, str) or not event_text.strip():
        raise ValueError("Event description is empty.")
    if len(event_text) > MAX_CV_CHARACTERS:
        raise ValueError("Event description exceeds the 20000 character limit.")
    return f"""Extract explicitly stated event facts, never limited to candidate skills.
Return criteria_version:2. skills are practiced/useful, taught_skills are learned,
required_skills are explicit prerequisites, topics are subjects. Exclude sponsors and negated requirements.
goals are Learning|Networking|Building|Career|Research. roles are Participant|Mentor|Speaker|Judge.
levels are Beginner|Intermediate|Advanced; [] means all levels. Preserve multiple levels.
seniorities holds only Junior, Mid, Senior restrictions; statuses holds Student, Employed, Freelancer.
Student never implies Junior or age. Do not infer age from event dates or seniority.
min_age/max_age preserve numeric ages; NEVER compute birth years from ages.
min_birth_year/max_birth_year use ascending order, only explicit born/birth year rules,
one-sided bounds remain open; when unstated return null for both.
format online|in_person|hybrid|null; online tickets/registration do not imply online attendance.
Unknown format is null. country,languages,price (amount/currency or null) are explicit facts.
event_type hackathon|conference|meetup|workshop|festival|null. name is stated title or null.
date, end_date, deadline preserve only explicitly stated ISO YYYY-MM-DD dates; otherwise null.
Do not convert natural-language dates or infer the current date.
short_description summarizes facts; description can preserve the original text.
EVENT DESCRIPTION:
{event_text}
"""


def extract_event_criteria(event_text: str, cvs: list, api_url: str, max_retries: int = 1) -> dict:
    """Extract grounded criteria independently of the existing CV vocabulary."""
    vocabulary = {}
    prompt = build_event_prompt(event_text, cvs)
    data = _call_json_generate(api_url, prompt, EVENT_SCHEMA, min(MAX_HTTP_RETRIES, max_retries))
    data["criteria_version"] = 2
    for field in ("skills", "topics", "taught_skills", "required_skills", "goals", "roles", "levels", "seniorities", "statuses", "languages"):
        data[field] = _dedupe_skills(data.get(field) or [])
    for field in ("skills", "taught_skills", "required_skills"):
        for skill in data[field]:
            pattern = next((pattern for name, pattern in _SCRAPE_SKILLS if norm(name) == norm(skill)), r"(?<!\w)" + re.escape(skill) + r"(?!\w)")
            if not re.search(pattern, event_text, re.I):
                raise ValueError("Event response contains an unstated skill.")
    _merge_scraped_skills(event_text, data, vocabulary)
    _normalize_event_type(event_text, data)
    _normalize_birth_years(event_text, data)
    if not _mentions_age_or_birth_year(event_text):
        data["min_age"] = data["max_age"] = None
    _normalize_open_audience(event_text, data)
    _normalize_explicit_audience_fields(event_text, data)
    _normalize_name(data)
    _normalize_short_description(data)
    _normalize_format(event_text, data)
    _normalize_dates(event_text, data)
    validate_event_constraints(data)
    for field in ("location", "seniority"):
        if isinstance(data.get(field), str):
            data[field] = data[field].strip()[:200] or None
    return data


def _normalize_open_audience(event_text: str, data: dict) -> None:
    """Explicitly unrestricted audiences must not require known private metadata."""
    if re.search(r"\b(?:no\s+age\s+(?:restrictions?|limits?)|all\s+ages|without\s+age\s+(?:restrictions?|limits?))\b", event_text, re.I):
        data["min_age"] = data["max_age"] = None
    all_scope = r"\b(?:all|any)\s+(?:(?:professional|current|employment)\s+)?"
    seniorities = r"(?:seniorit(?:y|ies)|experience\s+levels?)"
    if re.search(all_scope + seniorities + r"\b", event_text, re.I):
        data["seniorities"] = []
        data["seniority"] = None
    if re.search(all_scope + r"statuses\b|" + all_scope + seniorities + r"\s+and\s+(?:employment\s+)?statuses\b", event_text, re.I):
        data["statuses"] = []


def _normalize_explicit_audience_fields(event_text: str, data: dict) -> None:
    """Recover literal audience labels and delivery languages, without inference."""
    labelled = re.search(r"\baudience\s+levels?\s*:\s*([^.;!?\n]+)", event_text, re.I)
    if labelled:
        levels = re.findall(r"\b(?:Beginner|Intermediate|Advanced)\b", labelled[1], re.I)
        if levels:
            data["levels"] = _dedupe_skills([level.title() for level in levels])
        elif re.search(r"\ball\s+levels\b", labelled[1], re.I):
            data["levels"] = []
    languages = re.findall(
        r"\b(?:taught|conducted|delivered|held)\s+in\s+(English|Serbian|French|German|Spanish|Italian|Portuguese|Russian|Japanese|Chinese)\b",
        event_text, re.I,
    )
    if languages:
        data["languages"] = _dedupe_skills((data.get("languages") or []) + [language.title() for language in languages])


def _dedupe_skills(skills: list) -> list:
    chosen = []
    seen = set()
    for skill in skills:
        if not isinstance(skill, str) or not skill.strip():
            continue
        key = norm(skill)
        if key in seen:
            continue
        seen.add(key)
        chosen.append(skill.strip()[:200])
        if len(chosen) == 50:
            break
    return chosen


def _dedupe_known_skills(skills: list, vocabulary: dict) -> list:
    chosen = []
    seen = set()
    for skill in skills:
        key = norm(skill)
        if key in seen or key not in vocabulary:
            continue
        seen.add(key)
        chosen.append(vocabulary[key][:200])
        if len(chosen) == 50:
            break
    return chosen


def seniority_bucket(value: Optional[str]) -> Optional[str]:
    if not value or not str(value).strip():
        return None
    text = norm(str(value))
    if "senior" in text:
        return "senior"
    if any(token in text for token in ("mid", "medior", "srednj")):
        return "mid"
    if any(token in text for token in ("junior", "student", "intern", "pocet", "počet")):
        return "junior"
    return text


def _location_matches(cv_location: Optional[str], wanted: Optional[str]) -> bool:
    if not wanted:
        return True
    if not cv_location:
        return False
    return canonical_city(cv_location) == canonical_city(wanted)


def _seniority_matches(cv_level: Optional[str], wanted: Optional[str]) -> bool:
    if not wanted:
        return True
    if not cv_level:
        return False
    if seniority_bucket(cv_level) == seniority_bucket(wanted):
        return True
    left = norm(cv_level)
    right = norm(wanted)
    return right in left or left in right


def _mentions_age_or_birth_year(text: str) -> bool:
    """True only when the description states an age or a birth year, not a seniority word."""
    if re.search(r"\b\d{4}\b", text) and re.search(
        r"\b(born|birth|year of birth|birth year|godiste|godište)\b", text, flags=re.IGNORECASE
    ):
        return True
    if re.search(r"\b(age[ds]?|years?\s*old|year-olds?)\b", text, flags=re.IGNORECASE):
        return True
    if re.search(r"\b\d{1,2}\s*(?:-|–|to|through)\s*\d{1,2}\b", text, flags=re.IGNORECASE) and re.search(
        r"\b(year|years|old|age)\b", text, flags=re.IGNORECASE
    ):
        return True
    if re.search(r"\baround\s+\d{1,2}\b", text, flags=re.IGNORECASE):
        return True
    if re.search(r"\b(?:participants?|people|attendees?|developers?)\s+(?:(?:aged|who are)\s+)?(?:over|under|older than|younger than|at least|at most)\s+\d{1,3}\b", text, re.I):
        return True
    if re.search(r"\b\d{1,3}\s*\+", text) or re.search(r"\b\d{1,3}\s*godin[aeu]\b", text, re.I):
        return True
    return False


def _set_birth_years(data: dict, min_birth_year: Optional[int], max_birth_year: Optional[int]) -> None:
    data["min_birth_year"] = min_birth_year
    data["max_birth_year"] = max_birth_year


def _normalize_birth_years(event_text: str, data: dict) -> None:
    """Validate explicit bounds, preserving missing endpoints as open bounds."""
    data.pop("birth_years", None)
    for field in ("min_birth_year", "max_birth_year"):
        value = data.get(field)
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 1900 <= value <= date.today().year):
            raise ValueError("Event birth year must be between 1900 and the current year.")
    if not _mentions_age_or_birth_year(event_text):
        _set_birth_years(data, None, None)
        return
    if data.get("criteria_version") == 2:
        if not re.search(r"\b(?:born|birth|godiste|godište)\b", event_text, re.I):
            _set_birth_years(data, None, None)
        return
    younger_year = _as_int(data.get("min_birth_year"))
    older_year = _as_int(data.get("max_birth_year"))
    if younger_year is not None and older_year is not None and older_year > younger_year:
        _set_birth_years(data, older_year, younger_year)


def _normalize_dates(event_text: str, data: dict) -> None:
    explicit = set(re.findall(r"(?<![0-9])[0-9]{4}-[0-9]{2}-[0-9]{2}(?![0-9])", event_text))
    for field in ("date", "end_date", "deadline"):
        value = data.get(field)
        data[field] = value if value in explicit else None


def _normalize_name(data: dict) -> None:
    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        data["name"] = None
        return
    data["name"] = name.strip()[:200]


def _normalize_short_description(data: dict) -> None:
    description = data.get("short_description")
    if not isinstance(description, str) or not description.strip():
        data["short_description"] = None
        return
    data["short_description"] = " ".join(description.split())[:200]


_SCRAPE_SKILLS = (
    ("AI", r"\b(?:AI|artificial intelligence)\b"),
    ("machine learning", r"\bmachine learning\b"),
    ("deep learning", r"\bdeep learning\b"),
    ("NLP", r"\b(?:NLP|natural language processing)\b"),
    ("LLM", r"\b(?:LLMs?|large language models?)\b"),
    ("Python", r"\bPython\b"),
    ("PyTorch", r"\bPyTorch\b"),
    ("TensorFlow", r"\bTensorFlow\b"),
    ("Docker", r"\bDocker\b"),
    ("Kubernetes", r"\bKubernetes\b|\bK8s\b"),
    ("React", r"\bReact(?:\.js)?\b"),
    ("TypeScript", r"\bTypeScript\b"),
    ("JavaScript", r"\bJavaScript\b"),
    ("SQL", r"\bSQL\b"),
)


_REMOTE_WORDS = re.compile(
    r"\b(remote|online|virtual|hybrid|from home|work from home|zoom|udaljeno|na daljinu)\b",
    flags=re.IGNORECASE,
)
_IN_PERSON_WORDS = re.compile(
    r"\b(in[- ]person|on[- ]site|onsite|at the venue|uživo|uzivo)\b",
    flags=re.IGNORECASE,
)


_EVENT_TYPES = (
    ("hackathon", r"\bhackathons?\b|\bhakaton\b"),
    ("conference", r"\bconferences?\b|\bkonferencij[ae]\b"),
    ("meetup", r"\bmeet-?ups?\b"),
    ("festival", r"\bfestivals?\b"),
    ("workshop", r"\bworkshops?\b|\bradionic[ae]\b"),
)


def _normalize_event_type(event_text: str, data: dict) -> None:
    """Prefer the selected structured type when several event kinds are mentioned."""
    selected = data.get("event_type")
    if isinstance(selected, str) and selected.strip().casefold() in {name for name, _ in _EVENT_TYPES}:
        data["event_type"] = selected.strip().casefold()
        return
    found = []
    for name, pattern in _EVENT_TYPES:
        match = re.search(pattern, event_text, flags=re.IGNORECASE)
        if match:
            found.append((match.start(), name))
    if not found:
        data["event_type"] = None
        return
    found.sort()
    data["event_type"] = found[0][1]


def _normalize_format(event_text: str, data: dict) -> None:
    clauses = []
    for clause in re.split(r"[.;!?\n]", event_text):
        if re.search(r"\b(?:registration|tickets?|sign[- ]?up|applications?|recordings?|advertising)\b", clause, re.I) and not re.search(r"\b(?:attend|attendance|participation|participate|join)\b", clause, re.I):
            continue
        clauses.append(clause)
    text = ". ".join(clauses)
    hits = list(_REMOTE_WORDS.finditer(text))
    negated = any(_mention_negated(text, h.start(), h.end()) for h in hits)
    if re.search(r"\bhybrid\b", text, re.I) and not negated:
        value = "hybrid"
    elif negated or _IN_PERSON_WORDS.search(text):
        value = "in_person"
    elif hits:
        value = "online"
    else:
        value = None
    data["format"] = value
    if value is None:
        data.pop("remote", None)
    else:
        data["remote"] = value in ("online", "hybrid")


def _normalize_remote(event_text: str, data: dict) -> None:
    """True only when the event lets people attend without being physically present."""
    if re.search(r"\b(?:in[- ]person|on[- ]site|onsite|uživo|uzivo)\s+only\b", event_text, re.I):
        data["remote"] = False
        return
    attendance = []
    ignored = False
    for clause in re.split(r"[.;!?\n]", event_text):
        hits = list(_REMOTE_WORDS.finditer(clause))
        if not hits:
            continue
        if any(_mention_negated(clause, hit.start(), hit.end()) for hit in hits):
            data["remote"] = False
            return
        if re.search(r"\b(?:registration|tickets?|sign[- ]?up|applications?|recordings?|advertising)\b", clause, re.I) and not re.search(r"\b(?:attend|attendance|participation|participate|join)\b", clause, re.I):
            ignored = True
            continue
        attendance.extend(hits)
    if attendance:
        data["remote"] = data.get("remote") is True
    elif ignored:
        data["remote"] = False
    else:
        data["remote"] = data.get("remote") is True


def _mention_negated(clause: str, start: int, end: int) -> bool:
    prefix = re.split(r"\b(?:but|however|instead)\b", clause[:start], flags=re.I)[-1]
    # A completed requirement followed by a new clause ends the negative scope.
    # Bare commas remain inside lists such as "No Docker, Kubernetes or SQL".
    prefix = re.split(
        r"\b(?:required|needed|necessary|mandatory|available|allowed|supported)\b\s*(?:,\s*(?:and\s+)?|(?:and|while)\b\s*)",
        prefix, flags=re.I,
    )[-1]
    suffix = clause[end:]
    before = re.search(r"\b(?:no|not|without|never|don't|do not|doesn't|does not|nije|nisu)\b[^.;!?]*$", prefix, re.I)
    after = re.match(r"\s*(?:(?:experience|knowledge|skills?|proficiency|participation|attendance)\s+)*(?:(?:is|are)\s+)?(?:not\b|isn't\b|aren't\b)", suffix, re.I)
    return bool(before or after)


def _scrape_skills(event_text: str) -> list:
    found = []
    for name, pattern in _SCRAPE_SKILLS:
        if any(not _mention_negated(clause, hit.start(), hit.end())
               for clause in re.split(r"[.;!?\n]", event_text)
               for hit in re.finditer(pattern, clause, re.I)):
            found.append(name)
    return found


def _merge_scraped_skills(event_text: str, data: dict, vocabulary: dict) -> None:
    # Mentioned tools may be sponsors or examples. Never augment validated extraction
    # with unconditional keyword hits; only remove explicit negative requirements.
    def excluded(skill):
        pattern = next((pattern for name, pattern in _SCRAPE_SKILLS if norm(name) == norm(skill)),
                       r"(?<!\w)" + re.escape(skill) + r"(?!\w)")
        return any(_mention_negated(clause, hit.start(), hit.end())
                   for clause in re.split(r"[.;!?\n]", event_text)
                   for hit in re.finditer(pattern, clause, re.I))
    for field in ("skills", "required_skills"):
        data[field] = _dedupe_skills([skill for skill in data.get(field) or [] if not excluded(skill)])


def _years_match(birth_year: Optional[int], criteria: dict, required: bool = False) -> bool:
    normalized = normalize_event_constraints(criteria)
    low = _as_int(normalized.get("min_birth_year"))
    high = _as_int(normalized.get("max_birth_year"))
    # max_birth_year is the smaller number, so the two fields may be out of numeric order.
    if low is not None and high is not None and low > high:
        low, high = high, low
    if low is None and high is None:
        return True
    if birth_year is None:
        return False
    if low is not None and birth_year < low:
        return False
    if high is not None and birth_year > high:
        return False
    return True


def _has_filter(criteria: dict) -> bool:
    return bool(
        criteria.get("skills")
        or criteria.get("location")
        or criteria.get("seniority")
        or criteria.get("name")
        or _as_int(criteria.get("min_birth_year")) is not None
        or _as_int(criteria.get("max_birth_year")) is not None
    )


def match_people(cvs: list, criteria: dict) -> list:
    """
    Return people whose CV matches the event criteria.
    The skills column is only the overlap: an event skill that this CV actually has.
    """
    if not _has_filter(criteria):
        return []

    wanted = {norm(skill): skill for skill in criteria.get("skills") or []}
    year_filter_active = (
        _as_int(criteria.get("min_birth_year")) is not None
        or _as_int(criteria.get("max_birth_year")) is not None
    )
    matched = []

    for cv in cvs:
        if criteria.get("remote") is not True and not _location_matches(cv["location"], criteria.get("location")):
            continue
        if not _seniority_matches(cv["seniority"], criteria.get("seniority")):
            continue
        if not _years_match(cv["birth_year"], criteria):
            continue

        overlap = []
        seen = set()
        for skill in cv["skills"]:
            key = norm(skill)
            if key in wanted and key not in seen:
                seen.add(key)
                overlap.append(skill)

        if wanted and not overlap:
            continue

        year_known = year_filter_active and cv["birth_year"] is not None
        matched.append(
            {
                "name": criteria.get("name") or "",
                "short_description": criteria.get("short_description") or "",
                "skills": ", ".join(overlap),
                "location": cv["location"] or "",
                "seniority": cv["seniority"] or "",
                "min_birth_year": "" if criteria.get("min_birth_year") is None else str(criteria["min_birth_year"]),
                "max_birth_year": "" if criteria.get("max_birth_year") is None else str(criteria["max_birth_year"]),
                "birth_year": "" if cv["birth_year"] is None else str(cv["birth_year"]),
                "remote": "true" if criteria.get("remote") else "false",
                "event_type": criteria.get("event_type") or "",
                "source": cv["source"],
                "_score": (len(overlap), 1 if year_known else 0),
            }
        )

    matched.sort(key=lambda row: (-row["_score"][0], -row["_score"][1], row["source"]))
    for row in matched:
        row.pop("_score", None)
    return matched


def write_csv(rows: list, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def _read_event_text(event: Optional[str], event_file: Optional[str]) -> str:
    if event and event_file:
        raise ValueError("Pass either --event or --event-file, not both.")
    if event:
        return event.strip()
    if event_file:
        return Path(event_file).read_text(encoding="utf-8").strip()

    print("Describe the event you are organizing. An empty line ends the input:")
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if not line.strip():
            break
        lines.append(line)
    return "\n".join(lines).strip()


def event_to_json(event_text: str, api_url: str = API_URL) -> dict:
    """Take an event description and return flat JSON search criteria."""
    if not event_text or not str(event_text).strip():
        raise ValueError("Event description is empty.")
    return extract_event_criteria(event_text.strip(), [], api_url)


def find_candidates_for_event(event_text: str, cv_paths: list, out_path: str, api_url: str = API_URL) -> tuple:
    """Return (criteria, CSV rows) and write the matched candidates to out_path."""
    cvs = load_cvs(cv_paths, api_url)
    if not cvs:
        raise ValueError("No CV was loaded. Pass JSON from extractor.py, or a PDF/image.")

    criteria = extract_event_criteria(event_text, cvs, api_url)
    rows = match_people(cvs, criteria)
    write_csv(rows, Path(out_path))
    return criteria, rows


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Find people in CVs from a hackathon or conference description "
            "and write skills, location, seniority, birth year, remote, and event type."
        )
    )
    parser.add_argument("--event", help="Event description as one sentence or a paragraph.")
    parser.add_argument("--event-file", help="Text file with the event description.")
    parser.add_argument(
        "--cvs",
        nargs="+",
        required=True,
        help="File or folder: JSON from extractor.py, or a PDF/JPG/PNG CV.",
    )
    parser.add_argument("--out", default="people.csv", help="Output CSV. Default: people.csv")
    parser.add_argument("--api-url", default=API_URL, help="Gemma /generate endpoint.")
    args = parser.parse_args(argv)

    try:
        event_text = _read_event_text(args.event, args.event_file)
        if not event_text:
            print("Error: the event description is empty.")
            return 1

        criteria, rows = find_candidates_for_event(event_text, args.cvs, args.out, args.api_url)
        print("Criteria extracted from the event description:")
        print(json.dumps(criteria, indent=2, ensure_ascii=False))
        print(f"\nWrote {len(rows)} people to '{args.out}'.")
        return 0
    except Exception as err:
        print("Error:", err)
        return 1


if __name__ == "__main__":
    sys.exit(main())
