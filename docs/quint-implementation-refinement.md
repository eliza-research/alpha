# Quint implementation refinement

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
component projections.

- `AlphaDataReset` now commits an initial budget before its pending marker and
  reserves each attempt before listener or Android effects. A process mutex and
  file lock serialize the main and recovery processes. Missing legacy budgets,
  failed durable writes and contended locks defer automatic effects. The real
  coordinator passed 20 traces with 368 checkpoints and 54 direct assertions,
  including two JVM processes competing for the last automatic slot. These
  receipts are included in the native aggregate. Android power-loss behavior,
  device approval and externally observed erasure remain platform obligations.
- `AlphaCloudSignInPlugin` now retires the exact pending record by compare-and-
  exchange before exchange or successful cancellation. A stale callback cannot
  adopt a new attempt, and queued cancellation still retires its captured record
  when a newer email or phone attempt exists. Seventeen full-plugin schedules
  check 152 checkpoints. Separate activation state preserves an older saved-key
  acknowledgement while a newer interactive attempt waits or persists. Restart
  drops the unavailable previous-token capability and retains a newer durable
  pending record. The composition model now includes that overlap explicitly.
- Settings groups and rows now have stable semantic keys. The actual Chromium
  renderer preserves focused About identity when a delayed permission result
  inserts Finish setup. One source trace checks five checkpoints. Other mutable
  lists remain under review in the
  [focus identity audit](../specs/quint/refinement/application/focus-identity-audit.md).
- The permission walkthrough now checks live credential identity and invalidates
  its generation in a layout effect. A deferred passive effect cannot let a
  request from a retired account or disabled surface advance setup. Twenty-eight
  source traces check 174 checkpoints across all 19 modeled fields, including
  failed storage, completed remounts and stale completion during a newer request.
- The complete resident plugin rejects `stop` and `cancelStart` from a destroyed
  bridge. Ten source schedules check 51 checkpoints, including another attached
  surface and broadcast admission racing stop. Full stream, credential-mutation,
  recovery and installed-service behavior retain additional obligations.
- Main chat integration now has a mounted Chromium driver exercising the actual
  shell, installed agent adapter and controller. It covers Back while a reply is
  pending, same-view navigation, view retirement, visibility and page suspension.
  The shell model distinguishes hidden chat from the input bar and increments
  context revisions when the context changes. Claimed navigation, sensitive
  subviews, draft recovery and arbitrary message interleavings remain open.
- The vault coordinator has four additional source traces with 24 checkpoints.
  They observe typed-draft clearing, generation changes, discarded reset review
  and native cancellation after leaving. The model separates a pending native
  operation from the cleared review. Only secret-presence Booleans enter these
  receipts. Save, remove, transfer and origin-bound fill remain separate work.

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

The default refinement command runs the application, services, native and
composition campaigns. A subset can be selected with `--families=application`,
`--families=services`, `--families=native` or `--families=composition`. Reports are
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

The refinement worktree's local Android build stops at the voice-input preflight.
Qualified on-device voice outputs have not been staged into that isolated tree.
APK verification reports missing APKs. Neither distribution variant is validated
by those attempts. APK generation, installed emulator HOME behavior, full AOSP
boot, real integrations and physical-device/user acceptance remain separate
requirements.

## Completeness

The executable campaigns establish their stated finite or bounded projections.
A universal simulation relation covering every supported source state and all
permitted interleavings remains open. Provider responses, Android execution,
physical audio, durable power-loss behavior and actual reset erasure require
additional contract or integration evidence. The source ledger's file coverage
does not discharge those obligations.
