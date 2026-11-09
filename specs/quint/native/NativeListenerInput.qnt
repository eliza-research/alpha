/// Actual listener callback, frame and recognition path, under fixed PCM input classes.
module NativeListenerInput {
  type State = {now: int, quietSince: int, locked: bool, indicator: bool, lease: bool,
    lost: bool, leaseStopPosted: bool, inCall: bool, other: bool, silenced: bool, paused: bool,
    capture: bool, analyse: bool, active: bool, epoch: int, readTicket: int, allocations: int,
    reapplyQueued: bool, status: str, destroyed: bool, recognizing: bool,
    calls: int, asrTicket: int, asrSamples: int, samplesCleared: bool,
    chunks: int, samples: int, frameCleared: bool, actionQueued: str, actionTicket: int, invocations: int}
  var s: State
  action init = s' = {now: 10000, quietSince: 0, locked: false, indicator: true, lease: true,
    lost: false, leaseStopPosted: false, inCall: false, other: false, silenced: false, paused: false,
    capture: true, analyse: true, active: true, epoch: 2, readTicket: 2, allocations: 1,
    reapplyQueued: false, status: "LISTENING", destroyed: false, recognizing: false,
    calls: 0, asrTicket: -1, asrSamples: 0, samplesCleared: true,
    chunks: 0, samples: 0, frameCleared: true, actionQueued: "none", actionTicket: -1, invocations: 0}
  pure def classification(st: State): str =
    if (not(st.indicator)) "NOTIFICATIONS_REQUIRED"
    else if (st.lost or (st.capture and not(st.lease))) "STOPPED_INDICATOR_LOST"
    else if (st.paused) "PAUSED_USER"
    else if (st.inCall) "PAUSED_CALL"
    else if (st.other) "PAUSED_MIC_IN_USE"
    else if (not(st.lease)) "INDICATOR_UNAVAILABLE"
    else if (st.silenced) "PAUSED_MIC_UNAVAILABLE"
    else "LISTENING"
  action phone(mode: int): bool = all {
    not(s.destroyed), mode.in(Set(0, 1, 2, 6, 7)),
    s' = {...s, inCall: mode > 0 and mode <= 6, reapplyQueued: true}
  }
  action recordings(other: bool, silenced: bool): bool = all {
    not(s.destroyed), not(silenced) or s.capture,
    s' = {...s, other: other, silenced: silenced,
      reapplyQueued: s.reapplyQueued or other != s.other or silenced != s.silenced}
  }
  action playback(kind: str): bool = all {
    not(s.destroyed), kind.in(Set("media", "unknown", "beep", "ended")),
    if (kind.in(Set("media", "unknown"))) s' = {...s, quietSince: -1, epoch: s.epoch + 1, active: false}
    else if (s.quietSince == -1) s' = {...s, quietSince: s.now, reapplyQueued: true}
    else s' = s
  }
  action time(now: int): bool = all {
    now.in(Set(10000, 11499, 11500, 12500)), now >= s.now, s.lease,
    s' = {...s, now: now}
  }
  action lock(locked: bool): bool = s' = {...s, locked: locked}
  action indicator(visible: bool): bool = s' = {...s, indicator: visible}
  action loseLease = all {s.lease, s' = {...s, lease: false}}
  action applyPolicy = all {
    not(s.destroyed),
    val status = classification(s)
    val capture = status.in(Set("LISTENING", "PAUSED_MIC_UNAVAILABLE"))
    val foreground = capture or status.in(Set("PAUSED_USER", "PAUSED_CALL", "PAUSED_MIC_IN_USE"))
    val opened = capture and not(s.capture)
    all {
      not(opened) or s.allocations < 3,
      s' = {...s, status: status, capture: capture, analyse: status == "LISTENING", active: status == "LISTENING",
        epoch: s.epoch + (if (foreground and not(capture)) 3 else 2),
        readTicket: if (not(capture)) -1 else if (opened and status == "LISTENING") s.epoch + 2 else s.readTicket,
        lost: s.lost or (s.capture and not(s.lease)), leaseStopPosted: false,
        allocations: s.allocations + (if (opened) 1 else 0),
        silenced: s.silenced and capture, reapplyQueued: false}
    }
  }
  action frames(kind: str): bool = all {
    s.capture, kind.in(Set("speech", "short", "partial")), s.chunks < 350,
    val count = if (kind == "short") 49 else 50
    val analyses = s.analyse and s.active and s.lease and s.quietSince >= 0 and s.now >= s.quietSince + 1500
    val utterance = analyses and s.readTicket == s.epoch and kind.in(Set("speech", "partial")) and not(s.recognizing)
    val accepts = utterance and s.indicator
    s' = {...s, chunks: s.chunks + count * (if (kind == "partial") 2 else 1), samples: s.samples + count * 320,
      readTicket: if (s.active) s.epoch else -1, recognizing: s.recognizing or accepts, calls: s.calls + (if (accepts) 1 else 0),
      asrTicket: if (accepts) s.epoch else s.asrTicket, asrSamples: if (accepts) 4800 else s.asrSamples,
      samplesCleared: s.samplesCleared and not(accepts), lost: s.lost or not(s.lease),
      leaseStopPosted: s.leaseStopPosted or not(s.lease),
      reapplyQueued: s.reapplyQueued or not(s.lease) or (utterance and not(s.indicator))}
  }
  action asrReply(kind: str): bool = all {
    s.recognizing, kind.in(Set("invoke", "pause", "ignore")),
    {
      val posted = s.active and s.analyse and s.asrTicket == s.epoch and kind != "ignore"
      all {not(posted) or s.actionQueued == "none",
        s' = {...s, recognizing: false, samplesCleared: true,
          actionQueued: if (posted) kind else s.actionQueued, actionTicket: if (posted) s.asrTicket else s.actionTicket}}
    }
  }
  action act = all {
    s.actionQueued != "none",
    val current = s.active and s.actionTicket == s.epoch
    val accepted = current and classification(s) == "LISTENING"
    val pause = accepted and s.actionQueued == "pause"
    val invoke = accepted and s.actionQueued == "invoke" and not(s.locked)
    s' = {...s, actionQueued: "none", actionTicket: -1, invocations: s.invocations + (if (invoke) 1 else 0),
      lost: s.lost or (current and s.capture and not(s.lease)), paused: s.paused or pause, active: s.active and not(pause), epoch: s.epoch + (if (pause) 1 else 0),
      status: if (pause) "PAUSED_USER" else s.status}
  }
  action destroy = all {
    not(s.destroyed),
    s' = {...s, destroyed: true, capture: false, analyse: false, active: false, epoch: s.epoch + 1, readTicket: -1,
      reapplyQueued: false, silenced: false}
  }
  action step = {
    nondet flag = Bool.oneOf()
    nondet mode = Set(0, 1, 2, 6, 7).oneOf()
    nondet play = Set("media", "unknown", "beep", "ended").oneOf()
    nondet now = Set(10000, 11499, 11500, 12500).oneOf()
    nondet batch = Set("speech", "short", "partial").oneOf()
    nondet result = Set("invoke", "pause", "ignore").oneOf()
    any {all {s.epoch < 20, any {phone(mode), recordings(flag, false), recordings(false, flag),
      playback(play), applyPolicy, destroy}}, time(now), lock(flag), indicator(flag), loseLease,
      frames(batch), asrReply(result), act, s' = s}
  }
  val ActiveEpochNeedsCapture = s.active implies s.capture and s.analyse and not(s.destroyed)
  val RetirementStopsCapture = s.destroyed implies not(s.capture or s.active or s.analyse)
  val RecognitionOwnsSamples = s.recognizing implies s.calls > 0 and not(s.samplesCleared) and s.asrTicket >= 0
  val QueuedActionHasTicket = s.actionQueued == "none" or s.actionTicket >= 0
  val safety = ActiveEpochNeedsCapture and RetirementStopsCapture and RecognitionOwnsSamples and QueuedActionHasTicket
  run callInvalidatesHeldRecognitionTest = init.then(frames("speech")).then(phone(1)).then(applyPolicy)
    .then(asrReply("invoke")).expect(safety and not(s.capture) and s.actionQueued == "none")
  run exactPlaybackGuardTest = init.then(playback("media")).then(playback("ended")).then(applyPolicy)
    .then(time(11499)).then(frames("speech")).expect(s.calls == 0).then(time(11500)).then(frames("partial"))
    .expect(safety and s.calls == 1 and s.asrSamples == 4800)
  run revokedLeaseSuppressesFramesTest = init.then(loseLease).then(frames("speech")).then(applyPolicy)
    .expect(safety and s.calls == 0 and s.lost and not(s.capture))
  run pendingReadRetainsOldEpochTest = init.then(recordings(false, true)).then(applyPolicy)
    .then(frames("speech")).then(recordings(false, false)).then(applyPolicy).then(frames("speech"))
    .expect(safety and s.calls == 0 and s.readTicket == s.epoch).then(frames("speech")).expect(s.calls == 1)
  run lateWakeCannotInvokeAfterDestroyTest = init.then(frames("speech")).then(asrReply("invoke"))
    .then(destroy).then(act).expect(safety and s.invocations == 0)
  run lockedPauseIsAllowedTest = init.then(frames("speech")).then(asrReply("pause")).then(lock(true)).then(act)
    .then(applyPolicy).expect(safety and s.paused and not(s.capture) and s.invocations == 0)
}
