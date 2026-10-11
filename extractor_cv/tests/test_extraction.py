import importlib
import json
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from pypdf import PdfWriter, PdfReader, get_configuration
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject, ArrayObject, NumberObject

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import extractor
import extractors


def cv_payload(**updates):
    payload = dict(first_name="Synthetic", last_name="Person", current_role=None,
                   education=[], skills=["Python"], general_description="Synthetic profile.",
                   location=None, status=None, birth_year=None, experience_level="Junior")
    payload.update(updates)
    return payload


class Response:
    def __init__(self, status=200, payload=None, text="SYNTHETIC PRIVATE RESPONSE", raw_body=None, declared_length=True):
        self.status_code = status
        self.text = text
        self.payload = payload if payload is not None else {"response": json.dumps(cv_payload())}
        self.body = raw_body if raw_body is not None else json.dumps(self.payload).encode("utf-8")
        self.headers = {"Content-Length": str(len(self.body))} if declared_length else {}
        self.json_calls = 0
        self.bytes_yielded = 0
        self.closed = False

    def json(self):
        self.json_calls += 1
        return self.payload

    def iter_content(self, chunk_size=8192, **kwargs):
        for start in range(0, len(self.body), chunk_size):
            chunk = self.body[start:start + chunk_size]
            self.bytes_yielded += len(chunk)
            yield chunk

    def close(self):
        self.closed = True


def write_pdf(path, texts):
    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=400, height=400)
        if text:
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                     NameObject("/Subtype"): NameObject("/Type1"),
                                     NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"):
                DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
            stream = DecodedStreamObject()
            escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            stream.set_data(f"BT /F1 12 Tf 10 300 Td ({escaped}) Tj ET".encode("ascii"))
            page[NameObject("/Contents")] = writer._add_object(stream)
    with path.open("wb") as handle:
        writer.write(handle)


def write_content_pdf(path, sizes, form=False, depth=1, cycle=False, invocations=1, child_invocations=1,
                      invocation_separator=b" "):
    writer = PdfWriter()
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                             NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    fonts = DictionaryObject({NameObject("/F1"): writer._add_object(font)})
    for size in sizes:
        page = writer.add_blank_page(width=400, height=400)
        if size is None:
            continue
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): fonts})
        content = b" " * size + b"BT /F1 12 Tf 10 300 Td (Synthetic) Tj ET"
        stream = DecodedStreamObject()
        stream.set_data(content)
        if form:
            child = None
            for level in range(depth):
                current = DecodedStreamObject()
                child_call = b" /Child" + invocation_separator + b"Do"
                current.set_data(content + (child_call * child_invocations if child is not None else b""))
                encoded = current.flate_encode()
                encoded[NameObject("/Type")] = NameObject("/XObject")
                encoded[NameObject("/Subtype")] = NameObject("/Form")
                encoded[NameObject("/BBox")] = ArrayObject([NumberObject(x) for x in (0, 0, 400, 400)])
                resources = DictionaryObject({NameObject("/Font"): fonts})
                if child is not None:
                    resources[NameObject("/XObject")] = DictionaryObject({NameObject("/Child"): child})
                encoded[NameObject("/Resources")] = resources
                child = writer._add_object(encoded)
                if cycle:
                    resources[NameObject("/XObject")] = DictionaryObject({NameObject("/Child"): child})
                    encoded.set_data(content + child_call)
            page[NameObject("/Resources")][NameObject("/XObject")] = DictionaryObject({NameObject("/Form"): child})
            stream.set_data((b"/Form" + invocation_separator + b"Do\n") * invocations)
        page[NameObject("/Contents")] = writer._add_object(stream.flate_encode())
    with path.open("wb") as handle:
        writer.write(handle)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(__file__).resolve().parents[2] / ".runtime"
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=runtime)
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def test_endpoint_defaults_to_loopback_and_is_configurable(self):
        with patch.dict(os.environ, {}, clear=True):
            importlib.reload(extractor)
            self.assertTrue(extractor.API_URL.startswith(("http://localhost:", "http://127.0.0.1:")))
        with patch.dict(os.environ, {"GEMMA_GENERATE_URL": "http://localhost:9876/generate"}):
            importlib.reload(extractor)
            self.assertEqual(extractor.API_URL, "http://localhost:9876/generate")
        importlib.reload(extractor)

    def test_scanned_pdf_page_uses_real_rendering_and_timed_ocr(self):
        path = self.root / "scan.pdf"
        write_pdf(path, ["Embedded text", ""])
        captured = []
        def ocr(image, **kwargs):
            captured.append((image.size, kwargs))
            return "Scanned text"
        with patch.object(extractor.pytesseract, "image_to_string", side_effect=ocr):
            self.assertEqual(extractor.extract_text_from_file(str(path)), "Embedded text\nScanned text")
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0][1]["timeout"], 20)
        self.assertLessEqual(captured[0][0][0] * captured[0][0][1], 16_000_000)

    def test_pdf_page_limit_is_checked_before_ocr_or_http(self):
        path = self.root / "too-many.pdf"
        write_pdf(path, [""] * 21)
        with patch.object(extractor.pytesseract, "image_to_string") as ocr, patch.object(extractor.requests, "post") as post:
            with self.assertRaises(ValueError):
                extractors.extract_cv_info(str(path))
        ocr.assert_not_called()
        post.assert_not_called()

    def test_compressed_pdf_content_limit_precedes_text_parser(self):
        path = self.root / "large-content.pdf"
        write_content_pdf(path, [128 * 1024 + 1])
        self.assertLess(path.stat().st_size, 5 * 1024 * 1024)
        with patch.object(extractor.pytesseract, "image_to_string") as ocr:
            with self.assertRaises(ValueError):
                extractor.extract_text_from_file(str(path))
        ocr.assert_not_called()

    def test_pdf_stream_inflation_limit_rejects_compression_bomb(self):
        path = self.root / "inflation.pdf"
        write_content_pdf(path, [2 * 1024 * 1024 + 1])
        with self.assertRaises(ValueError):
            extractor.extract_text_from_file(str(path))

    def test_total_pdf_content_budget_is_shared_across_pages(self):
        path = self.root / "combined-content.pdf"
        write_content_pdf(path, [110 * 1024] * 20)
        with self.assertRaises(ValueError):
            extractor.extract_text_from_file(str(path))

    def test_nested_form_content_cannot_bypass_stream_budget(self):
        path = self.root / "large-form.pdf"
        write_content_pdf(path, [128 * 1024 + 1], form=True)
        with self.assertRaises(ValueError):
            extractor.extract_text_from_file(str(path))

    def test_nested_form_depth_is_bounded_before_text_extraction(self):
        path = self.root / "deep-forms.pdf"
        write_content_pdf(path, [0], form=True, depth=21)
        reader = PdfReader(path)
        with self.assertRaisesRegex(extractor.ExtractionError, "nesting"):
            extractor._preflight_pdf_content(reader.pages)
        with self.assertRaisesRegex(extractor.ExtractionError, "nesting"):
            extractor.extract_text_from_file(str(path))

    def test_total_content_budget_includes_nested_forms(self):
        path = self.root / "combined-forms.pdf"
        write_content_pdf(path, [110 * 1024] * 20, form=True)
        with self.assertRaises(ValueError):
            extractor.extract_text_from_file(str(path))

    def test_repeated_form_invocations_are_rejected_instead_of_silently_skipped(self):
        path = self.root / "repeated-form.pdf"
        write_content_pdf(path, [0], form=True, invocations=101)
        with self.assertRaises(ValueError):
            extractor.extract_text_from_file(str(path))

    def test_nested_form_invocation_budget_counts_multiplicity(self):
        path = self.root / "nested-repeated-form.pdf"
        write_content_pdf(path, [0], form=True, depth=2, invocations=10, child_invocations=10)
        with self.assertRaises(ValueError):
            extractor.extract_text_from_file(str(path))

    def test_comment_separated_repeated_form_invocations_are_bounded_in_preflight(self):
        path = self.root / "commented-repeated-form.pdf"
        write_content_pdf(path, [0], form=True, invocations=101,
                          invocation_separator=b"% operator separator\n ")
        reader = PdfReader(path)
        with self.assertRaisesRegex(extractor.ExtractionError, "invocations"):
            extractor._preflight_pdf_content(reader.pages)

    def test_comment_separated_nested_form_invocations_count_multiplicity_in_preflight(self):
        path = self.root / "commented-nested-form.pdf"
        write_content_pdf(path, [0], form=True, depth=2, invocations=10, child_invocations=10,
                          invocation_separator=b"% operator separator\r\n ")
        reader = PdfReader(path)
        with self.assertRaisesRegex(extractor.ExtractionError, "invocations"):
            extractor._preflight_pdf_content(reader.pages)

    def test_comment_separated_form_invocations_obey_parsed_byte_budget(self):
        path = self.root / "commented-content-budget.pdf"
        write_content_pdf(path, [110 * 1024], form=True, invocations=20,
                          invocation_separator=b"% operator separator\n ")
        reader = PdfReader(path)
        with self.assertRaisesRegex(extractor.ExtractionError, "parsed content"):
            extractor._preflight_pdf_content(reader.pages)

    def test_operator_text_inside_pdf_strings_and_comments_is_not_counted(self):
        path = self.root / "operator-text.pdf"
        write_pdf(path, ["/Root Do " * 101])
        reader = PdfReader(path)
        page = reader.pages[0]
        original = page.get_contents().get_data()
        content = DecodedStreamObject()
        content.set_data(original + b"\n% " + b"/Root Do " * 101 + b"\n")
        page[NameObject("/Contents")] = content
        extractor._preflight_pdf_content([page])

    def test_comment_separated_form_invocations_accept_the_exact_limit(self):
        path = self.root / "commented-allowed-form.pdf"
        write_content_pdf(path, [0], form=True, invocations=100,
                          invocation_separator=b"% operator separator\n ")
        reader = PdfReader(path)
        extractor._preflight_pdf_content(reader.pages)

    def test_reused_form_content_is_counted_for_each_page(self):
        path = self.root / "shared-form.pdf"
        write_content_pdf(path, [110 * 1024], form=True)
        reader = PdfReader(path)
        writer = PdfWriter()
        for _ in range(20):
            writer.add_page(reader.pages[0])
        with path.open("wb") as handle:
            writer.write(handle)
        reader = PdfReader(path)
        with self.assertRaisesRegex(extractor.ExtractionError, "parsed content"):
            extractor._preflight_pdf_content(reader.pages)
        with self.assertRaisesRegex(extractor.ExtractionError, "parsed content"):
            extractor.extract_text_from_file(str(path))

    def test_reused_form_subtree_still_obeys_maximum_nesting_depth(self):
        path = self.root / "shared-depth.pdf"
        write_content_pdf(path, [0], form=True, depth=19)
        reader = PdfReader(path)
        writer = PdfWriter()
        writer.add_page(reader.pages[0])
        resources = writer.pages[0]["/Resources"]
        child = resources["/XObject"]["/Form"].indirect_reference
        for _ in range(2):
            form = DecodedStreamObject()
            form.set_data(b"/Child Do")
            form[NameObject("/Type")] = NameObject("/XObject")
            form[NameObject("/Subtype")] = NameObject("/Form")
            form[NameObject("/BBox")] = ArrayObject([NumberObject(x) for x in (0, 0, 400, 400)])
            form[NameObject("/Resources")] = DictionaryObject({NameObject("/XObject"):
                DictionaryObject({NameObject("/Child"): child})})
            child = writer._add_object(form)
        page = writer.add_blank_page(width=400, height=400)
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/XObject"):
            DictionaryObject({NameObject("/Root"): child})})
        content = DecodedStreamObject()
        content.set_data(b"/Root Do")
        page[NameObject("/Contents")] = writer._add_object(content)
        with path.open("wb") as handle:
            writer.write(handle)
        reader = PdfReader(path)
        with self.assertRaisesRegex(extractor.ExtractionError, "nesting"):
            extractor._preflight_pdf_content(reader.pages)
        with self.assertRaisesRegex(extractor.ExtractionError, "nesting"):
            extractor.extract_text_from_file(str(path))

    def test_form_cycle_is_rejected_before_scanned_page_rendering(self):
        path = self.root / "cyclic-forms.pdf"
        write_content_pdf(path, [None, 0], form=True, cycle=True)
        with patch.object(extractor.pytesseract, "image_to_string", return_value="Scanned page") as ocr:
            failed = False
            try:
                extractor.extract_text_from_file(str(path))
            except ValueError:
                failed = True
            self.assertTrue(failed)
            ocr.assert_not_called()

    def test_pdf_configuration_is_scoped_and_restored_after_failure(self):
        path = self.root / "scan.pdf"
        write_pdf(path, [""])
        baseline = get_configuration()
        seen = []
        def ocr(image, **kwargs):
            seen.append(get_configuration())
            raise RuntimeError("Synthetic OCR failure")
        with patch.object(extractor.pytesseract, "image_to_string", side_effect=ocr):
            with self.assertRaises(ValueError):
                extractor.extract_text_from_file(str(path))
        self.assertIs(get_configuration(), baseline)
        self.assertEqual(seen[0].zlib_maximum_output_length, 2 * 1024 * 1024)
        self.assertEqual(seen[0].array_based_stream_maximum_output_length, 2 * 1024 * 1024)
        self.assertEqual(seen[0].stream_decoding_work_maximum_length, 8 * 1024 * 1024)
        self.assertEqual(seen[0].page_tree_maximum_entries, 100)
        self.assertEqual(seen[0].page_tree_maximum_depth, 20)
        self.assertEqual(seen[0].xform_maximum_invocations_per_extraction, 100)

    def test_upload_byte_limit_is_checked_before_decoding(self):
        path = self.root / "large.pdf"
        with path.open("wb") as handle:
            handle.truncate(5 * 1024 * 1024 + 1)
        with patch.object(extractor.requests, "post") as post:
            with self.assertRaisesRegex(ValueError, "size|bytes|MB"):
                extractors.extract_cv_info(str(path))
        post.assert_not_called()

    def test_input_text_limit_rejects_before_http(self):
        with patch.object(extractor.requests, "post") as post:
            with self.assertRaises(ValueError):
                extractor.parse_cv_with_gemma("X" * 20_001, "http://localhost/generate")
        post.assert_not_called()

    def test_pdf_extracted_text_limit_rejects_before_http(self):
        path = self.root / "long.pdf"
        write_pdf(path, ["X" * 20_001])
        with patch.object(extractor.requests, "post") as post:
            with self.assertRaises(ValueError):
                extractors.extract_cv_info(str(path))
        post.assert_not_called()

    def test_image_pixel_limit_rejects_before_ocr(self):
        path = self.root / "huge.png"
        with Image.new("1", (4100, 4100)) as image:
            image.save(path)
        with patch.object(extractor.pytesseract, "image_to_string") as ocr:
            with self.assertRaises(ValueError):
                extractor.extract_text_from_file(str(path))
        ocr.assert_not_called()

    def test_huge_pdf_page_is_rendered_with_bounded_dimensions(self):
        path = self.root / "huge-page.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=100_000, height=100_000)
        with path.open("wb") as handle:
            writer.write(handle)
        def ocr(image, **kwargs):
            self.assertLessEqual(max(image.size), 4096)
            self.assertLessEqual(image.width * image.height, 16_000_000)
            return "Synthetic text"
        with patch.object(extractor.pytesseract, "image_to_string", side_effect=ocr) as mocked:
            self.assertEqual(extractor.extract_text_from_file(str(path)), "Synthetic text")
        mocked.assert_called_once()

    def test_image_ocr_has_timeout_and_private_failure_is_sanitized(self):
        path = self.root / "image.png"
        with Image.new("RGB", (40, 40)) as image:
            image.save(path)
        with patch.object(extractor.pytesseract, "image_to_string", side_effect=RuntimeError("SYNTHETIC PRIVATE OCR")) as ocr:
            with self.assertRaises(ValueError) as failed:
                extractor.extract_text_from_file(str(path))
        self.assertEqual(ocr.call_args.kwargs["timeout"], 20)
        self.assertNotIn("PRIVATE", str(failed.exception))

    def test_transient_http_retry_has_bounded_timeout(self):
        with patch.object(extractor.requests, "post", side_effect=[Response(503), Response()]) as post:
            data = extractor._call_generate("http://localhost/generate", "Synthetic prompt")
        self.assertEqual(data["skills"], ["Python"])
        self.assertEqual(post.call_count, 2)
        timeout = post.call_args.kwargs["timeout"]
        self.assertIsInstance(timeout, tuple)
        self.assertLessEqual(timeout[0], 10)
        self.assertLessEqual(timeout[1], 60)

    def test_connection_retry_limit_and_error_are_sanitized(self):
        private = "SYNTHETIC PRIVATE CV"
        with patch.object(extractor.requests, "post", side_effect=extractor.requests.ConnectionError(private)) as post:
            with self.assertRaises((RuntimeError, ValueError, extractor.requests.RequestException)) as failed:
                extractor._call_generate("http://localhost/generate", "Synthetic prompt", max_retries=100)
        self.assertLessEqual(post.call_count, 3)
        self.assertNotIn(private, str(failed.exception))

    def test_nontransient_http_failure_is_not_retried_or_disclosed(self):
        with patch.object(extractor.requests, "post", return_value=Response(400)) as post:
            data = extractor.parse_cv_with_gemma("Synthetic text", "http://localhost/generate")
        self.assertIn("error", data)
        self.assertEqual(post.call_count, 1)
        self.assertNotIn("PRIVATE", json.dumps(data))

    def test_malformed_model_output_is_not_disclosed_or_replayed(self):
        response = Response(payload={"response": "SYNTHETIC PRIVATE RESPONSE"})
        with patch.object(extractor.requests, "post", return_value=response) as post:
            data = extractor.parse_cv_with_gemma("Synthetic CV", "http://localhost/generate")
        self.assertIn("error", data)
        self.assertNotIn("PRIVATE", json.dumps(data))
        for call in post.call_args_list:
            self.assertNotIn("PRIVATE RESPONSE", call.kwargs["json"]["prompt"])

    def test_raw_generation_body_is_bounded_before_json_decode(self):
        response = Response(payload={"response": "SYNTHETIC PRIVATE " + "X" * 2_000_000}, declared_length=False)
        with patch.object(extractor.requests, "post", return_value=response) as post:
            with self.assertRaises(ValueError) as failed:
                extractor._call_generate("http://localhost/generate", "Synthetic prompt", max_retries=0)
        self.assertNotIn("PRIVATE", str(failed.exception))
        self.assertEqual(response.json_calls, 0)
        self.assertTrue(response.closed)
        self.assertTrue(post.call_args.kwargs["stream"])
        self.assertLess(response.bytes_yielded, len(response.body))

    def test_invalid_raw_http_json_is_sanitized_and_closed(self):
        response = Response(raw_body=b"{SYNTHETIC PRIVATE RAW JSON")
        with patch.object(extractor.requests, "post", return_value=response):
            result = extractor.parse_cv_with_gemma("Synthetic CV", "http://localhost/generate")
        self.assertIn("error", result)
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertEqual(response.json_calls, 0)
        self.assertTrue(response.closed)

    def test_stream_read_timeout_is_sanitized_and_response_closed(self):
        response = Response()
        def failed_stream(**kwargs):
            raise extractor.requests.Timeout("SYNTHETIC PRIVATE STREAM ERROR")
            yield b""
        response.iter_content = failed_stream
        with patch.object(extractor.requests, "post", return_value=response):
            result = extractor.parse_cv_with_gemma("Synthetic CV", "http://localhost/generate")
        self.assertIn("error", result)
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertTrue(response.closed)

    def test_deprecated_confirmed_save_stub_reports_no_persistence(self):
        with self.assertRaises(NotImplementedError) as failed:
            extractor.process_and_save_confirmed_cv(cv_payload(), "Trusted_UID")
        message = str(failed.exception)
        self.assertIn("pipeline.add_user_to_firebase", message)
        self.assertIn("confirmed_fields", message)
        self.assertIn("revision", message)

    def test_birth_year_rejects_invalid_numbers(self):
        for year in (1899, date.today().year + 1, True, 2000.5, "2000.5"):
            with self.subTest(year=year), self.assertRaises(ValueError):
                extractors.normalize_cv_dict(cv_payload(birth_year=year), "Trusted_ID", "Synthetic")

    def test_normalization_bounds_database_fields(self):
        raw = cv_payload(first_name="F" * 500, last_name="L" * 500,
                         current_role="R" * 500, general_description="S" * 15_000,
                         skills=[f"{i}-" + "X" * 500 for i in range(70)],
                         education=[dict(institution="I" * 500, kind="university", degree="D" * 500, field="F" * 500)])
        normalized = extractors.normalize_cv_dict(raw, "Trusted_ID", "Synthetic")
        self.assertLessEqual(len(normalized["first_name"]), 100)
        self.assertLessEqual(len(normalized["last_name"]), 100)
        self.assertLessEqual(len(normalized["current_role"]), 200)
        self.assertLessEqual(len(normalized["general_description"]), 10_000)
        self.assertLessEqual(len(normalized["skills"]), 50)
        self.assertTrue(all(len(skill) <= 200 for skill in normalized["skills"]))
        self.assertTrue(all(len(normalized["education"][0][field]) <= 200 for field in ("institution", "degree", "field")))

    def test_imported_raw_cv_text_is_rejected_instead_of_truncated(self):
        with self.assertRaises(ValueError):
            extractors.normalize_cv_dict(cv_payload(cv_text="X" * 20_001), "Trusted_ID", "Synthetic")

    def test_whitespace_only_imported_text_still_obeys_input_budget(self):
        with self.assertRaises(ValueError):
            extractors.normalize_cv_dict(cv_payload(cv_text=" " * 20_001), "Trusted_ID", "Synthetic")

    def test_single_json_identity_matches_iterator_identity(self):
        path = self.root / "one.json"
        path.write_text(json.dumps(cv_payload()), encoding="utf-8")
        self.assertEqual(extractors.extract_cv_info(str(path))["candidate_id"],
                         next(extractors.iter_cv_records(str(path)))[0])

    def test_invalid_id_is_rejected_and_explicit_id_preserved(self):
        for candidate_id in ("uploads/cv", "", "Иван", "X" * 129):
            with self.subTest(candidate_id=candidate_id), self.assertRaises(ValueError):
                extractors.normalize_cv_dict(cv_payload(), candidate_id, "Synthetic")
        self.assertEqual(extractors.normalize_cv_dict(cv_payload(), "Exact_UID-A_1", "Synthetic")["candidate_id"], "Exact_UID-A_1")

    def test_dataset_identity_uses_full_path_and_unicode_name(self):
        paths = [self.root / "one/uploads/CV.pdf", self.root / "two/uploads/CV.pdf",
                 self.root / "uploads/Иван.pdf", self.root / "uploads/Милан.pdf"]
        ids = [extractors.candidate_id_for(path) for path in paths]
        self.assertEqual(len(set(ids)), 4)
        self.assertTrue(all(candidate_id.startswith("dataset-") for candidate_id in ids))
        self.assertTrue(all("/" not in candidate_id for candidate_id in ids))

    def test_single_json_preserves_record_id(self):
        path = self.root / "record.json"
        path.write_text(json.dumps(cv_payload(candidate_id="Exact_UID-A_1")), encoding="utf-8")
        self.assertEqual(extractors.extract_cv_info(str(path))["candidate_id"], "Exact_UID-A_1")
        self.assertEqual(extractors.extract_cv_info(str(path), candidate_id="Account_UID")["candidate_id"], "Account_UID")

    def test_malformed_json_failure_does_not_abort_later_file(self):
        (self.root / "a-bad.json").write_text("{broken", encoding="utf-8")
        (self.root / "b-good.json").write_text(json.dumps(cv_payload()), encoding="utf-8")
        records = list(extractors.iter_cv_records(str(self.root)))
        self.assertEqual(len(records), 2)
        self.assertIsNone(records[0][1])
        self.assertIsNotNone(records[0][2])
        self.assertIsNotNone(records[1][1])

    def test_invalid_record_failure_does_not_abort_other_records(self):
        path = self.root / "records.json"
        path.write_text(json.dumps([cv_payload(candidate_id="bad/id"), cv_payload(candidate_id="Exact_UID")]), encoding="utf-8")
        records = list(extractors.iter_cv_records(str(path)))
        self.assertEqual(len(records), 2)
        self.assertIsNone(records[0][1])
        self.assertEqual(records[1][0], "Exact_UID")
        self.assertEqual(records[1][1]["candidate_id"], "Exact_UID")

    def test_json_record_identity_survives_list_reordering(self):
        path = self.root / "records.json"
        payloads = [cv_payload(first_name="First"), cv_payload(first_name="Second")]
        path.write_text(json.dumps(payloads), encoding="utf-8")
        first = {record[1]["first_name"]: record[0] for record in extractors.iter_cv_records(str(path))}
        path.write_text(json.dumps(list(reversed(payloads))), encoding="utf-8")
        second = {record[1]["first_name"]: record[0] for record in extractors.iter_cv_records(str(path))}
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
