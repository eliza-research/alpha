/// One persisted task and three invocation identities of the actual core TaskService.
module TaskServiceLifecycle {
  type Row = {exists: bool, created: bool, repeating: bool, paused: bool, due: bool,
    orphan: bool, failures: int, backoff: bool, blocking: bool}
  type Runtime = {generation: int, stopped: bool, stopReturned: bool, timer: bool, localTimer: bool, wakePending: bool,
    tick: str, timerQuery: bool, selected: Row, row: Row, worker: bool, graceExpired: bool,
    quarantined: bool, jobs: int -> str, readFound: int -> bool, readExclusive: int -> bool, owners: int -> int, tickSlot: int, tracked: int, calls: int}
  var s: Runtime
  pure val emptyRow = {exists: false, created: false, repeating: true, paused: false, due: true,
    orphan: false, failures: 0, backoff: false, blocking: true}
  action init = s' = {generation: 1, stopped: false, stopReturned: false, timer: false, localTimer: false, wakePending: false,
    tick: "idle", timerQuery: false, selected: emptyRow, row: emptyRow, worker: true,
    graceExpired: false, quarantined: false, jobs: Map(1 -> "none", 2 -> "none", 3 -> "none"),
    readFound: Map(1 -> false, 2 -> false, 3 -> false),
    readExclusive: Map(1 -> false, 2 -> false, 3 -> false), owners: Map(1 -> 0, 2 -> 0, 3 -> 0), tickSlot: 0, tracked: 0, calls: 0}
  action create(repeating: bool, paused: bool, blocking: bool): bool = all {
    not(s.row.created), s' = {...s, row: {...emptyRow, exists: true, created: true,
      repeating: repeating, paused: paused, blocking: blocking}}
  }
  action deleteTask = all {s.row.exists, s' = {...s, row: {...s.row, exists: false}}}
  action pause(paused: bool): bool = all {s.row.exists, s' = {...s, row: {...s.row, paused: paused}}}
  action setBlocking(blocking: bool): bool = all {s.row.exists, s' = {...s, row: {...s.row, blocking: blocking}}}
  action due(due: bool): bool = all {s.row.exists, s' = {...s, row: {...s.row, due: due}}}
  action worker(available: bool): bool = s' = {...s, worker: available}
  action ageGrace = s' = {...s, graceExpired: true}
  action markDirty = s' = if (s.stopped or not(s.localTimer)) s else {...s, timer: true}
  action startTimer = s' = if (s.stopped) s else {...s, timer: true, localTimer: true}
  action timerTick = all {not(s.stopped), s.timer, s.tick == "idle",
    s' = {...s, timer: false, tick: "query", timerQuery: true}}
  action runDue = all {not(s.stopped), s.tick == "idle", s' = {...s, tick: "query", timerQuery: false}}
  action queryResult(ok: bool): bool = all {
    s.tick == "query",
    s' = if (not(ok)) {...s, tick: "idle", wakePending: s.timerQuery and not(s.stopped)}
      else if (not(s.row.exists)) {...s, tick: "idle"}
      else {...s, selected: s.row, tick: "preflight", wakePending: s.timerQuery and not(s.stopped)}
  }
  action rearm = all {not(s.stopped), s.localTimer, s.wakePending, s.tick == "idle",
    s' = {...s, timer: true, wakePending: false}}
  action preflight(approved: bool): bool = all {
    s.tick == "preflight",
    s' = if (s.stopped) {...s, tick: "idle"}
      else if (s.selected.paused)
        {...s, tick: if (s.selected.repeating and s.selected.orphan and s.worker) "heal" else "idle"}
      else if (not(s.worker))
        {...s, tick: if (s.graceExpired and not(s.quarantined)) "quarantine" else "idle"}
      else {...s, quarantined: false, tick: if (approved and s.selected.due) "ready" else "idle"}
  }
  action quarantineResult(ok: bool): bool = all {
    s.tick == "quarantine",
    s' = {...s, tick: "idle", quarantined: true,
      row: if (ok and s.row.exists)
        if (s.selected.repeating) {...s.row, paused: true, orphan: true} else {...s.row, exists: false}
        else s.row}
  }
  action healResult(ok: bool): bool = all {
    s.tick == "heal", s' = {...s, tick: "idle", quarantined: if (ok) false else s.quarantined,
      row: if (ok and s.row.exists) {...s.row, paused: false, orphan: false} else s.row}
  }
  action requestManual(slot: int): bool = all {
    not(s.stopped), slot.in(1.to(3)), s.jobs.get(slot) == "none",
    s' = {...s, jobs: s.jobs.set(slot, "read"), owners: s.owners.set(slot, s.generation)}
  }
  action captureManualRead(slot: int): bool = all {
    slot.in(1.to(3)), s.jobs.get(slot) == "read",
    s' = {...s, jobs: s.jobs.set(slot, "held"), readFound: s.readFound.set(slot, s.row.exists),
      readExclusive: s.readExclusive.set(slot, not(s.row.repeating) or s.row.blocking)}
  }
  action manualRead(slot: int): bool = all {
    slot.in(1.to(3)), s.jobs.get(slot) == "held",
    s' = if (s.stopped or s.owners.get(slot) != s.generation or not(s.readFound.get(slot)) or not(s.worker)
        or (s.readExclusive.get(slot) and s.tracked > 0))
      {...s, jobs: s.jobs.set(slot, "done")}
      else {...s, jobs: s.jobs.set(slot, "running"), tracked: s.tracked + 1, calls: s.calls + 1}
  }
  action skipDispatch = all {
    s.tick == "ready", s.stopped or not(s.worker) or ((not(s.selected.repeating) or s.selected.blocking) and s.tracked > 0),
    s' = {...s, tick: "idle"}
  }
  action dispatch(slot: int): bool = all {
    s.tick == "ready", not(s.stopped), s.worker,
    not((not(s.selected.repeating) or s.selected.blocking) and s.tracked > 0),
    slot.in(1.to(3)), s.jobs.get(slot) == "none",
    s' = {...s, tick: "worker", tickSlot: slot, jobs: s.jobs.set(slot, "running"),
      owners: s.owners.set(slot, s.generation), tracked: s.tracked + 1, calls: s.calls + 1}
  }
  action finish(slot: int, outcome: str): bool = all {
    slot.in(1.to(3)), s.jobs.get(slot) == "running", outcome.in(Set("success", "failure", "preserve")),
    s' = {...s, jobs: s.jobs.set(slot, "done"), tracked: s.tracked - 1,
      tick: if (s.tickSlot == slot) "idle" else s.tick,
      tickSlot: if (s.tickSlot == slot) 0 else s.tickSlot,
      row: if (not(s.row.exists) or outcome == "preserve") s.row
        else if (s.row.repeating)
          if (outcome == "success") {...s.row, failures: 0, backoff: false, due: false}
          else {...s.row, failures: if (s.row.failures < 2) s.row.failures + 1 else 2,
            paused: s.row.paused or s.row.failures >= 1, due: false,
            backoff: if (s.row.failures < 1) true else s.row.backoff}
        else {...s.row, exists: false}}
  }
  action stop = s' = {...s, stopped: true, timer: false, localTimer: false, wakePending: false}
  action awaitStop = all {s.stopped, s.tick == "idle", s.tracked == 0, s' = {...s, stopReturned: true}}
  action restart = all {
    s.stopReturned, s.generation < 2,
    s' = {...s, generation: s.generation + 1, stopped: false, stopReturned: false,
      timer: false, localTimer: false, wakePending: false, quarantined: false, graceExpired: false}
  }
  action step = any {
    create(true, false, true), create(false, false, true), create(true, true, false), deleteTask,
    pause(true), pause(false), setBlocking(true), setBlocking(false), due(true), due(false), worker(true), worker(false), ageGrace, markDirty,
    startTimer, timerTick, runDue, rearm, queryResult(true), queryResult(false), preflight(true), preflight(false),
    quarantineResult(true), quarantineResult(false), healResult(true), healResult(false),
    requestManual(1), requestManual(2), requestManual(3), captureManualRead(1), captureManualRead(2), captureManualRead(3), manualRead(1), manualRead(2), manualRead(3),
    skipDispatch, dispatch(1), dispatch(2), dispatch(3),
    finish(1, "success"), finish(2, "success"), finish(3, "success"),
    finish(1, "failure"), finish(2, "failure"), finish(3, "failure"),
    finish(1, "preserve"), finish(2, "preserve"), finish(3, "preserve"), stop, awaitStop, restart, s' = s
  }
  val ActiveTick = s.tick != "idle"
  val Executing = s.row.exists and s.tracked > 0
  val RunningOwners = s.jobs.keys().filter(slot => s.jobs.get(slot) == "running")
  val CountedExecutionOwnership = s.tracked == RunningOwners.size()
  val NoTimerAfterStop = s.stopped implies not(s.timer or s.localTimer or s.wakePending)
  val CurrentExecutionGeneration = RunningOwners.forall(slot => s.owners.get(slot) == s.generation)
  val StopCompletionIsQuiescent = s.stopReturned implies (s.stopped and s.tick == "idle" and s.tracked == 0)
  val TypeOK = s.generation.in(1.to(2)) and s.tracked.in(0.to(3)) and s.calls.in(0.to(3))
    and s.tick.in(Set("idle", "query", "preflight", "quarantine", "heal", "ready", "worker"))
    and s.row.failures.in(0.to(2)) and s.jobs.keys().forall(slot => s.jobs.get(slot).in(Set("none", "read", "held", "running", "done")))
  val safety = CountedExecutionOwnership and NoTimerAfterStop and CurrentExecutionGeneration and StopCompletionIsQuiescent and TypeOK
  run stoppedManualAdmissionTest = init.then(create(true, false, true)).then(stop).then(requestManual(1)).fail()
  run readFinishesAfterStopTest = init.then(create(true, false, true)).then(requestManual(1)).then(stop).then(awaitStop)
    .then(captureManualRead(1)).then(manualRead(1)).expect(s.calls == 0 and safety)
  run stoppedTimerTest = init.then(stop).then(startTimer).expect(not(s.timer) and safety)
  run overlappingOwnersTest = init.then(create(true, false, false)).then(requestManual(1)).then(captureManualRead(1)).then(manualRead(1))
    .then(requestManual(2)).then(captureManualRead(2)).then(manualRead(2)).then(finish(1, "preserve")).expect(s.tracked == 1 and safety)
  run blockingTickTest = init.then(create(true, false, true)).then(requestManual(1)).then(captureManualRead(1)).then(manualRead(1))
    .then(runDue).then(queryResult(true)).then(preflight(true)).then(skipDispatch).expect(s.calls == 1 and safety)
  run nonblockingTickTest = init.then(create(true, false, false)).then(requestManual(1)).then(captureManualRead(1)).then(manualRead(1))
    .then(runDue).then(queryResult(true)).then(preflight(true)).then(dispatch(2)).expect(s.tracked == 2 and safety)
  run stopDrainsEveryOwnerTest = init.then(create(true, false, false)).then(requestManual(1)).then(captureManualRead(1)).then(manualRead(1))
    .then(requestManual(2)).then(captureManualRead(2)).then(manualRead(2)).then(stop).then(finish(1, "preserve")).then(finish(2, "preserve")).then(awaitStop).expect(s.stopReturned and safety)
  run exclusiveManualInvocationsTest = init.then(create(true, false, true))
    .then(requestManual(1)).then(captureManualRead(1)).then(manualRead(1))
    .then(requestManual(2)).then(captureManualRead(2)).then(manualRead(2))
    .expect(s.tracked == 1 and s.calls == 1 and safety)
  run emptyTimerDisarmsTest = init.then(startTimer).then(timerTick).then(queryResult(true)).expect(not(s.timer) and s.localTimer and safety)
  run failedTimerRearmsTest = init.then(startTimer).then(timerTick).then(queryResult(false)).then(rearm).expect(s.timer and safety)
  run orphanGraceTest = init.then(create(true, false, true)).then(worker(false)).then(runDue).then(queryResult(true))
    .then(preflight(true)).expect(not(s.row.paused) and not(s.quarantined) and safety)
  run orphanQuarantineTest = init.then(create(true, false, true)).then(worker(false)).then(ageGrace).then(runDue)
    .then(queryResult(true)).then(preflight(true)).then(quarantineResult(true)).expect(s.row.paused and s.row.orphan and safety)
  run failedQuarantineDoesNotInventPersistenceTest = init.then(create(true, false, true)).then(worker(false)).then(ageGrace)
    .then(runDue).then(queryResult(true)).then(preflight(true)).then(quarantineResult(false)).expect(not(s.row.paused) and s.quarantined and safety)
  run orphanHealsNextTickTest = init.then(create(true, false, true)).then(worker(false)).then(ageGrace).then(runDue)
    .then(queryResult(true)).then(preflight(true)).then(quarantineResult(true)).then(worker(true)).then(runDue)
    .then(queryResult(true)).then(preflight(true)).then(healResult(true)).expect(not(s.row.paused) and s.calls == 0 and safety)
  run deletedRowKeepsExecutionOwnerTest = init.then(create(true, false, true)).then(requestManual(1))
    .then(captureManualRead(1)).then(manualRead(1)).then(deleteTask).expect(s.tracked == 1 and not(Executing) and safety)
  run pendingOldReadCannotEnterRestartTest = init.then(create(true, false, true)).then(requestManual(1)).then(stop).then(awaitStop)
    .then(restart).then(captureManualRead(1)).then(manualRead(1)).expect(s.calls == 0 and safety)
}
