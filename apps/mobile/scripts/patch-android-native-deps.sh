#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${CLAWKET_MOBILE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

python3 - "$ROOT_DIR" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
repo_root = root.parent.parent


def dependency_file(relative_path: str) -> Path:
    candidates = [
        root / "node_modules" / relative_path,
        repo_root / "node_modules" / relative_path,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    searched = ", ".join(str(candidate) for candidate in candidates)
    raise SystemExit(f"Missing dependency Gradle file; searched: {searched}")

targets = [
    (
        dependency_file("@react-native-menu/menu/android/build.gradle"),
        """      // MenuViewManager
      if (getReactNativeMinorVersion() <= 75) {
        java.srcDirs += "src/reactNativeVersionPatch/MenuViewManager/75"
      } else {
        java.srcDirs += "src/reactNativeVersionPatch/MenuViewManager/latest"
      }
""",
        """      // MenuViewManager
      if (getReactNativeMinorVersion() <= 75) {
        java.srcDirs += "src/reactNativeVersionPatch/MenuViewManager/75"
      } else {
        java.srcDirs += "src/reactNativeVersionPatch/MenuViewManager/latest"
      }

      // Kotlin sources declared via java.srcDirs are skipped by recent AGP/KGP
      // combinations unless they are mirrored into kotlin.srcDirs as well.
      kotlin.srcDirs += java.srcDirs
""",
    ),
    (
        dependency_file("react-native-keyboard-controller/android/build.gradle"),
        """      if (project.ext.shouldUseBaseReactPackage()) {
        java.srcDirs += ['src/base']
      } else {
        java.srcDirs += ['src/turbo']
      }
""",
        """      if (project.ext.shouldUseBaseReactPackage()) {
        java.srcDirs += ['src/base']
      } else {
        java.srcDirs += ['src/turbo']
      }

      // Kotlin sources declared via java.srcDirs are skipped by recent AGP/KGP
      // combinations unless they are mirrored into kotlin.srcDirs as well.
      kotlin.srcDirs += java.srcDirs
""",
    ),
]

for path, needle, replacement in targets:
    text = path.read_text()
    if "kotlin.srcDirs += java.srcDirs" in text:
        continue
    if needle not in text:
        raise SystemExit(f"Unable to patch expected block in {path}")

    path.write_text(text.replace(needle, replacement))
    print(f"Patched Android native dependency Gradle file: {path}")
PY
