import unittest
from validate_xctest_result import validate_summary


class NativeResultTests(unittest.TestCase):
    def setUp(self):
        self.valid = {"result": "Passed", "totalTestCount": 305, "passedTests": 305,
                      "failedTests": 0, "skippedTests": 0, "expectedFailures": 0}

    def test_complete_report(self):
        self.assertEqual(validate_summary(self.valid), 305)

    def test_rejects_missing_corrupt_counts_and_wrong_type(self):
        for field in ("totalTestCount", "passedTests", "failedTests", "skippedTests", "expectedFailures"):
            for corrupt in (None, "4", True, -1):
                with self.subTest(field=field, value=corrupt), self.assertRaises(ValueError):
                    validate_summary({**self.valid, field: corrupt})
        for corrupt in (None, [], "Passed"):
            with self.assertRaises(ValueError):
                validate_summary(corrupt)

    def test_rejects_empty_reduced_skipped_and_failed_reports(self):
        for total in (0, 1, 10, 28, 40, 44, 47, 49, 50, 57, 59, 60, 62, 63, 71, 72, 73, 75, 76, 80, 81, 86, 87, 91, 92, 95, 96, 101, 111, 112, 126, 127, 136, 137, 141, 142, 143, 144, 145, 146, 157, 158, 159, 160, 161, 170, 171, 191, 192, 193, 202, 203, 205, 206, 215, 216, 218, 219, 220, 221, 222, 223, 229, 233, 239, 257, 258, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 274, 286, 289, 293):
            with self.assertRaises(ValueError):
                validate_summary({**self.valid, "totalTestCount": total, "passedTests": total})
        for field in ("failedTests", "skippedTests", "expectedFailures"):
            with self.assertRaises(ValueError):
                validate_summary({**self.valid, field: 1, "passedTests": 3})
        with self.assertRaises(ValueError):
            validate_summary({**self.valid, "totalTestCount": 304, "passedTests": 304})
        with self.assertRaises(ValueError):
            validate_summary({**self.valid, "totalTestCount": 302, "passedTests": 302})
        with self.assertRaises(ValueError):
            validate_summary({**self.valid, "totalTestCount": 299, "passedTests": 299})
        with self.assertRaises(ValueError):
            validate_summary({**self.valid, "result": "Failed"})


if __name__ == "__main__":
    unittest.main()
