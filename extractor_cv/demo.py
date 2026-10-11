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


def ingest_sources(sources: List[str], max_pdfs: Optional[int]) -> Dict[str, str]:
    """Run every CV in the sources through extract -> HITL -> DB. Returns candidate_id -> source label."""
    origin: Dict[str, str] = {}
    for source in sources:
        label = Path(source).name
        print(f"\n[{label}]")
        for candidate_id, cv, error in iter_cv_records(str(HERE / source), max_raw_files=max_pdfs):
            if cv is None:
                print(f"  skip {candidate_id}: {error}")
                continue
            enriched = pipeline.human_in_the_loop_enrichment(cv)
            pipeline.add_user_to_db(enriched)
            origin[candidate_id] = label
            print(
                f"  added {candidate_id}  level={cv['experience_level'] or '-'}"
                f"  city={city_key(cv['location'])}  birth_year={cv['birth_year'] or '-'}"
                f"  skills={len(cv['skills'])}"
            )
    return origin


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="End-to-end CV-to-event matchmaking demo.")
    parser.add_argument("--sources", nargs="+", default=DEFAULT_SOURCES, help="CV folders or files, relative to extractor_cv.")
    parser.add_argument("--max-pdfs-per-source", type=int, default=1, help="PDF/image CVs to extract per source. Default: 1")
    parser.add_argument("--all-pdfs", action="store_true", help="Extract every PDF/image CV.")
    parser.add_argument("--top-n", type=int, default=5)
    parser.add_argument("--in-memory", action="store_true", help="Do not persist the vector DB.")
    parser.add_argument("--event-file", help="Text file with the event description instead of the mock text.")
    args = parser.parse_args(argv)

    store = pipeline.configure_store(None if args.in_memory else str(pipeline.DEFAULT_PERSIST_DIR))
    print(f"Embeddings: {embedding_model_id(store.embeddings)}")
    print(f"Vector DB:  {'in memory' if args.in_memory else pipeline.DEFAULT_PERSIST_DIR}")

    # ---- Step 1: CVs -------------------------------------------------------
    print("\n=== Step 1: CV extraction -> human in the loop -> DB ===")
    started = time.time()
    origin = ingest_sources(args.sources, None if args.all_pdfs else args.max_pdfs_per_source)
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
    passed = store.count_candidates(where)
    print("Hard filter:", json.dumps(where, ensure_ascii=False))
    print(f"Candidates passing the hard filter: {passed} of {store.count_candidates()}")

    in_run = set(origin)
    # Ask for every passing candidate, then keep the ones from this run (the DB may hold older runs).
    hybrid = [m for m in pipeline.find_best_matches(event_id, top_n=max(passed, 1)) if m.candidate_id in in_run]
    print(f"\nTop {args.top_n} after filter + cosine similarity:")
    for rank, match in enumerate(hybrid[: args.top_n], start=1):
        print(_row(rank, match.similarity, match.candidate_id, origin[match.candidate_id], store))
    if not hybrid:
        print("  (no candidate passed the hard filter)")

    unfiltered = [
        m for m in pipeline.find_best_matches(event_id, top_n=store.count_candidates(), apply_hard_filters=False)
        if m.candidate_id in in_run
    ]
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
            print(f"  {label}: no candidate passed the hard filter{extra}")
    if hybrid:
        winner = hybrid[0]
        print(f"\nBest match overall: {winner.candidate_id} from {origin[winner.candidate_id]}.")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
