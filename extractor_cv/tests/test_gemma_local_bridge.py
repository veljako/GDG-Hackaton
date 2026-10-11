import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from gemma_local_bridge import GenerateRequest, TokenRequest, generate, tokenize

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ, {'GEMMA_OLLAMA_GENERATION_MODEL':'gemma2:2b','GEMMA_OLLAMA_GENERATION_DIGEST':'a'*64})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.tags=Mock()
        self.tags.json.return_value={'models':[{'name':'gemma2:2b','digest':'a'*64}]}

    def test_token_preflight_uses_identical_chat_framing_and_context(self):
        response=Mock()
        response.json.return_value={'model':'gemma2:2b','prompt_eval_count':45,'message':{'content':'{}'}}
        with patch('gemma_local_bridge.requests.get',return_value=self.tags),patch('gemma_local_bridge.requests.post',return_value=response) as post:
            count=tokenize(TokenRequest(prompt='Extract a CV',model='gemma2:2b'))
            preflight=post.call_args.kwargs['json']
            generate(GenerateRequest(prompt='Extract a CV'))
            actual=post.call_args.kwargs['json']
        self.assertEqual(count['tokens'],45)
        self.assertEqual(preflight['messages'],actual['messages'])
        self.assertEqual(preflight['options']['num_ctx'],actual['options']['num_ctx'])
        self.assertEqual(preflight['options']['num_predict'],1)

    def test_token_preflight_rejects_wrong_model_and_invalid_count(self):
        with patch('gemma_local_bridge.requests.get',return_value=self.tags):
            with self.assertRaises(HTTPException): tokenize(TokenRequest(prompt='CV',model='another-model'))
            response=Mock()
            response.json.return_value={'model':'gemma2:2b','prompt_eval_count':True}
            with patch('gemma_local_bridge.requests.post',return_value=response):
                with self.assertRaises(HTTPException): tokenize(TokenRequest(prompt='CV',model='gemma2:2b'))

    def test_digest_change_refuses_inference(self):
        self.tags.json.return_value={'models':[{'name':'gemma2:2b','digest':'b'*64}]}
        with patch('gemma_local_bridge.requests.get',return_value=self.tags),patch('gemma_local_bridge.requests.post') as post:
            with self.assertRaises(HTTPException): generate(GenerateRequest(prompt='CV'))
            post.assert_not_called()

if __name__=='__main__': unittest.main()
