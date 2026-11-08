# Native deletion coordinator refinement

The source driver executes the complete `NativeDeletionCoordinator`, its
`DeferredDeletionJournal`, monotonic `DeletionDeadline` and actual
`NativeOwnerReminderHost`. Fixed local owner-route responses pass through the
production host's identity, device enrollment and consistency checks.

## Retired-owner regression

The coordinator resolves its authenticated owner before taking its monitor. A
deterministic schedule holds that monitor, waits until reconciliation has read the
owner and is blocked acquiring the monitor, then changes the provider generation.
The previous implementation dispatched a calendar deletion using its cached owner.
The repaired `admitted` also calls the existing fast `stageOwnerCurrent` check.
It pauses the stale row before dispatch. Network owner reads remain outside the
coordinator monitor. The same guard covers reminder settlement and effect retries.
Generation changes after the fast fence remain an external concurrency obligation.
Credential reads, journal writes and provider dispatch use distinct synchronization.

## Executed boundaries

The campaigns cover the ten-second window, Undo, operation identity reuse,
clock discontinuity, provider outcomes, uncertain receipts, fresh coordinator
restoration, multi-row failure isolation and deadline scheduling. Storage ports
inject failures before replacement and after committed replacement, including
staging, dispatch admission and outcome persistence. A scheduling failure after
staging preserves the row for the next startup.

Reminder-provider campaigns check staging arguments, open-window scheduling,
Undo, retired ownership, retry of pending local effects and completed note-origin
projection. The reminder provider supplies explicit replies. Its own persistence
and alarm implementation remain a separate contract.

## Observation relation

`s.phase` projects the selected row in committed journal bytes. A public receipt
read normalizes a retained `dispatching` record to `unknown`, matching the actual
journal. `s.dispatches` counts durable dispatch admissions. It can equal one when
an exception occurs immediately after the admission write and no provider call
occurs. The evidence separately records actual provider calls, writes and
scheduling requests. This distinction preserves uncertainty after interruption.

The finite model still contains one selected operation. The multi-row campaign
also checks the other rows and scheduled delay directly against source outcomes.
The receipt retains the complete trace inputs, source events, generated-port
digest and source/driver hashes captured before execution.

```sh
node --test test/quint-deletion-refinement.test.mjs
node specs/quint/refinement/native/deletion-coordinator.mjs
```

The receipt is `test-results/quint-refinement/DeletionJournal-coordinator.json`.
Model checks are written to `test-results/quint/deletion-coordinator-check.json`
and `test-results/quint/deletion-coordinator-symbolic.json`.

The final campaign passes 22 source schedules and 132 model checkpoints. Fourteen
existing deletion tests also pass. The unchanged model passes its five scenarios,
1,000 simulations of 80 steps and bounded symbolic safety through depth six.
The existing native source-refinement suite also passes after this change.

This is bounded orchestration correspondence. Arbitrary retention capacity,
malformed journals, Android WorkManager persistence, actual encrypted storage,
calendar-provider transactions and reminder-engine effects remain separate
obligations. The controlled providers perform no real deletion or network access.
