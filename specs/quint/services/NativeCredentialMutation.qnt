/// AlphaCredentialStore mutation classification, exact shutdown and guarded slot write.
module NativeCredentialMutation {
  type Mutation = {
    phase: str, operation: str, ownerEpoch: int, capturedEpoch: int,
    credential: int, before: int, replacement: int, providerRevision: int,
    capturedProvider: int, providerPresent: bool, matchingEnvironment: bool,
    admission: bool, oldSize: int, newSize: int, requiresStop: bool,
    running: bool, requestedStop: int, acknowledgedStop: int, stopped: bool,
    committed: bool, admissionInvalidated: bool, previousCredential: int, legacyBlocked: bool,
    leaseSequence: int, leasePending: bool, leaseConfirmed: bool, leaseAbandoned: bool,
    requestKnown: bool, requestBegun: bool, requestEpoch: int,
    // The Cloud slot written is production's, and the Cloud-change observer ran for this mutation.
    productionSlot: bool, observerNotified: bool
  }
  var s: Mutation
  action init = s' = {
    phase: "idle", operation: "cloud", ownerEpoch: 0, capturedEpoch: 0,
    credential: 1, before: 1, replacement: 1, providerRevision: 1,
    capturedProvider: 1, providerPresent: true, matchingEnvironment: true,
    admission: true, oldSize: 3, newSize: 1, requiresStop: false,
    running: true, requestedStop: 0, acknowledgedStop: 0, stopped: false,
    committed: false, admissionInvalidated: false, previousCredential: 1, legacyBlocked: false,
    leaseSequence: 0, leasePending: false, leaseConfirmed: false, leaseAbandoned: false,
    requestKnown: false, requestBegun: false, requestEpoch: 0,
    productionSlot: true, observerNotified: false }
  action begin(operation: str, replacement: int, bytes: int): bool = all {
    s.phase.in(Set("idle", "done", "conflict", "full", "failed")),
    operation.in(Set("cloud", "provider", "ordinary", "rollback", "rebind")),
    replacement.in(0.to(2)), bytes.in(1.to(4)),
    operation != "rebind" or replacement != 0,
    operation != "rebind" or s.providerPresent,
    val needsStop = operation.in(Set("provider", "rollback")) or
      operation == "cloud" and s.providerPresent and s.matchingEnvironment and replacement != s.credential
    s' = { ...s, phase: if (bytes > 3) "full" else "captured", operation: operation,
      before: s.credential, previousCredential: s.credential, replacement: replacement,
      capturedProvider: s.providerRevision, capturedEpoch: s.ownerEpoch, newSize: bytes,
      requiresStop: needsStop and bytes <= 3, committed: false, admissionInvalidated: false,
      observerNotified: false,
      requestedStop: 0, acknowledgedStop: 0, stopped: not(s.running) }
  }
  action retire = all {
    s.phase == "captured", s.requiresStop, s.capturedEpoch == s.ownerEpoch,
    s' = { ...s, phase: "stopping", requestedStop: 1, admission: false }
  }
  action observeStop(exact: bool, absent: bool): bool = all {
    s.phase == "stopping",
    s' = { ...s, acknowledgedStop: if (exact) s.requestedStop else 0,
      stopped: absent, running: not(absent) }
  }
  /// Only a replaced or removed production Cloud key reaches the Cloud-change observer. A provider
  /// change and a staging key do not.
  val cloudKeyReplaced = s.operation == "cloud" and s.productionSlot and s.replacement != s.before
  /// The observer runs after the recheck and before the slot bytes change.
  action prepareCommit = all {
    s.phase == "captured" and not(s.requiresStop) or
      s.phase == "stopping" and s.stopped and s.acknowledgedStop == s.requestedStop,
    s.capturedEpoch == s.ownerEpoch, s.before == s.credential,
    s.capturedProvider == s.providerRevision,
    val invalidates = s.operation.in(Set("provider", "rollback")) or
      s.operation == "cloud" and s.matchingEnvironment and s.replacement != s.before
    s' = { ...s, phase: "writing", admission: if (invalidates) false else s.admission,
      admissionInvalidated: invalidates, observerNotified: cloudKeyReplaced }
  }
  action writeResult(phase: str): bool = all {
    s.phase == "writing", s.newSize <= 2 or s.newSize <= s.oldSize,
    phase.in(Set("done", "failed", "written")),
    not(s.operation.in(Set("provider", "rollback", "rebind"))) or s.providerRevision < 4,
    s.capturedEpoch == s.ownerEpoch, s.before == s.credential,
    s.capturedProvider == s.providerRevision,
    s' = { ...s, phase: phase, credential: if (s.operation.in(Set("ordinary", "cloud"))) s.replacement else s.credential,
      providerRevision: if (s.operation.in(Set("provider", "rollback", "rebind"))) s.providerRevision + 1 else s.providerRevision,
      providerPresent: if (s.operation.in(Set("provider", "rollback", "rebind"))) s.replacement != 0 else s.providerPresent,
      oldSize: s.newSize, committed: true }
  }
  action write = writeResult("done")
  action writeUnconfirmed = writeResult("failed")
  action commitWrite = writeResult("written")
  action reportWrite(confirmed: bool): bool = all {
    s.phase == "written", s' = { ...s, phase: if (confirmed) "done" else "failed" }
  }
  action operationFailure = all {
    s.phase.in(Set("captured", "stopping", "writing")),
    s' = { ...s, phase: "failed", committed: false }
  }
  action compareConflict = all {
    s.phase == "captured", s' = { ...s, phase: "conflict", committed: false }
  }
  /// A retained legacy value may shrink; over-cap growth is refused before slot bytes change.
  action capacityFailure = all {
    s.phase == "writing", s.newSize > 2, s.newSize > s.oldSize,
    s' = { ...s, phase: "full" }
  }
  action stale = all {
    s.phase.in(Set("captured", "stopping", "writing")),
    s.capturedEpoch != s.ownerEpoch or s.before != s.credential or s.capturedProvider != s.providerRevision,
    s' = { ...s, phase: "conflict" }
  }
  action shutdownTimeout = all { s.phase == "stopping", s' = { ...s, phase: "failed" } }
  action ownerChanged = all {
    s.ownerEpoch < 2,
    s' = { ...s, ownerEpoch: s.ownerEpoch + 1, committed: false }
  }
  action concurrentProvider = all {
    s.providerRevision < 3,
    s' = { ...s, providerRevision: s.providerRevision + 1, admission: false, committed: false }
  }
  action ordinarySize = all { s.phase == "idle", s' = { ...s, oldSize: 1 } }
  action otherEnvironment = all { s.phase == "idle", s' = { ...s, matchingEnvironment: false } }
  /// The staging Cloud slot exists only with test mocks.
  action stagingSlot = all { s.phase == "idle", s' = { ...s, productionSlot: false } }
  action unbound = all { s.phase == "idle", s' = { ...s, providerPresent: false, admission: false } }
  action blockLegacy = s' = { ...s, legacyBlocked: true }
  action reserveProviderRequest = all {
    not(s.requestKnown), s.ownerEpoch < 2,
    s' = { ...s, ownerEpoch: s.ownerEpoch + 1, requestKnown: true, requestBegun: false,
      requestEpoch: s.ownerEpoch + 1, committed: false }
  }
  action beginProviderRequest = all {
    s.requestKnown, not(s.requestBegun), s.requestEpoch == s.ownerEpoch,
    s' = { ...s, requestBegun: true }
  }
  action staleProviderRequestRefused = all {
    s.requestKnown, not(s.requestBegun), s.requestEpoch != s.ownerEpoch,
    s' = { ...s, requestKnown: false, requestBegun: false }
  }
  action cancelProviderRequest(matching: bool): bool =
    if (matching and s.requestKnown) all {
      s.requestEpoch != s.ownerEpoch or s.ownerEpoch < 2,
      s' = { ...s, requestKnown: false, requestBegun: false, committed: false,
        ownerEpoch: if (s.requestEpoch == s.ownerEpoch) s.ownerEpoch + 1 else s.ownerEpoch }
    } else s' = s
  action expireProviderRequest = s' = { ...s, requestKnown: false, requestBegun: false }
  action finishProviderRequest(matching: bool): bool =
    if (matching) s' = { ...s, requestKnown: false, requestBegun: false } else s' = s
  action acquireShutdownLease = all {
    s.leaseSequence < 2,
    s' = { ...s, leaseSequence: s.leaseSequence + 1, leasePending: true,
      leaseConfirmed: false, leaseAbandoned: false }
  }
  action retryShutdownLease(token: int): bool = all {
    s.leasePending, token == s.leaseSequence, s' = s
  }
  action acknowledgeShutdownLease(token: int, stopped: bool): bool =
    if (s.leasePending and token == s.leaseSequence)
      s' = { ...s, leaseConfirmed: stopped, leasePending: not(stopped and s.leaseAbandoned) }
    else s' = s
  action abandonShutdownLease(token: int): bool =
    if (s.leasePending and token == s.leaseSequence)
      s' = { ...s, leaseAbandoned: true, leasePending: not(s.leaseConfirmed) }
    else s' = s
  action releaseShutdownLease(token: int): bool =
    if (token == s.leaseSequence and s.leaseConfirmed) s' = { ...s, leasePending: false }
    else s' = s
  action serviceStarts = all {
    not(s.leasePending), s.leaseSequence < 2,
    s' = { ...s, leaseSequence: s.leaseSequence + 1, leaseConfirmed: false }
  }
  action step = any {
    begin("cloud", 1, 1), begin("cloud", 2, 1), begin("cloud", 2, 3), begin("cloud", 2, 4),
    begin("provider", 2, 1), begin("ordinary", 2, 1), begin("rollback", 1, 1),
    begin("rebind", 2, 1), blockLegacy, reserveProviderRequest, beginProviderRequest, staleProviderRequestRefused,
    cancelProviderRequest(true), cancelProviderRequest(false), expireProviderRequest,
    finishProviderRequest(true), finishProviderRequest(false), acquireShutdownLease,
    retryShutdownLease(1), retryShutdownLease(2), acknowledgeShutdownLease(1, true),
    acknowledgeShutdownLease(1, false), acknowledgeShutdownLease(2, true),
    abandonShutdownLease(1), abandonShutdownLease(2), releaseShutdownLease(1), releaseShutdownLease(2), serviceStarts,
    retire, observeStop(true, true), observeStop(false, true), observeStop(true, false),
    prepareCommit, write, writeUnconfirmed, commitWrite, reportWrite(true), reportWrite(false), operationFailure, compareConflict,
    capacityFailure, stale, shutdownTimeout, ownerChanged,
    concurrentProvider, ordinarySize, otherEnvironment, unbound, stagingSlot, s' = s
  }
  val ShutdownBeforeCriticalWrite = s.committed and s.requiresStop implies s.stopped and s.requestedStop == s.acknowledgedStop
  val AdmissionInvalidated = s.admissionInvalidated implies not(s.admission)
  val CurrentMutation = s.committed implies s.capturedEpoch == s.ownerEpoch
  val RejectedWriteRetainsBytes = s.phase == "full" implies s.credential == s.previousCredential
  val Bounded = s.ownerEpoch.in(0.to(2)) and s.oldSize.in(1.to(3)) and s.providerRevision <= 4
  val LeaseBounds = s.leaseSequence.in(0.to(2)) and s.requestEpoch.in(0.to(2))
  val BegunRequestIsKnown = s.requestBegun implies s.requestKnown
  /// Slot bytes of a replaced production Cloud key change only after the observer ran.
  val CloudChangeObserved = s.committed and cloudKeyReplaced implies s.observerNotified
  val ObserverOnlyForReplacedCloudKey = s.observerNotified implies cloudKeyReplaced
  val safety = LeaseBounds and BegunRequestIsKnown and ShutdownBeforeCriticalWrite and AdmissionInvalidated and CurrentMutation and RejectedWriteRetainsBytes and Bounded
    and CloudChangeObserved and ObserverOnlyForReplacedCloudKey
  val ObserverBeforeFailedWriteWitness = s.observerNotified and s.phase == "failed" and not(s.committed)
  val StagingWriteUnobservedWitness = s.committed and s.operation == "cloud" and not(s.productionSlot) and
    s.replacement != s.before and not(s.observerNotified)
  val ProviderChangeUnobservedWitness = s.committed and s.operation == "provider" and not(s.observerNotified)
  run shutdownAckTest = init.then(begin("cloud", 2, 1)).then(retire).then(observeStop(false, true))
    .expect(s.phase == "stopping" and not(s.committed)).then(observeStop(true, true))
    .then(prepareCommit).then(write).expect(s.credential == 2 and safety)
  run staleProviderTest = init.then(begin("rollback", 1, 1)).then(retire).then(observeStop(true, true))
    .then(concurrentProvider).then(stale).expect(s.phase == "conflict" and not(s.committed) and safety)
  run retainedShrinkTest = init.then(begin("ordinary", 2, 3)).then(prepareCommit).then(write)
    .expect(s.committed and safety)
  run capacityRollbackTest = init.then(ordinarySize).then(begin("cloud", 2, 3)).then(retire)
    .then(observeStop(true, true)).then(prepareCommit).then(capacityFailure)
    .expect(s.credential == 1 and not(s.admission) and safety)
  run oversizedPreflightTest = init.then(begin("cloud", 2, 4))
    .expect(s.phase == "full" and s.running and s.requestedStop == 0 and safety)
  run unchangedCredentialAdmissionTest = init.then(begin("cloud", 1, 3))
    .then(prepareCommit).then(write).expect(s.running and s.admission and safety)
  run unrelatedEnvironmentTest = init.then(otherEnvironment).then(begin("cloud", 2, 1))
    .then(prepareCommit).then(write).expect(s.running and s.admission and safety)
  run unboundSignInTest = init.then(unbound).then(begin("cloud", 2, 1))
    .then(prepareCommit).then(write).expect(s.running and s.committed and safety)
  run failedWriteKeepsCredentialTest = init.then(begin("cloud", 2, 1)).then(retire)
    .then(observeStop(true, true)).then(prepareCommit).then(operationFailure)
    .expect(s.credential == 1 and not(s.committed) and s.phase == "failed" and safety)
  run committedWriteCanReportFailureTest = init.then(begin("cloud", 2, 1)).then(retire)
    .then(observeStop(true, true)).then(prepareCommit).then(writeUnconfirmed)
    .expect(s.credential == 2 and s.committed and s.phase == "failed" and safety)
  run clearedProviderNeedsNoSecondStopTest = init.then(begin("provider", 0, 1)).then(retire)
    .then(observeStop(true, true)).then(prepareCommit).then(write)
    .then(begin("cloud", 2, 1)).expect(not(s.requiresStop or s.providerPresent) and safety)
  run compareConflictKeepsCredentialTest = init.then(begin("cloud", 2, 1)).then(compareConflict)
    .expect(s.credential == 1 and not(s.committed) and safety)
  run sameBindingDoesNotStopRuntimeTest = init.then(begin("rebind", 2, 1)).then(prepareCommit).then(write)
    .expect(s.running and s.admission and s.providerRevision == 2 and safety)
  run writeCheckpointCanPrecedeReportedFailureTest = init.then(begin("cloud", 2, 1)).then(retire)
    .then(observeStop(true, true)).then(prepareCommit).then(commitWrite).then(reportWrite(false))
    .expect(s.committed and s.phase == "failed" and s.credential == 2 and safety)
  run abandonedShutdownWaitsForAckTest = init.then(acquireShutdownLease).then(abandonShutdownLease(1))
    .expect(s.leasePending).then(acknowledgeShutdownLease(1, true)).then(serviceStarts).expect(safety and not(s.leasePending))
  run acknowledgementKeepsStartFencedTest = init.then(acquireShutdownLease).then(acknowledgeShutdownLease(1, true))
    .expect(s.leasePending).then(releaseShutdownLease(1)).expect(safety and not(s.leasePending))
  run lateLeaseAckCannotReleaseSuccessorTest = init.then(acquireShutdownLease).then(acquireShutdownLease)
    .then(acknowledgeShutdownLease(1, true)).expect(safety and s.leasePending and not(s.leaseConfirmed))
  run providerCancellationRetiresIntentTest = init.then(reserveProviderRequest).then(beginProviderRequest)
    .then(cancelProviderRequest(true)).expect(safety and s.ownerEpoch == 2 and not(s.requestKnown))
  run unknownProviderCancellationPreservesLeaseTest = init.then(reserveProviderRequest).then(cancelProviderRequest(false))
    .expect(safety and s.requestKnown and s.ownerEpoch == 1)
  /// A replaced production key notifies the observer before the write; the same key written again does not.
  run cloudChangeObservedTest = init.then(begin("cloud", 2, 1)).then(retire).then(observeStop(true, true))
    .then(prepareCommit).expect(s.observerNotified and not(s.committed) and safety)
    .then(write).expect(s.credential == 2 and s.observerNotified and safety)
    .then(begin("cloud", 2, 1)).then(prepareCommit).then(write)
    .expect(s.committed and not(s.observerNotified) and safety)
  /// The observer has already run when the write then fails, so Cloud-bound background state is
  /// withdrawn although the stored key is unchanged.
  run observerPrecedesFailedWriteTest = init.then(begin("cloud", 2, 1)).then(retire).then(observeStop(true, true))
    .then(prepareCommit).then(operationFailure)
    .expect(ObserverBeforeFailedWriteWitness and s.credential == 1 and safety)
  run stagingSlotUnobservedTest = init.then(stagingSlot).then(otherEnvironment).then(begin("cloud", 2, 1))
    .then(prepareCommit).then(write).expect(StagingWriteUnobservedWitness and safety)
  run providerChangeUnobservedTest = init.then(begin("provider", 2, 1)).then(retire).then(observeStop(true, true))
    .then(prepareCommit).then(write).expect(ProviderChangeUnobservedWitness and safety)
}
