# CI cost and qualification policy

## Automatic checks

Pull requests run the affected lanes below. A full Git diff includes deleted files
and both sides of renames. Missing history, unknown paths and shared dependencies
select all lanes; they never silently skip checks. No GitHub file-list API or its
300-file path-filter limit is used. Reference-only changes start small selection
jobs but allocate no build/test runners. Reference files that node tests read
(`testReadReference` in `scripts/ci/affected.mjs`: dependency-audit dispositions and
snapshot, requirements and inventories, this policy's embedded ruleset, and the
Markdown that `test/docs-links.test.mjs` scans) select Repository verification only.

| Changed input | Repository verification | Chromium + production browser | Android build | Resident preparation |
| --- | --- | --- | --- | --- |
| AGENTS, design references, docs/market-research | No | No | No | No |
| README and docs that node tests read (all docs/*.json, docs Markdown checked by docs-links) | Yes | No | No | No |
| Host tests | Yes | No | No | No |
| Browser specs/configuration | Yes | Yes | No | No |
| Renderer, including assets | Yes | Yes | Yes | No |
| Android packaging/native sources | Yes | No | Yes | No |
| Shared source pin, dependencies, unknown paths | Yes | Yes | Yes | Yes |
| Individual workflow | Yes | Its automatic lane | Its automatic lane | Its automatic lane |

Existing browser-spec-only edits select exact changed spec paths. Up to three
development spec files use one shard; larger edits use six parallel shards, because the heaviest of four reached the 60-minute job limit. Production-only specs run just the production project; development-only
specs skip production and unrelated speech-profile qualification. Shared helpers,
deleted or renamed specs, application code, dependencies and unavailable diffs keep
the full inventory. File selectors are validated and escaped, then passed as process
arguments without a shell. This shortcut changes test scope only when no executable
application/shared input changed.

The production browser server audits the exact freshly built flag-off bundle before
serving it. CI no longer builds a second unused flag-off bundle in that job. The
separate test-mocks bundle still receives its own audit.

Repository verification runs once in parallel with Chromium's six shards and
Android, instead of four times per event. Browser shards remain parallel; a failing matrix cancels siblings to limit wasted minutes.
On October 8 the owner requested removal of all smoke tests and checks. The aggregate
smoke runners, their emulator CI jobs, the provider diagnostic job and smoke-only APK bundles
are removed. Two emulator jobs remain, `native` and `recovery-ui` in
`.github/workflows/resident-android.yml`; they run only on an explicit dispatch or when
the repository variable `ELIZA_RESIDENT_QUALIFICATION` is `push` or `nightly`, and no
passing run of either is recorded for the current source. Round 8 added
`.github/workflows/android-emulator.yml`, whose three emulator jobs have no trigger but
`workflow_dispatch` and run only the suite the dispatch names (see "Explicit, expensive
qualification"); none of them has been dispatched. Distribution APK builds, repository checks and browser regression tests remain.
`.github/workflows/dependency-audit.yml` runs the network advisory audit weekly and on
dispatch (one short hosted job, read-only, no secrets; docs/dependency-audit.md). It is not a
required check, and a change to it selects Repository verification only.
Main pushes run affected repository verification, including the production bundle
audit, and the affected Android foundation build of both variants, so a merge that
breaks packaging is visible on the exact main commit. They do not repeat PR browser
shards. Each main push runs in its own concurrency group, so a later push neither
cancels it nor drops it while queued; PR runs still cancel superseded runs. Resident
push and nightly runs use their own groups too and never cancel a dispatched run. The repository ruleset requires PRs.

Round 10 added no job, step or network access to any run. Gradle dependency verification
(`android/gradle/verification-metadata.xml`) is enforced by the Gradle build the Android
foundation job already runs; its offline check and the SBOM tests are part of `npm test`;
and the build writes `artifacts/sbom/alphaphone.cdx.json` offline, uploaded with the
existing build evidence. Rewriting the metadata (`npm run android:deps:write-verification`)
is a local command and is never run by a workflow.

The production browser project runs `test/browser/production-surface.spec.ts` and every
`test/browser/<name>.production.spec.ts` against the flag-off build. A package that
adds a flag-off assertion adds such a file; no configuration change is needed.

## Required checks

Browser shard names depend on the selected shard count, and skipped matrix jobs
report unexpanded names, so the shards cannot be required directly. Each workflow
therefore ends in a stable aggregate job: **Browser MVP result** (needs the change
gate, Repository verification, every Chromium shard and the production surface)
and **Android foundation result** (needs the change gate and `build`). An aggregate
passes when every lane the change gate selected succeeded and unselected lanes were
skipped; a selected lane that failed, was cancelled or was skipped fails it
(`scripts/ci/required-result.mjs`). Reference-only changes therefore stay mergeable
with only the change gate and the two short aggregate jobs.

The ruleset below (`scripts/ci/required-checks-ruleset.json`, integration 15368 is
GitHub Actions) requires those two aggregates and Repository verification on the
default branch. It was written as additive to the AlphaCompute "Default branch
baseline" ruleset (PR required, no deletion or force push); that ruleset did not move
with the repository to eliza-research, where on October 28 `main` had only classic
protection against force push and deletion (docs/runbooks/679-main-required-checks.md). Up-to-date branches are not required:
that would force a rebase and full rerun of every open PR after each merge. A
semantic conflict between two green PRs is instead caught by the main-push
verification and Android build. Applying it changes repository settings and needs
the owner's explicit approval; it had not been applied when this was written.

```json
{
  "name": "Main required checks",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "Repository verification", "integration_id": 15368 },
          { "context": "Browser MVP result", "integration_id": 15368 },
          { "context": "Android foundation result", "integration_id": 15368 }
        ]
      }
    }
  ]
}
```

```sh
# Owner-approved only. Creates the ruleset; it does not modify the baseline ruleset.
gh api --method POST repos/eliza-research/alphaphone/rulesets --input scripts/ci/required-checks-ruleset.json
# Confirm:
node scripts/ci/read-required-checks.mjs --repo eliza-research/alphaphone
```

Android still checks both standalone and launcher, debug and release outputs and
flag-off production isolation. Renderer changes select Android because renderer
bytes are packaged into APKs. Gradle dependency/build caching reduces repeat setup;
speech sources/models retain hash verification and generated native speech is still
built fresh. No unverified generated runtime cache replaces qualification.

`node scripts/verify-upstream.mjs` also reports whether elizaOS `develop` reaches
the pin, from the recorded compare in `scripts/ci/upstream-reachability.json`; CI
never networks for it. The default warns; `--upstream-reachability=fail` or
`ELIZA_UPSTREAM_REACHABILITY=fail` makes an unreachable or stale record fail, and
`off` skips it. Refresh the record after a pin change with
`node scripts/verify-upstream.mjs --record-reachability` (uses `gh api`).

## Integration and end-to-end coverage

The host suite exercises complete adapters, HTTP protocols, real filesystem and
subprocess boundaries, native component interactions, and packaging commands.
Browser tests exercise the rendered application and its persistent stores. Root-view
empty-state, landmark and keyboard checks share one fresh page per view/theme,
removing 48 repeated loads and fixed waits. Configured Maps recovery supplies its
own worker-scoped fixture server; it no longer depends on an unset global build
variable. Retired local-agent Notes UI journeys and their PCM helper table are
removed; current Cloud-bound capture/save/playback E2E and explicit real-host
playback qualification remain. Unit
helper tables, source-text/regex assertions, extracted-method harnesses, and
upstream unit-suite forwarding are removed from the consumer suite. Shared
behavior is tested through its product integration; upstream owns its unit tests.
This includes retiring the secure-store helper harness that cloned and repeatedly
authenticated the entire upstream tree to test one input-reading helper. The real
Android build still stages and compiles those sources; Git/source-admission
integrations retain corruption and incomplete-checkout coverage.
The Whisper model/runtime transcription test remains, including silence and
cancellation. Type checking, production bundle auditing and APK inspection remain
build gates. The host verification job keeps JDK/JSON inputs for native component
integration, but no longer installs an Android SDK used only by removed harnesses.

Verification prepares the pinned client source and speech inputs once, then runs
the existing commands without repeating their individual preparation hooks. Standalone
commands keep their preparation hooks. Verification builds and audits the production
bundle once. Two older host tests
that rebuilt the same bundle, and a duplicate Cloud protocol invocation, were
removed. The restart runner keeps a successful integration for every campaign
configuration, but exercises shared rejection cases once instead of multiplying
them across six configurations. CI selection is tested through its actual CLI,
a temporary Git repository and Actions output files.

The automatic Android lane passes `--skip-instrumentation`: it still builds both
standalone and launcher, debug and release, and runs lint and APK inspection.
Manual builds and archives retain their instrumentation APKs. Native speech uses
up to four compiler jobs, bounded by the runner CPU count, within each ABI; its shared workspace is locked, so
ABIs stay sequential. Already-compressed APK uploads use compression level zero.
Browser reports, traces and screenshots upload only on failure; passing test
counts and timings remain in Actions logs.

These changes reduce repeated work; they do not establish emulator HOME-role,
resident execution, full AOSP boot, live-provider or device acceptance.

## Explicit, expensive qualification

Alpha Phone ships Android WebView. Chromium remains automatic for affected PRs.
Firefox and macOS WebKit are additional portability qualification and are now
opt-in, including the real macOS audio-recording coverage. Full resident builds
are opt-in; focused native campaigns are separate manual runs. The resident workflow
also has push-to-main and nightly triggers that stay inert unless the repository
variable `ELIZA_RESIDENT_QUALIFICATION` is `push` or `nightly`; set it only for a
period that needs PACKAGED release qualification on every main commit or daily. Preparation remains automatic for changes
to shared/build inputs. The Bun seccomp reproduction is a diagnostic, not a routine
gate. The only schedule is that opt-in resident trigger; there are no hidden
branch-specific automatic diagnostic runs.

```sh
# Use the reviewed branch/ref. Native resident dispatch retains its qualification campaigns.
gh workflow run browser.yml --ref main -f cross_browser=true
gh workflow run android.yml --ref main
gh workflow run resident-android.yml --ref main -f runtime_profile=native
# Build genuine Cloud-profile QA APKs without native/test-mocks campaigns.
gh workflow run resident-android.yml --ref <reviewed-ref> -f runtime_profile=cloud
gh workflow run resident-prepare.yml --ref main
gh workflow run bun-spawn-seccomp.yml --ref main
```

The resident workflow's manual `runtime_profile` choice defaults to `native`.
Push and nightly runs always use `native`. Choosing `cloud` reuses the exact source,
preparation, workflow-worker and runtime provenance checks, then stages the Cloud
profile and uses the same archive builder for all four flag-off APKs. The separate
test-mocks archive, private peer helper and native/recovery emulator campaigns are
skipped for Cloud. No provider credentials or live provider calls are used.

Cloud archives upload as `resident-cloud-archive-<sha>-<run>` with three-day
retention. They include standalone and launcher debug APKs, release build outputs,
source snapshots and packaged-runtime verification. They are build evidence;
unsigned releases and missing device/native-speech qualification do not become
release acceptance. Inspect the terminal result and retain needed artifacts before
expiry. A later dispatch on the same ref still cancels an earlier dispatch, including
one using the other profile.

### Emulator evidence (`android-emulator.yml`)

Dispatch only: no push, pull request, schedule or reusable-workflow trigger, and no
other workflow starts it. `test/ci-emulator-evidence.test.mjs` fails if that changes, if
an action in it is not pinned to an exact commit, or if an emulator job stops uploading
its results. The same test requires every action in every workflow file to name an exact
commit with its release: round 8 replaced the four major-tag references the older
workflows still had (`android-actions/setup-android`, `gradle/actions/setup-gradle`,
`reactivecircus/android-emulator-runner`, `oven-sh/setup-bun`) with the commits those tags
resolved to on 2026-10-10, so no workflow's behaviour changed. A change to the file itself selects no automatic lane. One `build` job
repeats the Android foundation build's APK steps with the instrumentation APKs (and a
second Gradle build for the test-mocks pair when the reading suite is selected); for the
speech suite it also builds the x86_64 fused libelizainference voice host, admits it into
that workspace only as an unreviewed hosted CI build, and stages the pinned voice bundle
into the developer APK ([fused speech](fused-speech.md)); each selected
suite then boots one API 35 x86_64 emulator. No run exists yet, so no duration is known:
the `build` job is limited to 150 minutes and the emulator jobs to 90, 90 and 60. A later dispatch of the same suite on the same ref cancels the earlier one.

```sh
# Default instrumentation classes on both distributions (flag-off developer APKs).
gh workflow run android-emulator.yml --ref <branch> -f suite=instrumentation
# Reading and page-question classes on the pinned Chromium 157 WebView; also builds the test-mocks pair.
gh workflow run android-emulator.yml --ref <branch> -f suite=browser-reading
# The fused-speech classes on x86_64 against the voice bundle and engine built in that run.
gh workflow run android-emulator.yml --ref <branch> -f suite=fused-speech
# All three after one build.
gh workflow run android-emulator.yml --ref <branch> -f suite=all
```

| Suite | Job | Runs | Artifact (3 days) | Fails when |
| --- | --- | --- | --- | --- |
| `instrumentation` | `instrumentation` | `npm run test:android:instrumentation` with its default classes, standalone then launcher | `android-emulator-instrumentation-<sha>-<run>-<attempt>`: `test-results/android-instrumentation/ci-default/` (`results.json`, raw output per class), `test-results/emulator-suite/instrumentation.json` | any class is failed, skipped or missing |
| `browser-reading` | `browser-reading` | `scripts/prepare-ci-webview.mjs` (WebView 157.0.8083.0), then BrowserReadingNavigation and BrowserPageQuestion on the flag-off pair and BrowserReading, BrowserSensitiveReading and BrowserIsolatedReading on the test-mocks pair | `android-emulator-browser-reading-…`: `ci-reading/`, `ci-reading-test-mocks/`, the provider provisioning evidence | the provider cannot be installed, or any class is failed, skipped or missing |
| `fused-speech` | `fused-speech` | Refused in the build job until hosted Paradee staging exists (the voice outputs need a same-engine embedding host, which needs a reviewed receipt at this pin). When enabled: `scripts/ci/speech-candidate.mjs check` on the standalone APK, then LocalSpeech, LocalSpeechBridge, SpeechSentenceCancellation and VoiceNoteReadAloud on standalone with networking off | `fused-speech-x86_64-…`: `test-results/fused-speech-x86_64/` (the instrumentation record, the APK pair, `result.json`) | the APK carries no voice bundle or is not the recorded bytes, or any class is failed, skipped or missing; without the ASR slot pair transcription is not evidenced |

The suites are implemented in `scripts/ci/emulator-suite.mjs`, which refuses to run
outside a GitHub-hosted runner. Results are emulator-class evidence for developer-override
APKs built in that run (resident runtime not packaged, voice host an unreviewed hosted
build) on an x86_64 SDK image. They are not evidence for a distributable build, an arm64
device, the AOSP image or acceptance. The speech job covers one ABI: admission still needs
arm64-v8a hardware (class D) and a reviewer named by a person, and only that review edits
`android/voice-host/qualified-voice-host.json`. No job admits anything. Artifacts expire after three days; copy what a ledger cites.

Before distributing a new runtime/APK, explicitly run resident qualification on
the reviewed revision and inspect its terminal result. A green ordinary PR does
not claim resident execution, Firefox/WebKit, full AOSP, physical-device or real
integration acceptance. Later dispatches on the same ref cancel older runs;
use separate reviewed refs for intentionally concurrent qualification.

Temporary Actions evidence expires after three days. APK transfer bundles are
uploaded once, with the R8 `artifacts/mapping/*.txt` files of their release APKs
(the resident archive retains its mappings and `release-mappings.json` hashes), rather than included again in the generic build-evidence artifact.
Preserve release evidence separately before expiration. Existing uploaded artifacts
are not deleted or shortened by this change.

## Baseline measured October 7, 2026

The Actions API returned 2,685 runs from September 29 through October 6:
1,144 Android foundation, 1,111 Browser MVP, 312 resident Android, 59 preparation,
55 Bun diagnostics and four retired overlay diagnostics. Conclusions were 1,365
cancelled, 961 failed and 359 successful. This is an unusually high-volume week,
not a normalized monthly projection.

Removed automatic duplication includes 587 Android main pushes, 578 full browser
main pushes, 267 resident pushes and 53 diagnostic pushes in that history.
Browser main pushes now retain only repository verification when needed.

[Browser run 37504530726](https://github.com/AlphaCompute/alphaphone/actions/runs/37504530726)
used 186.8 Linux runner-minutes and 10.2 macOS runner-minutes (197.0 total). Its
first Chromium shard spent 9.2 minutes repeating `npm run verify` before 43 minutes
of browser tests. The other two shards also repeated verification. Moving this
check to one parallel job avoids two copies, plus the Android copy.
[Android run 37504530731](https://github.com/AlphaCompute/alphaphone/actions/runs/37504530731)
used 95.4 runner-minutes; [resident run 37504530771](https://github.com/AlphaCompute/alphaphone/actions/runs/37504530771)
used 84.8. Their emulator failures predate this CI-policy change.

For an affected renderer PR followed by a merge, applying this policy to those
latest durations removes the second full browser and Android runs, the resident
run, cross-browser portability checks and redundant verification. This suggests
roughly a 60–70% reduction in runner time for that scenario, before path skips,
Gradle cache savings and failure cancellation. It is an estimate, not observed
post-change billing; manual qualification frequency and future change mix matter.

The legacy run timing endpoint returned zero billable milliseconds despite real
job durations. No dollar or invoice claim is inferred from those zeros. Compare
the organization's billing export and Actions metrics after a week of this policy;
track Linux minutes, macOS minutes, cancelled minutes and artifact storage separately.
