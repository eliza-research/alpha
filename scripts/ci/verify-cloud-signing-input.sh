#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$GITHUB_REF" = refs/heads/main
test "$GITHUB_REPOSITORY" = alphacompute/alpha
test "$GITHUB_REPOSITORY_ID" = 1396333361
test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
directory=$(mktemp -d "$RUNNER_TEMP/alpha-cloud-input.XXXXXX")
printf '%s' "$SIGNING_PLAN" > "$directory/pins.json"
unset SIGNING_PLAN
source=$(jq -er '.alphaCommit | select(type == "string" and test("^[0-9a-f]{40}$"))' "$directory/pins.json")
kind=$(python3 -B scripts/ci/app_update_producer.py kind "$directory/pins.json")
gh api "repos/$GITHUB_REPOSITORY/compare/$source...$GITHUB_SHA" > "$directory/source-comparison.json"
if ! jq -e --arg source "$source" '
    (.status == "ahead" or .status == "identical") and
    .merge_base_commit.sha == $source' "$directory/source-comparison.json" >/dev/null; then
  # A qualified private release can be pinned independently of the moving main branch.
  # The reviewed main commit must authorize these exact source and artifact bytes.
  test "$kind" = root-reviewed-private-runner
  python3 -B - "$directory/pins.json" <<'PY'
import json, runpy, sys
from pathlib import Path
sys.path.insert(0, str(Path('scripts/ci').resolve()))
admission = runpy.run_path('scripts/ci/admit-cloud-signing-input.py')
plan = json.loads(Path(sys.argv[1]).read_text())
descriptor = json.loads(Path('android/release-signer.json').read_text())
admission['require'](admission['reviewed_private_producer'](plan, descriptor),
                     'Unreviewed private producer source')
PY
fi
if [[ "$kind" == github-main-candidate ]]; then
  python3 -B scripts/ci/private-apk-storage.py validate "$directory/pins.json"
  python3 -B scripts/ci/app_update_producer.py github "$directory/pins.json"
  # Preflight reads the official immutable artifact. Protected staging reads
  # the same digest from the exact reviewed private generation.
  if [[ "${1:-}" == --stage ]]; then
    unset GH_TOKEN
    python3 -B scripts/ci/private-apk-storage.py download "$directory/pins.json" "$directory/producer.zip"
  else
    python3 -B scripts/ci/app_update_producer.py download "$directory/pins.json" "$directory/producer.zip"
    unset GH_TOKEN
  fi
  python3 -B scripts/ci/admit-cloud-signing-input.py "$directory/producer.zip" "$directory/pins.json" "$@"
elif [[ "$kind" == root-reviewed-private-runner ]]; then
  python3 -B scripts/ci/private-apk-storage.py validate "$directory/pins.json"
  # The unprotected job validates the plan only. The protected job repeats this
  # and checks actual archive bytes before the step referencing signing secrets.
  if [[ "${1:-}" == --stage ]]; then
    python3 -B scripts/ci/private-apk-storage.py download "$directory/pins.json" "$directory/producer.zip"
    python3 -B scripts/ci/admit-cloud-signing-input.py "$directory/producer.zip" "$directory/pins.json" "$@"
  fi
else
run=$(jq -er '.producerRunId | select(type == "string" and test("^[1-9][0-9]{0,15}$"))' "$directory/pins.json")
artifact=$(jq -er '.artifactId | select(type == "string" and test("^[1-9][0-9]{0,15}$"))' "$directory/pins.json")
size=$(jq -er '.archiveBytes | select(type == "number" and floor == . and . > 0 and . <= 1500000000)' "$directory/pins.json")
digest=$(jq -er '.archiveSHA256 | select(type == "string" and test("^[0-9a-f]{64}$"))' "$directory/pins.json")
gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run" |
  jq -e --arg source "$source" --arg repo "$GITHUB_REPOSITORY" \
    --argjson repo_id "$GITHUB_REPOSITORY_ID" '
    .status == "completed" and .conclusion == "success" and
    .head_sha == $source and .head_repository.full_name == $repo and
    .head_repository.id == $repo_id and
    .path == ".github/workflows/resident-android.yml" and
    .event == "workflow_dispatch"' >/dev/null
gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact" |
  jq -e --arg source "$source" --arg run "$run" --arg digest "sha256:$digest" --argjson size "$size" '
    .expired == false and (.workflow_run.id | tostring) == $run and
    .workflow_run.head_sha == $source and .digest == $digest and
    .size_in_bytes == $size and
    .name == ("resident-distribution-archive-" + $source + "-" + $run)' >/dev/null
python3 -B scripts/ci/app_update_producer.py download "$directory/pins.json" "$directory/producer.zip"
unset GH_TOKEN
test "$(wc -c < "$directory/producer.zip")" -eq "$size"
python3 -B scripts/ci/admit-cloud-signing-input.py "$directory/producer.zip" "$directory/pins.json" "$@"
fi
plan_sha=$(sha256sum "$directory/pins.json" | cut -d ' ' -f 1)
echo "plan_sha256=$plan_sha" >> "$GITHUB_OUTPUT"
