/// Segmented AlphaNoteRecorder resource, journal and restart state.
module NativeNoteRecording {
  type State = {
    phase: str, id: int, owner: int, folder: int, capture: int, issued: int,
    now: int, startedAt: int, pausedAt: int, pausedTotal: int,
    durations: List[int], texts: int -> int, diskDurations: List[int], diskTexts: int -> int,
    disk: bool, journalValid: bool, missingSegment: bool, currentFile: bool, nextFile: bool, timer: bool,
    recovered: bool, reason: str, joined: bool, recoveryBlocked: bool
  }
  var s: State
  pure def max(left: int, right: int): int = if (left > right) left else right
  pure def currentMs(st: State): int = if (st.capture == 0) 0 else
    max(0, st.now - st.startedAt - st.pausedTotal - (if (st.pausedAt > 0) st.now - st.pausedAt else 0))
  val cursor = s.durations.length()
  val durationMs = s.durations.foldl(0, (total, duration) => total + duration) + currentMs(s)
  action init = s' = {
    phase: "idle", id: 0, owner: 0, folder: 0, capture: 0, issued: 0,
    now: 100, startedAt: 0, pausedAt: 0, pausedTotal: 0,
    durations: [], texts: Map(), diskDurations: [], diskTexts: Map(),
    disk: false, journalValid: true, missingSegment: false, currentFile: false, nextFile: false, timer: false,
    recovered: false, reason: "none", joined: false, recoveryBlocked: false
  }
  action start(id: int, owner: int, folder: int, journalOk: bool, openOk: bool): bool = all {
    s.id == 0, not(s.recoveryBlocked), id.in(Set(1, 2)), owner.in(Set(1, 2)), folder.in(0.to(2)), s.issued < 4,
    s' = if (journalOk and openOk) { ...s, phase: "recording", id: id, owner: owner, folder: folder,
      capture: s.issued + 1, issued: s.issued + 1, startedAt: s.now, pausedAt: 0, pausedTotal: 0,
      durations: [], texts: Map(), diskDurations: [], diskTexts: Map(), disk: true, journalValid: true, missingSegment: false,
      currentFile: true, nextFile: false, timer: true, recovered: false, reason: "none", joined: false }
      else { ...s, issued: if (journalOk) s.issued + 1 else s.issued }
  }
  action advance(delta: int): bool = all {
    delta.in(Set(1000, 5000, 22000, 27000)), s.now + delta <= 108100,
    s' = { ...s, now: s.now + delta }
  }
  action pause(id: int): bool = all {
    id == s.id, id != 0,
    s' = if (s.phase == "recording" and s.capture != 0)
      { ...s, phase: "paused", pausedAt: s.now, timer: false } else s
  }
  action resume(id: int, success: bool): bool = all {
    id == s.id, id != 0,
    not(s.phase.in(Set("paused", "stopped"))) or s.capture != 0 or s.issued < 4,
    s' = if (not(s.phase.in(Set("paused", "stopped")))) s
      else if (not(success)) { ...s, issued: if (s.capture == 0) s.issued + 1 else s.issued }
      else if (s.capture != 0) { ...s, phase: "recording", pausedTotal: s.pausedTotal + s.now - s.pausedAt,
        pausedAt: 0, timer: true, recovered: false, reason: "none" }
      else { ...s, phase: "recording", capture: s.issued + 1, issued: s.issued + 1,
        startedAt: s.now, pausedAt: 0, pausedTotal: 0, currentFile: true,
        timer: true, nextFile: false, recovered: false, reason: "none" }
  }
  action stop(id: int, keep: bool, journalOk: bool): bool = all {
    id == s.id, id != 0, s.capture == 0 or s.durations.length() < 2,
    val durations = if (s.capture != 0 and keep) s.durations.append(max(1, currentMs(s))) else s.durations
    s' = { ...s, phase: "stopped", capture: 0, durations: durations,
      diskDurations: if (s.capture != 0 and journalOk) durations else s.diskDurations,
      diskTexts: if (s.capture != 0 and journalOk) s.texts else s.diskTexts,
      journalValid: if (s.capture != 0 and journalOk) true else s.journalValid,
      currentFile: false, nextFile: false, timer: false, pausedAt: 0, pausedTotal: 0,
      reason: if (s.reason == "none") "user" else s.reason }
  }
  action rollover(keep: bool, journalOk: bool, openOk: bool): bool = all {
    s.capture != 0, s.phase == "recording", s.durations.length() < 2, s.issued < 4,
    currentMs(s) >= 26500,
    val durations = if (keep) s.durations.append(max(1, currentMs(s))) else s.durations
    s' = { ...s, durations: durations,
      diskDurations: if (journalOk) durations else s.diskDurations,
      diskTexts: if (journalOk) s.texts else s.diskTexts, journalValid: if (journalOk) true else s.journalValid,
      phase: if (openOk) "recording" else "stopped", issued: s.issued + 1,
      capture: if (openOk) s.issued + 1 else 0, startedAt: if (openOk) s.now else s.startedAt,
      currentFile: openOk, nextFile: false, timer: openOk, pausedAt: 0, pausedTotal: 0,
      reason: if (openOk) s.reason else "error" }
  }
  action prepareNext(ticket: int): bool =
    if (ticket == s.capture and ticket != 0) s' = { ...s, nextFile: true } else s' = s
  action nextStarted(ticket: int, journalOk: bool): bool = all {
    ticket != s.capture or ticket == 0 or (s.nextFile and s.durations.length() < 2),
    if (ticket == s.capture and ticket != 0) all {
      val durations = s.durations.append(max(1, s.now - s.startedAt - s.pausedTotal))
      s' = { ...s, durations: durations, startedAt: s.now, pausedTotal: 0,
        diskDurations: if (journalOk) durations else s.diskDurations,
        diskTexts: if (journalOk) s.texts else s.diskTexts, journalValid: if (journalOk) true else s.journalValid,
        phase: if (journalOk) s.phase else "stopped", capture: if (journalOk) s.capture else 0,
        currentFile: journalOk, nextFile: false, timer: journalOk and s.phase == "recording",
        pausedAt: if (journalOk) s.pausedAt else 0, reason: if (journalOk) s.reason else "error" }
    } else s' = s
  }
  action captureError(ticket: int): bool =
    if (ticket == s.capture and ticket != 0) s' = { ...s, phase: "stopped", capture: 0,
      currentFile: false, nextFile: false, timer: false, pausedAt: 0, pausedTotal: 0, reason: "error" }
    else s' = s
  action setText(id: int, index: int, text: int, persisted: bool): bool = all {
    id == s.id, id != 0, index >= 0, index < s.durations.length(), text.in(Set(1, 2)),
    val texts = s.texts.put(index, text)
    s' = { ...s, texts: texts, diskDurations: if (persisted) s.durations else s.diskDurations,
      diskTexts: if (persisted) texts else s.diskTexts, journalValid: if (persisted) true else s.journalValid }
  }
  action restart = if (s.disk and s.journalValid and not(s.missingSegment) and s.diskDurations.length() > 0)
    s' = { ...s, phase: "paused", capture: 0, durations: s.diskDurations, texts: s.diskTexts,
      currentFile: false, nextFile: false, timer: false, pausedAt: 0, pausedTotal: 0,
      recovered: true, reason: "none", startedAt: 0 }
    else s' = { ...s, phase: "idle", id: 0, owner: 0, folder: 0, capture: 0,
      durations: [], texts: Map(), diskDurations: [], diskTexts: Map(), disk: false, journalValid: true, missingSegment: false,
      currentFile: false, nextFile: false, timer: false, recovered: false,
      startedAt: 0, pausedAt: 0, pausedTotal: 0, reason: "none", joined: false,
      recoveryBlocked: s.disk and (s.currentFile or s.diskDurations.length() > 0 or not(s.journalValid) or s.missingSegment) }
  action corruptJournal = all {
    s.disk, s' = { ...s, journalValid: false, missingSegment: false, diskDurations: [], diskTexts: Map() }
  }
  action loseSegment = all {
    s.diskDurations.length() > 0, s' = { ...s, missingSegment: true }
  }
  action legacyRestart = all {
    s.disk, s.journalValid, not(s.missingSegment), s.diskDurations.length() > 0,
    s' = { ...s, phase: "paused", owner: 0, folder: 0, capture: 0, durations: s.diskDurations,
      texts: s.diskTexts, currentFile: false, nextFile: false, timer: false,
      pausedAt: 0, pausedTotal: 0, startedAt: 0, recovered: true, reason: "none" }
  }
  action stopForStorage(keep: bool, journalOk: bool): bool = all {
    s.capture != 0, s.durations.length() < 2,
    val durations = if (keep) s.durations.append(max(1, currentMs(s))) else s.durations
    s' = { ...s, phase: "stopped", capture: 0, durations: durations,
      diskDurations: if (journalOk) durations else s.diskDurations,
      diskTexts: if (journalOk) s.texts else s.diskTexts, journalValid: if (journalOk) true else s.journalValid,
      currentFile: false, nextFile: false, timer: false, pausedAt: 0, pausedTotal: 0, reason: "storage" }
  }
  action discard = s' = { ...s, phase: "idle", id: 0, owner: 0, folder: 0, capture: 0,
    durations: [], texts: Map(), diskDurations: [], diskTexts: Map(), disk: false, journalValid: true, missingSegment: false,
    currentFile: false, nextFile: false, timer: false, recovered: false,
    pausedAt: 0, pausedTotal: 0, reason: "none", joined: false }
  action join(id: int, success: bool): bool = all {
    id == s.id, id != 0, s.capture == 0, s.durations.length() > 0,
    s' = { ...s, joined: success }
  }
  action step = any {
    start(1, 1, 1, true, true), start(2, 2, 0, true, true), start(1, 1, 1, false, true), start(1, 1, 1, true, false),
    advance(1000), advance(5000), advance(22000), advance(27000), pause(1), pause(2),
    resume(1, true), resume(2, true), resume(1, false), resume(2, false),
    stop(1, true, true), stop(2, true, true), stop(1, false, true), stop(1, true, false),
    rollover(true, true, true), rollover(true, false, true), rollover(true, true, false),
    prepareNext(1), prepareNext(2), prepareNext(3), nextStarted(1, true), nextStarted(2, true), nextStarted(1, false),
    captureError(1), captureError(2), captureError(3), setText(1, 0, 1, true), setText(2, 0, 1, true), setText(1, 0, 1, false),
    restart, corruptJournal, loseSegment, legacyRestart, stopForStorage(true, true), discard, join(1, true), join(2, true), join(1, false), s' = s
  }
  val Bounded = s.id.in(0.to(2)) and s.capture.in(0.to(4)) and s.issued.in(0.to(4)) and
    s.durations.length() <= 2 and s.diskDurations.length() <= 2 and s.now.in(100.to(108100))
  val ResourceOwnership = s.capture != 0 implies s.id != 0 and s.currentFile and s.phase.in(Set("recording", "paused"))
  val RecordingHasCapture = s.phase == "recording" implies s.capture != 0
  val IdleHasNoRecording = s.id == 0 implies s.phase == "idle" and s.capture == 0 and not(s.disk)
  val TimerHasActiveCapture = s.timer implies s.phase == "recording" and s.capture != 0
  val DurablePrefix = s.diskDurations.length() <= s.durations.length() and
    s.diskDurations == s.durations.slice(0, s.diskDurations.length())
  val TranscriptBounds = s.texts.keys().forall(index => index >= 0 and index < s.durations.length()) and
    s.diskTexts.keys().forall(index => index >= 0 and index < s.diskDurations.length())
  val RecoveryBlocksCapture = s.recoveryBlocked implies s.id == 0 and s.capture == 0
  val safety = RecoveryBlocksCapture and Bounded and ResourceOwnership and RecordingHasCapture and IdleHasNoRecording and TimerHasActiveCapture and DurablePrefix and TranscriptBounds
  run pauseAccountingTest = init.then(start(1, 1, 1, true, true)).then(advance(5000)).then(pause(1))
    .then(advance(5000)).expect(durationMs == 5000).then(resume(1, true)).then(advance(1000))
    .expect(safety and durationMs == 6000)
  run durableSegmentsSurviveRestartTest = init.then(start(1, 1, 1, true, true)).then(advance(27000))
    .then(rollover(true, true, true)).then(setText(1, 0, 1, true)).then(restart)
    .expect(safety and s.recovered and s.phase == "paused" and s.texts == Map((0, 1)) and s.capture == 0)
  run failedJournalLosesOnlyUncommittedSuffixTest = init.then(start(1, 1, 1, true, true)).then(advance(27000))
    .then(rollover(true, false, true)).then(restart).expect(safety and s.id == 0)
  run lateRecorderCallbackCannotStopReplacementTest = init.then(start(1, 1, 1, true, true)).then(discard)
    .then(start(2, 2, 0, true, true)).then(captureError(1)).expect(safety and s.phase == "recording" and s.capture == 2)
  run failedTranscriptWriteRetainsVolatileTextTest = init.then(start(1, 1, 1, true, true)).then(advance(1000))
    .then(stop(1, true, true)).then(setText(1, 0, 1, false)).expect(s.texts == Map((0, 1)) and s.diskTexts == Map())
    .then(restart).expect(safety and s.texts == Map())
  run failedJoinKeepsSegmentsTest = init.then(start(1, 1, 1, true, true)).then(advance(1000))
    .then(stop(1, true, true)).then(join(1, false)).expect(safety and not(s.joined) and s.durations.length() == 1)
  run corruptJournalCannotRecoverTest = init.then(start(1, 1, 1, true, true)).then(advance(1000))
    .then(stop(1, true, true)).then(corruptJournal).then(restart).expect(safety and s.id == 0 and s.recoveryBlocked)
  run missingAudioCannotRecoverTest = init.then(start(1, 1, 1, true, true)).then(advance(1000))
    .then(stop(1, true, true)).then(loseSegment).then(restart).expect(safety and s.id == 0 and s.recoveryBlocked)
  run legacyAudioRetainsNoOwnerTest = init.then(start(1, 1, 1, true, true)).then(advance(1000))
    .then(stop(1, true, true)).then(legacyRestart).expect(safety and s.owner == 0 and s.recovered)

}
