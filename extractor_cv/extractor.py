
import os
import re
import json
import requests
from urllib.parse import urlsplit
from PIL import Image
from pypdf import PdfReader
import pytesseract
from jsonschema import Draft202012Validator

# Vaš ngrok endpoint
API_URL = "https://oblivion-disburse-easeful.ngrok-free.dev/generate"

# Ime modela na serveru. Ako je prazno, uzima se prvi model koji server prijavi.
MODEL_NAME = os.environ.get("GEMMA_MODEL", "")

# Zaglavlje koje preskače ngrok-ov upozoravajući HTML na besplatnom planu
HEADERS = {"ngrok-skip-browser-warning": "1"}

# JSON šema koju server nameće modelu (constrained decoding).
# Ista šema se koristi i za validaciju odgovora na klijentu.
CV_SCHEMA = {
    "type": "object",
    "properties": {
        "skillovi": {"type": "array", "items": {"type": "string"}},
        "generalni_opis": {"type": "string"},
        "lokacija": {"type": ["string", "null"]},
        "status": {"type": ["string", "null"]},
        "godiste": {"type": ["integer", "null"]},
        "nivo_iskustva": {"type": "string"},
    },
    "required": ["skillovi", "generalni_opis", "lokacija", "status", "godiste", "nivo_iskustva"],
    "additionalProperties": False,
}

_VALIDATOR = Draft202012Validator(CV_SCHEMA)


def extract_text_from_file(file_path: str) -> str:
    """Ekstrahuje sirovi tekst iz PDF ili slikovnog fajla (JPG, PNG)."""
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
        raise ValueError(f"Nepodržan format fajla: {ext}. Podržani su .pdf, .jpg, .jpeg, .png")

    return extracted_text.strip()


def build_prompt(cv_text: str) -> str:
    """Instrukcije modelu. Format odgovora nameće šema, prompt opisuje značenje polja."""
    return f"""
Ti si AI parser CV-jeva. Iz priloženog teksta CV-ja izvuci tražene informacije i vrati ih kao JSON objekat.

Značenje polja:
- "skillovi": niz stringova (npr. ["Python", "C++", "Docker"])
- "generalni_opis": kratak sažetak profila i projekata u 2-3 rečenice
- "lokacija": grad i država (string ili null ako ne postoji)
- "status": trenutni status (npr. "Student", "Zaposlen", "Freelancer", ili null)
- "godiste": godina rođenja kao ceo broj (ili null ako nije navedeno)
- "nivo_iskustva": procena nivoa (npr. "Student / Junior", "Mid", "Senior")

TEKST CV-JA:
---
{cv_text}
---
"""


def _base_url(api_url: str) -> str:
    """Iz 'https://host/generate' pravi 'https://host'."""
    parts = urlsplit(api_url)
    return f"{parts.scheme}://{parts.netloc}"


def _extract_json_object(text: str) -> dict:
    """Vadi prvi {...} blok iz teksta, tolerantno na markdown ograde i uvodne rečenice."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        raise json.JSONDecodeError("U odgovoru nema JSON objekta", text, 0)
    return json.loads(match.group(0))


def _validate(data: dict) -> list[str]:
    """Vraća listu grešaka u odnosu na CV_SCHEMA (prazna lista = validno)."""
    return [
        f"{'/'.join(str(p) for p in err.path) or '<root>'}: {err.message}"
        for err in _VALIDATOR.iter_errors(data)
    ]


# ----------------------------------------------------------------------------
# Backend 3: postojeći /generate wrapper (tekstualni odgovor + validacija + retry)
# ----------------------------------------------------------------------------
def _call_generate(api_url: str, prompt: str, max_retries: int = 1) -> dict:
    strict_prompt = prompt + (
        "\nVrati ISKLJUČIVO JSON objekat, bez markdown ograda i bez dodatnog teksta. "
        f"Objekat mora odgovarati ovoj šemi:\n{json.dumps(CV_SCHEMA, ensure_ascii=False)}\n"
    )
    current_prompt = strict_prompt
    last_error = None
    raw = ""

    for _ in range(max_retries + 1):
        r = requests.post(api_url, json={"prompt": current_prompt}, headers=HEADERS, timeout=120)
        if r.status_code != 200:
            raise RuntimeError(f"Greška na serveru: {r.status_code} {r.text[:300]}")

        raw = r.json().get("response", "")
        try:
            data = _extract_json_object(raw)
            problems = _validate(data)
            if not problems:
                return data
            last_error = "Odgovor ne odgovara šemi: " + "; ".join(problems)
        except json.JSONDecodeError as e:
            last_error = f"Odgovor nije validan JSON: {e.msg}"

        # Retry: modelu se vraća konkretna greška iz prethodnog pokušaja
        current_prompt = (
            strict_prompt
            + f"\nTvoj prethodni odgovor je odbijen. Razlog: {last_error}\n"
            + f"Prethodni odgovor:\n{raw}\n\nIspravi ga i vrati samo JSON objekat."
        )

    raise ValueError(f"{last_error} | raw_response: {raw[:500]}")


def parse_cv_with_gemma(cv_text: str, api_url: str) -> dict:
    """
    Šalje tekst CV-ja Gemma modelu i vraća JSON koji odgovara CV_SCHEMA.

    Redosled pokušaja:
      1. Ollama  (/api/chat, "format": schema)   -> server nameće šemu pri dekodiranju
      2. OpenAI-kompatibilan (/v1/chat/completions, response_format json_schema)
      3. Postojeći /generate wrapper + regex ekstrakcija + validacija + jedan retry
    """
    prompt = build_prompt(cv_text)
    base = _base_url(api_url)
    attempts = []

    for name, fn in (
        ("ollama", lambda: _call_ollama(base, prompt)),
        ("openai", lambda: _call_openai_compatible(base, prompt)),
        ("generate", lambda: _call_generate(api_url, prompt)),
    ):
        try:
            data = fn()
            problems = _validate(data)
            if problems:
                attempts.append(f"{name}: odgovor ne odgovara šemi ({'; '.join(problems)})")
                continue
            data["_backend"] = name
            return data
        except Exception as e:
            attempts.append(f"{name}: {type(e).__name__}: {str(e)[:200]}")

    return {"error": "Nijedan backend nije vratio validan rezultat", "attempts": attempts}


# ============================================================================
# PRIMER UPOTREBE
# ============================================================================
if __name__ == "__main__":
    # Putanja do vašeg PDF ili JPG fajla
    file_path = "slika.png" # ili "primer_cv.jpg"

    try:
        print(f"1. Izvlačim tekst iz fajla '{file_path}'...")
        cv_text = extract_text_from_file(file_path)

        if not cv_text:
            print("Upozorenje: Nije pronađen tekst u dokumentu.")
        else:
            print("2. Šaljem tekst na Gemma API...")
            parsed_data = parse_cv_with_gemma(cv_text, API_URL)

            print("\n--- Struktuirani Podaci iz CV-ja ---")
            print(json.dumps(parsed_data, indent=2, ensure_ascii=False))

    except Exception as err:
        print("Greška:", err)