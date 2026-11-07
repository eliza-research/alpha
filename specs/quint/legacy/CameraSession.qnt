// Faithful translation of the view-refresh camera-session TLA+ model
// (design/view-refresh-2026-11/tla/camera-session/Spec.tla at 4cad393df4).
// Camera view: session lifecycle, capture and agent capture, and the chat sheet over Camera.
//
// Code modelled (repo root):
//  CA = apps/app/src/prototype/camera-adapter.ts
//  CP = vendor/eliza/plugins/plugin-native-camera/.../CameraPlugin.kt
// Proposal: design/view-refresh-2026-11/PLAN.md section 1.
//
// Fix* = false models the code as written; true models the proposed design. They are immutable
// fields of s chosen by the initializer: checkerInit is Design.cfg, checkerAsBuilt<X>Init turns
// off one fix each (AsBuilt_<X>.cfg), to reproduce that defect.
//
// Abstractions (unchanged from the TLA+ model):
//  - epoch counts sessions (CA `epoch`); it is bounded by MaxEpoch so the state space is finite.
//    That is a model bound, not product behaviour.
//  - media counts items committed to MediaStore. thumb is the count the last-capture tile
//    reflects; Photos lists exactly `media`.
//  - zoom has two values: "one" (valid on every lens) and "half" (ultra-wide, back lens only).
module CameraSession {
  type State = {
    // immutable configuration (TLA+ CONSTANTS)
    FixFocus: bool,      // tap-to-focus never blocks the shutter (CA:668,811)
    FixLeave: bool,      // leaving settles an in-flight photo (CP:372,518)
    FixLens: bool,       // flip resets settings first; flash hidden on front (CP:439, CA:807)
    FixAgentQueue: bool, // agent capture during start waits for ready (CA:593,702)
    FixChatGrace: bool,  // the chat sheet keeps the session bound for a grace period (PLAN item 7)
    // original state variables
    view: str,       // "away" | "camera"
    chat: str,       // "closed" | "open": the chat sheet covers Camera
    phase: str,      // "off" | "starting" | "ready" | "error"
    perm: str,       // "unknown" | "granted" | "denied"
    capture: str,    // "idle" | "photo" | "recording"
    focusBusy: bool,
    lens: str, flash: bool, zoom: str,
    agent: str,      // "none" | "queued" | "capturing" | "done" | "failed" | "cancelled" | "refused"
    epoch: int,
    inflight: Set[int], // epochs with a photo still being written natively
    media: int, thumb: int,
    dropped: bool,   // ghost: a shutter press was silently ignored
    flipFailed: bool // ghost: the native layer rejected a lens switch
  }
  type TransitionHistory = { AgentFailsOnlyForCause: bool, ChatKeepsPreview: bool }
  var s: State
  var history: TransitionHistory
  val vars = (s, history)
  pure val MaxEpoch = 3
  pure val MaxMedia = 2

  val TypeOK = Set("away", "camera").contains(s.view) and Set("closed", "open").contains(s.chat)
    and Set("off", "starting", "ready", "error").contains(s.phase)
    and Set("unknown", "granted", "denied").contains(s.perm)
    and Set("idle", "photo", "recording").contains(s.capture)
    and Set("back", "front").contains(s.lens) and Set("one", "half").contains(s.zoom)
    and Set("none", "queued", "capturing", "done", "failed", "cancelled", "refused").contains(s.agent)
    and s.epoch >= 0 and s.epoch <= MaxEpoch and s.inflight.subseteq(0.to(MaxEpoch))
    and s.media >= 0 and s.thumb >= 0

  pure def initialState(fixFocus: bool, fixLeave: bool, fixLens: bool, fixAgentQueue: bool, fixChatGrace: bool): State = {
    FixFocus: fixFocus, FixLeave: fixLeave, FixLens: fixLens, FixAgentQueue: fixAgentQueue, FixChatGrace: fixChatGrace,
    view: "away", chat: "closed", phase: "off", perm: "unknown", capture: "idle",
    focusBusy: false, lens: "back", flash: false, zoom: "one",
    agent: "none", epoch: 0, inflight: Set(), media: 0, thumb: 0,
    dropped: false, flipFailed: false }

  // Persistent monitors are the exact state extension for the original action properties
  // [][A]_vars: each relation holds for the step or the step leaves the original variables unchanged.
  pure val initialChecks = { AgentFailsOnlyForCause: true, ChatKeepsPreview: true }
  // AgentFailsOnlyForCause == [][(agent' = "failed" /\ agent # "failed") => (perm' = "denied" \/ phase' = "error")]_vars
  pure def AgentFailsOnlyForCauseRelation(before: State, after: State): bool = before == after or
    ((after.agent == "failed" and before.agent != "failed") implies (after.perm == "denied" or after.phase == "error"))
  // ChatKeepsPreview == [][(chat = "closed" /\ chat' = "open" /\ phase = "ready") => phase' = "ready"]_vars
  pure def ChatKeepsPreviewRelation(before: State, after: State): bool = before == after or
    ((before.chat == "closed" and after.chat == "open" and before.phase == "ready") implies after.phase == "ready")
  action Track(after: State): bool = all {
    s' = after,
    history' = {
      AgentFailsOnlyForCause: history.AgentFailsOnlyForCause and AgentFailsOnlyForCauseRelation(s, after),
      ChatKeepsPreview: history.ChatKeepsPreview and ChatKeepsPreviewRelation(s, after) }
  }
  val AgentFailsOnlyForCauseInvariant = history.AgentFailsOnlyForCause
  val ChatKeepsPreviewInvariant = history.ChatKeepsPreview

  // Initializers: one per TLA+ configuration (independent assignments for Quint's TLC conversion).
  action StartState(fixFocus: bool, fixLeave: bool, fixLens: bool, fixAgentQueue: bool, fixChatGrace: bool): bool = all {
    s' = initialState(fixFocus, fixLeave, fixLens, fixAgentQueue, fixChatGrace), history' = initialChecks }
  action checkerInit = all { s' = initialState(true, true, true, true, true), history' = initialChecks }                 // Design.cfg
  action checkerAsBuiltFocusInit = all { s' = initialState(false, true, true, true, true), history' = initialChecks }     // AsBuilt_Focus.cfg
  action checkerAsBuiltLeaveInit = all { s' = initialState(true, false, true, true, true), history' = initialChecks }     // AsBuilt_Leave.cfg
  action checkerAsBuiltLensInit = all { s' = initialState(true, true, false, true, true), history' = initialChecks }      // AsBuilt_Lens.cfg
  action checkerAsBuiltAgentQueueInit = all { s' = initialState(true, true, true, false, true), history' = initialChecks } // AsBuilt_AgentQueue.cfg
  action checkerAsBuiltChatGraceInit = all { s' = initialState(true, true, true, true, false), history' = initialChecks }  // AsBuilt_ChatGrace.cfg
  action init = StartState(true, true, true, true, true)

  val Room = s.media + s.inflight.size() < MaxMedia
  val Ready = s.view == "camera" and s.phase == "ready"

  // ---------------------------------------------------------------------------
  // User and system events

  action Open = all { s.view == "away", s.epoch < MaxEpoch,
    Track({ ...s, view: "camera", phase: "starting", epoch: s.epoch + 1 }) }

  // Every start checks access (CP:186-198). A denial may since have been reversed in Android
  // settings; a first-time prompt may be answered either way.
  action PermissionResultWith(perm: str): bool = all { s.phase == "starting", s.perm != "granted",
    Set("granted", "denied").contains(perm),
    Track({ ...s, perm: perm,
      phase: if (perm == "denied") "error" else "starting",
      agent: if (perm == "denied" and s.agent == "queued") "failed" else s.agent }) }
  action PermissionResult = { nondet perm = Set("granted", "denied").oneOf(); PermissionResultWith(perm) }

  action FirstFrame = all { s.view == "camera", s.phase == "starting", s.perm == "granted",
    Track({ ...s, phase: "ready" }) }

  action StartFail = all { s.view == "camera", s.phase == "starting", s.perm == "granted",
    Track({ ...s, phase: "error", agent: if (s.agent == "queued") "failed" else s.agent }) }

  // Back, Home, backgrounding and pagehide all stop the session (CA:585,823,959,992). A recording
  // is finalized and saved. A photo the native layer is still writing is saved too, but as written
  // the executor that delivers its result is shut down, so the adapter's `capturing` flag is never
  // cleared.
  action Leave = all { s.view == "camera", {
    val rec = if (s.capture == "recording") 1 else 0
    val saved = s.media + rec + s.inflight.size()
    Track({ ...s, view: "away", chat: "closed", phase: "off", focusBusy: false,
      media: saved, thumb: saved, inflight: Set(),
      capture: if (s.capture == "recording") "idle"
        else if (s.capture == "photo" and not(s.FixLeave)) "photo" else "idle",
      agent: if (Set("queued", "capturing").contains(s.agent)) "cancelled" else s.agent })
  } }

  action Shutter = all { Ready, s.chat == "closed", Room, s.capture == "idle",
    if (s.focusBusy and not(s.FixFocus)) Track({ ...s, dropped: true })
    else Track({ ...s, capture: "photo", inflight: s.inflight.union(Set(s.epoch)), focusBusy: false }) }

  action CaptureDone(e: int): bool = all { s.inflight.contains(e),
    Track({ ...s, inflight: s.inflight.exclude(Set(e)), media: s.media + 1, thumb: s.media + 1,
      capture: if (e == s.epoch and s.view == "camera") "idle" else s.capture,
      agent: if (s.agent == "capturing" and e == s.epoch) "done" else s.agent }) }

  // Design rule found by the model: a queued agent capture would otherwise wait for as long as the
  // user records. Starting a recording refuses it visibly instead.
  action RecStart = all { Ready, s.chat == "closed", Room, s.capture == "idle",
    if (s.focusBusy and not(s.FixFocus)) Track({ ...s, dropped: true })
    else Track({ ...s, capture: "recording", focusBusy: false,
      agent: if (s.agent == "queued") "refused" else s.agent }) }

  action RecStop = all { Ready, s.capture == "recording", // user Stop, or the native size/duration limit
    Track({ ...s, capture: "idle", media: s.media + 1, thumb: s.media + 1 }) }

  action Focus = all { Ready, s.chat == "closed", not(s.focusBusy), s.capture == "idle",
    Track({ ...s, focusBusy: true }) }

  action FocusDone = all { s.focusBusy, Track({ ...s, focusBusy: false }) }

  // As written, JS resets flash and zoom only after the native switch succeeds, and the native
  // layer validates the old settings against the new lens and rejects.
  action Flip = all { Ready, s.chat == "closed", s.capture == "idle",
    if (not(s.FixLens) and (s.flash or s.zoom == "half")) Track({ ...s, flipFailed: true })
    else Track({ ...s, lens: if (s.lens == "back") "front" else "back", flash: false, zoom: "one" }) }

  // As written the Flash button is shown on every lens (CA:807).
  action SetFlash = all { Ready, s.chat == "closed", s.FixLens implies s.lens == "back",
    Track({ ...s, flash: not(s.flash) }) }

  action SetZoom = all { Ready, s.chat == "closed", s.lens == "back",
    nondet zoom = Set("one", "half").exclude(Set(s.zoom)).oneOf()
    Track({ ...s, zoom: zoom }) }

  // camera_capture_photo, while Camera is open (agent-adapter.ts:631). The request keeps Camera
  // active while the chat is open (CA requestedCaptureActive). A session the chat grace released
  // (phase "off" with Camera open) starts again for it. The TLA+ CASE arms are tried in order.
  action AgentCapture = all { s.view == "camera", s.agent == "none",
    s.phase == "off" implies s.epoch < MaxEpoch, // model bound on sessions, not product behaviour
    if (s.phase == "ready" and s.capture == "idle")
      Track({ ...s, agent: "capturing", capture: "photo", inflight: s.inflight.union(Set(s.epoch)), focusBusy: false })
    else if (s.phase == "starting" and s.FixAgentQueue) Track({ ...s, agent: "queued" })
    else if (s.phase == "off" and s.FixAgentQueue) Track({ ...s, agent: "queued", phase: "starting", epoch: s.epoch + 1 })
    else if (s.phase == "ready") Track({ ...s, agent: "refused" }) // user capture in progress: visible refusal
    else Track({ ...s, agent: "failed" }) }

  // ---------------------------------------------------------------------------
  // The chat sheet over Camera (PLAN item 7). With FixChatGrace the session stays bound while the
  // chat is open; ChatGraceEnds is the 10 s timer, which releases the session as leaving does but
  // keeps Camera open. As built, opening the chat released the session at once. Closing the chat
  // over a released session starts it again.

  // Releasing the session: a recording is finalized and saved; a photo being written is awaited.
  pure def release(x: State): State = {
    val rec = if (x.capture == "recording") 1 else 0
    val saved = x.media + rec + x.inflight.size()
    { ...x, phase: "off", focusBusy: false, media: saved, thumb: saved, inflight: Set(),
      capture: if (x.capture == "photo" and not(x.FixLeave)) "photo" else "idle" }
  }

  action ChatOpen = all { s.view == "camera", s.chat == "closed",
    if (not(s.FixChatGrace) and Set("starting", "ready").contains(s.phase) and not(Set("queued", "capturing").contains(s.agent)))
      Track({ ...release(s), chat: "open" })
    else Track({ ...s, chat: "open" }) }

  action ChatGraceEnds = all { s.view == "camera", s.chat == "open", Set("starting", "ready").contains(s.phase),
    not(Set("queued", "capturing").contains(s.agent)), // an agent request keeps Camera active
    Track(release(s)) }

  action ChatClose = all { s.chat == "open",
    if (s.view == "camera" and s.phase == "off" and s.epoch < MaxEpoch)
      Track({ ...s, chat: "closed", phase: "starting", epoch: s.epoch + 1 })
    else Track({ ...s, chat: "closed" }) }

  action AgentRun = all { s.agent == "queued", Ready, s.capture == "idle",
    Track({ ...s, agent: "capturing", capture: "photo", inflight: s.inflight.union(Set(s.epoch)), focusBusy: false }) }

  action FirstFrameOrStartFail = any { FirstFrame, StartFail }
  action AnyCaptureDone = any { CaptureDone(0), CaptureDone(1), CaptureDone(2), CaptureDone(3) }
  action System = any { PermissionResult, FirstFrame, StartFail, FocusDone, AgentRun, ChatGraceEnds, AnyCaptureDone }
  action User = any { Open, Leave, Shutter, RecStart, RecStop, Focus, Flip,
    SetFlash, SetZoom, AgentCapture, ChatOpen, ChatClose }
  action Next = any { System, User }
  // Stuttering, as in the original [][Next]_vars.
  action step = any { Next, Track(s) }

  // WF_vars(PermissionResult) /\ WF_vars(FirstFrame \/ StartFail) /\ WF_vars(FocusDone)
  // /\ SF_vars(AgentRun) /\ WF_vars(ChatGraceEnds) /\ \A e \in 0..MaxEpoch : WF_vars(CaptureDone(e))
  temporal Fairness = PermissionResult.weakFair(s) and FirstFrameOrStartFail.weakFair(s)
    and FocusDone.weakFair(s) and AgentRun.strongFair(s) and ChatGraceEnds.weakFair(s)
    and 0.to(MaxEpoch).forall(e => CaptureDone(e).weakFair(s))

  val Initial = history == initialChecks and TypeOK
    and s == initialState(s.FixFocus, s.FixLeave, s.FixLens, s.FixAgentQueue, s.FixChatGrace)
  temporal Spec = (Initial and s.FixFocus and s.FixLeave and s.FixLens and s.FixAgentQueue and s.FixChatGrace)
    and always(Next.orKeep(vars)) and Fairness

  // ---------------------------------------------------------------------------
  // Properties
  val NoLostShutter = not(s.dropped)
  // With the camera ready and nothing being written, the shutter is usable.
  val NoStuckCapture = (Ready and s.inflight == Set()) implies Set("idle", "recording").contains(s.capture)
  val NoOrphanRecording = s.capture == "recording" implies Ready
  val LensSettingsValid = s.lens == "front" implies (not(s.flash) and s.zoom == "one")
  val FlipNeverRejected = not(s.flipFailed)
  // The last-capture tile and Photos agree with what was committed, once nothing is in flight.
  val SavedIsShown = s.inflight == Set() implies s.thumb == s.media
  // An agent capture fails only for a real cause the user can see.
  temporal AgentFailsOnlyForCause = always(history.AgentFailsOnlyForCause)
  // Opening the chat over a running preview keeps it (asking Alpha does not tear down the session).
  temporal ChatKeepsPreview = always(history.ChatKeepsPreview)
  // An open chat never holds the camera indefinitely.
  temporal ChatGraceReleases = leadsTo(
    s.view == "camera" and s.chat == "open" and Set("starting", "ready").contains(s.phase) and not(Set("queued", "capturing").contains(s.agent)),
    s.chat == "closed" or s.view == "away" or Set("off", "error").contains(s.phase) or Set("queued", "capturing").contains(s.agent))
  // A start ends in a preview or a visible error, unless Camera closes or the chat grace releases
  // it (closing the chat then starts again).
  temporal OpenReachesPreviewOrError = leadsTo(s.view == "camera" and s.phase == "starting",
    Set("ready", "error").contains(s.phase) or s.view == "away" or (s.phase == "off" and s.chat == "open"))
  temporal AgentCaptureSettles = leadsTo(Set("queued", "capturing").contains(s.agent),
    Set("done", "cancelled", "failed", "refused").contains(s.agent))

  temporal CheckedAgentFailsOnlyForCause = Fairness implies AgentFailsOnlyForCause
  temporal CheckedChatKeepsPreview = Fairness implies ChatKeepsPreview
  temporal CheckedChatGraceReleases = Fairness implies ChatGraceReleases
  temporal CheckedOpenReachesPreviewOrError = Fairness implies OpenReachesPreviewOrError
  temporal CheckedAgentCaptureSettles = Fairness implies AgentCaptureSettles
  temporal CheckedTemporal = Fairness implies (AgentFailsOnlyForCause and ChatKeepsPreview
    and ChatGraceReleases and OpenReachesPreviewOrError and AgentCaptureSettles)

  val safety = TypeOK and NoLostShutter and NoStuckCapture and NoOrphanRecording and LensSettingsValid
    and FlipNeverRejected and SavedIsShown and AgentFailsOnlyForCauseInvariant and ChatKeepsPreviewInvariant

  // ---------------------------------------------------------------------------
  // Scenarios: proposed success paths and one per expected as-built counterexample.
  run designDeniedTest = StartState(true, true, true, true, true)
    .then(Open).then(AgentCapture).then(PermissionResultWith("denied"))
    .expect(s.phase == "error" and s.agent == "failed" and safety)
  run designCaptureTest = StartState(true, true, true, true, true)
    .then(Open).then(PermissionResultWith("granted")).then(FirstFrame)
    .then(Focus).then(Shutter).expect(s.capture == "photo" and safety)
    .then(CaptureDone(1)).expect(s.capture == "idle" and s.media == 1 and s.thumb == 1 and safety)
  run designAgentQueueTest = StartState(true, true, true, true, true)
    .then(Open).then(AgentCapture).expect(s.agent == "queued" and safety)
    .then(PermissionResultWith("granted")).then(FirstFrame).then(AgentRun).then(CaptureDone(1))
    .expect(s.agent == "done" and safety)
  run designChatGraceTest = StartState(true, true, true, true, true)
    .then(Open).then(PermissionResultWith("granted")).then(FirstFrame)
    .then(ChatOpen).expect(s.phase == "ready" and safety)
    .then(ChatGraceEnds).expect(s.phase == "off" and s.view == "camera" and safety)
    .then(ChatClose).expect(s.phase == "starting" and s.epoch == 2 and safety)
  run asBuiltFocusTest = StartState(false, true, true, true, true)
    .then(Open).then(PermissionResultWith("granted")).then(FirstFrame)
    .then(Focus).then(Shutter).expect(not(NoLostShutter))
  run asBuiltLeaveTest = StartState(true, false, true, true, true)
    .then(Open).then(PermissionResultWith("granted")).then(FirstFrame)
    .then(Shutter).then(Leave).then(Open).then(FirstFrame).expect(not(NoStuckCapture))
  run asBuiltLensTest = StartState(true, true, false, true, true)
    .then(Open).then(PermissionResultWith("granted")).then(FirstFrame)
    .then(SetFlash).then(Flip).expect(not(FlipNeverRejected))
  run asBuiltAgentQueueTest = StartState(true, true, true, false, true)
    .then(Open).then(AgentCapture).expect(s.agent == "failed" and not(AgentFailsOnlyForCauseInvariant))
  run asBuiltChatGraceTest = StartState(true, true, true, true, false)
    .then(Open).then(PermissionResultWith("granted")).then(FirstFrame)
    .then(ChatOpen).expect(s.phase == "off" and not(ChatKeepsPreviewInvariant))
}
