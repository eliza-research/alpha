/// Actual Notes recording foreground-service command and notification ownership.
module NativeNoteRecordingService {
  type State = {
    recording: int, phase: str, foreground: bool, owner: int,
    title: str, toggle: str, chronometer: bool, stopRequested: bool,
    priorForeground: bool, priorOwner: int, staleStop: bool
  }
  var s: State
  action init = s' = {
    recording: 0, phase: "idle", foreground: false, owner: 0,
    title: "none", toggle: "none", chronometer: false, stopRequested: false,
    priorForeground: false, priorOwner: 0, staleStop: false
  }
  action recordingStarts(id: int): bool = all {
    s.recording == 0, id.in(Set(1, 2)),
    s' = { ...s, recording: id, phase: "recording", staleStop: false }
  }
  action recordingCloses = s' = { ...s, recording: 0, phase: "idle", staleStop: false }
  action recordingStops = all {
    s.recording != 0, s' = { ...s, phase: "stopped", staleStop: false }
  }
  action recordingResumes = all {s.recording != 0, s' = { ...s, phase: "recording", staleStop: false }}
  action startService(ticket: int, accepted: bool): bool = all {
    ticket.in(Set(0, 1, 2)),
    val current = ticket != 0 and ticket == s.recording
    s' = if (s.foreground and not(current)) s else if (not(accepted)) { ...s, stopRequested: true, staleStop: false }
      else { ...s, foreground: current, owner: if (current) ticket else 0,
        title: if (s.phase == "paused") "Paused" else "Recording",
        toggle: if (s.phase == "paused") "Resume" else "Pause",
        chronometer: s.phase != "paused", stopRequested: not(current), staleStop: false }
  }
  action toggle(ticket: int, paused: bool): bool = all {
    ticket.in(Set(0, 1, 2)),
    val current = ticket != 0 and ticket == s.recording
    val changes = current and (if (paused) s.phase == "recording" else s.phase.in(Set("paused", "stopped")))
    val nextPhase = if (changes) (if (paused) "paused" else "recording") else s.phase
    val refresh = s.foreground and s.owner == s.recording and nextPhase.in(Set("recording", "paused"))
    s' = { ...s, phase: nextPhase,
      title: if (refresh) (if (nextPhase == "paused") "Paused" else "Recording") else s.title,
      toggle: if (refresh) (if (nextPhase == "paused") "Resume" else "Pause") else s.toggle,
      chronometer: if (refresh) nextPhase == "recording" else s.chronometer, staleStop: false }
  }
  action stopServiceWhen(ticket: int, admitted: bool): bool = if (not(admitted)) s' = s else all {
    ticket.in(Set(0, 1, 2)),
    val stale = s.phase.in(Set("recording", "paused")) or (ticket == 0 and s.recording != 0) or
      (s.foreground and ticket != 0 and ticket != s.owner) or
      (ticket != 0 and s.recording != 0 and ticket != s.recording)
    s' = { ...s, priorForeground: s.foreground, priorOwner: s.owner, staleStop: stale,
      foreground: if (stale) s.foreground else false,
      owner: if (stale) s.owner else 0,
      stopRequested: if (stale) s.stopRequested else true }
  }
  action stopService(ticket: int): bool = stopServiceWhen(ticket, true)
  /// Stop in the notification: the current recording is stopped and kept for Notes, then the
  /// service retires exactly as for a close command. A retired or blank ticket stops nothing.
  action finish(ticket: int): bool = all {
    ticket.in(Set(0, 1, 2)),
    val current = ticket != 0 and ticket == s.recording
    val nextPhase = if (current) "stopped" else s.phase
    val stale = nextPhase.in(Set("recording", "paused")) or (ticket == 0 and s.recording != 0) or
      (s.foreground and ticket != 0 and ticket != s.owner) or
      (ticket != 0 and s.recording != 0 and ticket != s.recording)
    s' = { ...s, phase: nextPhase, priorForeground: s.foreground, priorOwner: s.owner, staleStop: stale,
      foreground: if (stale) s.foreground else false,
      owner: if (stale) s.owner else 0,
      stopRequested: if (stale) s.stopRequested else true }
  }
  action destroy = s' = { ...s, foreground: false, owner: 0, staleStop: false }
  action step = any {
    recordingStarts(1), recordingStarts(2), recordingCloses, recordingStops, recordingResumes,
    startService(0, true), startService(1, true), startService(2, true), startService(1, false),
    toggle(1, true), toggle(1, false), toggle(2, true), toggle(2, false),
    stopService(0), stopService(1), stopService(2), stopServiceWhen(1, false),
    finish(0), finish(1), finish(2), destroy, s' = s
  }
  val ForegroundHasOwner = s.foreground implies s.owner.in(Set(1, 2))
  val StaleStopPreservesOwner = s.staleStop implies s.foreground == s.priorForeground and s.owner == s.priorOwner
  val Bounded = s.recording.in(0.to(2)) and s.owner.in(0.to(2)) and s.phase.in(Set("idle", "recording", "paused", "stopped"))
  val safety = ForegroundHasOwner and StaleStopPreservesOwner and Bounded
  run replacedRecordingRejectsOldStopTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(recordingCloses).then(recordingStarts(2)).then(startService(2, true)).then(stopService(1))
    .expect(safety and s.foreground and s.owner == 2)
  run blankStopCannotHideLiveRecordingTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(stopService(0)).expect(safety and s.foreground)
  run discardedRecordingAcceptsLegacyStopTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(recordingCloses).then(stopService(0)).expect(safety and not(s.foreground))
  run pausedNotificationCanResumeTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(toggle(1, true)).expect(s.title == "Paused" and not(s.chronometer))
    .then(toggle(1, false)).expect(safety and s.title == "Recording" and s.chronometer)
  run staleToggleCannotChangeNewRecordingTest = init.then(recordingStarts(2)).then(startService(2, true))
    .then(toggle(1, true)).expect(safety and s.phase == "recording")
  run staleStartPreservesCurrentOwnerTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(recordingCloses).then(recordingStarts(2)).then(startService(2, true)).then(startService(1, true))
    .expect(safety and s.foreground and s.owner == 2)

  run notificationStopKeepsRecordingForNotesTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(finish(1)).expect(safety and s.recording == 1 and s.phase == "stopped" and not(s.foreground))
  run staleNotificationStopCannotStopNewRecordingTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(recordingCloses).then(recordingStarts(2)).then(startService(2, true)).then(finish(1))
    .expect(safety and s.foreground and s.owner == 2 and s.phase == "recording")
  run pendingStartRejectsFallbackStopTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(recordingStops).then(stopServiceWhen(1, false)).expect(safety and s.foreground and not(s.stopRequested))
  run resumedRecordingRejectsLateCloseTest = init.then(recordingStarts(1)).then(startService(1, true))
    .then(recordingStops).then(recordingResumes).then(startService(1, true)).then(stopService(1))
    .expect(safety and s.foreground and s.phase == "recording")
}
