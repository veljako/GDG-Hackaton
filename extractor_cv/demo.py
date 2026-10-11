"""
End-to-end matchmaking demo.

  1. Load CVs from two sources (default: tr_cv and cv-andra). JSON files are already
     extracted; PDFs go through Gemma extraction. Each CV then passes the
     human-in-the-loop step and is added to the vector DB.
  2. Extract a mock hackathon description with Gemma and add the event to the DB.
  3. Rank candidates for that event with hybrid search and compare the two sources.

Run from extractor_cv with the venv active:
    python demo.py                    # one PDF per source, all JSON profiles
    python demo.py --all-pdfs         # every PDF (about 30-60 s of Gemma time each)
    python demo.py --in-memory        # do not persist to chroma_db/
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import pipeline  # noqa: E402
from embeddings import embedding_model_id  # noqa: E402
from extractors import iter_cv_records  # noqa: E402
from vector_store import city_key, event_narrative  # noqa: E402

DEFAULT_SOURCES = ["tr_cv", "cv-andra"]

MOCK_EVENT_TEXT = """
NeuralNights 2026 is a 48-hour in-person AI and data science hackathon at the Science and
Technology Park in Belgrade, Serbia, on 14-16 November 2026. Teams of up to four will build
LLM-powered assistants and predictive models on real fintech and healthcare datasets.
We are looking for students and junior engineers who are comfortable with Python, machine
learning, Pandas and SQL, and who have tried LLM tooling such as LangChain or RAG pipelines.
Mentors from local startups will be on site, and travel and accommodation are covered for
participants coming from other cities.
"""


def _row(rank: int, similarity: float, candidate_id: str, source: str, store) -> str:
    cv = store.get_candidate(candidate_id) or {}
    skills = ", ".join((cv.get("skills") or [])[:4])
    return (
        f"  {rank:>2}. {similarity:6.3f}  [{source}] {candidate_id}\n"
        f"      level={cv.get('experience_level') or '-'}  city={city_key(cv.get('location'))}"
        f"  birth_year={cv.get('birth_year') or '-'}  skills={skills or '-'}"
    )


def ingest_sources(sources: List[str], max_pdfs: Optional[int], sync_firebase: bool = False) -> Dict[str, str]:
    """Index dataset proposals with isolated, sanitized record failures."""
    if sync_firebase:
        raise ValueError("Dataset imports require explicit account and attachment bindings for Firebase.")
    origin: Dict[str, str] = {}
    for source in sources:
        label = Path(source).name
        print(f"\n[{label}]")
        records = iter_cv_records(str(HERE / source), max_raw_files=max_pdfs)
        for result in pipeline.ingest_records(records):
            candidate_id = result.candidate_id
            if result.status != "indexed":
                print(f"  skip {candidate_id}: {result.error}")
                continue
            origin[candidate_id] = label
            print(f"  indexed {candidate_id}")
    return origin


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="End-to-end CV-to-event matchmaking demo.")
    parser.add_argument("--sources", nargs="+", default=DEFAULT_SOURCES, help="CV folders or files, relative to extractor_cv.")
    parser.add_argument("--max-pdfs-per-source", type=int, default=1, help="PDF/image CVs to extract per source. Default: 1")
    parser.add_argument("--all-pdfs", action="store_true", help="Extract every PDF/image CV.")
    parser.add_argument("--top-n", type=int, default=5)
    parser.add_argument("--in-memory", action="store_true", help="Do not persist the vector DB.")
    parser.add_argument("--firebase", action="store_true", help="Deprecated; dataset imports cannot address authenticated accounts.")
    parser.add_argument("--backend", choices=["gemma", "openai", "local"], help="Explicit embedding backend; defaults to configured Gemma.")
    parser.add_argument("--event-file", help="Text file with the event description instead of the mock text.")
    args = parser.parse_args(argv)
    if args.firebase:
        parser.error("Dataset demo cannot write authenticated accounts. Use add_user_to_firebase with an explicit UID and attachment revision.")
    if not 0 <= args.top_n <= 1000 or args.max_pdfs_per_source < 0:
        parser.error("top-n must be 0-1000 and max-pdfs-per-source must be nonnegative.")

    store = pipeline.configure_store(None if args.in_memory else str(pipeline.DEFAULT_PERSIST_DIR), backend=args.backend)
    print(f"Embeddings: {embedding_model_id(store.embeddings)}")
    print(f"Vector DB:  {'in memory' if args.in_memory else pipeline.DEFAULT_PERSIST_DIR}")

    # ---- Step 1: CVs -------------------------------------------------------
    print("\n=== Step 1: CV extraction proposals -> private index ===")
    started = time.time()
    origin = ingest_sources(args.sources, None if args.all_pdfs else args.max_pdfs_per_source, args.firebase)
    print(f"\n{len(origin)} candidates added in {time.time() - started:.0f}s.")
    if not origin:
        print("Error: no CV was added.")
        return 1

    # ---- Step 2: event -----------------------------------------------------
    print("\n=== Step 2: event extraction -> DB ===")
    event_text = Path(args.event_file).read_text(encoding="utf-8") if args.event_file else MOCK_EVENT_TEXT
    event = pipeline.extract_event_info(event_text)
    event_id = pipeline.add_event_to_db(event)
    print(json.dumps(event, indent=2, ensure_ascii=False))
    print(f"\nevent_id: {event_id}")
    print(f"Ideal-candidate narrative: {event_narrative(event)}")

    # ---- Step 3: matching --------------------------------------------------
    print("\n=== Step 3: hybrid matching ===")
    where = pipeline.build_hard_filter(event)
    print("Hard filter:", json.dumps(where, ensure_ascii=False))
    print(f"Candidates indexed in this run: {len(origin)}")

    run_filter = {"candidate_id": {"$in": list(origin)}}
    where = {"$and": [where, run_filter]} if where else run_filter
    vector = store.get_event(event_id)[1]
    hybrid = [pipeline.MatchResult(identity, score) for identity, score in store.query_candidates(vector, args.top_n, where)]
    print(f"\nTop {args.top_n} after filter + cosine similarity:")
    for rank, match in enumerate(hybrid[: args.top_n], start=1):
        print(_row(rank, match.similarity, match.candidate_id, origin[match.candidate_id], store))
    if not hybrid:
        print("  (no candidate passed the hard filter)")

    unfiltered = [pipeline.MatchResult(identity, score)
                  for identity, score in store.query_candidates(vector, args.top_n, run_filter)]
    print(f"\nFor comparison, top {args.top_n} by cosine similarity only (no hard filter):")
    for rank, match in enumerate(unfiltered[: args.top_n], start=1):
        print(_row(rank, match.similarity, match.candidate_id, origin[match.candidate_id], store))

    print("\n=== Which source matches better ===")
    for label in dict.fromkeys(origin.values()):
        best = next((m for m in hybrid if origin[m.candidate_id] == label), None)
        if best:
            print(f"  {label}: best is {best.candidate_id} with similarity {best.similarity:.3f}")
        else:
            nearest = next((m for m in unfiltered if origin[m.candidate_id] == label), None)
            extra = f"; nearest by similarity alone: {nearest.candidate_id} ({nearest.similarity:.3f})" if nearest else ""
            print(f"  {label}: no candidate in the top {args.top_n} filtered matches{extra}")
    if hybrid:
        winner = hybrid[0]
        print(f"\nBest match overall: {winner.candidate_id} from {origin[winner.candidate_id]}.")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
