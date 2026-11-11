// One durable native deletion row, with operation-id deduplication and Undo window.
module DeletionJournal {
  type State = {
    phase: str, window: str, owner: int, currentOwner: int, targetRevision: int,
    currentRevision: int, dispatches: int, providerApplied: bool, providerReturned: bool,
    acknowledged: bool, lastUndo: bool, storageWorks: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    phase: "absent", window: "open", owner: 0, currentOwner: 0,
    targetRevision: 0, currentRevision: 0, dispatches: 0, providerApplied: false, providerReturned: false,
    acknowledged: false, lastUndo: false, storageWorks: true
  }
  action stage = all {
    s.phase == "absent", s.storageWorks,
    s' = {phase: "queued", owner: s.currentOwner, targetRevision: s.currentRevision, ...s}
  }
  // Replaying the same operation never creates a second row or dispatch.
  action repeatStage(owner: int, revision: int): bool =
    if (s.phase != "absent" and owner == s.owner and revision == s.targetRevision)
      s' = s
    else s' = s
  action expireWindow = all {
    s.phase == "queued", s.window == "open", s' = s.with("window", "expired")
  }
  action reboot =
    s' = {window: "clock-changed", phase: if (s.phase == "dispatching") "unknown" else s.phase,
      lastUndo: false, ...s}
  action ownerChanges = s' = s.with("currentOwner", 1 - s.currentOwner)
  action sourceChanges = s' = s.with("currentRevision", 1 - s.currentRevision)
  action storageFailure = s' = s.with("storageWorks", false)
  action storageRecovers = s' = s.with("storageWorks", true)
  // Undo of a row that is already undone returns that row again.
  action undo = all {
    s.phase.in(Set("queued", "paused", "undone")), s.owner == s.currentOwner,
    s.phase != "queued" or s.window != "expired", s.storageWorks,
    s' = {phase: "undone", lastUndo: true, ...s}
  }
  // Admission and durable dispatch intent precede the provider call. A changed owner or source
  // pauses the row before any dispatch; conflict is only ever a provider outcome.
  action claim = all {
    s.phase == "queued", s.window == "expired", s.storageWorks,
    s' = if (s.owner != s.currentOwner or s.targetRevision != s.currentRevision)
      s.with("phase", "paused")
    else {phase: "dispatching", dispatches: s.dispatches + 1, lastUndo: false, ...s}
  }
  action providerResult(outcome: str, saveOutcome: bool): bool = all {
    s.phase == "dispatching", not(s.providerReturned), outcome.in(Set("deleted", "conflict", "permission-required", "unknown")),
    s' = {providerApplied: outcome == "deleted", providerReturned: true,
      phase: if (saveOutcome and s.storageWorks)
        (if (outcome == "permission-required") "paused" else outcome)
        else "dispatching", ...s}
  }
  action observeReceipt =
    if (s.phase == "dispatching") s' = s.with("phase", "unknown")
    else s' = s
  action dismissUnknown = all {
    s.phase == "unknown", s.owner == s.currentOwner, s.storageWorks,
    s' = s.with("acknowledged", true)
  }
  action step = {
    nondet outcome = Set("deleted", "conflict", "permission-required", "unknown").oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet owner = Set(0, 1).oneOf()
    nondet revision = Set(0, 1).oneOf()
    any { stage, repeatStage(owner, revision), expireWindow, reboot,
      ownerChanges, sourceChanges, storageFailure, storageRecovers, undo,
      claim, providerResult(outcome, flag), observeReceipt, dismissUnknown, s' = s }
  }
  val SingleDispatch = s.dispatches.in(Set(0, 1))
  val UndoKeepsSource = s.lastUndo implies s.phase == "undone" and not(s.providerApplied)
  val DurableIntentBeforeEffect = s.providerApplied implies s.dispatches == 1
  val ReceiptNeedsDispatch = s.phase.in(Set("deleted", "conflict", "unknown", "dispatching")) implies s.dispatches == 1
  val UnknownNeverRequeued = s.acknowledged implies s.phase.in(Set("unknown", "dispatching"))
  val PausedKeepsUndo = (s.phase == "paused" and s.dispatches == 0) implies not(s.providerApplied) and not(s.providerReturned)
  val PausedBeforeDispatchWitness = s.phase == "paused" and s.dispatches == 0 and s.targetRevision != s.currentRevision
  val ProviderConflictWitness = s.phase == "conflict"
  val UndoneWitness = s.lastUndo and s.window == "clock-changed"
  val AcknowledgedUnknownWitness = s.acknowledged and s.providerApplied
  val safety = PausedKeepsUndo and SingleDispatch and UndoKeepsSource and DurableIntentBeforeEffect and ReceiptNeedsDispatch and UnknownNeverRequeued

  run undoBeforeExpiryTest = init.then(stage).then(undo).then(repeatStage(0, 0))
    .then(check(safety and s.phase == "undone" and s.dispatches == 0))
  run lostOutcomeNeverReplaysTest = init.then(stage).then(expireWindow).then(claim)
    .then(providerResult("deleted", false)).then(reboot).then(repeatStage(0, 0))
    .then(dismissUnknown).then(check(safety and s.phase == "unknown" and s.dispatches == 1))
  run staleOwnerPausesTest = init.then(stage).then(ownerChanges).then(expireWindow)
    .then(claim).then(check(safety and s.phase == "paused" and s.dispatches == 0))
  run changedClockKeepsUndoTest = init.then(stage).then(reboot).then(undo)
    .then(check(safety and s.phase == "undone"))
  run repeatedUndoReturnsUndoneRowTest = init.then(stage).then(undo).then(undo)
    .then(check(safety and s.phase == "undone" and s.dispatches == 0 and s.lastUndo))
  // A source that changed during the Undo window is never marked conflict without a dispatch.
  run changedSourcePausesBeforeDispatchTest = init.then(stage).then(sourceChanges).then(expireWindow)
    .then(claim).then(check(safety and s.phase == "paused" and s.dispatches == 0))
    .then(undo).then(check(safety and s.phase == "undone" and not(s.providerApplied)))
  run providerConflictAfterDispatchTest = init.then(stage).then(expireWindow).then(claim)
    .then(providerResult("conflict", true)).then(check(safety and s.phase == "conflict" and s.dispatches == 1))
  run permissionFailureKeepsUndoTest = init.then(stage).then(expireWindow).then(claim)
    .then(providerResult("permission-required", true)).then(undo)
    .then(check(safety and s.phase == "undone" and s.dispatches == 1))
}
