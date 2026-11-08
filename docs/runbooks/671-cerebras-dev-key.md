# #671 Development Cerebras inference key for hosts and emulator campaigns (H-30)

Owner prep, 2026-10-28. Development and test-mocks only: production phones refuse direct provider
keys (P-43) and use the signed-in Eliza Cloud plan. No key was read, requested, printed or stored
while preparing this; the status check uses `lstat` only.

## What was prepared

| File | Purpose |
| --- | --- |
| [`scripts/owner/cerebras-key-status.mjs`](../../scripts/owner/cerebras-key-status.mjs) | `status`: does `~/.config/alphaphone/cerebras-key` exist as a private (0600), non-empty, regular, owner-owned file, without opening it. `audit`: source check of every script that reads the key. `scan-bundle DIR`: key-shaped values, the `CEREBRAS_API_KEY` name or the direct `api.cerebras.ai` host in a built bundle, file names only |
| [`test/owner-cerebras-key-status.test.mjs`](../../test/owner-cerebras-key-status.test.mjs) | Proves `status` never calls `readFileSync`, prints no content, and that the audit and scan catch synthetic leaks |

## Read-only findings (2026-10-28)

1. **Key file status on this orchestration host:** `node scripts/owner/cerebras-key-status.mjs status`
   reports **no key file** at `~/.config/alphaphone/cerebras-key`. H-30 step 1 is not done on this
   host; resident instrumentation and the local launchers will refuse to start here.
2. **Audit of key readers** (`audit`, exit 0). Every repository script that reads the key file refuses
   a group- or world-readable file, and none of their console or print calls names the variable that
   holds the key:

   | Script | How the key is used | Output |
   | --- | --- | --- |
   | `scripts/start-local-agent.mjs` (honours `ALPHA_CEREBRAS_KEY_FILE`) | child env `CEREBRAS_API_KEY` for `scripts/dev-agent.mjs` | fixed error text only |
   | `scripts/android-resident-instrumentation.mjs` | written over `adb` stdin into the app sandbox of a disposable secondary user (umask 077), removed with the user | prints `{runId, user, test, passed, proof, last 25 instrumentation lines}`; the fixture with the key is not printed |
   | `scripts/start-combined-agent.mjs` | child env; lstat, owner uid, no symlink, 0600 | metadata without the key |
   | `scripts/start-local-remote.mjs` (or `CEREBRAS_API_KEY` from the environment) | runtime settings | metadata without the key |
   | `scripts/start-local-voice-agent.mjs`, `scripts/start-reviewed-workflow-agent.mjs` | child env | metadata without the key; child output goes to an owner-only `server.log` |
   | `scripts/scan-archived-apks.py` | searches archived APKs for the key (raw, UTF-16, base64, hex) | PASS line only |

   `npm run agent:dev` (`scripts/dev-agent.mjs`) does not read the file: it needs `CEREBRAS_API_KEY`
   and `CEREBRAS_BASE_URL` in the environment (as `start-local-agent.mjs` provides). Its errors are
   fixed texts.

   Residual risks (not leaks found, worth knowing): child runtimes receive the key in their
   environment and write their own output to owner-only `server.log` files, which this audit does not
   inspect; `android-resident-instrumentation.mjs` prints the device test's `proof` file and the
   instrumentation tail, so a device-side test that printed the key would surface it. The device tests
   read `apiKey` from the fixture and store it in `AlphaCredentialStore`; no `Log` call names it.
   Several launchers use `statSync` (follow symbolic links) where `start-combined-agent.mjs` uses
   `lstat` and an owner check; the status check flags a symlinked key file for that reason.
3. **Workflows:** no file in `.github/workflows/` references a Cerebras key or any secret today. No
   hosted CI job currently consumes the key; step 2 below would add the first one.
4. **Production bundles:** `scripts/audit-production-bundle.mjs` denies the manual key-entry text
   (`'Cerebras API key'`) and the developer/test surfaces, but does **not** scan for key-shaped values
   or the direct Cerebras host. A production web build of origin/main `94676c82` (`npm run build`)
   passed `audit-production-bundle.mjs web-dist` (417 files, `testMocks=false`) and
   `cerebras-key-status.mjs scan-bundle web-dist` found no key-shaped value, no `CEREBRAS_API_KEY`
   name and no `api.cerebras.ai`. This is web-bundle evidence for that build only; native code
   (`AlphaLocalAgentPlugin.java` holds the Cerebras models URL for the test-mocks key check, refused in
   production by `LocalAgentProviderAdmission`) and APKs were not scanned here.

## Exact remaining human steps

1. **Each developer or operator** running a development host or resident instrumentation:
   create the file yourself (never paste the key into chat, an issue, a PR, a commit or evidence):
   `install -d -m 700 ~/.config/alphaphone && (umask 077; ${EDITOR:-vi} ~/.config/alphaphone/cerebras-key) && chmod 600 ~/.config/alphaphone/cerebras-key`,
   then `node scripts/owner/cerebras-key-status.mjs status` must report "present, private (0600),
   non-empty; contents not read".
2. **Owner (after the secret rotation in the incident issue):** if hosted emulator campaigns need
   inference, add an Actions secret in `eliza-research/alphaphone` scoped to an environment used only
   by the workflow job that needs it (decision 1). The workflow must write it to a 0600 file or pass
   it on stdin, never echo it, and must not run for pull requests from forks. That workflow change
   is a separate reviewed PR; re-run `cerebras-key-status.mjs audit` after it (it will list the
   workflow, which is expected).
3. **Evidence:** comment on #671 that the file or secret is provisioned (no value, no length, no
   prefix), and record a resident instrumentation run or an `agent:dev` session that reached
   inference (emulator or host evidence; it does not prove a production phone, which never uses this
   key).
4. Optional hardening (separate PR, decision 2): add the `scan-bundle` patterns to
   `audit-production-bundle.mjs`.

## Decisions for the owner

| Question | Options | Default / recommendation | What each choice changes |
| --- | --- | --- | --- |
| 1. Where does the hosted CI key live? | A. Environment secret on a protected environment (required reviewers) used by the emulator campaign job only. B. Repository secret. C. No hosted key; campaigns run on developer hosts only. | **A** (the issue asks for a secret "scoped to the workflows that need it") | A: only that job can read it, after approval. B: every workflow on the default branch can read it. C: no secret to rotate; hosted campaigns cannot reach inference. |
| 2. Scan production bundles for key-shaped values? | A. Add the `csk-` / `CEREBRAS_API_KEY` / `api.cerebras.ai` patterns to `audit-production-bundle.mjs`. B. Keep the current text denylist. | Recommendation A | A: a leaked key or direct-provider path in a production web bundle fails `npm run verify`. B: relies on the UI-text denylist and code review. |

## Draft decision entries

- **P-NN — H-30 (#671):** The development Cerebras key lives only in each developer's owner-only
  `~/.config/alphaphone/cerebras-key` (0600) and, for hosted emulator campaigns, in a
  `<environment>`-scoped Actions secret readable only by `<workflow/job>`. Production bundles and
  phones never carry it (P-43). Policy, not evidence.
