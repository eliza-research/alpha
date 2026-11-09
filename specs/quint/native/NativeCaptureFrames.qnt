/// Actual capture-loop input/output relation, including pre-roll and stop-tail flushing.
module NativeCaptureFrames {
  type Packet = {frames: List[int], edges: List[str], peak: int}
  type Pipeline = {n: int, speaking: bool, above: int, below: int, preroll: List[int],
    frames: List[int], edges: List[str], windows: int, peak: int, packets: List[Packet]}
  type State = {started: bool, running: bool, ended: bool, history: List[int], packets: List[Packet],
    reads: int, negativeReads: int, attached: bool, detectorReset: bool, sourceClosed: bool, detectorClosed: bool, buffersZeroed: bool,
    error: str, flush: bool}
  var s: State
  pure val empty: Pipeline = {n: 0, speaking: false, above: 0, below: 0, preroll: List(),
    frames: List(), edges: List(), windows: 0, peak: 0, packets: List()}
  pure def window(value: Pipeline, input: int): Pipeline = {
    val p = if (input < 0) 0 else input
    val n = value.n + 1
    val above = if (not(value.speaking) and p >= 500) value.above + 1 else 0
    val below = if (value.speaking and p < 350) value.below + 1 else 0
    val opens = not(value.speaking) and above >= 2
    val closes = value.speaking and below >= 16
    val speaking = if (opens) true else if (closes) false else value.speaking
    val appended = value.preroll.append(n)
    val preroll = if (opens) List() else if (not(speaking) and not(closes))
      (if (appended.length() > 10) appended.slice(appended.length() - 10, appended.length()) else appended) else value.preroll
    val frames = if (opens) value.frames.concat(value.preroll).append(n)
      else if (speaking or closes) value.frames.append(n) else value.frames
    val edges = if (opens) value.edges.append("speech-start") else if (closes) value.edges.append("speech-end") else value.edges
    val emit = value.windows + 1 >= 3 or opens or closes
    {n: n, speaking: speaking, above: if (opens or closes) 0 else above, below: if (opens or closes) 0 else below,
      preroll: preroll, frames: if (emit) List() else frames, edges: if (emit) List() else edges,
      windows: if (emit) 0 else value.windows + 1, peak: if (emit) 0 else n,
      packets: if (emit) value.packets.append({frames: frames, edges: edges, peak: n}) else value.packets}
  }
  pure def predicted(history: List[int], flush: bool): List[Packet] = {
    val result = history.foldl(empty, (value, input) => window(value, input))
    if (flush and (result.frames.length() > 0 or result.edges.length() > 0))
      result.packets.append({frames: result.frames, edges: result.edges, peak: result.peak}) else result.packets
  }
  action init = s' = {started: false, running: false, ended: false, history: List(), packets: List(),
    reads: 0, negativeReads: 0, attached: false, detectorReset: false, sourceClosed: false, detectorClosed: false, buffersZeroed: true,
    error: "none", flush: false}
  action start = all {not(s.started), s' = {...s, started: true, running: true, attached: true, detectorReset: true}}
  action accept(input: int, pieces: int): bool = all {
    s.started, not(s.ended), s.history.length() < 40,
    input.in(Set(-2001, -2000, -1001, -1000, -999, -1, 0, 349, 350, 499, 500, 1000, 1001)), pieces.in(Set(1, 4)),
    val history = s.history.append(input)
    s' = {...s, history: history, reads: s.reads + pieces, packets: predicted(history, false), buffersZeroed: false}
  }
  action stop(sourceOk: bool, detectorOk: bool, call: bool): bool = all {
    s.started,
    s' = if (s.ended) {...s, running: false}
      else {...s, running: false, ended: true, attached: false, sourceClosed: sourceOk, detectorClosed: detectorOk,
        buffersZeroed: true, flush: true, packets: predicted(s.history, true),
        error: if (not(sourceOk and detectorOk)) "capture" else if (call) "call" else "none"}
  }
  action readFailure = all {
    s.started, not(s.ended),
    s' = {...s, ended: true, attached: false, negativeReads: s.negativeReads + 1, sourceClosed: true,
      detectorClosed: true, buffersZeroed: true, error: "capture", flush: false}
  }
  action step = {
    nondet input = Set(-2001, -2000, -1001, -1000, -999, -1, 0, 349, 350, 499, 500, 1000, 1001).oneOf()
    nondet pieces = Set(1, 4).oneOf()
    nondet flag = Bool.oneOf()
    any {start, accept(input, pieces), stop(flag, true, false), stop(true, flag, false), stop(true, true, true), readFailure, s' = s}
  }
  val PacketAgreement = s.packets == predicted(s.history, s.flush)
  val TerminalBuffersCleared = s.ended implies s.buffersZeroed and not(s.attached)
  val Bounded = s.history.length() <= 40 and s.reads <= 160 and s.negativeReads <= 1
  val safety = PacketAgreement and TerminalBuffersCleared and Bounded
  run tenWindowPrerollTest = init.then(start).then(12.reps(_ => accept(0, 1))).then(accept(500, 1)).then(accept(500, 1))
    .expect(safety and s.packets.nth(4).frames == List(4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14))
  run stopFlushesOpenTailTest = init.then(start).then(4.reps(_ => accept(500, 1))).then(stop(true, true, false))
    .expect(safety and s.packets.nth(1).frames == List(3, 4))
  run readFailureDropsUnpublishedTailTest = init.then(start).then(3.reps(_ => accept(500, 1))).then(readFailure)
    .expect(safety and s.running and s.packets.length() == 1).then(stop(true, true, false)).expect(safety and not(s.running))
  run closeFailureStillClearsBuffersTest = init.then(start).then(accept(500, 4)).then(stop(false, true, false))
    .expect(safety and s.error == "capture" and s.buffersZeroed)
}
