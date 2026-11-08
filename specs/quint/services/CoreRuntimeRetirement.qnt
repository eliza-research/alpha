/// Shared AgentRuntime retirement tracks work before hooks and drains newly spawned work.
module CoreRuntimeRetirement {
  val taskIds = Set(1, 2, 3)
  val drainIds = Set(1, 2)
  type State = { pending: Set[int], results: int -> str, generation: int,
    failures: int, drains: int -> str }
  var s: State
  action init = s' = { pending: Set(),
    results: Map((1, "unused"), (2, "unused"), (3, "unused")), generation: 0,
    failures: 0, drains: Map((1, "unused"), (2, "unused")) }
  action beginRun(id: int): bool = all {
    id.in(taskIds), s.results.get(id) == "unused", s.generation < 3,
    s' = { ...s, pending: s.pending.union(Set(id)), results: s.results.set(id, "running"), generation: s.generation + 1 }
  }
  action settleRun(id: int, success: bool): bool = all {
    id.in(s.pending),
    s' = { ...s, pending: s.pending.exclude(Set(id)),
      results: s.results.set(id, if (success) "ok" else "failed") }
  }
  action recordFailure = all { s.failures < 3, s' = { ...s, failures: s.failures + 1 } }
  action beginDrain(id: int): bool = all {
    id.in(drainIds), s.drains.get(id) == "unused",
    s' = { ...s, drains: s.drains.set(id,
      if (s.pending.size() > 0) "waiting" else if (s.failures > 0) "failed" else "ok") }
  }
  action finishDrain(id: int): bool = all {
    id.in(drainIds), s.drains.get(id) == "waiting", s.pending.size() == 0,
    s' = { ...s, drains: s.drains.set(id, if (s.failures > 0) "failed" else "ok") }
  }
  action step = any {
    beginRun(1), beginRun(2), beginRun(3), settleRun(1, true), settleRun(1, false),
    settleRun(2, true), settleRun(2, false), settleRun(3, true), settleRun(3, false),
    recordFailure, beginDrain(1), beginDrain(2), finishDrain(1), finishDrain(2), s' = s }
  val PendingMatchesRuns = s.pending == taskIds.filter(id => s.results.get(id) == "running")
  val GenerationCountsRuns = s.generation == taskIds.filter(id => s.results.get(id) != "unused").size()
  val TypeOK = s.generation.in(0.to(3)) and s.failures.in(0.to(3))
    and taskIds.forall(id => s.results.get(id).in(Set("unused", "running", "ok", "failed")))
    and drainIds.forall(id => s.drains.get(id).in(Set("unused", "waiting", "ok", "failed")))
  val safety = PendingMatchesRuns and GenerationCountsRuns and TypeOK
  run waitsForWorkTest = init.then(beginRun(1)).then(beginDrain(1))
    .expect(s.drains.get(1) == "waiting").then(settleRun(1, true)).then(finishDrain(1))
    .expect(s.drains.get(1) == "ok" and safety)
  run rejectedWorkIsNotRecordedFailureTest = init.then(beginRun(1)).then(settleRun(1, false))
    .then(beginDrain(1)).expect(s.failures == 0 and s.drains.get(1) == "ok" and safety)
  run recordedFailurePersistsTest = init.then(recordFailure).then(beginDrain(1)).then(beginDrain(2))
    .expect(s.drains.get(1) == "failed" and s.drains.get(2) == "failed" and safety)
  run reentrantWorkTest = init.then(beginRun(1)).then(beginRun(2)).then(beginDrain(1))
    .then(settleRun(1, true)).expect(s.drains.get(1) == "waiting")
    .then(settleRun(2, true)).then(finishDrain(1)).expect(s.generation == 2 and safety)
  run spawnedWhileDrainingTest = init.then(beginRun(1)).then(beginDrain(1)).then(settleRun(1, true))
    .then(beginRun(2)).expect(s.drains.get(1) == "waiting")
    .then(settleRun(2, true)).then(finishDrain(1)).expect(safety)
  run separateDrainCallersTest = init.then(beginRun(1)).then(beginDrain(1)).then(beginDrain(2))
    .then(settleRun(1, true)).then(finishDrain(1)).then(finishDrain(2))
    .expect(s.drains.get(1) == "ok" and s.drains.get(2) == "ok" and safety)
  run laterWorkDoesNotReopenDrainTest = init.then(beginDrain(1)).then(beginRun(1))
    .expect(s.drains.get(1) == "ok" and s.pending.size() == 1 and safety)
  run failureDuringDrainTest = init.then(beginRun(1)).then(beginDrain(1)).then(recordFailure)
    .then(settleRun(1, true)).then(finishDrain(1)).expect(s.drains.get(1) == "failed" and safety)
}
