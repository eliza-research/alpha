// Product worker preparation is separate from verified worker staging.
module PreparedWorkflowWorker {
  type State = {stamp: int, lock: int, outputStamp: int, outputLock: int,
    quality: str, phase: str, capturedStamp: int, capturedLock: int,
    result: str, builds: int}
  var s: State
  action init = s' = {stamp: 1, lock: 1, outputStamp: 0, outputLock: 0,
    quality: "absent", phase: "idle", capturedStamp: 0, capturedLock: 0,
    result: "none", builds: 0}

  action begin = all {
    s.phase == "idle", s.builds < 3,
    val absent = s.quality == "absent"
    val exact = s.quality == "valid" and s.outputStamp == s.stamp and s.outputLock == s.lock
    s' = {...s, phase: if (absent) "building" else "idle",
      capturedStamp: if (absent) s.stamp else s.capturedStamp,
      capturedLock: if (absent) s.lock else s.capturedLock,
      builds: s.builds + (if (absent) 1 else 0),
      result: if (absent) "pending" else if (exact) "reused" else "refused"},
  }
  action source(stamp: int, lock: int): bool = all {
    stamp.in(Set(1, 2)), lock.in(Set(1, 2)),
    s' = {...s, stamp: stamp, lock: lock, result: "none"},
  }
  action finish(outcome: str): bool = all {
    s.phase == "building", outcome.in(Set("valid", "corrupt", "partial", "failed")),
    val returned = outcome.in(Set("valid", "corrupt"))
    val unchanged = s.stamp == s.capturedStamp and s.lock == s.capturedLock
    s' = {...s, phase: "idle", quality: if (outcome == "failed") "absent" else outcome,
      outputStamp: if (outcome.in(Set("failed", "partial"))) 0 else s.capturedStamp,
      outputLock: if (outcome.in(Set("failed", "partial"))) 0 else s.lock,
      result: if (returned and unchanged and outcome == "valid") "built" else "refused"},
  }
  action corrupt = all {
    s.phase == "idle", s.quality == "valid",
    s' = {...s, quality: "corrupt", result: "none"},
  }
  action freshOutput = all {
    s.phase == "idle", s' = {...s, quality: "absent", outputStamp: 0, outputLock: 0, result: "none"},
  }
  action step = any {
    begin, corrupt, freshOutput,
    {nondet a = Set(1, 2).oneOf(); nondet b = Set(1, 2).oneOf(); source(a, b)},
    {nondet outcome = Set("valid", "corrupt", "partial", "failed").oneOf(); finish(outcome)},
    s' = s,
  }
  val AcceptedWorkerMatchesSource = s.result.in(Set("built", "reused")) implies
    (s.quality == "valid" and s.outputStamp == s.stamp and s.outputLock == s.lock)
  val ReuseRequiresNoProducer = s.result == "reused" implies s.phase == "idle"
  val safety = AcceptedWorkerMatchesSource and ReuseRequiresNoProducer

  run exactReuseSkipsBuildTest = init.then(begin).then(finish("valid")).then(begin)
    .expect(s.result == "reused" and s.builds == 1 and safety)
  run partialBuildIsRetainedTest = init.then(begin).then(finish("partial")).then(begin)
    .expect(s.result == "refused" and s.quality == "partial" and s.builds == 1 and safety)
  run changedStampRefusesOldWorkerTest = init.then(begin).then(finish("valid")).then(source(2, 1)).then(begin)
    .expect(s.result == "refused" and s.outputStamp == 1 and safety)
  run provenanceDriftRefusesBuildTest = init.then(begin).then(source(2, 1)).then(finish("valid"))
    .expect(s.result == "refused" and s.outputStamp == 1 and safety)
  run freshDirectoryPermitsRetryTest = init.then(begin).then(finish("partial")).then(freshOutput)
    .then(begin).then(finish("valid")).expect(s.result == "built" and s.builds == 2 and safety)
}
