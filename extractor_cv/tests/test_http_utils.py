import sys
import unittest
from pathlib import Path
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from http_utils import read_json_response


class HttpTests(unittest.TestCase):
    def test_oversized_header_rejects_before_reading_body(self):
        response = Mock(headers={"Content-Length": "100"})
        with self.assertRaises(ValueError):
            read_json_response(response, max_bytes=10)
        response.iter_content.assert_not_called()
        response.json.assert_not_called()

    def test_chunked_body_stops_at_budget_without_reading_rest(self):
        response = Mock(headers={})
        def chunks(**kwargs):
            yield b"123456"
            yield b"123456"
            raise AssertionError("Read past response budget")
        response.iter_content.side_effect = chunks
        with self.assertRaises(ValueError):
            read_json_response(response, max_bytes=10)
        response.json.assert_not_called()

    def test_valid_stream_is_decoded_as_json(self):
        response = Mock(headers={})
        response.iter_content.return_value = [b'{"skills":', b'["Python"]}']
        self.assertEqual(read_json_response(response), {"skills": ["Python"]})


if __name__ == "__main__":
    unittest.main()
