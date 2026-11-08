# Native credential coordinator refinement

The driver executes the complete `AlphaConnectionPlugin`, `AlphaCredentialStore`
and `AlphaLocalAgentPlugin`. `SerialStorageTasks`, provider admission and resident
attachment policies also execute from product source. Android, primitive slot
storage, service status and fixed Cloud identity replies are controlled ports.

## Corrected lifecycle ordering

A destroyed connection bridge could reserve a new credential intent before its
closed storage lane rejected the call. A destroyed native bridge could do the same
before rejecting provider work. Deterministic schedules held a live credential
mutation at strict shutdown and delivered those late calls. The old calls changed
the global intent epoch and caused the live mutation to fail.

The connection bridge checks destruction while reserving its intent. Reservation
acquires `lifecycleLock` before the connection's `foregroundLock`, and destruction
sets its flag under that same connection lock before other cleanup. A request
waiting for the lifecycle lock therefore observes a completed destruction.
Native provider entry points check disposal and reserve together under `lifecycleLock`.
Current callers retain their existing credential ownership checks before writes.

## Source and model boundaries

The mutation model distinguishes a committed slot write from the later plugin
reply. `commitWrite` records durable replacement, and `reportWrite` records success
or a reported failure. A write error can therefore leave the new value present.
Pre-commit failures keep the selected credential unchanged. Provider removal also
updates `providerPresent`, allowing a later unbound Cloud write without another
provider shutdown.

The actual provider admission logic preserves its generation when the verified
account, credential and model remain equal. Such a rebind writes a new selection
revision while leaving the runtime active. The new `rebind` model operation
captures that path separately from replacing or removing the provider.

The selected credential maps to a finite value class. The model's `admission`
projects stored provider validity together with the actual `accepting` and
`stopping` flags. Stored admission metadata alone can survive while runtime
admission is retired. Raw observations retain lifecycle, credential-intent and
mutation epochs, strict shutdown identifiers, storage operations and service
replies.

The resident campaign uses the actual public request and streaming-request
methods, then clears the provider through another native surface. It checks
pending-call rejection, stream-handle cancellation, exact shutdown confirmation
and rejection of late responses after the epoch retires.

Separate schedules refuse storage admission when only process absence or only
the exact stop acknowledgement is available. The authority-retirement callback
can also fail before any selected-slot write. Explicit retries obtain a fresh
strict stop request.

```sh
node --test test/quint-credential-coordinator-refinement.test.mjs
node specs/quint/refinement/native/credential-coordinator.mjs
```

`checkCredentialCoordinator` returns two receipts and explicit obligations. The
receipts are `NativeCredentialMutation-credential-coordinator.json` and
`ResidentRuntime-credential-coordinator.json` under `test-results/quint-refinement`.
They include all source and driver hashes captured before execution.
The Java sources compile once, and each schedule runs in a fresh JVM.

These are bounded orchestration checks. Actual encrypted-file persistence,
Keystore behavior, service-process shutdown and Binder delivery remain platform
obligations. Arbitrary provider-network failures and all possible interleavings
remain outside these finite schedules. The controlled ports use synthetic
credentials and perform no real network or account changes.

## Validation

The source campaign passes 33 schedules and 209 observed checkpoints across the
two models. Both receipts bind the generated-port fingerprint, driver files,
product sources and model inputs, and confirm unchanged inputs after execution.
The pre-existing credential adapter passes three schedules and eight checkpoints.
All 31 targeted native tests pass, alongside the existing resident coordinator
campaign and native policy conformance checks. Both affected models pass their 27 scenario
tests, 1,000 sampled runs of 80 steps and symbolic safety checking through six
steps. The ledger check covers the current source hashes.

An initial ACK-only schedule exceeded the fixture's five-second settling deadline
under concurrent host load. Direct replay and the full campaign passed. The
fixture now allows 15 seconds for public calls to settle while the controlled
clock still drives the product's exact 15-second shutdown timeout.
