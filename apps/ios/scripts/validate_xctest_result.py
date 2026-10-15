"""Reject empty, malformed, skipped or failed native app test reports."""
import json
from pathlib import Path
import sys


def validate_summary(value, minimum_tests=5):
    if not isinstance(value, dict):
        raise ValueError("Native test summary must be an object")
    fields = ("totalTestCount", "passedTests", "failedTests", "skippedTests", "expectedFailures")
    if any(type(value.get(field)) is not int or value[field] < 0 for field in fields):
        raise ValueError("Native test counts are missing or malformed")
    total, passed, failed, skipped, expected = (value[field] for field in fields)
    if total < minimum_tests or passed != total or failed or skipped or expected:
        raise ValueError("Native app tests are empty, reduced, skipped or failing")
    if value.get("result") != "Passed":
        raise ValueError("Native test result is not Passed")
    return total


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Supply one xcresult summary JSON file")
        summary = json.loads(Path(sys.argv[1]).read_text())
        print(f"Verified {validate_summary(summary)} native application test cases")
    except (ValueError, OSError) as error:
        # Native files and errors can contain local paths; report fixed failure categories only.
        sys.exit("Native application test summary validation failed")
