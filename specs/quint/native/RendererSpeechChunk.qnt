/// One owned speech chunk in the renderer (`speakChunk`): terminal-event listeners, preparation
/// and play with the busy-speaker retry, one terminal outcome, and a dispose that always runs.
/// Every consumer waits for the original preparation to settle. Strict consumers also require the
/// native cancel and stop to be confirmed; others bound them and never fail on them.
module RendererSpeechChunk {
  type State = { phase: str, strict: bool, queue: bool, active: bool, listeners: int, retries: int,
    preparePending: bool, playback: bool, nativePlayback: bool, cancelRequested: bool, stopRequested: bool,
    finishedSignal: str, pendingOutcome: str, result: str, startedCalls: int, cleanupFailed: bool }
  var s: State
  // dispose(): idempotent; removes the listeners and asks native to cancel and stop.
  pure def disposing(st: State, outcome: str): State = { ...st, phase: "disposing", active: false, listeners: 0,
    cancelRequested: true, stopRequested: true,
    pendingOutcome: if (st.pendingOutcome == "none") outcome else st.pendingOutcome }

  action init = s' = { phase: "new", strict: false, queue: false, active: false, listeners: 0, retries: 0,
    preparePending: false, playback: false, nativePlayback: false, cancelRequested: false, stopRequested: false,
    finishedSignal: "none", pendingOutcome: "none", result: "none", startedCalls: 0, cleanupFailed: false }
  action begin(strict: bool, queue: bool): bool = all { s.phase == "new",
    s' = { ...s, phase: "listeners", strict: strict, queue: queue, active: true } }
  // The three terminal-event listeners are registered before synthesis is requested.
  action listenerRegistered = all { s.phase == "listeners",
    s' = if (s.listeners == 2) { ...s, listeners: 3, phase: "preparing", preparePending: true }
      else { ...s, listeners: s.listeners + 1 } }
  // A terminal event seen while playing or waiting for the speaker retires the chunk in the same
  // task, so no abort or timer comes between the event and its retirement.
  pure def finishing(st: State): bool = st.finishedSignal != "none" and st.phase.in(Set("started", "play-wait"))
  action abort = all { s.active, not(finishing(s)), s' = disposing(s, "interrupted") }
  // A busy speaker is retried after a short wait only for queued speech, for as long as it stays
  // busy. The speaker is assumed to be busy at most twice per chunk here.
  pure def busyAllowed(st: State, kind: str): bool = not(kind == "busy" and st.queue and st.retries >= 2)
  action prepareResult(kind: str): bool = all { s.phase == "preparing", busyAllowed(s, kind),
    s' = if (kind == "ok") { ...s, phase: "play", preparePending: false, playback: true, nativePlayback: true }
      else if (kind == "busy" and s.queue)
        { ...s, phase: "prepare-wait", preparePending: false, retries: s.retries + 1 }
      else disposing({ ...s, preparePending: false }, "error") }
  // A preparation that resolves after the chunk was retired stops the playback it produced.
  action latePrepare(ok: bool): bool = all { s.preparePending, not(s.active),
    s' = { ...s, preparePending: false, nativePlayback: s.nativePlayback or ok } }
  action waitElapsed = all { s.phase.in(Set("prepare-wait", "play-wait")), not(finishing(s)),
    s' = if (s.phase == "prepare-wait") { ...s, phase: "preparing", preparePending: true } else { ...s, phase: "play" } }
  action playResult(kind: str): bool = all { s.phase == "play", busyAllowed(s, kind),
    s' = if (kind == "ok") { ...s, phase: "started", startedCalls: s.startedCalls + 1 }
      else if (kind == "busy" and s.queue) { ...s, phase: "play-wait", retries: s.retries + 1 }
      else disposing(s, "error") }
  // Ended, failed or stopped events count only for this chunk's playback while it is active.
  action terminalEvent(kind: str): bool = all { s.active, s.playback, s.finishedSignal == "none",
    s' = { ...s, finishedSignal: kind } }
  // A terminal event also retires a prepared utterance that is still waiting for the speaker.
  action observeFinished = all { finishing(s),
    s' = disposing(s, if (s.phase == "started") s.finishedSignal else "error") }
  // Cleanup waits for the original preparation. Only strict cleanup reports an unconfirmed native stop.
  action disposeSettled(confirmed: bool): bool = all { s.phase == "disposing", not(s.preparePending),
    s' = { ...s, phase: "settled", cleanupFailed: not(confirmed),
      result: if (s.strict and not(confirmed)) "cleanup-unconfirmed" else s.pendingOutcome } }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet kind = Set("ok", "busy", "error").oneOf()
    nondet event = Set("ended", "failed").oneOf()
    any { begin(flag, other), listenerRegistered, abort, prepareResult(kind), latePrepare(flag), waitElapsed,
      playResult(kind), terminalEvent(event), observeFinished, disposeSettled(flag), s' = s }
  }

  val OneTerminalOutcome = (s.phase == "settled") == (s.result != "none")
  val NoListenerOutlivesChunk = not(s.active) implies s.listeners == 0
  val DisposeAlwaysRuns = (not(s.active) and s.phase != "new") implies (s.cancelRequested and s.stopRequested)
  val LatePlaybackIsStopped = (s.nativePlayback and not(s.active)) implies s.stopRequested
  val StartedOnceWithPlayback = s.startedCalls <= 1 and (s.startedCalls == 1 implies s.playback)
  val EndedMeansStarted = s.result == "ended" implies s.startedCalls == 1
  val StrictReportsUnconfirmedCleanup = (s.phase == "settled" and s.cleanupFailed) implies
    (s.strict == (s.result == "cleanup-unconfirmed"))
  val CleanupAwaitsPreparation = s.phase == "settled" implies not(s.preparePending)
  val safety = OneTerminalOutcome and NoListenerOutlivesChunk and DisposeAlwaysRuns and LatePlaybackIsStopped and
    StartedOnceWithPlayback and EndedMeansStarted and StrictReportsUnconfirmedCleanup and CleanupAwaitsPreparation

  val StrictFailureWitness = s.result == "cleanup-unconfirmed"
  val LatePlaybackWitness = s.nativePlayback and not(s.playback) and not(s.active)
  val BusyRetryWitness = s.retries > 0 and s.phase.in(Set("prepare-wait", "play-wait"))
  val InterruptedWitness = s.result == "interrupted" and s.startedCalls == 1
  val BoundedCleanupWitness = s.phase == "settled" and s.cleanupFailed and not(s.strict)

  run listeningSetup = init.then(begin(false, true)).then(listenerRegistered).then(listenerRegistered).then(listenerRegistered)
  run playsToEndTest = listeningSetup.expect(s.phase == "preparing" and s.listeners == 3)
    .then(prepareResult("ok")).then(playResult("ok")).then(terminalEvent("ended")).then(observeFinished)
    .then(disposeSettled(true)).expect(s.result == "ended" and s.listeners == 0 and s.stopRequested and safety)
  run busySpeakerRetryTest = listeningSetup.then(prepareResult("busy")).then(waitElapsed).then(prepareResult("ok"))
    .then(playResult("busy")).then(waitElapsed).then(playResult("ok"))
    .expect(s.phase == "started" and s.retries == 2 and s.startedCalls == 1 and safety)
  // An abort while synthesis is pending: the late playback is stopped, and cleanup does not
  // settle before that preparation has.
  run abortDuringPrepareStopsLatePlaybackTest = init.then(begin(true, false)).then(listenerRegistered)
    .then(listenerRegistered).then(listenerRegistered).then(abort)
    .expect(s.phase == "disposing" and s.preparePending and s.listeners == 0)
    .then(latePrepare(true)).expect(s.nativePlayback and s.stopRequested and safety)
    .then(disposeSettled(true)).expect(s.result == "interrupted" and s.startedCalls == 0 and safety)
  run strictCleanupFailureTest = init.then(begin(true, false)).then(listenerRegistered).then(listenerRegistered)
    .then(listenerRegistered).then(prepareResult("ok")).then(playResult("ok")).then(terminalEvent("ended"))
    .then(observeFinished).then(disposeSettled(false)).expect(s.result == "cleanup-unconfirmed" and safety)
  run boundedCleanupKeepsOutcomeTest = listeningSetup.then(prepareResult("ok")).then(playResult("ok"))
    .then(terminalEvent("failed")).then(observeFinished).then(disposeSettled(false))
    .expect(s.result == "failed" and s.cleanupFailed and safety)
  run finishedWhileWaitingForSpeakerTest = listeningSetup.then(prepareResult("ok")).then(playResult("busy"))
    .then(terminalEvent("ended")).then(observeFinished).then(disposeSettled(true))
    .expect(s.result == "error" and s.startedCalls == 0 and safety)
  run unqueuedBusyFailsTest = init.then(begin(false, false)).then(listenerRegistered).then(listenerRegistered)
    .then(listenerRegistered).then(prepareResult("busy")).then(disposeSettled(true))
    .expect(s.result == "error" and safety)
}
