// ListenerPolicy precedence, the listener's step on each SystemUI lease verdict, per-process
// consent and ListeningEpoch ticket invalidation.
module AlwaysOnListener {
  type State = {
    consent: bool, enabled: bool, permission: bool, notification: bool,
    foregroundUser: bool, unlocked: bool, speechReady: bool, crashLoop: bool,
    paused: bool, inCall: bool, otherMic: bool, silenced: bool,
    lease: str, indicatorPause: str, indicatorLost: bool,
    epoch: int, ticket: int, invoked: bool, processed: bool, resetGeneration: int,
    decision: str, microphone: bool, analyzing: bool,
    operation: str, obsHeld: bool, obsBefore: str, obsLoss: str, obsInteractive: bool,
    obsValid: bool, obsLatched: bool
  }
  var s: State
  pure val pauseLosses = Set("DISPLAY_OFF", "FULLSCREEN", "SHADE", "TRANSITION")
  // REVOKED and UNATTRIBUTED stand for every unexplained loss that is neither pending nor expired.
  pure val losses = Set("NONE", "PENDING", "EXPIRED", "REVOKED", "UNATTRIBUTED").union(pauseLosses)
  pure def phase(st: State): str =
    if (not(st.consent) or not(st.enabled)) "off"
    else if (not(st.permission)) "permission-required"
    else if (not(st.notification)) "notifications-required"
    else if (st.crashLoop) "stopped-errors"
    else if (st.indicatorLost) "stopped-indicator-lost"
    else if (not(st.foregroundUser)) "other-user"
    else if (not(st.unlocked)) "waiting-unlock"
    else if (not(st.speechReady)) "speech-unavailable"
    else if (st.paused) "paused-user"
    else if (st.inCall) "paused-call"
    else if (st.otherMic) "paused-mic-in-use"
    else if (st.indicatorPause == "DISPLAY_OFF") "paused-display-off"
    else if (st.indicatorPause == "FULLSCREEN") "paused-fullscreen"
    else if (st.indicatorPause == "SHADE") "paused-shade"
    else if (st.indicatorPause == "TRANSITION") "paused-transition"
    else if (st.lease != "fresh") "indicator-unavailable"
    else if (st.silenced) "paused-mic-unavailable"
    else "listening"
  pure def holdsMic(st: State): bool = phase(st).in(Set("listening", "paused-mic-unavailable"))
  pure def evaluated(st: State): State = {decision: phase(st), microphone: holdsMic(st), analyzing: phase(st) == "listening", ...st}
  action check(condition: bool): bool = all { assert(condition), s' = evaluated(s.with("operation", "check")) }
  action init = s' = evaluated({
    consent: false, enabled: false, permission: true, notification: true,
    foregroundUser: true, unlocked: true, speechReady: true, crashLoop: false,
    paused: false, inCall: false, otherMic: false, silenced: false,
    lease: "none", indicatorPause: "NONE", indicatorLost: false,
    epoch: 0, ticket: -1, invoked: false, processed: false, resetGeneration: 0,
    decision: "off", microphone: false, analyzing: false,
    operation: "init", obsHeld: false, obsBefore: "NONE", obsLoss: "NONE", obsInteractive: true,
    obsValid: false, obsLatched: false
  })
  // The consent screen or an explicit turn-on in this process: clears a tripped breaker and a
  // lost-indicator stop.
  action enable = all {
    s.permission, s.notification, s.unlocked, s.epoch < 8,
    s' = evaluated({consent: true, enabled: true, paused: false, crashLoop: false,
      indicatorLost: false, epoch: s.epoch + 1, processed: false, invoked: false, operation: "enable", ...s})
  }
  // One lease verdict, as Listener.observeIndicatorLease applies it. An unexplained loss while the
  // microphone is held, or during an explained pause, latches. An explained loss pauses. A lease
  // that lapses or restarts pending during a display-off pause with the microphone released does
  // neither, and keeps the pause while the listener itself still sees the screen off.
  action observe(loss: str, screenInteractive: bool): bool = all {
    losses.contains(loss), s.epoch < 8,
    {
      val held = holdsMic(s)
      val valid = loss == "NONE"
      val asleep = not(held) and s.indicatorPause == "DISPLAY_OFF" and loss.in(Set("EXPIRED", "PENDING"))
      val latches = not(asleep) and (held or s.indicatorPause != "NONE") and not(valid) and not(pauseLosses.contains(loss))
      s' = evaluated({
        lease: if (valid) "fresh" else if (loss == "PENDING") "pending" else "lost",
        indicatorPause: if (asleep and not(screenInteractive)) "DISPLAY_OFF"
          else if (pauseLosses.contains(loss)) loss else "NONE",
        indicatorLost: s.indicatorLost or latches,
        epoch: s.epoch + 1, processed: false, invoked: false,
        operation: "observe", obsHeld: held, obsBefore: s.indicatorPause, obsLoss: loss,
        obsInteractive: screenInteractive, obsValid: valid, obsLatched: latches, ...s})
    }
  }
  action environment(kind: str, value: bool): bool = all {
    kind.in(Set("permission", "notification", "foreground", "unlock", "speech", "call", "otherMic", "silenced")),
    s.epoch < 8,
    s' = evaluated({permission: if (kind == "permission") value else s.permission,
      notification: if (kind == "notification") value else s.notification,
      foregroundUser: if (kind == "foreground") value else s.foregroundUser,
      unlocked: if (kind == "unlock") value else s.unlocked,
      speechReady: if (kind == "speech") value else s.speechReady,
      inCall: if (kind == "call") value else s.inCall,
      otherMic: if (kind == "otherMic") value else s.otherMic,
      silenced: if (kind == "silenced") value else s.silenced,
      epoch: s.epoch + 1, processed: false, invoked: false, operation: "environment", ...s})
  }
  action pause = all {
    s.epoch < 8, s' = evaluated({paused: true, epoch: s.epoch + 1, processed: false, invoked: false, operation: "pause", ...s})
  }
  action captureUtterance = all {
    phase(s) == "listening", s' = evaluated({ticket: s.epoch, processed: true, operation: "capture", ...s})
  }
  action recognize(ticket: int, wake: bool): bool =
    if (phase(s) == "listening" and ticket == s.epoch and ticket == s.ticket and wake and s.unlocked)
      s' = evaluated({invoked: true, operation: "recognize", ...s})
    else s' = evaluated(s.with("operation", "recognize"))
  // Reset clears every stored listener setting, including a tripped breaker.
  action reset = all {
    s.epoch < 8, s.resetGeneration < 2,
    s' = evaluated({consent: false, enabled: false, paused: false, crashLoop: false, epoch: s.epoch + 1,
      resetGeneration: s.resetGeneration + 1, processed: false, invoked: false, operation: "reset", ...s})
  }
  // A consent grant from a screen opened before a reset is refused by its generation.
  action staleConsentCallback(generation: int): bool =
    if (generation == s.resetGeneration and s.unlocked and s.permission and s.notification)
      s' = evaluated({consent: true, enabled: true, paused: false, crashLoop: false, indicatorLost: false,
        operation: "consent", ...s})
    else s' = evaluated(s.with("operation", "consent"))
  // The process dies and restarts. Consent is per process, the lease and its latch are in memory
  // only, and the stored breaker may have tripped on this start.
  action processRestart(tripped: bool): bool = all {
    s.epoch < 8,
    s' = evaluated({consent: false, crashLoop: s.crashLoop or tripped, lease: "none", indicatorPause: "NONE",
      indicatorLost: false, inCall: false, otherMic: false, silenced: false, speechReady: true,
      epoch: s.epoch + 1, ticket: -1, processed: false, invoked: false, operation: "restart", ...s})
  }
  action step = {
    nondet value = Set(false, true).oneOf()
    nondet kind = Set("permission", "notification", "foreground", "unlock", "speech", "call", "otherMic", "silenced").oneOf()
    nondet ticket = Set(-1, 0, 1, 2, 3, 4, 5, 6, 7, 8).oneOf()
    nondet loss = losses.oneOf()
    any { enable, observe(loss, value), environment(kind, value),
      pause, captureUtterance, recognize(ticket, value), reset, staleConsentCallback(ticket),
      processRestart(value), s' = evaluated(s.with("operation", "stutter")) }
  }
  val CaptureRequiresAuthority = holdsMic(s) implies
    (s.consent and s.enabled and s.permission and s.notification and s.foregroundUser and s.unlocked and
      s.lease == "fresh" and s.indicatorPause == "NONE" and not(s.indicatorLost))
  val SilencedFramesDiscarded = s.processed implies phase(s) == "listening"
  val LostIndicatorLatches = s.indicatorLost implies not(holdsMic(s))
  // The latch decision of the last verdict, restated from what that verdict observed.
  val LatchMatchesVerdict = s.operation == "observe" implies
    (s.obsLatched iff (s.obsLoss.in(Set("PENDING", "EXPIRED", "REVOKED", "UNATTRIBUTED")) and
      (s.obsHeld or (s.obsBefore != "NONE" and
        not(s.obsBefore == "DISPLAY_OFF" and s.obsLoss.in(Set("PENDING", "EXPIRED")))))))
  val ExplainedPauseNeverCaptures = s.indicatorPause != "NONE" implies s.lease != "fresh" and not(holdsMic(s))
  val InvocationCurrent = s.invoked implies s.ticket == s.epoch and s.unlocked and phase(s) == "listening"
  // A tripped breaker is only ever seen by a process that has no consent yet.
  val CrashTripNeedsFreshConsent = s.crashLoop implies not(s.consent)
  val DecisionProjection = s.decision == phase(s) and s.microphone == holdsMic(s) and s.analyzing == (phase(s) == "listening")
  val safety = DecisionProjection and CaptureRequiresAuthority and SilencedFramesDiscarded and
    LostIndicatorLatches and LatchMatchesVerdict and ExplainedPauseNeverCaptures and InvocationCurrent and
    CrashTripNeedsFreshConsent

  val LatchedDuringPauseWitness = s.operation == "observe" and s.obsLatched and not(s.obsHeld)
  val SleepLapseWitness = s.operation == "observe" and s.obsBefore == "DISPLAY_OFF" and
    s.obsLoss.in(Set("EXPIRED", "PENDING")) and not(s.obsLatched) and s.consent and s.enabled
  val RestartNeedsConsentWitness = s.operation == "restart" and s.enabled and phase(s) == "off"
  val ListeningWitness = phase(s) == "listening"

  run consentAndLeaseTest = init.then(enable).then(observe("PENDING", true)).then(observe("NONE", true))
    .then(captureUtterance).then(recognize(3, true)).then(check(safety and s.invoked))
  run lostLeaseNeedsResumeTest = init.then(enable).then(observe("NONE", true))
    .then(observe("EXPIRED", true)).then(observe("PENDING", true)).then(observe("NONE", true))
    .then(check(safety and phase(s) == "stopped-indicator-lost"))
    .then(enable).then(check(safety and phase(s) == "listening"))
  run resetInvalidatesQueuedRecognitionTest = init.then(enable)
    .then(observe("NONE", true)).then(captureUtterance).then(reset).then(recognize(2, true))
    .then(staleConsentCallback(0)).then(check(safety and not(s.consent) and not(s.invoked)))
  run silencedCaptureDropsFramesTest = init.then(enable).then(observe("NONE", true))
    .then(environment("silenced", true))
    .then(check(safety and holdsMic(s) and phase(s) == "paused-mic-unavailable" and not(s.processed)))
  run explainedPauseCanResumeTest = init.then(enable).then(observe("NONE", true))
    .then(observe("FULLSCREEN", true)).then(check(phase(s) == "paused-fullscreen" and not(s.indicatorLost)))
    .then(observe("SHADE", true)).then(check(phase(s) == "paused-shade"))
    .then(observe("TRANSITION", true)).then(check(phase(s) == "paused-transition" and not(s.indicatorLost)))
    .then(observe("NONE", true)).then(check(safety and phase(s) == "listening"))
  // An unexplained loss during an explained pause is sticky: a new lease does not resume capture.
  run lossDuringExplainedPauseLatchesTest = init.then(enable).then(observe("NONE", true))
    .then(observe("FULLSCREEN", true)).then(observe("REVOKED", true))
    .then(check(safety and s.indicatorLost and s.indicatorPause == "NONE"))
    .then(observe("PENDING", true)).then(observe("NONE", true))
    .then(check(safety and phase(s) == "stopped-indicator-lost"))
  // The phone sleeps during a display-off pause: the lease lapses and restarts pending without a
  // latch, and capture waits for a fresh acknowledgement.
  run sleepLapseDoesNotLatchTest = init.then(enable).then(observe("NONE", true))
    .then(observe("DISPLAY_OFF", false)).then(observe("EXPIRED", false))
    .then(check(safety and phase(s) == "paused-display-off" and not(s.indicatorLost)))
    .then(observe("PENDING", true)).then(check(safety and phase(s) == "indicator-unavailable" and not(s.indicatorLost)))
    .then(observe("NONE", true)).then(check(safety and phase(s) == "listening"))
  run restartRequiresNewConsentTest = init.then(enable).then(observe("NONE", true))
    .then(processRestart(true)).then(check(safety and phase(s) == "off" and s.crashLoop and s.lease == "none"))
    .then(observe("NONE", true)).then(check(safety and phase(s) == "off"))
    .then(enable).then(check(safety and not(s.crashLoop) and phase(s) == "listening"))
}
