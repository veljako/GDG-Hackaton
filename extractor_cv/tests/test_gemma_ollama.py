import sys
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from embeddings import OllamaGemmaEmbeddings

DIGEST = 'a' * 64

class OllamaGemmaTests(unittest.TestCase):
    def test_digest_and_google_model_are_required(self):
        with self.assertRaises(ValueError):
            OllamaGemmaEmbeddings(model='nomic-embed-text', digest=DIGEST)
        with self.assertRaises(ValueError):
            OllamaGemmaEmbeddings(digest='not-a-digest')

    def test_pinned_model_query_document_prompts_and_no_truncation(self):
        tags = Mock(status_code=200)
        tags.json.return_value = {'models': [{'name': 'embeddinggemma:latest', 'digest': DIGEST}]}
        answer = Mock(status_code=200)
        answer.json.return_value = {'embeddings': [[1.] + [0.] * 767]}
        with patch('embeddings.requests.get', return_value=tags), patch('embeddings.requests.post', return_value=answer) as post:
            model = OllamaGemmaEmbeddings(digest=DIGEST)
            self.assertEqual(len(model.embed_query('computer vision')), 768)
            self.assertIn('task: search result | query:', post.call_args.kwargs['json']['input'][0])
            self.assertFalse(post.call_args.kwargs['json']['truncate'])
            model.embed_documents(['Python experience'])
            self.assertIn('title: none | text:', post.call_args.kwargs['json']['input'][0])

    def test_model_replacement_and_invalid_vectors_fail_closed(self):
        tags = Mock(status_code=200)
        tags.json.return_value = {'models': [{'name': 'embeddinggemma:latest', 'digest': 'b'*64}]}
        with patch('embeddings.requests.get', return_value=tags):
            with self.assertRaises(Exception):
                OllamaGemmaEmbeddings(digest=DIGEST).embed_query('AI')

if __name__ == '__main__':
    unittest.main()
