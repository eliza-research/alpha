// Separate capture, synthesis queue and AudioTrack/audio-focus ownership.
module SpeechResources {
  type State = {
    captureOwner: str, captureEpoch: int, captureOpen: bool, opening: bool, permission: bool, callActive: bool, engineReady: bool,
    focus: str, stream: str, queued: int, playing: bool, generation: int,
    cleared: bool, zeroedChunks: int,
    // openTicket: the reservation whose capture is open, or -1. focusRequested: a granted focus
    // request is still on the platform's focus stack.
    openTicket: int, focusRequested: bool,
    // modeWatcher: the platform reports audio-mode changes (Android 12 and later). Without it a
    // call is seen only at admission and through a focus loss.
    modeWatcher: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    captureOwner: "none", captureEpoch: 0, captureOpen: false, opening: false, permission: true, callActive: false, engineReady: true,
    focus: "idle", stream: "closed", queued: 0, playing: false,
    generation: 0, cleared: true, zeroedChunks: 0, openTicket: -1, focusRequested: false, modeWatcher: true
  }
  action acquireCapture(owner: str): bool = all {
    owner.in(Set("assistant", "dictation")), s.captureOwner == "none",
    s.permission, not(s.callActive), s.captureEpoch < 3,
    s' = {captureOwner: owner, captureEpoch: s.captureEpoch + 1, opening: true, ...s}
  }
  // A new live reservation cancels the active one without waiting for its startup: the earlier
  // ticket's capture is stopped or, if still opening, discarded when it reports.
  action replaceCapture = all {
    s.captureOwner == "assistant", s.permission, not(s.callActive), s.captureEpoch < 3,
    s' = {captureEpoch: s.captureEpoch + 1, opening: true, captureOpen: false, openTicket: -1, ...s}
  }
  action captureOpened(ticket: int): bool =
    if (s.opening and s.captureOwner != "none" and ticket == s.captureEpoch and s.permission and not(s.callActive))
      s' = {captureOpen: true, opening: false, openTicket: ticket, ...s}
    else s' = s
  action releaseCapture = s' = {captureOwner: "none", opening: false, captureOpen: false, openTicket: -1, ...s}
  action revokePermission =
    s' = {permission: false, captureOwner: "none", captureOpen: false, opening: false, openTicket: -1, ...s}
  action requestSpeech(focusGranted: bool): bool = all {
    s.engineReady, s.stream == "closed", not(s.callActive), s.generation < 3,
    s' = if (focusGranted)
      {focus: "held", stream: "open", generation: s.generation + 1,
        queued: 0, cleared: false, focusRequested: true, ...s}
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
    s' = {focus: "idle", stream: "closed", cleared: true, focusRequested: false, ...s}
  }
  action duck = all {
    s.focus == "held", s' = s.with("focus", "ducked")
  }
  action regain = all {
    s.focus == "ducked", s' = s.with("focus", "held")
  }
  // A focus loss stops speech. The policy is already idle when the stopped speech is released, and
  // the release still abandons the granted request, so nothing stays on the focus stack.
  action loseFocus(forCall: bool): bool = all {
    s.focus != "idle",
    s' = {focus: "idle", stream: "closed", queued: 0, playing: false, focusRequested: false,
      captureOwner: if (forCall) "none" else s.captureOwner,
      captureOpen: not(forCall) and s.captureOpen, opening: not(forCall) and s.opening,
      openTicket: if (forCall) -1 else s.openTicket,
      callActive: s.callActive or forCall, cleared: true, zeroedChunks: s.queued, ...s}
  }
  action stop = s' = {focus: "idle", stream: "closed", queued: 0,
    playing: false, cleared: true, zeroedChunks: s.queued, focusRequested: false, ...s}
  // An older platform has no audio-mode listener; nothing has started yet.
  action legacyPlatform = all {
    s.modeWatcher, s.captureEpoch == 0, s.generation == 0, s' = s.with("modeWatcher", false)
  }
  // With the mode listener a call stops speech and capture at once. Without it, running speech and
  // capture continue until a focus loss for the call arrives; new requests are refused at admission.
  action callBegins =
    if (s.modeWatcher)
      s' = {callActive: true, captureOwner: "none", captureOpen: false, opening: false,
        openTicket: -1, focus: "idle", stream: "closed", queued: 0, playing: false,
        cleared: true, zeroedChunks: s.queued, focusRequested: false, ...s}
    else s' = s.with("callActive", true)
  action callEnds = s' = s.with("callActive", false)
  action step = {
    nondet ticket = Set(-1, 0, 1, 2, 3).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet owner = Set("assistant", "dictation").oneOf()
    any { acquireCapture(owner), replaceCapture, captureOpened(ticket), releaseCapture, revokePermission,
      requestSpeech(flag), offer(ticket, flag), take, finishChunk, complete,
      releaseSpeech, duck, regain, loseFocus(flag), stop, callBegins, callEnds, legacyPlatform, s' = s }
  }
  val QueueBound = s.queued.in(0.to(2)) and s.zeroedChunks.in(0.to(2))
  // Only the current reservation's capture is open: a replaced or released ticket never holds the microphone.
  val ExclusiveCapture = (s.captureOpen implies s.openTicket == s.captureEpoch and s.captureOwner != "none") and
    (not(s.captureOpen) implies s.openTicket == -1)
  val PermissionRequired = s.captureOwner != "none" implies s.permission and not(s.callActive and s.modeWatcher)
  val PlaybackHasFocus = s.playing implies s.focus.in(Set("held", "ducked")) and not(s.callActive and s.modeWatcher)
  val ClosedQueueEmpty = s.stream == "closed" implies s.queued == 0 and not(s.playing) and s.cleared
  val CaptureCallbackCurrent = s.captureOpen implies s.captureOwner != "none" and not(s.opening)
  // Speech that ended or was stopped leaves no granted request behind, including after a loss.
  val FocusAbandonedWithSpeech = (s.stream == "closed" implies not(s.focusRequested)) and
    (s.focus != "idle" implies s.focusRequested)
  val safety = CaptureCallbackCurrent and QueueBound and ExclusiveCapture and PermissionRequired and PlaybackHasFocus and
    ClosedQueueEmpty and FocusAbandonedWithSpeech

  val ReplacedReservationWitness = s.captureOpen and s.captureEpoch >= 2
  val DuckedPlaybackWitness = s.playing and s.focus == "ducked"
  val CaptureDuringCallWitness = s.captureOpen and s.callActive
  val QueuedSpeechWitness = s.stream == "open" and s.queued == 1 and s.focusRequested

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
  // A second live reservation replaces the first while it is still opening: the first ticket's
  // capture is discarded when it reports, and only the replacement opens the microphone.
  run replacedReservationCannotOpenTest = init.then(acquireCapture("assistant")).then(replaceCapture)
    .then(captureOpened(1)).then(check(safety and not(s.captureOpen) and s.opening))
    .then(captureOpened(2)).then(check(safety and s.captureOpen and s.openTicket == 2))
    .then(replaceCapture).then(check(safety and not(s.captureOpen) and s.captureEpoch == 3))
  // Another app takes focus transiently while speech plays: speech stops and the request is abandoned.
  run lostFocusAbandonsRequestTest = init.then(requestSpeech(true)).then(offer(1, true)).then(take)
    .then(duck).then(check(s.focusRequested)).then(loseFocus(false))
    .then(check(safety and s.focus == "idle" and not(s.focusRequested) and s.stream == "closed"))
  // Abandoning only while the policy still holds focus would leave the request on the stack.
  run heldOnlyAbandonCanaryTest = init.then(requestSpeech(true)).then(offer(1, true)).then(take)
    .then(s' = {focus: "idle", stream: "closed", queued: 0, playing: false, cleared: true, ...s})
    .then(check(not(FocusAbandonedWithSpeech)))
  run deniedFocusLeavesNoRequestTest = init.then(requestSpeech(false))
    .then(check(safety and s.stream == "closed" and not(s.focusRequested))).then(stop).then(check(safety))
  // Without the mode listener an open capture is not stopped when a call begins while nothing holds
  // focus; only a focus loss for the call, or the next admission check, sees the call.
  run callWithoutModeListenerKeepsOpenCaptureTest = init.then(legacyPlatform).then(acquireCapture("assistant"))
    .then(captureOpened(1)).then(callBegins)
    .then(check(safety and s.captureOpen and s.callActive))
    .then(releaseCapture).then(acquireCapture("assistant").fail())
  run focusLossForCallStopsLegacyCaptureTest = init.then(legacyPlatform).then(acquireCapture("assistant"))
    .then(captureOpened(1)).then(requestSpeech(true)).then(callBegins).then(loseFocus(true))
    .then(check(safety and not(s.captureOpen) and s.captureOwner == "none" and s.stream == "closed"))
}
