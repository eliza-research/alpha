# #679: decide whether to install the "Main required checks" ruleset on main

Owner runbook for issue #679 (requirement MVP-46, `docs/human-actions.md` H-36). Prepared on
2026-10-28 by an agent that took only read-only actions (GET requests) with its existing access;
nothing in GitHub was changed. Installing a ruleset is the repository owner's action.

## Read-back on eliza-research/alphaphone (2026-10-28, read-only)

Command (GET requests only; `GH_BIN` is not used by this older script, so put a working `gh`
first on `PATH` on hosts where the shim hangs):

```sh
node scripts/ci/read-required-checks.mjs --repo eliza-research/alphaphone
```

Result, exit 1:

- No repository or organization ruleset applies to `main` (`GET repos/eliza-research/alphaphone/rulesets?includes_parents=true` returned `[]`,
  and `GET .../rules/branches/main` returned `[]`).
- Classic branch protection on `main` blocks force pushes and deletion only. `enforce_admins` is
  off, so repository admins bypass it. It requires no pull request, no review, no status check and
  no signatures.
- `DIFF MISSING` for all three required checks and `Ruleset "Main required checks" is not installed`.
- `develop` has no protection at all.

This differs from what H-36 and `docs/ci-cost-policy.md` describe. Those were written against
AlphaCompute/alphaphone, where the organization's "Require review before merge" ruleset applied.
That ruleset did not come with the move to eliza-research: on the new repository nothing requires
a pull request before a push to `main`. The organization is on the Free plan, so only
repository-level rulesets are available (they are supported on public repositories).

## The three required contexts match the current job names

Checked against `origin/main` at `94676c82` (read-only):

| Required context (`scripts/ci/required-checks-ruleset.json`) | Workflow / job on main | Reported on `94676c82` |
|---|---|---|
| `Repository verification` | `.github/workflows/browser.yml`, job `verify` | success, app `github-actions` (15368) |
| `Browser MVP result` | `.github/workflows/browser.yml`, job `result` (`if: always()`) | success, 15368 |
| `Android foundation result` | `.github/workflows/android.yml`, job `result` (`if: always()`) | success, 15368 |

Both workflows run on `pull_request` with no path filter, so every pull request reports all three
contexts and a required check can never stay "expected" forever. `test/ci-required-checks.test.mjs`
pins these names. One caveat: `Repository verification` is skipped when the change gate does not
select it, and GitHub treats a skipped required check as passing; `Browser MVP result` still fails
if a selected verification was skipped, so the pair is sound.

## Owner decision (2026-10-29): deferred

The owner decided: no branch protection for now. D1 is **B (defer)**; nothing is installed.
`node scripts/ci/read-required-checks.mjs --repo eliza-research/alphaphone` is expected to keep
exiting 1 with `DIFF MISSING` / `not installed` until the owner revisits this; that output is the
recorded state, not a failure to act on. Re-read on 2026-10-29 at `main` f4ebce3b: still no
ruleset, classic protection without required checks, and the three contexts still match
`browser.yml` jobs `verify`/`result` and `android.yml` job `result` (those workflows have not
changed since 94676c82). D2 and D3 are moot while deferred; the #658 shared-branch rulesets are
deferred by the same decision (see that runbook). The defer entry below is the one to copy, with
the trigger left for the owner to name.

## Decisions for the owner

### D1. Install "Main required checks" now, later, or not at all?

| Option | What it changes |
|---|---|
| A. Install now | Every merge to `main` waits for the three contexts. Agent pull requests can no longer be merged while CI is red or still running, including documentation-only pull requests (those finish quickly because the aggregates pass when their lanes are not selected). |
| B. Defer until a stated trigger (for example the pilot build, H-10, or the end of the MVP push) | Nothing changes now. `main` stays mergeable with failing CI, as the owner asked during the MVP push. MVP-46 stays open. |
| C. Do not install | Record that `main` is protected by review and post-merge CI only. MVP-46 is closed as "not adopted". |

Documented default: B. The owner asked not to block merges on CI during the MVP push (issue
text), and H-36 is marked "owner's choice". Recommendation: B with a named trigger, plus the
incident protections in D2 now, because those do not block merges on CI.

### D2. Coordinate with the incident ruleset (#658)

The incident runbook (`docs/runbooks/658-forged-commit-incident.md`) prepares
`scripts/owner/rulesets/shared-branch-integrity.json` (no force push, no deletion, signed commits
on `main` and `develop`) and an optional `scripts/owner/rulesets/default-branch-baseline.json`
(pull request required, squash only, zero approvals). They are separate rulesets with different
names, so installing one never edits the other and `read-required-checks.mjs` keeps working (it
lists other rulesets as `NOTE Other ruleset`).

| Option | What it changes |
|---|---|
| A. Install the incident ruleset now and this one later | Force pushes and unsigned direct pushes to `main` are blocked at once; CI stays advisory. |
| B. Install both together | One settings change; merges also wait for CI. |

Recommendation: A.

### D3. Bypass list

The committed ruleset has `"bypass_actors": []`. An empty list means nobody, including admins, can
merge past a failing check. Adding the repository admin role as a bypass actor (`actor_type:
RepositoryRole`, `actor_id: 5`, `bypass_mode: pull_request`) keeps an emergency path but lets an
admin merge red CI silently; `read-required-checks.mjs` reports any bypass actor as a difference.
Default: empty.

## Commands (prepared, not executed)

Install (owner, only after choosing D1 = A):

```sh
gh api --method POST repos/eliza-research/alphaphone/rulesets --input scripts/ci/required-checks-ruleset.json
```

Read back (read-only):

```sh
node scripts/ci/read-required-checks.mjs --repo eliza-research/alphaphone
gh api --method GET repos/eliza-research/alphaphone/rules/branches/main
```

`MATCH` from the read-back is configuration evidence only. MVP-46 also needs one controlled pull
request showing that a failing or missing check blocks the merge.

## Draft decision entries

Not added to `docs/decisions.md`; the owner (or the agent that maintains that file) copies the
chosen one with the next free `P-` number.

- P-xx (draft, defer; **owner decision 2026-10-29, as relayed in the agent task; confirm with the owner before copying**): "2026-10-29: The 'Main required checks' ruleset (MVP-46) is not installed on
  eliza-research/alphaphone yet. CI stays advisory on `main` until <trigger>. Shared-branch
  rulesets (#658) are also deferred; only classic protection (force push and deletion blocked,
  admins bypass) applies to `main`; `develop` is unprotected; shared branches are monitored with
  `node scripts/owner/forged-branch-scan.mjs`. Revisit at <trigger>."
- P-xx (draft, install): "2026-10-__: 'Main required checks' is installed on eliza-research/alphaphone
  with no bypass actors; `node scripts/ci/read-required-checks.mjs --repo eliza-research/alphaphone`
  reports MATCH; controlled blocking PR #___ recorded."
- P-xx (draft, decline): "2026-10-__: MVP-46 is not adopted. `main` relies on post-merge CI on push;
  the required-checks ruleset file stays in `scripts/ci/` for a later decision."

## Evidence to post on #679

Either the read-back output showing `MATCH` plus the controlled pull request link, or the dated
decision text above with the chosen trigger.
