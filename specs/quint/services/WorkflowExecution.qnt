/// Manual production workflows, optional development triggers, and durable reviewed submissions.
/// The agent admits a submission identity at most once. An agent without submission identities
/// (legacy) cannot be asked what became of a request.
module WorkflowExecution {
  type Workflow = {
    mocks: bool, legacy: bool, owner: int, epoch: int, version: int, reviewedVersion: int,
    phase: str, enabled: bool, queued: bool, queuedVersion: int, sourceCurrent: bool,
    triggerDispatchEnabled: bool, intentSaved: bool, submission: int, submittedVersion: int,
    admitted: bool, subExecutions: int, ranVersion: int, abandoned: bool, ownerReview: bool,
    runOwner: int, runEpoch: int, approval: str, requestDigest: int,
    reviewedDigest: int, effectDigest: int, effects: int, cancelRequested: bool, outcome: str
  }
  var s: Workflow
  pure def initialState(mocks: bool, legacy: bool): Workflow = {
    mocks: mocks, legacy: legacy, owner: 1, epoch: 0, version: 0, reviewedVersion: 0,
    phase: "draft", enabled: false, queued: false, queuedVersion: 0, sourceCurrent: true,
    triggerDispatchEnabled: true, intentSaved: false, submission: 0, submittedVersion: 0,
    admitted: false, subExecutions: 0, ranVersion: 0, abandoned: false, ownerReview: false,
    runOwner: 0, runEpoch: 0, approval: "none", requestDigest: 0,
    reviewedDigest: 0, effectDigest: 0, effects: 0, cancelRequested: false, outcome: "none" }
  /// An agent that keeps submission identities.
  action initFor(mocks: bool): bool = s' = initialState(mocks, false)
  /// An agent without submission identities.
  action initLegacy(mocks: bool): bool = s' = initialState(mocks, true)
  action init = {
    nondet mocks = Set(false, true).oneOf()
    nondet legacy = Set(false, true).oneOf()
    s' = initialState(mocks, legacy)
  }
  val Bound = s.runOwner == s.owner and s.runEpoch == s.epoch
  val Retained = s.phase.in(Set("submitting", "uncertain", "unadmitted"))
  val TriggerReady = s.mocks and s.queued and s.enabled and s.queuedVersion == s.version and s.sourceCurrent
  action validate = all { s.phase == "draft", s' = { ...s, phase: "review", reviewedVersion: s.version } }
  action edit = all {
    s.phase.in(Set("draft", "review", "installed")), s.version < 2,
    s' = { ...s, version: s.version + 1, phase: "draft", enabled: false }
  }
  action save = all {
    s.phase == "review", s.reviewedVersion == s.version,
    s' = { ...s, phase: "installed" }
  }
  /// The workflow changes on the agent while this phone holds an older copy or an open request.
  action remoteEdit = all {
    s.phase.in(Set("installed", "submitting", "uncertain", "unadmitted")), s.version < 2,
    s' = { ...s, version: s.version + 1 }
  }
  /// The current steps are read and reviewed again before another run.
  action reviewCurrent = all {
    s.phase == "installed", s.reviewedVersion != s.version,
    s' = { ...s, reviewedVersion: s.version }
  }
  action enable = all { s.phase == "installed", s' = { ...s, enabled: true } }
  /// Disabling leaves a queued occurrence in the saved queue until the next foreground check.
  action disable = s' = { ...s, enabled: false }
  action trigger = all {
    s.mocks, s.phase == "installed", s.enabled, not(s.queued),
    s' = { ...s, queued: true, queuedVersion: s.version }
  }
  /// A foreground check drops queued occurrences of a disabled or changed workflow.
  action scanTick = all {
    s.mocks,
    s' = { ...s, queued: s.queued and s.enabled and s.queuedVersion == s.version }
  }
  action sourceChanged = s' = { ...s, sourceCurrent: false }
  action retainSubmission(manual: bool): bool = all {
    s.phase == "installed", s.reviewedVersion == s.version, s.submission < 2,
    manual or TriggerReady,
    s' = { ...s, phase: "submitting", intentSaved: true, submission: s.submission + 1,
      submittedVersion: s.version, admitted: false, subExecutions: 0, abandoned: false,
      ownerReview: false, runOwner: s.owner, runEpoch: s.epoch,
      queued: manual and s.queued,
      triggerDispatchEnabled: if (manual) s.triggerDispatchEnabled else s.enabled }
  }
  /// The request reaches the agent. With submission identities the agent refuses a version it
  /// was not asked for; a legacy agent runs whatever version it holds.
  action serverAdmit = all {
    Retained, not(s.admitted), s.legacy or s.submittedVersion == s.version,
    s' = { ...s, admitted: true, subExecutions: s.subExecutions + 1, ranVersion: s.version }
  }
  /// A refusal is a known non-run: the request is cleared and the changed steps need review.
  action admissionRejected = all {
    s.phase == "submitting", not(s.legacy), not(s.admitted), s.submittedVersion != s.version, Bound,
    s' = { ...s, phase: "installed", intentSaved: false }
  }
  action receipt = all {
    s.phase == "submitting", s.admitted, s.ranVersion == s.submittedVersion, Bound,
    s' = { ...s, phase: "running", intentSaved: false }
  }
  /// A run of another version is reported and never shown as the accepted run.
  action versionMismatch = all {
    s.phase == "submitting", s.admitted, s.ranVersion != s.submittedVersion, Bound,
    s' = { ...s, phase: "uncertain" }
  }
  action unknownSubmission = all { s.phase == "submitting", s' = { ...s, phase: "uncertain" } }
  /// Reconciliation only reads. A request the agent never admitted waits for the owner, or is
  /// cleared when the workflow has changed since and can no longer start.
  action reconcile = all {
    s.phase == "uncertain", not(s.legacy), Bound,
    if (s.admitted) s' = { ...s, phase: "running", intentSaved: false, ownerReview: false }
    else if (s.version != s.submittedVersion)
      s' = { ...s, phase: "installed", intentSaved: false, abandoned: true, ownerReview: false }
    else s' = { ...s, phase: "unadmitted", ownerReview: false }
  }
  /// The first tap asks for confirmation. The second sends the same submission identity again.
  action resend = all {
    s.phase == "unadmitted", Bound,
    if (s.ownerReview) s' = { ...s, ownerReview: false, phase: "submitting" }
    else s' = { ...s, ownerReview: true }
  }
  /// A legacy request can never be matched to a run. The owner clears it after checking the
  /// executions list. Clearing sends nothing.
  action clearRequest = all {
    s.phase == "uncertain", s.legacy, Bound,
    if (s.ownerReview) s' = { ...s, ownerReview: false, phase: "installed", intentSaved: false }
    else s' = { ...s, ownerReview: true }
  }
  action propose = all {
    s.phase == "running", s.approval == "none", s.effects == 0, not(s.cancelRequested),
    s' = { ...s, approval: "pending", requestDigest: 1 }
  }
  /// The run asks again with different content. An earlier decision does not cover it.
  action requestChanged = all {
    s.phase == "running", s.approval.in(Set("pending", "approved")), s.requestDigest < 2, s.effects == 0,
    s' = { ...s, requestDigest: s.requestDigest + 1 }
  }
  action decide(approve: bool): bool = all {
    s.phase == "running", Bound, not(s.cancelRequested),
    s.approval == "pending" or (s.approval == "approved" and s.reviewedDigest != s.requestDigest),
    s' = { ...s, approval: if (approve) "approved" else "denied",
      reviewedDigest: s.requestDigest }
  }
  action execute = all {
    s.phase == "running", s.approval == "approved", s.reviewedDigest == s.requestDigest,
    Bound, not(s.cancelRequested), s.effects == 0,
    s' = { ...s, effects: 1, effectDigest: s.requestDigest }
  }
  /// Cancellation names an execution receipt, so it exists only for an accepted run.
  action cancel = all {
    s.phase == "running", Bound,
    s' = { ...s, cancelRequested: true }
  }
  action finish = all {
    s.phase == "running",
    s' = { ...s, phase: "finished", outcome: if (s.cancelRequested) "cancelled" else "succeeded" }
  }
  action restart = s' = { ...s, ownerReview: false,
    phase: if (s.phase.in(Set("submitting", "unadmitted"))) "uncertain" else s.phase }
  /// Another account stops this phone acting on the run. The agent's run is not cancelled.
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1, queued: false,
      ownerReview: false }
  }
  action step = any {
    validate, edit, save, remoteEdit, reviewCurrent, enable, disable, trigger, scanTick,
    sourceChanged, retainSubmission(true), retainSubmission(false), serverAdmit,
    admissionRejected, receipt, versionMismatch, unknownSubmission, reconcile, resend,
    clearRequest, propose, requestChanged, decide(true), decide(false), execute, cancel,
    finish, restart, switchOwner, s' = s
  }
  val AtMostOneExecution = s.subExecutions <= 1
  val DurableSubmission = Retained implies s.intentSaved
  val AcceptedRunIsReviewedVersion = s.phase.in(Set("running", "finished")) implies
    s.admitted and s.ranVersion == s.submittedVersion
  val ProtocolAdmitsReviewedVersion = not(s.legacy) and s.subExecutions > 0 implies s.ranVersion == s.submittedVersion
  val AbandonedNeverRan = s.abandoned implies s.subExecutions == 0
  val OwnerConfirmsRepeat = s.ownerReview implies s.phase.in(Set("unadmitted", "uncertain"))
  val ReviewedEffect = s.effects > 0 implies s.approval == "approved" and s.reviewedDigest == s.effectDigest
  val CancelNeedsReceipt = s.cancelRequested implies s.admitted
  val TriggerDispatchEnabled = s.triggerDispatchEnabled
  val ProductionTriggerGate = not(s.mocks) implies not(s.queued)
  val TypeOK = s.phase.in(Set("draft", "review", "installed", "submitting", "uncertain", "unadmitted", "running", "finished"))
    and s.approval.in(Set("none", "pending", "approved", "denied")) and s.version.in(0.to(2))
    and s.epoch.in(0.to(2)) and s.effects.in(0.to(1)) and s.submission.in(0.to(2))
    and s.requestDigest.in(0.to(2))
  val safety = TypeOK and AtMostOneExecution and DurableSubmission and AcceptedRunIsReviewedVersion
    and ProtocolAdmitsReviewedVersion and AbandonedNeverRan and OwnerConfirmsRepeat
    and ReviewedEffect and CancelNeedsReceipt and TriggerDispatchEnabled and ProductionTriggerGate
  val UnadmittedWitness = s.phase == "unadmitted" and s.ownerReview
  val AbandonedWitness = s.abandoned and s.phase == "installed"
  val LegacyUncertainRanWitness = s.legacy and s.phase == "uncertain" and s.admitted
  val LegacyOtherVersionWitness = s.legacy and s.subExecutions == 1 and s.ranVersion != s.submittedVersion
  val StaleApprovalWitness = s.approval == "approved" and s.reviewedDigest != s.requestDigest
  val DisabledQueuedWitness = s.queued and not(s.enabled)
  val OtherOwnerRunningWitness = s.phase == "running" and not(Bound)
  run reviewedExecutionTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(serverAdmit).then(receipt).then(propose).then(decide(true)).then(execute).then(finish)
    .expect(s.effects == 1 and s.outcome == "succeeded" and safety)
  /// A request the agent never saw is not sent again until the owner confirms the repeat.
  run unknownSubmissionTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(unknownSubmission).then(restart).then(reconcile)
    .expect(s.phase == "unadmitted" and s.subExecutions == 0 and s.intentSaved)
    .then(resend).expect(s.phase == "unadmitted" and s.ownerReview)
    .then(resend).then(serverAdmit).then(receipt)
    .expect(s.phase == "running" and s.subExecutions == 1 and safety)
  run lostReplyReconcilesTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(serverAdmit).then(unknownSubmission).then(reconcile)
    .expect(s.phase == "running" and s.subExecutions == 1 and not(s.intentSaved) and safety)
  run changedVersionAbandonsTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(unknownSubmission).then(remoteEdit).then(reconcile)
    .expect(s.phase == "installed" and s.abandoned and s.subExecutions == 0 and not(s.intentSaved) and safety)
    .then(serverAdmit.fail())
  run versionRaceRefusedTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(remoteEdit).then(admissionRejected)
    .expect(s.phase == "installed" and s.subExecutions == 0 and safety)
    .then(retainSubmission(true).fail())
  /// A legacy agent runs the changed version. The run is reported, not accepted, and only the
  /// owner can clear the request.
  run legacyVersionRaceReportedTest = initLegacy(false).then(validate).then(save).then(retainSubmission(true))
    .then(remoteEdit).then(serverAdmit).expect(s.ranVersion != s.submittedVersion)
    .then(versionMismatch).expect(s.phase == "uncertain" and s.intentSaved and safety)
    .then(clearRequest).then(clearRequest)
    .expect(s.phase == "installed" and not(s.intentSaved) and s.subExecutions == 1 and safety)
  run legacyCannotReconcileTest = initLegacy(false).then(validate).then(save).then(retainSubmission(true))
    .then(unknownSubmission).expect(safety)
    .then(reconcile.fail())
  run changedRequestNeedsNewDecisionTest = initFor(false).then(validate).then(save)
    .then(retainSubmission(true)).then(serverAdmit).then(receipt).then(propose).then(decide(true))
    .then(requestChanged).expect(s.effects == 0 and safety)
    .then(decide(true)).then(execute).expect(s.effects == 1 and s.effectDigest == 2 and safety)
  run ownerSwitchDoesNotCancelTest = initFor(false).then(validate).then(save)
    .then(retainSubmission(true)).then(serverAdmit).then(receipt).then(propose).then(switchOwner)
    .expect(not(s.cancelRequested) and safety)
    .then(finish).expect(s.outcome == "succeeded" and s.effects == 0 and safety)
  run denialAndCancelTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(serverAdmit).then(receipt).then(propose).then(decide(false)).then(cancel).then(finish)
    .expect(s.effects == 0 and s.outcome == "cancelled" and safety)
  run cancelNeedsReceiptTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(unknownSubmission).expect(safety)
    .then(cancel.fail())
  /// The queued occurrence of a disabled workflow stays visible until a check removes it, and
  /// is never dispatched.
  run triggerDisableTest = initFor(true).then(validate).then(save).then(enable).then(trigger)
    .then(disable).expect(s.queued and safety)
    .then(scanTick).expect(not(s.queued) and safety)
    .then(retainSubmission(false).fail())
}
