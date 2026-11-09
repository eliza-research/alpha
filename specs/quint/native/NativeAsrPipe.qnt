/// Bounded shared LiveSegmentPipe queue, ASR warmup, cutoff and close acknowledgment.
module NativeAsrPipe {
  type State = {started: bool, phase: str, owned: bool, closing: bool, cancelled: bool, finished: bool,
    ready: str, closed: str, cutoff: int, queued: List[int], lastMask: int, lastCutoff: int, accepted: bool,
    warmPosts: int, batchPosts: int, closePosts: int, results: int, failures: int, failure: str, cancels: int}
  var s: State
  pure def filtered(mask: int, cutoff: int): int =
    if (cutoff < 0) 0 else if (cutoff < 2) ((if (mask % 2 == 1) 1 else 0) + (if ((mask / 4) % 2 == 1) 4 else 0)) else mask
  pure def failedState(value: State, code: str): State = {...value, closing: true, cancelled: true, queued: List(),
    failures: value.failures + (if (value.cancelled or value.finished) 0 else 1),
    failure: if (value.cancelled or value.finished) value.failure else code, cancels: value.cancels + 1}
  action init = s' = {started: false, phase: "cold", owned: true, closing: false, cancelled: false, finished: false,
    ready: "pending", closed: "pending", cutoff: 3, queued: List(), lastMask: 0, lastCutoff: 3, accepted: false,
    warmPosts: 0, batchPosts: 0, closePosts: 0, results: 0, failures: 0, failure: "none", cancels: 0}
  action ownership(value: bool): bool = all {not(value), s' = {...s, owned: value}}
  action start(accepted: bool): bool = all {
    not(s.started), s.cancels < 5,
    s' = if (accepted) {...s, started: true, phase: "queued"}
      else {...failedState(s, "BUSY"), started: true, phase: "finished", ready: "false", closed: "false", finished: true}
  }
  action startRejectedBeforeNotification = all {
    not(s.started), s.cancels < 5,
    s' = {...s, started: true, phase: "finished", closing: true, cancelled: true, queued: List(),
      finished: true, ready: "false", closed: "false", cancels: s.cancels + 1}
  }
  action beginWarm = all {
    s.phase == "queued", s.cancels < 5,
    s' = if (s.closing) {...s, phase: "close-ready", ready: "false"}
      else if (not(s.owned)) {...failedState(s, "TRANSPORT"), phase: "close-ready", ready: "false"}
      else {...s, phase: "warming", warmPosts: s.warmPosts + 1, lastMask: 0, lastCutoff: s.cutoff}
  }
  action offer(mask: int, valid: bool): bool = all {
    mask.in(0.to(16)), s.cancels < 5,
    s' = if (mask == 0) {...s, accepted: true}
      else if (s.closing or s.finished) {...s, accepted: false}
      else if (not(valid) or s.queued.length() == 8) {...failedState(s, "BACKPRESSURE"), accepted: false}
      else {...s, accepted: true, queued: s.queued.append(mask)}
  }
  action cutoff(value: int): bool = all {
    value.in(Set(-1, 0, 1, 2, 3)),
    s' = {...s, cutoff: if (s.cutoff == -1 or value == -1) -1 else (if (s.cutoff < value) s.cutoff else value)}
  }
  action close(discard: bool, value: int): bool = all {
    value.in(Set(-1, 0, 1, 2, 3)), s.cancels < 5,
    s' = {...s, closing: true, cancelled: s.cancelled or discard,
      cutoff: if (s.cutoff == -1 or value == -1) -1 else (if (s.cutoff < value) s.cutoff else value),
      queued: if (s.cancelled or discard) List() else s.queued,
      cancels: s.cancels + (if (discard) 1 else 0)}
  }
  action warmReply(kind: str): bool = all {
    s.phase == "warming", kind.in(Set("ok", "final", "invalid", "malformed", "asr", "error", "throw")), s.cancels < 5, s.results < 3,
    val success = kind.in(Set("ok", "final")) or (s.cancelled and kind == "invalid")
    s' = if (not(s.owned) or not(success)) {...failedState(s, "TRANSPORT"), phase: "close-ready", ready: "false"}
      else {...s, phase: "idle", ready: "true", results: s.results + (if (kind == "final" and not(s.cancelled)) 1 else 0)}
  }
  action take = all {
    s.phase == "idle", s.cancels < 5, s.batchPosts < 3,
    if (s.queued.length() == 0) all {s.closing, s' = {...s, phase: "close-ready"}}
    else {
      val mask = filtered(s.queued.head(), s.cutoff)
      val rest = s.queued.tail()
      s' = if (not(s.owned) or s.queued.head() == 16) {...failedState(s, "TRANSPORT"), phase: "close-ready"}
        else if (s.cancelled or mask == 0) {...s, queued: rest}
        else {...s, queued: rest, phase: "sending", lastMask: mask, lastCutoff: s.cutoff, batchPosts: s.batchPosts + 1}
    }
  }
  action batchReply(kind: str): bool = all {
    s.phase == "sending", kind.in(Set("ok", "final", "invalid", "malformed", "asr", "error", "throw")), s.cancels < 5, s.results < 3, s.failures < 4,
    s' = if (not(s.owned) or kind.in(Set("throw", "malformed")) or (not(s.cancelled) and kind.in(Set("invalid", "error"))))
      {...failedState(s, "TRANSPORT"), phase: "close-ready"}
      else {...s, phase: "idle", results: s.results + (if (kind == "final" and not(s.cancelled)) 1 else 0),
        failures: s.failures + (if (kind == "asr" and not(s.cancelled)) 1 else 0),
        failure: if (kind == "asr" and not(s.cancelled)) "ASR_FAILED" else s.failure}
  }
  action beginClose = all {
    s.phase == "close-ready",
    s' = if (s.owned) {...s, phase: "closing", closePosts: s.closePosts + 1}
      else {...s, phase: "finished", finished: true, queued: List(), closed: "false", ready: if (s.ready == "pending") "false" else s.ready}
  }
  action closeReply(kind: str, acknowledged: bool): bool = all {
    s.phase == "closing", kind.in(Set("ok", "final", "invalid", "malformed", "asr", "error", "throw")), s.results < 3, s.failures < 4,
    val valid = s.owned and (kind.in(Set("ok", "final")) or (s.cancelled and kind == "invalid"))
    s' = {...s, phase: "finished", finished: true, queued: List(), ready: if (s.ready == "pending") "false" else s.ready,
      closed: if (valid and acknowledged) "true" else "false",
      results: s.results + (if (s.owned and kind == "final" and not(s.cancelled)) 1 else 0),
      failures: s.failures + (if (s.owned and kind == "asr" and not(s.cancelled)) 1 else 0),
      failure: if (s.owned and kind == "asr" and not(s.cancelled)) "ASR_FAILED" else s.failure}
  }
  action step = {
    nondet flag = Bool.oneOf()
    nondet mask = Set(0, 1, 2, 4, 8, 9, 6, 15, 16).oneOf()
    nondet limit = Set(-1, 0, 1, 2, 3).oneOf()
    nondet kind = Set("ok", "final", "invalid", "malformed", "asr", "error", "throw").oneOf()
    any {ownership(flag), start(flag), startRejectedBeforeNotification, beginWarm, offer(mask, flag), cutoff(limit), close(flag, limit),
      warmReply(kind), take, batchReply(kind), beginClose, closeReply(kind, flag), s' = s}
  }
  val QueueBound = s.queued.length() <= 8
  val CancelledQueueEmpty = s.cancelled implies s.queued.length() == 0
  val FinishedSettlesFutures = s.finished implies s.ready != "pending" and s.closed != "pending"
  val OneWarmAndClose = s.warmPosts <= 1 and s.closePosts <= 1
  val CutoffBoundsDispatch = s.lastMask.in(0.to(15)) and filtered(s.lastMask, s.lastCutoff) == s.lastMask
  val safety = QueueBound and CancelledQueueEmpty and FinishedSettlesFutures and OneWarmAndClose and CutoffBoundsDispatch
  run rejectedCancellationSettlesTest = init.then(startRejectedBeforeNotification)
    .expect(safety and s.ready == "false" and s.closed == "false" and s.failures == 0)
  run warmThenConfirmedCloseTest = init.then(start(true)).then(beginWarm).then(warmReply("ok")).then(close(false, 3))
    .then(take).then(beginClose).then(closeReply("ok", true)).expect(safety and s.closed == "true")
  run cancelledWarmCanStillReportReadyTest = init.then(start(true)).then(beginWarm).then(close(true, 1)).then(warmReply("ok"))
    .then(take).then(beginClose).then(closeReply("ok", true)).expect(safety and s.ready == "true" and s.cancelled)
  run staleOwnerCannotSendCleanupTest = init.then(start(true)).then(beginWarm).then(ownership(false)).then(warmReply("ok"))
    .then(beginClose).expect(safety and s.closePosts == 0 and s.closed == "false")
  run ninthBatchFailsClosedTest = init.then(start(true)).then(beginWarm).then(offer(1, true)).then(offer(1, true))
    .then(offer(1, true)).then(offer(1, true)).then(offer(1, true)).then(offer(1, true)).then(offer(1, true)).then(offer(1, true))
    .then(offer(1, true)).expect(safety and s.failure == "BACKPRESSURE" and s.queued.length() == 0)
  run cutoffDropsLaterFramesTest = init.then(start(true)).then(beginWarm).then(offer(9, true)).then(cutoff(1))
    .then(warmReply("ok")).then(take).expect(safety and s.lastMask == 1)
  run asrFailureDoesNotRetireWholePipeTest = init.then(start(true)).then(beginWarm).then(warmReply("ok")).then(offer(1, true))
    .then(take).then(batchReply("asr")).expect(safety and s.failures == 1 and not(s.cancelled))
}
