/// Renderer ownership of one recorded conversation draft and its terminal callback.
module BatchCaptureCompletion {
  type State = {
    acquisition: str, active: bool, recording: bool, owner: int,
    early: int -> str, stopSeen: bool, ended: bool, problem: str,
    listening: bool, timer: bool, aborted: bool, cancelling: bool,
    published: int, stopOutcome: str, cancelOutcome: str, cleanupUnconfirmed: bool,
    nativeStops: int, nativeCancels: int, endSignals: List[str], endMarks: int
  }
  var s: State
  pure val ids = Set(1, 2)
  pure val empty = ids.mapBy(_ => "none")
  action init = s' = {acquisition: "pending", active: true, recording: false, owner: 0,
    early: empty, stopSeen: false, ended: false, problem: "none", listening: true, timer: false,
    aborted: false, cancelling: false, published: 0, stopOutcome: "none", cancelOutcome: "none",
    cleanupUnconfirmed: false, nativeStops: 0, nativeCancels: 0, endSignals: [], endMarks: 0}
  pure def finish(state: State, event: str): State = {...state,
    stopSeen: true, recording: false, timer: false, ended: event == "recorded",
    problem: if (event == "recorded") state.problem else event,
    endSignals: state.endSignals.append(if (event == "recorded") state.problem else event),
    endMarks: state.endMarks + (if (event == "recorded") 1 else 0)}
  action stopped(id: int, event: str): bool = all {
    id.in(ids), event.in(Set("recorded", "call", "microphone")),
    s' = if (not(s.active) or s.aborted or s.stopSeen or not(s.listening)) s
      else if (s.owner == 0) {...s, early: s.early.set(id, event)}
      else if (s.owner != id) s else finish(s, event)
  }
  action acknowledge(id: int): bool = all {
    id.in(ids), s.acquisition == "pending",
    val acquired = {...s, acquisition: "acquired", owner: id, recording: true, timer: true, early: empty}
    val earlyEvent = s.early.get(id)
    s' = if (s.aborted) {...s, acquisition: "aborted", active: false, listening: false,
        cancelling: true, nativeCancels: s.nativeCancels + 1}
      else if (earlyEvent != "none") finish(acquired, earlyEvent) else acquired
  }
  action refuseStart = all {
    s.acquisition == "pending",
    s' = {...s, acquisition: "failed", active: false, listening: false, cancelling: true,
      nativeCancels: s.nativeCancels + 1}
  }
  action metricsFailed = all {
    s.recording, s.timer, not(s.aborted),
    s' = {...s, recording: false, timer: false, problem: "metrics", endSignals: s.endSignals.append("metrics")}
  }
  action stop(nativeIdentityMatches: bool): bool = all {
    s.acquisition == "acquired", s.active, s.stopOutcome == "none", not(s.aborted),
    val useNative = s.problem == "none" and not(s.ended)
    val kept = s.problem == "none" and (s.ended or nativeIdentityMatches)
    s' = {...s, recording: false, listening: false, timer: false,
      nativeStops: s.nativeStops + (if (useNative) 1 else 0),
      published: if (kept) s.owner else 0,
      stopOutcome: if (kept) "recorded" else if (s.problem == "none") "identity" else s.problem,
      endMarks: s.endMarks + 1}
  }
  action abort = all {
    not(s.aborted),
    s' = {...s, aborted: true, recording: false, timer: false,
      nativeCancels: s.nativeCancels + (if (s.cancelling) 0 else 1)}
  }
  action cancel(ok: bool): bool = all {
    s.acquisition == "acquired", not(s.cancelling),
    s' = {...s, active: false, recording: false, timer: false, listening: false,
      cancelling: true, nativeCancels: s.nativeCancels + 1,
      cancelOutcome: if (ok) "done" else "unconfirmed", cleanupUnconfirmed: not(ok)}
  }
  action step = any {
    stopped(1, "recorded"), stopped(1, "call"), stopped(2, "microphone"), stopped(2, "recorded"),
    acknowledge(1), acknowledge(2), refuseStart, metricsFailed, stop(true), stop(false),
    abort, cancel(true), cancel(false), s' = s
  }
  val PollOwnsLiveRecording = s.timer implies s.acquisition == "acquired" and s.recording and s.listening and s.active and not(s.aborted)
  val EarlyCallbacksDoNotPublish = s.acquisition == "pending" implies s.published == 0 and s.endSignals == []
  val CallDoesNotPublish = s.problem == "call" implies s.published == 0 and s.nativeStops == 0
  val PublishedOwnsExactDraft = s.published != 0 implies s.published == s.owner and s.stopOutcome == "recorded"
  val CleanupFailureIsVisible = s.cleanupUnconfirmed iff s.cancelOutcome == "unconfirmed"
  val safety = PollOwnsLiveRecording and EarlyCallbacksDoNotPublish and CallDoesNotPublish and
    PublishedOwnsExactDraft and CleanupFailureIsVisible
  run earlyCallSurvivesForeignCallbackTest = init.then(stopped(1, "call")).then(stopped(2, "recorded"))
    .then(acknowledge(1)).then(stop(true)).expect(safety and s.stopOutcome == "call" and s.nativeStops == 0)
  run lateAckAfterAbortCannotPublishTest = init.then(abort).then(acknowledge(1))
    .expect(safety and s.acquisition == "aborted" and s.nativeCancels == 2 and not(s.listening))
  run successfulCallbackUsesExactFinishedDraftTest = init.then(acknowledge(1)).then(stopped(2, "microphone"))
    .then(stopped(1, "recorded")).then(stopped(1, "call")).then(stop(false))
    .expect(safety and s.published == 1 and s.nativeStops == 0)
  run failedCleanupKeepsAdmissionUnconfirmedTest = init.then(acknowledge(2)).then(cancel(false))
    .expect(safety and s.cleanupUnconfirmed and not(s.listening))
}
