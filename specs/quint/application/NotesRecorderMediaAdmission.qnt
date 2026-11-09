// Fresh Notes microphone capture across the saved-audio retirement boundary.
module NotesRecorderMediaAdmission {
  type State = {view: str, owner: str, playback: str, recorder: str, attempts: int, active: int,
    drains: int, control: str, controlAttempt: int, captures: int, lastCapture: int, unconfirmedCapture: bool}
  var s: State

  action init = s' = {view: "home", owner: "A", playback: "idle", recorder: "closed", attempts: 0,
    active: 0, drains: 0, control: "idle", controlAttempt: 0, captures: 0, lastCapture: 0, unconfirmedCapture: false}
  action openNotes = all { s.view == "home", s' = {...s, view: "notes"} }
  action playSaved = all {
    s.view == "notes", s.recorder == "closed", s.playback == "idle", s.attempts == 0,
    s' = {...s, playback: "playing"},
  }
  action requestStop = all { s.playback == "playing", s' = {...s, playback: "stopping"} }
  action confirmStop = all { s.playback == "stopping", s' = {...s, playback: "stopped"} }
  action refuseStop = all { s.playback == "stopping", s' = {...s, playback: "unconfirmed"} }
  action start(entry: str): bool = all {
    s.view == "notes", s.recorder.in(Set("closed", "failed")), s.attempts < 2, s.captures == 0,
    entry == "button" or (entry == "control" and s.control == "idle"),
    val id = s.attempts + 1
    s' = {...s, recorder: "starting", attempts: id, active: id,
      control: if (entry == "control") "pending" else s.control,
      controlAttempt: if (entry == "control") id else s.controlAttempt},
  }
  action awaitDrain(id: int): bool = all {
    s.active == id, id > s.drains,
    s' = {...s, drains: id},
  }
  val drainConfirmed = s.playback.in(Set("idle", "stopped"))
  action capture(id: int): bool = all {
    s.view == "notes", s.active == id, s.drains == id, id > 0, drainConfirmed,
    s' = {...s, recorder: "recording", active: 0, captures: s.captures + 1, lastCapture: id,
      unconfirmedCapture: s.unconfirmedCapture or not(drainConfirmed),
      control: if (s.controlAttempt == id) "started" else s.control},
  }
  action refuseCapture(id: int): bool = all {
    s.active == id, s.drains == id, id > 0, s.playback == "unconfirmed",
    s' = {...s, recorder: "failed", active: 0, control: if (s.controlAttempt == id) "failed" else s.control},
  }
  action leaveNotes = all {
    s.view == "notes", s.recorder != "recording", s.playback != "playing",
    s' = {...s, view: "home", recorder: "closed", active: 0},
  }
  action replaceOwner = all {
    s.view == "notes", s.owner == "A", s.active > 0, s.drains == s.active,
    s' = {...s, owner: "B", recorder: "failed", active: 0},
  }
  action settleRetiredControl = all {
    s.control == "pending", s.controlAttempt != s.active, s.playback != "stopping",
    s' = {...s, control: "failed"},
  }
  action step = any {
    openNotes, playSaved, requestStop, confirmStop, refuseStop, start("button"), start("control"),
    leaveNotes, replaceOwner, settleRetiredControl,
    {nondet id = Set(1, 2).oneOf(); any {awaitDrain(id), capture(id), refuseCapture(id)}},
    s' = s,
  }

  val CaptureRequiresConfirmedDrain = not(s.unconfirmedCapture) and (s.recorder == "recording" implies drainConfirmed)
  val OnlyCurrentAttemptCaptures = (s.active != 0 iff s.recorder == "starting") and
    (s.active != 0 implies s.active == s.attempts and s.view == "notes") and
    (s.captures == 1 implies s.lastCapture == s.attempts and s.recorder == "recording")
  val ControlCannotClaimReplacement = s.control == "started" implies s.lastCapture == s.controlAttempt
  val safety = CaptureRequiresConfirmedDrain and OnlyCurrentAttemptCaptures and ControlCannotClaimReplacement

  run heldSavedAudioDelaysButtonTest = init.then(openNotes).then(playSaved).then(requestStop)
    .then(start("button")).then(awaitDrain(1)).expect(s.captures == 0 and safety)
    .then(confirmStop).then(capture(1)).expect(s.captures == 1 and safety)
  run heldSavedAudioDelaysControlTest = init.then(openNotes).then(playSaved).then(start("control"))
    .then(awaitDrain(1)).then(requestStop).expect(s.control == "pending" and safety)
    .then(confirmStop).then(capture(1)).expect(s.control == "started" and safety)
  run unconfirmedStopRefusesCaptureTest = init.then(openNotes).then(playSaved).then(requestStop)
    .then(start("control")).then(awaitDrain(1)).then(refuseStop).then(refuseCapture(1))
    .expect(s.control == "failed" and s.captures == 0 and safety)
  run retiredControlCannotClaimReentryTest = init.then(openNotes).then(playSaved).then(requestStop)
    .then(start("control")).then(awaitDrain(1)).then(leaveNotes).then(openNotes)
    .then(start("button")).then(awaitDrain(2)).then(confirmStop).then(settleRetiredControl)
    .then(capture(2)).expect(s.control == "failed" and s.lastCapture == 2 and safety)
  run replacedOwnerCannotCaptureTest = init.then(openNotes).then(playSaved).then(requestStop)
    .then(start("control")).then(awaitDrain(1)).then(replaceOwner).then(confirmStop)
    .then(settleRetiredControl).expect(s.owner == "B" and s.captures == 0 and safety)
}
