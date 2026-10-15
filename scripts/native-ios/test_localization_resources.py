import copy
import plistlib
import tempfile
import unittest
from pathlib import Path

from localization_resources import expected_values, validate_resources


class CompiledLocalizationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.bundle = Path(self.directory.name) / "Clawket.app"
        self.bundle.mkdir()
        self.locales = ["en", "ar"]
        self.catalogs = {}
        for table, key, values in [
            ("Localizable", "Message %@", ["Message %@", "مراسلة %@"]),
            ("InfoPlist", "NSCameraUsageDescription", ["Scan a pairing QR code.", "امسح رمز QR للاقتران."]),
        ]:
            self.catalogs[table] = {"strings": {key: {"localizations": {
                locale: {"stringUnit": {"state": "translated", "value": value}}
                for locale, value in zip(self.locales, values)
            }}}}
            for locale, value in zip(self.locales, values):
                folder = self.bundle / f"{locale}.lproj"
                folder.mkdir(exist_ok=True)
                self.write_plist(folder / f"{table}.strings", {key: value})
        self.write_plist(self.bundle / "Info.plist", {"NSCameraUsageDescription": "Scan a pairing QR code."})

    @staticmethod
    def write_plist(path, value):
        with path.open("wb") as output:
            plistlib.dump(value, output, fmt=plistlib.FMT_BINARY)

    def test_compiled_unicode_values_and_both_tables(self):
        self.assertEqual(validate_resources(self.bundle, self.catalogs, self.locales), {
            "locale_count": 2, "table_count": 2, "value_count": 4,
        })

    def test_missing_resource_and_changed_permission_source_fail(self):
        (self.bundle / "ar.lproj/InfoPlist.strings").unlink()
        self.write_plist(self.bundle / "Info.plist", {"NSCameraUsageDescription": "Different purpose."})
        with self.assertRaisesRegex(ValueError, "ar/InfoPlist: missing.*\\nInfo.plist: source differs"):
            validate_resources(self.bundle, self.catalogs, self.locales)

    def test_different_empty_and_malformed_compiled_tables_fail(self):
        self.write_plist(self.bundle / "ar.lproj/Localizable.strings", {"Message %@": "English placeholder"})
        self.write_plist(self.bundle / "en.lproj/InfoPlist.strings", {})
        (self.bundle / "ar.lproj/InfoPlist.strings").write_text("not a property list")
        with self.assertRaises(ValueError) as caught:
            validate_resources(self.bundle, self.catalogs, self.locales)
        self.assertIn("ar/Localizable: missing or different value", str(caught.exception))
        self.assertIn("en/InfoPlist: missing or malformed", str(caught.exception))
        self.assertIn("ar/InfoPlist: missing or malformed", str(caught.exception))

    def test_missing_catalog_empty_scope_and_unsupported_variants_fail(self):
        for catalogs, locales in [({}, self.locales), (self.catalogs, []), (self.catalogs, ["en", "en"])]:
            with self.assertRaises(ValueError):
                validate_resources(self.bundle, catalogs, locales)
        malformed = copy.deepcopy(self.catalogs["Localizable"])
        malformed["strings"]["Message %@"]["localizations"]["ar"] = {"variations": {"plural": {}}}
        with self.assertRaisesRegex(ValueError, "direct string unit"):
            expected_values(malformed, self.locales)
        with self.assertRaises(ValueError):
            expected_values({"strings": {}}, self.locales)


if __name__ == "__main__":
    unittest.main()
