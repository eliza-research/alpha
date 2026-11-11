// Historical design translation; the executable Quint model is retained here.
// The immutable configuration is the former TLC .cfg selection. History only
// observes transitions and does not restrict the original transition relation.
module CameraSession {
  type Configuration = { name: str, FixFocus: bool, FixLeave: bool, FixLens: bool,
    FixAgentQueue: bool, FixChatGrace: bool, MaxEpoch: int, MaxMedia: int }
  type State = { config: Configuration, view: str, chat: str, phase: str, perm: str,
    capture: str, focusBusy: bool, lens: str, flash: bool, zoom: str, agent: str,
    epoch: int, inflight: Set[int], media: int, thumb: int, dropped: bool, flipFailed: bool }
  type History = { AgentFailsOnlyForCause: bool, ChatKeepsPreview: bool }
  var s: State
  var history: History
  val vars = (s, history)
  pure val MaxEpoch = 3
  pure val Configurations = Set("Design", "AsBuilt_Focus", "AsBuilt_Leave",
    "AsBuilt_Lens", "AsBuilt_AgentQueue", "AsBuilt_ChatGrace")
  pure def configuration(name) = { name: name, FixFocus: name != "AsBuilt_Focus",
    FixLeave: name != "AsBuilt_Leave", FixLens: name != "AsBuilt_Lens",
    FixAgentQueue: name != "AsBuilt_AgentQueue", FixChatGrace: name != "AsBuilt_ChatGrace",
    MaxEpoch: MaxEpoch, MaxMedia: 2 }
  pure def initialState(name) = { config: configuration(name), view: "away", chat: "closed",
    phase: "off", perm: "unknown", capture: "idle", focusBusy: false, lens: "back",
    flash: false, zoom: "one", agent: "none", epoch: 0, inflight: Set(), media: 0,
    thumb: 0, dropped: false, flipFailed: false }
  pure val initialHistory = { AgentFailsOnlyForCause: true, ChatKeepsPreview: true }
  action Init(name) = all { Configurations.contains(name), s' = initialState(name), history' = initialHistory }
  // Separate entry points avoid Quint 0.33.1 init/action-helper conversion overlap.
  action checkerInit = all { s' = initialState("Design"), history' = initialHistory }
  action checkerAsBuilt_FocusInit = all { s' = initialState("AsBuilt_Focus"), history' = initialHistory }
  action checkerAsBuilt_LeaveInit = all { s' = initialState("AsBuilt_Leave"), history' = initialHistory }
  action checkerAsBuilt_LensInit = all { s' = initialState("AsBuilt_Lens"), history' = initialHistory }
  action checkerAsBuilt_AgentQueueInit = all { s' = initialState("AsBuilt_AgentQueue"), history' = initialHistory }
  action checkerAsBuilt_ChatGraceInit = all { s' = initialState("AsBuilt_ChatGrace"), history' = initialHistory }
  action init = Init("Design")
  action AsBuilt_FocusInit = Init("AsBuilt_Focus")
  action AsBuilt_LeaveInit = Init("AsBuilt_Leave")
  action AsBuilt_LensInit = Init("AsBuilt_Lens")
  action AsBuilt_AgentQueueInit = Init("AsBuilt_AgentQueue")
  action AsBuilt_ChatGraceInit = Init("AsBuilt_ChatGrace")
  pure def AgentFailsOnlyForCauseRelation(before: State, after: State): bool =
    (after.agent == "failed" and before.agent != "failed") implies
      (after.perm == "denied" or after.phase == "error")
  pure def ChatKeepsPreviewRelation(before: State, after: State): bool =
    (before.chat == "closed" and after.chat == "open" and before.phase == "ready") implies after.phase == "ready"
  action Track(after: State): bool = all { s' = after,
    history' = { AgentFailsOnlyForCause: history.AgentFailsOnlyForCause and AgentFailsOnlyForCauseRelation(s, after),
      ChatKeepsPreview: history.ChatKeepsPreview and ChatKeepsPreviewRelation(s, after) } }
  val Room = s.media + s.inflight.size() < s.config.MaxMedia
  val Ready = s.view == "camera" and s.phase == "ready"
  action Open = all { s.view == "away", s.epoch < s.config.MaxEpoch,
    Track({ ...s, view: "camera", phase: "starting", epoch: s.epoch + 1 }) }
  action PermissionResult = {
    nondet permission = Set("granted", "denied").oneOf()
    all { s.phase == "starting", s.perm != "granted",
      Track({ ...s, perm: permission, phase: if (permission == "denied") "error" else "starting",
        agent: if (permission == "denied" and s.agent == "queued") "failed" else s.agent }) }
  }
  action FirstFrame = all { s.view == "camera", s.phase == "starting", s.perm == "granted",
    Track({ ...s, phase: "ready" }) }
  action StartFail = all { s.view == "camera", s.phase == "starting", s.perm == "granted",
    Track({ ...s, phase: "error", agent: if (s.agent == "queued") "failed" else s.agent }) }
  pure def released(before: State): State = {
    val saved = before.media + (if (before.capture == "recording") 1 else 0) + before.inflight.size()
    { ...before, phase: "off", focusBusy: false, media: saved, thumb: saved, inflight: Set(),
      capture: if (before.capture == "photo" and not(before.config.FixLeave)) "photo" else "idle" }
  }
  action Leave = all { s.view == "camera",
    Track({ ...released(s), view: "away", chat: "closed",
      agent: if (Set("queued", "capturing").contains(s.agent)) "cancelled" else s.agent }) }
  action Shutter = all { Ready, s.chat == "closed", Room, s.capture == "idle",
    if (s.focusBusy and not(s.config.FixFocus)) Track({ ...s, dropped: true })
    else Track({ ...s, capture: "photo", inflight: s.inflight.union(Set(s.epoch)), focusBusy: false }) }
  action CaptureDone(e) = all { s.inflight.contains(e), Track({ ...s,
    inflight: s.inflight.exclude(Set(e)), media: s.media + 1, thumb: s.media + 1,
    capture: if (e == s.epoch and s.view == "camera") "idle" else s.capture,
    agent: if (s.agent == "capturing" and e == s.epoch) "done" else s.agent }) }
  action RecStart = all { Ready, s.chat == "closed", Room, s.capture == "idle",
    if (s.focusBusy and not(s.config.FixFocus)) Track({ ...s, dropped: true })
    else Track({ ...s, capture: "recording", focusBusy: false,
      agent: if (s.agent == "queued") "refused" else s.agent }) }
  action RecStop = all { Ready, s.capture == "recording",
    Track({ ...s, capture: "idle", media: s.media + 1, thumb: s.media + 1 }) }
  action Focus = all { Ready, s.chat == "closed", not(s.focusBusy), s.capture == "idle",
    Track({ ...s, focusBusy: true }) }
  action FocusDone = all { s.focusBusy, Track({ ...s, focusBusy: false }) }
  action Flip = all { Ready, s.chat == "closed", s.capture == "idle",
    if (not(s.config.FixLens) and (s.flash or s.zoom == "half")) Track({ ...s, flipFailed: true })
    else Track({ ...s, lens: if (s.lens == "back") "front" else "back", flash: false, zoom: "one" }) }
  action SetFlash = all { Ready, s.chat == "closed", s.config.FixLens implies s.lens == "back",
    Track({ ...s, flash: not(s.flash) }) }
  action SetZoom = all { Ready, s.chat == "closed", s.lens == "back",
    Track({ ...s, zoom: if (s.zoom == "one") "half" else "one" }) }
  action AgentCapture = all { s.view == "camera", s.agent == "none",
    s.phase == "off" implies s.epoch < s.config.MaxEpoch,
    if (s.phase == "ready" and s.capture == "idle")
      Track({ ...s, agent: "capturing", capture: "photo", inflight: s.inflight.union(Set(s.epoch)), focusBusy: false })
    else if (s.phase == "starting" and s.config.FixAgentQueue) Track({ ...s, agent: "queued" })
    else if (s.phase == "off" and s.config.FixAgentQueue)
      Track({ ...s, agent: "queued", phase: "starting", epoch: s.epoch + 1 })
    else if (s.phase == "ready") Track({ ...s, agent: "refused" })
    else Track({ ...s, agent: "failed" }) }
  action ChatOpen = all { s.view == "camera", s.chat == "closed",
    if (not(s.config.FixChatGrace) and Set("starting", "ready").contains(s.phase)
      and not(Set("queued", "capturing").contains(s.agent))) Track({ ...released(s), chat: "open" })
    else Track({ ...s, chat: "open" }) }
  action ChatGraceEnds = all { s.view == "camera", s.chat == "open",
    Set("starting", "ready").contains(s.phase), not(Set("queued", "capturing").contains(s.agent)), Track(released(s)) }
  action ChatClose = all { s.chat == "open",
    Track({ ...s, chat: "closed",
      phase: if (s.view == "camera" and s.phase == "off" and s.epoch < s.config.MaxEpoch) "starting" else s.phase,
      epoch: if (s.view == "camera" and s.phase == "off" and s.epoch < s.config.MaxEpoch) s.epoch + 1 else s.epoch }) }
  action AgentRun = all { s.agent == "queued", Ready, s.capture == "idle",
    Track({ ...s, agent: "capturing", capture: "photo", inflight: s.inflight.union(Set(s.epoch)), focusBusy: false }) }
  action System = { nondet e = 0.to(s.config.MaxEpoch).oneOf()
    any { PermissionResult, FirstFrame, StartFail, FocusDone, AgentRun, ChatGraceEnds, CaptureDone(e) } }
  action User = any { Open, Leave, Shutter, RecStart, RecStop, Focus, Flip,
    SetFlash, SetZoom, AgentCapture, ChatOpen, ChatClose }
  action Next = any { System, User }
  action step = any { Next, Track(s) }
  val TypeOK = Configurations.contains(s.config.name) and s.config == configuration(s.config.name)
    and Set("away", "camera").contains(s.view) and Set("closed", "open").contains(s.chat)
    and Set("off", "starting", "ready", "error").contains(s.phase)
    and Set("unknown", "granted", "denied").contains(s.perm)
    and Set("idle", "photo", "recording").contains(s.capture)
    and Set("back", "front").contains(s.lens) and Set("one", "half").contains(s.zoom)
    and Set("none", "queued", "capturing", "done", "failed", "cancelled", "refused").contains(s.agent)
    and 0.to(s.config.MaxEpoch).contains(s.epoch) and s.inflight.subseteq(0.to(s.config.MaxEpoch))
    and s.media >= 0 and s.thumb >= 0
  val NoLostShutter = not(s.dropped)
  val NoStuckCapture = (Ready and s.inflight == Set()) implies Set("idle", "recording").contains(s.capture)
  val NoOrphanRecording = s.capture == "recording" implies Ready
  val LensSettingsValid = s.lens == "front" implies (not(s.flash) and s.zoom == "one")
  val FlipNeverRejected = not(s.flipFailed)
  val SavedIsShown = s.inflight == Set() implies s.thumb == s.media
  val stateSafety = TypeOK and NoLostShutter and NoStuckCapture and NoOrphanRecording and LensSettingsValid and FlipNeverRejected and SavedIsShown
  val safety = TypeOK and NoLostShutter and NoStuckCapture and NoOrphanRecording
    and LensSettingsValid and FlipNeverRejected and SavedIsShown
    and history.AgentFailsOnlyForCause and history.ChatKeepsPreview
  val Initial = Configurations.contains(s.config.name) and s == initialState(s.config.name) and history == initialHistory
  temporal Fairness = PermissionResult.weakFair(s) and (FirstFrame or StartFail).weakFair(s)
    and FocusDone.weakFair(s) and AgentRun.strongFair(s) and ChatGraceEnds.weakFair(s)
    and 0.to(MaxEpoch).forall(e => CaptureDone(e).weakFair(s))
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  temporal AgentFailsOnlyForCause = always(history.AgentFailsOnlyForCause)
  temporal ChatKeepsPreview = always(history.ChatKeepsPreview)
  temporal ChatGraceReleases = leadsTo(s.view == "camera" and s.chat == "open"
    and Set("starting", "ready").contains(s.phase) and not(Set("queued", "capturing").contains(s.agent)),
    s.chat == "closed" or s.view == "away" or Set("off", "error").contains(s.phase)
      or Set("queued", "capturing").contains(s.agent))
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
  temporal CheckedConfiguredTemporal = CheckedTemporal
  // Deterministic permission choice is still the same original transition.
  action Grant = all { s.phase == "starting", s.perm != "granted", Track({ ...s, perm: "granted" }) }
  run designCaptureTest = init.then(Open).then(Grant).then(FirstFrame).then(Focus).then(Shutter)
    .then(CaptureDone(1)).expect(s.media == 1 and safety)
  run designLeaveTest = init.then(Open).then(Grant).then(FirstFrame).then(Shutter).then(Leave)
    .then(Open).then(FirstFrame).expect(s.capture == "idle" and s.media == 1 and safety)
  run designQueueTest = init.then(Open).then(AgentCapture).then(Grant).then(FirstFrame)
    .then(AgentRun).then(CaptureDone(1)).expect(s.agent == "done" and safety)
  run designChatTest = init.then(Open).then(Grant).then(FirstFrame).then(ChatOpen)
    .expect(s.phase == "ready" and safety).then(ChatGraceEnds).then(ChatClose)
    .expect(s.phase == "starting" and safety)
  run asBuiltFocusTest = AsBuilt_FocusInit.then(Open).then(Grant).then(FirstFrame).then(Focus)
    .then(Shutter).expect(not(NoLostShutter))
  run asBuiltLeaveTest = AsBuilt_LeaveInit.then(Open).then(Grant).then(FirstFrame).then(Shutter)
    .then(Leave).then(Open).then(FirstFrame).expect(not(NoStuckCapture))
  run asBuiltLensTest = AsBuilt_LensInit.then(Open).then(Grant).then(FirstFrame).then(SetFlash)
    .then(Flip).expect(not(FlipNeverRejected))
  run asBuiltAgentQueueTest = AsBuilt_AgentQueueInit.then(Open).then(AgentCapture)
    .expect(not(history.AgentFailsOnlyForCause))
  run asBuiltChatGraceTest = AsBuilt_ChatGraceInit.then(Open).then(Grant).then(FirstFrame)
    .then(ChatOpen).expect(not(history.ChatKeepsPreview))
  run asBuiltLeaveQueueTest = AsBuilt_LeaveInit.then(Open).then(Grant).then(FirstFrame).then(Shutter)
    .then(Leave).then(Open).then(AgentCapture).then(FirstFrame)
    .expect(s.agent == "queued" and s.capture == "photo" and s.inflight == Set() and not(NoStuckCapture))

}
