"""Seeded fictional CV evaluation. Offline inference is an explicit test double.

Run --mode live to require actual Gemma /generate, EmbeddingGemma /embed and
Firestore. Neither a model outage nor a failed check can become a passing run.
"""
import argparse
import hashlib
import json
import os
import random
import sys
import textwrap
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from contracts import canonical_city
from extractor import extract_text_from_file
from extractors import extract_cv_info, normalize_cv_dict
from event_candidate_finder import seniority_bucket


def generate_profiles(seed):
    rng = random.Random(seed)
    specs = [
        ('python', ['Python', 'SQL', 'Pandas'], 'Belgrade', 'student', 'junior', 2003,
         'Data analysis with Python, SQL and Pandas. I clean datasets and build prediction models.'),
        ('web', ['React', 'TypeScript', 'CSS'], 'Beograd', 'student', 'junior', 2002,
         'Pravim korisnicke interfejse koristeci React, TypeScript i CSS. Razvoj veb aplikacija.'),
        ('senior', ['Python', 'SQL', 'Pandas'], 'Belgrade', 'employed', 'senior', 1988,
         'Ten years building Python data systems and SQL analytics.'),
        ('away', ['Python', 'SQL'], 'Novi Sad', 'student', 'junior', 2004,
         'Analiza podataka i Python programiranje. SQL baze podataka.'),
        ('unknown', ['Python', 'SQL'], None, None, None, None,
         'Python and SQL projects; location, age and current seniority are intentionally unspecified.'),
        ('design', ['Figma', 'UX', 'Prototyping'], 'Belgrade', 'student', 'junior', 2003,
         'User experience research and Figma prototypes for accessible products.'),
        ('paraphrase', ['Machine Learning', 'Statistics'], 'Belgrade', 'student', 'junior', 2001,
         'I turn observations into forecasts, fit predictive models and uncover patterns in datasets.'),
        ('science', ['Biology', 'Microscopy'], 'Nis', 'employed', 'senior', 1990,
         'Istrazujem celije pomocu mikroskopije. Biologija i naucna istrazivanja.'),
    ]
    profiles = []
    names = rng.sample(['Mira', 'Luka', 'Ana', 'Ivan', 'Sara', 'Petar', 'Nina', 'Marko', 'Una', 'Ognjen'], 8)
    for i, (identity, skills, location, status, level, year, description) in enumerate(specs):
        profiles.append(dict(candidate_id='synthetic-' + identity, first_name=names[i],
            last_name='Fictional' + str(rng.randrange(1000, 9999)), skills=skills,
            location=location, status=status, experience_level=level, birth_year=year,
            current_role=level and level + ' ' + skills[0] + ' practitioner',
            education=[], general_description=description, language='sr-Latn' if i in (1, 3, 7) else 'en'))
    return profiles


def write_cv_pdf(path, profile):
    """Native text PDF; Serbian Latin uses explicit ASCII transliteration."""
    serbian = profile['language'] == 'sr-Latn'
    labels = {'location': 'Grad', 'status': 'Status', 'experience_level': 'Nivo iskustva',
              'birth_year': 'Godina rodjenja', 'current_role': 'Trenutna uloga'} if serbian else {
              'location': 'Location', 'status': 'Status', 'experience_level': 'Experience level',
              'birth_year': 'Birth year', 'current_role': 'Current role'}
    lines = ['FICTIONAL SYNTHETIC CV - evaluation only',
             profile['first_name'] + ' ' + profile['last_name']]
    for key, label in labels.items():
        if profile.get(key) is not None:
            lines.append(f'{label}: {profile[key]}')
    lines.append(('Vestine: ' if serbian else 'Skills: ') + ', '.join(profile['skills']))
    lines.extend(textwrap.wrap(profile['general_description'], 85))
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                             NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    escape = lambda line: line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    stream = DecodedStreamObject()
    stream.set_data(('BT /F1 11 Tf 40 790 Td 16 TL\n' + '\n'.join(f'({escape(line)}) Tj T*' for line in lines) + '\nET').encode('ascii'))
    page[NameObject('/Contents')] = writer._add_object(stream)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as handle:
        writer.write(handle)


def mock_extract(path, ground_truth):
    """TEST DOUBLE: verifies PDF parsing, then injects known fields; no inference."""
    text = extract_text_from_file(str(path))
    if ground_truth['first_name'] not in text or not all(s in text for s in ground_truth['skills']):
        raise ValueError('Synthetic PDF text roundtrip failed')
    return normalize_cv_dict(dict(ground_truth, cv_text=text, cv_filename=path.name),
                             ground_truth['candidate_id'], str(path))


def compare_fields(expected, actual):
    fields = {}
    for key in ('skills', 'location', 'status', 'experience_level'):
        left, right = expected.get(key), actual.get(key)
        if key == 'skills':
            wanted, got = {s.casefold() for s in left or []}, {s.casefold() for s in right or []}
            passed = wanted == got
            detail = {'missing': sorted(wanted - got), 'unexpected': sorted(got - wanted)}
        else:
            normalize = canonical_city if key == 'location' else seniority_bucket if key == 'experience_level' else lambda v: v.casefold().strip() if isinstance(v, str) else None
            passed = normalize(left) == normalize(right)
            detail = {}
        fields[key] = dict(expected=left, actual=right, passed=passed, **detail)
    return {'passed': all(v['passed'] for v in fields.values()), 'fields': fields}


class CountingEmbeddings:
    def __init__(self, delegate):
        self.delegate = delegate
        self.model_id, self.dimensions = delegate.model_id, delegate.dimensions
        self.document_calls = self.query_calls = 0

    def embed_documents(self, texts):
        vectors = self.delegate.embed_documents(texts)
        self.document_calls += 1
        return vectors

    def embed_query(self, text):
        vector = self.delegate.embed_query(text)
        self.query_calls += 1
        return vector


def matching_cases():
    cases = [
        dict(name='data event eligibility', event_id='synthetic-data', name_event='Python SQL data sprint',
             skills=['Python', 'SQL', 'Pandas'], location='Belgrade', seniority='junior',
             min_birth_year=2006, max_birth_year=1999, top=['synthetic-python'],
             excluded=['synthetic-senior', 'synthetic-away', 'synthetic-unknown', 'synthetic-science']),
        dict(name='frontend teammate complement for Python team', event_id='synthetic-complement',
             name_event='React TypeScript CSS frontend teammate', skills=['React', 'TypeScript', 'CSS'],
             location='Belgrade', seniority='junior', top=['synthetic-web'],
             excluded=['synthetic-away', 'synthetic-unknown', 'synthetic-senior', 'synthetic-science']),
        dict(name='remote science event', event_id='synthetic-science-event', name_event='Biology Microscopy research',
             skills=['Biology', 'Microscopy'], remote=True, top=['synthetic-science'], excluded=[]),
        dict(name='semantic paraphrase forecasts', event_id='synthetic-paraphrase',
             name_event='Discover patterns and forecast outcomes from observations', skills=[],
             remote=True, top=['synthetic-paraphrase', 'synthetic-python'], excluded=[], semantic_only=True, rank_cutoff=3),
    ]
    # Labels are authored before inference. Paraphrases are observational offline.
    additions = [
        ('Python junior SQL workshop', ['Python', 'SQL'], ['synthetic-python'], dict(location='Belgrade', seniority='junior')),
        ('React TypeScript remote hackathon', ['React', 'TypeScript'], ['synthetic-web'], dict(remote=True)),
        ('Figma UX prototyping design workshop', ['Figma', 'UX', 'Prototyping'], ['synthetic-design'], dict(location='Belgrade', seniority='junior')),
        ('Senior Python SQL architecture conference', ['Python', 'SQL'], ['synthetic-senior'], dict(location='Belgrade', seniority='senior')),
        ('Python SQL Novi Sad beginner workshop', ['Python', 'SQL'], ['synthetic-away'], dict(location='Novi Sad', seniority='junior')),
        ('Biology Microscopy laboratory Nis', ['Biology', 'Microscopy'], ['synthetic-science'], dict(location='Nis', seniority='senior')),
        ('Machine Learning Statistics student challenge', ['Machine Learning', 'Statistics'], ['synthetic-paraphrase'], dict(location='Belgrade', seniority='junior')),
        ('Python SQL Belgrade age 20 to 27 data challenge', ['Python', 'SQL'], ['synthetic-python'], dict(location='Belgrade', min_birth_year=2006, max_birth_year=1999)),
        ('Python SQL senior remote mentorship', ['Python', 'SQL'], ['synthetic-senior'], dict(remote=True, seniority='senior')),
        ('React TypeScript CSS junior online coding sprint', ['React', 'TypeScript', 'CSS'], ['synthetic-web'], dict(remote=True, seniority='junior')),
        ('Help a backend team make accessible browser interfaces', [], ['synthetic-web'], dict(remote=True, semantic_only=True, rank_cutoff=3)),
        ('Design screens and test user journeys for a prototype', [], ['synthetic-design'], dict(location='Belgrade', seniority='junior', semantic_only=True, rank_cutoff=3)),
        ('Find patterns in observations and build predictive forecasts', [], ['synthetic-paraphrase', 'synthetic-python'], dict(remote=True, semantic_only=True, rank_cutoff=3)),
        ('Observe living cells using a laboratory microscope', [], ['synthetic-science'], dict(remote=True, semantic_only=True, rank_cutoff=3)),
        ('Trazi se frontend clan tima za razvoj veb interfejsa', [], ['synthetic-web'], dict(location='Beograd', seniority='junior', semantic_only=True, rank_cutoff=3)),
        ('Analiza podataka i pravljenje modela za predvidjanje', [], ['synthetic-python', 'synthetic-paraphrase'], dict(location='Beograd', seniority='junior', semantic_only=True, rank_cutoff=3)),
    ]
    profiles = generate_profiles(0)
    for index, (name, skills, top, options) in enumerate(additions, 5):
        event = dict(options, skills=skills)
        cases.append(dict(name=name, event_id=f'synthetic-case-{index:02}', name_event=name,
                          skills=skills, top=top, excluded=[p['candidate_id'] for p in profiles if not eligible(p, event)], **options))
    return cases


def eligible(profile, event):
    """Independent metadata oracle matching documented explicit hard constraints."""
    if event.get('location') and not event.get('remote') and canonical_city(profile.get('location')) != canonical_city(event['location']):
        return False
    if event.get('seniority') and seniority_bucket(profile.get('experience_level')) != seniority_bucket(event['seniority']):
        return False
    oldest, youngest = event.get('max_birth_year'), event.get('min_birth_year')
    if oldest is not None and youngest is not None:
        oldest, youngest = sorted((oldest, youngest))
    year = profile.get('birth_year')
    return not ((oldest is not None and (year is None or year < oldest)) or
                (youngest is not None and (year is None or year > youngest)))


def structured_baseline(records, event):
    """Exact case-folded skill/tag overlap, SAME normalized extracted records.

    No synonym inference, description matching or full application recommender.
    Ties sort by immutable candidate ID; zero overlap remains an eligible result.
    """
    wanted = {s.casefold() for s in event.get('skills', [])}
    results = [dict(candidate_id=p['candidate_id'], score=len(wanted.intersection({s.casefold() for s in p.get('skills', [])})))
               for p in records if eligible(p, event)]
    return sorted(results, key=lambda r: (-r['score'], r['candidate_id']))


def generation_identity():
    """Whitelist only model identity from optional bridge health; never endpoints."""
    import requests
    url = urlsplit(os.environ.get('GEMMA_GENERATE_URL', 'http://127.0.0.1:8000/generate'))
    health = urlunsplit((url.scheme, url.netloc, '/health', '', ''))
    result = {'configured_model': os.environ.get('GEMMA_MODEL') or None, 'health_verified': False}
    try:
        response = requests.get(health, timeout=(3, 3))
        payload = response.json() if response.status_code == 200 else {}
        for key in ('model', 'generation_model', 'model_digest', 'digest', 'generation_digest'):
            if isinstance(payload.get(key), str) and len(payload[key]) <= 300:
                result[key] = payload[key]
        result['health_verified'] = any(k in result for k in ('model', 'generation_model'))
    except Exception:
        pass
    return result


def run_evaluation(mode, seed, output, *, embedding_backend='gemma', storage_backend=None, replay_path=None):
    storage_backend = storage_backend or ('firestore' if mode == 'live' else 'chroma')
    if mode == 'offline' and storage_backend != 'chroma':
        raise ValueError('Offline evaluation requires explicit ephemeral Chroma')
    run_id = uuid.uuid4().hex
    report = dict(mode=mode, seed=seed, run_id=run_id, passed=False, storage_backend=storage_backend,
                  embedding_backend=embedding_backend if mode == 'live' else 'local-hashing',
                  boundaries={'pdf_parsing': False, 'gemma_extraction': False,
                              'embeddinggemma': False, 'firestore': False, 'mocked_extraction': mode == 'offline',
                              'lexical_hashing': mode == 'offline', 'legacy_ephemeral_chroma': storage_backend == 'chroma',
                              'semantic_quality_evaluated': False},
                  limitations=['Small fictional sample; no production or population quality claim.',
                               'Serbian Latin PDFs use ASCII transliteration.',
                               'Complement case models missing team skills as an event query; does not evaluate team authorization.'],
                  extraction=[], matching=[], cache={}, cleanup={'attempted': False, 'passed': storage_backend == 'chroma'})
    report['boundaries']['replayed_extraction'] = replay_path is not None
    report['timings_seconds'] = {'pdf_generation': 0.0, 'extraction': 0.0, 'indexing': 0.0, 'matching': 0.0, 'cleanup': 0.0}
    report['comparison'] = {'baseline': 'Exact case-folded skill/tag overlap on SAME extracted records, same hard metadata constraints, candidate-ID tie breaking; not the full application recommender.',
                            'retriever': 'EmbeddingGemma semantic' if mode == 'live' else 'Offline lexical hashing (observational only)',
                            'case_count': 0, 'semantic_top1_hits': 0, 'semantic_top3_hits': 0,
                            'baseline_top1_hits': 0, 'baseline_top3_hits': 0, 'eligibility_violations': []}
    started = time.perf_counter()
    directory = output.parent / ('synthetic-cvs-' + run_id)
    owned_refs = []
    embeddings = None
    try:
        from embeddings import GemmaServerEmbeddings, LocalHashingEmbeddings
        from search_engine import find_best_matches
        from vector_store import MatchmakingStore
        if mode == 'live' and embedding_backend == 'ollama-gemma':
            from embeddings import OllamaGemmaEmbeddings
            delegate = OllamaGemmaEmbeddings()
        else:
            delegate = GemmaServerEmbeddings() if mode == 'live' else LocalHashingEmbeddings()
        embeddings = CountingEmbeddings(delegate)
        report['model_id'] = embeddings.model_id
        if storage_backend == 'firestore':
            from firestore_vector_store import FirestoreMatchmakingStore
            workspace = 'gdevEvaluations/' + run_id
            report['workspace'] = workspace
            store = FirestoreMatchmakingStore(embeddings, workspace=workspace, namespace='evaluation', allow_unbound_sources=True)
        else:
            store = MatchmakingStore(embeddings, persist_directory=None, namespace='evaluation')
        profiles = generate_profiles(seed)
        replay = None
        if replay_path is not None:
            replay = json.loads(replay_path.read_text(encoding='utf-8'))
            if replay.get('schema') != 'fictional-cv-evaluation-v1' or len(replay.get('records', [])) != 8:
                raise ValueError('Replay must be a complete fictional harness artifact')
            if {r.get('candidate_id') for r in replay['records']} != {p['candidate_id'] for p in profiles}:
                raise ValueError('Replay fixture identities are incompatible')
            if mode == 'live' and replay.get('inference_mode') != 'live':
                raise ValueError('Live evaluation cannot replay mocked extraction')
            profiles = replay['ground_truth']
            report['seed'] = replay['seed']
            report['generation_provenance'] = replay.get('generation_provenance')
            report['replayed_from_run_id'] = replay.get('run_id')
        else:
            report['generation_provenance'] = generation_identity() if mode == 'live' else {'test_double': True}
        records = []
        artifact = dict(schema='fictional-cv-evaluation-v1', seed=report['seed'], run_id=run_id,
                        inference_mode=mode, generation_provenance=report['generation_provenance'],
                        ground_truth=profiles, records=records, source_pdf_hashes={})
        artifact_path = directory / 'normalized-records.json'
        report['artifacts'] = {'normalized_records': str(artifact_path)}
        (directory / 'ground-truth.json').parent.mkdir(parents=True, exist_ok=True)
        (directory / 'ground-truth.json').write_text(json.dumps(profiles, indent=2), encoding='utf-8')
        for expected in profiles:
            path = directory / (expected['candidate_id'] + '.pdf')
            phase = time.perf_counter()
            write_cv_pdf(path, expected)
            if expected['first_name'] not in extract_text_from_file(str(path)):
                raise ValueError('Generated PDF cannot be parsed')
            artifact['source_pdf_hashes'][expected['candidate_id']] = hashlib.sha256(path.read_bytes()).hexdigest()
            report['timings_seconds']['pdf_generation'] += time.perf_counter() - phase
            phase = time.perf_counter()
            if replay is not None:
                actual = next(dict(r) for r in replay['records'] if r['candidate_id'] == expected['candidate_id'])
            elif mode == 'live':
                # Keep exact references even if a write partly succeeds.
                if storage_backend == 'firestore':
                    owned_refs.append(('candidate', expected['candidate_id']))
                actual = extract_cv_info(str(path), candidate_id=expected['candidate_id'])
                report['boundaries']['gemma_extraction'] = True
            else:
                actual = mock_extract(path, expected)
            report['timings_seconds']['extraction'] += time.perf_counter() - phase
            report['boundaries']['pdf_parsing'] = True
            records.append(actual)
            artifact_path.write_text(json.dumps(artifact, indent=2, ensure_ascii=False), encoding='utf-8')
            report['extraction'].append(dict(candidate_id=expected['candidate_id'], language=expected['language'], **compare_fields(expected, actual)))
            phase = time.perf_counter()
            if storage_backend == 'firestore' and ('candidate', expected['candidate_id']) not in owned_refs:
                owned_refs.append(('candidate', expected['candidate_id']))
            store.upsert_candidate(actual)
            if storage_backend == 'firestore':
                report['boundaries']['firestore'] = True
            before = embeddings.document_calls
            store.upsert_candidate(actual)
            report['cache']['candidate:' + expected['candidate_id']] = embeddings.document_calls == before
            report['timings_seconds']['indexing'] += time.perf_counter() - phase
        for case in matching_cases():
            phase = time.perf_counter()
            event = dict(event_id=case['event_id'], name=case['name_event'], skills=case['skills'],
                         remote=case.get('remote', False), location=case.get('location'),
                         seniority=case.get('seniority'), min_birth_year=case.get('min_birth_year'),
                         max_birth_year=case.get('max_birth_year'), event_type='hackathon')
            if storage_backend == 'firestore':
                owned_refs.append(('event', event['event_id']))
            store.upsert_event(event)
            before = embeddings.query_calls + embeddings.document_calls
            store.upsert_event(event)
            report['cache']['event:' + event['event_id']] = embeddings.query_calls + embeddings.document_calls == before
            results = find_best_matches(store, event['event_id'], top_n=8)
            ids = [r.candidate_id for r in results]
            baseline = structured_baseline(records, event)
            baseline_ids = [r['candidate_id'] for r in baseline]
            actual_by_id = {r['candidate_id']: r for r in records}
            violations = []
            for retriever, ranked in (('semantic' if mode == 'live' else 'offline_lexical', ids), ('structured_baseline', baseline_ids)):
                violations += [{'retriever': retriever, 'case': case['name'], 'candidate_id': identity, 'constraint_source': 'extracted_metadata'} for identity in ranked if identity not in actual_by_id or not eligible(actual_by_id[identity], event)]
                violations += [{'retriever': retriever, 'case': case['name'], 'candidate_id': identity, 'constraint_source': 'fixture_ground_truth'} for identity in sorted(set(ranked).intersection(case['excluded']))]
            report['comparison']['eligibility_violations'].extend(violations)
            excluded_ok = not [v for v in violations if v['retriever'] != 'structured_baseline']
            skipped = mode == 'offline' and case.get('semantic_only', False)
            cutoff = case.get('rank_cutoff', 1)
            ranking_ok = bool(set(ids[:cutoff]).intersection(case['top']))
            report['matching'].append(dict(case=case['name'], expected_top_any=case['top'], rank_cutoff=cutoff,
                expected_exclusions=case['excluded'], actual=[dict(candidate_id=r.candidate_id, similarity=r.similarity) for r in results],
                baseline_ranking=baseline, baseline_top1_hit=bool(set(baseline_ids[:1]).intersection(case['top'])),
                baseline_top3_hit=bool(set(baseline_ids[:3]).intersection(case['top'])),
                top1_hit=bool(set(ids[:1]).intersection(case['top'])), top3_hit=bool(set(ids[:3]).intersection(case['top'])),
                exclusions_passed=excluded_ok, ranking_passed=ranking_ok,
                semantic_check_skipped=skipped,
                passed=excluded_ok and (skipped or ranking_ok)))
            report['comparison']['case_count'] += 1
            for source, ranked in (('semantic', ids), ('baseline', baseline_ids)):
                for cutoff in (1, 3):
                    report['comparison'][f'{source}_top{cutoff}_hits'] += int(bool(set(ranked[:cutoff]).intersection(case['top'])))
            report['timings_seconds']['matching'] += time.perf_counter() - phase
        if mode == 'live':
            report['boundaries'].update(embeddinggemma=True, firestore=storage_backend == 'firestore', semantic_quality_evaluated=True)
        report['passed'] = all(r['passed'] for r in report['extraction'] + report['matching']) and all(report['cache'].values())
    except Exception as exc:
        # Exception messages can contain endpoints or private service responses.
        report['failure'] = {'code': 'evaluation_unavailable_or_failed', 'exception_type': type(exc).__name__}
        report['passed'] = False
    finally:
        if mode == 'live' and embeddings is not None:
            report['boundaries']['embeddinggemma'] = embeddings.document_calls > 0 or embeddings.query_calls > 0
        if mode == 'live' and owned_refs:
            phase = time.perf_counter()
            report['cleanup']['attempted'] = True
            try:
                for kind, identity in owned_refs:
                    # Only exact run-owned vector refs; never canonical users/events.
                    store._ref(store.candidates if kind == 'candidate' else store.events, identity).delete()
                report['cleanup']['passed'] = True
            except Exception as exc:
                report['cleanup'].update(passed=False, exception_type=type(exc).__name__)
                report['passed'] = False
            report['timings_seconds']['cleanup'] += time.perf_counter() - phase
        report['timings_seconds']['total'] = time.perf_counter() - started
        output.parent.mkdir(parents=True, exist_ok=True)
        output.with_suffix('.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        output.write_text(render_report(report), encoding='utf-8')
    return report


def render_report(report):
    lines = ['# Generated fictional CV evaluation', '', f"Mode: **{report['mode']}**. Seed: `{report['seed']}`. Run: `{report['run_id']}`.",
             f"Required checks: **{'PASS' if report['passed'] else 'FAIL'}**.", '']
    if report['mode'] == 'offline':
        lines += ['**MOCKED INFERENCE**: PDF text is parsed, ground truth is injected by a test double, and vectors use lexical LocalHashingEmbeddings with ephemeral legacy Chroma. This is protocol/eligibility/cache validation, with no Gemma, Firestore or semantic quality claim.', '']
    lines += ['## Exercised boundaries', '', '```json', json.dumps(report['boundaries'], indent=2), '```', '',
              '## Extraction comparison', '', '| Profile | Language | Skills | Location | Status | Seniority |', '|---|---|---|---|---|---|']
    for result in report['extraction']:
        cells = [result['candidate_id'], result['language']]
        cells.extend('PASS' if result['fields'][key]['passed'] else 'FAIL' for key in ('skills', 'location', 'status', 'experience_level'))
        lines.append('| ' + ' | '.join(cells) + ' |')
    lines += ['', '## Matching and exclusions', '']
    for result in report['matching']:
        lines += [f"- {result['case']}: {'PASS' if result['passed'] else 'FAIL'}; expected top {result['rank_cutoff']} contains {result['expected_top_any']}; actual ranking {[r['candidate_id'] for r in result['actual']]}; exclusions {result['expected_exclusions']}; excluded correctly {result['exclusions_passed']}." ]
        if result['semantic_check_skipped']:
            lines.append('  Semantic ranking is observational only and excluded from offline pass criteria.')
        lines.append(f"  Structured baseline ranking: {[r['candidate_id'] for r in result.get('baseline_ranking', [])]}.")
    comparison = report.get('comparison', {})
    lines += ['', '## Semantic versus structured baseline', '', comparison.get('baseline', ''), '',
              '| Retriever | Top 1 hits | Top 3 hits | Labelled cases |', '|---|---|---|---|',
              f"| {'Semantic EmbeddingGemma' if report['mode'] == 'live' else 'Offline lexical hashing (observational)'} | {comparison.get('semantic_top1_hits', 0)} | {comparison.get('semantic_top3_hits', 0)} | {comparison.get('case_count', 0)} |",
              f"| Structured exact skill/tag overlap | {comparison.get('baseline_top1_hits', 0)} | {comparison.get('baseline_top3_hits', 0)} | {comparison.get('case_count', 0)} |", '',
              'Explicit eligibility violations: ' + json.dumps(comparison.get('eligibility_violations', [])), '',
              'Generation provenance: ' + json.dumps(report.get('generation_provenance', {})), '',
              'Per-phase seconds: ' + json.dumps(report.get('timings_seconds', {})), '',
              'Replay artifacts: ' + json.dumps(report.get('artifacts', {}))]
    lines += ['', 'Cache checks: ' + json.dumps(report['cache']), '', 'Cleanup: ' + json.dumps(report['cleanup']), '',
              'Limitations: ' + ' '.join(report['limitations']), '', 'Expected/actual field values and numeric scores are in the companion JSON.']
    if report.get('failure'):
        lines += ['', 'Failure: ' + json.dumps(report['failure']) + '. Requested live mode never falls back to mocks.']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['offline', 'live'], required=True)
    parser.add_argument('--seed', type=int, default=20261011)
    parser.add_argument('--embedding-backend', choices=['gemma', 'ollama-gemma'], default='gemma')
    parser.add_argument('--storage-backend', choices=['firestore', 'chroma'])
    parser.add_argument('--replay', type=Path, help='Replay normalized fictional records; no new generation inference')
    parser.add_argument('--report', type=Path, default=Path('.runtime/gemma-task3-evaluation-report.md'))
    args = parser.parse_args()
    report = run_evaluation(args.mode, args.seed, args.report, embedding_backend=args.embedding_backend,
                            storage_backend=args.storage_backend, replay_path=args.replay)
    print(f"Synthetic {args.mode} checks: {'PASS' if report['passed'] else 'FAIL'}; report: {args.report}")
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
