/// The native event bridge for one streamed agent reply (`streamNativeAgent`): listener, request,
/// response, chunks and completion, bounded by the caller's signal, a per-turn time limit and an
/// idle limit that every frame of the stream restarts. A send
/// is reported as not dispatched only when it was refused before any response.
module NativeStreamBridge {
  type State = { active: bool, listener: str, started: bool, responded: bool, terminal: bool, outcome: str,
    failure: str, chunks: int, cancelRequested: bool, readyRevoked: bool, settled: bool }
  var s: State
  // fail(): the first terminal outcome wins.
  pure def failed(st: State, failure: str, revokeReady: bool): State =
    if (st.terminal) st
    else { ...st, terminal: true, outcome: "failed", failure: failure, readyRevoked: revokeReady }

  action init = s' = { active: true, listener: "pending", started: false, responded: false, terminal: false,
    outcome: "none", failure: "none", chunks: 0, cancelRequested: false, readyRevoked: false, settled: false }
  // A listener that attaches after the call ended is removed at once.
  action listenerAttached = all { s.listener == "pending",
    s' = { ...s, listener: if (s.active) "attached" else "removed" } }
  action requestStream = all { s.active, s.listener == "attached", not(s.started), not(s.terminal),
    s' = { ...s, started: true } }
  // Native rejects the request only before it sent anything to the runtime.
  action requestRejected = all { s.started, not(s.responded), s' = failed(s, "before-dispatch", false) }
  action responseEvent(status: int): bool = all { s.active, s.started, not(s.terminal),
    s' = if (not(s.responded) and status == 200) { ...s, responded: true }
      else if (not(s.responded) and status == 429) failed(s, "before-dispatch", true)
      else failed(s, "unknown", true) }
  action chunkEvent(valid: bool): bool = all { s.active, s.started, not(s.terminal), s.chunks < 3,
    s' = if (s.responded and valid) { ...s, chunks: s.chunks + 1 } else failed(s, "unknown", true) }
  // An error reported after the response began is an interrupted reply with an unknown outcome.
  action completeEvent(error: bool): bool = all { s.active, s.started, not(s.terminal),
    s' = if (error or not(s.responded)) failed(s, "unknown", not(error and s.responded))
      else { ...s, terminal: true, outcome: "completed" } }
  // The caller's signal, the turn limit, or a minute without any frame.
  action abort = all { s.active, not(s.terminal),
    s' = { ...failed(s, "unknown", false), cancelRequested: s.cancelRequested or s.started } }
  // The call returns or throws: the listener is removed and a started stream is cancelled.
  action finish = all { s.active, s.terminal,
    s' = { ...s, active: false, settled: true, cancelRequested: s.cancelRequested or s.started,
      listener: if (s.listener == "attached") "removed" else s.listener } }
  action step = {
    nondet status = Set(200, 401, 429, 500).oneOf()
    nondet flag = Set(false, true).oneOf()
    any { listenerAttached, requestStream, requestRejected, responseEvent(status), chunkEvent(flag),
      completeEvent(flag), abort, finish, s' = s }
  }

  val OneTerminalOutcome = s.terminal == (s.outcome != "none") and (s.settled implies s.terminal)
  val CompletedNeedsResponse = s.outcome == "completed" implies (s.responded and s.failure == "none")
  val NotDispatchedIsProvable = s.failure == "before-dispatch" implies not(s.responded)
  val ChunksNeedResponse = s.chunks > 0 implies s.responded
  val ReadyRevokedOnlyOnFailure = s.readyRevoked implies s.outcome == "failed"
  val SettledCleansUp = s.settled implies (not(s.active) and s.listener != "attached" and
    (s.started implies s.cancelRequested))
  val safety = OneTerminalOutcome and CompletedNeedsResponse and NotDispatchedIsProvable and ChunksNeedResponse and
    ReadyRevokedOnlyOnFailure and SettledCleansUp

  val RefusedBeforeDispatchWitness = s.failure == "before-dispatch" and s.readyRevoked
  val InterruptedReplyWitness = s.outcome == "failed" and s.responded and not(s.readyRevoked)
  val CompletedWitness = s.settled and s.outcome == "completed"
  val LateListenerWitness = s.settled and s.listener == "removed" and not(s.started)

  run completedReplyTest = init.then(listenerAttached).then(requestStream).then(responseEvent(200)).then(chunkEvent(true))
    .then(completeEvent(false)).then(finish)
    .expect(s.outcome == "completed" and s.listener == "removed" and s.cancelRequested and safety)
  run busyRefusalIsNotDispatchedTest = init.then(listenerAttached).then(requestStream).then(responseEvent(429))
    .expect(s.failure == "before-dispatch" and s.readyRevoked and safety)
  // A second response after the first one is an error with an unknown outcome, never "not sent".
  run busyAfterResponseIsUnknownTest = init.then(listenerAttached).then(requestStream).then(responseEvent(200))
    .then(responseEvent(429)).expect(s.failure == "unknown" and s.outcome == "failed" and safety)
  run interruptedAfterResponseTest = init.then(listenerAttached).then(requestStream).then(responseEvent(200))
    .then(completeEvent(true)).expect(s.failure == "unknown" and not(s.readyRevoked) and safety)
    .then(finish).expect(s.outcome == "failed" and s.cancelRequested and safety)
  run abortCancelsStartedStreamTest = init.then(listenerAttached).then(requestStream).then(abort)
    .expect(s.cancelRequested and s.terminal and safety).then(finish).expect(s.listener == "removed" and safety)
  run abortBeforeListenerRemovesLateListenerTest = init.then(abort).then(finish).then(listenerAttached)
    .expect(s.listener == "removed" and not(s.cancelRequested) and not(s.started) and safety)
}
