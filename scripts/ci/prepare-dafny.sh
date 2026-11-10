#!/usr/bin/env bash
set -euo pipefail
dafny_directory="${RUNNER_TEMP:?}/alpha-dafny-4.11.0"
archive_path="$dafny_directory.zip"
curl --fail --location --silent --show-error \
  https://github.com/dafny-lang/dafny/releases/download/v4.11.0/dafny-4.11.0-x64-ubuntu-22.04.zip \
  --output "$archive_path"
printf '%s  %s\n' a46a9ff7cdd720f7955854c78e95df13f4cfe6b80691b05f8654fe19e8267179 "$archive_path" | sha256sum --check --status
mkdir -p "$dafny_directory"
unzip -q "$archive_path" -d "$dafny_directory"
dafny_version="$("$dafny_directory/dafny/dafny" --version)"
[[ "$dafny_version" =~ ^4\.11\.0(\+[0-9a-f]{40})?$ ]]
printf '%s\n' "$dafny_directory/dafny" >> "${GITHUB_PATH:?}"
