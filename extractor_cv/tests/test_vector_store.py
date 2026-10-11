import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["ANONYMIZED_TELEMETRY"] = "False"
from embeddings import LocalHashingEmbeddings
from extractors import normalize_cv_dict
from search_engine import build_hard_filter
from vector_store import MatchmakingStore


def cv(identity="user-a", skills=None):
    return normalize_cv_dict({"current_role": "Engineer", "skills": skills or ["Python"],
        "location": "Београд", "birth_year": 2002, "experience_level": "Junior",
        "cv_text": "PRIVATE RAW TEXT", "first_name": "Private", "cv_filename": "secret.pdf"}, identity, "C:/private/source")


class VectorTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".runtime" / "cv-test-data"
        root.mkdir(exist_ok=True, parents=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.store = MatchmakingStore(LocalHashingEmbeddings(), persist_directory=self.temp.name)

    def tearDown(self):
        # Native Chroma retains handles; fixtures remain in ignored .runtime on Windows.
        self.temp._finalizer.detach()

    def test_vector_payload_does_not_store_raw_cv_or_source_paths(self):
        self.store.upsert_candidate(cv())
        saved = self.store.get_candidate("user-a")
        self.assertNotIn("cv_text", saved)
        self.assertNotIn("source", saved)
        self.assertNotIn("cv_filename", saved)

    def test_index_restart_rejects_model_switch(self):
        self.store.upsert_candidate(cv())
        with self.assertRaises(ValueError):
            MatchmakingStore(LocalHashingEmbeddings(size=512), persist_directory=self.temp.name)
        self.assertEqual(self.store.count_candidates(), 1)

    def test_same_source_is_cached_and_changed_source_requires_token(self):
        self.store.upsert_candidate(cv())
        with patch.object(self.store.embeddings, "embed_documents", side_effect=AssertionError("Unchanged source re-embedded")):
            self.store.upsert_candidate(cv())
        with self.assertRaises(ValueError):
            self.store.upsert_candidate(cv(skills=["Medicine"]))
        token = self.store.candidate_source_hash("user-a")
        self.store.upsert_candidate(cv(skills=["Medicine"]), expected_source_hash=token)
        self.assertEqual(self.store.get_candidate("user-a")["skills"], ["Medicine"])

    def test_embedding_failure_preserves_previous_candidate(self):
        self.store.upsert_candidate(cv())
        with patch.object(self.store.embeddings, "embed_documents", side_effect=RuntimeError("Unavailable")), \
                self.assertRaises(RuntimeError):
            self.store.upsert_candidate(cv(skills=["Medicine"]),
                expected_source_hash=self.store.candidate_source_hash("user-a"))
        self.assertEqual(self.store.get_candidate("user-a")["skills"], ["Python"])

    def test_delete_checks_source_version(self):
        self.store.upsert_candidate(cv())
        with self.assertRaises(ValueError):
            self.store.delete_candidate("user-a", expected_source_hash="stale")
        self.assertTrue(self.store.delete_candidate("user-a", expected_source_hash=self.store.candidate_source_hash("user-a")))
        self.assertIsNone(self.store.get_candidate("user-a"))

    def test_query_does_not_materialize_filtered_candidate_ids(self):
        self.store.upsert_candidate(cv())
        vector = self.store.embeddings.embed_query("Python engineer")
        with patch.object(self.store, "count_candidates", side_effect=AssertionError("Full filtered count")):
            result = self.store.query_candidates(vector, 5, where={"city": "belgrade"})
        self.assertEqual(result[0][0], "user-a")

    def test_explicit_eligibility_excludes_unknown_and_has_open_bounds(self):
        self.assertEqual(build_hard_filter({"min_birth_year": 2000}), {"birth_year": {"$lte": 2000}})
        self.assertEqual(build_hard_filter({"max_birth_year": 2000}), {"birth_year": {"$gte": 2000}})
        where = build_hard_filter({"location": "Beograd", "seniority": "Junior"})
        self.assertNotIn("unknown", json.dumps(where))
        self.store.upsert_candidate(cv())
        vector = self.store.embeddings.embed_query("Python")
        self.assertEqual(self.store.query_candidates(vector, 5, where)[0][0], "user-a")

    def test_batch_embeds_once_and_duplicate_ids_are_rejected_before_write(self):
        with patch.object(self.store.embeddings, "embed_documents", wraps=self.store.embeddings.embed_documents) as embed:
            self.store.upsert_candidates([cv("one"), cv("two")])
        embed.assert_called_once()
        self.assertEqual(len(embed.call_args.args[0]), 2)
        with self.assertRaises(ValueError):
            self.store.upsert_candidates([cv("three"), cv("three")])
        self.assertEqual(self.store.count_candidates(), 2)

    def test_concurrent_write_during_embedding_cannot_be_overwritten(self):
        self.store.upsert_candidate(cv())
        token = self.store.candidate_source_hash("user-a")
        original = self.store.embeddings.embed_documents
        def interrupted(texts):
            with patch.object(self.store.embeddings, "embed_documents", side_effect=original):
                self.store.upsert_candidate(cv(skills=["Concurrent edit"]), expected_source_hash=token)
            return original(texts)
        with patch.object(self.store.embeddings, "embed_documents", side_effect=interrupted), self.assertRaises(ValueError):
            self.store.upsert_candidate(cv(skills=["Stale edit"]), expected_source_hash=token)
        self.assertEqual(self.store.get_candidate("user-a")["skills"], ["Concurrent edit"])

    def test_unknown_eligibility_is_excluded_from_explicit_age_constraint(self):
        unknown = cv("unknown-user")
        unknown["birth_year"] = None
        self.store.upsert_candidates([cv(), unknown])
        matches = self.store.query_candidates(self.store.embeddings.embed_query("Python"), 5,
                                             build_hard_filter({"min_birth_year": 2005}))
        self.assertEqual([identity for identity, _ in matches], ["user-a"])

    def test_removal_cancels_inflight_first_embedding(self):
        original = self.store.embeddings.embed_documents
        def removed(texts):
            self.assertFalse(self.store.delete_candidate("user-a", expected_source_hash=None))
            return original(texts)
        with patch.object(self.store.embeddings, "embed_documents", side_effect=removed), self.assertRaises(ValueError):
            self.store.upsert_candidate(cv())
        self.assertIsNone(self.store.get_candidate("user-a"))

    def test_removal_generation_is_shared_by_restarted_store(self):
        second = MatchmakingStore(LocalHashingEmbeddings(), persist_directory=self.temp.name)
        original = self.store.embeddings.embed_documents
        def removed(texts):
            second.delete_candidate("user-a", expected_source_hash=None)
            return original(texts)
        with patch.object(self.store.embeddings, "embed_documents", side_effect=removed), self.assertRaises(ValueError):
            self.store.upsert_candidate(cv())
        self.assertIsNone(self.store.get_candidate("user-a"))

    def test_invalid_event_constraints_are_rejected_before_embedding_or_write(self):
        from search_engine import find_best_matches
        for event in ({"name": "Event", "remote": "false", "location": "Belgrade"},
                      {"name": "Event", "min_birth_year": True},
                      {"name": "Event", "max_birth_year": 2000.5}):
            with self.subTest(event=event), patch.object(self.store.embeddings, "embed_query", side_effect=AssertionError("Invalid event embedded")):
                with self.assertRaises(ValueError):
                    self.store.upsert_event(event)
                with self.assertRaises(ValueError):
                    find_best_matches(self.store, event)


if __name__ == "__main__":
    unittest.main()
