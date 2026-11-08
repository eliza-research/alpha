# Quint implementation refinement

This document preserves the historical source-trace campaign at `41d178701e`.
The integrated application uses the current reviewed upstream pin and the
reconciled source owners recorded in the family manifests. The archived receipt
keeps its original source hashes and does not certify the integrated tree.

## Published source baseline

The migration and its required product-source prerequisites are in draft PR 825.
The base is `claude/finish-open-issues`, the published source lineage of the
starting checkout. The prerequisite changes are a separate commit. The original
working tree was preserved. The upstream pin remains
`b25d8aef2916385c571f4367e099809254fde0bb`.

## Executable relation

Every adapter executes product code and records an explicit projection of its
state and effects. The checker generates Quint scenarios that require each
recorded checkpoint to match the named model transitions. It also checks
rejected actions, stuttering and each registered model safety invariant. Deliberately wrong observations and changed
source hashes are tested as failures.

Receipts retain concrete inputs, observations, exercised actions, assumptions,
Quint output and hashes captured before implementation execution. Imported model
dependencies are hashed transitively. The aggregate rejects stale receipts and
fails the full campaign when a runtime model has no passing current receipt.

`complete-finite-helper` applies only to the enumerated helper domain stated in
its receipt. `bounded-component` and `bounded-orchestration` preserve their
schedule and projection limits. The aggregate records unobserved fields and
unexercised actions as open obligations. `--require-complete` fails while the
universal application refinement obligation remains open.

## First checked source milestone

At commit `41d178701e`, all 51 runtime models have current source-bound receipts
covering 1,392 concrete traces and 9,769 checked checkpoints. The 52 receipts
include two ResidentRuntime campaigns. The application, native and composition
cohorts were retained from the integrated run, and the services cohort was rerun
after repairing asynchronous scan polling. The combined inputs were checked
against the current files before saving
[`refinement-baseline.json`](../specs/quint/evidence/refinement-baseline.json).
This is a bounded correspondence milestone. The full command and deeper
coordinator obligations continue below.

## Corrections found through source execution

| Component | Finding and change | Remaining boundary |
| --- | --- | --- |
| Scan document | Explicit save and load now retain user ownership across later autosaves. Confirmed export only deletes an automatic draft. The preservation predicate is a safety invariant. | Actual document-provider persistence and PDF content retain separate integration tests. |
| Maps route admission | The source regression now follows the current free-flow and live-traffic route contract. A free-flow route remains valid when the provider also supports live traffic. | GPS, route-provider correctness and physical guidance retain separate integration requirements. |
| Renderer recovery | The loss counter now saturates after the immediate-recovery budget, preventing integer overflow from reopening that budget. | Visible Android Activity/WebView escape behavior needs platform evidence. |
| Startup permissions | The model separates volatile prompt ownership from a best-effort durable attempt marker. A failed marker write can allow a new flow to request permission again. | OS permission behavior is an environmental contract. |
| Draft dispatch | A failed release write with readable storage enters conflict review. The model distinguishes this from an unreadable store or failed clear. | Broader concurrent edit schedules remain explicit obligations. |
| Durable store | The final legacy check occurs before the document CAS finishes. A late external legacy write is detected on the next read. The original stronger cross-store condition is retained as a falsifiable property. | An atomic guarantee across external localStorage and document transactions is unresolved. |
| Resident runtime | Ordinary stop, confirmation failure, owned cancellation and attached cancellation now have distinct model transitions. Stop retires enrollment before confirmed process termination and retains provider configuration. | Native service locks and process shutdown require Android integration. |
| Application composition | Pending replacement keeps the existing account available, with committed owner generation separate from attempt generation. Stop and cancellation are composed with voice retirement. A real renderer-controller campaign observes account sign-out and replacement under isolated native/provider ports. | Intermediate events and cross-domain voice, Calendar, Inbox and reset schedules remain open. |

## Further coordinator findings

The next source-driven tranche executes complete coordinators beyond the first
component projections. Its failing traces remain explicit work items.

- `AlphaDataReset` preserves an existing retry count for manual attempts. The
  current model resets that count. Failure-budget write errors can also leave a
  missing budget and admit another automatic reset on every process launch.
  Durable admission and storage-failure transitions need implementation and model
  refinement together.
- `AlphaCloudSignInPlugin.resumeAcknowledgements` finishes the saved-key
  acknowledgement without the previous token held by an interrupted interactive
  call. The model currently retains that token across restart. The recovered
  state must preserve uncertainty about previous-session revocation.
- Positional Settings row keys can retarget an already-focused button when delayed permission data inserts a group. Stable group/row identity is being added and checked through the real renderer.
- Main chat integration uses `installAgentAdapter` and separate draft-recovery
  state. The first `AlphaClient` and `AssistantDraftController` projections leave
  that live coordinator work open.

## Reproduction

Use the pinned Node and npm dependencies, JDK 21 and the pinned host JSON jar.
CI prepares the JSON jar with `scripts/ci/prepare-host-test-json.sh` and installs
Chromium with `npx playwright install --with-deps chromium`.

```sh
npm run upstream:prepare-client
npm run quint:refinement
npm run quint:check
npm run verify
npm run android:build:local
npm run android:verify
```

The default refinement command runs the application, services, native,
composition and translated core campaigns. Use `--families=legacy` for the
translated source campaigns, or select `application`, `services`, `native`,
or `composition`. The summary includes the full model registry and identifies
models without a passing receipt from the selected campaigns. Reports are
written to `test-results/quint-refinement/`. CI retains model and source trace
evidence as artifacts.

## Verification repairs

The prerequisite snapshot carried stale Settings selectors and source-pin
ledgers. Their checks now follow the current product surfaces and pinned source.
The Calendar host test declares its Zod dependency directly. Committed notices
use the source-only form, with packaged-runtime notices generated by the Android
staging build.

The scan driver polls asynchronous IndexedDB results with awaited polling. The
pinned browser poller treats an unresolved Promise as truthy, so an async
`waitForFunction` predicate could sample a draft before the write completed.
SMS capacity checks use the production journal Storage interface. Separate
small file-adapter checks retain actual file write and reload coverage, while
capacity checks avoid hundreds of host-only fsync operations.

## Platform validation

The initial local Android attempts stopped at input preflight. The current
worktree staged the recorded voice outputs and verified their integrity with
the exact pinned FFI checkout. Its voice admission record remains unqualified.
The reviewed ARM64 embedding libraries and pinned model separately passed
admission using the repository qualification receipt. The local build and APK
verifier passed on commit `839325d966` for the standalone and launcher debug
and unsigned release APKs. Both unsigned releases report
`distributable: false`. The build also generated both instrumentation APKs.
Installed emulator HOME behavior, full AOSP boot, real integrations and
physical-device acceptance each require their own evidence.

## Completeness

The executable campaigns establish their stated finite or bounded projections.
A universal simulation relation covering every supported source state and all
permitted interleavings remains open. Provider responses, Android execution,
physical audio, durable power-loss behavior and actual reset erasure require
additional contract or integration evidence. The source ledger's file coverage
does not discharge those obligations.

## Current SDK refinement checkpoint

The follow-up uses shared SDK `99b49439ce9d0cb5607e9831b9f7f58d89525029`.
The authenticated Android mobile producer passed module-load and pre-provider
smokes. It parsed 9,988 inputs, including 4,338 first-party inputs, 4,090 tracked
inputs and 248 generated inputs with origin mappings. The graph binds seven
Task, Notes, turn-controller and room-queue source transforms to the producer
receipt.

`CoreTurnControllers` checks 17 schedules and 105 checkpoints across two real
registries, observing all 17 model fields. The current SDK adds closure, so a
closed registry starts later handlers with an aborted signal. Reclosing changes
the reason for future starts while retaining the first reason of an already
aborted turn. The actual source tests use controlled handlers to check both
cooperative rejection and noncooperative completion.

The native port checks capture frame buffering, piped capture, ASR pipe
settlement, indicator ownership, listener persistence and listener teardown.
The six focused campaigns pass 131 schedules and 817 checkpoints. The Notes and
Task campaigns exercise the real runtime/store, controlled provider or worker
ports and real SQL where applicable. Their finite schedules and the current
source ledger leave explicit obligations for broader composition and device
behavior.

The translated core protocols also run against current source. The scheduler
campaign compares 10 real daemon schedules and 89 checkpoints, including
restart, stop, pending query ownership and a stopped-admission canary. The
interaction campaign compares 12 schedules and 121 checkpoints across the
real authority and SQLite journal. The semaphore campaign checks eight
schedules and 69 checkpoints with actual abort dispatch, including reentrant
release before cancellation. The serialisation campaign covers all 24
invocation orders and 254 checkpoints with sampled arrival and outcome timing.
The expanded scheduler campaign checks 125 additional checkpoints across 10
schedules for batched agent queries, owner replacement, process disposal and
shared timer ownership. The room handler queue compares both translated
profiles against the real FIFO and writer tail across six schedules and 112
checkpoints. The authenticated patch reserves capacity before publishing queue
telemetry, including synchronous listener reentry.

`NativeListenerInput` compares 20 real Java schedules and 108 checkpoints
through capture, the speech gate, ASR, and wake callbacks. It covers an input
read that outlives its epoch across microphone privacy, the playback guard
boundary, call and recording gates, ownership loss, and PCM cleanup. A
separate regression exercises failed durable capture admission and checks that
it leaves recognition fenced.
The separate speech-gate campaign checks 11 segmentation schedules, including
adaptive noise thresholds, circular pre-roll, utterance length and reset.

The Files filter and Google consent campaigns compare 17 and 16 source
schedules respectively. The browser deletion poll checks six Calendar and
Reminder schedules. It reproduces the old duplicate CAS revision and checks
that competing polls preserve the first committed revision. The pilot APK
update campaign uses scripted ADB and an actual temporary rotation journal to
compare 12 schedules and 149 checkpoints, including uncertainty after an
ambiguous install reply.
