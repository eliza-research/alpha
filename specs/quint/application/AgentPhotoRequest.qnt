/// A photo the assistant asks Camera to take. The request waits for a preview that is still
/// starting, is refused when a recording starts first, takes the shutter exclusively, and
/// reports failed only when nothing was dispatched.
module AgentPhotoRequest {
  type State = {
    view: bool, phase: str, busyBy: str, request: str, refused: bool, aborted: bool,
    result: str, dispatched: bool, agentRows: int, rowsAtRequest: int, holds: int, startsByAgent: int
  }
  var s: State
  action init = s' = {
    view: true, phase: "off", busyBy: "none", request: "none", refused: false, aborted: false,
    result: "none", dispatched: false, agentRows: 0, rowsAtRequest: 0, holds: 0, startsByAgent: 0
  }
  pure def finished(v: State, result: str): State =
    { ...v, request: "none", refused: false, aborted: false, result: result, holds: v.holds - 1,
      busyBy: if (v.busyBy == "agent") "none" else v.busyBy }
  /// The view starts its preview, or the owner retries after an error.
  action startPreview = all { s.view, s.phase == "off" or s.phase == "error", s' = { ...s, phase: "starting" } }
  action startSettles(ok: bool): bool = all { s.phase == "starting",
    s' = { ...s, phase: if (ok) "ready" else "error" } }
  action leaveView = all { s.view, s.busyBy != "agent",
    s' = { ...s, view: false, phase: "off", busyBy: "none" } }
  action enterView = all { not(s.view), s' = { ...s, view: true } }
  /// A recording that starts while a request is still queued refuses that request.
  action recordingStarts = all { s.phase == "ready", s.busyBy == "none",
    s' = { ...s, busyBy: "recording", refused: s.request == "queued" } }
  action ownerShutter = all { s.phase == "ready", s.busyBy == "none", s' = { ...s, busyBy: "owner" } }
  action cameraIdle = all { s.busyBy == "recording" or s.busyBy == "owner", s' = { ...s, busyBy: "none" } }
  /// The assistant asks. A hidden Camera, an earlier request or a busy camera fails at once.
  /// Over a ready preview the shutter follows without a pause; otherwise the request queues and
  /// starts the preview unless a start is already in flight.
  action agentAsks = all { s.request == "none", s.agentRows < 3,
    val asked = { ...s, result: "none", dispatched: false, rowsAtRequest: s.agentRows, refused: false, aborted: false }
    s' = if (not(s.view) or s.busyBy != "none") { ...asked, result: "failed" }
      else if (s.phase == "ready") { ...asked, request: "dispatched", dispatched: true, busyBy: "agent", holds: s.holds + 1 }
      else { ...asked, request: "queued", holds: s.holds + 1,
        phase: "starting", startsByAgent: if (s.phase == "starting") s.startsByAgent else s.startsByAgent + 1 }
  }
  /// The conversation or screen the request came from changed.
  action requestChanges = all { s.request == "queued", s' = { ...s, aborted: true } }
  /// The start settled: the queued request is checked again right before the shutter.
  action agentResumes = all { s.request == "queued", s.phase != "starting",
    s' = if (s.aborted or s.refused or not(s.view) or s.phase != "ready" or s.busyBy != "none") finished(s, "failed")
      else { ...s, request: "dispatched", dispatched: true, busyBy: "agent" }
  }
  /// The shutter settles: a saved photo with its identity, a saved photo without one, or an error.
  action shutterSettles(outcome: str, written: bool): bool = all { s.request == "dispatched",
    Set("saved", "unidentified", "threw").contains(outcome),
    s' = if (outcome == "saved") finished({ ...s, agentRows: s.agentRows + 1 }, "succeeded")
      else if (outcome == "unidentified") finished({ ...s, agentRows: s.agentRows + 1 }, "unknown")
      else finished({ ...s, agentRows: if (written) s.agentRows + 1 else s.agentRows }, "unknown")
  }
  action step = {
    nondet flag = Bool.oneOf()
    nondet outcome = Set("saved", "unidentified", "threw").oneOf()
    any { startPreview, startSettles(flag), leaveView, enterView, recordingStarts, ownerShutter, cameraIdle,
      agentAsks, requestChanges, agentResumes, shutterSettles(outcome, flag), s' = s }
  }
  val FailedImpliesNoRow = s.result == "failed" implies (s.agentRows == s.rowsAtRequest and not(s.dispatched))
  val SucceededImpliesOneRow = s.result == "succeeded" implies s.agentRows == s.rowsAtRequest + 1
  val UnknownOnlyAfterDispatch = s.result == "unknown" implies s.dispatched
  val QueuedRequestWaitsForStart = (s.request == "queued" and s.phase == "starting") implies s.result == "none"
  val OneAgentRequest = s.holds == (if (s.request == "none") 0 else 1)
  val DispatchHoldsCamera = (s.request == "dispatched") == (s.busyBy == "agent")
  val RefusalBelongsToQueuedRequest = s.refused implies s.request == "queued"
  val safety = FailedImpliesNoRow and SucceededImpliesOneRow and UnknownOnlyAfterDispatch
    and QueuedRequestWaitsForStart and OneAgentRequest and DispatchHoldsCamera and RefusalBelongsToQueuedRequest
  val AgentWaitsForStartWitness = s.request == "queued" and s.phase == "starting" and s.startsByAgent == 0
  val RecordingRefusedWitness = s.refused and s.busyBy == "recording"
  val AgentPhotoWitness = s.result == "succeeded" and s.agentRows == 2
  val UnknownWithoutRowWitness = s.result == "unknown" and s.agentRows == s.rowsAtRequest
  /// The assistant asks while the preview is still starting: the photo waits for that start.
  run agentJoinsStartingPreviewTest = init.then(startPreview).then(agentAsks)
    .expect(s.request == "queued" and s.phase == "starting" and s.startsByAgent == 0 and s.result == "none" and safety)
    .then(startSettles(true)).then(agentResumes).then(shutterSettles("saved", true))
    .expect(s.result == "succeeded" and s.agentRows == 1 and s.holds == 0 and s.busyBy == "none" and safety)
  run agentStartsStoppedPreviewTest = init.then(agentAsks)
    .expect(s.phase == "starting" and s.startsByAgent == 1 and safety)
    .then(startSettles(false)).then(agentResumes)
    .expect(s.result == "failed" and s.agentRows == 0 and not(s.dispatched) and safety)
  run recordingBeforeResumeRefusesTest = init.then(startPreview).then(agentAsks).then(startSettles(true))
    .then(recordingStarts).expect(s.refused and safety).then(agentResumes)
    .expect(s.result == "failed" and not(s.dispatched) and s.busyBy == "recording" and safety)
  run busyCameraFailsAtOnceTest = init.then(startPreview).then(startSettles(true)).then(ownerShutter).then(agentAsks)
    .expect(s.result == "failed" and s.request == "none" and s.holds == 0 and safety)
    .then(cameraIdle).then(agentAsks).expect(s.request == "dispatched" and s.busyBy == "agent" and safety)
  run unconfirmedShutterIsUnknownTest = init.then(startPreview).then(startSettles(true)).then(agentAsks)
    .then(shutterSettles("threw", false))
    .expect(s.result == "unknown" and s.dispatched and s.agentRows == 0 and safety)
  run changedRequestTakesNoPhotoTest = init.then(agentAsks).then(requestChanges).then(startSettles(true))
    .then(agentResumes).expect(s.result == "failed" and not(s.dispatched) and s.phase == "ready" and safety)
}
