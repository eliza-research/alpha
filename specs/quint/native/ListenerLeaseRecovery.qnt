// IndicatorLease monotonic lease and ListenerStore/CrashLoopBreaker recovery.
module ListenerLeaseRecovery {
  type State = {
    generation: int, live: bool, acknowledged: bool, expiresAt: int,
    now: int, boot: int, leaseBoot: int, surface: bool, chip: bool, recording: bool,
    display: str, reason: str, lastLoss: str, lastRenewAccepted: bool,
    captureActive: bool, captureSince: int, frameAccepted: bool, frameGeneration: int, interactive: bool, lastCheck: str,
    sessionOpen: bool, markerBoot: int, install: int, markerInstall: int,
    wall: int, exits: List[int], tripped: bool, processConsent: bool, historyLoaded: bool
  }
  var s: State
  action check(condition: bool): bool = all {assert(condition), s' = s}
  pure def pause(st: State): str =
    if (st.display == "off" or st.display == "doze") "display-off"
    else if (st.reason.in(Set("fullscreen", "shade", "transition"))) st.reason
    else "none"
  pure def verdict(st: State, attribution: bool, interactive: bool): str =
    if (not(st.live)) st.lastLoss
    else if (st.boot != st.leaseBoot) "other-boot"
    else if (not(st.acknowledged)) "pending"
    else if (st.now >= st.expiresAt) "expired"
    else if (st.display == "unknown") (if (interactive) "unknown-state" else "display-off")
    else if (st.display == "off") "display-off"
    else if (not(st.surface) or (st.recording and not(st.chip)))
      (if (pause(st) != "none") pause(st) else if (st.surface) "chip-hidden" else "surface-hidden")
    else if (attribution and not(st.recording and st.chip)) "unattributed"
    else "none"
  pure def endLease(st: State, why: str): State = {
    live: false, acknowledged: false, lastLoss: why, surface: false,
    chip: false, recording: false, display: "on", reason: "none",
    lastRenewAccepted: false, frameAccepted: false, ...st
  }
  pure def recent(exits: List[int], now: int): List[int] = exits.select(time => time <= now and now - time < 600000)
  pure def unclean(st: State): bool = st.sessionOpen and
    (st.markerBoot < 0 or st.boot < 0 or st.markerBoot == st.boot) and st.markerInstall == st.install
  action init = s' = {
    generation: 0, live: false, acknowledged: false, expiresAt: 0,
    now: 0, boot: 0, leaseBoot: 0, surface: false, chip: false, recording: false,
    display: "on", reason: "none", lastLoss: "never-acquired", lastRenewAccepted: false,
    captureActive: false, captureSince: -1, frameAccepted: false, frameGeneration: -1, interactive: true, lastCheck: "never-acquired",
    sessionOpen: false, markerBoot: 0, install: 0, markerInstall: 0,
    wall: 0, exits: [], tripped: false, processConsent: false, historyLoaded: false
  }
  action acquire = all {
    s.generation < 3,
    s' = {generation: s.generation + 1, live: true, acknowledged: false,
      leaseBoot: s.boot, surface: false, chip: false, recording: false,
      display: "on", reason: "none", frameAccepted: false,
      lastRenewAccepted: false, ...s}
  }
  action renew(token: int, surface: bool, chip: bool, recording: bool,
      display: str, reason: str): bool = all {
    display.in(Set("on", "off", "doze", "unknown")), reason.in(Set("none", "fullscreen", "shade", "transition")),
    if (not(s.live) or token != s.generation)
      s' = {lastRenewAccepted: false, frameAccepted: false, ...s}
    else if (s.boot != s.leaseBoot) s' = endLease(s, "other-boot")
    else if (s.acknowledged and s.now >= s.expiresAt) s' = endLease(s, "expired")
    else {
      val updated = {surface: surface, chip: chip, recording: recording,
        display: display, reason: reason, lastRenewAccepted: true, frameAccepted: false, ...s}
      s' = if (surface or display == "unknown" or pause(updated) != "none")
        {acknowledged: true, expiresAt: s.now + 3000, ...updated} else updated
    }
  }
  action advance(now: int): bool = all {
    now.in(Set(0, 1000, 2499, 2500, 2999, 3000, 6000)), now >= s.now,
    s' = {now: now, frameAccepted: false, lastRenewAccepted: false, ...s}
  }
  action revoke(token: int): bool =
    if (s.live and token == s.generation) s' = endLease(s, "revoked")
    else s' = {frameAccepted: false, lastRenewAccepted: false, ...s}
  action binderDied(token: int): bool =
    if (s.live and token == s.generation) s' = endLease(s, "binder-died")
    else s' = {frameAccepted: false, lastRenewAccepted: false, ...s}
  action explicitConsent = s' = {processConsent: true, tripped: false, exits: [], frameAccepted: false, ...s}
  action openCapture = all {
    s.processConsent, not(s.tripped), verdict(s, false, s.interactive) == "none",
    s' = {sessionOpen: true, captureActive: true, captureSince: s.now, markerBoot: s.boot,
      markerInstall: s.install, frameAccepted: false, ...s}
  }
  action closeCapture = s' = {sessionOpen: false, captureActive: false, captureSince: -1, frameAccepted: false, ...s}
  action processFrame = {
    val needsAttribution = s.captureSince >= 0 and s.now - s.captureSince >= 2500
    val answer = verdict(s, needsAttribution, s.interactive)
    s' = if (answer.in(Set("expired", "other-boot"))) endLease(s.with("lastCheck", answer), answer)
      else {frameAccepted: s.captureActive and s.sessionOpen and s.processConsent and not(s.tripped) and answer == "none",
        frameGeneration: s.generation, lastCheck: answer, ...s}
  }
  action screenChanged(interactive: bool): bool = s' = {interactive: interactive, frameAccepted: false, ...s}
  action changeBoot(boot: int): bool = all {
    boot.in(Set(-1, 0, 1)), s' = {boot: boot, frameAccepted: false, lastRenewAccepted: false, ...s}
  }
  action updateInstall = s' = {install: 1, frameAccepted: false, ...s}
  action wallTime(now: int): bool = all {
    now.in(Set(0, 599999, 600000, 600001)), s' = {wall: now, frameAccepted: false, ...s}
  }
  action processStarts(permission: bool): bool = {
    val kept = recent(s.exits, s.wall)
    val appended = if (permission and unclean(s)) kept.append(s.wall) else kept
    val bounded = if (appended.length() > 8) appended.slice(appended.length() - 8, appended.length()) else appended
    s' = endLease({sessionOpen: false, captureActive: false, captureSince: -1, processConsent: false, historyLoaded: true,
      exits: bounded, tripped: s.tripped or bounded.length() >= 3, ...s}, "binder-died")
  }
  // Startup may restore records created by an earlier installed version.
  action loadSavedHistory(count: int, open: bool): bool = all {
    not(s.historyLoaded), s.generation == 0, count.in(0.to(3)),
    s' = {historyLoaded: true, sessionOpen: open, captureActive: false,
      exits: if (count == 0) [] else if (count == 1) [0] else if (count == 2) [0, 0] else [0, 0, 0], ...s}
  }
  action step = {
    nondet token = 0.to(3).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet chip = Set(false, true).oneOf()
    nondet recording = Set(false, true).oneOf()
    nondet display = Set("on", "off", "doze", "unknown").oneOf()
    nondet reason = Set("none", "fullscreen", "shade", "transition").oneOf()
    nondet now = Set(0, 1000, 2499, 2500, 2999, 3000, 6000).oneOf()
    nondet wall = Set(0, 599999, 600000, 600001).oneOf()
    nondet boot = Set(-1, 0, 1).oneOf()
    any {acquire, renew(token, flag, chip, recording, display, reason), advance(now),
      revoke(token), binderDied(token), explicitConsent, openCapture, closeCapture,
      processFrame, screenChanged(flag), changeBoot(boot), updateInstall, wallTime(wall), processStarts(flag), loadSavedHistory(token, flag), s' = s}
  }
  val FrameNeedsFreshLease = s.frameAccepted implies
    s.live and s.acknowledged and s.now < s.expiresAt and s.boot == s.leaseBoot and s.frameGeneration == s.generation
  val FrameNeedsConsent = s.frameAccepted implies s.processConsent and s.sessionOpen and not(s.tripped)
  val AttributionAfterGrace = s.frameAccepted and s.now - s.captureSince >= 2500 implies s.recording and s.chip
  val CrashHistoryBounded = s.exits.length() <= 8
  val NoRenewExpiredLease = s.lastRenewAccepted implies s.live and s.boot == s.leaseBoot and (not(s.acknowledged) or s.now < s.expiresAt)
  // A durable previous-process marker is crash evidence, never a current capture worker.
  val FrameNeedsActiveCapture = s.frameAccepted implies s.captureActive
  val ActiveCaptureHasTimestamp = s.captureActive == (s.captureSince >= 0) and
    (s.captureActive implies s.sessionOpen and s.captureSince <= s.now)
  val safety = FrameNeedsFreshLease and FrameNeedsConsent and AttributionAfterGrace and CrashHistoryBounded and NoRenewExpiredLease and FrameNeedsActiveCapture and ActiveCaptureHasTimestamp

  run leaseNeedsAcknowledgementTest = init.then(explicitConsent).then(acquire)
    .then(renew(1, true, true, true, "on", "none")).then(openCapture).then(processFrame)
    .then(check(safety and s.frameAccepted))
  run expiredLeaseCannotBeRenewedTest = init.then(acquire)
    .then(renew(1, true, true, true, "on", "none")).then(advance(3000))
    .then(renew(1, true, true, true, "on", "none"))
    .then(check(safety and not(s.live) and s.lastLoss == "expired"))
  run attributionRequiredAfterGraceTest = init.then(explicitConsent).then(acquire)
    .then(renew(1, true, false, false, "on", "none")).then(openCapture).then(processFrame)
    .then(check(s.frameAccepted)).then(advance(2500)).then(processFrame)
    .then(check(safety and not(s.frameAccepted)))
  run explainedPauseRequiresVisibleReturnTest = init.then(explicitConsent).then(acquire)
    .then(renew(1, false, false, false, "off", "none")).then(processFrame)
    .then(check(not(s.frameAccepted))).then(renew(1, true, true, true, "on", "none"))
    .then(openCapture).then(processFrame).then(check(safety and s.frameAccepted))
  run unknownDisplayUsesListenerScreenTest = init.then(acquire)
    .then(renew(1, false, false, false, "unknown", "none")).then(processFrame)
    .then(check(safety and s.lastCheck == "unknown-state"))
    .then(screenChanged(false)).then(processFrame).then(check(safety and s.lastCheck == "display-off"))
  run otherBootInvalidatesLeaseTest = init.then(acquire)
    .then(renew(1, true, true, true, "on", "none")).then(changeBoot(1))
    .then(renew(1, true, true, true, "on", "none")).then(check(safety and s.lastLoss == "other-boot"))
  run storedHistoryTripsAtThirdUncleanStartTest = init.then(loadSavedHistory(2, true))
    .then(processStarts(true)).then(check(safety and s.tripped and s.exits.length() == 3))
  run exactCrashWindowBoundaryTest = init.then(loadSavedHistory(2, true)).then(wallTime(600000))
    .then(processStarts(true)).then(check(safety and not(s.tripped) and s.exits.length() == 1))
  run crashTripStaysLatchedAfterWindowTest = init.then(loadSavedHistory(3, false))
    .then(processStarts(true)).then(wallTime(600001)).then(processStarts(false))
    .then(check(safety and s.tripped and s.exits.length() == 0))
    .then(explicitConsent).then(check(safety and not(s.tripped)))
  run rebootDoesNotCountCrashTest = init.then(explicitConsent).then(acquire)
    .then(renew(1, true, true, true, "on", "none")).then(openCapture).then(changeBoot(1))
    .then(processStarts(true)).then(check(safety and s.exits.length() == 0))
  run updateDoesNotCountCrashTest = init.then(explicitConsent).then(acquire)
    .then(renew(1, true, true, true, "on", "none")).then(openCapture).then(updateInstall)
    .then(processStarts(true)).then(check(safety and s.exits.length() == 0))
  run permissionRevocationDoesNotCountCrashTest = init.then(explicitConsent).then(acquire)
    .then(renew(1, true, true, true, "on", "none")).then(openCapture)
    .then(processStarts(false)).then(check(safety and s.exits.length() == 0))

  run restoredMarkerCannotAdmitFrameTest = init.then(loadSavedHistory(3, true))
    .then(advance(2499)).then(explicitConsent).then(acquire)
    .then(renew(1, true, true, false, "on", "shade")).then(processFrame)
    .then(check(safety and s.sessionOpen and not(s.captureActive) and s.captureSince == -1 and not(s.frameAccepted)))
  run freshCaptureStartsItsOwnGraceTest = init.then(loadSavedHistory(0, true))
    .then(explicitConsent).then(acquire).then(renew(1, true, true, false, "on", "shade"))
    .then(openCapture).then(processFrame).then(check(safety and s.captureActive and s.frameAccepted))
    .then(advance(2499)).then(processFrame).then(check(safety and s.frameAccepted))
    .then(advance(2500)).then(processFrame).then(check(safety and not(s.frameAccepted) and s.lastCheck == "unattributed"))
    .then(closeCapture).then(processFrame).then(check(safety and not(s.captureActive) and not(s.frameAccepted)))
}
