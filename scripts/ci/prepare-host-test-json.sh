#!/usr/bin/env bash
set -euo pipefail
jar="$RUNNER_TEMP/json-20250517.jar"
# Maven Central rate-limits shared runners with 429s; wait out the window instead of failing CI.
curl --fail --location --retry 8 --retry-delay 15 --retry-max-time 300 --max-time 60 \
  https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar \
  --output "$jar"
echo "3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796  $jar" | sha256sum --check --strict
echo "ALPHA_JSON_JAR=$jar" >> "$GITHUB_ENV"
# The upstream action-journal plugin tests (reference patches 0077-0078) read the upstream name.
echo "ELIZA_ORG_JSON_JAR=$jar" >> "$GITHUB_ENV"
