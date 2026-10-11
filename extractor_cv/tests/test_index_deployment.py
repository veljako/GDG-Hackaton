import importlib.util
import unittest
from unittest.mock import Mock
from pathlib import Path
path=Path(__file__).resolve().parents[2]/'scripts'/'prepare-gemma-indexes.py'
spec=importlib.util.spec_from_file_location('prepare_indexes',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class IndexDeploymentTests(unittest.TestCase):
    def test_paginated_index_listing_checks_later_pages(self):
        first,second=Mock(),Mock()
        first.json.return_value={'indexes':[{'name':'first'}],'nextPageToken':'next'}
        second.json.return_value={'indexes':[{'name':'second'}]}
        session=Mock();session.get.side_effect=[first,second]
        self.assertEqual(module.list_indexes(session,'endpoint'),[{'name':'first'},{'name':'second'}])
        self.assertEqual(session.get.call_args.kwargs['params']['pageToken'],'next')
    def test_identical_event_index_cannot_satisfy_user_collection(self):
        expected=module.configs()[1]
        row={'name':'projects/p/databases/(default)/collectionGroups/eventEmbeddings/indexes/id','queryScope':'COLLECTION','fields':expected['fields']}
        self.assertFalse(module.matches_index(expected,row))
        row['name']=row['name'].replace('eventEmbeddings','userEmbeddings')
        row['fields']=[*expected['fields'][:-1],{'fieldPath':'__name__','order':'ASCENDING'},expected['fields'][-1]]
        self.assertTrue(module.matches_index(expected,row))
        row['queryScope']='COLLECTION_GROUP'
        self.assertFalse(module.matches_index(expected,row))

if __name__=='__main__':unittest.main()
