import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class IdentityContractTests(unittest.TestCase):
    def test_account_ids_are_preserved_and_invalid_ids_rejected(self):
        from contracts import validate_id
        self.assertEqual(validate_id("uid_ABC-123"), "uid_ABC-123")
        for value in ("uploads/cv", "", "a" * 129, " Иван ", "abc.def"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_id(value)

    def test_dataset_files_do_not_share_account_or_filename_identity(self):
        from contracts import dataset_id_for
        paths = [Path("one/uploads/CV.pdf"), Path("two/uploads/CV.pdf"),
                 Path("uploads/Иван.pdf"), Path("uploads/Милан.pdf")]
        ids = [dataset_id_for(path) for path in paths]
        self.assertEqual(len(set(ids)), len(paths))
        self.assertEqual(dataset_id_for(paths[0]), ids[0])
        self.assertNotEqual(dataset_id_for(paths[0], 1), dataset_id_for(paths[0], 2))
        for identity in ids:
            self.assertRegex(identity, r"^dataset-[a-f0-9]{64}$")

    def test_serbian_city_aliases_cyrillic_and_diacritics_match(self):
        from contracts import canonical_city
        self.assertEqual({canonical_city(s) for s in ["Београд", "Beograd", "Belgrade, Serbia"]}, {"belgrade"})
        self.assertEqual(canonical_city("Ниш"), canonical_city("Niš, Serbia"))
        self.assertEqual(canonical_city(None), "unknown")


if __name__ == "__main__":
    unittest.main()
