
import os
import re
import json
import requests
import math
import time
from datetime import date
from io import BytesIO
from pathlib import Path
from PIL import Image
from pypdf import PdfReader, apply_configuration
from pypdf.generic import ContentStream, NameObject
import pytesseract
from jsonschema import Draft202012Validator
from http_utils import read_json_response

# The Windows installer does not update PATH for terminals that were already open.
_TESSERACT_CANDIDATES = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)
for _tesseract_path in _TESSERACT_CANDIDATES:
    if os.path.isfile(_tesseract_path):
        pytesseract.pytesseract.tesseract_cmd = _tesseract_path
        break

# A private local service is the default; a deployment chooses its own endpoint.
API_URL = os.environ.get("GEMMA_GENERATE_URL", "http://127.0.0.1:8000/generate")
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PDF_PAGES = 20
MAX_CV_CHARACTERS = 20_000
MAX_IMAGE_PIXELS = 16_000_000
MAX_IMAGE_DIMENSION = 4096
OCR_TIMEOUT_SECONDS = 20
HTTP_TIMEOUT = (5, 45)
MAX_HTTP_RETRIES = 2
MAX_MODEL_RESPONSE_CHARACTERS = 100_000
MAX_GENERATION_RESPONSE_BYTES = 1_048_576
MAX_PDF_STREAM_BYTES = 2 * 1024 * 1024
MAX_PDF_CONTENT_STREAM_BYTES = 128 * 1024
MAX_PDF_CONTENT_BYTES = 2 * 1024 * 1024
MAX_PDF_FORM_DEPTH = 20
MAX_PDF_FORMS = 100
_PDF_LIMITS = {
    "maximum_declared_stream_length": MAX_PDF_STREAM_BYTES,
    "array_based_stream_maximum_output_length": MAX_PDF_STREAM_BYTES,
    "zlib_maximum_output_length": MAX_PDF_STREAM_BYTES,
    "zlib_maximum_recovery_input_length": MAX_PDF_STREAM_BYTES,
    "lzw_maximum_output_length": MAX_PDF_STREAM_BYTES,
    "run_length_maximum_output_length": MAX_PDF_STREAM_BYTES,
    "jbig2_maximum_output_length": MAX_PDF_STREAM_BYTES,
    "brotli_maximum_output_length": MAX_PDF_STREAM_BYTES,
    "flate_maximum_row_length": MAX_PDF_STREAM_BYTES,
    "image_maximum_buffer_size": MAX_PDF_STREAM_BYTES,
    "stream_decoding_work_maximum_length": 8 * 1024 * 1024,
    "page_tree_maximum_entries": 100,
    "page_tree_maximum_depth": 20,
    "xform_maximum_invocations_per_extraction": 100,
    "disable_legacy_handling": True,
}

# Model name on the server. If empty, the first model the server reports is used.
MODEL_NAME = os.environ.get("GEMMA_MODEL", "")

# Header that skips the ngrok browser-warning HTML on the free plan
HEADERS = {"ngrok-skip-browser-warning": "1"}

# JSON schema the server enforces on the model (constrained decoding).
# The same schema is used to validate the response on the client.
CV_SCHEMA = {
    "type": "object",
    "properties": {
        "first_name": {"type": ["string", "null"]},
        "last_name": {"type": ["string", "null"]},
        "current_role": {"type": ["string", "null"]},
        "education": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "institution": {"type": "string"},
                    "kind": {"type": ["string", "null"], "enum": ["high school", "college", "university", None]},
                    "degree": {"type": ["string", "null"]},
                    "field": {"type": ["string", "null"]},
                },
                "required": ["institution", "kind", "degree", "field"],
                "additionalProperties": False,
            },
        },
        "skills": {"type": "array", "items": {"type": "string"}},
        "general_description": {"type": "string"},
        "location": {"type": ["string", "null"]},
        "status": {"type": ["string", "null"]},
        "birth_year": {"type": ["integer", "null"]},
        "experience_level": {"type": "string"},
    },
    "required": [
        "first_name",
        "last_name",
        "current_role",
        "education",
        "skills",
        "general_description",
        "location",
        "status",
        "birth_year",
        "experience_level",
    ],
    "additionalProperties": False,
}

_VALIDATOR = Draft202012Validator(CV_SCHEMA)


class ExtractionError(ValueError):
    """A safe extraction diagnostic, without source or generated content."""


def validate_cv_text(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        raise ExtractionError("CV text is empty.")
    if len(text) > MAX_CV_CHARACTERS:
        raise ExtractionError("CV text exceeds the 20000 character limit.")
    return text


def read_bounded_file(path: Path) -> bytes:
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ExtractionError("CV file size exceeds the 5 MB limit.")
    with path.open("rb") as handle:
        data = handle.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ExtractionError("CV file size exceeds the 5 MB limit.")
    return data


def _check_image(image: Image.Image) -> None:
    width, height = image.size
    if min(width, height) <= 0 or max(width, height) > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS:
        raise ExtractionError("CV image exceeds the dimension or pixel limit.")


def _ocr_image(image: Image.Image) -> str:
    _check_image(image)
    try:
        text = pytesseract.image_to_string(image, timeout=OCR_TIMEOUT_SECONDS)
    except Exception:
        raise ExtractionError("CV OCR failed or timed out.") from None
    if text.strip():
        validate_cv_text(text)
    return text.strip()


def _ocr_pdf_page(document, index: int) -> str:
    page = document[index]
    try:
        width, height = page.get_size()
        if not all(math.isfinite(value) and value > 0 for value in (width, height)):
            raise ExtractionError("Invalid PDF page dimensions.")
        # Leave space for the renderer's rounding to whole pixels.
        scale = min(2.0, MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height,
                    math.sqrt((MAX_IMAGE_PIXELS - 2 * MAX_IMAGE_DIMENSION) / (width * height)))
        bitmap = page.render(scale=scale)
        try:
            with bitmap.to_pil() as image:
                return _ocr_image(image)
        finally:
            bitmap.close()
    finally:
        page.close()


def _preflight_pdf_content(pages) -> None:
    """Bound decoded page/form data before text parsing or native page rendering."""
    total = 0
    visited = set()
    forms = {}
    form_heights = {}
    form_costs = {}
    invocation_names = {}
    page_contents = []

    def check_bytes(content):
        nonlocal total
        if len(content) > MAX_PDF_CONTENT_STREAM_BYTES:
            raise ExtractionError("PDF content stream exceeds the supported size.")
        total += len(content)
        if total > MAX_PDF_CONTENT_BYTES:
            raise ExtractionError("PDF decoded content exceeds the supported size.")

    def check_resources(resources, depth, active):
        if resources is None:
            return 0
        resources = resources.get_object()
        objects = resources.get("/XObject")
        if objects is None:
            return 0
        height = 0
        for reference in objects.get_object().values():
            form = reference.get_object()
            if form.get("/Subtype") != "/Form":
                continue
            key = id(form)
            if key in active:
                raise ExtractionError("PDF contains a cyclic form reference.")
            if depth > MAX_PDF_FORM_DEPTH:
                raise ExtractionError("PDF form nesting exceeds the supported depth.")
            if key in visited:
                form_height = form_heights[key]
            else:
                if len(visited) >= MAX_PDF_FORMS:
                    raise ExtractionError("PDF contains too many forms.")
                visited.add(key)
                data = form.get_data()
                check_bytes(data)
                forms[key] = (data, form.get("/Resources"))
                form_height = 1 + check_resources(forms[key][1], depth + 1, active | {key})
                form_heights[key] = form_height
            # A subtree checked on an earlier page can be reused at a deeper level.
            if depth + form_height - 1 > MAX_PDF_FORM_DEPTH:
                raise ExtractionError("PDF form nesting exceeds the supported depth.")
            height = max(height, form_height)
        return height

    for page in pages:
        content = page.get_contents()
        data = content.get_data() if content is not None else b""
        check_bytes(data)
        resources = page.get("/Resources")
        check_resources(resources, 1, set())
        page_contents.append((data, resources))

    def get_invocations(data):
        if data not in invocation_names:
            # All decoded stream and graph budgets have passed before token parsing.
            # The PDF parser handles comments, escaped names, strings and inline images.
            content = ContentStream(None, None)
            content.set_data(data)
            try:
                operations = content.operations
            except Exception:
                raise ExtractionError("PDF content operators could not be decoded.") from None
            names = []
            for operands, operator in operations:
                if operator != b"Do":
                    continue
                if len(operands) != 1 or not isinstance(operands[0], NameObject):
                    raise ExtractionError("PDF contains an invalid XObject invocation.")
                names.append(operands[0])
                if len(names) > MAX_PDF_FORMS:
                    raise ExtractionError("PDF contains too many XObject invocations.")
            invocation_names[data] = tuple(names)
        return invocation_names[data]

    def execution_cost(data, resources):
        size, invocations = len(data), 0
        names = get_invocations(data)
        if resources is None:
            return size, invocations
        objects = resources.get_object().get("/XObject")
        if objects is None:
            return size, invocations
        objects = objects.get_object()
        for name in names:
            reference = objects.get(name)
            if reference is None:
                continue
            form = reference.get_object()
            if form.get("/Subtype") != "/Form":
                continue
            key = id(form)
            if key not in form_costs:
                form_costs[key] = execution_cost(*forms[key])
            child_size, child_invocations = form_costs[key]
            size += child_size
            invocations += 1 + child_invocations
            if invocations > MAX_PDF_FORMS:
                raise ExtractionError("PDF contains too many form invocations.")
            if size > MAX_PDF_CONTENT_BYTES:
                raise ExtractionError("PDF parsed content exceeds the supported size.")
        return size, invocations

    parsed_bytes = 0
    for data, resources in page_contents:
        parsed_bytes += execution_cost(data, resources)[0]
        if parsed_bytes > MAX_PDF_CONTENT_BYTES:
            raise ExtractionError("PDF parsed content exceeds the supported size.")


def extract_text_from_file(file_path: str) -> str:
    """Extract bounded text, OCRing each PDF page that has no embedded text."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in {".pdf", ".jpg", ".jpeg", ".png"}:
        raise ExtractionError("Unsupported CV format; use PDF, JPG or PNG.")
    data = read_bounded_file(Path(file_path))
    try:
        with BytesIO(data) as stream:
            if ext != ".pdf":
                with Image.open(stream) as image:
                    return _ocr_image(image)
            with apply_configuration(**_PDF_LIMITS):
                reader = PdfReader(stream)
                if len(reader.pages) > MAX_PDF_PAGES:
                    raise ExtractionError("PDF exceeds the 20 page limit.")
                pages = list(reader.pages)
                _preflight_pdf_content(pages)
                parts = []
                document = None
                try:
                    for index, page in enumerate(pages):
                        text = (page.extract_text() or "").strip()
                        if not text:
                            if document is None:
                                import pypdfium2
                                document = pypdfium2.PdfDocument(data)
                            text = _ocr_pdf_page(document, index)
                        parts.append(text)
                        if sum(len(part) for part in parts) + len(parts) - 1 > MAX_CV_CHARACTERS:
                            raise ExtractionError("CV text exceeds the 20000 character limit.")
                    return "\n".join(parts).strip()
                finally:
                    if document is not None:
                        document.close()
    except ExtractionError:
        raise
    except Exception:
        raise ExtractionError("CV file decoding failed.") from None


def build_prompt(cv_text: str) -> str:
    """Instructions for the model. The schema enforces the response format; the prompt describes the fields."""
    validate_cv_text(cv_text)
    return f"""
You are an AI CV parser. Extract the requested information from the CV text below and return it as a JSON object.

Field meanings:
- "first_name": given name only, or null if the CV does not state one. Do not guess.
- "last_name": family name only, or null if it is missing. If the CV gives one full name, put the first word in first_name and the rest in last_name.
- "current_role": the person's current position or job title, such as "Student", "Software Engineer" or "Developer". Null if the CV does not state one. Do not guess, and do not put a seniority level here.
- "education": schools and universities the person attended. Each item has "institution" (the school name), "kind" ("high school", "college", "university", or null), "degree" (or null) and "field" of study (or null). Use an empty array if none are stated.
- "skills": array of explicitly stated skills (e.g. ["Python", "C++", "Docker"]). Read Serbian "Vestine" / "Veštine" / "Вештине" as Skills. Preserve every item in an explicit skills list, including scientific skills such as Biology and Microscopy. Standard English translations of Serbian skill names are allowed, but never add an unstated skill.
- "general_description": a short summary of the profile and projects, in 2-3 sentences
- "location": city and country (string, or null if missing). Serbian "Grad", "Град", and "Lokacija" mean city/location. They do not name a school. Copy the stated city spelling, such as Beograd, Novi Sad, or Niš.
- "status": current status (e.g. "Student", "Employed", "Freelancer", or null)
- "birth_year": year of birth as an integer (or null if not stated)
- "experience_level": explicitly stated level (e.g. "Junior", "Mid", "Senior"). Serbian "Nivo iskustva" means experience level. Return JSON null if not stated; never infer seniority from skills, projects, age or student status. Use JSON null, never the string "null", for every missing scalar. An absent education list must be [], never a school named "null".

CV TEXT:
---
{cv_text}
---
"""


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
    problems = ["CV response does not match the schema." for _ in _VALIDATOR.iter_errors(data)]
    year = data.get("birth_year") if isinstance(data, dict) else None
    if year is not None and (isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= date.today().year):
        problems.append("Birth year is outside the supported range.")
    return problems


# ----------------------------------------------------------------------------
# Backend 3: existing /generate wrapper (text response + validation + retry)
# ----------------------------------------------------------------------------
def _call_json_generate(api_url: str, prompt: str, schema: dict, max_retries: int = 1) -> dict:
    """Bound transport/schema retries and keep server-generated content out of errors."""
    retries = min(MAX_HTTP_RETRIES, max(0, int(max_retries)))
    validator = Draft202012Validator(schema)
    strict_prompt = prompt + (
        "\nReturn ONLY a JSON object, with no markdown fences and no extra text. "
        f"The object must match this schema:\n{json.dumps(schema, ensure_ascii=False)}\n"
    )
    current_prompt = strict_prompt
    last_error = "Generation returned an invalid response."
    for attempt in range(retries + 1):
        if attempt:
            time.sleep(min(0.1 * 2 ** (attempt - 1), 0.4))
        response = None
        try:
            response = requests.post(api_url, json={"prompt": current_prompt}, headers=HEADERS, timeout=HTTP_TIMEOUT, stream=True)
        except (requests.Timeout, requests.ConnectionError):
            last_error = "Generation service is unavailable or timed out."
            continue
        except requests.RequestException:
            raise ExtractionError("Generation request failed.") from None
        try:
            if response.status_code != 200:
                if response.status_code in {408, 429, 500, 502, 503, 504}:
                    last_error = "Generation service returned a transient HTTP error."
                    continue
                raise ExtractionError(f"Generation service returned HTTP {response.status_code}.")
            payload = read_json_response(response, max_bytes=MAX_GENERATION_RESPONSE_BYTES)
            raw = payload.get("response") if isinstance(payload, dict) else None
            if not isinstance(raw, str) or len(raw) > MAX_MODEL_RESPONSE_CHARACTERS:
                raise ValueError("Invalid response envelope")
            data = _extract_json_object(raw)
            if not isinstance(data, dict) or any(validator.iter_errors(data)):
                raise ValueError("Invalid response schema")
            if schema is CV_SCHEMA and _validate(data):
                raise ValueError("Invalid CV response")
            return data
        except ExtractionError:
            raise
        except (requests.Timeout, requests.ConnectionError):
            last_error = "Generation service is unavailable or timed out."
        except requests.RequestException:
            raise ExtractionError("Generation response could not be read.") from None
        except (ValueError, TypeError):
            last_error = "Generation response is not valid JSON matching the schema."
            current_prompt = strict_prompt + "\nThe previous response was invalid. Return JSON matching the schema."
        finally:
            response.close()
    raise ExtractionError(last_error) from None


def _call_generate(api_url: str, prompt: str, max_retries: int = 1) -> dict:
    return _call_json_generate(api_url, prompt, CV_SCHEMA, max_retries)


def parse_cv_with_gemma(cv_text: str, api_url: str = API_URL) -> dict:
    """Send bounded CV text to the configured /generate service and validate its JSON."""
    prompt = build_prompt(cv_text)
    try:
        data = _call_generate(api_url, prompt)
        if not _validate(data):
            from cv_grounding import ground_cv
            data = ground_cv(data, cv_text)
            data["_backend"] = "generate"
            return data
    except ExtractionError as error:
        return {"error": "No backend returned a valid result", "attempts": [str(error)]}
    return {"error": "No backend returned a valid result", "attempts": ["Invalid CV response."]}



def process_and_save_confirmed_cv(confirmed_data: dict, user_id: str) -> dict:
    """Deprecated placeholder; confirmed CV persistence belongs to the pipeline."""
    raise NotImplementedError(
        "This deprecated function does not persist CV data. Use "
        "pipeline.add_user_to_firebase with revision tokens and confirmed_fields."
    )

# ============================================================================
# EXAMPLE USAGE
# ============================================================================
if __name__ == "__main__":
    # Path to your PDF or JPG file
    file_path = "tr_cv/Luka_Prlincevic_CV.pdf"  # or "sample_cv.jpg"

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
