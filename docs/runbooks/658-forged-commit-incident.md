# #658: respond to the 2026-10-27 forged-commit incident

Owner runbook for issue #658. Prepared on 2026-10-28 by an agent that took only read-only actions
(GET requests and git reads) with its existing access: member, not admin, of AlphaCompute, and
admin of eliza-research/alphaphone. Nothing was rotated, revoked, removed or installed. Every script below only reads (`gh api --method GET`, `git
ls-remote`, `git ls-tree`, `git show`); none prints a secret value, and the GitHub API never
returns one.

Evidence classes: everything here is GitHub configuration and history read through the API or
from git objects. None of it proves that a machine is clean, that a credential was not used, or
that a rotation happened; those need the human steps below.

## Prepared files

| File | Purpose |
|---|---|
| `scripts/owner/incident-2026-10-27-iocs.json` | The 102 forged branches (pre-attack and forged SHA prefixes), the 18 repositories with CI runs on forged commits, the attack window, and the marker patterns. Transcribed from the owner's private cleanup record, which is held off-repo and is not in this repository, so the transcription cannot be checked from here; the owner can compare it with that record. |
| `scripts/owner/incident-ci-exposure.mjs` | Lists workflow runs whose head SHA is a forged commit, and the secret, variable and environment NAMES per repository with `updated_at` and `NOT-ROTATED-YET` / `UPDATED-AFTER-INCIDENT`. |
| `scripts/owner/incident-access-audit.mjs` | Per repository: the actor's effective permission, outside collaborators, pending invitations, deploy keys (no key material) and webhooks (host only). Per organization: membership, outside-collaborator and invitation state of the actor, GitHub App installations, and audit-log event counts for the actor since 2026-10-21. |
| `scripts/owner/forged-branch-scan.mjs` | Scans every current branch and tag of a remote, without a checkout, for ancestry to a forged commit, marker paths, `node init` script hooks and loader patterns. |
| `scripts/owner/read-branch-integrity.mjs` | Reads back which ruleset or classic protection blocks force push, deletion and unsigned commits on `main` and `develop`. |
| `scripts/owner/rulesets/shared-branch-integrity.json` | Repository ruleset draft for eliza-research/alphaphone: no deletion, no force push, signed commits on `~DEFAULT_BRANCH` and `develop`. |
| `scripts/owner/rulesets/default-branch-baseline.json` | Optional repository ruleset draft restoring "pull request required" on `main` (squash only, zero approvals). |
| `scripts/owner/rulesets/alphacompute-org-shared-branch-integrity.json` | AlphaCompute organization ruleset draft (Enterprise): the same three rules on default, `develop`, `dev`, `staging`, `next` and `enterprise` in every repository, starting in `evaluate` mode. |
| `test/owner-incident-response.test.mjs` | Offline tests for the scripts (injected GitHub reads, a throwaway git repository for the scan) and a check that the scripts contain no write method. |

`GH_BIN=/path/to/gh` selects the gh binary for the `scripts/owner/` scripts. Each exits 0 when
the state is as expected, 1 when it found something, 2 when it could not read something (usually
missing admin rights or the `admin:org` token scope).

## Read-only findings (2026-10-28)

### eliza-research/alphaphone

- **Pending invitation for the attacker account.** `GET repos/eliza-research/alphaphone/invitations`
  lists an unexpired invitation for `gabrielbarbera`, permission `read`, created after the attack.
  Read on a public repository grants little, but accepting it would make the account a collaborator
  again. Cancel it (step 2). Who created it is in the owner's private incident record.
- **CI runs on forged commits: 6, matching the record.** All `pull_request`, all started by
  `gabrielbarbera` at 22:49 UTC: runs 40597671432, 40597671433, 40597671452 (forged `39ef59401`,
  `codex/merge-build-latest-20261026`) and 40597689749, 40597689787, 40597689789 (forged
  `61d293f61`, `codex/alpha-reviewed-release-join-20261027`).
  - The forged commits did not change `.github/`; the workflows that ran were the reviewed ones,
    with `permissions: contents: read`.
  - In the Browser MVP and Android foundation runs every job that would build failed at `npm ci`,
    before `npm run build` (which the forged `package.json` had prefixed with `node init`) and
    before anything loaded `capacitor.config.ts` (which the forged commits turned into a remote
    `eval` loader). The two Resident source preparation runs succeeded but run only
    `npm run agent:prepare` and checks that the forged commits did not hook. This is an inference
    from job step results, not proof the payload never ran.
  - The repository now has no repository Actions secrets, variables, Dependabot secrets or
    organization secrets, and one environment, `release` (required reviewers and a branch policy),
    with no secrets. At the time of the runs the repository was still in AlphaCompute, so
    AlphaCompute organization secrets shared with alphaphone then would have been available to
    those `pull_request` runs. Check that list in AlphaCompute (step 1).
- **The forged commits are still served by SHA.** `GET repos/eliza-research/alphaphone/commits/39ef59401`
  (and the other four) still returns the commit. No branch or tag reaches them, but anyone can
  fetch the payload from this public repository by SHA until GitHub garbage-collects it. Ask GitHub
  Support to purge the unreachable objects (step 6).
- **Branch scan: clean.** `node scripts/owner/forged-branch-scan.mjs` against
  `https://github.com/eliza-research/alphaphone.git`: 138 refs (branches and tags), all scanned,
  0 flagged; all five forged commits were present locally for the ancestry check. The same scan
  flags the forged commit itself (ancestry, `init`, `.env`, `.vscode/tasks.json` with `folderOpen`,
  the `.orc` payload, seven `node init` script hooks and the `capacitor.config.ts` loader).
- **Branch protection.** No ruleset applies. `main` has classic protection that blocks force
  push and deletion with `enforce_admins` off (admins bypass it); no signatures, pull request or
  review requirement. `develop` has no protection. All 15 most recent `main` commits are
  GitHub-signed squash merges, so requiring signatures on `main` does not change the current merge
  flow. `develop` was last pushed on 2026-10-13 and contains unsigned commits; the rule applies only
  to new pushes.
- **Organization.** eliza-research is on the Free plan, two-factor authentication is not required
  for members, and members can create repositories. One GitHub App, `slopdotcash`, is installed on
  selected repositories (installed 2026-10-21, updated 2026-10-27; contents read, issues and pull
  requests write). Confirm it is expected. The organization audit log API is not available on the
  Free plan (404).
- **Forks.** `elizaOS/alphaphone` and `dorucioclea/alphaphone` were last pushed on 2026-10-18,
  before the attack.

### AlphaCompute repositories (member access only)

- `gabrielbarbera` is not an AlphaCompute member and has no permission on any of the 25
  AlphaCompute repositories listed in the IOC file (`none`, or only the public `read` every
  account has on the 7 public ones). Organization outside collaborators and invitations, GitHub
  App installations and the audit log need an organization owner's token with `admin:org`, and
  webhooks need `admin:repo_hook`; without them those reads are reported as `UNREADABLE`.
- Workflow runs found by head SHA differ from the run counts in the IOC file for most repositories
  (often exactly half); the record may have counted runs twice. The script prints both numbers.
- Repository outside-collaborator lists were readable and empty for all 25 repositories.
  Repository invitations, deploy keys and webhooks were not readable (repository admin and
  `admin:repo_hook` needed).
- The per-repository secret, variable and environment snapshot (counts and rotation state) is not
  published here: this repository is public, and which credentials are still unrotated, or which
  repositories hold cloud-role variables, would help anyone holding stolen values. It is in the
  owner's private incident record. Re-create it at any time with `incident-ci-exposure.mjs`.
- `incident-ci-exposure.mjs` lists names only. Variables are shown as `VARIABLE` (not secret)
  because some name cloud roles used through OIDC, which a `pull_request` run could have assumed.
  Check those roles' trust policies.

## Per-repository rotation checklist (step 1)

For each repository: run `GH_BIN=... node scripts/owner/incident-ci-exposure.mjs --repo <owner/name>`
with an admin token, rotate every listed secret at its issuer (not only in GitHub), update the
GitHub secret, and re-run until every row shows `UPDATED-AFTER-INCIDENT`. Also rotate organization
secrets the repository could read, cloud credentials those secrets granted, and any role an OIDC
`pull_request` subject could assume.

Record progress privately (a private issue, the owner's incident record, or a private copy of
this table), never in this public repository: a filled-in table tells an attacker which stolen
credentials are probably still valid. "Secrets" counts repository, Dependabot and environment
secrets; "not rotated" means `updated_at` is before 2026-10-27 23:36 UTC. Repository secrets were
available to same-repository `pull_request` runs; environment secrets only to jobs that named that
environment and passed its protection rules. The repositories with CI runs on forged commits are
listed in `scripts/owner/incident-2026-10-27-iocs.json`.

| Repository | Runs (record) | Runs found by SHA | Secrets | Not rotated | Variables | Environments | Cloud-role variables (OIDC trust checked) | Rotated on | By |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

For eliza-research/alphaphone, which was AlphaCompute/alphaphone at the time of the runs, also
check the AlphaCompute organization secrets that were shared with it before the move.

## Remaining human steps

1. **Rotate secrets** (organization owner, per the private table above). Command for all
   repositories in the IOC file:
   `GH_BIN=... node scripts/owner/incident-ci-exposure.mjs --all --json > ci-exposure.json`,
   or for one repository: `GH_BIN=... node scripts/owner/incident-ci-exposure.mjs --repo <owner/name> --json`.
   Keep the JSON private (it holds names and dates only, but shows what is still unrotated).
2. **Revoke access** (organization owners of AlphaCompute and eliza-research):
   - Cancel the pending eliza-research/alphaphone invitation (Settings > Collaborators and teams,
     or `gh api --method DELETE repos/eliza-research/alphaphone/invitations/<id>`; the id is in
     `GET repos/eliza-research/alphaphone/invitations`). Ask the account that created it why it was
     sent (named in the private incident record).
   - Run `GH_BIN=... node scripts/owner/incident-access-audit.mjs --all` with a token that has
     `admin:org` and `admin:repo_hook`. Remove any outside collaborator, invitation, deploy key,
     webhook or app installation you do not recognize. Exit 0 means the actor has no remaining
     access and everything was readable.
   - In AlphaCompute organization settings: Third-party access (OAuth apps, GitHub Apps,
     fine-grained and classic personal access tokens approved for the org) and, if SAML is on,
     credential authorizations for `gabrielbarbera`; revoke them.
   - Review `slopdotcash` on eliza-research.
3. **Check machines** (each person; see the IOC checklist below). Report only "clean" or "found
   and handled" per machine, never credential values.
4. **Protect shared branches** (repository / organization owner): **deferred by the owner on
   2026-10-29** (see "Owner decision" below). When revisited, install the rulesets below, then
   post the read-back output.
5. **Review the audit log** for `gabrielbarbera` from 2026-10-21 in AlphaCompute (Enterprise):
   `incident-access-audit.mjs` prints event counts per action when run by an owner; open the full
   log in Settings > Audit log with `actor:gabrielbarbera created:>=2026-10-21`, and look in
   particular at `git.push`, `repo.*`, `org.*`, `oauth_*`, `personal_access_token.*`,
   `secret_scanning*`, `workflows.*` and `environment.*`. Inspect the earlier pushes to
   `alpha-compute` `staging` and `vera`.
6. **Purge forged objects** (repository owner): ask GitHub Support to remove the cached unreachable
   commits `39ef59401`, `61d293f61`, `131cd0e63`, `0cefd6e47`, `cc3f7a709` from
   eliza-research/alphaphone (and the forged SHAs of the other public AlphaCompute repositories).
7. **Post the evidence comment** (template below).

## Shared-branch rulesets (prepared, not executed)

eliza-research/alphaphone (repository rulesets; supported on Free for public repositories):

```sh
# Install (owner only)
gh api --method POST repos/eliza-research/alphaphone/rulesets --input scripts/owner/rulesets/shared-branch-integrity.json
# Optional, see decision D2
gh api --method POST repos/eliza-research/alphaphone/rulesets --input scripts/owner/rulesets/default-branch-baseline.json
# Read back (read-only)
node scripts/owner/read-branch-integrity.mjs --repo eliza-research/alphaphone
gh api --method GET repos/eliza-research/alphaphone/rulesets
gh api --method GET repos/eliza-research/alphaphone/rules/branches/main
```

AlphaCompute (organization ruleset; Enterprise plan):

```sh
# Install in evaluate mode first (owner only)
gh api --method POST orgs/AlphaCompute/rulesets --input scripts/owner/rulesets/alphacompute-org-shared-branch-integrity.json
# After a week of Rule insights without surprises, switch to active:
#   gh api --method PUT orgs/AlphaCompute/rulesets/<id> -f enforcement=active
# Read back per repository (read-only)
node scripts/owner/read-branch-integrity.mjs --repo AlphaCompute/vera --branch main --branch staging
gh api --method GET orgs/AlphaCompute/rulesets
```

`read-branch-integrity.mjs` names the ruleset enforcing each rule, which is the evidence the issue
asks for ("ruleset names now enforcing no-force-push and signed commits"). A ruleset in `evaluate`
mode is reported separately and does not count.

## Machine-check IOC checklist (step 3)

Who: anyone who fetched, checked out or opened an affected branch, in VS Code or otherwise,
between 2026-10-27 22:45 UTC and the cleanup (the private incident record names the people known
to have opened affected branches), and anyone whose local clone may still have the forged history.

Indicators (from the forged alphaphone commits; the other repositories used the same kit):

| Indicator | Value |
|---|---|
| Root file `init` (obfuscated Node script) | sha256 `13aceeef9d5912320899940772470c9ae75ea5d75e58e9807e34b1b71f583022` |
| Fake font `fa-brand-400.orc` under a `reminders/public/fonts/` directory | sha256 `1835d0aa55d6589cecac33aa1a494d76b8ce33632674f18e16b9278edbf3053a` |
| `.vscode/tasks.json` with a hidden task `eslint-check`, `"runOn": "folderOpen"`, running the `.orc` with node | sha256 `3752d6f30b56b7c47c18ceaf6932d8af279c06c4b6b0fa321bd610480e1a7da7` |
| `.env` with `AUTH_API_KEY=` holding a base64 URL | sha256 `efce9104a7e6b59881886a7c5f9c162ec32c2d9fcf87a4f46978d89ddf269980` |
| Remote loader host (decoded from that `.env`, never fetched) | `files.catbox.moe` (path `/e8jt91.js`) |
| `package.json` scripts prefixed with `node init &&` | `dev`, `dev:ui`, `dev:maps`, `build`, `build:test-mocks`, `dev:local`, `dev:cloud` |
| `capacitor.config.ts` (or other config) with `atob(process.env.…)` and `eval(...)` | loader that downloads and evaluates code |

Checks (read-only on the machine; do not run the payload, do not open the folder in VS Code
before step a):

a. Disable VS Code automatic tasks: Settings > `task.allowAutomaticTasks` = `off`, and check
   workspace trust prompts were not accepted for an affected folder.
b. Find payload files: `find ~ -name 'fa-brand-400.orc' -o -path '*/reminders/public/fonts/*.orc' 2>/dev/null`
   and `find ~ -maxdepth 6 -name init -type f -size +20k 2>/dev/null | xargs -r sha256sum | grep 13aceeef`.
c. Search local clones without checking out (inside each clone):
   `node <alphaphone>/scripts/owner/forged-branch-scan.mjs --git-dir . --repo <name>`; for a local
   branch, `git merge-base --is-ancestor <forged-sha> <branch> && echo REACHES-FORGED`.
d. Processes and connections: look for long-running `node` processes started from a repository
   directory (`ps -eo pid,lstart,args | grep -i node`), and outbound connections or DNS lookups to
   `files.catbox.moe` (`ss -tnp`, browser/DNS/proxy logs, EDR) since 2026-10-27 22:45 UTC.
e. Persistence: new entries in crontab, systemd user units, launch agents (macOS
   `~/Library/LaunchAgents`), shell rc files, `~/.npmrc`, `~/.gitconfig` (`core.hooksPath`,
   `credential.helper`), `.git/hooks` in affected clones, and new SSH `authorized_keys` lines.
f. If anything matches, or if `npm run dev`/`build`, `cap sync` or a `folderOpen` task ran on an
   affected branch: treat the machine as compromised, rotate from a clean machine every GitHub
   token (`gh auth status` lists them; revoke in GitHub settings), npm token, cloud key, SSH key and
   signing key reachable from it, and reinstall or re-image.
g. Reset local clones to the rewritten branches: `git fetch` then `git reset --hard origin/<branch>`
   (a plain `git pull` merges the forged history back), and `git gc --prune=now` once no ref
   reaches the forged commits.

## Owner decision (2026-10-29): branch protection deferred

The owner decided: no branch protection for now. Decisions D1 to D4 below (signature scope,
pull request required, bypass, AlphaCompute organization ruleset) are therefore **deferred**, and
step 4 of the remaining human steps is skipped until the owner revisits it. The ruleset drafts in
`scripts/owner/rulesets/` stay prepared and uninstalled. The other steps (rotation, access
revocation including the pending invitation, machine checks, audit log, purge request, evidence
comment) are not affected by this decision. Consequence to keep in view: until a ruleset is
installed, any account with write access can push unsigned commits straight to `main`
(classic protection blocks only force push and deletion, with `enforce_admins` off) and
`develop` has no protection at all; the read-only
`node scripts/owner/forged-branch-scan.mjs` is the detection control in the meantime (re-run
2026-10-29: 146 heads, 0 flagged).

## Decisions for the owner

### D1. Scope of the signature requirement

| Option | What it changes |
|---|---|
| A. `main` and `develop` only (prepared default) | Squash merges through GitHub stay unaffected (GitHub signs them). Direct pushes to `main`/`develop` and merge or rebase merges of unsigned commits are refused. Agent branches stay unsigned and unaffected. |
| B. All branches | Every agent and bot push must be signed: each worktree needs a signing key, which is a new credential to protect. |
| C. No signature rule, force-push and deletion only | Smallest change; does not stop a forged commit pushed by a compromised account with write access. |

Recommendation: A. It matches the issue ("shared branches") and the current squash-only flow on
`main`.

### D2. Restore "pull request required" on `main`?

AlphaCompute's organization ruleset "Require review before merge" did not move with the
repository; today anyone with write access can push straight to `main`.

| Option | What it changes |
|---|---|
| A. Install `default-branch-baseline.json` (pull request required, zero approvals, squash only) | Every change to `main` goes through a pull request; no reviewer needed, so agent flows keep working. Merge-commit and rebase merges are disabled for `main`. |
| B. Same with one required approval | A second person must approve each pull request; agents cannot self-merge. |
| C. Leave as is | Direct pushes to `main` remain possible for writers. |

Recommendation: A now; B is the owner's call.

### D3. Admin bypass

| Option | What it changes |
|---|---|
| A. No bypass actors (prepared default) | Nobody can force-push `main`, including owners; an emergency needs a temporary ruleset edit, which is audit-logged. |
| B. Organization admins as bypass actors | Faster recovery work (as during this cleanup), but an admin token compromise can rewrite `main` again. |

Recommendation: A. Also turn on `enforce_admins` for the classic protection on `main`, or rely on
the ruleset and remove the classic protection.

### D4. AlphaCompute organization ruleset scope and mode

Default: all repositories, default plus `develop`, `dev`, `staging`, `next`, `enterprise`, start in
`evaluate` for a week (Rule insights show what would have been blocked), then `active`.
Alternative: `active` immediately, accepting that a bot or person pushing unsigned commits to
`staging`/`dev` is blocked at once.

### D5. eliza-research organization hygiene

Two-factor requirement is off and members can create repositories. Turning 2FA on removes any
member without 2FA from the organization at once; check the member list first.

## Draft decision entries

Not added to `docs/decisions.md`; copy the chosen ones with the next free `P-` number.

- P-xx (draft, **owner decision 2026-10-29, as relayed in the agent task; confirm with the owner before copying**): "2026-10-29: Branch protection for the
  2026-10-27 incident is deferred. No 'Shared branch integrity' or 'Default branch baseline'
  ruleset is installed on eliza-research/alphaphone or AlphaCompute; the drafts stay in
  `scripts/owner/rulesets/`. Shared branches are monitored with
  `node scripts/owner/forged-branch-scan.mjs`. Revisit at <trigger>."

The entries below apply only when the deferral is lifted.

- P-xx (draft): "2026-10-__: Shared branches (`main`, `develop`) of eliza-research/alphaphone are
  protected by the repository ruleset 'Shared branch integrity': no deletion, no force push, signed
  commits, no bypass actors. Agent branches are not covered. Read back with
  `node scripts/owner/read-branch-integrity.mjs`."
- P-xx (draft): "2026-10-__: `main` requires a pull request (ruleset 'Default branch baseline',
  squash only, <0|1> approvals)."
- P-xx (draft): "2026-10-__: AlphaCompute organization ruleset 'Shared branch integrity' covers
  default, develop, dev, staging, next and enterprise in all repositories; evaluate from <date>,
  active from <date>."
- P-xx (draft): "2026-10-__: Incident 2026-10-27 closed: secrets rotated per #658 table, access
  audit exit 0, machine checks reported, audit log reviewed, forged objects purge requested
  (GitHub Support ticket <id>)."

## Evidence comment template (post on #658)

```markdown
## Incident evidence, <date>

### 1. Secrets rotated
Rotation finished for every repository in the IOC file: <yes/no>, checked <date> with
`incident-ci-exposure.mjs --all` (no NOT-ROTATED-YET rows). The per-repository record is kept
privately at <private location>; do not paste names, counts or remaining items here.
Org secrets reviewed: AlphaCompute <date>. OIDC roles reviewed: <yes/no>.

### 2. Access revoked
- `incident-access-audit.mjs --all` (owner token) exit code: <0/1/2>, run <date>.
- Pending invitation on eliza-research/alphaphone cancelled: <date>.
- Tokens / SSH keys / OAuth and app grants revoked: <date, by whom>.

### 3. Machine checks (no credentials)
| Person | Machine | Result (clean / found and handled) | Local credentials rotated |
|---|---|---|---|

### 4. Branch protection
- eliza-research/alphaphone: ruleset "<name>" (id <id>); `read-branch-integrity.mjs` output: <paste>.
- AlphaCompute: organization ruleset "<name>" (id <id>), enforcement <evaluate/active>.

### 5. Audit log
Reviewed `actor:gabrielbarbera` from 2026-10-21 in AlphaCompute: <findings>. Earlier pushes to
alpha-compute `staging` and vera: <findings>.

### 6. Forged objects
GitHub Support request <id>: <status>.
```
