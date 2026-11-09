// Separate capture, synthesis queue and AudioTrack/audio-focus ownership.
module SpeechResources {
  type State = {
    captureOwner: str, captureEpoch: int, captureOpen: bool, opening: bool, permission: bool, callActive: bool, engineReady: bool,
    focus: str, stream: str, queued: int, playing: bool, generation: int,
    cleared: bool, zeroedChunks: int
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    captureOwner: "none", captureEpoch: 0, captureOpen: false, opening: false, permission: true, callActive: false, engineReady: true,
    focus: "idle", stream: "closed", queued: 0, playing: false,
    generation: 0, cleared: true, zeroedChunks: 0
  }
  action acquireCapture(owner: str): bool = all {
    owner.in(Set("assistant", "dictation")), s.captureOwner == "none",
    s.permission, not(s.callActive), s.captureEpoch < 3,
    s' = {captureOwner: owner, captureEpoch: s.captureEpoch + 1, opening: true, ...s}
  }
  action captureOpened(ticket: int): bool =
    if (s.opening and s.captureOwner != "none" and ticket == s.captureEpoch and s.permission and not(s.callActive))
      s' = {captureOpen: true, opening: false, ...s}
    else s' = s
  action releaseCapture = s' = {captureOwner: "none", opening: false, captureOpen: false, ...s}
  action revokePermission =
    s' = {permission: false, captureOwner: "none", captureOpen: false, opening: false, ...s}
  action requestSpeech(focusGranted: bool): bool = all {
    s.engineReady, s.stream == "closed", not(s.callActive), s.generation < 3,
    s' = if (focusGranted)
      {focus: "held", stream: "open", generation: s.generation + 1,
        queued: 0, cleared: false, ...s}
      else s
  }
  // Samples are abstracted into two equally sized chunks. Full capacity applies backpressure.
  action offer(ticket: int, formatValid: bool): bool =
    if (s.stream == "open" and ticket == s.generation and formatValid and s.queued < 2)
      s' = s.with("queued", s.queued + 1)
    else s' = s
  action take = all {
    s.stream.in(Set("open", "complete")), s.queued > 0,
    s.focus.in(Set("held", "ducked")),
    s' = {queued: s.queued - 1, playing: true, ...s}
  }
  action finishChunk = all {
    s.playing, s' = s.with("playing", false)
  }
  action complete = all {
    s.stream == "open", s' = s.with("stream", "complete")
  }
  action releaseSpeech = all {
    s.stream == "complete", s.queued == 0, not(s.playing),
    s' = {focus: "idle", stream: "closed", cleared: true, ...s}
  }
  action duck = all {
    s.focus == "held", s' = s.with("focus", "ducked")
  }
  action regain = all {
    s.focus == "ducked", s' = s.with("focus", "held")
  }
  action loseFocus(forCall: bool): bool = all {
    s.focus != "idle",
    s' = {focus: "idle", stream: "closed", queued: 0, playing: false,
      captureOwner: if (forCall) "none" else s.captureOwner,
      captureOpen: not(forCall) and s.captureOpen, opening: not(forCall) and s.opening,
      callActive: forCall, cleared: true, zeroedChunks: s.queued, ...s}
  }
  action stop = s' = {focus: "idle", stream: "closed", queued: 0,
    playing: false, cleared: true, zeroedChunks: s.queued, ...s}
  action callBegins = s' = {callActive: true, captureOwner: "none", captureOpen: false, opening: false,
    focus: "idle", stream: "closed", queued: 0, playing: false,
    cleared: true, zeroedChunks: s.queued, ...s}
  action callEnds = s' = s.with("callActive", false)
  action step = {
    nondet ticket = Set(-1, 0, 1, 2, 3).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet owner = Set("assistant", "dictation").oneOf()
    any { acquireCapture(owner), captureOpened(ticket), releaseCapture, revokePermission,
      requestSpeech(flag), offer(ticket, flag), take, finishChunk, complete,
      releaseSpeech, duck, regain, loseFocus(flag), stop, callBegins, callEnds, s' = s }
  }
  val QueueBound = s.queued.in(0.to(2)) and s.zeroedChunks.in(0.to(2))
  val ExclusiveCapture = s.captureOwner.in(Set("none", "assistant", "dictation"))
  val PermissionRequired = s.captureOwner != "none" implies s.permission and not(s.callActive)
  val PlaybackHasFocus = s.playing implies s.focus.in(Set("held", "ducked")) and not(s.callActive)
  val ClosedQueueEmpty = s.stream == "closed" implies s.queued == 0 and not(s.playing) and s.cleared
  val CaptureCallbackCurrent = s.captureOpen implies s.captureOwner != "none" and not(s.opening)
  val safety = CaptureCallbackCurrent and QueueBound and ExclusiveCapture and PermissionRequired and PlaybackHasFocus and ClosedQueueEmpty

  run queueBackpressureTest = init.then(requestSpeech(true)).then(offer(1, true))
    .then(offer(1, true)).then(offer(1, true)).then(check(s.queued == 2 and safety))
    .then(take).then(finishChunk).then(offer(1, true)).then(check(s.queued == 2 and safety))
  run stopZeroesPendingTest = init.then(requestSpeech(true)).then(offer(1, true))
    .then(stop).then(offer(1, true)).then(check(safety and s.zeroedChunks == 1 and s.queued == 0))
  run callCancelsSpeechAndMicTest = init.then(acquireCapture("assistant"))
    .then(requestSpeech(true)).then(offer(1, true)).then(take).then(loseFocus(true))
    .then(check(safety and s.captureOwner == "none" and s.focus == "idle"))
  run duckPreservesQueueTest = init.then(requestSpeech(true)).then(offer(1, true))
    .then(duck).then(check(s.queued == 1 and s.focus == "ducked"))
    .then(regain).then(take).then(finishChunk).then(complete).then(releaseSpeech).then(check(safety))
  run cancelledOpeningIsDiscardedTest = init.then(acquireCapture("assistant")).then(releaseCapture)
    .then(captureOpened(1)).then(check(safety and not(s.captureOpen)))
    .then(acquireCapture("dictation")).then(captureOpened(1))
    .then(check(not(s.captureOpen))).then(captureOpened(2)).then(check(safety and s.captureOpen))
  run staleStreamRejectedTest = init.then(requestSpeech(true)).then(stop)
    .then(requestSpeech(true)).then(offer(1, true)).then(offer(2, false))
    .then(check(safety and s.queued == 0))
}
