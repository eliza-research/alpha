/// Product note start/resume admission across permission, call and lifecycle callbacks.
module NativeNotePermission {
  type State = {
    foreground: bool, closed: bool, inCall: bool, permission: str,
    permissionPending: bool, queued: str, recording: str, outcome: str, starts: int,
    lastForeground: bool, lastClosed: bool, lastCall: bool, lastAccepted: bool, lastStarts: int
  }
  var s: State
  action init = s' = {foreground: true, closed: false, inCall: false, permission: "granted",
    permissionPending: false, queued: "none", recording: "idle", outcome: "none", starts: 0,
    lastForeground: false, lastClosed: false, lastCall: false, lastAccepted: false, lastStarts: 0}
  action setPermission(value: str): bool = all {value.in(Set("granted", "prompt", "denied")), s' = {...s, permission: value}}
  action setCall(value: bool): bool = s' = {...s, inCall: value}
  action pauseHost = s' = {...s, foreground: false}
  action resumeHost = s' = {...s, foreground: true}
  action closeHost = s' = {...s, closed: true}
  action requestStart = all {
    s.queued == "none", not(s.permissionPending),
    s' = if (s.inCall) {...s, outcome: "call"}
      else if (s.permission != "granted") {...s, permissionPending: true, outcome: "pending"}
      else {...s, queued: "start", outcome: "pending"}
  }
  action permissionReply(granted: bool): bool = all {
    s.permissionPending,
    s' = {...s, permissionPending: false, permission: if (granted) "granted" else "denied",
      queued: if (granted) "start" else "none", outcome: if (granted) "pending" else "permission"}
  }
  action requestResume = all {
    s.queued == "none", not(s.permissionPending),
    s' = if (s.inCall) {...s, outcome: "call"} else {...s, queued: "resume", outcome: "pending"}
  }
  action runQueued(openOk: bool): bool = all {
    s.queued != "none", s.starts < 2,
    val live = s.foreground and not(s.closed)
    val available = if (s.queued == "start") s.recording == "idle" else s.recording != "idle"
    val accepted = live and not(s.inCall) and available and openOk
    s' = {...s, queued: "none", lastForeground: s.foreground, lastClosed: s.closed, lastCall: s.inCall,
      lastAccepted: accepted, lastStarts: s.starts,
      starts: s.starts + (if (accepted and s.recording.in(Set("idle", "stopped"))) 1 else 0),
      recording: if (accepted) "recording" else s.recording,
      outcome: if (not(live)) "cancelled" else if (s.inCall) "call" else if (not(available and openOk)) "error" else "recording"}
  }
  action pauseRecording = all {
    s.queued == "none", s.recording != "idle",
    s' = {...s, recording: if (s.recording == "recording") "paused" else s.recording,
      outcome: if (s.recording == "recording") "paused" else s.recording}
  }
  action stopRecording = all {
    s.queued == "none", s.recording != "idle", s' = {...s, recording: "stopped", outcome: "stopped"}
  }
  action discardRecording = all {
    s.queued == "none", s.recording != "idle", s' = {...s, recording: "idle", outcome: "idle"}
  }
  action step = any {
    setPermission("granted"), setPermission("prompt"), setPermission("denied"), setCall(true), setCall(false),
    pauseHost, resumeHost, closeHost, requestStart, permissionReply(true), permissionReply(false),
    requestResume, runQueued(true), runQueued(false), pauseRecording, stopRecording, discardRecording, s' = s
  }
  val AcceptedOnlyWhileLive = s.lastAccepted implies s.lastForeground and not(s.lastClosed or s.lastCall)
  val RefusalDoesNotStartCapture = not(s.lastAccepted) implies s.starts == s.lastStarts
  val OnePendingRequest = s.permissionPending implies s.queued == "none"
  val Bounded = s.starts.in(0.to(2)) and s.queued.in(Set("none", "start", "resume"))
  val safety = AcceptedOnlyWhileLive and RefusalDoesNotStartCapture and OnePendingRequest and Bounded
  run permissionReturningDuringCallTest = init.then(setPermission("prompt")).then(requestStart)
    .then(setCall(true)).then(permissionReply(true)).then(runQueued(true))
    .expect(safety and s.starts == 0 and s.outcome == "call")
  run retiredResumeCannotOpenMicrophoneTest = init.then(requestStart).then(runQueued(true)).then(pauseRecording)
    .then(pauseHost).then(closeHost).then(requestResume).then(runQueued(true))
    .expect(safety and s.recording == "paused" and s.outcome == "cancelled")
  run queuedStartRetiredTest = init.then(requestStart).then(pauseHost).then(runQueued(true))
    .expect(safety and s.recording == "idle")
  run explicitResumeWhileLiveTest = init.then(requestStart).then(runQueued(true)).then(pauseRecording)
    .then(requestResume).then(runQueued(true)).expect(safety and s.recording == "recording")
  run deniedPermissionKeepsCaptureClosedTest = init.then(setPermission("prompt")).then(requestStart)
    .then(permissionReply(false)).expect(safety and s.starts == 0 and s.outcome == "permission")
}
