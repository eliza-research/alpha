/// The four owned-speech retirement chains (voice surface, read aloud, app speech, Cloud app
/// speech). A successor waits for the preceding cleanup. A cleanup that could not be confirmed
/// closes its chain. The voice surface and read aloud stay closed until the app restarts. App
/// speech and Cloud app speech make one native stop for the next request: a confirmed stop admits
/// it, and a refused one keeps the chain closed and asks for a restart.
module SpeechCleanupLatch {
  type State = { stage: str -> str, waiting: Set[str], everLatched: Set[str], stopConfirmed: Set[str], refused: Set[str],
    refusal: str, recorderOpen: bool, entryLatched: bool, entryMessage: str, starts: int, epoch: int }
  var s: State
  pure val Chains = Set("voice", "reading", "app", "cloud")
  // The chains whose successor asks native to stop playback once before giving up.
  pure val Recoverable = Set("app", "cloud")
  pure val MediaNotStopped = "media-not-stopped"
  pure val RestartNeeded = "restart-needed"

  action init = s' = { stage: Chains.mapBy(_ => "idle"), waiting: Set(), everLatched: Set(), stopConfirmed: Set(), refused: Set(),
    refusal: "none", recorderOpen: false, entryLatched: false, entryMessage: "none", starts: 0, epoch: 0 }
  // Speech requested on a chain: it plays, waits behind the cleanup in progress, asks native for
  // the one stop a closed recoverable chain allows, or is refused with the coded cleanup error that
  // the closed chain rethrows into each successor.
  action speak(c: str): bool = all { s.starts < 6, not(s.waiting.contains(c)), s.stage.get(c) != "recovering",
    s' = if (s.stage.get(c) == "idle") { ...s, stage: s.stage.set(c, "playing"), starts: s.starts + 1 }
      else if (s.stage.get(c) == "latched")
        if (Recoverable.contains(c)) { ...s, stage: s.stage.set(c, "recovering"), starts: s.starts + 1 }
        else { ...s, refused: s.refused.union(Set(c)), refusal: MediaNotStopped, starts: s.starts + 1 }
      else { ...s, stage: s.stage.set(c, "retiring"), waiting: s.waiting.union(Set(c)), starts: s.starts + 1 } }
  // The native stop made for a request on a closed chain. Only a confirmed stop admits the request.
  action recoveryStopSettled(c: str, confirmed: bool): bool = all { s.stage.get(c) == "recovering",
    s' = if (confirmed) { ...s, stage: s.stage.set(c, "playing"), stopConfirmed: s.stopConfirmed.union(Set(c)),
        refused: s.refused.exclude(Set(c)) }
      else { ...s, stage: s.stage.set(c, "latched"), stopConfirmed: s.stopConfirmed.exclude(Set(c)),
        refused: s.refused.union(Set(c)), refusal: RestartNeeded } }
  // Playback ended or was cancelled; its native cancel and stop are now being confirmed.
  action finishPlayback(c: str): bool = all { s.stage.get(c) == "playing", s' = { ...s, stage: s.stage.set(c, "retiring") } }
  action cleanupSettled(c: str, confirmed: bool): bool = all { s.stage.get(c) == "retiring",
    s' = if (confirmed) { ...s, waiting: s.waiting.exclude(Set(c)),
        stage: s.stage.set(c, if (s.waiting.contains(c)) "playing" else "idle") }
      else if (s.waiting.contains(c) and Recoverable.contains(c))
        { ...s, stage: s.stage.set(c, "recovering"), everLatched: s.everLatched.union(Set(c)),
          stopConfirmed: s.stopConfirmed.exclude(Set(c)), waiting: s.waiting.exclude(Set(c)) }
      else { ...s, stage: s.stage.set(c, "latched"), everLatched: s.everLatched.union(Set(c)),
        stopConfirmed: s.stopConfirmed.exclude(Set(c)), waiting: s.waiting.exclude(Set(c)),
        refused: if (s.waiting.contains(c)) s.refused.union(Set(c)) else s.refused,
        refusal: if (s.waiting.contains(c)) MediaNotStopped else s.refusal } }
  // Opening Transcribe on the voice surface. Voice media whose stop was never confirmed is
  // reported as such; media that is still stopping, or an open recorder, asks to finish first.
  action enterVoice = all { s.starts < 6,
    s' = if (s.stage.get("voice") == "latched")
        { ...s, entryLatched: true, entryMessage: MediaNotStopped, starts: s.starts + 1 }
      else if (s.stage.get("voice") == "retiring" or s.recorderOpen)
        { ...s, entryLatched: false, entryMessage: "finish-or-discard", starts: s.starts + 1 }
      else { ...s, entryLatched: false, entryMessage: "none", recorderOpen: true, starts: s.starts + 1 } }
  action closeRecorder = all { s.recorderOpen, s' = { ...s, recorderOpen: false } }
  // Only a new app process starts with open chains.
  action restart = all { s.epoch < 1,
    s' = { ...s, stage: Chains.mapBy(_ => "idle"), waiting: Set(), everLatched: Set(), stopConfirmed: Set(), refused: Set(),
      refusal: "none", recorderOpen: false, entryLatched: false, entryMessage: "none", epoch: s.epoch + 1 } }
  action step = {
    nondet c = Chains.oneOf()
    nondet confirmed = Set(false, true).oneOf()
    any { speak(c), recoveryStopSettled(c, confirmed), finishPlayback(c), cleanupSettled(c, confirmed), enterVoice, closeRecorder, restart, s' = s }
  }

  val StagesKnown = Chains.forall(c => s.stage.get(c).in(Set("idle", "playing", "retiring", "recovering", "latched")))
  val SuccessorWaitsForCleanup = s.waiting.forall(c => s.stage.get(c) == "retiring")
  // A closed chain reopens only through a confirmed native stop, which only recoverable chains make.
  val LatchHoldsUntilConfirmedStop = s.everLatched.forall(c =>
    s.stage.get(c).in(Set("latched", "recovering")) or s.stopConfirmed.contains(c))
  val OnlyRecoverableChainsReopen = s.stopConfirmed.subseteq(Recoverable) and
    Chains.exclude(Recoverable).forall(c => s.stage.get(c) != "recovering")
  val RefusedOnlyOnClosedChain = s.refused.forall(c => s.stage.get(c).in(Set("latched", "recovering"))) and
    (s.refused != Set() implies s.refusal.in(Set(MediaNotStopped, RestartNeeded)))
  val LatchedEntryNamesCleanup = s.entryLatched implies s.entryMessage == MediaNotStopped
  val BusyRecorderMessageOnlyWhenOpen = s.entryMessage == "finish-or-discard" implies not(s.entryLatched)
  val safety = StagesKnown and SuccessorWaitsForCleanup and LatchHoldsUntilConfirmedStop and OnlyRecoverableChainsReopen and RefusedOnlyOnClosedChain and
    LatchedEntryNamesCleanup and BusyRecorderMessageOnlyWhenOpen

  val LatchedVoiceWitness = s.stage.get("voice") == "latched"
  val RefusedSuccessorWitness = s.refused != Set()
  val WaitingSuccessorWitness = s.waiting != Set()
  val LatchedEntryWitness = s.entryLatched and s.recorderOpen
  val RecoveredChainWitness = s.stopConfirmed.contains("app") and s.stage.get("app") == "playing"
  val RestartNeededWitness = s.refusal == RestartNeeded and s.stage.get("cloud") == "latched"
  val RestartedWitness = s.epoch == 1 and s.stage.get("app") == "playing"

  run replacementWaitsForCleanupTest = init.then(speak("app")).then(speak("app"))
    .expect(s.stage.get("app") == "retiring" and s.waiting == Set("app") and safety)
    .then(cleanupSettled("app", true)).expect(s.stage.get("app") == "playing" and s.waiting == Set() and safety)
  // One unconfirmed cleanup closes that chain only, and each later request is told why.
  run unconfirmedCleanupLatchesTest = init.then(speak("reading")).then(finishPlayback("reading"))
    .then(cleanupSettled("reading", false)).expect(s.stage.get("reading") == "latched" and safety)
    .then(speak("reading")).expect(s.refused == Set("reading") and s.refusal == MediaNotStopped and
      s.stage.get("reading") == "latched" and safety)
    .then(speak("app")).expect(s.stage.get("app") == "playing" and safety)
  // App speech after an unconfirmed cleanup: one native stop, and only its confirmation plays.
  run confirmedStopReopensAppSpeechTest = init.then(speak("app")).then(finishPlayback("app"))
    .then(cleanupSettled("app", false)).expect(s.stage.get("app") == "latched" and safety)
    .then(speak("app")).expect(s.stage.get("app") == "recovering" and s.refused == Set() and safety)
    .then(recoveryStopSettled("app", true)).expect(s.stage.get("app") == "playing" and safety)
  run refusedStopAsksForRestartTest = init.then(speak("cloud")).then(finishPlayback("cloud"))
    .then(cleanupSettled("cloud", false)).then(speak("cloud")).then(recoveryStopSettled("cloud", false))
    .expect(s.stage.get("cloud") == "latched" and s.refused == Set("cloud") and s.refusal == RestartNeeded and safety)
  run latchedEntryNamesCleanupTest = init.then(enterVoice).then(speak("voice")).then(finishPlayback("voice"))
    .then(cleanupSettled("voice", false)).then(enterVoice)
    .expect(s.recorderOpen and s.entryLatched and s.entryMessage == MediaNotStopped and safety)
  run busyRecorderMessageTest = init.then(enterVoice).then(enterVoice)
    .expect(s.entryMessage == "finish-or-discard" and not(s.entryLatched) and safety)
  run waitingSuccessorRejectedTest = init.then(speak("reading")).then(speak("reading")).then(cleanupSettled("reading", false))
    .expect(s.stage.get("reading") == "latched" and s.waiting == Set() and s.refused == Set("reading") and safety)
  run waitingAppSuccessorStopsOnceTest = init.then(speak("cloud")).then(speak("cloud")).then(cleanupSettled("cloud", false))
    .expect(s.stage.get("cloud") == "recovering" and s.waiting == Set() and s.refused == Set() and safety)
  run restartOpensChainsTest = init.then(speak("app")).then(finishPlayback("app")).then(cleanupSettled("app", false))
    .then(restart).then(speak("app")).expect(s.stage.get("app") == "playing" and s.refused == Set() and safety)
}
