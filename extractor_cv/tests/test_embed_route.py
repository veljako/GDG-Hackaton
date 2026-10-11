import json
import math
import os
import sys
import threading
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gemma_embed_route as route


REVISION = "A" * 40


class Model:
    def __init__(self):
        self.calls = []
        self.error = None
        self.output = None
        self.started = None
        self.release = None

    def encode(self, texts, task, **kwargs):
        self.calls.append((list(texts), task, kwargs))
        if self.started is not None:
            self.started.set()
            if not self.release.wait(5):
                raise RuntimeError("Synthetic inference timed out")
        if self.error:
            raise self.error
        return self.output if self.output is not None else [[1.0] + [0.0] * 767 for _ in texts]

    def encode_query(self, texts, **kwargs):
        return self.encode(texts, "query", **kwargs)

    def encode_document(self, texts, **kwargs):
        return self.encode(texts, "document", **kwargs)


class EmbedRouteTests(unittest.TestCase):
    def setUp(self):
        cached = getattr(route, "_load_embedding_model", route.get_embedding_model)
        cached.cache_clear()
        self.addCleanup(cached.cache_clear)
        self.environment = patch.dict(os.environ, {"GEMMA_EMBED_REVISION": REVISION})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.model = Model()
        self.loads = []
        def factory(*args, **kwargs):
            self.loads.append((args, kwargs))
            return self.model
        self.factory = factory
        module = types.ModuleType("sentence_transformers")
        module.SentenceTransformer = factory
        self.shim = patch.dict(sys.modules, {"sentence_transformers": module})
        self.shim.start()
        self.addCleanup(self.shim.stop)
        app = FastAPI()
        app.include_router(route.router)
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def test_response_and_model_load_use_same_immutable_revision(self):
        response = self.client.post("/embed", json={"texts": ["Synthetic query"], "task": "query"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["model"], "google/embeddinggemma-300m")
        self.assertEqual(payload["revision"], REVISION.lower())
        self.assertEqual(payload["dimensions"], 768)
        self.assertEqual(self.loads[0][1]["revision"], REVISION.lower())
        self.assertEqual(self.loads[0][0], ("google/embeddinggemma-300m",))
        self.assertEqual(self.model.calls[0][1], "query")
        self.assertTrue(self.model.calls[0][2]["normalize_embeddings"])

    def test_missing_or_mutable_revision_is_rejected_before_loading(self):
        for revision in (None, "main", "abcd", "g" * 40):
            with self.subTest(revision=revision), patch.dict(os.environ, {}, clear=True):
                if revision is not None:
                    os.environ["GEMMA_EMBED_REVISION"] = revision
                response = self.client.post("/embed", json={"texts": ["Synthetic text"]})
                self.assertEqual(response.status_code, 503)
        self.assertEqual(self.loads, [])

    def test_request_limits_reject_before_loading(self):
        variants = [[], ["X"] * 65, ["X" * 12_001], [""], ["   "],
                    ["X" * 12_000] * 5, [42], [None]]
        for texts in variants:
            with self.subTest(length=len(texts)):
                response = self.client.post("/embed", json={"texts": texts})
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.loads, [])

    def test_exact_limits_are_accepted(self):
        for texts in (["X"] * 64, ["X" * 12_000] * 4):
            with self.subTest(count=len(texts)):
                response = self.client.post("/embed", json={"texts": texts})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(response.json()["embeddings"]), len(texts))

    def test_json_body_budget_rejects_before_loading_or_parsing(self):
        body = " " * 600_000 + json.dumps({"texts": ["Synthetic input"]})
        response = self.client.post("/embed", content=body, headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.loads, [])

    def test_invalid_request_response_does_not_echo_sensitive_text(self):
        response = self.client.post("/embed", json={"texts": ["SYNTHETIC PRIVATE TEXT" * 1000]})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("PRIVATE", response.text)

    def test_extra_or_invalid_task_fields_reject_before_loading(self):
        for payload in ({"texts": ["X"], "task": "invalid"},
                        {"texts": ["X"], "revision": "b" * 40}):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post("/embed", json=payload).status_code, 422)
        self.assertEqual(self.loads, [])

    def test_invalid_model_vectors_are_rejected_without_content(self):
        valid = [1.0] + [0.0] * 767
        variants = [[], [valid, valid], [[1.0]], [[0.0] * 768],
                    [[math.nan] + [0.0] * 767], [[math.inf] + [0.0] * 767],
                    [["SYNTHETIC PRIVATE OUTPUT"] + [0.0] * 767], [[True] + [0.0] * 767]]
        for output in variants:
            with self.subTest(shape=len(output)):
                self.model.output = output
                response = self.client.post("/embed", json={"texts": ["SYNTHETIC PRIVATE INPUT"]})
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("PRIVATE", response.text)

    def test_inference_failure_is_sanitized_and_releases_admission(self):
        self.model.error = RuntimeError("SYNTHETIC PRIVATE INPUT OR MODEL ERROR")
        response = self.client.post("/embed", json={"texts": ["SYNTHETIC PRIVATE INPUT"]})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("PRIVATE", response.text)
        self.model.error = None
        self.assertEqual(self.client.post("/embed", json={"texts": ["Synthetic retry"]}).status_code, 200)

    def test_load_failure_is_sanitized_and_does_not_poison_cache(self):
        module = sys.modules["sentence_transformers"]
        def failed(*args, **kwargs):
            raise RuntimeError("SYNTHETIC PRIVATE MODEL CONFIG")
        module.SentenceTransformer = failed
        response = self.client.post("/embed", json={"texts": ["Synthetic input"]})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("PRIVATE", response.text)
        module.SentenceTransformer = self.factory
        self.assertEqual(self.client.post("/embed", json={"texts": ["Synthetic retry"]}).status_code, 200)

    def test_concurrent_inference_fails_fast_without_second_encode(self):
        self.model.started = threading.Event()
        self.model.release = threading.Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.client.post, "/embed", json={"texts": ["First synthetic input"]})
            try:
                self.assertTrue(self.model.started.wait(2))
                second = self.client.post("/embed", json={"texts": ["Second synthetic input"]})
                self.assertEqual(second.status_code, 503)
                self.assertEqual(len(self.model.calls), 1)
            finally:
                self.model.release.set()
            self.assertEqual(first.result(timeout=3).status_code, 200)

    def test_concurrent_cold_load_initializes_model_once(self):
        started = threading.Event()
        release = threading.Event()
        module = sys.modules["sentence_transformers"]
        def factory(*args, **kwargs):
            self.loads.append((args, kwargs))
            started.set()
            if not release.wait(3):
                raise RuntimeError("Synthetic load timed out")
            return self.model
        module.SentenceTransformer = factory
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(route.get_embedding_model)
            try:
                self.assertTrue(started.wait(2))
                second = pool.submit(route.get_embedding_model)
            finally:
                release.set()
            self.assertIs(first.result(timeout=3), second.result(timeout=3))
        self.assertEqual(len(self.loads), 1)


if __name__ == "__main__":
    unittest.main()
