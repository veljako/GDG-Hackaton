import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import demo


class DemoTests(unittest.TestCase):
    def test_dataset_firebase_flag_is_rejected_before_opening_any_store(self):
        with patch("demo.pipeline.configure_store", side_effect=AssertionError("Store opened")), \
                contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            demo.main(["--firebase", "--in-memory"])
        self.assertEqual(error.exception.code, 2)

    def test_invalid_query_limit_is_rejected_before_opening_store(self):
        with patch("demo.pipeline.configure_store", side_effect=AssertionError("Store opened")), \
                contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            demo.main(["--top-n", "100000"])
        self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
