"""Add required Firestore vector indexes without deleting existing indexes.

Preview: python scripts/prepare-gemma-indexes.py
Deploy:  python scripts/prepare-gemma-indexes.py --apply
Credentials need roles/datastore.indexAdmin only for index administration.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'extractor_cv'))
from firestore_vector_store import vector_index_config

def configs():
    result = [vector_index_config(collection_group='eventEmbeddings')]
    result += [vector_index_config(filter_fields=fields) for fields in [
        (), ('city',), ('seniority_level',), ('city','seniority_level'),
        ('birth_year',), ('city','birth_year'), ('seniority_level','birth_year'),
        ('city','seniority_level','birth_year'),
    ]]
    return result

def matches_index(entry, row):
    def signature(fields):
        return [(f['fieldPath'], f.get('order'), json.dumps(f.get('vectorConfig'), sort_keys=True))
                for f in fields if f['fieldPath'] != '__name__']
    return (f"/collectionGroups/{entry['collectionGroup']}/indexes/" in row.get('name', '')
            and row.get('queryScope') == entry['queryScope']
            and signature(row['fields']) == signature(entry['fields']))

def list_indexes(session, endpoint):
    rows, token = [], None
    while True:
        # Firestore Admin currently accepts only its default (zero) page size.
        params = {}
        if token:
            params['pageToken'] = token
        response = session.get(endpoint, params=params, timeout=20)
        response.raise_for_status()
        payload = response.json()
        rows.extend(payload.get('indexes', []))
        token = payload.get('nextPageToken')
        if not token:
            return rows

def deploy(project, entries):
    import google.auth
    from google.auth.transport.requests import AuthorizedSession
    credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/datastore'])
    session = AuthorizedSession(credentials)
    base = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/collectionGroups'
    for entry in entries:
        endpoint = f"{base}/{entry['collectionGroup']}/indexes"
        found = next((row for row in list_indexes(session, endpoint)
                      if matches_index(entry, row)), None)
        if found:
            print(entry['collectionGroup'], 'existing:', found.get('state'))
            continue
        response = session.post(endpoint, json={'queryScope':'COLLECTION','fields':entry['fields']}, timeout=20)
        if response.status_code == 403:
            raise SystemExit('Index deployment requires roles/datastore.indexAdmin on this Google Cloud project.')
        response.raise_for_status()
        print(entry['collectionGroup'], 'creation requested:', response.json().get('name'))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--project', default=os.environ.get('FIREBASE_PROJECT_ID'))
    args = parser.parse_args()
    if args.apply:
        if not args.project:
            parser.error('Set FIREBASE_PROJECT_ID or --project.')
        deploy(args.project, configs())
    else:
        print(json.dumps({'indexes':configs()}, indent=2))
