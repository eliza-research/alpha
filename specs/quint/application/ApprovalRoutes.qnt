/// The two routes by which a reviewed action card is approved: the AlphaClient proposal of the
/// current attachment, and the recovered card that refetches pending actions at the tap. The
/// client's consumed set survives a history reload of the same session but the recovered route
/// does not consult it, so one execution across both routes relies on the agent journaling each
/// proposal identity; that assumption is the `agentHandlesExecute` action.
module ApprovalRoutes {
  type State = { server: str, executions: int, requests: int, inFlight: int, clientProposal: bool,
    consumed: bool, attachmentDispatches: int, reattachments: int, card: str, tap: str, taps: int,
    completedShown: bool }
  var s: State
  action init = s' = { server: "pending", executions: 0, requests: 0, inFlight: 0, clientProposal: true,
    consumed: false, attachmentDispatches: 0, reattachments: 0, card: "live", tap: "none", taps: 0,
    completedShown: false }
  // One approval at a time. A live card uses the client's proposal; a client that no longer holds
  // it sends nothing. A recovered card first refetches what is pending for this screen.
  action tapApprove = all { s.card.in(Set("live", "recovered")), s.tap == "none", s.taps < 3,
    s' = if (s.card == "recovered") { ...s, tap: "fetching", taps: s.taps + 1 }
      else if (s.clientProposal and not(s.consumed))
        { ...s, tap: "executing", taps: s.taps + 1, consumed: true, clientProposal: false,
          attachmentDispatches: s.attachmentDispatches + 1, requests: s.requests + 1, inFlight: s.inFlight + 1 }
      else { ...s, taps: s.taps + 1 } }
  action fetchSettles = all { s.tap == "fetching",
    s' = if (s.server == "pending") { ...s, tap: "executing", requests: s.requests + 1, inFlight: s.inFlight + 1 }
      else { ...s, tap: "none" } }
  // Navigation or a context change aborts the approval; a request already sent is only awaited.
  action abortTap = all { s.tap == "fetching", s' = { ...s, tap: "none" } }
  // The agent executes a proposal identity once; a repeated request returns the journaled receipt.
  action agentHandlesExecute = all { s.inFlight > 0,
    s' = { ...s, inFlight: s.inFlight - 1, server: "done",
      executions: if (s.server == "pending") s.executions + 1 else s.executions } }
  action receiptArrives = all { s.tap == "executing", s.server == "done",
    s' = { ...s, tap: "none", card: "done", completedShown: true } }
  // The response is lost while the request may still reach the agent: the card stays undecided.
  action executeTransportFails = all { s.tap == "executing", s' = { ...s, tap: "none" } }
  // A history restore or a session change replaces the transcript, so its cards are gone, and
  // reattaches the client without proposals. The consumed ids survive only for the same session.
  action reattach(sameSession: bool): bool = all { s.reattachments < 2, s.tap != "fetching",
    s' = { ...s, clientProposal: false, card: "none", reattachments: s.reattachments + 1,
      consumed: s.consumed and sameSession,
      attachmentDispatches: if (sameSession) s.attachmentDispatches else 0 } }
  // A changed screen context drops the client's proposals; the card stays in the transcript.
  action contextChanged = all { s.tap == "none", s' = { ...s, clientProposal: false } }
  // Pending-action recovery: a still pending proposal becomes a recovered card; absence only
  // disables review, since it proves neither rejection nor execution.
  action recover = all { s.tap == "none", s.card != "done",
    s' = { ...s, card: if (s.server == "pending") "recovered" else if (s.card == "none") "none" else "unavailable" } }
  action step = {
    nondet same = Set(false, true).oneOf()
    any { tapApprove, fetchSettles, abortTap, agentHandlesExecute, receiptArrives,
      executeTransportFails, reattach(same), contextChanged, recover, s' = s }
  }

  val OneExecution = s.executions <= 1 and (s.server == "done") == (s.executions == 1)
  val OneClientDispatchPerSession = s.attachmentDispatches <= 1
  val ConsumedBlocksClientProposal = s.clientProposal implies not(s.consumed)
  val RecoveredRouteRefetches = s.tap == "fetching" implies s.card == "recovered"
  val RequestsNeedTaps = s.requests <= s.taps and s.inFlight <= s.requests
  val CompletedMeansExecuted = s.completedShown implies s.executions == 1
  val DoneCardIsInert = s.card == "done" implies s.tap == "none"
  val safety = OneExecution and OneClientDispatchPerSession and ConsumedBlocksClientProposal and
    RecoveredRouteRefetches and RequestsNeedTaps and CompletedMeansExecuted and DoneCardIsInert

  val RepeatedRequestWitness = s.requests == 2 and s.executions == 1
  val RecoveredFetchWitness = s.tap == "fetching"
  val UnavailableAfterExecutionWitness = s.card == "unavailable" and s.executions == 1
  val ConsumedAfterReloadWitness = s.consumed and s.reattachments > 0 and s.card == "recovered"
  val LostResponseWitness = s.inFlight == 1 and s.tap == "none" and s.card == "live"

  run clientRouteRunsOnceTest = init.then(tapApprove).expect(s.consumed and s.tap == "executing")
    .then(agentHandlesExecute).then(receiptArrives)
    .expect(s.executions == 1 and s.card == "done" and s.requests == 1 and safety)
  run recoveredRouteRefetchesTest = init.then(reattach(true)).then(recover).then(tapApprove)
    .expect(s.tap == "fetching" and s.requests == 0).then(fetchSettles).then(agentHandlesExecute).then(receiptArrives)
    .expect(s.executions == 1 and s.attachmentDispatches == 0 and s.card == "done" and safety)
  // The client request's response is lost and a history restore brings the proposal back as a
  // recovered card while the first request is still on its way. The client still holds the id as
  // consumed, but the recovered route refetches instead: both requests reach the agent and the
  // action runs once.
  run crossRouteRunsOnceTest = init.then(tapApprove).then(executeTransportFails).then(reattach(true)).then(recover)
    .expect(s.card == "recovered" and s.consumed).then(tapApprove).then(fetchSettles)
    .expect(s.requests == 2 and s.inFlight == 2).then(agentHandlesExecute).then(agentHandlesExecute)
    .expect(s.executions == 1 and safety).then(receiptArrives).expect(s.card == "done" and safety)
  run executedActionIsNotOfferedAgainTest = init.then(tapApprove).then(agentHandlesExecute).then(executeTransportFails)
    .then(recover).expect(s.card == "unavailable" and s.executions == 1 and safety)
    .then(reattach(false)).then(recover).expect(s.card == "none" and not(s.consumed) and s.executions == 1 and safety)
  run abortedFetchSendsNothingTest = init.then(recover).then(tapApprove).then(abortTap)
    .expect(s.requests == 0 and s.tap == "none" and s.card == "recovered" and safety)
  run staleLiveCardSendsNothingTest = init.then(contextChanged).then(tapApprove)
    .expect(s.requests == 0 and s.tap == "none" and s.executions == 0 and safety)
}
