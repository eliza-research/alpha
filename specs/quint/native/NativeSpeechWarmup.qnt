/// Bounded silence writer and late output ownership in SpeechOutputWarmup.
module NativeSpeechWarmup {
  type State = {created: bool, closed: bool, writerLive: bool, outputOwned: bool,
    opens: int, plays: int, writes: int, aborted: bool, releases: int, silent: bool, now: int}
  var s: State
  pure val limit = 15000000000
  action init = s' = {created: false, closed: false, writerLive: false, outputOwned: false,
    opens: 0, plays: 0, writes: 0, aborted: false, releases: 0, silent: true, now: 0}
  action create = all {not(s.created), s' = {...s, created: true, writerLive: true, opens: 1}}
  action finishOpen(result: str): bool = all {
    s.writerLive, not(s.outputOwned), result.in(Set("success", "fail", "play_fail")),
    if (result == "fail") s' = {...s, writerLive: false}
    else if (s.closed or result == "play_fail") s' = {...s, writerLive: false, aborted: true,
      releases: 1, plays: if (s.closed) 0 else 1}
    else s' = {...s, outputOwned: true, plays: 1, writes: 1}
  }
  action finishWrite(now: int, result: str): bool = all {
    s.writerLive, s.outputOwned, now >= s.now, now.in(Set(1, limit - 1, limit)),
    result.in(Set("success", "refused")),
    {
      val done = s.closed or result == "refused" or now >= limit
      all {done or s.writes < 3,
        s' = if (done) {...s, now: now, writerLive: false, outputOwned: false, aborted: true, releases: 1}
          else {...s, now: now, writes: s.writes + 1}}
    }
  }
  action close = all {s.created, s' = {...s, closed: true, aborted: s.aborted or s.outputOwned}}
  action step = any {
    create, close,
    {nondet result = Set("success", "fail", "play_fail").oneOf()
      finishOpen(result)},
    {nondet now = Set(1, limit - 1, limit).oneOf()
      nondet result = Set("success", "refused").oneOf()
      finishWrite(now, result)},
    s' = s
  }
  val OwnedOutputHasWriter = s.outputOwned implies s.writerLive and s.plays == 1 and s.releases == 0
  val SilentOnly = s.silent
  val DeadlineRetiresOutput = s.now >= limit implies not(s.writerLive or s.outputOwned)
  val SingleRelease = s.releases.in(0.to(1)) and s.plays.in(0.to(1)) and s.writes.in(0.to(3))
  val safety = OwnedOutputHasWriter and SilentOnly and DeadlineRetiresOutput and SingleRelease
  run closeFencesLateOpenTest = init.then(create).then(close).then(finishOpen("success"))
    .expect(safety and s.plays == 0 and s.releases == 1)
  run exactDeadlineTest = init.then(create).then(finishOpen("success")).then(finishWrite(limit - 1, "success"))
    .then(finishWrite(limit, "success")).expect(safety and s.writes == 2 and s.releases == 1)
  run closeDuringWriteTest = init.then(create).then(finishOpen("success")).then(close).then(close)
    .then(finishWrite(1, "success")).expect(safety and s.writes == 1 and s.releases == 1)
  run refusedWriteDoesNotSpinTest = init.then(create).then(finishOpen("success")).then(finishWrite(1, "refused"))
    .expect(safety and s.writes == 1 and s.releases == 1)
}
