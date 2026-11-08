// One StreamingSpeechPlayback writer and its single terminal callback.
module StreamingPlayback {
  type State = {
    started: bool, terminal: bool, stopped: bool, writer: str, outputOpen: bool,
    queue: int, complete: bool, chunkRemaining: int, produced: int, written: int,
    played: int, firstFrame: bool, audibleFrame: int, audibleReported: bool,
    timestampAvailable: bool, headFallback: bool, callback: str, callbacks: int,
    failure: str, zeroed: int, ducked: bool
  }
  var s: State
  action check(condition: bool): bool = all {assert(condition), s' = s}
  action init = s' = {
    started: false, terminal: false, stopped: false, writer: "none", outputOpen: false,
    queue: 0, complete: false, chunkRemaining: 0, produced: 0, written: 0,
    played: 0, firstFrame: false, audibleFrame: -1, audibleReported: false,
    timestampAvailable: false, headFallback: false, callback: "none", callbacks: 0,
    failure: "none", zeroed: 0, ducked: false
  }
  // Each admitted chunk contains two abstract sample frames, preserving partial writes.
  action offer(audible: bool): bool = all {
    not(s.stopped), not(s.terminal), not(s.complete), s.produced < 4, s.queue < 2,
    s' = {queue: s.queue + 1, produced: s.produced + 2,
      audibleFrame: if (s.audibleFrame < 0 and audible) s.produced else s.audibleFrame, ...s}
  }
  action complete = all {
    not(s.stopped), not(s.terminal), s' = s.with("complete", true)
  }
  action start = all {
    not(s.started), not(s.terminal),
    s' = {started: true, writer: "opening", ...s}
  }
  action outputOpened(success: bool): bool = all {
    s.writer == "opening",
    s' = if (s.stopped or s.terminal) {writer: "released", outputOpen: false, ...s}
      else if (success) {writer: "waiting", outputOpen: true, ...s}
      else {writer: "released", terminal: true, stopped: true, queue: 0,
        zeroed: s.queue * 2, callback: "failed", callbacks: 1, failure: "output-unavailable", ...s}
  }
  action take = all {
    s.writer == "waiting", s.queue > 0, not(s.stopped),
    s' = {queue: s.queue - 1, chunkRemaining: 2, writer: "writing", ...s}
  }
  action write(count: int): bool = all {
    s.writer == "writing", not(s.stopped), count.in(Set(0, 1, 2)), count <= s.chunkRemaining,
    s' = {chunkRemaining: s.chunkRemaining - count, written: s.written + count,
      writer: if (count == s.chunkRemaining) "waiting" else "writing",
      firstFrame: s.firstFrame or count == s.chunkRemaining,
      zeroed: if (count == s.chunkRemaining) s.zeroed + 2 else s.zeroed, ...s}
  }
  action beginDrain = all {
    s.writer == "waiting", s.queue == 0, s.complete, not(s.stopped),
    s' = s.with("writer", "draining")
  }
  action advanceHead(frames: int): bool = all {
    s.outputOpen, not(s.stopped), frames >= s.played, frames <= s.written,
    s' = {played: frames, headFallback: s.headFallback or
      (not(s.audibleReported) and s.audibleFrame >= 0 and frames > s.audibleFrame), ...s}
  }
  action reportTimestamp = all {
    s.outputOpen, not(s.stopped), not(s.audibleReported), s.audibleFrame >= 0,
    s' = {timestampAvailable: true, audibleReported: true, ...s}
  }
  action finish = all {
    s.writer == "draining", s.played == s.written, not(s.stopped), not(s.terminal),
    s' = {writer: "released", outputOpen: false, terminal: true,
      callback: "ended", callbacks: 1,
      audibleReported: s.audibleReported or s.headFallback, ...s}
  }
  action playbackFail(reason: str): bool = all {
    reason.in(Set("synthesis-stalled", "playback-drain-timeout", "output-write", "interrupted")),
    not(s.terminal),
    reason != "synthesis-stalled" or (s.writer == "waiting" and s.queue == 0 and not(s.complete)),
    reason != "playback-drain-timeout" or (s.writer == "draining" and s.played < s.written),
    reason != "output-write" or s.writer == "writing",
    s' = {terminal: true, stopped: true, callback: "failed", callbacks: 1,
      failure: reason, queue: 0, zeroed: s.zeroed + s.queue * 2 + s.chunkRemaining,
      chunkRemaining: 0, ...s}
  }
  // Owner stop is terminal and silent. Cleanup may still be releasing the output.
  action stop = s' = {terminal: true, stopped: true, queue: 0,
    zeroed: s.zeroed + s.queue * 2 + s.chunkRemaining, chunkRemaining: 0, ...s}
  action writerReleased = all {
    s.stopped, s' = {writer: "released", outputOpen: false, ...s}
  }
  action duck(value: bool): bool = s' = s.with("ducked", value)
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet frames = 0.to(4).oneOf()
    nondet count = 0.to(2).oneOf()
    nondet reason = Set("synthesis-stalled", "playback-drain-timeout", "output-write", "interrupted").oneOf()
    any {offer(flag), complete, start, outputOpened(flag), take, write(count), beginDrain,
      advanceHead(frames), reportTimestamp, finish, playbackFail(reason), stop, writerReleased, duck(flag), s' = s}
  }
  val OneTerminalCallback = s.callbacks.in(Set(0, 1)) and
    ((s.callback == "none") iff s.callbacks == 0)
  val EndedOnlyAfterDrain = s.callback == "ended" implies s.complete and s.played == s.written and s.queue == 0 and s.chunkRemaining == 0
  val QueueAndFramesBounded = s.queue.in(0.to(2)) and s.chunkRemaining.in(0.to(2)) and
    s.played >= 0 and s.played <= s.written and s.written <= s.produced and s.produced.in(Set(0, 2, 4))
  val TerminalStopsNewFrames = s.stopped implies s.terminal and s.queue == 0 and s.chunkRemaining == 0
  val WriterNeedsOutput = s.writer.in(Set("waiting", "writing", "draining")) and not(s.stopped) implies s.outputOpen
  val AudibleHasEvidence = s.audibleReported implies s.audibleFrame >= 0 and (s.timestampAvailable or s.headFallback)
  val safety = OneTerminalCallback and EndedOnlyAfterDrain and QueueAndFramesBounded and
    TerminalStopsNewFrames and WriterNeedsOutput and AudibleHasEvidence

  run partialWriteThenDrainTest = init.then(offer(true)).then(complete).then(start)
    .then(outputOpened(true)).then(take).then(write(0)).then(write(1))
    .then(check(not(s.firstFrame) and s.chunkRemaining == 1)).then(write(1))
    .then(beginDrain).then(advanceHead(2)).then(finish)
    .then(check(safety and s.callback == "ended" and s.audibleReported))
  run noSuccessBeforePlayedHeadTest = init.then(offer(false)).then(complete).then(start)
    .then(outputOpened(true)).then(take).then(write(2)).then(beginDrain)
    .then(playbackFail("playback-drain-timeout")).then(writerReleased)
    .then(check(safety and s.callback == "failed"))
  run stopDuringOpenTest = init.then(start).then(stop).then(outputOpened(true))
    .then(check(safety and not(s.outputOpen) and s.callbacks == 0))
  run stopDuringPartialWriteTest = init.then(offer(true)).then(start).then(outputOpened(true))
    .then(take).then(write(1)).then(stop).then(writerReleased)
    .then(check(safety and s.callbacks == 0 and s.queue == 0))
  run failureWinsTerminalRaceTest = init.then(start).then(outputOpened(true)).then(playbackFail("synthesis-stalled"))
    .then(stop).then(writerReleased).then(check(safety and s.callbacks == 1 and s.callback == "failed"))
  run timestampReportedOnceTest = init.then(offer(true)).then(complete).then(start)
    .then(outputOpened(true)).then(take).then(write(2)).then(reportTimestamp)
    .then(beginDrain).then(advanceHead(2)).then(finish)
    .then(check(safety and s.timestampAvailable and not(s.headFallback) and s.callbacks == 1))
  run outputCreationFailureTest = init.then(offer(false)).then(start).then(outputOpened(false))
    .then(check(safety and s.callback == "failed" and s.zeroed == 2))
}
