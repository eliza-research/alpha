# Shared core TLA+ conversion report

The incoming shared pin `4787d51a142c63c98371c832997184c53f7218d3` adds 16 TLA+ modules and 31 TLC configurations under `packages/core/tla`. The immutable source archive used for this report is `/tmp/alpha-core-tla-4787`. The vendor checkout remains unchanged.

## Scope and deliverables

- Translate every declared variable, helper, action, initial condition, invariant, specification and temporal property. Retain original operator names where Quint permits them. Use the `Core` module prefix to distinguish these designs from existing runtime models.
- Preserve every configuration’s constants, selected specification, invariant list, temporal-property list and deadlock setting. Each profile needs a named executable entry point and its own validation result.
- Store Quint modules directly under `specs/quint/legacy` and comparison metadata under `specs/quint/legacy/core`. Register every default model in the legacy manifest with upstream source revision and hashes. The core configuration runner must enumerate all 31 profiles independently of the default manifest entry.
- Preserve weak and strong fairness and temporal quantification. Check safety separately from liveness. A fairness-conditioned temporal property must use the source action-enablement semantics and the complete source state tuple for stuttering.
- Add executable scenarios for success, rejection/failure, competing calls, cancellation/retirement and retries where the source defines them. Run type checking, scenarios and bounded simulation for each configuration, followed by bounded symbolic and feasible TLC temporal checks with recorded limits.
- Preserve the reducer graph as historical upstream evidence. A generated graph does not replace a checked Quint model or source-executing refinement.
- Keep source-model refinement distinct from literal TLA conversion. Existing runtime service models do not automatically discharge these incoming specifications, and these specifications do not automatically establish current implementation refinement.

## Inventory

| Source module | Lines | State variables | Definitions | Configuration profiles | Translation features |
| --- | ---: | ---: | ---: | --- | --- |
| `ActionSettlement` | 180 | 10 | 24 | `late`, `outcomes` | weak fairness, always/eventually, sequences |
| `ApprovalService` | 254 | 12 | 27 | `failures`, `race` | weak fairness, always/eventually, LET, EXCEPT, record/function sets |
| `EmbeddingDimension` | 237 | 13 | 27 | `probes` | always/eventually, LET, EXCEPT, record/function sets |
| `FactWriteDedupe` | 93 | 4 | 12 | `empty`, `prefilled` | weak fairness, always/eventually, EXCEPT, record/function sets, sequences |
| `InteractionSession` | 292 | 16 | 33 | `leases`, `retries` | weak fairness, leads-to, always/eventually, LET, EXCEPT, record/function sets |
| `InteractiveTask` | 176 | 6 | 32 | `reducer` | always/eventually, EXCEPT, record/function sets |
| `PluginLifecycle` | 436 | 27 | 51 | `inflight`, `register`, `services` | weak fairness, always/eventually, CHOOSE, LET, EXCEPT, record/function sets |
| `ProviderExecution` | 235 | 12 | 27 | `coalesced`, `oneoff` | weak fairness, leads-to, always/eventually, CHOOSE, LET, EXCEPT, record/function sets |
| `RoomHandlerQueue` | 277 | 8 | 37 | `bounded`, `cycle` | weak fairness, leads-to, always/eventually, CHOOSE, LET, EXCEPT, record/function sets, sequences |
| `RuntimeLifecycle` | 339 | 25 | 46 | `stop` | weak fairness, leads-to, always/eventually, EXCEPT, record/function sets, sequences |
| `Semaphore` | 161 | 8 | 21 | `one`, `two` | weak fairness, leads-to, always/eventually, LET, EXCEPT, record/function sets, sequences |
| `Serialise` | 77 | 3 | 14 | `calls` | weak fairness, leads-to, always/eventually, CHOOSE, EXCEPT, record/function sets, sequences |
| `ServiceLifecycle` | 489 | 26 | 48 | `liveness`, `siblings` | weak fairness, leads-to, always/eventually, CHOOSE, LET, EXCEPT, record/function sets |
| `SingleFlightMemo` | 169 | 11 | 23 | `liveness`, `safety` | weak fairness, leads-to, always/eventually, LET, EXCEPT, record/function sets |
| `TaskScheduler` | 267 | 15 | 28 | `live`, `restart` | weak fairness, leads-to, always/eventually, LET, EXCEPT, record/function sets |
| `TaskService` | 349 | 13 | 44 | `daemonOneshot`, `daemonRepeat`, `localOneshot`, `localRepeat` | weak fairness, strong fairness, leads-to, always/eventually, LET, EXCEPT, record/function sets |

## Per-module work

### ActionSettlement

Translate `packages/core/tla/ActionSettlement.tla` to `CoreActionSettlement.qnt`. Source SHA-256 is `8a5aff37e3def1f0ea382471243a1dc504ca35e57203a13c59bbbf116da210e8`.

**Declared state**. `spc`, `hpc`, `phase`, `outcome`, `emitted`, `buffer`, `chain`, `busy`, `delivered`, `target`.

**Definitions to preserve**. `N`, `Ids`, `vars`, `Init`, `Receive`, `Admit`, `HandlerEmit`, `HandlerReturn`, `LateEmit`, `Settle`, `Deliver`, `TransportSettle`, `Drained`, `Finished`, `Next`, `Spec`, `TypeOK`, `DeliveredInEmissionOrder`, `DeliveredOnlyEmitted`, `NoneAfterFailure`, `NoneOnReplyFailure`, `NoneWhilePending`, `SettleReturns`, `AllDelivered`.

- Profile `late` uses `packages/core/tla/ActionSettlement.late.cfg`.
  - Constants. `InHandler = 3`. `Late = 3`. `Outcomes = {"ok"}`. `MayDeny = FALSE`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `DeliveredInEmissionOrder`, `DeliveredOnlyEmitted`, `NoneAfterFailure`, `NoneOnReplyFailure`, `NoneWhilePending`.
  - Temporal properties. `SettleReturns`, `AllDelivered`.
  - Deadlock checking. `TRUE`.
- Profile `outcomes` uses `packages/core/tla/ActionSettlement.outcomes.cfg`.
  - Constants. `InHandler = 2`. `Late = 1`. `Outcomes = {"ok", "replyFailure", "invalid", "throw"}`. `MayDeny = TRUE`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `DeliveredInEmissionOrder`, `DeliveredOnlyEmitted`, `NoneAfterFailure`, `NoneOnReplyFailure`, `NoneWhilePending`.
  - Temporal properties. `SettleReturns`, `AllDelivered`.
  - Deadlock checking. `TRUE`.

### ApprovalService

Translate `packages/core/tla/ApprovalService.tla` to `CoreApprovalService.qnt`. Source SHA-256 is `5b954c7878a07a32753ae2743e9e3057b007bcdc541f94646566fdd875b8bf26`.

**Declared state**. `inMap`, `timer`, `taskExists`, `result`, `selRuns`, `toRuns`, `tpc`, `tHas`, `spc`, `sHas`, `cpc`, `stopped`.

**Definitions to preserve**. `vars`, `TypeOK`, `Settle`, `Init`, `Fire`, `TGetTask`, `TCallbackDone`, `TCallbackFails`, `TResolve`, `TDelete`, `Deliver`, `SGetTask`, `SCallbackDone`, `SCallbackFails`, `SDelete`, `Cancel`, `CancelDelete`, `Stop`, `Finished`, `Next`, `Fairness`, `Spec`, `AtMostOneCallback`, `ResultAgrees`, `SingleOwner`, `SettlesOnce`, `CallerSettles`.

- Profile `failures` uses `packages/core/tla/ApprovalService.failures.cfg`.
  - Constants. `Selectors = {s1, s2}`. `CanFail = TRUE`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `AtMostOneCallback`, `ResultAgrees`, `SingleOwner`.
  - Temporal properties. `SettlesOnce`, `CallerSettles`.
  - Deadlock checking. `TRUE`.
- Profile `race` uses `packages/core/tla/ApprovalService.race.cfg`.
  - Constants. `Selectors = {s1, s2}`. `CanFail = FALSE`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `AtMostOneCallback`, `ResultAgrees`, `SingleOwner`.
  - Temporal properties. `SettlesOnce`, `CallerSettles`.
  - Deadlock checking. `TRUE`.

### EmbeddingDimension

Translate `packages/core/tla/EmbeddingDimension.tla` to `CoreEmbeddingDimension.qnt`. Source SHA-256 is `c9862e75a86481390ad23d07d98237db2ee609c40fe99d524dce1874683e0b58`.

**Declared state**. `col`, `aspace`, `stored`, `pinProv`, `pinSpace`, `pinDim`, `ppc`, `pprov`, `probes`, `epc`, `eprov`, `dropped`, `clearFailed`.

**Definitions to preserve**. `Providers`, `None`, `Space`, `Dim`, `Vectors`, `vars`, `TypeOK`, `Init`, `ProbeVars`, `PinVars`, `EmbedVars`, `ProbeFails`, `ProbeStart`, `ProbeResize`, `ProbeSpace`, `ProbePin`, `ProbeClear`, `EmbedCall`, `EmbedValidate`, `EmbedWrite`, `Finished`, `Next`, `Spec`, `StoredOneSpace`, `PinSpaceStable`, `PinMatchesStore`, `StoredInColumn`.

- Profile `probes` uses `packages/core/tla/EmbeddingDimension.probes.cfg`.
  - Constants. `Embedders = {e1, e2}`. `MaxProbes = 3`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `PinMatchesStore`, `StoredInColumn`.
  - Temporal properties. `PinSpaceStable`.
  - Deadlock checking. `TRUE`.

### FactWriteDedupe

Translate `packages/core/tla/FactWriteDedupe.tla` to `CoreFactWriteDedupe.qnt`. Source SHA-256 is `b96af81bac91ac1c23f2e67be01a012962fb2c3587ebf1b82ade02c004ff3570`.

**Declared state**. `rows`, `pc`, `seen`, `owner`.

**Definitions to preserve**. `vars`, `TypeOK`, `Init`, `Check`, `Update`, `Insert`, `Finished`, `Next`, `Spec`, `NoDuplicateFact`, `NoLostEvidence`, `WriteReturns`.

- Profile `empty` uses `packages/core/tla/FactWriteDedupe.empty.cfg`.
  - Constants. `Writers = {w1, w2, w3}`. `Prefilled = FALSE`. `Serialised = TRUE`. `Seed = Seed`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `NoDuplicateFact`, `NoLostEvidence`.
  - Temporal properties. `WriteReturns`.
  - Deadlock checking. `TRUE`.
- Profile `prefilled` uses `packages/core/tla/FactWriteDedupe.prefilled.cfg`.
  - Constants. `Writers = {w1, w2, w3}`. `Prefilled = TRUE`. `Serialised = TRUE`. `Seed = Seed`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `NoDuplicateFact`, `NoLostEvidence`.
  - Temporal properties. `WriteReturns`.
  - Deadlock checking. `TRUE`.

### InteractionSession

Translate `packages/core/tla/InteractionSession.tla` to `CoreInteractionSession.qnt`. Source SHA-256 is `a204e853f4e417a640fcfd0a6e72876da7986ddcc29a8b1ee9f067e9e97bbf56`.

**Declared state**. `exists`, `cstate`, `owner`, `digest`, `lease`, `committedAt`, `completedAt`, `auth`, `now`, `pc`, `run`, `mine`, `last`, `effects`, `reached`, `late`.

**Definitions to preserve**. `vars`, `Time`, `ClaimIds`, `Response`, `Outcomes`, `TypeOK`, `Init`, `Store`, `Return`, `Claim`, `CommitInTime`, `Commit`, `Execute`, `Complete`, `Crash`, `Reconcile`, `Revoke`, `Sweepable`, `DeleteExpired`, `Tick`, `Finished`, `Next`, `Fairness`, `Spec`, `ExactlyOnceAuthority`, `AtMostOnce`, `CompletedHasEffect`, `NoCommitWhileRevoked`, `NoLateCommit`, `AmbiguousRetained`, `ExecutorHasRecord`, `EffectOnlyByCommitter`, `EffectRecorded`.

- Profile `leases` uses `packages/core/tla/InteractionSession.leases.cfg`.
  - Constants. `Clients = {c1, c2, c3}`. `Mismatched = {c3}`. `MaxRuns = 2`. `MaxTime = 4`. `Expiry = 3`. `Ttl = 1`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `AtMostOnce`, `ExactlyOnceAuthority`, `CompletedHasEffect`, `NoCommitWhileRevoked`, `NoLateCommit`, `AmbiguousRetained`, `ExecutorHasRecord`.
  - Temporal properties. `EffectOnlyByCommitter`, `EffectRecorded`.
  - Deadlock checking. `TRUE`.
- Profile `retries` uses `packages/core/tla/InteractionSession.retries.cfg`.
  - Constants. `Clients = {c1, c2}`. `Mismatched = {}`. `MaxRuns = 3`. `MaxTime = 5`. `Expiry = 4`. `Ttl = 2`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `AtMostOnce`, `ExactlyOnceAuthority`, `CompletedHasEffect`, `NoCommitWhileRevoked`, `NoLateCommit`, `AmbiguousRetained`, `ExecutorHasRecord`.
  - Temporal properties. `EffectOnlyByCommitter`, `EffectRecorded`.
  - Deadlock checking. `TRUE`.

### InteractiveTask

Translate `packages/core/tla/InteractiveTask.tla` to `CoreInteractiveTask.qnt`. Source SHA-256 is `e6d161bddb5fbb06bfba9e02bb9ba9a8e77029ee0f9328387120866968edb60c`.

**Declared state**. `status`, `auth`, `obs`, `op`, `scopeB`, `extended`.

**Definitions to preserve**. `Ops`, `Origins`, `OpStates`, `Statuses`, `vars`, `Unresolved`, `U`, `Ended`, `CancelPrepared`, `TypeOK`, `Init`, `Observe`, `Extend`, `Retract`, `Interrupt`, `Prepare`, `Dispatch`, `Result`, `Reconcile`, `Complete`, `Next`, `Spec`, `AtMostOneUnresolved`, `WaitingIffDispatched`, `BlockedHasUnknown`, `RevokedIsNotRunning`, `PreparedIsFenced`, `ObservedOriginIsAllowed`, `ScopeComesFromGrant`, `EndedIsSettled`, `OutcomesAreFinal`, `RevocationIsFinal`.

- Profile `reducer` uses `packages/core/tla/InteractiveTask.reducer.cfg`.
  - Constants. None.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `AtMostOneUnresolved`, `WaitingIffDispatched`, `BlockedHasUnknown`, `RevokedIsNotRunning`, `PreparedIsFenced`, `ObservedOriginIsAllowed`, `ScopeComesFromGrant`, `EndedIsSettled`.
  - Temporal properties. `OutcomesAreFinal`, `RevocationIsFinal`.
  - Deadlock checking. `FALSE`.

### PluginLifecycle

Translate `packages/core/tla/PluginLifecycle.tla` to `CorePluginLifecycle.qnt`. Source SHA-256 is `a2b18a27d89fae7d9f5a213ce9983ba7fe2b9807e0111d1ea5cdf75a79509501`.

**Declared state**. `pc`, `running`, `cur`, `waitSet`, `queue`, `visited`, `joinOf`, `stopFailed`, `owned`, `pluginsA`, `tdActive`, `regActive`, `disposeCalls`, `types`, `byClass`, `starting`, `failedC`, `services`, `live`, `stopCalls`, `stopOps`, `nextInst`, `stopRequested`, `registry`, `ownsA`, `ownsB`, `lastReg`.

**Definitions to preserve**. `Classes`, `Actors`, `MaxInst`, `Insts`, `Owners`, `ctl`, `plug`, `svc`, `conn`, `vars`, `Free`, `Go`, `Rest`, `Init`, `UCall`, `UJoin`, `UDispose`, `UInflight`, `UStop`, `UStopWait`, `UFinish`, `LCall`, `LBegin`, `SDone`, `TReq`, `TDrain`, `TSvc`, `TSvcWait`, `BReg`, `RCall`, `RInit`, `RJoin`, `Quiescent`, `Finished`, `Unload`, `Load`, `Stop`, `Register`, `Next`, `Fairness`, `Spec`, `TypeOK`, `TeardownStates`, `TeardownExclusive`, `StopAtMostOnce`, `NoOrphanInstance`, `StopStopsAll`, `ConnectorOwnedByLast`, `NoOrphanConnector`, `RegisterHonest`, `Terminates`.

- Profile `inflight` uses `packages/core/tla/PluginLifecycle.inflight.cfg`.
  - Constants. `NumClasses = 2`. `Unloaders = {u1, u2}`. `Loaders = {l1}`. `Registrars = {}`. `Stoppers = {t1}`. `Rivals = {b1}`. `StartsInFlight = TRUE`. `InitMayFail = TRUE`. `StopMayFail = TRUE`. `StartMayFail = TRUE`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `TeardownExclusive`, `StopAtMostOnce`, `NoOrphanInstance`, `StopStopsAll`, `ConnectorOwnedByLast`, `NoOrphanConnector`, `RegisterHonest`.
  - Temporal properties. `Terminates`.
  - Deadlock checking. `TRUE`.
- Profile `register` uses `packages/core/tla/PluginLifecycle.register.cfg`.
  - Constants. `NumClasses = 0`. `Unloaders = {}`. `Loaders = {}`. `Registrars = {r1, r2}`. `Stoppers = {}`. `Rivals = {}`. `StartsInFlight = FALSE`. `InitMayFail = TRUE`. `StopMayFail = FALSE`. `StartMayFail = FALSE`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `TeardownExclusive`, `StopAtMostOnce`, `NoOrphanInstance`, `StopStopsAll`, `ConnectorOwnedByLast`, `NoOrphanConnector`, `RegisterHonest`.
  - Temporal properties. `Terminates`.
  - Deadlock checking. `TRUE`.
- Profile `services` uses `packages/core/tla/PluginLifecycle.services.cfg`.
  - Constants. `NumClasses = 2`. `Unloaders = {u1, u2}`. `Loaders = {l1, l2}`. `Registrars = {}`. `Stoppers = {t1}`. `Rivals = {b1}`. `StartsInFlight = FALSE`. `InitMayFail = TRUE`. `StopMayFail = TRUE`. `StartMayFail = TRUE`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `TeardownExclusive`, `StopAtMostOnce`, `NoOrphanInstance`, `StopStopsAll`, `ConnectorOwnedByLast`, `NoOrphanConnector`, `RegisterHonest`.
  - Temporal properties. `Terminates`.
  - Deadlock checking. `TRUE`.

### ProviderExecution

Translate `packages/core/tla/ProviderExecution.tla` to `CoreProviderExecution.qnt`. Source SHA-256 is `d0637ff320d0d508252dd72e1cf388b2c0a3bde771b881420d84ed30dbd733a6`.

**Declared state**. `map`, `active`, `created`, `waiters`, `cause`, `settled`, `cleaned`, `exec`, `pc`, `sigAborted`, `stopping`, `stopped`.

**Definitions to preserve**. `Execs`, `Causes`, `vars`, `Attached`, `TypeOK`, `Init`, `Fresh`, `Attach`, `AbortSignal`, `SettleWork`, `SettleAborted`, `Cleanup`, `CallerSettle`, `RequestStop`, `StopComposer`, `Finished`, `Next`, `Fairness`, `Spec`, `WaiterCount`, `AbortOnlyWhenUnwanted`, `UnwantedWorkAborted`, `NoJoinAborting`, `StopReachesAll`, `MapActive`, `AbortedCallerLeaves`, `StopReleasesCallers`.

- Profile `coalesced` uses `packages/core/tla/ProviderExecution.coalesced.cfg`.
  - Constants. `Callers = {a, b, c}`. `Signalled = {a, b}`. `Keyed = {a, b, c}`. `MaxExec = 3`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `WaiterCount`, `AbortOnlyWhenUnwanted`, `UnwantedWorkAborted`, `NoJoinAborting`, `StopReachesAll`, `MapActive`.
  - Temporal properties. `AbortedCallerLeaves`, `StopReleasesCallers`.
  - Deadlock checking. `TRUE`.
- Profile `oneoff` uses `packages/core/tla/ProviderExecution.oneoff.cfg`.
  - Constants. `Callers = {a, b, c}`. `Signalled = {a, c}`. `Keyed = {a, b}`. `MaxExec = 3`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `WaiterCount`, `AbortOnlyWhenUnwanted`, `UnwantedWorkAborted`, `NoJoinAborting`, `StopReachesAll`, `MapActive`.
  - Temporal properties. `AbortedCallerLeaves`, `StopReleasesCallers`.
  - Deadlock checking. `TRUE`.

### RoomHandlerQueue

Translate `packages/core/tla/RoomHandlerQueue.tla` to `CoreRoomHandlerQueue.qnt`. Source SHA-256 is `6d4ad75fe5f0eff561a65286d6df7ddde14294e8ef3c3d170eb216eb529c21c3`.

**Declared state**. `queue`, `active`, `want`, `held`, `pc`, `accepting`, `writes`, `closed`.

**Definitions to preserve**. `Rooms`, `vars`, `States`, `Pending`, `InUse`, `Total`, `Min`, `Max`, `Waits`, `Remove`, `TypeOK`, `Init`, `Start`, `Admit`, `Grant`, `Cancel`, `Nest`, `BeginWrite`, `EndWrite`, `StartRelease`, `StopWrites`, `Release`, `Close`, `Finished`, `Next`, `Fairness`, `Spec`, `MutualExclusion`, `WaitersQueued`, `OrderedAcquisition`, `Bounded`, `WritesUnderLease`, `NoLeakedOwnership`, `NoAdmissionAfterClose`, `FreedByOwner`, `WaiterServed`, `TurnFinishes`.

- Profile `bounded` uses `packages/core/tla/RoomHandlerQueue.bounded.cfg`.
  - Constants. `Turns = {t1, t2, t3}`. `NumRooms = 2`. `MaxPerRoom = 2`. `MaxTotal = 3`. `MaxRooms = 2`. `MaxWrites = 1`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `MutualExclusion`, `WaitersQueued`, `OrderedAcquisition`, `Bounded`, `NoLeakedOwnership`, `WritesUnderLease`.
  - Temporal properties. `NoAdmissionAfterClose`, `FreedByOwner`, `WaiterServed`, `TurnFinishes`.
  - Deadlock checking. `TRUE`.
- Profile `cycle` uses `packages/core/tla/RoomHandlerQueue.cycle.cfg`.
  - Constants. `Turns = {t1, t2, t3}`. `NumRooms = 2`. `MaxPerRoom = 2`. `MaxTotal = 4`. `MaxRooms = 2`. `MaxWrites = 1`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `MutualExclusion`, `WaitersQueued`, `OrderedAcquisition`, `Bounded`, `NoLeakedOwnership`, `WritesUnderLease`.
  - Temporal properties. `NoAdmissionAfterClose`, `FreedByOwner`, `WaiterServed`, `TurnFinishes`.
  - Deadlock checking. `TRUE`.

### RuntimeLifecycle

Translate `packages/core/tla/RuntimeLifecycle.tla` to `CoreRuntimeLifecycle.qnt`. Source SHA-256 is `869f97937724184d25b3edc179433564c4bf34b0a438cb88e915502b23e7463c`.

**Declared state**. `ipc`, `initResolved`, `initFailed`, `svc`, `svcLate`, `queue`, `owner`, `tpc`, `aborted`, `stopReq`, `stopped`, `stopPromise`, `prepareCalls`, `closed`, `turnsClosed`, `failures`, `apc`, `aid`, `afast`, `outcome`, `spc`, `sfast`, `sstrict`, `sjoined`, `strictP`.

**Definitions to preserve**. `Attempts`, `vars`, `initVars`, `svcVars`, `turnVars`, `stopVars`, `attVars`, `callVars`, `Pending`, `Init`, `IRegister`, `ICore`, `SvcResume`, `SvcStarted`, `SvcStopDone`, `TAdmit`, `TGrant`, `TRun`, `TFinish`, `BeginAttempt`, `EnterBestEffort`, `SCall`, `ADrained`, `ATimeout`, `AServices`, `ASvcDone`, `SBestEffortDone`, `SStrictDrain`, `SAwaitStrict`, `Finished`, `Next`, `Fairness`, `Spec`, `LifecycleState`, `TypeOK`, `PrepareStopOnce`, `SingleAttempt`, `TurnsAbortedAfterStop`, `NoStartOnFailedInit`, `NoLiveAfterStopped`, `StoppedIsQuiet`, `StrictMeansQuiescent`, `NoAdmissionAfterClose`, `StopperReturns`, `TurnsFinish`, `EagerStartSettles`.

- Profile `stop` uses `packages/core/tla/RuntimeLifecycle.stop.cfg`.
  - Constants. `Turns = {t1, t2}`. `Stoppers = {s1, s2}`. `MaxAttempts = 2`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `PrepareStopOnce`, `SingleAttempt`, `TurnsAbortedAfterStop`, `NoStartOnFailedInit`, `NoLiveAfterStopped`, `StoppedIsQuiet`, `StrictMeansQuiescent`.
  - Temporal properties. `NoAdmissionAfterClose`, `StopperReturns`, `TurnsFinish`, `EagerStartSettles`.
  - Deadlock checking. `TRUE`.

### Semaphore

Translate `packages/core/tla/Semaphore.tla` to `CoreSemaphore.qnt`. Source SHA-256 is `06f2eec3864f634079b94954ec8916d83427b13d680d3a757c43506ab85e028c`.

**Declared state**. `permits`, `waiters`, `pc`, `aborted`, `listener`, `queuedAbort`, `ticket`, `next`.

**Definitions to preserve**. `vars`, `Queued`, `Remove`, `Holders`, `TypeOK`, `Init`, `Acquire`, `Abort`, `CancelListener`, `Skipped`, `Release`, `Finished`, `Next`, `Fairness`, `Spec`, `PermitConservation`, `NoIdlePermitWithWaiters`, `WaitersQueued`, `FIFOGrants`, `CancelledNeverHolds`, `WaiterServed`.

- Profile `one` uses `packages/core/tla/Semaphore.one.cfg`.
  - Constants. `Callers = {c1, c2, c3, c4}`. `N = 1`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `PermitConservation`, `NoIdlePermitWithWaiters`, `WaitersQueued`, `FIFOGrants`, `CancelledNeverHolds`.
  - Temporal properties. `WaiterServed`.
  - Deadlock checking. `TRUE`.
- Profile `two` uses `packages/core/tla/Semaphore.two.cfg`.
  - Constants. `Callers = {c1, c2, c3, c4}`. `N = 2`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `PermitConservation`, `NoIdlePermitWithWaiters`, `WaitersQueued`, `FIFOGrants`, `CancelledNeverHolds`.
  - Temporal properties. `WaiterServed`.
  - Deadlock checking. `TRUE`.

### Serialise

Translate `packages/core/tla/Serialise.tla` to `CoreSerialise.qnt`. Source SHA-256 is `701209da1f1f1d7e8ac81395b99f053c9545e7bbe8dcee0bd85a9a9455b09ac6`.

**Declared state**. `chain`, `pc`, `outcome`.

**Definitions to preserve**. `vars`, `Pos`, `TypeOK`, `Init`, `Invoke`, `Start`, `Finish`, `Finished`, `Next`, `Fairness`, `Spec`, `MutualExclusion`, `CallOrder`, `CallFinishes`.

- Profile `calls` uses `packages/core/tla/Serialise.calls.cfg`.
  - Constants. `Calls = {a, b, c, d}`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `MutualExclusion`, `CallOrder`.
  - Temporal properties. `CallFinishes`.
  - Deadlock checking. `TRUE`.

### ServiceLifecycle

Translate `packages/core/tla/ServiceLifecycle.tla` to `CoreServiceLifecycleDesign.qnt`. Source SHA-256 is `78d2bfc7f37c7631de1e748b4400c34a2da4ad99f9b484c41b5dbd0e46b83ff3`.

**Declared state**. `types`, `byClass`, `starting`, `failed`, `sc`, `att`, `scInst`, `published`, `status`, `nextInst`, `cls`, `late`, `stopCalls`, `stopOp`, `epc`, `tries`, `ewait`, `stopReq`, `stopped`, `rpc`, `rcur`, `rvisited`, `lastEnsure`, `upc`, `ucur`, `uwait`.

**Definitions to preserve**. `Inst`, `OwnedClass`, `vars`, `startVars`, `callerVars`, `stopVars`, `unloadVars`, `Created`, `InFlight`, `TypeOK`, `Init`, `Rebuild`, `StopOnce`, `EBegin`, `EEnsure`, `Settled`, `ESettle`, `EDelay`, `StartFail`, `StartOk`, `StartEvent`, `StartLateStopped`, `StopOpDone`, `RegisterLate`, `RRequest`, `RServices`, `RStopNext`, `RStopWait`, `RClear`, `UStopTaken`, `UStatus`, `UStart`, `UAwaited`, `UDrain`, `UStopped`, `Finished`, `Next`, `Fairness`, `Spec`, `OneLivePerClass`, `StopAtMostOnce`, `NoLatePublish`, `NoOrphan`, `StatusConsistent`, `NoStatusWithoutClasses`, `StoppedNotReachable`, `StopReachesAll`, `CallersReturn`.

- Profile `liveness` uses `packages/core/tla/ServiceLifecycle.liveness.cfg`.
  - Constants. `Classes = {A, B}`. `LateClasses = {B}`. `Owned = {A}`. `Callers = {e1, e2}`. `MaxInst = 3`. `MaxRetries = 0`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `OneLivePerClass`, `StopAtMostOnce`, `NoLatePublish`, `NoOrphan`, `StatusConsistent`, `NoStatusWithoutClasses`, `StoppedNotReachable`.
  - Temporal properties. `StopReachesAll`, `CallersReturn`.
  - Deadlock checking. `TRUE`.
- Profile `siblings` uses `packages/core/tla/ServiceLifecycle.siblings.cfg`.
  - Constants. `Classes = {A, B}`. `LateClasses = {B}`. `Owned = {A}`. `Callers = {e1, e2}`. `MaxInst = 4`. `MaxRetries = 1`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `OneLivePerClass`, `StopAtMostOnce`, `NoLatePublish`, `NoOrphan`, `StatusConsistent`, `NoStatusWithoutClasses`, `StoppedNotReachable`.
  - Temporal properties. None.
  - Deadlock checking. `TRUE`.

### SingleFlightMemo

Translate `packages/core/tla/SingleFlightMemo.tla` to `CoreSingleFlightMemo.qnt`. Source SHA-256 is `4777364ca796bf8dbe0549d775600e5aaac205d85a0d0ec64dd6cf1a30f69dfb`.

**Declared state**. `db`, `entry`, `nfetch`, `fval`, `fstate`, `rpc`, `rf`, `floor`, `wpc`, `wver`, `completed`.

**Definitions to preserve**. `Fetches`, `vars`, `Max`, `TypeOK`, `Init`, `Start`, `ReadShared`, `ReadFetch`, `FetchRead`, `FetchResolve`, `FetchReject`, `Serve`, `Expire`, `Commit`, `Invalidate`, `Finished`, `Next`, `Fairness`, `Spec`, `NoStaleAfterInvalidate`, `RejectedNotCached`, `Symmetry`, `ReaderFinishes`.

- Profile `liveness` uses `packages/core/tla/SingleFlightMemo.liveness.cfg`.
  - Constants. `Readers = {r1, r2}`. `Writers = {w1, w2}`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `NoStaleAfterInvalidate`, `RejectedNotCached`.
  - Temporal properties. `ReaderFinishes`.
  - Deadlock checking. `TRUE`.
- Profile `safety` uses `packages/core/tla/SingleFlightMemo.safety.cfg`.
  - Constants. `Readers = {r1, r2, r3}`. `Writers = {w1, w2}`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `NoStaleAfterInvalidate`, `RejectedNotCached`.
  - Temporal properties. None.
  - Deadlock checking. `TRUE`.

### TaskScheduler

Translate `packages/core/tla/TaskScheduler.tla` to `CoreTaskScheduler.qnt`. Source SHA-256 is `ea5d5a5e135bf03f9fa25c1aca423c6284e516b054cfeb73d7d2a9f81e59f4dd`.

**Declared state**. `registry`, `nextId`, `dirty`, `timer`, `adapter`, `activeTick`, `gen`, `tk`, `inRun`, `stopped`, `busy`, `stale`, `restarts`, `regs`, `taken`.

**Definitions to preserve**. `MaxGen`, `vars`, `TickPcs`, `Entries`, `TypeOK`, `FreeTick`, `Init`, `Marks`, `Current`, `Settle`, `Fire`, `Query`, `RunDone`, `Start`, `Stop`, `Register`, `StopService`, `MarkDirty`, `Finished`, `Next`, `Fairness`, `Spec`, `NoStaleDispatch`, `OneRunTickPerService`, `AttachedTickCurrent`, `TakenClearsDirty`, `DirtyServed`, `TickSettles`.

- Profile `live` uses `packages/core/tla/TaskScheduler.live.cfg`.
  - Constants. `Services = {s1, s2}`. `Adapters = {a1, a2}`. `Ticks = {k1, k2, k3}`. `MaxRestarts = 2`. `MaxRegs = 2`. `QueryCanFail = FALSE`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `NoStaleDispatch`, `OneRunTickPerService`, `AttachedTickCurrent`, `TakenClearsDirty`.
  - Temporal properties. `DirtyServed`, `TickSettles`.
  - Deadlock checking. `TRUE`.
- Profile `restart` uses `packages/core/tla/TaskScheduler.restart.cfg`.
  - Constants. `Services = {s1, s2}`. `Adapters = {a1, a2}`. `Ticks = {k1, k2, k3}`. `MaxRestarts = 2`. `MaxRegs = 2`. `QueryCanFail = TRUE`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `NoStaleDispatch`, `OneRunTickPerService`, `AttachedTickCurrent`, `TakenClearsDirty`.
  - Temporal properties. None.
  - Deadlock checking. `TRUE`.

### TaskService

Translate `packages/core/tla/TaskService.tla` to `CoreTaskService.qnt`. Source SHA-256 is `344e588b49a77e8a44b6c7b8cabdc2c068e4b9e30a310b25d592eb3d2eabef34`.

**Declared state**. `row`, `snap`, `pc`, `outcome`, `activeTick`, `inSet`, `armed`, `deferred`, `unseen`, `starts`, `unserved`, `requests`, `pauses`.

**Definitions to preserve**. `Timers`, `Scheduled`, `Runners`, `Repeat`, `Guarded`, `MaxRev`, `Rows`, `Snaps`, `vars`, `States`, `Executing`, `DueRow`, `SnapOf`, `TypeOK`, `Init`, `End`, `MarkDirty`, `Begin`, `Read`, `StartWorker`, `Select`, `Recheck`, `Work`, `Write`, `Release`, `Elapse`, `WakeElapse`, `Request`, `TogglePause`, `Finished`, `RunnerStep`, `Next`, `Fairness`, `Spec`, `OneShotAtMostOnce`, `OneShotDeletedAfterRun`, `BlockingNoOverlap`, `ClaimHeld`, `NoLostWake`, `PausedNotSelected`, `DirtyArmed`, `RunnerFinishes`, `WriteSeen`, `WakeServed`.

- Profile `daemonOneshot` uses `packages/core/tla/TaskService.daemonOneshot.cfg`.
  - Constants. `Mode = "daemon"`. `Kind = "oneshot"`. `Blocking = TRUE`. `Tm = Tm`. `DueRunners = {d1}`. `DaemonRunners = {k1}`. `ByIdRunners = {}`. `MaxRequests = 0`. `MaxPauses = 1`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `OneShotAtMostOnce`, `OneShotDeletedAfterRun`, `BlockingNoOverlap`, `ClaimHeld`, `NoLostWake`, `PausedNotSelected`, `DirtyArmed`.
  - Temporal properties. `RunnerFinishes`, `WriteSeen`, `WakeServed`.
  - Deadlock checking. `TRUE`.
- Profile `daemonRepeat` uses `packages/core/tla/TaskService.daemonRepeat.cfg`.
  - Constants. `Mode = "daemon"`. `Kind = "repeat"`. `Blocking = TRUE`. `Tm = Tm`. `DueRunners = {d1}`. `DaemonRunners = {k1}`. `ByIdRunners = {b1}`. `MaxRequests = 1`. `MaxPauses = 1`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `OneShotAtMostOnce`, `OneShotDeletedAfterRun`, `BlockingNoOverlap`, `ClaimHeld`, `NoLostWake`, `PausedNotSelected`, `DirtyArmed`.
  - Temporal properties. `RunnerFinishes`, `WriteSeen`, `WakeServed`.
  - Deadlock checking. `TRUE`.
- Profile `localOneshot` uses `packages/core/tla/TaskService.localOneshot.cfg`.
  - Constants. `Mode = "local"`. `Kind = "oneshot"`. `Blocking = TRUE`. `Tm = Tm`. `DueRunners = {d1}`. `DaemonRunners = {}`. `ByIdRunners = {b1}`. `MaxRequests = 0`. `MaxPauses = 2`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `OneShotAtMostOnce`, `OneShotDeletedAfterRun`, `BlockingNoOverlap`, `ClaimHeld`, `NoLostWake`, `PausedNotSelected`, `DirtyArmed`.
  - Temporal properties. `RunnerFinishes`, `WriteSeen`, `WakeServed`.
  - Deadlock checking. `TRUE`.
- Profile `localRepeat` uses `packages/core/tla/TaskService.localRepeat.cfg`.
  - Constants. `Mode = "local"`. `Kind = "repeat"`. `Blocking = TRUE`. `Tm = Tm`. `DueRunners = {}`. `DaemonRunners = {}`. `ByIdRunners = {b1}`. `MaxRequests = 1`. `MaxPauses = 1`. `None = None`.
  - Specification. `Spec`.
  - Invariants. `TypeOK`, `OneShotAtMostOnce`, `OneShotDeletedAfterRun`, `BlockingNoOverlap`, `ClaimHeld`, `NoLostWake`, `PausedNotSelected`, `DirtyArmed`.
  - Temporal properties. `RunnerFinishes`, `WriteSeen`, `WakeServed`.
  - Deadlock checking. `TRUE`.

## Parallel implementation plan

1. Lifecycle group translates `PluginLifecycle`, `RuntimeLifecycle`, `ServiceLifecycle`, `TaskScheduler` and `TaskService`. These models share registration, start/stop, pending-work and scheduler retirement concerns but remain separate source models.
2. Interaction group translates `ActionSettlement`, `ApprovalService`, `InteractionSession` and `InteractiveTask`. Preserve delayed callback queues, receipts, retries and reducer transitions. Compare the InteractiveTask reducer graph only as additional evidence.
3. Utility/provider group translates `EmbeddingDimension`, `FactWriteDedupe`, `ProviderExecution`, `RoomHandlerQueue`, `Semaphore`, `Serialise` and `SingleFlightMemo`. Preserve coalescing, cache ownership, deduplication, queue bounds and fairness individually.
4. Integrate the family manifest and configuration runner only after independent translators freeze their bytes. Re-run every configured check against final hashes, record incomplete or timed-out checks explicitly, and audit for untranslated definitions or configuration drift.

## Validation boundaries

The first validation pass can use the existing pinned Quint CLI without changing the product or vendor sources. Existing long TLC checkpoint recovery remains separate work. New heavyweight exhaustive runs wait for host capacity. A passing bounded run will be recorded with its exact depth or simulation counts and never described as a universal proof.

No conversion has been claimed complete by this inventory report. The report and exact source/configuration hashes precede parallel implementation dispatch.

## Current-main checkpoint

The current product pin is `99b49439ce9d0cb5607e9831b9f7f58d89525029`.
All 16 authored modules and 31 configurations have identical bytes at this pin
and at `4787d51a142c63c98371c832997184c53f7218d3`.

The initial follow-up registers `CoreSerialise`, `CoreFactWriteDedupe`,
`CoreSemaphore` and `CoreProviderExecution`, preserving seven configuration
profiles. The default profiles pass the repository checker with 1,000 samples
of 80 steps. Alternate profiles use their own module instances and checks.
The raw transition relation is available for TLC deadlock checking. The
simulation and bounded safety relation also allows explicit stuttering.

Runtime source conformance, the remaining 12 translations and complete
repository and Android validation are tracked separately from this checkpoint.

## Configuration execution

The finite TLC phase compiles Quint’s exact `rawStep` action, which retains
the source `Next` relation. Each generated configuration explicitly selects the
original deadlock setting. The bounded checks use `step`, which includes
stuttering as permitted by the source temporal specification. For fair profiles,
the temporal check uses a fairness implication over the same transition
relation. `SingleFlightMemo.safety` records its original symmetry operator
while the generated runner explores the unreduced graph.

The profile checker validates all constant assignments, invariant and property
lists, deadlock and symmetry metadata, and original Git blob hashes before
running. Results distinguish type checking, scenarios, simulation, bounded
symbolic checking and a complete finite TLC exploration. Generated TLA is
backend output and lives only in test results.
