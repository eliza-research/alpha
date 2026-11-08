# MainActivity renderer recovery refinement

The campaign compiles the complete product `MainActivity` and
`RendererRecoveryBudget`. It invokes the installed WebView listener, Activity
lifecycle entrypoints and native escape buttons. Android and Capacitor primitives
are controlled through `main-activity-platform.mjs`. The fixture records scheduled
callbacks, view destruction, rendered button trees, task movement and Settings
launches. Plugin registrations use inert classes because their individual
lifecycles are separate source campaigns.

## Observation relation

The budget's private `started`, `windowStart` and `lossesInWindow` fields map
directly into Quint. The budget is static within the application process. New
Activity instances retain it, including when the task's last Intent is a sign-in
return. A new JVM starts with a fresh budget. The production implementation does
not persist this counter to disk across process death.

`recoveringRenderer`, the selected Activity's flags, its actual bridge reference,
its WebView destruction flag and the controlled callback queue supply the
recovery projection. The selected Activity has a finite identity. The callback's
observed delay and the native escape tree supply the recovery decision. A positive
remaining delay maps to the finite 5,000 ms class.

The model now distinguishes the source's `recreate()` request from later Android
destruction and creation. Existing helper-only traces retain their combined
`recreateCallback` transition. `recreationCompleted` also represents a
configuration-driven replacement after destruction. No recovery request is
required for that Android lifecycle path.

The handoff projection reads `unackedFrontStarts` and `handOffUnreliable` directly.
Actual calls also assert that a handed-off instance never loads its bridge,
destroys its unused inflated WebView and finishes or removes exactly the
appropriate task. A marker-created instance does not launch another fronting
Intent. After three unanswered fronting attempts or a failed start, subsequent
ordinary starts may create an independent page. The projection follows the
selected page and retains the shared process budget.

## Corrected per-task ownership

The source campaign reproduced a loss of HOME classification after the fallback
permits another task. The original code retained one `liveTaskId/liveTaskHome`
pair. A standard task replaced that pair, then the older HOME task was recreated
with its stored sign-in Intent. It became classified as standard and lost the
native escape decision despite an exhausted crash budget.

`MainActivity` now retains the kind separately for each task and weakly identifies
the current Activity that owns that record. Non-finishing recreation keeps the
record. A finishing owner removes it only when the record still refers to that
exact instance. A delayed old teardown cannot erase a successor's record, and a
later task-id reuse receives a fresh classification. The Quint projection uses
two task identity classes and reads the real retained map at each checkpoint.

## Exercised schedules

- Three immediate renderer recoveries followed by HOME escape or non-HOME
  backoff, including standalone and assistant surfaces.
- Foreign and duplicate renderer callbacks, closed Activities, and a posted
  callback delivered after an independently recreated successor.
- Exact 60-second boundary, expired window and backwards clock observations.
- Native Reload followed by another loss, preserving the exhausted process
  budget.
- Available, unavailable and failing stock Settings handlers, including the
  Home/default-apps/Settings fallback order.
- Missing system WebView, page-load insets, focus return, HOME intent, resume and
  configuration callbacks.
- HOME and standard task handoff, task movement, same-task delivery, unreadable
  foreign extras, front-start acknowledgement, failed fronting, marker-created
  instances and the unanswered-fronting budget.
- HOME-task restoration after an independent standard task, delayed finishing of
  the old Activity after replacement, and reuse of a finished task identifier.

## Evidence and boundaries

`checkRendererCoordinator(extraSources)` returns the shared checked receipt and
accepts an aggregate runner's provenance source paths. The receipt is written to
`test-results/quint-refinement/RendererRecovery-main-activity.json` and retains
the full trace input, source/adapter hashes, generated-port fingerprint and
per-field/action coverage.

The controlled superclass supplies framework construction, destruction and task
facts. It does not execute Android or the complete Capacitor bridge. Actual
renderer-process termination, ActivityManager task selection, pixel visibility,
accessibility, platform Settings resolution and vendor WebView behavior remain
device/emulator obligations. The bounded projection follows one selected page
and process-wide handoff counters. All simultaneous view trees after unreliable
handoff and all possible Android callback schedules remain additional work.

```sh
node --test test/quint-renderer-refinement.test.mjs
node scripts/check-quint.mjs check --models=RendererRecovery --samples=1000 --steps=80
node scripts/check-quint.mjs verify --models=RendererRecovery --steps=6 --server-endpoint=localhost:8896
```

## Validation

The final source campaign passes 27 schedules and 282 observed checkpoints.
All source and driver hashes are bound before execution and remain unchanged.
The model passes 16 scenario tests, 1,000 sampled runs of 80 steps, and symbolic
safety checking through six steps from `init`. The seven existing recovery,
handoff and Java policy-conformance tests also pass. The source inventory gate
accepts the reviewed MainActivity hash and updated anchors.
