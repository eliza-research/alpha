#!/usr/bin/env bash
# Installs a Playwright browser and its system packages, retrying transient apt/CDN failures
# (e.g. "Temporary failure resolving azure.archive.ubuntu.com") instead of failing the job.
set -euo pipefail
browser="${1:?browser name required}"
for attempt in 1 2 3; do
  if bunx playwright install --with-deps "$browser"; then exit 0; fi
  if [ "$attempt" -lt 3 ]; then
    echo "Playwright install attempt $attempt failed; retrying in $((attempt * 30))s" >&2
    sleep $((attempt * 30))
  fi
done
echo "Playwright install failed after 3 attempts" >&2
exit 1
