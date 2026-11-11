/// Version-fenced manual submissions and the separate development trigger queue.
module WorkflowExecution {
  type Workflow = {
    mocks: bool, owner: int, epoch: int, version: int, reviewedVersion: int,
    phase: str, enabled: bool, queued: bool, queuedVersion: int, sourceCurrent: bool,
    intentSaved: bool, submission: int, admittedSubmission: int, executions: int,
    runOwner: int, runEpoch: int, receiptVisible: bool, approval: str, requestDigest: int,
    reviewedDigest: int, effects: int, cancelRequested: bool, outcome: str
  }
  var s: Workflow
  action initFor(mocks: bool): bool = s' = {
    mocks: mocks, owner: 1, epoch: 0, version: 0, reviewedVersion: 0,
    phase: "draft", enabled: false, queued: false, queuedVersion: 0, sourceCurrent: true,
    intentSaved: false, submission: 1, admittedSubmission: 0, executions: 0,
    runOwner: 0, runEpoch: 0, receiptVisible: false, approval: "none", requestDigest: 0,
    reviewedDigest: 0, effects: 0, cancelRequested: false, outcome: "none" }
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
    manual or eligibleDevelopmentTrigger,
    s' = { ...s, phase: "submitting", intentSaved: true, runOwner: s.owner,
      runEpoch: s.epoch, queued: if (manual) s.queued else false }
  }
  // A different writer can change the current version while the reviewed request is in flight.
  action serverVersionChanged = all {
    s.phase.in(Set("submitting", "uncertain", "unadmitted", "resend-review", "running")), s.version < 2,
    s' = s.with("version", s.version + 1)
  }
  action admit = all {
    s.phase == "submitting", s.intentSaved, s.reviewedVersion == s.version,
    s' = { ...s, phase: if (currentRunOwner) receiptPhase else "uncertain",
      receiptVisible: currentRunOwner, admittedSubmission: s.submission,
      executions: if (knownExecution) s.executions else s.executions + 1 }
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
    s' = { ...s, phase: "abandoned", intentSaved: false }
  }
  // A retained identity is scoped to the same owner. A fresh view obtains its own epoch.
  action reopenOwner = all {
    s.intentSaved, s.runOwner == s.owner, s.runEpoch != s.epoch,
    s' = { ...s, runEpoch: s.epoch, phase: "uncertain", receiptVisible: false }
  }
  action reconcile(found: bool): bool = all {
    s.phase == "uncertain", currentRunOwner, found == knownExecution,
    s' = { ...s, phase: if (found) receiptPhase else if (s.reviewedVersion == s.version) "unadmitted" else "abandoned",
      receiptVisible: found, intentSaved: found or s.reviewedVersion == s.version }
  }
  action reviewResend = all {
    s.phase == "unadmitted", currentRunOwner, s.reviewedVersion == s.version,
    s' = s.with("phase", "resend-review")
  }
  // A second tap rechecks the retained identity. A receipt wins over any repeat submission.
  action confirmResend = all {
    s.phase == "resend-review", currentRunOwner, s.intentSaved,
    s' = { ...s, phase: if (knownExecution) receiptPhase else if (s.reviewedVersion == s.version) "submitting" else "abandoned",
      receiptVisible: knownExecution, intentSaved: knownExecution or s.reviewedVersion == s.version }
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
  action restart = s' = { ...s, receiptVisible: false,
    phase: if (s.phase.in(Set("submitting", "unadmitted", "resend-review", "running", "finished"))) "uncertain" else s.phase }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1, receiptVisible: false,
      phase: if (s.phase.in(Set("unadmitted", "resend-review"))) "uncertain" else s.phase }
  }
  action step = any {
    validate, edit, save, enable, disable, pruneDisabledQueue, trigger, sourceChanged, retainSubmission(true),
    retainSubmission(false), serverVersionChanged, admit, unknownSubmission, lateAdmission, refuseVersion,
    reopenOwner, reconcile(true), reconcile(false), reviewResend, confirmResend, abandonChangedReview,
    propose, decide(true), decide(false), execute, cancel, finish, restart, switchOwner, s' = s
  }
  val AtMostOneExecution = s.executions <= 1
  val DurableSubmission = s.phase.in(Set("submitting", "uncertain", "unadmitted", "resend-review", "running", "finished")) implies s.intentSaved
  val ReviewedEffect = s.effects > 0 implies s.approval == "approved" and s.reviewedDigest == s.requestDigest
  val CancellationNeedsExecution = s.cancelRequested implies knownExecution
  val ReceiptBelongsToCurrentOwner = s.receiptVisible implies knownExecution and currentRunOwner
  val AbandonedWasNeverAdmitted = s.phase == "abandoned" implies not(knownExecution or s.intentSaved)
  val FixtureQueueRequiresMocks = s.queued implies s.mocks
  val TypeOK = s.phase.in(Set("draft", "review", "installed", "submitting", "uncertain", "unadmitted", "resend-review", "abandoned", "running", "finished")) and s.approval.in(Set("none", "pending", "approved", "denied")) and s.version.in(0.to(2)) and s.epoch.in(0.to(2)) and s.effects.in(0.to(1)) and s.executions.in(0.to(1))
  val safety = TypeOK and AtMostOneExecution and DurableSubmission and ReviewedEffect and CancellationNeedsExecution and ReceiptBelongsToCurrentOwner and AbandonedWasNeverAdmitted and FixtureQueueRequiresMocks

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
  run ownerSwitchDoesNotCancelRunTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(switchOwner).expect(not(s.receiptVisible or s.cancelRequested) and safety)
    .then(finish).expect(s.outcome == "succeeded" and safety)
    .then(switchOwner).then(reopenOwner).then(reconcile(true))
    .expect(s.phase == "finished" and s.receiptVisible and s.executions == 1 and safety)
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
