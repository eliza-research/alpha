/// The agent's one Camera operation, `camera_capture_photo`, as the current camera adapter runs
/// it (`takeRequestedPhoto`). The request needs the visible Camera view, closes the chat so the
/// owner sees the viewfinder, waits for the preview if it is still starting, checks everything
/// again right before the shutter, and reports `unknown` only after the shutter fired.
/// Admission of the proposal (direct or reviewed, journal, claim) is DeviceActionReview.
module CameraAgentCapture {
  type State = {
    view: str, sensitive: bool, hidden: bool, chat: str, phase: str, recording: bool,
    request: str, holds: int, current: bool, aborted: bool, ownerReopenedChat: bool,
    shutters: int, saved: bool, outcome: str,
    // facts frozen when the shutter fires
    shotVisible: bool, shotReady: bool, shotCovered: bool, shotCurrent: bool}
  var s: State
  action init = s' = {view: "camera", sensitive: false, hidden: false, chat: "sheet", phase: "off",
    recording: false, request: "none", holds: 0, current: true, aborted: false, ownerReopenedChat: false,
    shutters: 0, saved: false, outcome: "none",
    shotVisible: true, shotReady: true, shotCovered: false, shotCurrent: true}
  val visible = s.view == "camera" and not(s.hidden)
  val covered = s.chat != "hidden"
  /// The executor's own guard: same context, Camera in front, not a protected screen.
  val admitted = s.current and not(s.aborted) and visible and not(s.sensitive)
  val settled = s.outcome != "none"
  action place(view: str, chat: str, phase: str, recording: bool): bool = all {s.request == "none",
    view.in(Set("camera", "home")), chat.in(Set("hidden", "sheet", "full")),
    phase.in(Set("off", "starting", "ready", "failed")), recording implies phase == "ready",
    s' = {...s, view: view, chat: chat, phase: phase, recording: recording, outcome: "none",
      shutters: 0, saved: false, ownerReopenedChat: false, current: true, aborted: false}}
  /// Refusals that touch nothing.
  action refuse(reason: str): bool = all {s.request == "none", not(settled),
    reason.in(Set("changed", "closed", "busy")),
    if (reason == "changed") not(s.current) or s.aborted or s.sensitive or s.hidden
    else if (reason == "closed") s.view != "camera"
    else s.recording,
    s' = {...s, outcome: "failed"}}
  /// Admission closes the chat and takes the preview hold; a preview that is not ready is awaited.
  action admit = all {s.request == "none", not(settled), admitted, not(s.recording),
    s' = {...s, chat: "hidden", holds: s.holds + 1,
      request: if (s.phase == "ready") "armed" else "queued",
      phase: if (s.phase.in(Set("off", "failed"))) "starting" else s.phase}}
  action previewReady = all {s.phase == "starting", s' = {...s, phase: "ready",
    request: if (s.request == "queued") "armed" else s.request}}
  action previewFails = all {s.phase == "starting", s' = {...s, phase: "failed",
    request: if (s.request == "queued") "armed" else s.request}}
  /// While the request waits, the owner or the shell may change anything.
  action ownerReopensChat = all {s.request != "none", s' = {...s, chat: "sheet", ownerReopenedChat: true}}
  action ownerLeaves = s' = {...s, view: "home", current: false,
    phase: if (s.holds > 0) s.phase else "off"}
  action contextChanges = s' = {...s, current: false}
  action abort = s' = {...s, aborted: true}
  action becomeHidden = s' = {...s, hidden: true}
  /// The second check, right before the shutter.
  action recheckFails = all {s.request == "armed",
    not(admitted) or s.phase != "ready",
    s' = {...s, request: "none", holds: s.holds - 1, outcome: "failed"}}
  action shutter = all {s.request == "armed", admitted, s.phase == "ready", s.shutters == 0,
    s' = {...s, request: "writing", shutters: 1,
      shotVisible: visible, shotReady: s.phase == "ready", shotCovered: covered, shotCurrent: s.current}}
  /// A saved photo with its identity is success; a write without one, or a thrown write, is unknown.
  action written(result: str): bool = all {s.request == "writing",
    result.in(Set("succeeded", "unknown")),
    s' = {...s, request: "none", holds: s.holds - 1, saved: result == "succeeded", outcome: result}}
  action step = any {
    place("camera", "sheet", "off", false), place("camera", "hidden", "ready", false),
    place("camera", "full", "starting", false), place("camera", "hidden", "ready", true),
    place("home", "sheet", "off", false), place("camera", "sheet", "failed", false),
    refuse("changed"), refuse("closed"), refuse("busy"), admit, previewReady, previewFails,
    ownerReopensChat, ownerLeaves, contextChanges, abort, becomeHidden,
    recheckFails, shutter, written("succeeded"), written("unknown")}

  val CaptureNeedsVisibleCamera = s.shutters == 1 implies (s.shotVisible and s.shotReady and s.shotCurrent)
  /// The request itself uncovers the viewfinder before it waits or fires.
  val RequestUncoversViewfinder = (s.request != "none" and not(s.ownerReopenedChat)) implies not(covered)
  val ShutterUncoveredUnlessOwnerReopened = (s.shutters == 1 and s.shotCovered) implies s.ownerReopenedChat
  val AtMostOneShutter = s.shutters <= 1
  val UncertainCaptureNeverRepeats = s.outcome == "unknown" implies (s.shutters == 1 and s.request == "none")
  val UnknownOnlyAfterShutter = s.outcome == "unknown" implies s.shutters == 1
  val FailedMeansNoShutter = s.outcome == "failed" implies s.shutters == 0
  val SuccessMeansSavedPhoto = s.outcome == "succeeded" implies (s.saved and s.shutters == 1)
  val HoldReleased = (s.request == "none") implies s.holds == 0
  val NoCaptureWhileRecording = s.shutters == 1 implies not(s.recording)
  val safety = CaptureNeedsVisibleCamera and RequestUncoversViewfinder and
    ShutterUncoveredUnlessOwnerReopened and AtMostOneShutter and UncertainCaptureNeverRepeats and
    UnknownOnlyAfterShutter and FailedMeansNoShutter and SuccessMeansSavedPhoto and HoldReleased and
    NoCaptureWhileRecording

  /// RESIDUAL GAP, registered as an expected violation: the request closes the chat once. If the
  /// owner opens it again while the preview is still starting, the preview hold keeps the camera
  /// active and the shutter still fires behind the chat. Found by reading `takeRequestedPhoto`
  /// and `active()`; not reproduced on a device.
  val ShutterNeverCovered = s.shutters == 1 implies not(s.shotCovered)
  val CoveredShutter = s.shutters == 1 and s.shotCovered
  /// Every admitted request settles once the preview settles (checked as scenarios, not liveness).
  val Waiting = s.request == "queued"

  run readyCaptureTest = init.then(place("camera", "sheet", "ready", false)).then(admit)
    .expect(safety and s.chat == "hidden" and s.request == "armed").then(shutter)
    .then(written("succeeded")).expect(safety and s.outcome == "succeeded" and s.holds == 0)
  run queuedCaptureSettlesTest = init.then(admit).expect(safety and Waiting and s.phase == "starting")
    .then(previewReady).then(shutter).then(written("succeeded"))
    .expect(safety and s.outcome == "succeeded" and not(s.shotCovered))
  run startFailureSettlesTest = init.then(admit).then(previewFails).then(recheckFails)
    .expect(safety and s.outcome == "failed" and s.shutters == 0 and s.holds == 0)
  run cameraNotOpenTest = init.then(place("home", "sheet", "off", false)).then(refuse("closed"))
    .expect(safety and s.outcome == "failed" and s.shutters == 0 and s.chat == "sheet")
  run recordingRefusesTest = init.then(place("camera", "hidden", "ready", true)).then(refuse("busy"))
    .expect(safety and s.outcome == "failed" and s.shutters == 0)
  run leaveWhileQueuedTest = init.then(admit).then(ownerLeaves).then(previewReady).then(recheckFails)
    .expect(safety and s.outcome == "failed" and s.shutters == 0)
  run unconfirmedSaveTest = init.then(place("camera", "hidden", "ready", false)).then(admit).then(shutter)
    .then(written("unknown")).expect(safety and s.outcome == "unknown" and s.shutters == 1)
  run reopenedChatCoversShutterTest = init.then(admit).then(ownerReopensChat).then(previewReady)
    .then(shutter).expect(safety and CoveredShutter and not(ShutterNeverCovered))
}
