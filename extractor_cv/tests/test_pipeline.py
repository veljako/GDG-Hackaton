import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pipeline
from embeddings import EmbeddingServiceError
from contracts import RevisionConflict


class PipelineTests(unittest.TestCase):
    def test_cloud_sync_requires_explicit_account_and_attachment(self):
        with self.assertRaises(TypeError):
            pipeline.add_user_to_firebase({"candidate_id": "dataset-test"})

    def test_cloud_sync_passes_revision_and_review_fields(self):
        cv = {"candidate_id": "uid"}
        with patch("firebase_store.upsert_user", return_value="uid") as write:
            self.assertEqual(pipeline.add_user_to_firebase(cv, user_id="uid",
                expected_storage_path="cvs/uid/revision.pdf", confirmed_fields=["skills"]), "uid")
        write.assert_called_once_with(cv, user_id="uid", expected_storage_path="cvs/uid/revision.pdf", confirmed_fields=["skills"])

    def test_processing_preserves_explicit_identity_and_source_token(self):
        store = Mock()
        store.upsert_candidate.return_value = "uid"
        cv = {"candidate_id": "uid"}
        with patch("pipeline.extract_cv_info", return_value=cv) as extract:
            self.assertEqual(pipeline.process_cv("synthetic.pdf", store, candidate_id="uid", expected_source_hash="old"), "uid")
        extract.assert_called_once_with("synthetic.pdf", candidate_id="uid")
        store.upsert_candidate.assert_called_once_with(cv, expected_source_hash="old")

    def test_one_record_failure_does_not_abort_batch_or_leak_error_content(self):
        store = Mock()
        store.upsert_candidates.side_effect = RuntimeError("PRIVATE INPUT SERVER RESPONSE")
        def write(cv, **kwargs):
            if cv["candidate_id"] == "bad":
                raise RuntimeError("PRIVATE INPUT SERVER RESPONSE")
            return cv["candidate_id"]
        store.upsert_candidate.side_effect = write
        records = [("broken", None, "PRIVATE PARSER RESPONSE"),
                   ("bad", {"candidate_id": "bad"}, None), ("good", {"candidate_id": "good"}, None)]
        results = list(pipeline.ingest_records(iter(records), store))
        self.assertEqual([item.status for item in results], ["failed", "failed", "indexed"])
        self.assertNotIn("PRIVATE", repr(results))

    def test_cloud_failure_does_not_create_vector_and_other_records_continue(self):
        store = Mock()
        store.upsert_candidates.return_value = ["good"]
        records = [("bad", {"candidate_id": "bad"}, None), ("good", {"candidate_id": "good"}, None)]
        bindings = {"bad": {"user_id": "bad", "expected_storage_path": "revision"},
                    "good": {"user_id": "good", "expected_storage_path": "revision"}}
        with patch("pipeline.add_user_to_firebase", side_effect=[RuntimeError("PRIVATE"), "good"]):
            results = list(pipeline.ingest_records(iter(records), store, firebase_bindings=bindings))
        self.assertEqual([item.status for item in results], ["failed", "indexed"])
        self.assertEqual([cv["candidate_id"] for cv in store.upsert_candidates.call_args.args[0]], ["good"])

    def test_zero_results_skips_embedding(self):
        store = Mock()
        self.assertEqual(pipeline.find_best_matches({"name": "Event"}, top_n=0, store=store), [])
        store.embeddings.embed_query.assert_not_called()

    def test_shared_embedding_outage_does_not_fan_out_into_per_record_calls(self):
        store = Mock()
        store.upsert_candidates.side_effect = EmbeddingServiceError("Unavailable")
        records = [("one", {"candidate_id": "one"}, None), ("two", {"candidate_id": "two"}, None)]
        results = list(pipeline.ingest_records(records, store))
        self.assertEqual([item.status for item in results], ["failed", "failed"])
        store.upsert_candidate.assert_not_called()

    def test_default_backend_startup_failure_returns_statuses_for_each_record(self):
        records = [("one", {"candidate_id": "one"}, None), ("two", {"candidate_id": "two"}, None)]
        with patch("pipeline.get_store", side_effect=RuntimeError("PRIVATE STARTUP DETAIL")):
            results = list(pipeline.ingest_records(records))
        self.assertEqual([item.status for item in results], ["failed", "failed"])
        self.assertNotIn("PRIVATE", repr(results))

    def test_stale_batch_is_not_retried_with_fresh_versions(self):
        store = Mock()
        store.upsert_candidates.side_effect = RevisionConflict("Removed during embedding")
        records = [("one", {"candidate_id": "one"}, None)]
        results = list(pipeline.ingest_records(records, store))
        self.assertEqual(results[0].status, "failed")
        store.upsert_candidate.assert_not_called()

    def test_service_outage_circuits_remaining_batches_in_same_run(self):
        store = Mock()
        store.upsert_candidates.side_effect = EmbeddingServiceError("Unavailable")
        records = [("one", {"candidate_id": "one"}, None), ("two", {"candidate_id": "two"}, None)]
        results = list(pipeline.ingest_records(records, store, batch_size=1))
        self.assertEqual([item.status for item in results], ["failed", "failed"])
        self.assertEqual(store.upsert_candidates.call_count, 1)


if __name__ == "__main__":
    unittest.main()
