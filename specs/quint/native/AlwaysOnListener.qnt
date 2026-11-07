// ListenerPolicy precedence, SystemUI lease and ListeningEpoch ticket invalidation.
module AlwaysOnListener {
  type State = {
    image: bool, consent: bool, enabled: bool, permission: bool, notification: bool,
    foregroundUser: bool, unlocked: bool, speechReady: bool, crashLoop: bool,
    paused: bool, inCall: bool, otherMic: bool, silenced: bool,
    lease: str, explainedPause: bool, indicatorLost: bool,
    epoch: int, ticket: int, invoked: bool, processed: bool, resetGeneration: int,
    decision: str, microphone: bool, analyzing: bool
  }
  var s: State
  pure def evaluated(st: State): State = {decision: phase(st), microphone: holdsMic(st), analyzing: phase(st) == "listening", ...st}
  action check(condition: bool): bool = all { assert(condition), s' = evaluated(s) }
  pure def phase(st: State): str =
    if (not(st.image) or not(st.consent) or not(st.enabled)) "off"
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
    else if (st.explainedPause) "paused-indicator"
    else if (st.lease != "fresh") "indicator-unavailable"
    else if (st.silenced) "paused-mic-unavailable"
    else "listening"
  pure def holdsMic(st: State): bool = phase(st).in(Set("listening", "paused-mic-unavailable"))
  action init = s' = evaluated({
    image: true, consent: false, enabled: false, permission: true, notification: true,
    foregroundUser: true, unlocked: true, speechReady: true, crashLoop: false,
    paused: false, inCall: false, otherMic: false, silenced: false,
    lease: "none", explainedPause: false, indicatorLost: false,
    epoch: 0, ticket: -1, invoked: false, processed: false, resetGeneration: 0,
    decision: "off", microphone: false, analyzing: false
  })
  action enable = all {
    s.image, s.permission, s.notification, s.unlocked, s.epoch < 8,
    s' = evaluated({consent: true, enabled: true, paused: false, crashLoop: false,
      indicatorLost: false, epoch: s.epoch + 1, processed: false, invoked: false, ...s})
  }
  action acquireLease = all {
    s.epoch < 8, s' = evaluated({lease: "pending", explainedPause: false, processed: false, invoked: false, epoch: s.epoch + 1, ...s})
  }
  action renewLease(visible: bool): bool = all {
    s.lease.in(Set("pending", "fresh")), s.epoch < 8,
    s' = evaluated({lease: "fresh", explainedPause: not(visible), processed: false, invoked: false,
      epoch: if (visible) s.epoch else s.epoch + 1, ...s})
  }
  // Unexplained loss while a microphone is held latches until the user resumes.
  action loseLease = all {
    s.epoch < 8,
    s' = evaluated({lease: "expired", indicatorLost: s.indicatorLost or holdsMic(s),
      epoch: s.epoch + 1, processed: false, invoked: false, ...s})
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
      epoch: s.epoch + 1, processed: false, invoked: false, ...s})
  }
  action pause = all {
    s.epoch < 8, s' = evaluated({paused: true, epoch: s.epoch + 1, processed: false, invoked: false, ...s})
  }
  action captureUtterance = all {
    phase(s) == "listening", s' = evaluated({ticket: s.epoch, processed: true, ...s})
  }
  action recognize(ticket: int, wake: bool): bool =
    if (phase(s) == "listening" and ticket == s.epoch and ticket == s.ticket and wake and s.unlocked)
      s' = evaluated(s.with("invoked", true))
    else s' = evaluated(s)
  action reset = all {
    s.epoch < 8, s.resetGeneration < 2,
    s' = evaluated({consent: false, enabled: false, paused: false, epoch: s.epoch + 1,
      resetGeneration: s.resetGeneration + 1, processed: false, invoked: false, ...s})
  }
  action staleConsentCallback(generation: int): bool =
    if (generation == s.resetGeneration and s.unlocked and s.permission and s.notification)
      s' = evaluated(s.with("consent", true))
    else s' = evaluated(s)
  action crash = all {
    s.epoch < 8, s' = evaluated({crashLoop: true, epoch: s.epoch + 1, processed: false, invoked: false, ...s})
  }
  action step = {
    nondet value = Set(false, true).oneOf()
    nondet kind = Set("permission", "notification", "foreground", "unlock", "speech", "call", "otherMic", "silenced").oneOf()
    nondet ticket = Set(-1, 0, 1, 2, 3, 4, 5, 6, 7, 8).oneOf()
    any { enable, acquireLease, renewLease(value), loseLease, environment(kind, value),
      pause, captureUtterance, recognize(ticket, value), reset, staleConsentCallback(ticket), crash, s' = evaluated(s) }
  }
  val CaptureRequiresAuthority = holdsMic(s) implies
    (s.image and s.consent and s.enabled and s.permission and s.notification and s.foregroundUser and s.unlocked and s.lease == "fresh")
  val SilencedFramesDiscarded = s.processed implies phase(s) == "listening"
  val LostIndicatorLatches = s.indicatorLost implies not(holdsMic(s))
  val InvocationCurrent = s.invoked implies s.ticket == s.epoch and s.unlocked and phase(s) == "listening"
  val DecisionProjection = s.decision == phase(s) and s.microphone == holdsMic(s) and s.analyzing == (phase(s) == "listening")
  val safety = DecisionProjection and CaptureRequiresAuthority and SilencedFramesDiscarded and LostIndicatorLatches and InvocationCurrent

  run consentAndLeaseTest = init.then(enable).then(acquireLease).then(renewLease(true))
    .then(captureUtterance).then(recognize(2, true)).then(check(safety and s.invoked))
  run lostLeaseNeedsResumeTest = init.then(enable).then(acquireLease).then(renewLease(true))
    .then(loseLease).then(acquireLease).then(renewLease(true))
    .then(check(safety and phase(s) == "stopped-indicator-lost"))
    .then(enable).then(check(safety and phase(s) == "listening"))
  run resetInvalidatesQueuedRecognitionTest = init.then(enable).then(acquireLease)
    .then(renewLease(true)).then(captureUtterance).then(reset).then(recognize(2, true))
    .then(staleConsentCallback(0)).then(check(safety and not(s.consent) and not(s.invoked)))
  run silencedCaptureDropsFramesTest = init.then(enable).then(acquireLease).then(renewLease(true))
    .then(environment("silenced", true))
    .then(check(safety and holdsMic(s) and phase(s) == "paused-mic-unavailable" and not(s.processed)))
  run explainedPauseCanResumeTest = init.then(enable).then(acquireLease).then(renewLease(true))
    .then(renewLease(false)).then(check(not(holdsMic(s)) and not(s.indicatorLost)))
    .then(renewLease(true)).then(check(safety and phase(s) == "listening"))
}
