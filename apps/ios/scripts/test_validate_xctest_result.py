import unittest
from validate_xctest_result import validate_summary


class NativeResultTests(unittest.TestCase):
    def setUp(self):
        self.valid = {"result": "Passed", "totalTestCount": 28, "passedTests": 28,
                      "failedTests": 0, "skippedTests": 0, "expectedFailures": 0}

    def test_complete_report(self):
        self.assertEqual(validate_summary(self.valid), 28)

    def test_rejects_missing_corrupt_counts_and_wrong_type(self):
        for field in ("totalTestCount", "passedTests", "failedTests", "skippedTests", "expectedFailures"):
            for corrupt in (None, "4", True, -1):
                with self.subTest(field=field, value=corrupt), self.assertRaises(ValueError):
                    validate_summary({**self.valid, field: corrupt})
        for corrupt in (None, [], "Passed"):
            with self.assertRaises(ValueError):
                validate_summary(corrupt)

    def test_rejects_empty_reduced_skipped_and_failed_reports(self):
        for total in (0, 1, 10, 18, 27):
            with self.assertRaises(ValueError):
                validate_summary({**self.valid, "totalTestCount": total, "passedTests": total})
        for field in ("failedTests", "skippedTests", "expectedFailures"):
            with self.assertRaises(ValueError):
                validate_summary({**self.valid, field: 1, "passedTests": 3})
        with self.assertRaises(ValueError):
            validate_summary({**self.valid, "result": "Failed"})


if __name__ == "__main__":
    unittest.main()
