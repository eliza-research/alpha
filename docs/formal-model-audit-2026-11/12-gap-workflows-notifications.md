# 12. Gap pass: Workflows and Notifications

Single-pass findings from a second auditor covering files the first pass read only in part. Not adversarially verified; each is re-verified before a fix.

## A. Model-vs-code discrepancies

1. **Owner switch does not cancel.** `WorkflowExecution.qnt:81-85` sets `cancelRequested` for running/submitting/uncertain. `workflow-adapter.ts:322` calls `clear()`, which only aborts the local fetch (`:71`); `client.cancel` is reached only from the explicit `cancel()` (`:292`) and lifecycle (`:308`). The agent run continues.
2. **`reconcile(false)` is not an automatic resubmit.** The model returns to "submitting" and `admit` (`qnt:51-56`). Code needs a second owner tap (`adapter:266`) and drops the intent when the version changed (`adapter:170`). The model has no "abandoned, known non-run" transition and no concurrent version change during submitting.
3. **Legacy admission is not version-fenced.** Model `admit` requires `reviewedVersion==version` (`qnt:45`). Without `manualSubmissionProtocol===1` the body is `{input:{}}` and the only check is a client-side read first (`protocol:97-98`). `activate` (`protocol:96`) has the same gap on every agent.
4. **`cancel` in submitting/uncertain** (`qnt:72-75`) has no code path: `cancel()` needs a receipt (`adapter:292`).
5. **`DisabledTriggersEmpty` holds only at the dispatch gate.** The persisted queue is filtered inside an unblocked foreground tick (`trigger-runtime:70`); the badge reads the raw queue (`simulated-workflows.ts:87`).
6. **`NoticesAndCaches` retry has no driver.** `NoticeOwnerCoordinator` sets `retryNeeded` (`notice-owner-coordinator.ts:17,24`) but retries only on the next `update()` (connection event or resume; `adapter:220,322`).
7. **`tap → consumed → acknowledge`** (`qnt:51-58`): code opens the run before consuming (`adapter:112-114`), and Ask taps add a `discard` path back to untapped (`workflow-notice-taps.ts:7-8`). Neither is modelled.
8. **`NotificationCollection.act`** covers external rows only. Own-row dismiss checks via `list()` and then edits with no in-transaction recheck of lock or revision (`notifications.ts:96`); external rows recheck inside the edit (`:85-88`). `pause` has no browser implementation; only resume exists (`:47`).

## B. Unmodeled state machines

1. **Intent journal** (`workflow-intents.ts`, both adapters). States: absent / retained / stale snapshot (reads as locked, `:38`). Events: admit, acknowledge, invalidate, cross-tab change, recovery reset. Invariant at risk: every retained intent eventually reaches a terminal acknowledgement (see C1, C2).
2. **Approval-decision intent** (`adapter:286-290`, `276-282`): pending / retained / matched / known non-decision. Invariant: at most one decision per (node, iteration, digest).
3. **Typed-save draft** (`workflow-authoring.ts`): editing / review / pending / unreceipted / resendReview / refused / committed, plus `storage.failed`. Invariant: one mutationId gives at most one save; a pending draft is never edited.
4. **Trigger runtime** (`trigger-runtime.ts`): scanning / blocked / stopped × foreground × watching. Invariant: one flow's failure does not starve the others.
5. **Location cursor** (`workflow-triggers.ts:35,57`): no cursor / inside / outside / ambiguous, keyed by placeKey. Invariant: every observed inside-to-outside change yields exactly one occurrence.
6. **Notice-tap resolver** (`adapter:89-117`): tapBusy / tapRequested / noticeQuestion against the `generation` epoch. Invariant: a pending tap is eventually opened or reported.
7. **Automations adapter** (`automations-adapter.ts`): idle / loading / ready / failed × controller × `uncertain` × editor / review.
8. **Approval-notice queue vs owner transition** (`adapter:196-216`): the native withdrawal runs immediately (`notice-owner-coordinator.ts:15`) while posts wait in the chain. Whether native `postApproval` rejects a stale-owner route was not read (`AlphaHostedResultsPlugin.java:49-54,60`).

## C. Defects

**Earlier-claim verdicts**

| Claim | Verdict |
|---|---|
| Legacy submit sends no submissionId/expectedVersionId | Confirmed (`protocol:97-98`) |
| Owner switch does not cancel a run | Confirmed (`adapter:71,322`) |
| One trigger error latches blocked, stops all scanning | Partly: wake events clear it (`trigger-runtime:43-44`), the 1 s timer never does |
| Location cursor resets across backgrounding, "leave" never fires | Partly: true for real-location watch mode, not for simulated coordinates |
| Clear-all re-lists per dismissed row | Partly: reminder, calendar and focus rows only |
| Automation intents have no retirement path | Confirmed |

**C1. Automation intents are never retired** (high).
- Evidence: the intent is admitted before dispatch (`automations-adapter.ts:67`) and acknowledged only on success while still `valid()` (`:68`) or on a fixed 4xx list or `AutomationOutcomeError` (`:69`). Nothing else reads `automation:` keys (grep: only `:37`). The only reset is the browser-only recovery card (`adapter:314`, `workflow-intents.ts:32`).
- Scenario: on Android, background the app during "Pause prompt". `retire()` aborts, the row shows "Outcome unknown" forever and every action is disabled (`:79,107`). 409, 429, 5xx and post-response validation errors (`automations-protocol.ts:96`) do the same.
- Worse for creates: the key is `new:prompt` / `new:reminder` (`:87`), so one uncertain create blocks all later creates of that kind (`:89`). The reminder's `idempotencyKey` (`:85`) is never reused.
- Fix: on refresh, reconcile each retained intent against the re-listed row (or re-PUT idempotently) and acknowledge; key creates by draft id or idempotencyKey; treat 409 and 429 as known non-applied.

**C2. Legacy run intents lock a workflow permanently** (high by reading; applies only to agents without `manualSubmissionProtocol`).
- Evidence: the intent is stored without `submissionId` (`adapter:243`); reconciliation is skipped unless both the protocol and a string `submissionId` exist (`adapter:162`).
- Scenario: any network error after dispatch leaves `locked()` true forever (`adapter:263,268`), with no native recovery.
- Fix: for intents without a submissionId, show history and offer an explicit "I checked; clear this request" acknowledgement.

**C3. No cancel on owner switch** (high; a model mismatch at minimum). Fix: either weaken the model to "the phone stops acting" (`execute` and `decide` already require `runOwner==owner`), or send a best-effort cancel for an open unfinished receipt before `clear()`.

**C4. Trigger latch** (high).
- Scenario: one enabled flow with an unsupported trigger throws (`workflow-triggers.ts:32`), setting `blocked` (`trigger-runtime:80`). Line 63 then skips both detection and dispatch for every flow. Each wake re-throws.
- Second cause: `seen` only grows (`workflow-triggers.ts:38,53`; location keys include `now`, `:57`). At 10,000 entries it throws permanently.
- Fix: catch per flow inside `detectWorkflowTriggers` and return errors alongside results; run dispatch regardless of `blocked`; prune `seen` to keys still in the snapshot.

**C5. Location transitions are lost across any position gap** (high, watch mode).
- Evidence: backgrounding clears `position` (`trigger-runtime:62`). The next tick has empty `placeKeys` (`:51`), so `old.placeKey!==placeKey` resets the cursor without `inside` (`workflow-triggers.ts:35`), and it resets again when a fix arrives.
- Scenario: lock the phone at home, leave, unlock: nothing fires. A fix older than 30 s does the same.
- Fix: reset only when both keys are defined and differ; otherwise keep the old cursor and `inside`.

**C6. Clear-all is O(N) full reads** (high, performance).
- Evidence: `clear` loops `dismiss` (`notifications.ts:98`). Reminder, calendar and focus rows each call `this.list()` (`:96,97`), which reads reminders, calendar alerts, workflow notices, hosted results and state twice (`:70-78`). External, hosted and workflow rows do not re-list.
- Each `changed()` also dispatches window `focus` (`:35`), which wakes the trigger runtime (`trigger-runtime:43`).
- Fix: list once in `clear`, validate identities against it, apply one batched `notificationDocument.edit`, call `changed()` once.

**C7. A notice tap can be dropped by the Home refresh** (medium; control flow read, not run).
- Evidence: `checkNotice` captures `epoch=generation` (`adapter:93`). On resume and on connection events `syncHome()` runs right after (`:322`) and its `refresh` calls `work()`, which increments `generation` (`:74`). `current()` then fails and line 102 returns silently. A retry while `operation` is set also returns (`:96`), and nothing re-checks when the work finishes (`:76-79`).
- Fix: re-run `checkNotice('event')` in `work()`'s finally, or drop `generation` from `current()`.

**C8. False "outcome unknown" after a tap-opened run** (medium).
- Evidence: `clear()` nulls `intentStore` (`:71`) and the tap path sets `detail` without loading it (`:111-113`). `lifecycleLocked` then defaults to true (`:54`), so the status reads "Removal or restore outcome unknown" (`:319`) and Run is blocked (`:263`).
- Fix: load the intent store in the tap path.

**C9. Tap consumed after opening** (low). If `consumeWorkflowTap` fails (`:114-115`) the tap stays pending and reopens the run on every later check. Fix: consume first, or remember the token.

**C10. Calendar queried every second** (medium, performance). Each tick calls `calendar.list` per event flow (`trigger-runtime:57`) and parses three localStorage documents (`:65,83`). Fix: cache the event snapshot per range, invalidated by wake events.

**C11. Own-row dismiss check-then-edit gap** (low; `notifications.ts:96`). Fix: recheck `locked()` inside the edit. Also `dismissed.slice(-500)` (`:22`) lets old still-posted reminders reappear.

## D. Modeling opportunities

**Quint**
- `IntentJournal`: admit / dispatch / ack / abort / restart / reconcile, generic over run, lifecycle, metadata, approval and automation. Invariants: `RetainedImpliesReconcilable`, `AtMostOnceEffectPerIdentity`; liveness `EventuallyUnlocked`. C1 and C2 fail it.
- Extend `WorkflowExecution`: concurrent `remoteEdit` during submitting/uncertain, an `abandon` transition, a legacy mode, and the resolved meaning of `switchOwner`.
- `TriggerScan`: per-flow cursors with a `positionKnown` flag. Invariants: `ErrorIsolation`, `TransitionNotLostAcrossGap`, `SeenBounded`.
- `NoticeTap`: tap resolution against the generation epoch with a concurrent refresh; liveness `PendingTapEventuallyHandled`.
- `TypedSave`: draft pending / unreceipted / resend / refused; `OneSavePerMutationId`.
- `NotificationCollection`: add own-row dismiss and batch clear with `ClearEquivalentToSequentialDismiss`.

**Pure functions suited to pre/postconditions**
- `detectWorkflowTriggers` and `timeDue` (`workflow-triggers.ts:15,26`): cursors monotone, occurrence keys not already in `seen`, idempotent on re-run with returned cursors, output sorted.
- `automationsRouteAllowed` (`automations-route-policy.ts:3`): every path `AutomationsProtocol` emits is allowed, with no traversal or encoding.
- `resolveWorkflowTap` (`workflow-notice-taps.ts:18`): "ready" implies all ten identity fields match the binding and the re-read.
- `mergeAutomationRows`, `rowPasses` (filters partition rows), `workflowOutput` and `storedPhoneSpec` (total and bounded), `trim` (`notifications.ts:22`: inactive implies empty events; bounds 100 and 500), `noticePolicy`, `readOnlyDigestWorkflow` (`adapter:25`), `workflowNeedsReview` (`trigger-runtime:36`), `checkWorkflowScope` (`workflow-scope.ts:175`), `NoticeOwnerCoordinator.update` as a small deterministic machine.
