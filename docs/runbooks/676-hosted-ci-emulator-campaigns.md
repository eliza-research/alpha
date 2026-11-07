# #676 Hosted CI dispatch and emulator instrumentation campaigns (H-31)

Owner preparation for [#676](https://github.com/eliza-research/alphaphone/issues/676) and
[human action](../human-actions.md) H-31. Nothing on this page was dispatched or run: no workflow
was started, no ref was pushed and no emulator was booted. Hosted minutes follow the
[CI cost policy](../ci-cost-policy.md) and need the owner's go-ahead.

Every result these campaigns can produce is **emulator HOME-role evidence (class E)** at best. It is
not an AOSP image boot, a real integration, a physical device result or user acceptance, and the
results format below says so in every record.

Prepared on this branch:

- `node scripts/owner/emulator-campaign-check.mjs` — static check of every class #676 lists
  (test source, runner registration, hosted job, gaps) and the local command per class.
- `node scripts/owner/emulator-campaign-check.mjs --dispatch-plan --sha <commit>` — prints the
  exact dispatch commands for one commit. It runs nothing.
- `test/owner-emulator-campaign-check.test.mjs` — the batches below parse with the runner's own
  argument parser, and the plan only targets an exact SHA.

## Read-only findings (2026-10-28)

Read with `gh run list`, `gh api …/actions/runs/<id>/jobs` and `gh api …/actions/variables` against
`eliza-research/alphaphone`; nothing was changed.

| Workflow | Dispatched runs | What actually ran |
| --- | --- | --- |
| `resident-android.yml` | 60 `workflow_dispatch` runs; 167 push and 18 schedule runs, all `skipped` (no repository variable is set, so `ELIZA_RESIDENT_QUALIFICATION` is unset) | On 2026-10-03, 45 dispatches, mostly on `codex/review-*` branches: job `native` never passed (32 failed, 9 cancelled, 4 skipped); `recovery-ui` passed 22 times (6 failed, 13 cancelled, 4 skipped). Those runs predate the current source and are not evidence for it. Since 2026-10-21, 15 dispatches: `build` succeeded 10 times (latest run 39918054977 on `main` at `3f25885d`, 2026-10-23) but `native` and `recovery-ui` were **skipped** in every one, which the workflow does only for `runtime_profile=cloud`. No `native` or `recovery-ui` job has run on any October 21 or later source. |
| `android-emulator.yml` | 0 | Never dispatched. |
| `digest-restart.yml` | 0 | Never dispatched. |

So the issue's "no hosted emulator job has ever been dispatched" is true only for
`android-emulator.yml` and `digest-restart.yml`; `resident-android.yml` emulator jobs did run in
early October and failed (`native`) or passed (`recovery-ui`) on older source.

Other findings that change how the campaigns are run:

1. `resident-android.yml` now has a required `runtime_profile` input (`native` or `cloud`, default
   `native`). [core loop audit](../core-loop-audit.md) CI-1 still says "the workflow takes no inputs".
   Dispatch with `-f runtime_profile=native` explicitly; a `cloud` dispatch skips both emulator jobs
   and produces no CI-1 evidence.
2. `workflow_dispatch` takes a branch or tag, not a SHA. To run on a named commit, pin it to a
   dedicated ref first (the plan uses `ci/h31-<sha12>`; push-triggered workflows run only on `main`
   and `develop`, so the push starts nothing) and check each run's `headSha` afterwards.
3. The core loop audit's summary "9 (4 EMULATOR and 5 CI)" is stale: its per-loop tables now hold
   **13 EMULATOR** steps (A-29, D-23, E-3, E-8, E-9, E-14, E-22 to E-27, J05-2) and **5 CI** steps
   (A-23, A-27, C-7, D-15, F-16) open.
4. `scripts/android-instrumentation.mjs` admits only `<variant>-debug.apk` rows of a verify-apks
   manifest. A signed release APK cannot be instrumented. "Again on the distributable build" therefore
   means the debug pair built by the strict chain (`npm run android:build:local`, packaged runtime,
   no `--allow-unpackaged-runtime`); release-APK contents are covered by `scripts/verify-apks.mjs`
   and provisioning, not by these classes.
5. `android-emulator.yml` builds with `--allow-unpackaged-runtime`: its results are developer-APK
   evidence only. `resident-android.yml` builds the PACKAGED archive (`scripts/build-archive.mjs`).
6. Gaps from the static check: `ResetExternalFixture` has no runner (`NOT_RUN_BY_A_RUNNER`); no
   instrumented class drives the Quick Settings tile (`AlphaQuickSettingsTile`); the upgrade from
   saved mock state has no script (manual procedure in the
   [pilot runbook](../pilot-acceptance-runbook.md#upgrade-from-earlier-mock-state));
   `WorkflowNoticeTap` runs only inside `resident-android.yml` job `recovery-ui`; no hosted suite
   passes `--home-role`, so `LauncherHome`, `SettingsRoles` and `AccessibilityHomeRole` are local
   owned-emulator only; 28 of the 31 listed classes have no hosted job at all.
7. The `apkVariants` gate in `android/aosp/pixel10a-qualification-gates.json` cites
   `https://github.com/AlphaCompute/alphaphone/actions/runs/39918054977`; the same run ID is the
   `eliza-research/alphaphone` run above. AlphaCompute is now a fork, so that link may stop resolving.

## Dispatch runbook (prepared, not executed)

Pick the candidate commit (full 40-character SHA, on `main`), confirm it is not reachable from a
forged commit, then print the plan:

```sh
node scripts/owner/emulator-campaign-check.mjs --dispatch-plan --sha <SHA>
```

It prints, for that SHA (shown here for `<SHA>` and its first 12 characters `<SHA12>`):

```sh
# 1. Pin the commit to a ref (a branch outside main/develop starts no push-triggered workflow)
git fetch origin <SHA>
git merge-base --is-ancestor <SHA> origin/main
git push origin <SHA>:refs/heads/ci/h31-<SHA12>

# 2. Dispatch
gh workflow run resident-android.yml -R eliza-research/alphaphone --ref ci/h31-<SHA12> -f runtime_profile=native
gh workflow run android-emulator.yml -R eliza-research/alphaphone --ref ci/h31-<SHA12> -f suite=instrumentation
gh workflow run android-emulator.yml -R eliza-research/alphaphone --ref ci/h31-<SHA12> -f suite=browser-reading
gh workflow run digest-restart.yml   -R eliza-research/alphaphone --ref ci/h31-<SHA12>

# 3. Verify and download
gh run list -R eliza-research/alphaphone --branch ci/h31-<SHA12> --event workflow_dispatch --json databaseId,workflowName,headSha,status,conclusion
gh run view <RUN_ID> -R eliza-research/alphaphone --json jobs --jq '.jobs[] | [.name, .conclusion] | @tsv'
gh run download <RUN_ID> -R eliza-research/alphaphone -D test-results/h31/<RUN_ID>

# 4. Clean up after the evidence is committed
git push origin --delete ci/h31-<SHA12>
```

Do not dispatch `android-emulator.yml -f suite=fused-speech` or `-f suite=all`: the build job stops
them until hosted voice staging exists ([fused speech](../fused-speech.md)).

| Workflow | Input | Jobs | Suites / steps | Classes or methods | Evidence artifact and file | Limits |
| --- | --- | --- | --- | --- | --- | --- |
| `resident-android.yml` | `runtime_profile=native` | `build` → `native`, `recovery-ui` in parallel | `native`: `scripts/ci/resident-native.py`; `recovery-ui`: `scripts/ci/pending-recovery-ui.py` (16 methods) | `native`: PrivateResidentSocket, ResidentStreamTransport, ResidentWorkflowCrash (2 methods), both flavors, x86_64. `recovery-ui`: ConnectionInstrumentedTest (3), ClockAgentReview, WorkflowNoticeTap, WorkflowNoticeProcessDeath (2), ReminderTapProcessDeath, ReminderTiming, ReminderTapLifecycle, CalendarCreationRecovery, CloudDelegationCallback (2), NoteAudio, ReminderAgent, ReminderDeletionStorage | `resident-native-evidence-<RUN_ID>` → `test-results/resident-ci-native/result.json`; `pending-recovery-ui-evidence-<RUN_ID>` → `test-results/pending-recovery-ui-native/result.json` (`methods: 16`). A missing file is a failed run | build 180 min, native 100, recovery-ui 55; artifacts kept 3 days |
| `android-emulator.yml` | `suite=instrumentation` | `build` → `instrumentation` | `scripts/ci/emulator-suite.mjs instrumentation` | runner defaults on both flavors: NoMockProduct, Shell, StartupReadiness, TextScale, BrowserSignins, BrowserFlow, BrowserContinuity | `test-results/emulator-suite/instrumentation.json` and `test-results/android-instrumentation/ci-default/results.json` | build 150 min, instrumentation 90; developer-override APKs |
| `android-emulator.yml` | `suite=browser-reading` | `build` (adds the test-mocks pair) → `browser-reading` | `scripts/ci/emulator-suite.mjs browser-reading` (installs pinned Chromium 157.0.8083.0 WebView) | flag-off: BrowserReadingNavigation, BrowserPageQuestion; test-mocks: BrowserReading, BrowserSensitiveReading, BrowserIsolatedReading | `test-results/emulator-suite/browser-reading.json`, `…/ci-reading/results.json`, `…/ci-reading-test-mocks/results.json` | API 35 x86_64 image only |
| `digest-restart.yml` | none | `digest-restart` | `npm run agent:prepare`, then `npm run agent:test-digest-restart` | synthetic model in the pinned upstream runtime; no emulator | the uploaded `digest-restart` result JSON | 80 min; host-runtime evidence, not class E |

## Local campaigns (owned, disposable emulator)

Agents in this orchestration may not run emulators; a person runs these. Each batch runs twice:
first on developer APKs (`npm run android:build -- --allow-unpackaged-runtime`, plus
`npm run android:build -- --test-mocks` for the test-mocks batches), then on the strict-chain debug
pair (`npm run android:build:local`). Prefix every batch with
`npm run test:android:instrumentation -- --owned-emulator --avd <avd> --serial emulator-NNNN` and
give each run its own `--output test-results/android-instrumentation/<batch>-<build>`.

| Batch | Build pair | Arguments |
| --- | --- | --- |
| `h31-flagoff` | flag-off | `--classes ResidentAlwaysPresent,Assistant,Flow,ChatContinuity,AssistantResidentReuse,SettingsFlow,ResetPolicy,LauncherApps,PasswordBrowserFill,Accessibility,Rotation,CameraScan,PhotoEdit,PhotoFilter,PhotosBatch,FilesTree` |
| `h31-home-role` | flag-off | `--variants launcher --home-role --classes SettingsRoles,LauncherHome` |
| `h31-test-mocks` | test-mocks | `--test-mocks --classes AccessibilityViews,AccessibilityLifecycle,HostedProcessRestart,BrowserIsolatedReading,BrowserDownload,BrowserAutofill` |
| `h31-test-mocks-home-role` | test-mocks | `--variants launcher --home-role --test-mocks --classes AccessibilityHomeRole` |

Campaign classes, run by their own scripts:

- `ResidentEgressRedaction` (and `ResidentService` with `RESIDENT_TEST=ai.elizaresearch.alphaphone.ResidentServiceInstrumentedTest`):
  `ALPHA_RESIDENT_DISPOSABLE_EMULATOR=1 ANDROID_SERIAL=<fresh arm64 emulator, ≥4 GB RAM> node scripts/android-resident-instrumentation.mjs <app.apk> <androidTest.apk>`.
  It reads the development key file `~/.config/alphaphone/cerebras-key` (mode 0600, H-30, #671) and
  refuses a group- or world-readable file. The key never goes into a result.
- Restart phases skipped by the plain runner (`SettingsFlow` theme, `AccessibilityLifecycle`):
  `node scripts/test-native-restart.mjs theme|accessibility APP.apk TEST.apk NEW_OUTPUT`.
- `WorkflowNoticeTap` and `WorkflowNoticeProcessDeath`: only `resident-android.yml` job
  `recovery-ui` (`scripts/ci/pending-recovery-ui.py` refuses to run outside a GitHub-hosted runner).
- The core loop audit's open EMULATOR steps use its campaigns 1, 2, 4 and 10 and the E-22 to E-27
  commands in [core loop audit](../core-loop-audit.md#emulator-and-ci-campaigns).
- Not runnable by any script: `ResetExternalFixture` (reset kills instrumentation; needs an external
  host controller), the Quick Settings tile, and the upgrade from saved mock state. Record these as
  manual emulator procedures with screenshots, labelled class E.

## Campaign matrix (class × flavor × evidence column)

Every cell starts `not run`. "Developer APKs" is the `--allow-unpackaged-runtime` (and test-mocks)
build; "Strict-chain debug" is the debug pair from `npm run android:build:local`; "Hosted" is the
dispatched job. A cell is filled with the result file path and its status, never with a summary.

| Group | Class | Flavor | Batch / runner | Developer APKs | Strict-chain debug | Hosted |
| --- | --- | --- | --- | --- | --- | --- |
| Shell/HOME | LauncherApps | standalone | h31-flagoff | not run | not run | n/a |
| Shell/HOME | LauncherApps | launcher | h31-flagoff | not run | not run | n/a |
| Shell/HOME | LauncherHome | launcher | h31-home-role | not run | not run | n/a |
| Shell/HOME | SettingsRoles | launcher | h31-home-role | not run | not run | n/a |
| Settings | SettingsFlow | standalone | h31-flagoff + `test-native-restart.mjs theme` | not run | not run | n/a |
| Settings | SettingsFlow | launcher | h31-flagoff + `test-native-restart.mjs theme` | not run | not run | n/a |
| Settings | ResetPolicy | standalone | h31-flagoff | not run | not run | n/a |
| Settings | ResetPolicy | launcher | h31-flagoff | not run | not run | n/a |
| Settings | ResetExternalFixture | both | no runner (manual, disposable fixture only) | not run | not run | n/a |
| Settings | Quick Settings tile placement and unlock | both | no class (manual) | not run | not run | n/a |
| Assistant | Assistant | standalone | h31-flagoff | not run | not run | n/a |
| Assistant | Assistant | launcher | h31-flagoff | not run | not run | n/a |
| Assistant | Flow | standalone | h31-flagoff | not run | not run | n/a |
| Assistant | Flow | launcher | h31-flagoff | not run | not run | n/a |
| Assistant | ChatContinuity | standalone | h31-flagoff | not run | not run | n/a |
| Assistant | ChatContinuity | launcher | h31-flagoff | not run | not run | n/a |
| Assistant | AssistantResidentReuse | standalone | h31-flagoff | not run | not run | n/a |
| Assistant | AssistantResidentReuse | launcher | h31-flagoff | not run | not run | n/a |
| Assistant | AccessibilityViews (200% composer overlap) | standalone | h31-test-mocks | not run | not run | n/a |
| Assistant | AccessibilityViews (200% composer overlap) | launcher | h31-test-mocks | not run | not run | n/a |
| Workflows | WorkflowNoticeTap | both | resident `recovery-ui` only | n/a | n/a | not dispatched |
| Workflows | WorkflowNoticeProcessDeath | both | resident `recovery-ui` only | n/a | n/a | not dispatched |
| Workflows | HostedProcessRestart | standalone | h31-test-mocks | not run | not run | n/a |
| Workflows | HostedProcessRestart | launcher | h31-test-mocks | not run | not run | n/a |
| Workflows | `npm run agent:test-digest-restart` | n/a | `digest-restart.yml` or local | host-runtime: not run | n/a | not dispatched |
| Agent | ResidentAlwaysPresent | standalone | h31-flagoff (flag-off only) | not run | not run | n/a |
| Agent | ResidentAlwaysPresent | launcher | h31-flagoff (flag-off only) | not run | not run | n/a |
| Agent | ResidentService | both | `android-resident-instrumentation.mjs` with `RESIDENT_TEST` | not run | not run | n/a |
| Agent | ResidentEgressRedaction | both | `android-resident-instrumentation.mjs` | not run | not run | n/a |
| Agent | resident restart (PrivateResidentSocket, ResidentStreamTransport, ResidentWorkflowCrash) | both | resident `native` only | n/a | n/a | not dispatched |
| Agent | resident history and missed runs on an installed APK | both | no script (manual) | not run | not run | n/a |
| Browser | BrowserDownload | standalone | h31-test-mocks | not run | not run | n/a |
| Browser | BrowserDownload | launcher | h31-test-mocks | not run | not run | n/a |
| Browser | BrowserAutofill | standalone | h31-test-mocks | not run | not run | n/a |
| Browser | BrowserAutofill | launcher | h31-test-mocks | not run | not run | n/a |
| Browser | PasswordBrowserFill | standalone | h31-flagoff | not run | not run | n/a |
| Browser | PasswordBrowserFill | launcher | h31-flagoff | not run | not run | n/a |
| Browser | BrowserIsolatedReading | standalone | h31-test-mocks | not run | not run | not dispatched (browser-reading) |
| Browser | BrowserIsolatedReading | launcher | h31-test-mocks | not run | not run | not dispatched (browser-reading) |
| Accessibility | Accessibility | standalone | h31-flagoff | not run | not run | n/a |
| Accessibility | Accessibility | launcher | h31-flagoff | not run | not run | n/a |
| Accessibility | AccessibilityViews | standalone | h31-test-mocks | not run | not run | n/a |
| Accessibility | AccessibilityViews | launcher | h31-test-mocks | not run | not run | n/a |
| Accessibility | AccessibilityLifecycle | standalone | h31-test-mocks + `test-native-restart.mjs accessibility` | not run | not run | n/a |
| Accessibility | AccessibilityLifecycle | launcher | h31-test-mocks + `test-native-restart.mjs accessibility` | not run | not run | n/a |
| Accessibility | AccessibilityHomeRole | launcher | h31-test-mocks-home-role | not run | not run | n/a |
| Accessibility | Rotation | standalone | h31-flagoff | not run | not run | n/a |
| Accessibility | Rotation | launcher | h31-flagoff | not run | not run | n/a |
| Media | CameraScan | standalone | h31-flagoff | not run | not run | n/a |
| Media | CameraScan | launcher | h31-flagoff | not run | not run | n/a |
| Media | PhotoEdit | standalone | h31-flagoff | not run | not run | n/a |
| Media | PhotoEdit | launcher | h31-flagoff | not run | not run | n/a |
| Media | PhotoFilter | standalone | h31-flagoff | not run | not run | n/a |
| Media | PhotoFilter | launcher | h31-flagoff | not run | not run | n/a |
| Media | PhotosBatch | standalone | h31-flagoff | not run | not run | n/a |
| Media | PhotosBatch | launcher | h31-flagoff | not run | not run | n/a |
| Media | FilesTree | standalone | h31-flagoff | not run | not run | n/a |
| Media | FilesTree | launcher | h31-flagoff | not run | not run | n/a |
| Upgrade | from earlier installs that saved mock state | both | manual (pilot runbook procedure) | not run | not run | n/a |

The accessibility classes need the screen-reader stand-in service the classes install themselves;
TalkBack itself is a device check (#677, H-33).

Open core loop steps and the campaign that closes each ([core loop audit](../core-loop-audit.md)):

| Step | Class of step | Closed by |
| --- | --- | --- |
| A-23 | CI | `resident-android.yml` job `native` (CI-1) |
| A-27, C-7, D-15, F-16 | CI | `resident-android.yml` job `recovery-ui` (CI-1) |
| A-29, E-3 | EMULATOR | campaign 1 locally, or `android-emulator.yml suite=instrumentation` (CI-3) |
| E-8, E-9, J05-2 | EMULATOR | campaigns 2, 4 and 10 locally, or `android-emulator.yml suite=browser-reading` (CI-2) |
| E-14 | EMULATOR | campaign 4 (`BrowserAutofill`, test-mocks) |
| D-23 | EMULATOR | the dossier route run named in its row |
| E-22 to E-27 | EMULATOR | the commands in each row (BrowserWebFeatures, BrowserShare, BrowserDialogLifecycle, BrowserUnsupportedReading, `scripts/test-browser-storage-format.mjs`, `scripts/android-browser-reading-live.mjs`) |

## Results format

Commit one record per candidate commit as `docs/evidence/h31-<sha12>-<yyyy-mm-dd>.json`, with the
raw result files it names copied beside it or referenced by run ID. Nothing in it may hold a key,
token or account identifier.

```json
{
  "format": "alpha-h31-campaign-v1",
  "commit": "<40-hex SHA every run below used>",
  "evidenceClass": "E",
  "statement": "Emulator HOME-role evidence only. Not an AOSP image boot, a real integration, a physical device result or user acceptance.",
  "notEvidenceFor": ["AOSP image boot", "real integrations", "physical-device acceptance", "user acceptance", "arm64-v8a speech"],
  "runs": [
    {
      "name": "h31-flagoff",
      "where": "local | hosted",
      "workflow": "android-emulator.yml (hosted only)",
      "runId": "<GitHub run ID, hosted only>",
      "headSha": "<must equal commit>",
      "build": "developer | strict-chain-debug | resident-packaged",
      "testMocks": false,
      "homeRole": false,
      "emulator": { "avd": "<name>", "api": 35, "abi": "x86_64 | arm64-v8a", "webView": "<provider and version, browser classes only>" },
      "operator": "<role handle>",
      "startedAt": "<UTC>", "endedAt": "<UTC>",
      "resultsFile": "test-results/android-instrumentation/<batch>-<build>/results.json",
      "resultsSha256": "<sha256 of that file>",
      "classes": [{ "variant": "standalone | launcher", "class": "<short name>", "status": "passed | failed | skipped", "failed": [] }]
    }
  ]
}
```

Rules: a run whose `headSha` differs from `commit` is left out; `skipped` is not `passed`; a missing
`result.json` from a resident job is a failed run; the runner's own `results.json` (commit, dirty
state, APK hashes, HOME-role restoration) is the source, and the record only indexes it. Fill the
campaign matrix cells from this record.

## Decisions for the owner

| Question | Options | Documented default / recommendation | What each choice changes |
| --- | --- | --- | --- |
| Spend hosted minutes now? | dispatch the four runs once at the candidate; or wait | Dispatch only on the owner's go-ahead ([CI cost policy](../ci-cost-policy.md)) | Dispatching produces the only CI-1 evidence (A-23, A-27, C-7, D-15, F-16); waiting keeps those five steps open |
| Which commit is the candidate? | current `main` head; or the commit the release APKs are built from (#662) | The candidate commit H-31 names; recommend the #662 build commit so emulator and release evidence share a source | A different commit means the emulator results do not describe the release build |
| Automatic resident qualification | leave `ELIZA_RESIDENT_QUALIFICATION` unset; `nightly`; `push` | Unset (current); the policy calls automatic runs optional | `nightly` runs `native` and `recovery-ui` once a day on the default branch; `push` on every main commit, at higher cost |
| Where local campaigns run | an owner-held x86_64 host; the arm64 development host | Any owned, disposable emulator; the development host runs arm64 images only | `resident-native.py` needs x86_64 (hosted only); local arm64 results are a separate cohort from hosted x86_64 |
| Delete the `ci/h31-*` ref after use? | delete; keep until the PR that records the results merges | Delete after the record is committed | Keeping it makes the run easy to find; deleting avoids stale branches |

## Remaining human steps

1. Owner approves the hosted spend and names the candidate SHA.
2. A person with push rights pins the SHA to `ci/h31-<sha12>` and dispatches the four runs printed by
   the plan; nobody dispatches `fused-speech` or `all`.
3. A person with an owned, disposable emulator runs the four local batches on developer APKs and on
   the strict-chain debug pair, the resident campaign (with the H-30 key file) and the manual
   procedures.
4. The results are committed in the format above with the commit they ran on, and the matrix is
   filled from them. The core loop audit's CI-1 text and summary count are corrected in that change.

## Draft decision entries

Drafts for `docs/decisions.md`; the owner assigns numbers and dates.

- **P-NN — H-31 ([#676](https://github.com/eliza-research/alphaphone/issues/676)):** Hosted emulator qualification is dispatched once per release candidate at commit `<sha>` (`resident-android.yml` with `runtime_profile=native`, `android-emulator.yml` suites `instrumentation` and `browser-reading`, `digest-restart.yml`); `ELIZA_RESIDENT_QUALIFICATION` stays `<unset | nightly | push>`.
