import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cv_grounding import ground_cv, skill_name
from contracts import canonical_city
from extractors import normalize_cv_dict
from extractor import build_prompt

class GroundingTests(unittest.TestCase):
    def test_model_copied_skill_heading_becomes_individual_skills(self):
        actual=ground_cv({'skills':['Vestine: Biology, Microscopy']}, 'Vestine: Biology, Microscopy')
        self.assertEqual(actual['skills'],['Biology','Microscopy'])
        preserved=ground_cv({'skills':['AWS: EC2']}, 'Cloud infrastructure work')
        self.assertEqual(preserved['skills'],['AWS: EC2'])
    def test_serbian_explicit_city_repairs_model_omission(self):
        for city in ['Beograd','Novi Sad','Niš','Kragujevac']:
            raw={'location':None,'skills':[],'education':[],'experience_level':'senior'}
            actual=ground_cv(raw, 'Grad: '+city+'\nNivo iskustva: junior\nVeštine: Python, SQL')
            self.assertEqual(actual['location'],city)
            self.assertEqual(actual['experience_level'],'junior')
            self.assertEqual(actual['skills'],['Python','SQL'])
        self.assertEqual(canonical_city('Beograd'),canonical_city('Belgrade'))
        self.assertEqual(canonical_city('Niš'),canonical_city('Nis'))
    def test_cyrillic_and_translated_science_skills_are_grounded(self):
        actual=ground_cv({'skills':['Microscopy']}, 'Град: Ниш\nВештине: Биологија, Микроскопија\nНиво искуства: senior')
        self.assertEqual(actual['skills'],['Microscopy','Biology'])
        self.assertEqual(actual['location'],'Ниш')
        self.assertEqual(skill_name('mašinsko učenje'),'Machine Learning')
    def test_unknown_seniority_is_not_inferred_from_projects_or_student(self):
        actual=ground_cv({'experience_level':'Senior','skills':['Python']},'Skills: Python\nTen years of projects. Student status. Seniority unspecified.')
        self.assertIsNone(actual['experience_level'])
    def test_null_strings_are_missing_not_school_or_level(self):
        actual=normalize_cv_dict({'experience_level':'null','education':[{'institution':'null'}],'location':'unknown','skills':['null','Biologija']},'person','test')
        self.assertIsNone(actual['experience_level'])
        self.assertIsNone(actual['location'])
        self.assertEqual(actual['education'],[])
        self.assertEqual(actual['skills'],['Biology'])
    def test_unstated_skill_is_never_recovered_from_city_or_title(self):
        actual=ground_cv({'skills':[]},'Grad: Novi Sad\nCurrent role: Biology enthusiast\nProjects about cells')
        self.assertEqual(actual['skills'],[])
    def test_source_text_normalization_recovers_complete_explicit_list(self):
        actual=normalize_cv_dict({'skills':['Microscopy'],'location':None,'cv_text':'Grad: Nis\nVestine: Biology, Microscopy\nNivo iskustva: senior'},'person','test')
        self.assertEqual(actual['skills'],['Microscopy','Biology'])
        self.assertEqual(actual['location'],'Nis')
    def test_prompt_requires_grounded_fields(self):
        prompt=build_prompt('Skills: Python\nGrad: Novi Sad')
        self.assertIn('never infer seniority',prompt)
        self.assertIn('Nivo iskustva',prompt)

if __name__=='__main__': unittest.main()
