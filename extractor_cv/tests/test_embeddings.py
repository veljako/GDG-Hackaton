import math
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from embeddings import GemmaServerEmbeddings, LocalHashingEmbeddings, build_embeddings

REVISION = "a" * 40


def response_for(payload):
    response = Mock(status_code=200, headers={})
    response.json.return_value = payload
    response.iter_content.return_value = [json.dumps(payload).encode("utf-8")]
    return response


class EmbeddingTests(unittest.TestCase):
    def test_cyrillic_profiles_are_distinguishable(self):
        model = LocalHashingEmbeddings()
        first = model.embed_query("лекар хирургија")
        second = model.embed_query("програмер базе података")
        self.assertNotEqual(first, second)
        self.assertLess(sum(a*b for a,b in zip(first, second)), .99)

    def test_empty_lexical_input_is_not_a_perfect_match(self):
        with self.assertRaises(ValueError):
            LocalHashingEmbeddings().embed_query("   ")

    def test_outage_does_not_silently_change_models(self):
        with patch.dict("os.environ", {"GEMMA_EMBED_REVISION": REVISION}, clear=True), \
                patch.object(GemmaServerEmbeddings, "is_available", return_value=False):
            with self.assertRaises(RuntimeError):
                build_embeddings()

    def test_explicit_local_backend_does_not_probe_network(self):
        with patch("embeddings.requests.post", side_effect=AssertionError("Network call")):
            self.assertIsInstance(build_embeddings(backend="local"), LocalHashingEmbeddings)

    def test_invalid_remote_vectors_and_contracts_are_rejected(self):
        valid = {"model": "google/embeddinggemma-300m", "revision": REVISION, "dimensions": 3,
                 "embeddings": [[1.0, 0.0, 0.0]]}
        variants = [dict(valid, embeddings=[[math.nan, 0, 0]]),
                    dict(valid, embeddings=[[0, 0, 0]]),
                    dict(valid, embeddings=[[1]]), dict(valid, dimensions=4),
                    dict(valid, model="changed-model"), dict(valid, revision="b" * 40)]
        for payload in variants:
            with self.subTest(payload=payload):
                response = response_for(payload)
                with patch("embeddings.requests.post", return_value=response):
                    model = GemmaServerEmbeddings(dimensions=3, revision=REVISION)
                    with self.assertRaises((RuntimeError, ValueError)):
                        model.embed_query("Python")

    def test_valid_remote_batch_uses_pinned_contract(self):
        response = response_for({"model": "google/embeddinggemma-300m", "revision": REVISION,
            "dimensions": 3, "embeddings": [[1, 0, 0], [0, 1, 0]]})
        with patch("embeddings.requests.post", return_value=response):
            result = GemmaServerEmbeddings(dimensions=3, revision=REVISION).embed_documents(["Python", "Medicine"])
        self.assertEqual(result, [[1, 0, 0], [0, 1, 0]])

    def test_client_splits_long_texts_within_route_total_budget(self):
        def post(*args, **kwargs):
            self.assertLessEqual(sum(map(len, kwargs["json"]["texts"])), 48000)
            return response_for({"model": "google/embeddinggemma-300m", "revision": REVISION,
                "dimensions": 3, "embeddings": [[1, 0, 0] for _ in kwargs["json"]["texts"]]})
        with patch("embeddings.requests.post", side_effect=post):
            self.assertEqual(len(GemmaServerEmbeddings(dimensions=3, revision=REVISION)
                                 .embed_documents(["x" * 12000] * 5)), 5)

    def test_remote_response_budget_is_enforced_before_json_decode(self):
        response = response_for({"model": "google/embeddinggemma-300m", "revision": REVISION,
            "dimensions": 3, "embeddings": [[1, 0, 0]]})
        response.headers = {"Content-Length": "999999999"}
        with patch("embeddings.requests.post", return_value=response), self.assertRaises(RuntimeError):
            GemmaServerEmbeddings(dimensions=3, revision=REVISION).embed_query("Python")
        response.json.assert_not_called()
        response.close.assert_called_once()

    def test_extreme_vectors_cannot_overflow_chroma_float_storage(self):
        from embeddings import validate_vector
        self.assertLessEqual(max(validate_vector([1e308, 0, 0], 3)), 1)

    def test_openai_service_failure_is_sanitized_shared_batch_error(self):
        from embeddings import EmbeddingServiceError, OpenAIModelEmbeddings
        provider = Mock()
        provider.embed_documents.side_effect = RuntimeError("PRIVATE PROVIDER RESPONSE")
        with patch("embeddings.OpenAIEmbeddings", return_value=provider):
            model = OpenAIModelEmbeddings()
        with self.assertRaises(EmbeddingServiceError) as error:
            model.embed_documents(["Python"])
        self.assertNotIn("PRIVATE", str(error.exception))


if __name__ == "__main__":
    unittest.main()
