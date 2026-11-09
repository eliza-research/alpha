module ClientObservationSupport {
  type State = {
    retired: bool, connectionCurrent: bool, learn: str, supported: bool, background: str, turn: str,
    reads: int, compared: bool, offered: bool,
  }
  var s: State

  action init = s' = {retired: false, connectionCurrent: true, learn: "idle", supported: false,
    background: "none", turn: "none", reads: 0, compared: false, offered: false}

  val learnResponses = Set("supported", "unlisted", "legacy", "invalid", "unavailable")
  val comparisonResponses = learnResponses.union(Set("different"))
  val pendingTurn = s.turn == "waiting" or s.turn == "checking"
  val turnObservation = if (pendingTurn) "pending" else s.turn
  val readingHandshake = s.learn == "background" or s.learn == "turn"
  val live = s.connectionCurrent and not(s.retired)
  val readBound = 5

  action beginHandshake = all {
    live, s.learn == "idle", s.reads < readBound,
    s' = {...s, learn: "background", background: "pending", reads: s.reads + 1},
  }

  action beginTurn(offered: bool): bool = all {
    not(pendingTurn),
    (live and offered and (s.learn == "idle" or s.supported)) implies s.reads < readBound,
    val startLearn = live and offered and s.learn == "idle"
    val check = live and offered and s.learn == "done" and s.supported
    val nextTurn = if (not(live)) "aborted"
      else if (not(offered)) "ordinary"
      else if (check) "checking"
      else if (s.learn == "done") "ordinary"
      else "waiting"
    s' = {...s, learn: if (startLearn) "turn" else s.learn,
      turn: nextTurn, offered: offered, compared: false,
      reads: s.reads + (if (startLearn or check) 1 else 0)},
  }

  action finishHandshake(response: str): bool = all {
    readingHandshake, learnResponses.contains(response),
    (live and response == "supported" and s.turn == "waiting") implies s.reads < readBound,
    val accepts = live and response == "supported"
    val check = accepts and s.turn == "waiting"
    val nextTurn = if (s.turn != "waiting") s.turn else if (not(live)) "aborted"
      else if (check) "checking" else "ordinary"
    s' = {...s, learn: "done", supported: accepts, turn: nextTurn,
      background: if (s.learn != "background") s.background
        else if (not(live)) "aborted" else "resolved",
      reads: s.reads + (if (check) 1 else 0)},
  }

  action abortHandshake = all {
    s.learn == "background",
    (live and s.turn == "waiting") implies s.reads < readBound,
    val retry = live and s.turn == "waiting"
    s' = {...s, learn: if (retry) "turn" else "idle", background: "aborted",
      turn: if (not(live) and s.turn == "waiting") "aborted" else s.turn,
      reads: s.reads + (if (retry) 1 else 0)},
  }

  action abortTurn = all {
    pendingTurn,
    s' = {...s, turn: "aborted", learn: if (s.learn == "turn") "idle" else s.learn,
      supported: if (s.turn == "checking") false else s.supported},
  }

  action finishComparison(response: str): bool = all {
    s.turn == "checking", comparisonResponses.contains(response),
    val matches = live and response == "supported"
    s' = {...s, supported: matches, compared: matches,
      turn: if (not(live)) "aborted" else if (matches) "admitted" else "ordinary"},
  }

  action retire = all {not(s.retired), s' = {...s, retired: true, supported: false}}
  action invalidateConnection = all {s.connectionCurrent, s' = {...s, connectionCurrent: false}}

  action step = any {
    beginHandshake, beginTurn(true), beginTurn(false), abortHandshake, abortTurn, retire, invalidateConnection,
    { nondet response = learnResponses.oneOf(); finishHandshake(response) },
    { nondet response = comparisonResponses.oneOf(); finishComparison(response) },
    s' = s,
  }

  val AdmissionRequiresFreshComparison = (s.turn == "admitted") implies (s.offered and s.compared and s.reads >= 2)
  val NoSupportAfterRetirement = s.retired implies not(s.supported)
  val LearnAndCompareAreSeparate = s.turn == "checking" implies (s.learn == "done" and s.reads >= 2)
  val safety = AdmissionRequiresFreshComparison and NoSupportAfterRetirement and LearnAndCompareAreSeparate

  run ExactPeerIsCheckedAgainTest = init.then(beginHandshake).then(beginTurn(true))
    .then(finishHandshake("supported")).then(finishComparison("supported"))
    .expect(s.turn == "admitted" and s.reads == 2 and safety)

  run NewProcessCannotBeLearnedInSameSessionTest = init.then(beginHandshake)
    .then(finishHandshake("supported")).then(beginTurn(true)).then(finishComparison("different"))
    .then(beginTurn(true)).expect(s.turn == "ordinary" and s.reads == 2 and safety)

  run CancelledSharedHandshakeRestartsUnderTurnSignalTest = init.then(beginHandshake)
    .then(beginTurn(true)).then(abortHandshake).then(finishHandshake("supported")).then(finishComparison("supported"))
    .expect(s.background == "aborted" and s.turn == "admitted" and s.reads == 3 and safety)

  run CancelledTurnDoesNotCancelSharedHandshakeTest = init.then(beginHandshake).then(beginTurn(true)).then(abortTurn)
    .then(finishHandshake("supported")).then(beginTurn(true)).then(finishComparison("supported"))
    .expect(s.background == "resolved" and s.turn == "admitted" and s.reads == 2 and safety)

  run RetirementFencesLateComparisonTest = init.then(beginTurn(true)).then(finishHandshake("supported"))
    .then(retire).then(finishComparison("supported")).expect(s.turn == "aborted" and safety)

  run LegacyPeerPreservesOrdinaryContextTest = init.then(beginTurn(true)).then(finishHandshake("legacy"))
    .then(beginTurn(true)).expect(s.turn == "ordinary" and s.reads == 1 and safety)

  run ConnectionReplacementFencesLateComparisonTest = init.then(beginTurn(true)).then(finishHandshake("supported"))
    .then(invalidateConnection).then(finishComparison("supported")).then(beginTurn(false))
    .expect(not(s.connectionCurrent) and not(s.retired) and s.turn == "aborted" and s.reads == 2 and safety)
}
