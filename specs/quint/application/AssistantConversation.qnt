/// AlphaClient run/send/approve plus revisioned local composer storage.
module AssistantConversation {
  type State = { connected: bool, sensitive: bool, epoch: int, revision: int,
    busy: str, capturedEpoch: int, capturedRevision: int, proposal: bool, expired: bool,
    consumed: bool, session: int, consumedFor: int, dispatches: int, requests: int, executed: int,
    draft: str, savedDraft: str, draftRevision: int, expectedDraftRevision: int, outcome: str }
  var s: State
  action init = s' = { connected: false, sensitive: false, epoch: 0, revision: 0,
    busy: "none", capturedEpoch: 0, capturedRevision: 0, proposal: false, expired: false,
    consumed: false, session: 0, consumedFor: -1, dispatches: 0, requests: 0, executed: 0,
    draft: "", savedDraft: "", draftRevision: 0, expectedDraftRevision: 0, outcome: "none" }
  // Attaching drops every proposal. Approvals already dispatched to the same session stay consumed
  // across a reattach; another session starts with an empty consumed set. `dispatches` counts the
  // approvals dispatched within one consumed scope.
  action attach(session: int): bool = all { s.epoch < 3,
    s' = { ...s, connected: true, epoch: s.epoch + 1, session: session, consumedFor: session,
      busy: "none", proposal: false, expired: false,
      consumed: s.consumed and session == s.consumedFor,
      dispatches: if (session == s.consumedFor) s.dispatches else 0 } }
  // Starting a request leaves a reviewed proposal in place; only a valid reply replaces it.
  action send = all { s.connected, not(s.sensitive), s.busy == "none",
    s' = { ...s, busy: "send", capturedEpoch: s.epoch, capturedRevision: s.revision } }
  // A reply naming an already consumed proposal is rejected as invalid and changes nothing.
  action replyWith(withProposal: bool): bool = all { s.busy == "send", s.connected, not(s.sensitive),
    s.capturedEpoch == s.epoch, s.capturedRevision == s.revision,
    s' = if (withProposal and s.consumed) { ...s, busy: "none", outcome: "invalid" }
      else { ...s, busy: "none", proposal: withProposal, expired: false, outcome: "reply" } }
  // Transport failure, an invalid reply or the caller's own abort signal: proposals are untouched.
  action sendFailed = all { s.busy == "send", s' = { ...s, busy: "none", outcome: "failed" } }
  // The agent journals a proposal identity: a repeated execute request has no second effect.
  action approve = all { s.proposal, not(s.expired), not(s.consumed), s.connected, not(s.sensitive), s.busy == "none",
    s.requests < 3,
    s' = { ...s, consumed: true, proposal: false, busy: "execute", dispatches: s.dispatches + 1,
      requests: s.requests + 1, executed: if (s.executed == 0) 1 else s.executed, outcome: "unknown" } }
  action expire = all { s.proposal, not(s.expired), s' = { ...s, expired: true } }
  action startWorkflow = all { s.connected, not(s.sensitive), s.busy == "none",
    s' = { ...s, busy: "workflow", capturedEpoch: s.epoch, capturedRevision: s.revision } }
  action workflowReply = all { s.busy == "workflow", s.connected, not(s.sensitive), s.capturedEpoch == s.epoch,
    s' = { ...s, busy: "none", outcome: "workflow-text" } }
  action workflowFailed = all { s.busy == "workflow", s' = { ...s, busy: "none", outcome: "failed" } }
  action receipt = all { s.busy == "execute", s' = { ...s, busy: "none", outcome: "succeeded" } }
  action executeFailed = all { s.busy == "execute", s' = { ...s, busy: "none", outcome: "unknown" } }
  action cancel = if (s.busy == "workflow") s' = s else s' = { ...s, busy: "none", proposal: false }
  // An unchanged context envelope is ignored; a changed one bumps the revision.
  action changeView(sensitive: bool): bool = all { s.revision < 2,
    s' = { ...s, revision: s.revision + 1, sensitive: sensitive, busy: if (s.busy == "workflow" and not(sensitive)) "workflow" else "none", proposal: false } }
  action unchangedView = s' = s
  // A conversation history reload keeps the consumed ids for its reattach; any other disconnect forgets them.
  action detach(keepConsumed: bool): bool = all { s.epoch < 3,
    s' = { ...s, epoch: s.epoch + 1, connected: false, busy: "none", proposal: false,
      consumed: s.consumed and keepConsumed, consumedFor: if (keepConsumed) s.consumedFor else -1 } }
  // A first attach of the representative session, a reply carrying one proposal, and a disconnect
  // that forgets the consumed ids.
  action connect = attach(0)
  action reply = replyWith(true)
  action disconnect = detach(false)
  action edit = s' = { ...s, draft: "edit", expectedDraftRevision: s.draftRevision }
  action save = all { s.expectedDraftRevision == s.draftRevision, s.draftRevision < 2,
    s' = { ...s, savedDraft: s.draft, draftRevision: s.draftRevision + 1, expectedDraftRevision: s.draftRevision + 1 } }
  action concurrentSave = all { s.draftRevision < 2,
    s' = { ...s, savedDraft: "other", draftRevision: s.draftRevision + 1 } }
  action rejectedSave = s' = s
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet session = Set(0, 1).oneOf()
    any { attach(session), send, replyWith(flag), sendFailed, approve, expire, startWorkflow, workflowReply, workflowFailed,
      receipt, executeFailed, cancel, changeView(flag), unchangedView, detach(flag), edit, save, concurrentSave, rejectedSave }
  }
  val OneDispatchPerSession = s.dispatches <= 1 and (s.consumed implies s.consumedFor == s.session)
  val OneExecution = s.executed <= 1 and s.executed <= s.requests
  val SensitiveIsolation = s.sensitive implies (s.busy == "none" and not(s.proposal))
  val ProposalAdmission = s.proposal implies (s.connected and not(s.consumed))
  val InFlightSession = s.busy == "send" implies (s.connected and s.capturedEpoch == s.epoch and s.capturedRevision == s.revision)
  val safety = OneDispatchPerSession and OneExecution and SensitiveIsolation and ProposalAdmission and InFlightSession

  val ProposalSurvivesSendWitness = s.proposal and s.busy == "send"
  val ConsumedAcrossReloadWitness = s.consumed and s.epoch >= 3 and s.connected
  val ExpiredProposalWitness = s.proposal and s.expired and s.busy == "none"

  run reviewedSendTest = init.then(connect).then(send).then(reply).then(approve).then(receipt)
    .expect(s.dispatches == 1 and s.executed == 1 and s.consumed and safety)
  run unknownNoReplayTest = init.then(connect).then(send).then(reply).then(approve).then(cancel)
    .then(send).then(reply).expect(not(s.proposal) and s.outcome == "invalid" and s.dispatches == 1 and safety)
  run failedSendKeepsProposalTest = init.then(connect).then(send).then(reply).then(send)
    .expect(s.proposal and s.busy == "send").then(sendFailed).expect(s.proposal and safety)
    .then(approve).expect(s.dispatches == 1 and s.executed == 1 and safety)
  // A history reload reattaches the same session: the approved proposal cannot be approved again.
  run reloadKeepsConsumedTest = init.then(connect).then(send).then(reply).then(approve).then(executeFailed)
    .then(detach(true)).then(connect).expect(s.consumed and safety).then(send).then(reply)
    .expect(not(s.proposal) and s.outcome == "invalid" and s.requests == 1 and s.dispatches == 1 and safety)
  // Another session forgets the consumed ids; a second request then relies on the agent's journal.
  run otherSessionRunsOnceTest = init.then(connect).then(send).then(reply).then(approve).then(executeFailed)
    .then(disconnect).then(attach(1)).then(send).then(reply).then(approve)
    .expect(s.requests == 2 and s.dispatches == 1 and s.executed == 1 and safety)
  run expiredProposalTest = init.then(connect).then(send).then(reply).then(expire)
    .expect(s.proposal and s.expired and safety).then(send).then(reply).then(approve)
    .expect(s.dispatches == 1 and safety)
  run lateReplyTest = init.then(connect).then(send).then(changeView(true))
    .expect(s.busy == "none" and safety)
  run workflowNavigationTest = init.then(connect).then(startWorkflow).then(changeView(false)).then(cancel)
    .expect(s.busy == "workflow").then(workflowReply).expect(safety and s.outcome == "workflow-text")
  run sensitiveStopsWorkflowTest = init.then(connect).then(startWorkflow).then(changeView(true))
    .expect(safety and s.busy == "none")
  run draftConflictTest = init.then(edit).then(concurrentSave).then(rejectedSave)
    .expect(s.draft == "edit" and s.savedDraft == "other" and safety)
}
