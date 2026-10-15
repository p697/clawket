"""Verify the real app contains the catalog values, not just source coverage."""

import json
import plistlib
import sys
from pathlib import Path


def expected_values(catalog, locales):
    if not isinstance(catalog, dict) or not isinstance(catalog.get("strings"), dict) or not catalog["strings"]:
        raise ValueError("Missing, malformed or empty string catalog")
    if not locales or len(set(locales)) != len(locales) or any(not isinstance(locale, str) or not locale for locale in locales):
        raise ValueError("Missing, malformed or duplicate locale scope")
    result = {locale: {} for locale in locales}
    for key, entry in catalog["strings"].items():
        if not isinstance(key, str) or not key or not isinstance(entry, dict):
            raise ValueError("Invalid catalog entry")
        localizations = entry.get("localizations", {})
        if not isinstance(localizations, dict):
            raise ValueError("Invalid catalog localizations")
        for locale in locales:
            localization = localizations.get(locale, {})
            if not isinstance(localization, dict) or set(localization) != {"stringUnit"}:
                raise ValueError(f"{key}/{locale}: resource validation requires a direct string unit")
            unit = localization["stringUnit"]
            if not isinstance(unit, dict) or unit.get("state") != "translated" or not isinstance(unit.get("value"), str) or not unit["value"].strip():
                raise ValueError(f"{key}/{locale}: missing actual translated value")
            result[locale][key] = unit["value"]
    return result


def validate_resources(bundle, catalogs, locales):
    """Fail on missing/changed compiled tables, including permission source drift."""
    bundle = Path(bundle)
    if not bundle.is_dir() or not isinstance(catalogs, dict) or set(catalogs) != {"Localizable", "InfoPlist"}:
        raise ValueError("Expected an existing app bundle and both native catalogs")
    expected = {table: expected_values(catalog, locales) for table, catalog in catalogs.items()}
    if "en" not in locales:
        raise ValueError("Permission source validation requires English")
    issues = []
    for table, translations in expected.items():
        for locale, values in translations.items():
            resource = bundle / f"{locale}.lproj" / f"{table}.strings"
            try:
                with resource.open("rb") as source:
                    actual = plistlib.load(source)
                if not isinstance(actual, dict) or not actual:
                    raise ValueError("Empty or malformed compiled table")
            except (OSError, ValueError, plistlib.InvalidFileException):
                issues.append(f"{locale}/{table}: missing or malformed compiled table")
                continue
            for key, value in values.items():
                if actual.get(key) != value:
                    issues.append(f"{locale}/{table}: missing or different value for {key}")
    try:
        with (bundle / "Info.plist").open("rb") as source:
            info = plistlib.load(source)
        if not isinstance(info, dict):
            raise ValueError("Malformed app metadata")
        for key, value in expected["InfoPlist"]["en"].items():
            if info.get(key) != value:
                issues.append(f"Info.plist: source differs from catalog for {key}")
    except (OSError, ValueError, plistlib.InvalidFileException):
        issues.append("Info.plist: missing or malformed app metadata")
    if issues:
        raise ValueError("\n".join(issues))
    return {
        "locale_count": len(locales),
        "table_count": len(catalogs),
        "value_count": sum(len(values) for translations in expected.values() for values in translations.values()),
    }


def main():
    if len(sys.argv) != 2:
        raise ValueError("Usage: python3 scripts/native-ios/localization_resources.py /path/to/Clawket.app")
    root = Path(__file__).resolve().parents[2]
    inventory = json.loads((root / "docs/native-ios/localization-inventory.json").read_text())
    catalogs = {
        table: json.loads((root / f"apps/ios/Clawket/{table}.xcstrings").read_text())
        for table in ("Localizable", "InfoPlist")
    }
    report = validate_resources(sys.argv[1], catalogs, inventory["locales"])
    print(f"Compiled native localization: {report['locale_count']} locales, {report['table_count']} tables, {report['value_count']} exact translated values; permission sources match")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
