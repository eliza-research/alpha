# Application source refinement

`index.mjs` executes source adapters for the 20 application models and returns
their checker receipts together with unobserved fields, unexercised actions and
remaining environmental obligations. Run the source checks with
`node --test test/quint-application-refinement.test.mjs` from the repository root.

These are bounded source-to-model comparisons. Each observation is taken from
executed product code or its environmental port, then checked at the associated
Quint transition. The receipts retain concrete observations, action labels,
source and driver hashes, checked fields and the exact scope. They do not
establish general application refinement or discharge the returned obligations.

## Adapter boundaries

| Adapter | Source contracts exercised |
| --- | --- |
| `clients.mjs` | Verified session replacement, asynchronous sends, proposals, consumed approvals, cancellation and automatic workflow navigation |
| `portable.mjs` | Permission prompt persistence, browser snapshot/restore, layout policies, shared durable draft dispatch with persisted sending markers, complete 240-row permanent-deletion planner and delegation-return DOM execution |
| `storage.mjs` | Real document editor with controlled CAS, competing writers, persistence failure and the last-check legacy-write race |
| `contracts.mjs` | Legacy Notes tombstone/Trash policy, canonical Notes controller/editor, Calendar creation-draft encoding, development vault metadata and seven-step progress records |
| `surfaces.mjs` | Shell open/Back bodies, actual build/profile predicates, call timer retirement and current Files storage-volume identity checks |
| `boundaries.mjs` | Attachment review with real byte validation, browser notification policy/redaction and resident binding/retirement |

Environmental ports isolate storage, transport, platform callbacks and process
launch. Native provider execution, authentication, encryption and device
acceptance remain outside these adapters. A source helper comparison covers its
listed fields and transitions. Its parent UI or orchestration requires its own
observable execution.

## Source-discovered model corrections

`StartupPermissions` separates the current flow's attempted flag from its
durable marker. A failed best-effort write can permit another prompt after
reconstruction. `NoRepeatedPrompt` is scoped to one flow lifetime. The source trace and
`failedStorageRestartTest` retain the distinction between in-memory and persisted attempts.

`DraftDispatch.saveConflict` represents a failed release write whose saved copy
can still be read. The controller opens conflict review with its error flag
clear. A failed clear after dispatch keeps the existing error outcome. The storage port preserves the
shared controller's fourth-argument sending marker and clears it only on an unmarked save.

`DurableStore.prepare` marks the editor's last legacy-data check. An external
legacy write can occur before the independent document CAS completes. The next
source read refuses the changed legacy bytes. `CommitLegacyCurrent` retains the
stronger atomic cross-store condition, and `legacyWriteAfterPrepareTest`
demonstrates the current timing gap. It is an explicit remaining obligation.

## Reading the coverage report

The permanent-deletion decision table uses the existing secondary module
`PermanentVoiceDeletionContract`; its receipt associates that helper with
`PermanentVoiceDeletion` through `coverageModel`. It checks all 240 finite input
combinations of the pure planner. Stateful deletion effects, leases and native
workers have separate obligations.

The Calendar adapter covers creation-draft identity. The removed Google display-hiding
preference is not simulated as a current product operation. Account-scoped sync-destination
preferences remain a separate obligation. Files executes the actual BrowserStorageVolume
path resolver, category queries and conditional move against controlled library CAS primitives.
The three schedules exercise accepted, changed and missing identities. Full Files UI and
native storage remain separate obligations.

The aggregate report lists every model field absent from source observations
and every model action absent from these traces. It also retains adapter-specific
limits. These lists are part of the result, including when every executed trace
passes.
