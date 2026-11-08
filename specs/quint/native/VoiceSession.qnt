// VoiceAssistantSession generations and distinct dictation behavior.
module VoiceSession {
  type State = {
    phase: str, route: str, disclosure: bool, startedExplicitly: bool,
    session: int, turn: int, utterance: int, capture: bool, fullDuplex: bool, muted: bool,
    text: bool, endpoint: str, requestTurn: int, playbackTurn: int,
    sent: Set[int], heard: int, availableSentences: int, draft: bool,
    pendingReview: bool, automaticApprovals: int, inputHeld: bool, closingInput: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    phase: "idle", route: "native", disclosure: false, startedExplicitly: false,
    session: 0, turn: 0, utterance: 0, capture: false, fullDuplex: true, muted: false,
    text: false, endpoint: "none", requestTurn: -1, playbackTurn: -1,
    sent: Set(), heard: 0, availableSentences: 0, draft: false,
    pendingReview: false, automaticApprovals: 0, inputHeld: false, closingInput: false
  }
  action discloseCloud = all {
    s.phase == "idle", s' = {route: "cloud", disclosure: true, ...s}
  }
  action start(dictation: bool, fullDuplex: bool): bool = all {
    s.phase.in(Set("idle", "error")), s.session < 2, s.route == "native" or s.disclosure,
    s' = {phase: if (dictation) "dictating" else "listening", capture: true,
      startedExplicitly: true, fullDuplex: fullDuplex, text: false, muted: false,
      pendingReview: false, draft: false, ...s}
  }
  action segment(ticket: int, hasText: bool): bool =
    if (s.capture and ticket == s.session and s.phase.in(Set("listening", "dictating")) and not(s.muted))
      s' = s.with("text", s.text or hasText)
    else s' = s
  action speechStarts = all {
    s.phase == "listening", s.capture, s.utterance < 4,
    s' = {utterance: s.utterance + 1, endpoint: "none", ...s}
  }
  action shortGap = all {
    s.phase == "listening", s.text, s.endpoint == "none",
    s' = s.with("endpoint", "pending")
  }
  action endpointResult(ticket: int, complete: bool): bool =
    if (ticket == s.utterance and s.endpoint == "pending")
      s' = s.with("endpoint", if (complete) "complete" else "unavailable")
    else s' = s
  // A complete semantic result or the long gap permits exactly one submission.
  action submit(longGap: bool): bool = all {
    s.phase == "listening", s.text, s.turn < 4,
    longGap or s.endpoint == "complete", not(s.sent.contains(s.turn + 1)),
    s' = {phase: "thinking", turn: s.turn + 1, requestTurn: s.turn + 1,
      text: false, endpoint: "none", sent: s.sent.union(Set(s.turn + 1)),
      heard: 0, availableSentences: 0, capture: false, inputHeld: true, closingInput: false, ...s}
  }
  action beginSubmission(longGap: bool): bool = all {
    s.phase == "listening", s.text, s.turn < 4,
    longGap or s.endpoint == "complete", not(s.sent.contains(s.turn + 1)),
    s' = {phase: "thinking", turn: s.turn + 1, requestTurn: s.turn + 1,
      text: false, endpoint: "none", sent: s.sent,
      heard: 0, availableSentences: 0, capture: false, inputHeld: false, closingInput: true, ...s}
  }
  action inputClosed = all {
    s.phase == "thinking", s.closingInput,
    s' = { ...s, closingInput: false, inputHeld: true, sent: s.sent.union(Set(s.turn)) }
  }
  action inputCloseFailed = all {
    s.phase == "thinking", s.closingInput, s.session < 2,
    s' = { ...s, phase: "error", session: s.session + 1, capture: false,
      closingInput: false, inputHeld: false, requestTurn: -1, playbackTurn: -1, text: false }
  }
  action reply(ticketSession: int, ticketTurn: int, needsReview: bool): bool =
    if (s.phase == "thinking" and s.inputHeld and ticketSession == s.session and ticketTurn == s.turn)
      s' = {phase: if (needsReview) "awaiting-review" else "speaking",
        pendingReview: needsReview, capture: false,
        playbackTurn: if (needsReview) -1 else ticketTurn,
        availableSentences: if (needsReview) 0 else 2, ...s}
    else s' = s
  action sentenceFinished(ticketSession: int, ticketTurn: int): bool =
    if (s.phase == "speaking" and ticketSession == s.session and ticketTurn == s.turn and s.heard < s.availableSentences)
      s' = s.with("heard", s.heard + 1)
    else s' = s
  action playbackFinished = all {
    s.phase == "speaking", s.heard == s.availableSentences,
    s' = {phase: "listening", playbackTurn: -1, capture: not(s.muted), inputHeld: false, ...s}
  }
  // Echo/cough rejection leaves the response untouched; actual barge-in advances generation.
  action bargeIn(confirmed: bool): bool = all {
    s.phase.in(Set("thinking", "speaking")), s.turn < 4,
    s' = if (confirmed and (s.phase == "thinking" or s.fullDuplex))
      {phase: "listening", turn: s.turn + 1, text: true,
        endpoint: "none", playbackTurn: -1, requestTurn: -1, ...s} else s
  }
  // Explicit user interruption retains no dictated segment. Input reopens after the aborted playback drains.
  action interruptSpeech = all {
    s.phase == "speaking", s.turn < 4,
    s' = { ...s, phase: "listening", turn: s.turn + 1, text: false,
      endpoint: "none", playbackTurn: -1, requestTurn: -1, capture: not(s.muted),
      inputHeld: false, closingInput: false }
  }
  action mute = all {
    s.phase.in(Set("listening", "thinking", "speaking", "awaiting-review")),
    s' = {muted: not(s.muted), capture: s.muted and s.phase == "listening" and not(s.inputHeld or s.closingInput), ...s}
  }
  action resumeReview(ticketSession: int, ticketTurn: int, matches: bool): bool =
    if (s.phase == "awaiting-review" and ticketSession == s.session and ticketTurn == s.turn and matches)
      s' = {phase: "speaking", pendingReview: false, capture: false,
        playbackTurn: s.turn, availableSentences: 2, ...s}
    else s' = s
  action finishDictation = all {
    s.phase == "dictating",
    s' = {phase: "idle", capture: false, draft: s.text, text: false, ...s}
  }
  action stop = all {
    s.session < 2,
    s' = {phase: "idle", capture: false, session: s.session + 1,
      endpoint: "none", requestTurn: -1, playbackTurn: -1, text: false, inputHeld: false, closingInput: false,
      pendingReview: false, ...s}
  }
  action step = {
    nondet ticketSession = Set(-1, 0, 1, 2).oneOf()
    nondet ticketTurn = Set(-1, 0, 1, 2, 3, 4).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet duplex = Set(false, true).oneOf()
    any { discloseCloud, start(flag, duplex), segment(ticketSession, flag), speechStarts, shortGap,
      endpointResult(ticketTurn, flag), submit(flag), beginSubmission(flag), inputClosed, inputCloseFailed, reply(ticketSession, ticketTurn, flag),
      sentenceFinished(ticketSession, ticketTurn), playbackFinished,
      bargeIn(flag), interruptSpeech, mute, resumeReview(ticketSession, ticketTurn, flag), finishDictation, stop, s' = s }
  }
  val TypeOK = s.session.in(0.to(2)) and s.turn.in(0.to(4)) and
    s.phase.in(Set("idle", "dictating", "listening", "thinking", "speaking", "awaiting-review", "error"))
  val CloudConsent = s.capture and s.route == "cloud" implies s.disclosure and s.startedExplicitly
  val StopReleasesCapture = s.phase.in(Set("idle", "error", "awaiting-review")) implies not(s.capture)
  val PlaybackCurrent = s.phase == "speaking" implies s.playbackTurn == s.turn
  val HeardIsCompleted = s.heard >= 0 and s.heard <= s.availableSentences
  val VoiceNeverApproves = s.automaticApprovals == 0
  val DictationNeverSubmits = s.phase == "dictating" implies s.requestTurn == -1
  val MutedMicrophoneOff = s.muted implies not(s.capture)
  val BusyInputClosed = s.phase.in(Set("thinking", "speaking", "awaiting-review")) implies not(s.capture)
  val SendWaitsForClose = s.closingInput implies not(s.sent.contains(s.turn))
  val safety = BusyInputClosed and SendWaitsForClose and MutedMicrophoneOff and TypeOK and CloudConsent and StopReleasesCapture and PlaybackCurrent and
    HeardIsCompleted and VoiceNeverApproves and DictationNeverSubmits

  run longGapAndPlaybackTest = init.then(start(false, true)).then(segment(0, true))
    .then(shortGap).then(endpointResult(0, false)).then(submit(true))
    .then(reply(0, 1, false)).then(sentenceFinished(0, 1)).then(sentenceFinished(0, 1))
    .then(playbackFinished).then(check(safety and s.phase == "listening" and s.heard == 2))
  run staleReplyAfterBargeInTest = init.then(start(false, true)).then(segment(0, true))
    .then(submit(true)).then(bargeIn(true)).then(reply(0, 1, false))
    .then(check(safety and s.phase == "listening" and s.turn == 2))
  run partialSentenceNotHeardTest = init.then(start(false, true)).then(segment(0, true))
    .then(submit(true)).then(reply(0, 1, false)).then(sentenceFinished(0, 1))
    .then(bargeIn(true)).then(sentenceFinished(0, 1))
    .then(check(safety and s.heard == 1))
  run dictationIsDraftTest = init.then(start(true, false)).then(segment(0, true))
    .then(finishDictation).then(check(safety and s.draft and s.sent.size() == 0))
  run proposalStopsAutomaticVoiceTest = init.then(discloseCloud).then(start(false, true))
    .then(segment(0, true)).then(submit(true)).then(reply(0, 1, true))
    .then(check(safety and s.pendingReview and not(s.capture)))
  run staleEndpointAfterNewSpeechTest = init.then(start(false, true)).then(segment(0, true))
    .then(shortGap).then(speechStarts).then(endpointResult(0, true))
    .then(check(safety and s.endpoint == "none" and s.sent.size() == 0))
  run reviewedReadResumesSameTurnTest = init.then(start(false, true)).then(segment(0, true))
    .then(submit(true)).then(reply(0, 1, true)).then(resumeReview(0, 1, false))
    .then(check(s.phase == "awaiting-review" and not(s.capture)))
    .then(resumeReview(0, 1, true)).then(check(safety and s.phase == "speaking" and s.sent.size() == 1))
  run muteKeepsReplyAndStopsMicrophoneTest = init.then(start(false, true)).then(segment(0, true))
    .then(submit(true)).then(reply(0, 1, false)).then(mute)
    .then(check(safety and s.phase == "speaking" and not(s.capture)))
    .then(mute).then(check(safety and not(s.capture)))
  run stopRejectsLateCaptureTest = init.then(start(false, true)).then(stop)
    .then(segment(0, true)).then(check(safety and not(s.text)))
  run inputCloseBarrierTest = init.then(start(false, true)).then(segment(0, true)).then(beginSubmission(true))
    .expect(safety and s.sent.size() == 0 and not(s.capture)).then(inputClosed)
    .expect(safety and s.sent == Set(1) and s.inputHeld)
  run stoppingPendingCloseNeverSendsTest = init.then(start(false, true)).then(segment(0, true)).then(beginSubmission(true))
    .then(stop).expect(safety and s.sent.size() == 0 and not(s.closingInput))
  run explicitSpeechInterruptionTest = init.then(start(false, true)).then(segment(0, true)).then(submit(true))
    .then(reply(0, 1, false)).then(interruptSpeech)
    .expect(safety and s.phase == "listening" and s.capture and not(s.text or s.inputHeld))

}
