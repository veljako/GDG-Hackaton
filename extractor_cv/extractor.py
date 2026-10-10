
import os
import re
import json
import requests
from urllib.parse import urlsplit
from PIL import Image
from pypdf import PdfReader
import pytesseract
from jsonschema import Draft202012Validator

# The Windows installer does not update PATH for terminals that were already open.
_TESSERACT_CANDIDATES = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)
for _tesseract_path in _TESSERACT_CANDIDATES:
    if os.path.isfile(_tesseract_path):
        pytesseract.pytesseract.tesseract_cmd = _tesseract_path
        break

# Your ngrok endpoint
API_URL = "https://oblivion-disburse-easeful.ngrok-free.dev/generate"

# Model name on the server. If empty, the first model the server reports is used.
MODEL_NAME = os.environ.get("GEMMA_MODEL", "")

# Header that skips the ngrok browser-warning HTML on the free plan
HEADERS = {"ngrok-skip-browser-warning": "1"}

# JSON schema the server enforces on the model (constrained decoding).
# The same schema is used to validate the response on the client.
CV_SCHEMA = {
    "type": "object",
    "properties": {
        "skills": {"type": "array", "items": {"type": "string"}},
        "general_description": {"type": "string"},
        "location": {"type": ["string", "null"]},
        "status": {"type": ["string", "null"]},
        "birth_year": {"type": ["integer", "null"]},
        "experience_level": {"type": "string"},
    },
    "required": ["skills", "general_description", "location", "status", "birth_year", "experience_level"],
    "additionalProperties": False,
}

_VALIDATOR = Draft202012Validator(CV_SCHEMA)


def extract_text_from_file(file_path: str) -> str:
    """Extract raw text from a PDF or an image file (JPG, PNG)."""
    ext = os.path.splitext(file_path)[1].lower()
    extracted_text = ""

    if ext == ".pdf":
        reader = PdfReader(file_path)
        for page in reader.pages:
            extracted_text += (page.extract_text() or "") + "\n"

    elif ext in [".jpg", ".jpeg", ".png"]:
        image = Image.open(file_path)
        extracted_text = pytesseract.image_to_string(image)

    else:
        raise ValueError(f"Unsupported file format: {ext}. Supported formats are .pdf, .jpg, .jpeg, .png")

    return extracted_text.strip()


def build_prompt(cv_text: str) -> str:
    """Instructions for the model. The schema enforces the response format; the prompt describes the fields."""
    return f"""
You are an AI CV parser. Extract the requested information from the CV text below and return it as a JSON object.

Field meanings:
- "skills": array of strings (e.g. ["Python", "C++", "Docker"])
- "general_description": a short summary of the profile and projects, in 2-3 sentences
- "location": city and country (string, or null if missing)
- "status": current status (e.g. "Student", "Employed", "Freelancer", or null)
- "birth_year": year of birth as an integer (or null if not stated)
- "experience_level": estimated level (e.g. "Student / Junior", "Mid", "Senior")

CV TEXT:
---
{cv_text}
---
"""


def _base_url(api_url: str) -> str:
    """Turn 'https://host/generate' into 'https://host'."""
    parts = urlsplit(api_url)
    return f"{parts.scheme}://{parts.netloc}"


def _extract_json_object(text: str) -> dict:
    """Pull the first {...} block out of the text, tolerating markdown fences and intro sentences."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        raise json.JSONDecodeError("The response contains no JSON object", text, 0)
    return json.loads(match.group(0))


def _validate(data: dict) -> list[str]:
    """Return schema errors against CV_SCHEMA (an empty list means the data is valid)."""
    return [
        f"{'/'.join(str(p) for p in err.path) or '<root>'}: {err.message}"
        for err in _VALIDATOR.iter_errors(data)
    ]


# ----------------------------------------------------------------------------
# Backend 3: existing /generate wrapper (text response + validation + retry)
# ----------------------------------------------------------------------------
def _call_generate(api_url: str, prompt: str, max_retries: int = 1) -> dict:
    strict_prompt = prompt + (
        "\nReturn ONLY a JSON object, with no markdown fences and no extra text. "
        f"The object must match this schema:\n{json.dumps(CV_SCHEMA, ensure_ascii=False)}\n"
    )
    current_prompt = strict_prompt
    last_error = None
    raw = ""

    for _ in range(max_retries + 1):
        r = requests.post(api_url, json={"prompt": current_prompt}, headers=HEADERS, timeout=120)
        if r.status_code != 200:
            raise RuntimeError(f"Server error: {r.status_code} {r.text[:300]}")

        raw = r.json().get("response", "")
        try:
            data = _extract_json_object(raw)
            problems = _validate(data)
            if not problems:
                return data
            last_error = "Response does not match the schema: " + "; ".join(problems)
        except json.JSONDecodeError as e:
            last_error = f"Response is not valid JSON: {e.msg}"

        # Retry: send the concrete error from the previous attempt back to the model
        current_prompt = (
            strict_prompt
            + f"\nYour previous response was rejected. Reason: {last_error}\n"
            + f"Previous response:\n{raw}\n\nFix it and return only the JSON object."
        )

    raise ValueError(f"{last_error} | raw_response: {raw[:500]}")


def parse_cv_with_gemma(cv_text: str, api_url: str) -> dict:
    """
    Send the CV text to the Gemma model and return JSON that matches CV_SCHEMA.

    Attempt order:
      1. Ollama (/api/chat, "format": schema) — the server enforces the schema while decoding
      2. OpenAI-compatible (/v1/chat/completions, response_format json_schema)
      3. Existing /generate wrapper + regex extraction + validation + one retry
    """
    prompt = build_prompt(cv_text)
    base = _base_url(api_url)
    attempts = []

    for name, fn in (
        ("generate", lambda: _call_generate(api_url, prompt)),
    ):
        try:
            data = fn()
            problems = _validate(data)
            if problems:
                attempts.append(f"{name}: response does not match the schema ({'; '.join(problems)})")
                continue
            data["_backend"] = name
            return data
        except Exception as e:
            attempts.append(f"{name}: {type(e).__name__}: {str(e)[:200]}")

    return {"error": "No backend returned a valid result", "attempts": attempts}



def process_and_save_confirmed_cv(confirmed_data: dict, user_id: str) -> dict:
    """
    Placeholder. Not implemented yet.

    Intended behavior: take the user-confirmed CV payload from the frontend,
    build a canonical string for semantic search from experience_level, skills,
    and general_description, generate an OpenAI text-embedding-3-small vector
    (1536 dimensions), and upsert the candidate profile into the Supabase
    pgvector table "resumes" (conflict key: user_id).

    Until that is implemented, this returns the confirmed JSON unchanged.
    user_id is part of the future signature and is unused for now.
    """
    return confirmed_data

# ============================================================================
# EXAMPLE USAGE
# ============================================================================
if __name__ == "__main__":
    # Path to your PDF or JPG file
    file_path = "tr_cv\Luka_Prlincevic_CV.pdf"  # or "sample_cv.jpg"

    try:
        print(f"1. Extracting text from '{file_path}'...")
        cv_text = extract_text_from_file(file_path)

        if not cv_text:
            print("Warning: no text was found in the document.")
        else:
            print("2. Sending the text to the Gemma API...")
            parsed_data = parse_cv_with_gemma(cv_text, API_URL)

            print("\n--- Structured CV data ---")
            print(json.dumps(parsed_data, indent=2, ensure_ascii=False))

    except Exception as err:
        print("Error:", err)