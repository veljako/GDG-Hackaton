import sys
import tempfile
import unittest
import json
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluate_synthetic import compare_fields, generate_profiles, write_cv_pdf, mock_extract, run_evaluation, matching_cases, structured_baseline
from extractor import extract_text_from_file


class SyntheticEvaluationTests(unittest.TestCase):
    def test_seed_replays_fictional_profiles(self):
        self.assertEqual(generate_profiles(41), generate_profiles(41))
        self.assertNotEqual(generate_profiles(41), generate_profiles(42))
        self.assertEqual(len(generate_profiles(41)), 8)
        self.assertEqual({p['language'] for p in generate_profiles(41)}, {'en', 'sr-Latn'})

    def test_pdf_roundtrip_and_explicit_mock(self):
        runtime = Path(__file__).resolve().parents[2] / '.runtime'
        runtime.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            for profile in generate_profiles(41):
                path = Path(directory) / (profile['candidate_id'] + '.pdf')
                write_cv_pdf(path, profile)
                text = extract_text_from_file(str(path))
                self.assertIn(profile['first_name'], text)
                self.assertIn('FICTIONAL', text)
                actual = mock_extract(path, profile)
                self.assertTrue(compare_fields(profile, actual)['passed'])

    def test_comparisons_detect_missing_wrong_and_hallucinated_fields(self):
        expected = {'skills': ['Python', 'SQL'], 'location': 'Beograd',
                    'status': 'student', 'experience_level': 'junior'}
        actual = dict(expected, location='Belgrade', skills=['python', 'SQL'])
        self.assertTrue(compare_fields(expected, actual)['passed'])
        actual.update(location='Novi Sad', status=None, experience_level='senior', skills=['Python'])
        self.assertFalse(compare_fields(expected, actual)['passed'])
        self.assertEqual(compare_fields(expected, actual)['fields']['skills']['missing'], ['sql'])
        self.assertFalse(compare_fields({'skills': [], 'location': None}, {'skills': ['Rust'], 'location': 'Paris'})['passed'])

    def test_offline_report_does_not_claim_model_quality(self):
        runtime = Path(__file__).resolve().parents[2] / '.runtime'
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            report = run_evaluation('offline', 41, Path(directory) / 'report.md')
            self.assertTrue(report['passed'])
            self.assertEqual(len(report['extraction']), 8)
            self.assertGreaterEqual(len(report['matching']), 20)
            self.assertEqual(len(report['cache']), 8 + len(report['matching']))
            self.assertEqual(report['comparison']['case_count'], len(report['matching']))
            self.assertEqual(report['comparison']['eligibility_violations'], [])
            self.assertTrue(all('baseline_ranking' in r for r in report['matching']))
            artifacts = json.loads(Path(report['artifacts']['normalized_records']).read_text())
            self.assertEqual(len(artifacts['records']), 8)
            replay = run_evaluation('offline', 41, Path(directory) / 'replay.md', replay_path=Path(report['artifacts']['normalized_records']))
            self.assertTrue(replay['passed'])
            self.assertTrue(replay['boundaries']['replayed_extraction'])
            self.assertFalse(report['boundaries']['gemma_extraction'])
            self.assertFalse(report['boundaries']['embeddinggemma'])
            self.assertFalse(report['boundaries']['firestore'])
            self.assertFalse(report['boundaries']['semantic_quality_evaluated'])
            self.assertTrue(report['matching'][-1]['semantic_check_skipped'])

    def test_case_labels_and_baseline_enforce_metadata_on_same_records(self):
        cases = matching_cases()
        self.assertGreaterEqual(len(cases), 20)
        self.assertEqual(len({c['event_id'] for c in cases}), len(cases))
        profiles = generate_profiles(41)
        self.assertTrue(all(p['status'] in (None, 'student', 'employed') for p in profiles))
        rank = structured_baseline(profiles, {'skills': ['Python'], 'location': 'Belgrade', 'seniority': 'junior', 'remote': False})
        self.assertEqual(rank[0]['candidate_id'], 'synthetic-away')
        self.assertNotIn('synthetic-unknown', [r['candidate_id'] for r in rank])
        self.assertIn('synthetic-away', [r['candidate_id'] for r in rank])

    def test_requested_live_unavailable_is_failed_and_sanitized(self):
        runtime = Path(__file__).resolve().parents[2] / '.runtime'
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            output = Path(directory) / 'report.md'
            with patch('embeddings.GemmaServerEmbeddings', side_effect=RuntimeError('SECRET token')):
                report = run_evaluation('live', 41, output)
            self.assertFalse(report['passed'])
            self.assertFalse(report['boundaries']['mocked_extraction'])
            self.assertFalse(report['boundaries']['semantic_quality_evaluated'])
            self.assertNotIn('SECRET', output.read_text() + output.with_suffix('.json').read_text())
            self.assertEqual(json.loads(output.with_suffix('.json').read_text())['failure']['exception_type'], 'RuntimeError')


if __name__ == '__main__':
    unittest.main()
