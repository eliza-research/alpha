/// Version-fenced manual submissions and the separate development trigger queue.
/// Current receipt delivery for an account-owned run is fenced to that account. Another account
/// cannot decide it and claims at most one best-effort cancellation with the existing request.
/// Completed/device-owned history is a separate policy; this model tracks one signed-in submission.
module WorkflowExecution {
  type Workflow = {
    mocks: bool, owner: int, epoch: int, version: int, reviewedVersion: int,
    phase: str, enabled: bool, queued: bool, queuedVersion: int, sourceCurrent: bool,
    intentSaved: bool, submission: int, admittedSubmission: int, executions: int,
    runOwner: int, runEpoch: int, receiptVisible: bool, approval: str, requestDigest: int,
    reviewedDigest: int, effects: int, cancelRequested: bool, outcome: str,
    ownershipPending: bool, recorded: bool, sourceAcknowledged: bool,
    storageReadable: bool, storageWritable: bool, ownershipRefused: bool, ownershipChurn: bool,
    cancelClaimed: bool, claimUnconfirmed: bool, switchCancels: int
  }
  var s: Workflow
  action initFor(mocks: bool): bool = s' = {
    mocks: mocks, owner: 1, epoch: 0, version: 0, reviewedVersion: 0,
    phase: "draft", enabled: false, queued: false, queuedVersion: 0, sourceCurrent: true,
    intentSaved: false, submission: 1, admittedSubmission: 0, executions: 0,
    runOwner: 0, runEpoch: 0, receiptVisible: false, approval: "none", requestDigest: 0,
    reviewedDigest: 0, effects: 0, cancelRequested: false, outcome: "none",
    ownershipPending: false, recorded: false, sourceAcknowledged: false,
    storageReadable: true, storageWritable: true, ownershipRefused: false, ownershipChurn: false,
    cancelClaimed: false, claimUnconfirmed: false, switchCancels: 0 }
  action init = {
    nondet mocks = Set(false, true).oneOf()
    initFor(mocks)
  }
  val currentRunOwner = s.runOwner == s.owner and s.runEpoch == s.epoch
  val knownExecution = s.admittedSubmission == s.submission
  val receiptPhase = if (s.outcome == "none") "running" else "finished"
  val eligibleDevelopmentTrigger = s.mocks and s.enabled and s.queued and s.queuedVersion == s.version and s.sourceCurrent

  action validate = all { s.phase == "draft", s' = { ...s, phase: "review", reviewedVersion: s.version } }
  action edit = all {
    s.phase.in(Set("draft", "review", "installed")), s.version < 2,
    s' = { ...s, version: s.version + 1, phase: "draft", enabled: false }
  }
  action save = all {
    s.phase == "review", s.reviewedVersion == s.version,
    s' = { ...s, phase: "installed" }
  }
  action enable = all { s.phase == "installed", s' = s.with("enabled", true) }
  action disable = s' = s.with("enabled", false)
  // The stored job may remain until an unblocked foreground tick filters disabled work.
  action pruneDisabledQueue = all { not(s.enabled) or s.queuedVersion != s.version, s' = s.with("queued", false) }
  action trigger = all {
    s.mocks, s.phase == "installed", s.enabled, not(s.queued),
    s' = { ...s, queued: true, queuedVersion: s.version, sourceCurrent: true }
  }
  action sourceChanged = s' = s.with("sourceCurrent", false)
  action retainSubmission(manual: bool): bool = all {
    s.phase == "installed", s.reviewedVersion == s.version,
    manual or eligibleDevelopmentTrigger, s.storageReadable, s.storageWritable,
    s' = { ...s, phase: "submitting", intentSaved: true, runOwner: s.owner,
      runEpoch: s.epoch, ownershipPending: true, queued: if (manual) s.queued else false }
  }
  /// A reservation must be durable before the request leaves. A refused read or write never
  /// dispatches the run. The separate intent journal may still retain the unsent request.
  action reservationRefused = all {
    s.phase == "installed", not(s.storageReadable and s.storageWritable),
    s' = { ...s, ownershipRefused: true }
  }
  /// Controlled storage outcomes at the ownership guard. A failed read cannot deliver a receipt.
  action ownershipStorage(readable: bool, writable: bool): bool =
    s' = { ...s, storageReadable: readable, storageWritable: writable,
      receiptVisible: s.receiptVisible and readable }
  /// Other runs may add ownership records, but cannot evict this run's unfinished ownership.
  action otherOwnershipRecorded = all {
    s.ownershipPending or s.recorded, s' = { ...s, ownershipChurn: true }
  }
  // A different writer can change the current version while the reviewed request is in flight.
  action serverVersionChanged = all {
    s.phase.in(Set("submitting", "uncertain", "unadmitted", "resend-review", "running")), s.version < 2,
    s' = s.with("version", s.version + 1)
  }
  action admit = all {
    s.phase == "submitting", s.intentSaved, s.ownershipPending, s.reviewedVersion == s.version,
    s.storageReadable, s.storageWritable,
    s' = { ...s, phase: if (currentRunOwner) receiptPhase else "uncertain",
      receiptVisible: currentRunOwner, admittedSubmission: s.submission,
      executions: if (knownExecution) s.executions else s.executions + 1,
      ownershipPending: false, recorded: true, sourceAcknowledged: true }
  }
  /// The agent accepted a dispatched request, but promoting its reservation failed. The durable
  /// pending ownership still fences the run, and the account-bearing intent is not acknowledged.
  action acceptedWithoutPromotion = all {
    s.phase == "submitting", s.intentSaved, s.ownershipPending, s.reviewedVersion == s.version,
    not(s.storageReadable and s.storageWritable),
    s' = { ...s, phase: "uncertain", receiptVisible: false, ownershipRefused: true,
      admittedSubmission: s.submission, executions: if (knownExecution) s.executions else s.executions + 1 }
  }
  /// The promotion write applied, but its readback failed. The exact accepted ownership is
  /// durable; the caller still refuses publication and leaves the separate intent unacknowledged.
  action acceptedPromotionUnconfirmed = all {
    s.phase == "submitting", s.intentSaved, s.ownershipPending, s.reviewedVersion == s.version,
    s.storageReadable, s.storageWritable,
    s' = { ...s, phase: "uncertain", receiptVisible: false, ownershipPending: false, recorded: true,
      storageReadable: false, ownershipRefused: true, admittedSubmission: s.submission,
      executions: if (knownExecution) s.executions else s.executions + 1 }
  }
  /// Receipt lookup, also by another account, may promote the retained request. Publication is
  /// still restricted to the current account; only then can the separate intent be acknowledged.
  action promoteOwnership = all {
    s.ownershipPending, knownExecution, s.storageReadable, s.storageWritable,
    s' = { ...s, ownershipPending: false, recorded: true, sourceAcknowledged: true,
      phase: if (currentRunOwner) receiptPhase else "uncertain", receiptVisible: currentRunOwner }
  }
  action unknownSubmission = all { s.phase == "submitting", s' = s.with("phase", "uncertain") }
  // The original request can arrive after a missing lookup but before a confirmed resend.
  action lateAdmission = all {
    s.phase.in(Set("uncertain", "unadmitted", "resend-review")), s.intentSaved,
    s.reviewedVersion == s.version, not(knownExecution),
    s' = { ...s, admittedSubmission: s.submission, executions: s.executions + 1 }
  }
  action refuseVersion = all {
    s.phase == "submitting", s.reviewedVersion != s.version, not(knownExecution),
    s' = { ...s, phase: "abandoned", intentSaved: false, ownershipPending: false }
  }
  // A retained identity is scoped to the same owner. A fresh view obtains its own epoch.
  action reopenOwner = all {
    s.intentSaved, s.runOwner == s.owner, s.runEpoch != s.epoch,
    s' = { ...s, runEpoch: s.epoch, phase: "uncertain", receiptVisible: false }
  }
  action reconcile(found: bool): bool = all {
    s.phase == "uncertain", currentRunOwner, found == knownExecution, s.storageReadable,
    val promoted = found and (s.recorded or s.storageWritable)
    val abandoned = not(found) and s.reviewedVersion != s.version
    s' = { ...s, phase: if (found) (if (promoted) receiptPhase else "uncertain")
        else if (abandoned) "abandoned" else "unadmitted",
      receiptVisible: promoted, intentSaved: found or not(abandoned),
      ownershipPending: not(promoted or abandoned) and s.ownershipPending,
      recorded: s.recorded or promoted, sourceAcknowledged: s.sourceAcknowledged or promoted,
      ownershipRefused: s.ownershipRefused or (found and not(promoted)) }
  }
  action reviewResend = all {
    s.phase == "unadmitted", currentRunOwner, s.reviewedVersion == s.version,
    s' = s.with("phase", "resend-review")
  }
  // A second tap rechecks the retained identity. A receipt wins over any repeat submission.
  action confirmResend = all {
    s.phase == "resend-review", currentRunOwner, s.intentSaved, s.storageReadable,
    not(knownExecution) or s.recorded or s.storageWritable,
    s' = { ...s, phase: if (knownExecution) receiptPhase else if (s.reviewedVersion == s.version) "submitting" else "abandoned",
      receiptVisible: knownExecution, intentSaved: knownExecution or s.reviewedVersion == s.version,
      ownershipPending: not(knownExecution) and s.ownershipPending,
      recorded: s.recorded or knownExecution, sourceAcknowledged: s.sourceAcknowledged or knownExecution }
  }
  action abandonChangedReview = all {
    s.phase.in(Set("unadmitted", "resend-review")), currentRunOwner, s.reviewedVersion != s.version,
    s' = s.with("phase", "uncertain")
  }
  action propose = all {
    s.phase == "running", s.approval == "none", s.effects == 0, not(s.cancelRequested),
    s' = { ...s, approval: "pending", requestDigest: 1 }
  }
  action decide(approve: bool): bool = all {
    s.phase == "running", s.receiptVisible, s.approval == "pending", currentRunOwner,
    not(s.cancelRequested),
    s' = { ...s, approval: if (approve) "approved" else "denied", reviewedDigest: s.requestDigest }
  }
  action execute = all {
    s.phase == "running", s.approval == "approved", s.reviewedDigest == s.requestDigest,
    currentRunOwner, not(s.cancelRequested), s.effects == 0,
    s' = { ...s, effects: 1 }
  }
  action cancel = all {
    s.phase == "running", s.receiptVisible, currentRunOwner,
    s' = s.with("cancelRequested", true)
  }
  action finish = all {
    knownExecution, s.outcome == "none",
    s' = { ...s, phase: if (s.phase == "running") "finished" else s.phase,
      outcome: if (s.cancelRequested) "cancelled" else "succeeded" }
  }
  /// A restart keeps the saved run record and its claim.
  action restart = s' = { ...s, receiptVisible: false,
    phase: if (s.phase.in(Set("submitting", "unadmitted", "resend-review", "running", "finished"))) "uncertain" else s.phase }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1, receiptVisible: false,
      phase: if (s.phase.in(Set("unadmitted", "resend-review"))) "uncertain" else s.phase }
  }
  /// The signed-in account is not the one that started a run this phone recorded as unfinished.
  /// The claim for the one cancellation is saved before the request leaves, so a request that is
  /// lost (`delivered` false) is never repeated. Nothing waits for it: switchOwner is a separate
  /// step and is enabled whether or not this one happens. Through another agent connection the
  /// request cannot be sent and this step does not happen. The agent ignores it for a finished run.
  action cancelOtherAccountRun(delivered: bool): bool = all {
    s.recorded, s.runOwner != s.owner, not(s.cancelClaimed), s.storageReadable, s.storageWritable,
    s' = { ...s, cancelClaimed: true, switchCancels: s.switchCancels + 1,
      cancelRequested: s.cancelRequested or (delivered and s.outcome == "none") }
  }
  /// A claim write may apply before its readback fails. No request leaves, and the saved claim
  /// prevents a later retry: best effort permits zero requests as well as one lost request.
  action unconfirmedCancelClaim = all {
    s.recorded, s.runOwner != s.owner, not(s.cancelClaimed), s.storageReadable, s.storageWritable,
    s' = { ...s, cancelClaimed: true, claimUnconfirmed: true, storageReadable: false, receiptVisible: false }
  }
  action step = any {
    validate, edit, save, enable, disable, pruneDisabledQueue, trigger, sourceChanged, retainSubmission(true),
    retainSubmission(false), reservationRefused, ownershipStorage(true, true), ownershipStorage(true, false),
    ownershipStorage(false, true), ownershipStorage(false, false), otherOwnershipRecorded, serverVersionChanged, admit,
    acceptedWithoutPromotion, acceptedPromotionUnconfirmed, promoteOwnership, unknownSubmission, lateAdmission, refuseVersion,
    reopenOwner, reconcile(true), reconcile(false), reviewResend, confirmResend, abandonChangedReview,
    propose, decide(true), decide(false), execute, cancel, finish, restart, switchOwner, cancelOtherAccountRun(true),
    cancelOtherAccountRun(false), unconfirmedCancelClaim, s' = s
  }
  val AtMostOneExecution = s.executions <= 1
  val DurableSubmission = s.phase.in(Set("submitting", "uncertain", "unadmitted", "resend-review", "running", "finished")) implies s.intentSaved
  val ReviewedEffect = s.effects > 0 implies s.approval == "approved" and s.reviewedDigest == s.requestDigest
  val CancellationNeedsExecution = s.cancelRequested implies knownExecution
  val ReceiptBelongsToCurrentOwner = s.receiptVisible implies knownExecution and currentRunOwner
  val AbandonedWasNeverAdmitted = s.phase == "abandoned" implies not(knownExecution or s.intentSaved)
  val FixtureQueueRequiresMocks = s.queued implies s.mocks
  val RecordedRunWasAdmitted = s.recorded implies knownExecution
  val DispatchedRunKeepsOwnership = s.intentSaved implies s.ownershipPending or s.recorded
  val AcknowledgedOwnershipWasPromoted = s.sourceAcknowledged implies s.recorded and not(s.ownershipPending)
  val VisibleReceiptHasReadableOwnership = s.receiptVisible implies s.storageReadable and s.recorded
  val SwitchCancelAtMostOnce = s.switchCancels <= 1 and (s.switchCancels > 0 implies s.cancelClaimed)
  val SavedClaimHasOutcome = s.cancelClaimed implies s.switchCancels == 1 or s.claimUnconfirmed
  val UnconfirmedClaimNeverSends = s.claimUnconfirmed implies s.cancelClaimed and s.switchCancels == 0
  val SwitchCancelNeedsRecordedRun = s.cancelClaimed implies s.recorded and knownExecution
  val TypeOK = s.phase.in(Set("draft", "review", "installed", "submitting", "uncertain", "unadmitted", "resend-review", "abandoned", "running", "finished")) and s.approval.in(Set("none", "pending", "approved", "denied")) and s.version.in(0.to(2)) and s.epoch.in(0.to(2)) and s.effects.in(0.to(1)) and s.executions.in(0.to(1)) and s.switchCancels.in(0.to(1))
  val safety = TypeOK and AtMostOneExecution and DurableSubmission and ReviewedEffect and CancellationNeedsExecution and ReceiptBelongsToCurrentOwner and AbandonedWasNeverAdmitted and FixtureQueueRequiresMocks
    and RecordedRunWasAdmitted and DispatchedRunKeepsOwnership and AcknowledgedOwnershipWasPromoted
    and VisibleReceiptHasReadableOwnership and SwitchCancelAtMostOnce and SavedClaimHasOutcome
    and UnconfirmedClaimNeverSends and SwitchCancelNeedsRecordedRun
  val SwitchCancelledWitness = s.outcome == "cancelled" and s.switchCancels == 1 and s.runOwner != s.owner
  val LostSwitchCancelWitness = s.switchCancels == 1 and s.outcome == "succeeded" and not(s.cancelRequested)
  val OtherAccountPendingApprovalWitness = s.approval == "pending" and s.runOwner != s.owner and s.phase == "running"
  val ReturnedAccountSeesRunWitness = s.receiptVisible and s.epoch == 2 and s.switchCancels == 0
  val ReservationRefusedWitness = s.ownershipRefused and not(s.intentSaved) and s.executions == 0
  val AcceptedPendingOwnershipWitness = knownExecution and s.ownershipPending and not(s.recorded or s.sourceAcknowledged)
  val PromotionRecoveredWitness = s.ownershipRefused and s.recorded and s.sourceAcknowledged
  val OwnershipSurvivesChurnWitness = s.ownershipChurn and s.recorded and s.outcome == "none"
  val UnconfirmedPromotionWitness = knownExecution and s.recorded and not(s.sourceAcknowledged) and not(s.storageReadable)
  val UnconfirmedClaimWitness = s.claimUnconfirmed and s.cancelClaimed and s.switchCancels == 0

  run reviewedExecutionTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(propose).then(decide(true)).then(execute).then(finish)
    .expect(s.effects == 1 and s.outcome == "succeeded" and safety)
  run unknownSubmissionTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(unknownSubmission).then(restart).then(reconcile(false))
    .expect(s.phase == "unadmitted" and s.executions == 0 and safety)
    .then(reviewResend).expect(s.phase == "resend-review" and s.executions == 0 and safety)
    .then(confirmResend).then(admit).expect(s.executions == 1 and safety)
  run lateAdmissionWinsResendTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(unknownSubmission).then(reconcile(false)).then(reviewResend).then(lateAdmission)
    .then(confirmResend).expect(s.phase == "running" and s.receiptVisible and s.executions == 1 and safety)
  run changedVersionAbandonsUnknownRequestTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(unknownSubmission).then(serverVersionChanged).then(reconcile(false))
    .expect(s.phase == "abandoned" and s.executions == 0 and safety)
  run changedVersionRefusesInFlightRequestTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(serverVersionChanged).then(refuseVersion)
    .expect(s.phase == "abandoned" and s.executions == 0 and safety)
  /// The switch itself sends nothing and waits for nothing; without a cancellation request
  /// (another agent connection) the run finishes and its own account finds it again.
  run ownerSwitchDoesNotCancelRunTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(switchOwner).expect(not(s.receiptVisible or s.cancelRequested) and safety)
    .then(finish).expect(s.outcome == "succeeded" and safety)
    .then(switchOwner).then(reopenOwner).then(reconcile(true))
    .expect(s.phase == "finished" and s.receiptVisible and s.executions == 1 and safety)
  /// The other account never sees the run. The one cancellation is not repeated, and no effect
  /// runs after it.
  run accountSwitchCancelsOnceTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(propose).expect(s.receiptVisible and s.recorded and safety)
    .then(switchOwner).expect(not(s.receiptVisible or s.cancelRequested) and safety)
    .then(cancelOtherAccountRun(true)).expect(s.cancelRequested and s.switchCancels == 1 and safety)
    .then(finish).expect(s.outcome == "cancelled" and s.effects == 0 and not(s.receiptVisible) and safety)
    .then(cancelOtherAccountRun(true).fail())
  run otherAccountCannotDecideTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(propose).then(switchOwner).expect(s.approval == "pending" and safety)
    .then(decide(true).fail())
  run otherAccountCannotCancelByHandTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(switchOwner).expect(s.phase == "running" and safety)
    .then(cancel.fail())
  run ownAccountRunNotCancelledTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).expect(s.recorded and safety)
    .then(cancelOtherAccountRun(true).fail())
  /// A cancellation that never arrives is not sent again.
  run lostSwitchCancelTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(switchOwner).then(cancelOtherAccountRun(false))
    .expect(not(s.cancelRequested) and s.switchCancels == 1 and safety)
    .then(cancelOtherAccountRun(true).fail())
  /// A lost cancellation holds up neither a later switch nor the run, whose own account finds it again.
  run lostSwitchCancelKeepsSwitchingTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(switchOwner).then(cancelOtherAccountRun(false)).then(switchOwner)
    .expect(s.owner == 1 and s.switchCancels == 1 and safety)
    .then(finish).then(reopenOwner).then(reconcile(true))
    .expect(s.outcome == "succeeded" and s.receiptVisible and safety)
  /// A run accepted after the account changed is recorded for the account that asked for it,
  /// stays hidden, and is cancelled once.
  run acceptedAfterSwitchCancelledTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(switchOwner).then(admit).expect(s.phase == "uncertain" and not(s.receiptVisible) and s.recorded and safety)
    .then(cancelOtherAccountRun(true)).then(finish)
    .expect(s.outcome == "cancelled" and not(s.receiptVisible) and s.executions == 1 and safety)
  run refusedReservationNeverDispatchesTest = initFor(false).then(validate).then(save)
    .then(ownershipStorage(true, false)).then(reservationRefused)
    .expect(ReservationRefusedWitness and not(s.ownershipPending) and safety)
    .then(retainSubmission(true).fail())
  run unreadableOwnershipNeverDispatchesTest = initFor(false).then(validate).then(save)
    .then(ownershipStorage(false, true)).then(reservationRefused)
    .expect(ReservationRefusedWitness and safety).then(retainSubmission(true).fail())
  run acceptedPromotionFailureKeepsFenceTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(ownershipStorage(true, false)).then(acceptedWithoutPromotion)
    .expect(AcceptedPendingOwnershipWitness and not(s.receiptVisible) and safety)
    .then(switchOwner).then(restart)
    .expect(s.ownershipPending and not(s.sourceAcknowledged or s.receiptVisible) and safety)
    .then(ownershipStorage(true, true)).then(promoteOwnership)
    .expect(PromotionRecoveredWitness and not(s.receiptVisible) and safety)
    .then(cancelOtherAccountRun(true)).then(finish).expect(s.outcome == "cancelled" and safety)
  run unreadableReceiptStaysSuspendedTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(ownershipStorage(false, true)).then(restart)
    .expect(s.recorded and not(s.receiptVisible) and safety)
    .then(ownershipStorage(true, true)).then(reconcile(true)).expect(s.receiptVisible and safety)
  run unreadableOwnershipBlocksReceiptTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(ownershipStorage(false, true)).then(restart)
    .expect(s.recorded and not(s.receiptVisible) and safety).then(reconcile(true).fail())
  run refusedCancelClaimNeverSendsTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(switchOwner).then(ownershipStorage(true, false))
    .expect(s.switchCancels == 0 and not(s.cancelClaimed) and safety)
    .then(restart).then(ownershipStorage(true, true)).then(cancelOtherAccountRun(false))
    .expect(s.switchCancels == 1 and s.cancelClaimed and not(s.cancelRequested) and safety)
  run refusedCancelClaimIsDisabledTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(switchOwner).then(ownershipStorage(true, false))
    .expect(s.switchCancels == 0 and not(s.cancelClaimed) and safety).then(cancelOtherAccountRun(true).fail())
  run unrelatedRecordsKeepOwnershipTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(otherOwnershipRecorded).then(switchOwner).then(restart)
    .expect(OwnershipSurvivesChurnWitness and not(s.receiptVisible) and safety)
    .then(cancelOtherAccountRun(false)).expect(s.switchCancels == 1 and safety)
  run acceptedPromotionReadbackFailureTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(acceptedPromotionUnconfirmed).expect(UnconfirmedPromotionWitness and not(s.ownershipPending) and safety)
    .then(restart).expect(s.recorded and not(s.sourceAcknowledged or s.receiptVisible) and safety)
    .then(ownershipStorage(true, true)).then(reconcile(true)).expect(s.sourceAcknowledged and s.receiptVisible and safety)
  run claimReadbackFailureNeverRetriesTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(switchOwner).then(unconfirmedCancelClaim)
    .expect(UnconfirmedClaimWitness and not(s.cancelRequested) and safety)
    .then(restart).then(ownershipStorage(true, true)).then(cancelOtherAccountRun(true).fail())
  run denialAndCancelTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(propose).then(decide(false)).then(cancel).then(finish)
    .expect(s.effects == 0 and s.outcome == "cancelled" and safety)
  run triggerDisableTest = initFor(true).then(validate).then(save).then(enable).then(trigger)
    .then(disable).expect(s.queued and not(eligibleDevelopmentTrigger) and safety)
    .then(pruneDisabledQueue).expect(not(s.queued) and safety)
  run changedDefinitionCannotDispatchQueuedJobTest = initFor(true).then(validate).then(save)
    .then(enable).then(trigger).then(edit).then(validate).then(save).then(enable)
    .expect(s.queued and not(eligibleDevelopmentTrigger) and safety)
    .then(pruneDisabledQueue).expect(not(s.queued) and safety)
}
