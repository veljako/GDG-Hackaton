"""Two events and seven fictional PDF CVs through real local Gemma inference.

No Firebase client, credentials or cloud storage. Expectations are fixed before
inference. Local Chroma replaces persistence; extraction, narratives, embedding
adapters, eligibility, candidate retrieval and worker recommendations are real.
"""
import argparse
import json
import math
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import requests

from evaluate_synthetic import write_cv_pdf
from extractor import extract_text_from_file
from extractors import extract_cv_info, extract_event_info
from event_candidate_finder import _normalize_open_audience, _normalize_explicit_audience_fields
from embeddings import OllamaGemmaEmbeddings
from vector_store import MatchmakingStore, candidate_narrative, event_narrative
from matching_eligibility import candidate_eligible
from search_engine import find_best_matches
from matching_worker import MatchingService, person_cv, event_dict
from recommendation_policy import POLICY


SPECS = [
    ("data", "Mira", "Data analyst", ["Python", "SQL", "Pandas"],
     "I clean datasets, analyze data and build machine learning prediction models. I want to learn more machine learning and Python data analysis.",
     ["Machine Learning", "Data Analysis"], ["Machine Learning"], ["Learning"], "ai"),
    ("statistics", "Ana", "Statistics student", ["Statistics", "Python"],
     "I study statistics, fit predictive models and analyze datasets. I want hands-on machine learning training with Python and Pandas.",
     ["Machine Learning", "Statistics"], ["Pandas", "Machine Learning"], ["Learning"], "ai"),
    ("learner", "Nina", "Business student", ["Excel"],
     "My current skill is Excel. I am a beginner interested in machine learning and data analysis. I want to learn Python and Pandas. I have no programming experience.",
     ["Machine Learning", "Data Analysis"], ["Python", "Pandas", "Machine Learning"], ["Learning"], "ai"),
    ("frontend", "Luka", "Frontend developer", ["React", "TypeScript", "CSS"],
     "I build React and TypeScript web application interfaces. I create accessible browser components, frontend dashboards and responsive CSS layouts. I want to build a web application in a team.",
     ["Web Development", "Accessibility"], [], ["Building"], "web"),
    ("fullstack", "Ivan", "Full stack developer", ["React", "TypeScript", "Node.js"],
     "I build interactive web applications with React and TypeScript, connecting interfaces to Node.js APIs. I want to ship a working browser application with a hackathon team.",
     ["Web Development", "Web Applications"], [], ["Building"], "web"),
    ("biology", "Sara", "Laboratory biologist", ["Biology", "Microscopy"],
     "I investigate living cells using laboratory microscopy. I study tissue samples and cell biology. My goal is scientific laboratory research, not software development.",
     ["Cell Biology", "Microscopy"], [], ["Research"], None),
    ("design", "Petar", "UX designer", ["Figma", "UX Research"],
     "I conduct UX research and create interface prototypes in Figma. I am interested in web application design and frontend development, but I do not have React skills.",
     ["Web Development", "User Experience"], ["React"], ["Building"], None),
]


class LocalWorkerStore(MatchmakingStore):
    """Ephemeral local storage with the production document/query encoding split."""
    def __init__(self, embeddings):
        super().__init__(embeddings, namespace="local-quality-test")
        import chromadb
        from chromadb.config import Settings
        client = chromadb.Client(Settings(anonymized_telemetry=False))
        self.documents = client.get_or_create_collection(
            self.events.name + "_documents", metadata={"hnsw:space": "cosine"}, embedding_function=None)

    def upsert_event(self, event, *, expected_source_hash=None):
        identity = event["event_id"]
        previous = self.event_source_hash(identity)
        result = super().upsert_event(event, expected_source_hash=expected_source_hash)
        if previous != self.event_source_hash(identity):
            payload, _ = self.get_event(identity)
            self.documents.upsert(ids=[identity],
                embeddings=self.embeddings.embed_documents([event_narrative(payload)]),
                metadatas=[{"source_hash": self.event_source_hash(identity)}])
        return result

    def query_events(self, vector, k, where=None):
        if not k or not self.documents.count():
            return []
        rows = self.documents.query(query_embeddings=[vector], n_results=min(k, self.documents.count()), include=["distances"])
        return [(identity, round(1 - float(distance), 4))
                for identity, distance in zip(rows["ids"][0], rows["distances"][0])]


def run(output, generation_timeout=45, reuse_extraction=None):
    output.mkdir(parents=True, exist_ok=True)
    previous = json.loads(reuse_extraction.read_text(encoding="utf-8")) if reuse_extraction else {}
    # Block cloud transport even if a dependency accidentally attempts it.
    original_request = requests.sessions.Session.request
    calls = []
    def local_request(session, method, url, *args, **kwargs):
        endpoint = urlsplit(url)
        if endpoint.hostname not in ("localhost", "127.0.0.1") or endpoint.port not in (8000, 11434):
            raise RuntimeError("Evaluation forbids non-model network access.")
        calls.append({"method": method, "port": endpoint.port, "path": endpoint.path})
        if endpoint.port == 8000 and endpoint.path == "/generate":
            kwargs["timeout"] = (5, generation_timeout)
        return original_request(session, method, url, *args, **kwargs)
    requests.sessions.Session.request = local_request
    from google.cloud import firestore
    def forbidden_client(*args, **kwargs):
        raise RuntimeError("Evaluation forbids Firebase clients.")
    firestore.Client = forbidden_client

    start = time.perf_counter()
    when = (date.today() + timedelta(days=30)).isoformat()
    event_sources = {
        "ai": f"""Event name: Applied Machine Learning Workshop. Event type: workshop.
Date: {when}. Online event, taught in English. Free: 0 EUR.
Topics: Machine Learning, Data Analysis. Skills taught: Python, Pandas, Machine Learning.
Participants learn to clean datasets, analyze data and build prediction models.
Goal: Learning. Role: Participant. Audience level: Beginner.
No prior programming skills are required. Open to all professional seniorities and statuses.
There are no age restrictions.""",
        "web": f"""Event name: Frontend Web Application Hackathon. Event type: hackathon.
Date: {when}. Online event, conducted in English. Free: 0 EUR.
Topics: Web Development, Web Applications. Skills practiced: React, TypeScript, CSS.
Teams build an accessible browser application with React and TypeScript and responsive interfaces.
Goal: Building. Role: Participant. Audience level: Intermediate.
Eligibility prerequisite: React is required. TypeScript and CSS are useful, not mandatory.
Open to all professional seniorities and statuses. There are no age restrictions.""",
    }
    expectations = {"events": event_sources, "profiles": [{"id": row[0], "skills": row[3], "expected_event": row[8]} for row in SPECS],
        "checks": ["AI top three are data/statistics/learner", "Web top two are frontend/fullstack",
                   "React prerequisite excludes all other profiles", "Learner can attend AI without Python",
                   "Biology is below all three AI positives", "Correct event ranks first for five positive profiles",
                   "Designer learning React does not satisfy acquired React prerequisite"]}
    (output / "expectations.json").write_text(json.dumps(expectations, indent=2), encoding="utf-8")
    embeddings = OllamaGemmaEmbeddings()
    store = LocalWorkerStore(embeddings)
    report = {"model": embeddings.model_id, "recipe": "matching-narrative-v3", "firebase_used": False,
              "recommendation_policy": POLICY,
              "generation_timeout_seconds": generation_timeout,
              "reused_actual_extraction_from": str(reuse_extraction) if reuse_extraction else None,
              "generation_model": None, "events": {}, "profiles": {}, "checks": [], "passed": False}
    health = requests.get("http://127.0.0.1:8000/health", timeout=10).json()
    report["generation_model"] = health.get("model")
    checks = report["checks"]
    def check(name, passed, actual=None):
        checks.append({"name": name, "passed": bool(passed), "actual": actual})
    def save():
        report["network_calls"] = calls
        report["seconds"] = round(time.perf_counter() - start, 2)
        (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    people, events = [], []
    for identity, source in event_sources.items():
        reused = identity in previous.get("events", {})
        print(f"{'Replaying recorded actual extraction for' if reused else 'Extracting with real Gemma:'} event {identity}...", flush=True)
        (output / f"event-{identity}.txt").write_text(source, encoding="utf-8")
        if identity in previous.get("events", {}):
            if (reuse_extraction.parent / f"event-{identity}.txt").read_text(encoding="utf-8") != source:
                raise ValueError("Cannot reuse extraction for changed event source.")
            extracted = previous["events"][identity]["extracted"]
            _normalize_open_audience(source, extracted)
            _normalize_explicit_audience_fields(source, extracted)
        else:
            extracted = extract_event_info(source)
        rules = {"requiredSkills": extracted.get("required_skills") or [], "seniorities": extracted.get("seniorities") or [],
                 "statuses": extracted.get("statuses") or [], "minAge": extracted.get("min_age"), "maxAge": extracted.get("max_age")}
        canonical = {"id": identity, "title": extracted.get("name"), "description": extracted.get("description") or source,
            "kind": extracted.get("event_type"), "topics": extracted.get("topics") or [],
            "audience": {"skills": extracted.get("skills") or [], "taughtSkills": extracted.get("taught_skills") or [],
                         "goals": extracted.get("goals") or [], "roles": extracted.get("roles") or [], "levels": extracted.get("levels") or []},
            "eligibility": rules, "format": {"online": "Online", "hybrid": "Hybrid", "in_person": "In person"}.get(extracted.get("format")),
            "date": extracted.get("date") or when, "endDate": when, "deadline": when,
            "status": "open", "capacity": 100, "published": True, "matchingVersion": 2,
            "location": extracted.get("location") or "", "country": extracted.get("country"),
            "languages": extracted.get("languages") or [], "price": extracted.get("price")}
        events.append(canonical)
        report["events"][identity] = {"extracted": extracted, "canonical": canonical, "narrative": event_narrative(event_dict(canonical))}
        check(f"{identity} required skills extracted correctly", rules["requiredSkills"] == ([] if identity == "ai" else ["React"]), rules)
        check(f"{identity} kind and online format preserved", canonical["kind"] == ("workshop" if identity == "ai" else "hackathon") and canonical["format"] == "Online")
        check(f"{identity} no invented hard age/seniority/status", not rules["seniorities"] and not rules["statuses"] and rules["minAge"] is None and rules["maxAge"] is None)
        check(f"{identity} stated audience level preserved", canonical["audience"]["levels"] == (["Beginner"] if identity == "ai" else ["Intermediate"]))
        check(f"{identity} stated English delivery preserved", "English" in canonical["languages"])
        save()
    for row in SPECS:
        identity, name, title, skills, description, interests, learning, goals, expected = row
        reused = identity in previous.get("profiles", {})
        print(f"Parsing PDF; {'replaying recorded actual extraction for' if reused else 'extracting with real Gemma:'} CV {identity}...", flush=True)
        path = output / f"cv-{identity}.pdf"
        write_cv_pdf(path, {"first_name": name, "last_name": "Fictional", "current_role": title,
            "skills": skills, "general_description": description, "language": "en", "location": "Belgrade",
            "status": "student" if identity in ("statistics", "learner") else "employed", "experience_level": "junior", "birth_year": 2000})
        if identity in previous.get("profiles", {}):
            extracted = previous["profiles"][identity]["extracted"]
            if extracted.get("cv_text") != extract_text_from_file(str(path)):
                raise ValueError("Cannot reuse extraction for changed CV text.")
        else:
            extracted = extract_cv_info(str(path), candidate_id=identity)
        # These are explicit fictional onboarding answers, not generated extraction.
        profile = {"id": identity, "name": name + " Fictional", "title": extracted.get("current_role"),
            "city": extracted.get("location"), "bio": extracted.get("general_description"), "skills": extracted.get("skills") or [],
            "experience_level": extracted.get("experience_level"), "status": extracted.get("status"), "birth_year": extracted.get("birth_year"),
            "interests": interests, "learningSkills": learning, "roles": ["Participant"],
            "preferences": {"goals": goals, "kinds": ["workshop"] if expected == "ai" else ["hackathon"], "formats": ["Online"], "level": "Beginner" if identity == "learner" else "Intermediate"}}
        people.append(profile)
        record = person_cv(profile)
        store.upsert_candidate(record)
        report["profiles"][identity] = {"expected_event": expected, "extracted": extracted, "onboarding_answers": {"interests": interests, "learningSkills": learning, "goals": goals}, "canonical": profile, "narrative": candidate_narrative(record)}
        actual_skills = {str(s).casefold() for s in profile["skills"]}
        check(f"{identity} acquired skills preserved without invention", actual_skills == {s.casefold() for s in skills}, profile["skills"])
        check(f"{identity} real PDF parsed", name in extract_text_from_file(str(path)))
        print(f"Extracted {identity}: {profile['skills']}", flush=True)
        save()
    context = {"people": people, "events": events, "teams": [], "applications": []}
    service = MatchingService(None, store, embeddings)
    print("Running real worker recommendations and event-to-candidate retrieval...", flush=True)
    for profile in people:
        result = service.call({"operation": "recommend_events", "actor_id": profile["id"], "context": context, "input": {"limit": 2}})
        report["profiles"][profile["id"]]["recommendations"] = result["results"]
        expected = report["profiles"][profile["id"]]["expected_event"]
        if expected:
            check(f"{profile['id']} correct event ranks first", bool(result["results"]) and result["results"][0]["eventId"] == expected, result["results"])
            check(f"{profile['id']} receives no weak secondary recommendation", len(result["results"]) == 1)
        else:
            check(f"{profile['id']} receives no unrelated automatic recommendation", not result["results"], result["results"])
            check(f"{profile['id']} explicit no-suitable-event outcome", result.get("outcome") == "no_suitable_event")
    for event in events:
        hits = find_best_matches(store, event["id"], top_n=7)
        ranks = [hit.candidate_id for hit in hits]
        raw_hits = find_best_matches(store, event["id"], top_n=7, apply_hard_filters=False)
        report["events"][event["id"]]["unfiltered_ranking"] = [{"id": hit.candidate_id, "similarity": hit.similarity} for hit in raw_hits]
        report["events"][event["id"]]["ranking"] = [{"id": hit.candidate_id, "similarity": hit.similarity} for hit in hits]
        if event["id"] == "ai":
            check("AI top three are intended matches", set(ranks[:3]) == {"data", "statistics", "learner"}, ranks)
            check("Beginner allowed without acquired Python", "learner" in ranks)
            check("Biology below every AI positive", all(ranks.index("biology") > ranks.index(wanted) for wanted in ("data", "statistics", "learner")), ranks)
        else:
            check("Web top two and eligibility are correct", set(ranks) == {"frontend", "fullstack"}, ranks)
            check("Web unfiltered semantic top two are intended matches", {hit.candidate_id for hit in raw_hits[:2]} == {"frontend", "fullstack"}, [hit.candidate_id for hit in raw_hits])
            check("Learning React does not satisfy required React", "design" not in ranks)
    vectors = {"candidate": store.candidates.get(include=["embeddings"]), "event_query": store.events.get(include=["embeddings"]), "event_document": store.documents.get(include=["embeddings"])}
    saved_vectors = {kind: {identity: list(map(float, vector)) for identity, vector in zip(rows["ids"], rows["embeddings"])} for kind, rows in vectors.items()}
    (output / "vectors.json").write_text(json.dumps(saved_vectors), encoding="utf-8")
    check("All 11 actual stored vectors are finite 768-dimensional vectors", sum(len(rows) for rows in saved_vectors.values()) == 11 and all(len(v) == 768 and all(math.isfinite(x) for x in v) for rows in saved_vectors.values() for v in rows.values()))
    # Full pair scores show unrelated but eligible workshop profiles remain low-ranked.
    for identity, row in report["profiles"].items():
        query = embeddings.embed_query(row["narrative"])
        row["pair_scores"] = {event_id: {"similarity": round(sum(x*y for x,y in zip(query, vector)), 4),
            "eligible": candidate_eligible(person_cv(row["canonical"]), event_dict(next(e for e in events if e["id"] == event_id)))} for event_id, vector in saved_vectors["event_document"].items()}
        if row["expected_event"]:
            check(f"{identity} unfiltered semantic event ranks correctly", max(row["pair_scores"], key=lambda event_id: row["pair_scores"][event_id]["similarity"]) == row["expected_event"], row["pair_scores"])
    report["passed"] = all(c["passed"] for c in checks)
    report["limitations"] = ["Seven fictional profiles and two events do not establish production quality.",
        "The 0.45 cosine floor is an initial operational policy, not broad production calibration or a probability.",
        "Interests, learning skills and preferences are explicit synthetic onboarding answers; CV extraction remains real.",
        "Local Chroma replaces cloud storage; Firestore revision guards, HTTP auth, queues and live database behavior are outside this run."]
    save()
    lines = ["# Actual local matching evaluation", "", f"Result: {'PASS' if report['passed'] else 'FAIL'}; {sum(c['passed'] for c in checks)}/{len(checks)} checks.",
        "", f"Extraction model: {report['generation_model']}. Embedding model: {report['model']}.", "Firebase: unused. Local ephemeral Chroma; real inference.",
        "", "| Fictional CV | Expected | AI score | Web score | Worker recommendations |", "|---|---|---:|---:|---|"]
    for identity, row in report["profiles"].items():
        scores = row["pair_scores"]
        web = str(scores["web"]["similarity"]) + (" (ineligible)" if not scores["web"]["eligible"] else "")
        lines.append(f"| {identity} | {row['expected_event'] or 'Neither'} | {scores['ai']['similarity']} | {web} | {', '.join(r['eventId'] for r in row['recommendations'])} |")
    lines += ["", "## Checks", ""] + [f"- {'PASS' if c['passed'] else 'FAIL'}: {c['name']}; actual: {c.get('actual')}" for c in checks]
    lines += ["", "## Limits", ""] + report["limitations"]
    (output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "checks": len(checks), "failed": [c for c in checks if not c["passed"]], "seconds": report["seconds"], "report": str(output / "report.md")}), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".runtime/local-matching-evaluation"))
    parser.add_argument("--generation-timeout", type=int, default=45,
                        help="Local test transport timeout; production extraction currently uses 45 seconds.")
    parser.add_argument("--reuse-extraction", type=Path,
                        help="Reuse recorded actual extraction only for unchanged text; embeddings and retrieval run fresh.")
    args = parser.parse_args()
    try:
        result = run(args.output, args.generation_timeout, args.reuse_extraction)
    except Exception as error:
        args.output.mkdir(parents=True, exist_ok=True)
        failure = {"passed": False, "exception": type(error).__name__, "message": str(error), "firebase_used": False,
                   "generation_timeout_seconds": args.generation_timeout}
        (args.output / "failure.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
        print(json.dumps(failure), flush=True)
        raise SystemExit(1)
    raise SystemExit(0 if result["passed"] else 1)
