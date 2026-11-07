/// SystemUI measurements and the serial producer of listener-health acknowledgements.
module ListenerLeaseProducer {
  type View = {
    verified: bool, primary: bool, switching: bool, recording: bool,
    locked: bool, occluded: bool, expanded: bool, dozing: bool,
    statusRequested: bool, transient: bool, display: str, recentTransition: bool,
    statusHost: bool, statusChip: bool, keyHost: bool, keyChip: bool,
    shadeKnown: bool, shadeBlocked: bool, shadeAttached: bool,
    shadeFocus: bool, shadeInsets: bool, shadeTopmost: bool, shadeHost: bool, shadeChip: bool
  }
  type Ack = {
    uid: int, surface: bool, chip: bool, recording: bool, display: str, reason: str,
    statusEligible: bool, keyEligible: bool, shadeEligible: bool,
    statusHost: bool, keyHost: bool, shadeHost: bool,
    statusChip: bool, keyChip: bool, shadeChip: bool
  }
  type State = {
    view: View, running: bool, binderAlive: bool, scheduled: bool, queue: List[Ack],
    phase: str, pending: Ack, generation: int, serverGeneration: int,
    providerPackage: bool, providerUid: int, targetValidated: bool,
    lastSent: Ack, sent: bool, lastGeneration: int, result: str,
    pauseRequested: bool
  }
  var s: State
  pure val emptyAck = { uid: -1, surface: false, chip: false, recording: false,
    display: "unknown", reason: "none", statusEligible: false, keyEligible: false,
    shadeEligible: false, statusHost: false, keyHost: false, shadeHost: false,
    statusChip: false, keyChip: false, shadeChip: false }
  pure def measured(v: View): Ack = {
    val hidden = not(v.statusRequested) and not(v.transient)
    val statusEligible = not(v.locked or v.expanded or hidden)
    val keyEligible = v.locked and not(v.expanded)
    val shadeEligible = v.shadeKnown and not(v.shadeBlocked or v.locked or v.occluded or v.dozing or v.switching)
      and v.expanded and v.primary and v.shadeAttached and v.shadeFocus and v.shadeInsets and v.shadeTopmost
    val statusHost = v.statusHost or v.statusChip
    val keyHost = v.keyHost or v.keyChip
    val surface = statusEligible and statusHost or keyEligible and keyHost or shadeEligible and v.shadeHost
    val chip = statusEligible and v.statusChip or keyEligible and v.keyChip or shadeEligible and v.shadeHost and v.shadeChip
    val shown = surface and (not(v.recording) or chip)
    val reason = if (shown) "none" else if (v.display == "off") "display_off"
      else if (v.display == "doze") "aod" else if (v.recentTransition) "transition"
      else if (v.expanded) "shade" else if (hidden and not(v.locked)) "fullscreen" else "none"
    { uid: if (v.verified and v.primary and not(v.switching)) 1 else -1,
      surface: surface, chip: chip, recording: v.recording, display: v.display, reason: reason,
      statusEligible: statusEligible, keyEligible: keyEligible, shadeEligible: shadeEligible,
      statusHost: statusHost, keyHost: keyHost, shadeHost: v.shadeHost,
      statusChip: v.statusChip, keyChip: v.keyChip, shadeChip: v.shadeChip }
  }
  action init = s' = {
    view: { verified: true, primary: true, switching: false, recording: false,
      locked: false, occluded: false, expanded: false, dozing: false,
      statusRequested: true, transient: false, display: "on", recentTransition: false,
      statusHost: true, statusChip: true, keyHost: true, keyChip: true,
      shadeKnown: false, shadeBlocked: true, shadeAttached: false,
      shadeFocus: false, shadeInsets: false, shadeTopmost: false, shadeHost: false, shadeChip: false },
    running: false, binderAlive: true, scheduled: false, queue: [], phase: "idle",
    pending: emptyAck, generation: -1, serverGeneration: 1, providerPackage: true,
    providerUid: 1, targetValidated: false, lastSent: emptyAck, sent: false,
    lastGeneration: -1, result: "none", pauseRequested: false }
  action start = all { not(s.running), s.binderAlive, s' = { ...s, running: true, scheduled: true } }
  action surfaceChanged = all { s.running, s' = { ...s, scheduled: true } }
  action tick = all {
    s.running, s.scheduled, s.queue.length() < 2,
    s' = { ...s, queue: s.queue.append(measured(s.view)), scheduled: true }
  }
  action audioRecording(active: bool): bool = s' = { ...s,
    view: { ...s.view, recording: active and s.view.verified and s.view.primary and not(s.view.switching) }, scheduled: s.running }
  action identity(valid: bool): bool = s' = { ...s,
    view: { ...s.view, verified: valid and s.view.primary and not(s.view.switching),
      recording: s.view.recording and valid and s.view.primary and not(s.view.switching) }, scheduled: s.running }
  action userSwitch = s' = { ...s,
    view: { ...s.view, primary: false, switching: true, verified: false, recording: false }, scheduled: s.running }
  action returnToPrimary = s' = { ...s,
    view: { ...s.view, primary: true, switching: false, verified: true, recording: false }, scheduled: s.running }
  action unreadableTick = all {
    s.running, s.scheduled, s.queue.length() < 2,
    s' = { ...s, queue: s.queue.append(emptyAck), scheduled: true }
  }
  action lock(value: bool): bool = s' = { ...s,
    view: { ...s.view, locked: value, recentTransition: true }, scheduled: s.running }
  action showShade = s' = { ...s, view: { ...s.view, expanded: true, shadeKnown: true,
    shadeBlocked: false, shadeAttached: true, shadeFocus: true, shadeInsets: true,
    shadeTopmost: true, shadeHost: true, shadeChip: true }, scheduled: s.running }
  action shadeGeometry(valid: bool): bool = s' = { ...s,
    view: { ...s.view, shadeInsets: valid, shadeTopmost: valid }, scheduled: s.running }
  action shadeBlocked = s' = { ...s, view: { ...s.view, shadeBlocked: true }, scheduled: s.running }
  action collapseShade = s' = { ...s, view: { ...s.view, expanded: false }, scheduled: s.running }
  action statusMeasurement(host: bool, chip: bool): bool = s' = { ...s,
    view: { ...s.view, statusHost: host, statusChip: chip }, scheduled: s.running }
  action immersive = s' = { ...s, view: { ...s.view, statusRequested: false, transient: false }, scheduled: s.running }
  action transientBar = s' = { ...s, view: { ...s.view, transient: true }, scheduled: s.running }
  action display(mode: str): bool = all {
    mode.in(Set("on", "off", "doze", "unknown")),
    s' = { ...s, view: { ...s.view, display: mode, dozing: mode == "doze", recentTransition: true }, scheduled: s.running }
  }
  action settleTransition = s' = { ...s, view: { ...s.view, recentTransition: false } }
  action provider(valid: bool): bool = s' = { ...s, providerPackage: valid, providerUid: if (valid) 1 else 2 }
  action beginDelivery = all {
    s.phase == "idle", s.queue.length() > 0,
    val ack = s.queue.head()
    val target = ack.uid == 1 and s.providerPackage and s.providerUid == ack.uid
    s' = { ...s, queue: s.queue.tail(), pending: ack, targetValidated: target, result: "pending",
      phase: if (target) { if (s.generation < 0) "acquiring" else "renewing" }
        else if (s.generation < 0) "idle" else "revoking",
      generation: if (target) s.generation else -1 }
  }
  action acquire(success: bool): bool = all {
    s.phase == "acquiring",
    s' = { ...s, generation: if (success) s.serverGeneration else -1,
      phase: if (success) "renewing" else "idle", result: if (success) "pending" else "refused" }
  }
  action renew(accepted: bool): bool = all {
    s.phase == "renewing", s.targetValidated,
    val current = accepted and s.binderAlive and s.generation == s.serverGeneration
    s' = { ...s, phase: "idle", sent: true,
      lastSent: { ...s.pending, chip: s.pending.recording and s.pending.chip },
      lastGeneration: s.generation, generation: if (current) s.generation else -1,
      result: if (current) "accepted" else "refused" }
  }
  action revokeReply = all { s.phase == "revoking", s' = { ...s, phase: "idle", result: "revoked" } }
  action transportFailure = all {
    s.phase.in(Set("acquiring", "renewing", "revoking")),
    s' = { ...s, phase: "idle", generation: -1, result: "error" }
  }
  action receiverReplacesGeneration = all {
    s.serverGeneration < 2, s' = { ...s, serverGeneration: s.serverGeneration + 1 }
  }
  /// Sending the pause capability does not invent a stopped microphone observation.
  action requestPause = all { s.view.recording, s.view.verified, s' = { ...s, pauseRequested: true } }
  action crash = s' = { ...s, running: false, binderAlive: false, queue: [],
    phase: "idle", generation: -1, scheduled: false, result: "crashed" }
  action step = any {
    start, surfaceChanged, tick, unreadableTick, audioRecording(true), audioRecording(false), identity(true), identity(false),
    userSwitch, returnToPrimary, lock(true), lock(false), showShade, shadeGeometry(true), shadeGeometry(false), shadeBlocked,
    collapseShade, statusMeasurement(true, true), statusMeasurement(false, false), statusMeasurement(true, false),
    immersive, transientBar, display("on"), display("off"), display("doze"), display("unknown"), settleTransition,
    provider(true), provider(false), beginDelivery, acquire(true), acquire(false), renew(true), renew(false),
    revokeReply, transportFailure, receiverReplacesGeneration, requestPause, crash, s' = s
  }
  pure def measuredSurface(ack: Ack): bool =
    ack.surface == (ack.statusEligible and ack.statusHost or ack.keyEligible and ack.keyHost or ack.shadeEligible and ack.shadeHost)
  val QueuedMeasurement = s.queue.indices().forall(i => measuredSurface(s.queue.nth(i))) and measuredSurface(s.pending)
  val ChipRequiresRecording = s.sent implies (s.lastSent.chip implies s.lastSent.recording)
  val ValidatedTarget = s.phase.in(Set("acquiring", "renewing")) implies s.targetValidated and s.pending.uid == 1
  val RefusedGenerationRetired = s.result.in(Set("refused", "error", "revoked", "crashed")) implies s.generation == -1
  val SerializedDelivery = s.phase.in(Set("idle", "acquiring", "renewing", "revoking")) and s.queue.length() <= 2
  val TypeOK = s.generation.in(Set(-1, 1, 2)) and s.serverGeneration.in(Set(1, 2))
  val safety = TypeOK and QueuedMeasurement and ChipRequiresRecording and ValidatedTarget and RefusedGenerationRetired and SerializedDelivery
  run measuredShadeTest = init.then(start).then(audioRecording(true)).then(showShade).then(shadeGeometry(false))
    .then(tick).then(beginDelivery).then(acquire(true)).then(renew(true))
    .expect(not(s.lastSent.surface or s.lastSent.chip) and safety)
    .then(shadeGeometry(true)).then(tick).then(beginDelivery).then(renew(true)).expect(s.lastSent.surface and s.lastSent.chip and safety)
  run delayedAckUsesSnapshotTest = init.then(start).then(audioRecording(true)).then(tick)
    .then(statusMeasurement(false, false)).then(beginDelivery).then(acquire(true)).then(renew(true))
    .expect(s.lastSent.chip and not(s.view.statusChip) and safety)
    .then(tick).then(beginDelivery).then(renew(true)).expect(not(s.lastSent.chip) and safety)
  run providerValidationTest = init.then(start).then(tick).then(provider(false)).then(beginDelivery)
    .expect(s.generation == -1 and not(s.sent) and safety)
  run refusedGenerationTest = init.then(start).then(tick).then(beginDelivery).then(acquire(true))
    .then(receiverReplacesGeneration).then(renew(true)).expect(s.generation == -1 and safety)
    .then(tick).then(beginDelivery).then(acquire(true)).then(renew(true)).expect(s.generation == 2 and safety)
  run immersiveTransientTest = init.then(start).then(audioRecording(true)).then(immersive).then(tick)
    .then(beginDelivery).then(acquire(true)).then(renew(true)).expect(not(s.lastSent.surface) and s.lastSent.reason == "fullscreen")
    .then(transientBar).then(tick).then(beginDelivery).then(renew(true)).expect(s.lastSent.surface and safety)
  run pauseNeedsAudioObservationTest = init.then(audioRecording(true)).then(requestPause)
    .expect(s.pauseRequested and s.view.recording and safety).then(audioRecording(false)).expect(not(s.view.recording) and safety)
  run userSwitchRevokesTest = init.then(start).then(tick).then(beginDelivery).then(acquire(true)).then(renew(true))
    .then(userSwitch).then(tick).then(beginDelivery).then(revokeReply).expect(s.generation == -1 and safety)
  run returnToPrimaryTest = init.then(start).then(userSwitch).then(tick).then(beginDelivery)
    .expect(s.generation == -1 and not(s.sent)).then(returnToPrimary).then(tick).then(beginDelivery)
    .then(acquire(true)).then(renew(true)).expect(s.generation == 1 and safety)
  run unreadableMeasurementTest = init.then(start).then(tick).then(beginDelivery).then(acquire(true)).then(renew(true))
    .then(unreadableTick).then(beginDelivery).then(revokeReply).expect(s.generation == -1 and safety)
  run binderDeathTest = init.then(start).then(tick).then(beginDelivery).then(acquire(true)).then(crash)
    .expect(not(s.running or s.binderAlive) and s.generation == -1 and safety)
}
