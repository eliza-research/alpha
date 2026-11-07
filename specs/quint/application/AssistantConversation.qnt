/// AlphaClient run/send/approve plus revisioned local composer storage.
module AssistantConversation {
  type State = { connected: bool, sensitive: bool, epoch: int, revision: int,
    busy: str, capturedEpoch: int, capturedRevision: int, proposal: bool,
    consumed: bool, dispatches: int, draft: str, savedDraft: str,
    draftRevision: int, expectedDraftRevision: int, outcome: str }
  var s: State
  action init = s' = { connected: false, sensitive: false, epoch: 0, revision: 0,
    busy: "none", capturedEpoch: 0, capturedRevision: 0, proposal: false,
    consumed: false, dispatches: 0, draft: "", savedDraft: "", draftRevision: 0,
    expectedDraftRevision: 0, outcome: "none" }
  action connect = all { s.epoch < 2, s' = { ...s, connected: true, epoch: s.epoch + 1,
    busy: "none", proposal: false, consumed: false, dispatches: 0 } }
  action send = all { s.connected, not(s.sensitive), s.busy == "none",
    s' = { ...s, busy: "send", capturedEpoch: s.epoch, capturedRevision: s.revision, proposal: false } }
  action reply = all { s.busy == "send", s.connected, not(s.sensitive),
    s.capturedEpoch == s.epoch, s.capturedRevision == s.revision,
    s' = { ...s, busy: "none", proposal: not(s.consumed), outcome: "reply" } }
  action approve = all { s.proposal, not(s.consumed), s.connected, not(s.sensitive), s.busy == "none",
    s' = { ...s, consumed: true, proposal: false, busy: "execute", dispatches: s.dispatches + 1, outcome: "unknown" } }
  action startWorkflow = all { s.connected, not(s.sensitive), s.busy == "none",
    s' = { ...s, busy: "workflow", capturedEpoch: s.epoch, capturedRevision: s.revision, proposal: false } }
  action workflowReply = all { s.busy == "workflow", s.connected, not(s.sensitive), s.capturedEpoch == s.epoch,
    s' = { ...s, busy: "none", outcome: "workflow-text" } }
  action receipt = all { s.busy == "execute", s' = { ...s, busy: "none", outcome: "succeeded" } }
  action cancel = if (s.busy == "workflow") s' = s else s' = { ...s, busy: "none", proposal: false }
  action changeView(sensitive: bool): bool = all { s.revision < 2,
    s' = { ...s, revision: s.revision + 1, sensitive: sensitive, busy: if (s.busy == "workflow" and not(sensitive)) "workflow" else "none", proposal: false } }
  action disconnect = all { s.epoch < 2, s' = { ...s, epoch: s.epoch + 1,
    connected: false, busy: "none", proposal: false } }
  action edit = s' = { ...s, draft: "edit", expectedDraftRevision: s.draftRevision }
  action save = all { s.expectedDraftRevision == s.draftRevision, s.draftRevision < 2,
    s' = { ...s, savedDraft: s.draft, draftRevision: s.draftRevision + 1, expectedDraftRevision: s.draftRevision + 1 } }
  action concurrentSave = all { s.draftRevision < 2,
    s' = { ...s, savedDraft: "other", draftRevision: s.draftRevision + 1 } }
  action rejectedSave = s' = s
  action step = any { connect, send, reply, approve, startWorkflow, workflowReply, receipt, cancel, changeView(true), changeView(false),
    disconnect, edit, save, concurrentSave, rejectedSave }
  val OneDispatch = s.dispatches <= 1
  val SensitiveIsolation = s.sensitive implies (s.busy == "none" and not(s.proposal))
  val ProposalAdmission = s.proposal implies (s.connected and not(s.consumed))
  val InFlightSession = s.busy == "send" implies (s.connected and s.capturedEpoch == s.epoch and s.capturedRevision == s.revision)
  val safety = OneDispatch and SensitiveIsolation and ProposalAdmission and InFlightSession
  run reviewedSendTest = init.then(connect).then(send).then(reply).then(approve).then(receipt)
    .expect(s.dispatches == 1 and s.consumed and safety)
  run unknownNoReplayTest = init.then(connect).then(send).then(reply).then(approve).then(cancel)
    .then(send).then(reply).expect(not(s.proposal) and s.dispatches == 1 and safety)
  run lateReplyTest = init.then(connect).then(send).then(changeView(true))
    .expect(s.busy == "none" and safety)
  run workflowNavigationTest = init.then(connect).then(startWorkflow).then(changeView(false)).then(cancel)
    .expect(s.busy == "workflow").then(workflowReply).expect(safety and s.outcome == "workflow-text")
  run sensitiveStopsWorkflowTest = init.then(connect).then(startWorkflow).then(changeView(true))
    .expect(safety and s.busy == "none")
  run draftConflictTest = init.then(edit).then(concurrentSave).then(rejectedSave)
    .expect(s.draft == "edit" and s.savedDraft == "other" and safety)
}
