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
