// Exact finite probability partition and counters of LiveVadGate. The capture loop calls only
// accept and speaking; close is the gate's own contract for ending an open segment. A stopped
// capture drops its gate and a new capture starts with a new one.
module VadSegmentation {
  type Gate = {
    speaking: bool, above: int, below: int, edge: str,
    priorSpeaking: bool, priorAbove: int, priorBelow: int,
    probability: int, operation: str, closeReturned: bool
  }
  var s: Gate
  action check(condition: bool): bool = all {assert(condition), s' = s}
  // Probability is encoded in thousandths. -1001/-1000/-999 represent NaN/+Inf/-Inf.
  pure def normalized(probability: int): int = if (probability <= -999) 0 else probability
  pure val initial: Gate = {
    speaking: false, above: 0, below: 0, edge: "NONE",
    priorSpeaking: false, priorAbove: 0, priorBelow: 0,
    probability: 0, operation: "init", closeReturned: false
  }
  action init = s' = initial
  // All possible pre-window counter states, including the fifteenth silent window.
  action counterInit = {
    nondet speaking = Set(false, true).oneOf()
    nondet count = 0.to(15).oneOf()
    s' = {speaking: speaking, above: if (speaking) 0 else count % 2,
      below: if (speaking) count else 0, ...initial}
  }
  action accept(probability: int): bool = all {
    probability.in(Set(-1001, -1000, -999, -1, 0, 349, 350, 499, 500, 1000, 1001)),
    {
      val p = normalized(probability)
      val above = if (not(s.speaking) and p >= 500) s.above + 1 else 0
      val below = if (s.speaking and p < 350) s.below + 1 else 0
      val opens = not(s.speaking) and above >= 2
      val closes = s.speaking and below >= 16
      s' = {speaking: if (opens) true else if (closes) false else s.speaking,
        above: if (opens or closes) 0 else above,
        below: if (opens or closes) 0 else below,
        edge: if (opens) "SPEECH_START" else if (closes) "SPEECH_END" else "NONE",
        priorSpeaking: s.speaking, priorAbove: s.above, priorBelow: s.below,
        probability: probability, operation: "accept", closeReturned: false}
    }
  }
  action close = s' = {
    speaking: false, above: 0, below: 0, edge: "NONE",
    priorSpeaking: s.speaking, priorAbove: s.above, priorBelow: s.below,
    probability: s.probability, operation: "close", closeReturned: s.speaking
  }
  action step = {
    nondet probability = Set(-1001, -1000, -999, -1, 0, 349, 350, 499, 500, 1000, 1001).oneOf()
    any {accept(probability), close, s' = s}
  }
  val CounterBounds = s.above.in(0.to(1)) and s.below.in(0.to(15))
  val InactiveCounterCleared = (s.speaking implies s.above == 0) and (not(s.speaking) implies s.below == 0)
  val OpeningNeedsTwoWindows = s.edge == "SPEECH_START" implies
    s.operation == "accept" and not(s.priorSpeaking) and s.priorAbove == 1 and normalized(s.probability) >= 500 and s.speaking
  val ClosingNeedsSixteenWindows = s.edge == "SPEECH_END" implies
    s.operation == "accept" and s.priorSpeaking and s.priorBelow == 15 and normalized(s.probability) < 350 and not(s.speaking)
  val CloseReportsPriorState = s.operation == "close" implies
    s.closeReturned == s.priorSpeaking and not(s.speaking) and s.above == 0 and s.below == 0
  val MidProbabilityResetsSilence = s.operation == "accept" and s.priorSpeaking and normalized(s.probability) >= 350 implies s.below == 0
  val safety = CounterBounds and InactiveCounterCleared and OpeningNeedsTwoWindows and
    ClosingNeedsSixteenWindows and CloseReportsPriorState and MidProbabilityResetsSilence

  val OpeningRunWitness = not(s.speaking) and s.above == 1
  val SpeakingWitness = s.speaking and s.edge == "NONE"
  val TrailingSilenceWitness = s.speaking and s.below >= 2
  val ClosedOpenSegmentWitness = s.operation == "close" and s.closeReturned

  run exactOpeningThresholdTest = init.then(accept(499)).then(accept(500))
    .then(check(not(s.speaking) and s.above == 1)).then(accept(500))
    .then(check(safety and s.speaking and s.edge == "SPEECH_START"))
  run interruptedOpeningRunTest = init.then(accept(1000)).then(accept(349))
    .then(accept(1000)).then(check(safety and not(s.speaking) and s.above == 1))
  run sixteenLowWindowsCloseTest = init.then(accept(500)).then(accept(500))
    .then(15.reps(_ => accept(349))).then(check(s.speaking and s.below == 15))
    .then(accept(349)).then(check(safety and not(s.speaking) and s.edge == "SPEECH_END"))
  run exactClosingThresholdResetsRunTest = init.then(accept(500)).then(accept(500))
    .then(15.reps(_ => accept(349))).then(accept(350)).then(check(s.speaking and s.below == 0))
    .then(15.reps(_ => accept(349))).then(check(safety and s.speaking))
  run nonFiniteProbabilityIsSilenceTest = init.then(accept(500)).then(accept(-1001))
    .then(check(s.above == 0 and not(s.speaking))).then(accept(500)).then(accept(500))
    .then(16.reps(_ => accept(-1000))).then(check(safety and s.edge == "SPEECH_END"))
  run closeEndsOpenSegmentOnceTest = init.then(accept(500)).then(accept(500)).then(close)
    .then(check(safety and s.closeReturned)).then(close).then(check(safety and not(s.closeReturned)))
  run closeResetsPartialOpeningTest = init.then(accept(500)).then(close).then(accept(500))
    .then(check(safety and not(s.speaking) and s.above == 1))
  // The capture stops mid-segment: no gate edge is produced, and a new capture starts closed.
  run stoppedCaptureStartsClosedTest = init.then(accept(500)).then(accept(500))
    .then(check(s.speaking)).then(init).then(accept(349))
    .then(check(safety and not(s.speaking) and s.edge == "NONE")).then(accept(500))
    .then(check(safety and not(s.speaking) and s.above == 1))
  run midProbabilityKeepsSegmentOpenTest = init.then(accept(1000)).then(accept(1000))
    .then(16.reps(_ => accept(350))).then(check(safety and s.speaking and s.below == 0))
    .then(accept(499)).then(check(safety and s.speaking and s.edge == "NONE"))
}
