/// Staged speech lead trimming and first-write report ownership.
module NativeSpeechOutputPreparation {
  type State = {preRoll: int, threshold: int, open: bool, held: List[int], returned: List[int],
    caller: List[int], sameInput: bool, firstPending: bool, writes: int, outcome: str,
    writeResult: int, events: List[str], callbackAlreadyCleared: bool}
  var s: State
  pure val samples = Set(-10, -4, -3, -2, -1, 0, 1, 2, 3, 4, 9, 10)
  pure def loud(sample: int): bool = sample != 9 and (sample >= 2 or sample <= -2)
  pure def suffix(values: List[int], count: int): List[int] =
    if (count == 0) [] else if (values.length() <= count) values else values.slice(values.length() - count, values.length())
  action initFor(preRoll: int, report: bool): bool = all {
    preRoll.in(Set(0, 3, 4, 727)),
    s' = {preRoll: preRoll, threshold: 2, open: false, held: [], returned: [], caller: [],
      sameInput: false, firstPending: report, writes: 0, outcome: "none", writeResult: 0,
      events: [], callbackAlreadyCleared: true}
  }
  action init = initFor(3, true)
  action trim(chunk: List[int]): bool = all {
    chunk.length() <= 736, chunk.indices().forall(i => chunk.nth(i).in(samples)),
    if (s.open) s' = {...s, returned: chunk, caller: chunk, sameInput: true}
    else {
      val onset = chunk.indices().fold(chunk.length(), (first, i) => if (i < first and loud(chunk.nth(i))) i else first)
      val combined = s.held.concat(chunk)
      val cleared = chunk.foldl([], (result, _) => result.append(0))
      if (onset == chunk.length()) s' = {...s, held: suffix(combined, s.preRoll), returned: [], caller: cleared, sameInput: false}
      else s' = {...s, held: [], returned: suffix(combined, chunk.length() - onset + s.preRoll),
        caller: cleared, sameInput: false, open: true}
    }
  }
  action write(callbackOk: bool, delegate: str, result: int): bool = all {
    s.writes < 4, delegate.in(Set("ok", "fail")), result.in(Set(-1, 0, 1, 3)),
    val first = if (s.firstPending) s.events.append("first") else s.events
    val proceeds = not(s.firstPending) or callbackOk
    val wrote = proceeds and delegate == "ok"
    s' = {...s, firstPending: false, writes: s.writes + (if (proceeds) 1 else 0),
      outcome: if (not(proceeds)) "callback_failed" else if (not(wrote)) "write_failed" else "returned",
      writeResult: if (wrote) result else 0, events: if (proceeds) first.append("write") else first}
  }
  action step = any {
    {nondet chunk = Set([], [0], [1, -1, 9], [2, 3, 0], [1, 0, 0, -2], [10, -10]).oneOf()
     trim(chunk)},
    {nondet callbackOk = Bool.oneOf()
     nondet delegate = Set("ok", "fail").oneOf()
     nondet result = Set(-1, 0, 1, 3).oneOf()
     write(callbackOk, delegate, result)},
    s' = s
  }
  val LeadBounded = s.held.length() <= s.preRoll and (s.open implies s.held.length() == 0)
  val FirstReportOnce = s.events.select(event => event == "first").length() <= 1 and s.callbackAlreadyCleared
  val FirstReportPrecedesWrites = s.events.select(event => event == "first").length() > 0 implies s.events.head() == "first"
  val WriteCountMatchesEffects = s.events.select(event => event == "write").length() == s.writes
  val safety = LeadBounded and FirstReportOnce and FirstReportPrecedesWrites and WriteCountMatchesEffects
  run onsetsPreserveLimitedLeadTest = init.then(trim([0, 1, 0, -1])).then(trim([0, 2, 3]))
    .expect(safety and s.open and s.returned == [0, -1, 0, 2, 3] and s.caller == [0, 0, 0])
  run callbackFailureIsNotRetriedTest = init.then(write(false, "ok", 3)).then(write(true, "ok", 3))
    .expect(safety and s.events == ["first", "write"] and s.writes == 1)
  run exactThresholdAndLaterPassThroughTest = init.then(trim([1, -2, 3])).then(trim([0, 1]))
    .expect(safety and s.open and s.sameInput and s.caller == [0, 1])
}
