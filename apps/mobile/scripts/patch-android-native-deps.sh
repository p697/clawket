#!/usr/bin/env bash
set -euo pipefail
exec node "$(dirname "$0")/patch-android-native-deps.mjs"
