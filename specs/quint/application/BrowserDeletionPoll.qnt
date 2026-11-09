module BrowserDeletionPoll {
  pure val Pollers = Set(1, 2)
  type State = { row: str, expired: bool, commits: int, phase: int -> str }
  var state: State
  pure val initial: State = {row: "queued", expired: false, commits: 0, phase: Pollers.mapBy(_ => "idle")}

  action init = state' = initial
  action expire = all {
    not(state.expired),
    state' = {...state, expired: true}
  }
  action inspect(poller: int): bool = all {
    state.phase.get(poller) == "idle",
    val destination = if (state.row == "queued" and state.expired) "waiting" else "done"
    state' = {...state, phase: state.phase.set(poller, destination)}
  }
  action settle(poller: int): bool = all {
    state.phase.get(poller) == "waiting",
    val current = state.row == "queued" and state.expired
    state' = {...state, row: if (current) "deleted" else state.row,
      commits: state.commits + (if (current) 1 else 0), phase: state.phase.set(poller, "done")}
  }
  action rejectEdit(poller: int): bool = all {
    state.phase.get(poller) == "waiting",
    state' = {...state, phase: state.phase.set(poller, "failed")}
  }
  action step = any {
    expire,
    nondet poller = Pollers.oneOf()
    any {inspect(poller), settle(poller), rejectEdit(poller)},
    state' = state
  }

  val oneCommit = state.commits.in(0.to(1))
    and ((state.row == "deleted") iff state.commits == 1)
  val expiredAdmission = Pollers.exists(p => state.phase.get(p) == "waiting") implies state.expired
  val safety = state.row.in(Set("queued", "deleted")) and state.phase.keys() == Pollers
    and Pollers.forall(p => state.phase.get(p).in(Set("idle", "waiting", "done", "failed")))
    and oneCommit and expiredAdmission

  run youngerPollSkipsWriteTest = init.then(inspect(1))
    .expect(safety and state.commits == 0 and state.phase.get(1) == "done")
  run competingPollLeavesCommittedRevisionTest = init.then(expire).then(inspect(1)).then(inspect(2))
    .then(settle(2)).then(settle(1)).expect(safety and state.row == "deleted" and state.commits == 1)
  run failedPollLeavesWorkForAnotherTest = init.then(expire).then(inspect(1)).then(rejectEdit(1)).then(inspect(2))
    .then(settle(2)).expect(safety and state.phase.get(1) == "failed" and state.commits == 1)
}
