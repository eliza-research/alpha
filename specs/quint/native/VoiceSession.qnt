// VoiceAssistantSession generations and distinct dictation behavior.
module VoiceSession {
  type State = {
    phase: str, route: str, disclosure: bool, startedExplicitly: bool,
    session: int, turn: int, utterance: int, capture: bool, fullDuplex: bool, muted: bool,
    text: bool, endpoint: str, requestTurn: int, playbackTurn: int,
    sent: Set[int], heard: int, availableSentences: int, draft: bool,
    pendingReview: bool, replyConfirmed: bool, inputHeld: bool, closingInput: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    phase: "idle", route: "native", disclosure: false, startedExplicitly: false,
    session: 0, turn: 0, utterance: 0, capture: false, fullDuplex: true, muted: false,
    text: false, endpoint: "none", requestTurn: -1, playbackTurn: -1,
    sent: Set(), heard: 0, availableSentences: 0, draft: false,
    pendingReview: false, replyConfirmed: false, inputHeld: false, closingInput: false
  }
  action discloseCloud = all {
    s.phase == "idle", s' = {route: "cloud", disclosure: true, ...s}
  }
  action start(dictation: bool, fullDuplex: bool): bool = all {
    s.phase.in(Set("idle", "error")), s.session < 2, s.route == "native" or s.disclosure,
    s' = {phase: if (dictation) "dictating" else "listening", capture: true,
      startedExplicitly: true, fullDuplex: fullDuplex, text: false, muted: false,
      pendingReview: false, draft: false, inputHeld: false, closingInput: false, ...s}
  }
  // The conversation publishes `starting` while its capture opens. `start` above is the same
  // start with the capture already open.
  action beginStart(fullDuplex: bool): bool = all {
    s.phase.in(Set("idle", "error")), s.session < 2, s.route == "native" or s.disclosure,
    s' = {phase: "starting", capture: false, startedExplicitly: true, fullDuplex: fullDuplex,
      text: false, muted: false, pendingReview: false, draft: false, inputHeld: false, closingInput: false, ...s}
  }
  action captureOpened = all {
    s.phase == "starting", s' = { ...s, phase: "listening", capture: true }
  }
  // A capture that cannot open ends the conversation with nothing sent.
  action captureOpenFailed = all {
    s.phase == "starting", s.session < 2,
    s' = { ...s, phase: "error", session: s.session + 1, capture: false, requestTurn: -1, playbackTurn: -1, text: false }
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
    s' = {phase: "thinking", capture: false, turn: s.turn + 1, requestTurn: s.turn + 1,
      text: false, endpoint: "none", sent: s.sent.union(Set(s.turn + 1)),
      heard: 0, availableSentences: 0, replyConfirmed: false, inputHeld: true, closingInput: false, ...s}
  }
  action beginSubmission(longGap: bool): bool = all {
    s.phase == "listening", s.text, s.turn < 4,
    longGap or s.endpoint == "complete", not(s.sent.contains(s.turn + 1)),
    s' = {phase: "thinking", turn: s.turn + 1, requestTurn: s.turn + 1,
      text: false, endpoint: "none", sent: s.sent,
      heard: 0, availableSentences: 0, replyConfirmed: false, capture: false, inputHeld: false, closingInput: true, ...s}
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
  // A sentence of a streamed reply that is confirmed model text of a plain direct reply is spoken
  // before the reply itself is confirmed. The turn stays busy and its input stays closed.
  action streamSentence(ticketSession: int, ticketTurn: int): bool =
    if (s.phase.in(Set("thinking", "speaking")) and s.inputHeld and not(s.replyConfirmed) and
        ticketSession == s.session and ticketTurn == s.turn and s.availableSentences < 2)
      s' = { ...s, phase: "speaking", playbackTurn: ticketTurn, availableSentences: s.availableSentences + 1 }
    else s' = s
  // The confirmed reply. An owner-input pause is never spoken: sentences that already played from
  // the stream are stopped and dropped, and the resumed reply is accounted on its own.
  action reply(ticketSession: int, ticketTurn: int, needsReview: bool): bool =
    if ((s.phase == "thinking" or (s.phase == "speaking" and not(s.replyConfirmed))) and s.inputHeld and
        ticketSession == s.session and ticketTurn == s.turn)
      s' = {phase: if (needsReview) "awaiting-review" else "speaking",
        pendingReview: needsReview, capture: false, replyConfirmed: not(needsReview),
        playbackTurn: if (needsReview) -1 else ticketTurn,
        heard: if (needsReview) 0 else s.heard,
        availableSentences: if (needsReview) 0 else 2, ...s}
    else s' = s
  // A reply that is not confirmed for this turn, or that carries action proposals, ends the
  // conversation. Voice never approves a proposal; the host shows the review.
  action replyRejected(ticketSession: int, ticketTurn: int): bool =
    if ((s.phase == "thinking" or (s.phase == "speaking" and not(s.replyConfirmed))) and s.inputHeld and
        ticketSession == s.session and ticketTurn == s.turn and s.session < 2)
      s' = { ...s, phase: "error", session: s.session + 1, capture: false, inputHeld: false, closingInput: false,
        requestTurn: -1, playbackTurn: -1, text: false, pendingReview: false }
    else s' = s
  action sentenceFinished(ticketSession: int, ticketTurn: int): bool =
    if (s.phase == "speaking" and ticketSession == s.session and ticketTurn == s.turn and s.heard < s.availableSentences)
      s' = s.with("heard", s.heard + 1)
    else s' = s
  action playbackFinished = all {
    s.phase == "speaking", s.replyConfirmed, s.heard == s.availableSentences,
    s' = {phase: "listening", capture: not(s.muted), playbackTurn: -1, inputHeld: false, closingInput: false, ...s}
  }
  // A busy response owns the closed input. Audio callbacks cannot interrupt it.
  action bargeIn(confirmed: bool): bool = all {
    s.phase.in(Set("thinking", "speaking")), s.turn < 4,
    s' = if (confirmed and s.capture and (s.phase == "thinking" or s.fullDuplex))
      {phase: "listening", turn: s.turn + 1, text: true,
        endpoint: "none", playbackTurn: -1, requestTurn: -1, ...s} else s
  }
  // Explicit UI interruption keeps capture closed until playback has drained.
  action interruptSpeech = all {
    s.phase == "speaking", s.turn < 4,
    s' = { ...s, phase: "listening", turn: s.turn + 1, text: false,
      capture: false, endpoint: "none", playbackTurn: -1, requestTurn: -1, closingInput: false }
  }
  action playbackDrained = all {
    s.phase == "listening", not(s.capture), not(s.muted),
    s' = { ...s, capture: true, inputHeld: false, closingInput: false }
  }
  action mute = all {
    s.phase.in(Set("listening", "thinking", "speaking", "awaiting-review")),
    s' = {muted: not(s.muted), capture: s.muted and s.phase == "listening" and not(s.inputHeld or s.closingInput), ...s}
  }
  action resumeReview(ticketSession: int, ticketTurn: int, matches: bool): bool =
    if (s.phase == "awaiting-review" and ticketSession == s.session and ticketTurn == s.turn and matches)
      s' = {phase: "speaking", pendingReview: false, capture: false, replyConfirmed: true,
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
    any { discloseCloud, start(flag, duplex), beginStart(duplex), captureOpened, captureOpenFailed,
      streamSentence(ticketSession, ticketTurn), replyRejected(ticketSession, ticketTurn), segment(ticketSession, flag), speechStarts, shortGap,
      endpointResult(ticketTurn, flag), submit(flag), beginSubmission(flag), inputClosed, inputCloseFailed, reply(ticketSession, ticketTurn, flag),
      sentenceFinished(ticketSession, ticketTurn), playbackFinished,
      bargeIn(flag), interruptSpeech, playbackDrained, mute, resumeReview(ticketSession, ticketTurn, flag), finishDictation, stop, s' = s }
  }
  val TypeOK = s.session.in(0.to(2)) and s.turn.in(0.to(4)) and
    s.phase.in(Set("idle", "starting", "dictating", "listening", "thinking", "speaking", "awaiting-review", "error"))
  val CloudConsent = s.capture and s.route == "cloud" implies s.disclosure and s.startedExplicitly
  val StopReleasesCapture = s.phase.in(Set("idle", "starting", "error", "awaiting-review")) implies not(s.capture)
  val PlaybackCurrent = s.phase == "speaking" implies s.playbackTurn == s.turn
  val HeardIsCompleted = s.heard >= 0 and s.heard <= s.availableSentences
  // An owner-input pause holds nothing audible, and only a confirmed reply or a resumed one is
  // accounted as the turn's reply.
  val PauseSpeaksNothing = s.phase == "awaiting-review" implies
    (s.pendingReview and not(s.replyConfirmed) and s.availableSentences == 0 and s.heard == 0 and s.playbackTurn == -1)
  val EarlySpeechKeepsInputClosed = (s.phase == "speaking" and not(s.replyConfirmed)) implies
    (s.inputHeld and not(s.capture) and s.availableSentences > 0)
  val DictationNeverSubmits = s.phase == "dictating" implies s.requestTurn == -1
  val MutedMicrophoneOff = s.muted implies not(s.capture)
  val BusyCaptureHeld = s.phase.in(Set("thinking", "speaking", "awaiting-review")) implies not(s.capture)
  val SendWaitsForClose = s.closingInput implies not(s.sent.contains(s.turn))
  val safety = SendWaitsForClose and BusyCaptureHeld and MutedMicrophoneOff and TypeOK and CloudConsent and StopReleasesCapture and PlaybackCurrent and
    HeardIsCompleted and PauseSpeaksNothing and EarlySpeechKeepsInputClosed and DictationNeverSubmits

  val StartingWitness = s.phase == "starting"
  val EarlySpeechWitness = s.phase == "speaking" and not(s.replyConfirmed)
  val MutedBusyWitness = s.muted and s.phase.in(Set("thinking", "speaking"))
  val InputCloseBarrierWitness = s.closingInput and s.phase == "thinking"

  run longGapAndPlaybackTest = init.then(start(false, true)).then(segment(0, true))
    .then(shortGap).then(endpointResult(0, false)).then(submit(true))
    .then(reply(0, 1, false)).then(sentenceFinished(0, 1)).then(sentenceFinished(0, 1))
    .then(playbackFinished).then(check(safety and s.phase == "listening" and s.heard == 2))
  run busySpeechDoesNotInterruptTest = init.then(start(false, true)).then(segment(0, true))
    .then(submit(true)).then(bargeIn(true)).then(reply(0, 1, false))
    .then(check(safety and s.phase == "speaking" and s.turn == 1 and not(s.capture)))
  run partialSentenceNotHeardTest = init.then(start(false, true)).then(segment(0, true))
    .then(submit(true)).then(reply(0, 1, false)).then(sentenceFinished(0, 1))
    .then(interruptSpeech).then(sentenceFinished(0, 1))
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
    .then(sentenceFinished(0, 1)).then(sentenceFinished(0, 1)).then(playbackFinished)
    .then(check(safety and s.capture))
  run stopRejectsLateCaptureTest = init.then(start(false, true)).then(stop)
    .then(segment(0, true)).then(check(safety and not(s.text)))
  run inputCloseBarrierTest = init.then(start(false, true)).then(segment(0, true)).then(beginSubmission(true))
    .expect(safety and s.sent.size() == 0 and not(s.capture)).then(inputClosed)
    .expect(safety and s.sent == Set(1) and s.inputHeld)
  run stoppingPendingCloseNeverSendsTest = init.then(start(false, true)).then(segment(0, true)).then(beginSubmission(true))
    .then(stop).expect(safety and s.sent.size() == 0 and not(s.closingInput))
  run failedInputCloseKeepsRequestUnsentTest = init.then(start(false, true)).then(segment(0, true)).then(beginSubmission(true))
    .then(inputCloseFailed).expect(safety and s.phase == "error" and s.sent.size() == 0 and not(s.capture))
  run startingOpensCaptureTest = init.then(beginStart(true))
    .expect(safety and s.phase == "starting" and not(s.capture)).then(segment(0, true))
    .expect(not(s.text)).then(captureOpened).expect(safety and s.phase == "listening" and s.capture)
  run failedOpenEndsSessionTest = init.then(beginStart(true)).then(captureOpenFailed)
    .expect(safety and s.phase == "error" and s.session == 1 and not(s.capture) and s.sent.size() == 0)
  // A sentence streamed from a direct reply plays before the reply is confirmed, and playback
  // cannot be reported finished until that reply arrived.
  run streamedPlaybackBeforeReplyTest = init.then(start(false, true)).then(segment(0, true)).then(submit(true))
    .then(streamSentence(0, 1)).expect(safety and s.phase == "speaking" and not(s.replyConfirmed) and not(s.capture))
    .then(sentenceFinished(0, 1)).expect(s.heard == 1).then(reply(0, 1, false))
    .expect(safety and s.replyConfirmed and s.availableSentences == 2 and s.heard == 1)
    .then(sentenceFinished(0, 1)).then(playbackFinished).expect(safety and s.phase == "listening" and s.heard == 2)
  // A reply that turns out to pause for the owner stops what was already playing from its stream:
  // none of it is kept as heard, and the resumed reply plays in full.
  run pauseAfterStreamedSpeechSpeaksNothingTest = init.then(start(false, true)).then(segment(0, true)).then(submit(true))
    .then(streamSentence(0, 1)).then(sentenceFinished(0, 1)).then(reply(0, 1, true))
    .expect(safety and s.phase == "awaiting-review" and s.heard == 0 and s.availableSentences == 0 and not(s.capture))
    .then(resumeReview(0, 1, true)).then(sentenceFinished(0, 1)).then(sentenceFinished(0, 1)).then(playbackFinished)
    .expect(safety and s.phase == "listening" and s.heard == 2 and s.sent == Set(1))
  // A reply carrying proposals is not confirmed for voice: the conversation ends and nothing more is sent.
  run proposalReplyEndsSessionTest = init.then(start(false, true)).then(segment(0, true)).then(submit(true))
    .then(replyRejected(0, 1)).expect(safety and s.phase == "error" and s.session == 1 and not(s.capture))
    .then(reply(0, 1, false)).expect(safety and s.phase == "error" and s.sent == Set(1))
  run staleStreamedSentenceIsDroppedTest = init.then(start(false, true)).then(segment(0, true)).then(submit(true))
    .then(stop).then(streamSentence(0, 1)).expect(safety and s.phase == "idle" and s.availableSentences == 0)
}
