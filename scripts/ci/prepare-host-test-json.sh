#!/usr/bin/env bash
set -euo pipefail
jar="$RUNNER_TEMP/json-20250517.jar"
sha256=3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796
staged=$(mktemp "$RUNNER_TEMP/json-20250517.XXXXXX")
trap 'rm -f -- "$staged"' EXIT
verified=false
# Maven Central can rate-limit or transiently return 404 on one hostname.
# Both endpoints must deliver the same pinned bytes before anything is published.
for repository in https://repo.maven.apache.org/maven2 https://repo1.maven.org/maven2; do
  if curl --fail --location --retry 8 --retry-delay 15 --retry-max-time 300 --max-time 60 \
      "$repository/org/json/json/20250517/json-20250517.jar" --output "$staged" &&
      printf '%s  %s\n' "$sha256" "$staged" | sha256sum -c -; then
    mv -- "$staged" "$jar"
    verified=true
    break
  fi
done
if [ "$verified" != true ]; then
  echo 'Could not acquire the pinned host JSON dependency from Maven Central.' >&2
  exit 1
fi
echo "ALPHA_JSON_JAR=$jar" >> "$GITHUB_ENV"
# The upstream action-journal plugin tests (reference patches 0077-0078) read the upstream name.
echo "ELIZA_ORG_JSON_JAR=$jar" >> "$GITHUB_ENV"
