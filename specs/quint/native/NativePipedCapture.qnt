/// Shared controller join between owner-bound ASR warmup and native capture.
module NativePipedCapture {
  type State = {epoch: int, foreground: bool, destroyed: bool, inCall: bool, owned: bool,
    attempt: str, hasPipe: bool, ready: str, closed: str, pending: str, opening: bool,
    published: bool, physical: bool, current: bool, discard: bool, frames: int,
    rendererPcm: int, transcripts: int, failure: str, stop: str, closeReason: str}
  var s: State
  action init = s' = {epoch: 0, foreground: true, destroyed: false, inCall: false, owned: true,
    attempt: "none", hasPipe: false, ready: "none", closed: "none", pending: "none", opening: false,
    published: false, physical: false, current: false, discard: false, frames: 0,
    rendererPcm: 0, transcripts: 0, failure: "none", stop: "none", closeReason: "none"}
  action start = all {
    s.attempt == "none", s.foreground, s.owned, not(s.destroyed or s.inCall),
    s' = {...s, attempt: "pending", hasPipe: true, ready: "pending", closed: "pending", pending: "warm", current: true}
  }
  action retireOwner = s' = {...s, owned: false}
  action call(value: bool): bool = s' = {...s, inCall: value}
  action pause = all {
    s.epoch < 2,
    s' = {...s, epoch: s.epoch + 1, foreground: false, current: false, discard: true, physical: false,
      published: false, closeReason: if (s.attempt == "pending") "start" else "lifecycle",
      pending: if (s.pending == "warm") "warm" else if (s.hasPipe) "close" else "none"}
  }
  action destroy = all {
    not(s.destroyed), s.epoch < 2,
    s' = {...s, epoch: s.epoch + 1, destroyed: true, current: false, discard: true, physical: false,
      published: false, closeReason: if (s.attempt == "pending") "start" else "lifecycle",
      pending: if (s.pending == "warm") "warm" else if (s.hasPipe) "close" else "none"}
  }
  action warmReply(success: bool): bool = all {
    s.pending == "warm",
    val ready = success and s.owned
    val proceeds = ready and s.current
    s' = {...s, ready: if (ready) "true" else "false", opening: proceeds,
      current: if (ready) s.current else false,
      failure: if (not(ready) and not(s.discard)) "TRANSPORT" else s.failure,
      pending: if (proceeds) "none" else if (s.owned) "close" else "none",
      closeReason: if (proceeds) "none" else "start", hasPipe: s.owned,
      closed: if (s.owned) s.closed else "false", attempt: if (s.owned) s.attempt else "cancelled"}
  }
  action finishOpen = all {
    s.opening,
    val accepted = s.current and s.foreground and not(s.destroyed or s.inCall)
    s' = {...s, opening: false, published: accepted, physical: accepted,
      attempt: if (accepted) "recording" else if (s.closed != "pending") "cancelled" else "pending",
      pending: if (accepted or s.closed != "pending") "none" else "close",
      hasPipe: s.hasPipe and (accepted or s.closed == "pending"), closeReason: if (accepted) "none" else "start"}
  }
  action frames = all {
    s.attempt == "recording", s.frames < 2,
    val delivered = s.foreground and not(s.destroyed or s.discard)
    s' = {...s, frames: s.frames + (if (delivered) 1 else 0),
      pending: if (delivered and s.pending == "none" and s.closed == "pending") "batch" else s.pending}
  }
  action batchReply(kind: str): bool = all {
    s.pending == "batch", kind.in(Set("ok", "final", "asr", "error")), s.transcripts < 2,
    val failed = not(s.owned) or kind == "error"
    val deliver = s.foreground and not(s.destroyed or s.discard)
    s' = {...s, pending: if (failed and s.owned) "close" else "none",
      current: if (failed) false else s.current, physical: if (failed) false else s.physical,
      failure: if (failed and deliver) "TRANSPORT" else if (kind == "asr" and deliver) "ASR_FAILED" else s.failure,
      closed: if (not(s.owned)) "false" else s.closed,
      closeReason: if (failed) "pipe" else s.closeReason,
      transcripts: s.transcripts + (if (not(failed) and deliver and kind == "final") 1 else 0)}
  }
  action stop(discard: bool): bool = all {
    s.attempt == "recording", s.stop == "none", s.closed == "pending",
    s' = {...s, current: false, discard: s.discard or discard, physical: false, published: false,
      stop: "pending", closeReason: "stop", pending: "close"}
  }
  action stopFinishedPipe = all {
    s.attempt == "recording", s.stop == "none", s.closed != "pending",
    s' = {...s, current: false, physical: false, published: false, hasPipe: false, stop: s.closed, closeReason: "stop"}
  }
  action closeReply(acknowledged: bool): bool = all {
    s.pending == "close",
    val closed = if (s.owned and acknowledged) "true" else "false"
    s' = {...s, pending: "none", closed: closed, hasPipe: s.opening or s.closeReason == "pipe",
      attempt: if (s.attempt == "pending" and not(s.opening)) "cancelled" else s.attempt,
      stop: if (s.stop == "pending") closed else s.stop}
  }
  action step = {
    nondet flag = Bool.oneOf()
    nondet kind = Set("ok", "final", "asr", "error").oneOf()
    any {start, retireOwner, call(flag), pause, destroy, warmReply(flag), finishOpen, frames,
      batchReply(kind), stop(flag), stopFinishedPipe, closeReply(flag), s' = s}
  }
  val WarmBeforeCapture = s.published implies s.ready == "true"
  val NoPcmToRenderer = s.rendererPcm == 0
  val CompletedStartHasNoPendingOpen = s.attempt == "cancelled" implies not(s.opening or s.physical)
  val Bounded = s.epoch.in(0.to(2)) and s.frames.in(0.to(2)) and s.transcripts.in(0.to(2))
  val safety = WarmBeforeCapture and NoPcmToRenderer and CompletedStartHasNoPendingOpen and Bounded
  run warmBeforeNativeOpenTest = init.then(start).then(warmReply(true)).expect(safety and s.opening and not(s.physical))
    .then(finishOpen).expect(safety and s.published)
  run callDuringOpenRefusesPublicationTest = init.then(start).then(warmReply(true)).then(call(true))
    .then(finishOpen).then(closeReply(true)).expect(safety and s.attempt == "cancelled")
  run retiredWarmCannotOpenTest = init.then(start).then(retireOwner).then(warmReply(true))
    .expect(safety and s.attempt == "cancelled" and not(s.physical))
  run discardClosesWithoutRendererAudioTest = init.then(start).then(warmReply(true)).then(finishOpen)
    .then(stop(true)).then(frames).then(closeReply(true)).expect(safety and s.frames == 0 and s.stop == "true")
  run failedPipeRetainsControllerUntilStopTest = init.then(start).then(warmReply(true)).then(finishOpen)
    .then(frames).then(batchReply("error")).then(closeReply(false)).then(stopFinishedPipe)
    .expect(safety and not(s.hasPipe) and s.stop == "false")
}
