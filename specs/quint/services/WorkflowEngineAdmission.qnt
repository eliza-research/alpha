/// One durable run identity through real server admission, process execution and canonical approval.
/// Process/receipt results and schedule classification are external inputs, with their own obligations.
module WorkflowEngineAdmission {
  type Engine = {
    version: int, active: bool, removed: bool, otherActive: bool,
    runs: int, receipt: bool, owner: int, payload: int, runVersion: int,
    mode: str, status: str, finished: bool, workerActive: bool, workerStarts: int,
    cancelRequested: bool, reconciliation: str,
    approval: str, supported: bool, digest: int, decisionOwner: int,
    recordedApproval: str, workerApproval: str, controls: int
  }
  var s: Engine
  action initFor(active: bool, removed: bool, otherActive: bool): bool = s' = {
    version: 1, active: active, removed: removed, otherActive: otherActive,
    runs: 0, receipt: false, owner: 0, payload: 0, runVersion: 0,
    mode: "none", status: "none", finished: false, workerActive: false, workerStarts: 0,
    cancelRequested: false, reconciliation: "none", approval: "none", supported: false,
    digest: 0, decisionOwner: 0, recordedApproval: "none", workerApproval: "none", controls: 0
  }
  action init = {
    nondet active = Set(false, true).oneOf()
    nondet removed = Set(false, true).oneOf()
    nondet otherActive = Set(false, true).oneOf()
    initFor(active, removed, otherActive)
  }
  action definition(version: int, active: bool, removed: bool): bool = all {
    version.in(1.to(2)),
    s' = {...s, version: version, active: active, removed: removed}
  }
  action admitManual(owner: int, payload: int, version: int): bool = all {
    s.runs == 0, not(s.removed), version == s.version,
    owner.in(1.to(2)), payload.in(1.to(2)),
    s' = {...s, runs: 1, receipt: true, owner: owner, payload: payload,
      runVersion: version, mode: "manual", status: "queued"}
  }
  action replayManual(owner: int, payload: int, version: int): bool = all {
    s.receipt, not(s.removed), owner == s.owner, payload == s.payload, version == s.runVersion,
    s' = s
  }
  action admitScheduled(disposition: str): bool = all {
    s.runs == 0, s.active, not(s.removed),
    disposition.in(Set("ready", "missed", "overlap")),
    disposition == "overlap" implies s.otherActive,
    disposition == "ready" implies not(s.otherActive),
    s' = {...s, runs: 1, runVersion: s.version, mode: "trigger",
      status: if (disposition == "ready") "queued" else "finished",
      finished: disposition != "ready"}
  }
  action replayScheduled = all { s.runs == 1, s.mode == "trigger", s' = s }
  action enterWorker = all {
    s.runs == 1, not(s.finished), not(s.workerActive), not(s.cancelRequested), s.workerStarts < 2,
    s' = {...s, status: "running", workerActive: true, workerStarts: s.workerStarts + 1, workerApproval: s.recordedApproval}
  }
  action workerResult(status: str): bool = all {
    s.workerActive,
    status.in(Set("finished", "failed", "cancelled", "waiting-approval", "waiting-event", "waiting-timer")),
    s' = {...s, status: status, finished: status.in(Set("finished", "failed", "cancelled")),
      workerActive: false, reconciliation: "none", recordedApproval: s.workerApproval}
  }
  action resumeUnavailable = all {
    s.runs == 1, not(s.finished), not(s.workerActive),
    s' = {...s, status: "failed", finished: true}
  }
  action replaceRequest(digest: int): bool = all {
    s.approval == "pending", digest.in(1.to(2)), s' = {...s, digest: digest}
  }
  action workerUnknown = all {
    s.workerActive,
    s' = {...s, status: "running", finished: false, workerActive: false, reconciliation: "outcome-unknown", recordedApproval: s.workerApproval}
  }
  action requestCancel = all {
    s.runs == 1, not(s.finished), s' = {...s, cancelRequested: true}
  }
  action cancelReceipt(nativeStatus: str): bool = all {
    s.runs == 1, s.cancelRequested, not(s.workerActive), s.controls < 3,
    nativeStatus.in(Set("none", "cancelled", "finished")),
    s' = if (s.finished and s.status != "cancelled") {...s, controls: s.controls + 1} else {...s,
      status: if (nativeStatus == "finished") "failed" else "cancelled", finished: true,
      controls: s.controls + 1}
  }
  action requestApproval(supported: bool, digest: int): bool = all {
    s.workerActive, s.approval == "none", digest.in(1.to(2)),
    s' = {...s, approval: "pending", supported: supported, digest: digest, recordedApproval: "pending", workerApproval: "pending"}
  }
  action canonicalDecision(approve: bool, owner: int): bool = all {
    s.approval == "pending", owner.in(1.to(2)),
    s' = {...s, approval: if (approve) "approved" else "denied", decisionOwner: owner}
  }
  action decide(approve: bool, owner: int, version: int, digest: int): bool = all {
    s.approval == "pending", not(s.finished), not(s.cancelRequested),
    version == s.runVersion, digest == s.digest, owner.in(1.to(2)),
    not(approve) or s.supported, s.controls < 3,
    s' = {...s, approval: if (approve) "approved" else "denied",
      decisionOwner: owner, recordedApproval: if (approve) "approved" else "denied", controls: s.controls + 1}
  }
  /// A process command can commit canonically while its host transaction fails or loses readback.
  action decisionUnconfirmed(approve: bool, owner: int, committed: bool): bool = all {
    s.approval == "pending", not(s.finished), not(s.cancelRequested),
    not(approve) or s.supported, owner.in(1.to(2)), s.controls < 3,
    s' = {...s, approval: if (committed) (if (approve) "approved" else "denied") else s.approval,
      decisionOwner: if (committed) owner else s.decisionOwner, controls: s.controls + 1}
  }
  action replayDecision(approve: bool, owner: int, version: int, digest: int): bool = all {
    s.approval == (if (approve) "approved" else "denied"), owner == s.decisionOwner,
    version == s.runVersion, digest == s.digest, s' = s
  }
  action lateTerminalEvent = all { s.finished, s' = s }
  action restart = all { not(s.workerActive), s' = s }
  action step = any {
    definition(1, true, false), definition(2, false, false), definition(2, true, true),
    admitManual(1, 1, 1), admitManual(2, 2, 2), replayManual(1, 1, 1),
    admitScheduled("ready"), admitScheduled("missed"), admitScheduled("overlap"), replayScheduled,
    enterWorker, workerResult("finished"), workerResult("failed"), workerResult("cancelled"),
    workerResult("waiting-approval"), workerUnknown, resumeUnavailable, replaceRequest(2), requestCancel,
    cancelReceipt("none"), cancelReceipt("cancelled"), cancelReceipt("finished"),
    requestApproval(true, 1), requestApproval(false, 2), canonicalDecision(true, 2),
    decide(true, 1, 1, 1), decide(false, 1, 1, 2),
    decisionUnconfirmed(true, 1, true), decisionUnconfirmed(false, 1, false),
    replayDecision(true, 1, 1, 1), lateTerminalEvent, restart, s' = s
  }
  val DurableBeforeProcess = s.workerStarts > 0 implies s.runs == 1
  val ManualReceiptMatchesRun = s.receipt implies s.mode == "manual" and s.owner.in(1.to(2)) and s.runVersion.in(1.to(2))
  val NoProcessForUnadmittedRun = s.runs == 0 implies s.status == "none" and not(s.workerActive)
  val TerminalNotRunning = s.finished implies not(s.workerActive) and s.status.in(Set("finished", "failed", "cancelled"))
  val RecordedDecisionHasCanonicalReceipt = s.recordedApproval.in(Set("approved", "denied")) implies s.recordedApproval == s.approval
  val TypeOK = s.runs.in(0.to(1)) and s.workerStarts.in(0.to(2)) and s.controls.in(0.to(3))
    and s.status.in(Set("none", "queued", "running", "waiting-approval", "waiting-event", "waiting-timer", "finished", "failed", "cancelled"))
    and s.approval.in(Set("none", "pending", "approved", "denied")) and s.recordedApproval.in(Set("none", "pending", "approved", "denied"))
  val safety = DurableBeforeProcess and ManualReceiptMatchesRun and NoProcessForUnadmittedRun
    and TerminalNotRunning and RecordedDecisionHasCanonicalReceipt and TypeOK
  run durableAdmissionTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(enterWorker).then(replayManual(1, 1, 1))
    .then(workerResult("finished")).expect(s.workerStarts == 1 and safety)
  run mismatchedSubmissionTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(replayManual(2, 1, 1)).fail()
  run staleVersionRejectedTest = initFor(true, false, false).then(definition(2, true, false)).then(admitManual(1, 1, 1)).fail()
  run oldReceiptSurvivesVersionTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(definition(2, true, false))
    .then(replayManual(1, 1, 1)).expect(s.runVersion == 1 and safety)
  run pausedTriggerRejectedTest = initFor(false, false, false).then(admitScheduled("ready")).fail()
  run missedOccurrenceNoWorkerTest = initFor(true, false, false).then(admitScheduled("missed")).then(enterWorker).fail()
  run overlapNoWorkerTest = initFor(true, false, true).then(admitScheduled("overlap")).expect(s.workerStarts == 0 and safety)
  run cancellationTerminalWinnerTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(enterWorker).then(requestCancel)
    .then(workerResult("finished")).then(cancelReceipt("cancelled")).expect(s.status == "finished" and safety)
  run cancellationBeforeProcessTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(requestCancel)
    .then(cancelReceipt("none")).then(enterWorker).fail()
  run unknownOutcomeRestartTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(enterWorker).then(workerUnknown)
    .then(restart).then(enterWorker).then(workerResult("finished")).expect(s.workerStarts == 2 and safety)
  run unsupportedApprovalRejectedTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(enterWorker).then(requestApproval(false, 1))
    .then(decide(true, 1, 1, 1)).fail()
  run unsupportedApprovalCanBeDeniedTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(enterWorker).then(requestApproval(false, 1))
    .then(decide(false, 1, 1, 1)).expect(s.approval == "denied" and safety)
  run approvalDigestRejectedTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(enterWorker).then(requestApproval(true, 1))
    .then(decide(true, 1, 1, 2)).fail()
  run committedUnknownApprovalReplayTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(enterWorker).then(requestApproval(true, 1))
    .then(workerResult("waiting-approval")).then(decisionUnconfirmed(true, 1, true))
    .then(replayDecision(true, 1, 1, 1)).expect(s.recordedApproval == "pending" and safety)
  run otherOwnerDecisionRejectedTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(enterWorker).then(requestApproval(true, 1))
    .then(canonicalDecision(true, 2)).then(replayDecision(true, 1, 1, 1)).fail()
  run conflictingNativeTerminalFailsClosedTest = initFor(true, false, false).then(admitManual(1, 1, 1)).then(requestCancel)
    .then(cancelReceipt("finished")).expect(s.status == "failed" and safety)
}
