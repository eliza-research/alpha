# Native refinement on the current shared pin

The current product consumes upstream `475a8d59dc1811c2cde093613519906a5a3f6457`.
Shared implementations are compiled from authenticated native staging, with the
patch manifest, patch files and staged inventory included in each source receipt.
The upstream checkout is unchanged.

## First validated group

- `RendererRecovery` executes the current full `MainActivity`, preserving the
  per-task HOME classification repair and the saturating renderer-loss budget.
  The campaign passes 27 schedules with 282 checkpoints. Its platform fixtures
  add inert registration stubs for the current streaming voice plugin, role
  synchronization and canonical-notification callbacks.
- `ResetRecovery` executes the product `AlphaDataReset` registration and
  `AlphaApplication` with shared `DataReset` and `ResetAuthorization`. The
  `reset-durable-admission.patch` reserves the durable attempt budget before
  listener/Android effects, uses a cross-process file lock, preserves legacy
  markers, verifies writes and rejects malformed trailing fields. Existing
  explanatory failure outcomes remain readable and are saved without counting
  an attempt twice. All 20 source schedules and 54 regression assertions pass.
- `DeletionJournal` executes the product binding and owner reader with shared
  `DeferredDeletionCoordinator`, `DeferredDeletionJournal` and `DeletionDeadline`.
  The `deletion-owner-dispatch.patch` rechecks the current owner fence after the
  coordinator lock is acquired. All 22 schedules and 132 checkpoints pass.

These runs preserve partial-write, callback and restart observations. They
exercise controlled Android, storage and provider ports. Real Binder lifecycle,
physical durability, system task assignment and provider effects retain their
separate platform obligations.

## Source mapping for aggregate integration

The reset source set now includes
`plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/reset/{DataReset,DataResetCopy,ResetAuthorization}.java`
from authenticated staging plus the retained Alpha registration/Application.
The deletion source set similarly consumes
`plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal/deletion/{DeferredDeletionCoordinator,DeferredDeletionJournal,DeletionDeadline}.java`.
Its product owner-reader dependencies include `NativeDeviceEnrollmentKey` and
the shared notification `NoticeOwner`. These replace removed product-local
helper paths in the global model source ledger.

## Resident, credential and shared-policy port

The whole current `AlphaLocalAgentPlugin` campaign retains owned/attached start,
stop, lost binding, late surface, request and stream retirement scenarios. A
source regression let a destroyed bridge stop the live resident. `stop` and
`cancelStart` now reject disposed surfaces under the existing lifecycle lock.
The current `AlphaConnectionPlugin` also allowed a destroyed instance to reserve
a newer credential intent. Reservation now checks its foreground ownership while
holding the shared lifecycle lock. Destruction acquires only the foreground lock,
so it can retire a caller blocked behind another lifecycle mutation. Native
provider preparation, cancellation, begin, clear and Cloud binding use the same
atomic disposed admission.

Actual credential coordinator schedules observe legacy-recovery marker writes,
per-slot commit boundaries, encrypted-store failure, exact stop acknowledgement,
service absence, stale reservations and current owner races. Public provider
request schedules exercise reserve, cancellation, cancelled reuse, clear and
post-destruction admission. The separate `CredentialLeaseTraces.java` invokes
real shared request and shutdown leases, including exact expiry, stale begin
cleanup, stale acknowledgement and release, and abandoned shutdown completion.
Its finite counters stop at two generations and one request. Arbitrary capacity,
clock wrap and process death remain explicit obligations.

Shared helper source aliases are `SelectedPhotoCopy`, `BufferedStreamExchange`,
`SenseListeningPolicy` and `SenseListeningLease`. VAD/PCM/focus/playback helpers
now compile from `plugin-local-inference`; listener helpers compile from the
shared Sense source; SMS operations compile in their actual package. The original
conformance entry points also use these current shared paths.

The current voice source adds a close-before-send barrier. Its model and driver
now observe capture removal, pending close, confirmed input hold, failed close
and late completion after Stop. The complete-finite VAD helper campaign covers
18 reachable counter states against 11 float comparison classes plus close.
Renderer budget covers saturated loss classes and the exact 60-second boundary.
Resident rearm covers the five-event, unlock, package, owner and lifecycle table.
These finite helper checks do not establish physical audio, Binder or provider
behavior. The navigation campaign currently checks fix validation and guidance
cursor primitives; full renderer reroute/background orchestration remains an
explicit unexecuted obligation.
