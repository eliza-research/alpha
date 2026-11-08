/// Durable workflow activation and external task registration are separate commits.
module WorkflowScheduleTasks {
  type Schedule = {version: int, active: bool, typed: bool, valid: bool, removed: bool, cleanup: str,
    tasks: int -> int, retired: Set[int], pendingId: int, pendingVersion: int, phase: str,
    receipt: bool, receiptVersion: int}
  var s: Schedule
  action initFor(typed: bool, valid: bool, active: bool, removed: bool): bool = s' = {
    version: 1, active: active, typed: typed, valid: valid, removed: removed,
    cleanup: if (removed) "pending" else "none", tasks: Map(1 -> 0, 2 -> 0, 3 -> 0), retired: Set(),
    pendingId: 0, pendingVersion: 0, phase: "none", receipt: false, receiptVersion: 0}
  action init = initFor(true, true, false, false)
  action seedTask(id: int, version: int): bool = all {
    id.in(1.to(3)), version.in(Set(-1, 1)), s.tasks.get(id) == 0, not(s.retired.contains(id)),
    s' = {...s, tasks: s.tasks.set(id, version)}
  }
  action activation(turnOn: bool, expected: int): bool = all {
    expected == s.version, s.version < 4, not(s.removed), not(turnOn) or s.valid,
    s' = {...s, version: s.version + 1, active: turnOn}
  }
  action requestCreate(id: int): bool = all {
    s.active, not(s.removed), s.valid, s.phase == "none", id.in(1.to(3)), s.tasks.get(id) == 0,
    not(s.retired.contains(id)), not(s.typed and s.tasks.keys().exists(key => s.tasks.get(key) == s.version)),
    s' = {...s, pendingId: id, pendingVersion: s.version, phase: "requested"}
  }
  action persistCreate = all {
    s.phase == "requested", s' = {...s, tasks: s.tasks.set(s.pendingId, s.pendingVersion), phase: "persisted"}
  }
  action creationReturned = all {
    s.phase == "persisted", s.active, not(s.removed), s.pendingVersion == s.version,
    s' = {...s, pendingId: 0, pendingVersion: 0, phase: "none"}
  }
  action creationFailed = all {s.phase != "none", s' = {...s, pendingId: 0, pendingVersion: 0, phase: "none"}}
  action retireCreated = all {
    s.phase == "persisted", not(s.active) or s.removed or s.pendingVersion != s.version,
    s' = {...s, tasks: s.tasks.set(s.pendingId, 0), retired: s.retired.union(Set(s.pendingId)), pendingId: 0, pendingVersion: 0, phase: "none"}
  }
  action removeTask(id: int, allKinds: bool): bool = all {
    id.in(1.to(3)), s.tasks.get(id) != 0, allKinds or s.tasks.get(id) > 0,
    s' = {...s, tasks: s.tasks.set(id, 0), retired: s.retired.union(Set(id))}
  }
  /// A second host completes its own source coordinator while the first call is still pending.
  action otherCreate(id: int): bool = all {
    s.active, not(s.removed), s.valid, id.in(1.to(3)), id != s.pendingId, s.tasks.get(id) == 0, not(s.retired.contains(id)),
    s' = {...s, tasks: s.tasks.set(id, s.version)}
  }
  action removeWorkflow(expected: int): bool = all {
    expected == s.version, s.version < 4, not(s.removed),
    s' = {...s, version: s.version + 1, active: false, removed: true, cleanup: "pending", receipt: true, receiptVersion: expected}
  }
  action cleanupComplete = all {
    s.removed, s.tasks.keys().forall(id => s.tasks.get(id) == 0), s' = {...s, cleanup: "complete"}
  }
  action restore(expected: int): bool = all {
    expected == s.version, s.version < 4, s.removed, s.cleanup == "complete",
    s' = {...s, version: s.version + 1, active: false, removed: false, cleanup: "none"}
  }
  action replayRemoval(expected: int): bool = all {s.receipt, expected == s.receiptVersion, s' = s}
  action step = any {
    activation(true, 1), activation(false, 2), activation(true, 3), requestCreate(1), requestCreate(2), requestCreate(3),
    persistCreate, creationReturned, creationFailed, retireCreated, removeTask(1, false), removeTask(2, false),
    removeTask(1, true), removeTask(2, true), removeTask(3, true), otherCreate(2),
    removeWorkflow(1), removeWorkflow(2), removeWorkflow(3), cleanupComplete, restore(2), restore(3), replayRemoval(1), s' = s
  }
  val taskCount = s.tasks.keys().filter(id => s.tasks.get(id) != 0).size()
  val RemovedInactive = s.removed implies not(s.active)
  val MarkerBelongsToRemovedWorkflow = (s.cleanup != "none") == s.removed
  val RecordedTaskVersion = s.tasks.keys().forall(id => s.tasks.get(id) <= s.version)
  val RetiredTaskCannotReappear = s.retired.forall(id => s.tasks.get(id) == 0)
  val TypeOK = s.version.in(1.to(4)) and s.pendingId.in(0.to(3)) and s.pendingVersion.in(0.to(4))
    and s.phase.in(Set("none", "requested", "persisted")) and s.cleanup.in(Set("none", "pending", "complete"))
  val safety = RemovedInactive and MarkerBelongsToRemovedWorkflow and RecordedTaskVersion and RetiredTaskCannotReappear and TypeOK
  run activationTaskTest = init.then(activation(true, 1)).then(requestCreate(1)).then(persistCreate).then(creationReturned).expect(s.tasks.get(1) == 2 and safety)
  run beforeWriteFailureTest = init.then(activation(true, 1)).then(requestCreate(1)).then(creationFailed).expect(s.active and s.tasks.get(1) == 0 and safety)
  run lostCreateReceiptTest = init.then(activation(true, 1)).then(requestCreate(1)).then(persistCreate).then(creationFailed).expect(s.tasks.get(1) == 2 and safety)
  run staleCreateRemovedTest = init.then(activation(true, 1)).then(requestCreate(1)).then(activation(false, 2)).then(persistCreate).then(retireCreated).expect(s.tasks.get(1) == 0 and safety)
  run staleCreatePreservesSuccessorTest = init.then(activation(true, 1)).then(requestCreate(1)).then(activation(false, 2)).then(activation(true, 3))
    .then(otherCreate(2)).then(persistCreate).then(retireCreated).expect(s.tasks.get(2) == 4 and safety)
  run lateTaskAfterCompletedCleanupTest = init.then(activation(true, 1)).then(requestCreate(1)).then(removeWorkflow(2))
    .then(cleanupComplete).then(persistCreate).then(creationFailed).expect(s.cleanup == "complete" and s.tasks.get(1) == 2 and safety)
  run pausePreservesUnrelatedTriggerTest = initFor(true, true, true, false).then(seedTask(1, 1)).then(seedTask(2, -1))
    .then(activation(false, 1)).then(removeTask(1, false)).expect(s.tasks.get(2) == -1 and safety)
  run removalCleansAllTriggersTest = init.then(seedTask(1, 1)).then(seedTask(2, -1)).then(removeWorkflow(1))
    .then(removeTask(1, true)).then(removeTask(2, true)).then(cleanupComplete).then(replayRemoval(1)).expect(s.cleanup == "complete" and safety)
  run restoreWaitsForCleanupTest = init.then(removeWorkflow(1)).then(restore(2)).fail()
  run cleanupThenRestoreTest = init.then(removeWorkflow(1)).then(cleanupComplete).then(restore(2)).expect(not(s.removed) and not(s.active) and safety)
  run staleActivationRejectedTest = init.then(activation(true, 2)).fail()
  run malformedScheduleRejectedTest = initFor(true, false, false, false).then(activation(true, 1)).fail()
}
