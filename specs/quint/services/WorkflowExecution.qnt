/// Manual production workflows, optional development triggers, and durable reviewed submissions.
module WorkflowExecution {
  type Workflow = {
    mocks: bool, owner: int, epoch: int, version: int, reviewedVersion: int,
    phase: str, enabled: bool, queued: bool, sourceCurrent: bool,
    intentSaved: bool, submission: int, admittedSubmission: int, executions: int,
    runOwner: int, runEpoch: int, approval: str, requestDigest: int,
    reviewedDigest: int, effects: int, cancelRequested: bool, outcome: str
  }
  var s: Workflow
  action initFor(mocks: bool): bool = s' = {
    mocks: mocks, owner: 1, epoch: 0, version: 0, reviewedVersion: 0,
    phase: "draft", enabled: false, queued: false, sourceCurrent: true,
    intentSaved: false, submission: 1, admittedSubmission: 0, executions: 0,
    runOwner: 0, runEpoch: 0, approval: "none", requestDigest: 0,
    reviewedDigest: 0, effects: 0, cancelRequested: false, outcome: "none" }
  action init = {
    nondet mocks = Set(false, true).oneOf()
    initFor(mocks)
  }
  action validate = all { s.phase == "draft", s' = { ...s, phase: "review", reviewedVersion: s.version } }
  action edit = all {
    s.phase.in(Set("draft", "review", "installed")), s.version < 2,
    s' = { ...s, version: s.version + 1, phase: "draft", enabled: false, queued: false }
  }
  action save = all {
    s.phase == "review", s.reviewedVersion == s.version,
    s' = { ...s, phase: "installed" }
  }
  action enable = all { s.phase == "installed", s' = { ...s, enabled: true } }
  action disable = s' = { ...s, enabled: false, queued: false }
  action trigger = all {
    s.mocks, s.phase == "installed", s.enabled, not(s.queued),
    s' = { ...s, queued: true }
  }
  action sourceChanged = s' = { ...s, sourceCurrent: false }
  action retainSubmission(manual: bool): bool = all {
    s.phase == "installed", s.reviewedVersion == s.version,
    manual or (s.mocks and s.queued and s.sourceCurrent),
    s' = { ...s, phase: "submitting", intentSaved: true, runOwner: s.owner,
      runEpoch: s.epoch, queued: false }
  }
  action admit = all {
    s.phase == "submitting", s.intentSaved, s.runOwner == s.owner, s.runEpoch == s.epoch,
    s.reviewedVersion == s.version,
    s' = { ...s, phase: "running", admittedSubmission: s.submission,
      executions: if (s.admittedSubmission == s.submission) s.executions else s.executions + 1 }
  }
  action unknownSubmission = all { s.phase == "submitting", s' = { ...s, phase: "uncertain" } }
  /// Resubmission uses the same durable identity. Server admission is idempotent.
  action reconcile(found: bool): bool = all {
    s.phase == "uncertain", s.runOwner == s.owner, s.runEpoch == s.epoch,
    s' = { ...s, phase: if (found) "running" else "submitting",
      executions: if (found and s.admittedSubmission != s.submission) s.executions + 1 else s.executions,
      admittedSubmission: if (found) s.submission else s.admittedSubmission }
  }
  action propose = all {
    s.phase == "running", s.approval == "none", s.effects == 0, not(s.cancelRequested),
    s' = { ...s, approval: "pending", requestDigest: 1 }
  }
  action decide(approve: bool): bool = all {
    s.approval == "pending", s.runOwner == s.owner, s.runEpoch == s.epoch,
    not(s.cancelRequested),
    s' = { ...s, approval: if (approve) "approved" else "denied",
      reviewedDigest: s.requestDigest }
  }
  action execute = all {
    s.phase == "running", s.approval == "approved", s.reviewedDigest == s.requestDigest,
    s.runOwner == s.owner, s.runEpoch == s.epoch, not(s.cancelRequested), s.effects == 0,
    s' = { ...s, effects: 1 }
  }
  action cancel = all {
    s.phase.in(Set("running", "submitting", "uncertain")),
    s' = { ...s, cancelRequested: true }
  }
  action finish = all {
    s.phase == "running",
    s' = { ...s, phase: "finished", outcome: if (s.cancelRequested) "cancelled" else "succeeded" }
  }
  action restart = s' = { ...s, phase: if (s.phase == "submitting") "uncertain" else s.phase }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1,
      queued: false, cancelRequested: s.phase.in(Set("running", "submitting", "uncertain")) }
  }
  action step = any {
    validate, edit, save, enable, disable, trigger, sourceChanged, retainSubmission(true),
    retainSubmission(false), admit, unknownSubmission, reconcile(true), reconcile(false),
    propose, decide(true), decide(false), execute, cancel, finish, restart, switchOwner, s' = s
  }
  val AtMostOneExecution = s.executions <= 1
  val DurableSubmission = s.phase.in(Set("submitting", "uncertain", "running", "finished")) implies s.intentSaved
  val ReviewedEffect = s.effects > 0 implies s.approval == "approved" and s.reviewedDigest == s.requestDigest
  val DisabledTriggersEmpty = not(s.enabled) implies not(s.queued)
  val ProductionTriggerGate = not(s.mocks) implies not(s.queued)
  val TypeOK = s.phase.in(Set("draft", "review", "installed", "submitting", "uncertain", "running", "finished")) and s.approval.in(Set("none", "pending", "approved", "denied")) and s.version.in(0.to(2)) and s.epoch.in(0.to(2)) and s.effects.in(0.to(1)) and s.executions.in(0.to(1))
  val safety = TypeOK and AtMostOneExecution and DurableSubmission and ReviewedEffect and DisabledTriggersEmpty and ProductionTriggerGate
  run reviewedExecutionTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(propose).then(decide(true)).then(execute).then(finish)
    .expect(s.effects == 1 and s.outcome == "succeeded" and safety)
  run unknownSubmissionTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(unknownSubmission).then(restart).then(reconcile(false)).then(admit)
    .expect(s.executions == 1 and safety)
  run denialAndCancelTest = initFor(false).then(validate).then(save).then(retainSubmission(true))
    .then(admit).then(propose).then(decide(false)).then(cancel).then(finish)
    .expect(s.effects == 0 and s.outcome == "cancelled" and safety)
  run triggerDisableTest = initFor(true).then(validate).then(save).then(enable).then(trigger)
    .then(disable).expect(not(s.queued) and safety)
}
