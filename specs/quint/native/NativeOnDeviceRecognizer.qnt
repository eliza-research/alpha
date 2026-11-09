/// One on-device recognizer session, audio pipe and first-result ownership.
module NativeOnDeviceRecognizer {
  type State = {pipe: bool, serviceStarted: bool, recognizerOwned: bool, released: bool,
    serviceDestroyed: bool, serviceCancelled: bool, readClosed: bool, writeClosed: bool,
    finished: bool, stopped: bool, answered: bool, finishPending: bool, cancelPending: bool, stalled: bool,
    bytes: int, backlog: int, queuedBytes: int, transcript: str, failure: str,
    outcome: str, demoted: bool}
  var s: State
  pure val maxBacklog = 2048000
  pure val sizes = Set(0, 1, 2, 6401, maxBacklog)
  action init = s' = {pipe: false, serviceStarted: false, recognizerOwned: false,
    released: false, serviceDestroyed: false, serviceCancelled: false, readClosed: false,
    writeClosed: false, finished: false, stopped: false, answered: false, finishPending: false, cancelPending: false,
    stalled: false, bytes: 0, backlog: 0, queuedBytes: 0, transcript: "none", failure: "none",
    outcome: "none", demoted: false}
  pure def opened(st: State): State = {...st, pipe: true, serviceStarted: true, recognizerOwned: true}
  pure def released(st: State): State = {...st, released: true, recognizerOwned: false,
    serviceDestroyed: st.serviceStarted, readClosed: st.pipe, writeClosed: st.pipe, queuedBytes: 0}
  pure def finishResult(st: State): str =
    if (st.stopped) "cancelled" else if (st.failure != "none") st.failure else st.transcript
  pure def resolved(st: State, transcript: str, failure: str): State = {
    val first = if (st.answered) st else {...st, answered: true, transcript: transcript, failure: failure}
    val ended = released(first)
    if (st.finishPending) {...ended, finishPending: false, outcome: finishResult(ended)} else ended
  }
  action feed(lengthBytes: int): bool = all {
    lengthBytes.in(sizes), s.bytes + lengthBytes <= maxBacklog + 6404,
    if (s.finished) s' = {...s, outcome: "already_finished"}
    else if (s.stopped or s.answered) s' = {...s, outcome: "refused"}
    else if (s.backlog + lengthBytes > maxBacklog) s' = resolved({...s, outcome: "refused"}, "none", "backlog")
    else {
      val active = opened(s)
      s' = {...active, outcome: "accepted", bytes: s.bytes + (if (s.stalled) 0 else lengthBytes),
        backlog: s.backlog + (if (s.stalled) lengthBytes else 0),
        queuedBytes: s.queuedBytes + (if (s.stalled and s.backlog > 0) lengthBytes else 0)}
    }
  }
  action stall = all {s.recognizerOwned, not(s.stalled), not(s.finished), s' = {...s, stalled: true}}
  action finish = all {
    if (s.finished) s' = {...s, outcome: "already_finished"}
    else if (s.answered or s.stopped) s' = {...s, finished: true, outcome: finishResult(s)}
    else s' = {...opened(s), finished: true, finishPending: true, writeClosed: not(s.stalled and s.backlog > 0), outcome: "pending"}
  }
  action callback(kind: str): bool = all {
    s.serviceStarted, kind.in(Set("heard", "empty", "service_error", "language_unavailable")),
    not(s.cancelPending) or kind == "language_unavailable",
    if (s.answered or (s.stopped and kind == "language_unavailable")) s' = s
    else s' = resolved({...s, demoted: s.demoted or kind == "language_unavailable"},
      if (kind.in(Set("heard", "empty"))) kind else "none",
      if (kind.in(Set("heard", "empty"))) "none" else kind)
  }
  action timeout = all {s.finishPending, s' = resolved(s, "none", "timeout")}
  action cancel = {
    val cancelled = {...s, stopped: true, cancelPending: false, serviceCancelled: s.serviceCancelled or s.recognizerOwned}
    s' = resolved(cancelled, "none", "stopped")
  }
  action requestCancel = all {
    s.recognizerOwned, not(s.stopped or s.answered or s.finishPending or s.stalled),
    s' = {...s, stopped: true, cancelPending: true, released: true, writeClosed: true, queuedBytes: 0}
  }
  action settleCancel = all {
    s.cancelPending,
    s' = resolved({...s, cancelPending: false, serviceCancelled: true}, "none", "stopped")
  }
  action step = {
    nondet lengthBytes = sizes.oneOf()
    nondet kind = Set("heard", "empty", "service_error", "language_unavailable").oneOf()
    any {feed(lengthBytes), stall, finish, callback(kind), timeout, cancel, requestCancel, settleCancel, s' = s}
  }
  val AnswerReleasesSession = s.answered implies s.released and not(s.recognizerOwned or s.finishPending)
  val ReleasedPipeClosed = s.released and s.pipe and not(s.cancelPending) implies s.readClosed and s.writeClosed
  val LateErrorCannotDemote = s.demoted implies s.failure == "language_unavailable"
  val BacklogBound = 0 <= s.backlog and s.backlog <= maxBacklog and 0 <= s.queuedBytes and s.queuedBytes <= s.backlog
  val safety = AnswerReleasesSession and ReleasedPipeClosed and LateErrorCannotDemote and BacklogBound
  run retiredResultCannotDemoteTest = init.then(feed(2)).then(callback("heard"))
    .then(callback("language_unavailable")).then(finish).expect(safety and not(s.demoted) and s.outcome == "heard")
  run retiredCancelCannotDemoteTest = init.then(feed(2)).then(cancel)
    .then(callback("language_unavailable")).then(finish).expect(safety and not(s.demoted) and s.outcome == "cancelled")
  run cancellationRequestFencesLanguageErrorBeforeAckTest = init.then(feed(2)).then(requestCancel)
    .then(callback("language_unavailable")).expect(safety and s.cancelPending and not(s.demoted or s.answered))
    .then(settleCancel).then(finish).expect(safety and s.outcome == "cancelled")
  run currentMissingLanguageDemotesTest = init.then(feed(2)).then(finish)
    .then(callback("language_unavailable")).expect(safety and s.demoted and s.outcome == "language_unavailable")
  run queuedBacklogClearsWithoutPretendingWrittenTest = init.then(feed(0)).then(stall)
    .then(feed(maxBacklog)).then(feed(1)).expect(safety and s.failure == "backlog" and s.bytes == 0 and s.backlog == maxBacklog)
  run finishTimeoutKeepsFirstAnswerTest = init.then(feed(6401)).then(finish).then(timeout)
    .then(callback("heard")).expect(safety and s.outcome == "timeout" and s.transcript == "none")
}
