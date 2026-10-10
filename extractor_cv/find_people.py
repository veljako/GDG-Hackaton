import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Optional

import requests
from jsonschema import Draft202012Validator

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractor import (  # noqa: E402
    API_URL,
    HEADERS,
    extract_text_from_file,
    parse_cv_with_gemma,
)

# Year used to turn an age mentioned in the event description into a birth year.
CURRENT_YEAR = 2026

# A hackathon always has a birth-year range. These ages are used when the text gives none.
HACKATHON_MIN_AGE = 18
HACKATHON_MAX_AGE = 25

RAW_CV_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
SKIP_DIRS = {"venv", "__pycache__", ".git"}

CSV_FIELDS = ["name", "skills", "location", "seniority", "min_birth_year", "max_birth_year", "birth_year", "remote", "event_type", "source"]

# Schema for the criteria the agent extracts from an event description.
# After the call, skills are kept only when they actually appear in a CV.
EVENT_SCHEMA = {
    "type": "object",
    "properties": {
        "skills": {"type": "array", "items": {"type": "string"}},
        "location": {"type": ["string", "null"]},
        "seniority": {"type": ["string", "null"]},
        "min_birth_year": {"type": ["integer", "null"]},
        "max_birth_year": {"type": ["integer", "null"]},
        "name": {"type": ["string", "null"]},
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
        "remote",
        "event_type",
    ],
    "additionalProperties": False,
}

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
    return [
        f"{'/'.join(str(p) for p in err.path) or '<root>'}: {err.message}"
        for err in _VALIDATOR.iter_errors(data)
    ]


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
    vocabulary = list(skill_vocabulary(cvs).values())
    locations = _unique([cv["location"] for cv in cvs])
    levels = _unique([cv["seniority"] for cv in cvs])
    if vocabulary:
        skill_rule = (
            "only skills this event needs AND that appear in the list below. "
            "Return them exactly as written in the list. "
            "If none apply, return an empty array. Do not invent a skill that is not on the list."
        )
    else:
        skill_rule = (
            "skills this event needs, taken from the description. "
            "If the description names no skill, return an empty array."
        )

    return f"""
You help a hackathon or conference organizer find people.
The organizer describes the event in free text. Extract search criteria. Follow every rule below. If two rules seem to conflict, the negative rule ("do not") wins.

Skills:
- {skill_rule}
- A skill is any technology, language, tool, framework, library, or subject the event is about or the participants should know.
- Include the subject of the event even when it is not written as "people who know X".
  Example: "AI hackathon in Belgrade, I need juniors who know Python" -> skills must include both "AI" and "Python".
  "AI" is required because the event is an AI hackathon. Do not drop it just because only Python is in the phrase "who know".
- Also include domains and methods named in the text, such as machine learning, deep learning, NLP, or LLM, using a short name.
- Do not include sponsors, venues, cities, dates, food, or seniority words as skills.
- Do not include a skill that the organizer says they do not need.

Location:
- City or city plus country where the event happens, or where the people should come from.
- If several places appear, prefer the place where participants must be or must travel.
- If you can, copy the closest string from the location list below.
- If no place is mentioned, null. Do not invent one.

Seniority:
- The career level of the people they want: "Student / Junior", "Mid", or "Senior", or null.
- "Junior", "student", "intern" mean seniority. They are not an age and they are not a birth year.
- If they want participants at one level and mentors at another, return the participant level.

Name:
- "name" is the event name, a short title.
- Use it only when the organizer states a name, for example "DevFest Belgrade".
- If they do not name the event, return null. Do not copy the whole description into "name".

Birth years:
- "min_birth_year" and "max_birth_year" are top-level fields, not nested in another object.
- The current year is {CURRENT_YEAR}.
- For a conference, meetup, or workshop, return null for both years unless the text contains a number that is an age, an age range, or a birth year.
- A hackathon always has both years. Never return null for a hackathon.
- If a hackathon description gives no age, use {HACKATHON_MIN_AGE} to {HACKATHON_MAX_AGE}: max_birth_year = {CURRENT_YEAR - HACKATHON_MAX_AGE}, min_birth_year = {CURRENT_YEAR - HACKATHON_MIN_AGE}.
- Do not invent ages from words like junior, senior, student, beginner, or experienced, except for that hackathon default.
- Event dates, conference years, and deadlines are not birth years. "14 to 16 November {CURRENT_YEAR}" does not produce a birth year.
- max_birth_year is the smaller number. It is the birth year of the oldest acceptable person.
- min_birth_year is the larger number. It is the birth year of the youngest acceptable person.
- max_birth_year must be less than or equal to min_birth_year.
- Age range "20 to 25": the oldest is 25, so max_birth_year = {CURRENT_YEAR} - 25. The youngest is 20, so min_birth_year = {CURRENT_YEAR} - 20.
  Worked example in {CURRENT_YEAR}: max_birth_year = {CURRENT_YEAR - 25}, min_birth_year = {CURRENT_YEAR - 20}.
- A single age N, or "around N": oldest is N + 2, youngest is N - 2.
  max_birth_year = {CURRENT_YEAR} - (N + 2). min_birth_year = {CURRENT_YEAR} - (N - 2).
- An exact birth year Y: min_birth_year and max_birth_year are both Y.

Remote:
- "remote" is true when participants can attend without being in the room: remote, online, virtual, hybrid, from home.
- "remote" is false when the event is in person only, or when the text never says it is remote, online, or virtual.
- A city by itself does not make the event remote. "AI hackathon in Belgrade" is remote false.
- "Online AI hackathon" is remote true. If no city is named, location is null.
- Hybrid is remote true, because people can join without traveling.

Event type:
- "event_type" is the kind of event named in the text, as a short lowercase word.
- Use "hackathon", "conference", "meetup", or "workshop" when that word, or a clear synonym, is in the text.
- If the text names more than one, use the one the organizer is actually running.
- If the text does not say what kind of event it is, return null. Do not guess from the skills or the city.
- "AI hackathon in Belgrade" is event_type "hackathon". "developers conference" is "conference".

Wrong answer to refuse:
Input: "AI hackathon in Belgrade, I need juniors who know Python"
Wrong: skills only ["Python"], a guessed birth-year range, remote true, or event_type null.
Right: name null, skills include "AI" and "Python", location "Belgrade", seniority "Junior" or "Student / Junior", min_birth_year {CURRENT_YEAR - HACKATHON_MIN_AGE}, max_birth_year {CURRENT_YEAR - HACKATHON_MAX_AGE}, remote false, event_type "hackathon".

Skills present in the CVs:
{json.dumps(vocabulary, ensure_ascii=False)}

Locations present in the CVs:
{json.dumps(locations, ensure_ascii=False)}

Seniority levels present in the CVs:
{json.dumps(levels, ensure_ascii=False)}

EVENT DESCRIPTION:
---
{event_text}
---
"""


def extract_event_criteria(event_text: str, cvs: list, api_url: str, max_retries: int = 1) -> dict:
    """Send the event description to Gemma and return criteria aligned with CV skills."""
    vocabulary = skill_vocabulary(cvs)
    prompt = build_event_prompt(event_text, cvs)
    strict_prompt = prompt + (
        "\nReturn ONLY a JSON object, with no markdown fences and no extra text. "
        f"The object must match this schema:\n{json.dumps(EVENT_SCHEMA, ensure_ascii=False)}\n"
    )
    current_prompt = strict_prompt
    last_error = None
    raw = ""

    for _ in range(max_retries + 1):
        response = requests.post(
            api_url,
            json={"prompt": current_prompt},
            headers=HEADERS,
            timeout=120,
        )
        if response.status_code != 200:
            raise RuntimeError(f"Server error: {response.status_code} {response.text[:300]}")

        raw = response.json().get("response", "")
        try:
            data = _extract_json_object(raw)
            problems = _schema_errors(data)
            if problems:
                last_error = "Response does not match the schema: " + "; ".join(problems)
            else:
                unknown = [skill for skill in data["skills"] if norm(skill) not in vocabulary]
                if vocabulary and unknown:
                    last_error = "Skills were not found in any CV: " + ", ".join(unknown)
                else:
                    if vocabulary:
                        data["skills"] = _dedupe_known_skills(data["skills"], vocabulary)
                    else:
                        data["skills"] = _dedupe_skills(data["skills"])
                    _merge_scraped_skills(event_text, data, vocabulary)
                    _normalize_event_type(event_text, data)
                    _normalize_birth_years(event_text, data)
                    _normalize_name(data)
                    _normalize_remote(event_text, data)
                    if isinstance(data.get("location"), str):
                        data["location"] = data["location"].strip() or None
                    if isinstance(data.get("seniority"), str):
                        data["seniority"] = data["seniority"].strip() or None
                    return data
        except json.JSONDecodeError as exc:
            last_error = f"Response is not valid JSON: {exc.msg}"

        current_prompt = (
            strict_prompt
            + f"\nYour previous answer was rejected. Reason: {last_error}\n"
            + f"Previous answer:\n{raw}\n\nFix it and return only the JSON object."
        )

    raise ValueError(f"{last_error} | raw_response: {raw[:500]}")


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
        chosen.append(skill.strip())
    return chosen


def _dedupe_known_skills(skills: list, vocabulary: dict) -> list:
    chosen = []
    seen = set()
    for skill in skills:
        key = norm(skill)
        if key in seen or key not in vocabulary:
            continue
        seen.add(key)
        chosen.append(vocabulary[key])
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
    left = norm(cv_location)
    right = norm(wanted)
    return left == right or right in left or left in right


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
    if re.search(r"\b(19|20)\d{2}\b", text) and re.search(
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
    return False


def _set_birth_years(data: dict, min_birth_year: Optional[int], max_birth_year: Optional[int]) -> None:
    data["min_birth_year"] = min_birth_year
    data["max_birth_year"] = max_birth_year


def _hackathon_default_years(data: dict) -> None:
    """Oldest person has the smaller birth year, so that value is max_birth_year."""
    _set_birth_years(
        data,
        CURRENT_YEAR - HACKATHON_MIN_AGE,
        CURRENT_YEAR - HACKATHON_MAX_AGE,
    )


def _normalize_birth_years(event_text: str, data: dict) -> None:
    """Keep max_birth_year as the smaller year. A hackathon always has both bounds."""
    data.pop("birth_years", None)
    hackathon = data.get("event_type") == "hackathon"
    if not _mentions_age_or_birth_year(event_text):
        if hackathon:
            _hackathon_default_years(data)
        else:
            _set_birth_years(data, None, None)
        return
    younger_year = _as_int(data.get("min_birth_year"))
    older_year = _as_int(data.get("max_birth_year"))
    if younger_year is None or older_year is None:
        if hackathon:
            _hackathon_default_years(data)
        else:
            _set_birth_years(data, None, None)
        return
    if older_year > younger_year:
        _set_birth_years(data, older_year, younger_year)


def _normalize_name(data: dict) -> None:
    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        data["name"] = None
        return
    data["name"] = name.strip()


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
    ("workshop", r"\bworkshops?\b|\bradionic[ae]\b"),
)


def _normalize_event_type(event_text: str, data: dict) -> None:
    """Keep the event type only when the description actually names one."""
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


def _normalize_remote(event_text: str, data: dict) -> None:
    """True only when the event lets people attend without being physically present."""
    remote_hit = _REMOTE_WORDS.search(event_text) is not None
    in_person_hit = _IN_PERSON_WORDS.search(event_text) is not None
    if remote_hit:
        data["remote"] = True
    elif in_person_hit:
        data["remote"] = False
    else:
        data["remote"] = data.get("remote") is True


def _scrape_skills(event_text: str) -> list:
    found = []
    for name, pattern in _SCRAPE_SKILLS:
        if re.search(pattern, event_text, flags=re.IGNORECASE):
            found.append(name)
    return found


def _merge_scraped_skills(event_text: str, data: dict, vocabulary: dict) -> None:
    scraped = _scrape_skills(event_text)
    if vocabulary:
        scraped = [skill for skill in scraped if norm(skill) in vocabulary]
    data["skills"] = _dedupe_skills(list(data.get("skills") or []) + scraped)


def _years_match(birth_year: Optional[int], criteria: dict, required: bool = False) -> bool:
    low = _as_int(criteria.get("min_birth_year"))
    high = _as_int(criteria.get("max_birth_year"))
    # max_birth_year is the smaller number, so the two fields may be out of numeric order.
    if low is not None and high is not None and low > high:
        low, high = high, low
    if low is None and high is None:
        return not required
    # A hackathon range is required, so a CV with no birth year is not a match.
    if birth_year is None:
        return not required
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
        if not _location_matches(cv["location"], criteria.get("location")):
            continue
        if not _seniority_matches(cv["seniority"], criteria.get("seniority")):
            continue
        year_required = criteria.get("event_type") == "hackathon"
        if not _years_match(cv["birth_year"], criteria, required=year_required):
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


def find_people(event_text: str, cv_paths: list, out_path: str, api_url: str = API_URL) -> tuple:
    """Return (criteria, CSV rows) and write the matched people to out_path."""
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

        criteria, rows = find_people(event_text, args.cvs, args.out, args.api_url)
        print("Criteria extracted from the event description:")
        print(json.dumps(criteria, indent=2, ensure_ascii=False))
        print(f"\nWrote {len(rows)} people to '{args.out}'.")
        return 0
    except Exception as err:
        print("Error:", err)
        return 1


if __name__ == "__main__":
    sys.exit(main())
