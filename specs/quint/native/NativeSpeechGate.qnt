/// Always-on listener SpeechGate's adaptive floor and exact PCM ring/utterance buffers.
module NativeSpeechGate {
  type State = {floor: int, lastLevel: int, lastSpeech: bool, active: bool,
    pre: List[int], preCount: int, preNext: int, utterance: List[int],
    speechRun: int, speechFrames: int, silenceRun: int, outputs: int, lastOutput: List[int], tailZero: bool}
  var s: State
  pure val emptyRing = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  pure val levels = Map(0 -> -120000, 30 -> -60767, 103 -> -50052, 104 -> -49968, 110 -> -49481,
    1000 -> -30309, 10000 -> -10309, 16000 -> -6227)
  pure def permittedSpeech(level: int, floor: int, speech: bool): bool =
    if (level <= -50001 or level - floor <= 8998) not(speech)
    else if (level >= -49999 and level - floor >= 9002) speech else true
  pure def floorAfter(level: int, floor: int, speech: bool): int =
    if (level < floor) floor + (level - floor) * 3 / 10
    else if (speech) floor + (level - floor) / 1000
    else floor + (level - floor) / 200
  pure def ringContents(ring: List[int], count: int, cursor: int): List[int] =
    if (count < 15) ring.slice(0, count)
    else ring.slice(cursor, 15).concat(if (cursor == 0) [] else ring.slice(0, cursor))
  pure def closeTurn(st: State): State = {
    val keep = st.speechFrames >= 15
    val kept = if (st.silenceRun >= st.utterance.length()) 1 else st.utterance.length() - st.silenceRun
    {...st, active: false, utterance: [], speechFrames: 0, silenceRun: 0, speechRun: 0,
      outputs: st.outputs + (if (keep) 1 else 0), lastOutput: if (keep) st.utterance.slice(0, kept) else st.lastOutput}
  }
  pure def bufferFrame(st: State, sample: int, speech: bool): State =
    if (st.active) {
      val updated = {...st, utterance: st.utterance.append(sample),
        speechFrames: st.speechFrames + (if (speech) 1 else 0), silenceRun: if (speech) 0 else st.silenceRun + 1}
      if (updated.silenceRun >= 35 or updated.utterance.length() >= 400) closeTurn(updated) else updated
    } else {
      val pre = st.pre.replaceAt(st.preNext, sample)
      val count = if (st.preCount < 15) st.preCount + 1 else 15
      val cursor = (st.preNext + 1) % 15
      val consecutive = if (speech) st.speechRun + 1 else 0
      if (consecutive >= 3) {...st, pre: emptyRing, preCount: 0, preNext: 0, active: true,
        utterance: ringContents(pre, count, cursor), speechFrames: consecutive, speechRun: 0, silenceRun: 0}
      else {...st, pre: pre, preCount: count, preNext: cursor, speechRun: consecutive}
    }
  action init = s' = {floor: -60000, lastLevel: -120000, lastSpeech: false, active: false,
    pre: emptyRing, preCount: 0, preNext: 0, utterance: [], speechRun: 0, speechFrames: 0,
    silenceRun: 0, outputs: 0, lastOutput: [], tailZero: true}
  action accept(sample: int, level: int, speech: bool, observedFloor: int): bool = all {
    sample.in(levels.keys()), level == levels.get(sample), permittedSpeech(level, s.floor, speech),
    observedFloor >= -120000, observedFloor <= 0,
    {
      val predicted = floorAfter(level, s.floor, speech)
      all {observedFloor >= predicted - 2, observedFloor <= predicted + 2,
        s' = bufferFrame({...s, floor: observedFloor, lastLevel: level, lastSpeech: speech}, sample, speech)}
    }
  }
  action reset = s' = {...s, active: false, pre: emptyRing, preCount: 0, preNext: 0,
    utterance: [], speechRun: 0, speechFrames: 0, silenceRun: 0}
  action invalidFrame = s' = s
  action step = any {
    all {s.outputs < 3, {
      nondet sample = levels.keys().oneOf()
      nondet speech = Bool.oneOf()
      nondet offset = Set(-2, -1, 0, 1, 2).oneOf()
      val level = levels.get(sample)
      accept(sample, level, speech, floorAfter(level, s.floor, speech) + offset)
    }}, reset, invalidFrame, s' = s
  }
  val RingBounded = s.pre.length() == 15 and s.preCount.in(0.to(15)) and s.preNext.in(0.to(14))
  val ActiveOwnsUtterance = s.active implies s.utterance.length() >= 3 and s.preCount == 0 and s.speechFrames >= 3
  val OutputBounded = s.utterance.length() < 400 and s.lastOutput.length() <= 400 and s.speechFrames <= s.utterance.length()
  val InactiveBuffersCleared = (s.active or s.utterance.length() == 0) and s.tailZero
  val FloorBounded = -120000 <= s.floor and s.floor <= 0
  val safety = RingBounded and ActiveOwnsUtterance and OutputBounded and InactiveBuffersCleared and FloorBounded
  run threeFramesOpenTest = init.then(accept(16000, -6227, true, floorAfter(-6227, s.floor, true))).then(accept(16000, -6227, true, floorAfter(-6227, s.floor, true))).then(accept(16000, -6227, true, floorAfter(-6227, s.floor, true)))
    .expect(safety and s.active and s.utterance == [16000, 16000, 16000])
  run resetKeepsNoiseFloorTest = init.then(accept(0, -120000, false, floorAfter(-120000, s.floor, false))).then(accept(16000, -6227, true, floorAfter(-6227, s.floor, true))).then(reset)
    .expect(safety and not(s.active) and s.pre == emptyRing and s.floor < -60000)
  run silenceBreaksOpeningTest = init.then(accept(16000, -6227, true, floorAfter(-6227, s.floor, true))).then(accept(16000, -6227, true, floorAfter(-6227, s.floor, true))).then(accept(0, -120000, false, floorAfter(-120000, s.floor, false))).then(accept(16000, -6227, true, floorAfter(-6227, s.floor, true)))
    .expect(safety and not(s.active) and s.speechRun == 1 and s.preCount == 4)
  run invalidDoesNotRetirePendingFramesTest = init.then(accept(16000, -6227, true, floorAfter(-6227, s.floor, true))).then(invalidFrame)
    .expect(safety and s.preCount == 1 and s.speechRun == 1)
}
