"""Compatibility adapter regressions with synthetic local Chroma data only."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import date

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["ANONYMIZED_TELEMETRY"] = "False"

from candidate_matcher import CandidateMatcher, CandidateProfile, CandidateVectorStore, EventProfile, HardConstraintFilter, NarrativeBuilder
from embeddings import LocalHashingEmbeddings
from search_engine import build_hard_filter
from vector_store import MatchmakingStore, candidate_narrative, event_narrative


def canonical_cv(identity="account-a", **values):
    return {"candidate_id": identity, "skills": ["Python"], "experience_level": "mid",
        "general_description": "Python systems", "location": "Belgrade",
        "birth_year": date.today().year - 25, "education": [], "source": "C:/private/cv.pdf",
        "cv_text": "PRIVATE RAW CONTENT", "cv_filename": "secret.pdf", **values}


def serbian_cv(identity="account-a", **values):
    return {"id_kandidata": identity, "skillovi": ["Python"], "senioritet": "Medior",
        "detaljan_opis": "Python systems", "lokacija": "Београд", "godine": 25,
        "jezik": [], "prosli_hackathoni": [], "zaposlen": None, **values}


def canonical_event(**values):
    return {"event_type": "meetup", "short_description": "Python systems", "skills": ["Python"],
        "seniority": "mid", "location": "Beograd", "remote": False,
        "min_birth_year": date.today().year - 20, "max_birth_year": date.today().year - 30, **values}


def serbian_event(**values):
    return {"tip_eventa": "meetup", "kratak_opis": "Python systems", "potrebni_skillovi": ["Python"],
        "senioritet": "Medior", "lokacija": "Београд", "is_remote": False,
        "min_godine": 20, "max_godine": 30, **values}


class ProfileAdapterTests(unittest.TestCase):
    def test_canonical_extractor_dictionary_is_accepted(self):
        candidate = CandidateProfile.from_dict(canonical_cv())
        self.assertEqual(candidate.id_kandidata, "account-a")
        self.assertEqual(candidate.godine, 25)
        self.assertEqual(candidate.skillovi, ["Python"])
        event = EventProfile.from_dict(canonical_event(remote=True))
        self.assertTrue(event.is_remote)
        self.assertEqual(event.min_godine, 20)
        self.assertEqual(event.max_godine, 30)

    def test_narratives_delegate_to_canonical_functions(self):
        cv = canonical_cv()
        event = canonical_event()
        self.assertEqual(NarrativeBuilder.cv_narrative(CandidateProfile.from_dict(cv)), candidate_narrative(cv))
        self.assertEqual(NarrativeBuilder.event_narrative(EventProfile.from_dict(event)), event_narrative(event))
        self.assertEqual(NarrativeBuilder.cv_narrative(CandidateProfile.from_dict(serbian_cv())), candidate_narrative(cv))
        self.assertEqual(NarrativeBuilder.event_narrative(EventProfile.from_dict(serbian_event())), event_narrative(event))

    def test_serbian_hard_filters_use_canonical_keys_aliases_and_open_age_bounds(self):
        for legacy, canonical in (
            (serbian_event(), canonical_event()),
            (serbian_event(max_godine=None), canonical_event(max_birth_year=None)),
            (serbian_event(min_godine=None), canonical_event(min_birth_year=None)),
        ):
            with self.subTest(legacy=legacy):
                self.assertEqual(HardConstraintFilter.build(EventProfile.from_dict(legacy)), build_hard_filter(canonical))

    def test_remote_values_must_be_actual_booleans(self):
        for key in ("remote", "is_remote"):
            for value in ("false", "true", 1, 0, None):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    EventProfile.from_dict({key: value})

    def test_ids_are_rejected_instead_of_coerced_or_sanitized(self):
        for value in ("slash/id", "", 42, "a" * 129):
            with self.subTest(value=value), self.assertRaises(ValueError):
                CandidateProfile.from_dict(serbian_cv(value))

    def test_invalid_ages_and_birth_years_fail_closed(self):
        for value in (True, -1, "25", 500):
            with self.subTest(age=value), self.assertRaises(ValueError):
                CandidateProfile.from_dict(serbian_cv(godine=value))
            with self.subTest(age=value), self.assertRaises(ValueError):
                EventProfile.from_dict(serbian_event(min_godine=value))
        for value in (True, 1800, date.today().year + 1):
            with self.subTest(year=value), self.assertRaises(ValueError):
                CandidateProfile.from_dict(canonical_cv(birth_year=value))


class StoreAdapterTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".runtime" / "cv-test-data"
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.adapter = CandidateVectorStore(LocalHashingEmbeddings(), collection_name="adapter-test", persist_directory=self.temp.name)
        self.matcher = CandidateMatcher(self.adapter)

    def tearDown(self):
        # Native Chroma keeps handles on Windows; synthetic fixtures stay ignored.
        self.temp._finalizer.detach()

    def test_vector_adapter_uses_canonical_store_and_stable_namespace_contract(self):
        self.assertIsInstance(self.adapter.store, MatchmakingStore)
        self.assertTrue((Path(self.temp.name) / "adapter-test.index.json").is_file())
        with self.assertRaises(ValueError):
            CandidateVectorStore(LocalHashingEmbeddings(size=512), collection_name="adapter-test", persist_directory=self.temp.name)

    def test_canonical_and_serbian_events_return_equivalent_matches(self):
        self.assertEqual(self.matcher.add_cvs([canonical_cv()]), ["account-a"])
        english = self.matcher.find_best_candidates(canonical_event())
        serbian = self.matcher.find_best_candidates(serbian_event())
        self.assertEqual([(m.id_kandidata, m.similarity) for m in english], [(m.id_kandidata, m.similarity) for m in serbian])
        self.assertEqual(english[0].id_kandidata, "account-a")

    def test_missing_explicit_constraint_data_is_excluded(self):
        self.matcher.add_cvs([
            canonical_cv("eligible"), canonical_cv("unknown-age", birth_year=None),
            canonical_cv("unknown-city", location=None), canonical_cv("unknown-level", experience_level=None),
        ])
        self.assertEqual([match.id_kandidata for match in self.matcher.find_best_candidates(canonical_event(), top_k=10)], ["eligible"])

    def test_changed_candidate_cannot_be_blindly_replaced(self):
        original = CandidateProfile.from_dict(serbian_cv())
        changed = CandidateProfile.from_dict(serbian_cv(skillovi=["Medicine"]))
        self.adapter.add_candidates([original])
        with self.assertRaises(ValueError):
            self.adapter.add_candidates([changed])
        token = self.adapter.store.candidate_source_hash("account-a")
        self.adapter.add_candidates([changed], expected_source_hashes={"account-a": token})
        self.assertEqual(self.adapter.store.get_candidate("account-a")["skills"], ["Medicine"])
        with self.assertRaises(ValueError):
            self.adapter.add_candidates([original], expected_source_hashes={"account-a": token})

    def test_unchanged_candidate_uses_canonical_cache(self):
        records = [canonical_cv()]
        self.matcher.add_cvs(records)
        from unittest.mock import patch
        with patch.object(self.adapter.embeddings, "embed_documents", side_effect=AssertionError("Must reuse canonical cache")):
            self.matcher.add_cvs(records)

    def test_payload_and_match_metadata_have_no_raw_cv_provenance(self):
        self.matcher.add_cvs([canonical_cv()])
        matches = self.matcher.find_best_candidates(canonical_event())
        stored = self.adapter.store.get_candidate("account-a")
        self.assertTrue({"cv_text", "source", "cv_filename"}.isdisjoint(stored))
        serialized = json.dumps(matches[0].metadata)
        self.assertNotIn("PRIVATE RAW CONTENT", serialized)
        self.assertNotIn("C:/private", serialized)
        self.assertNotIn("secret.pdf", serialized)

    def test_compatibility_vector_search_reuses_canonical_rankings(self):
        self.adapter.add_candidates([CandidateProfile.from_dict(serbian_cv())])
        vector = self.adapter.embeddings.embed_query("Python systems")
        where = build_hard_filter(canonical_event())
        expected = self.adapter.store.query_candidates(vector, 5, where=where)
        actual = self.adapter.search_by_vector(vector, 5, where)
        self.assertEqual([(match.id_kandidata, match.similarity) for match in actual], expected)
        self.assertTrue(actual[0].narrative)


if __name__ == "__main__":
    unittest.main()
