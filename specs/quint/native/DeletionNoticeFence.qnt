// The renderer's quiet-polling policy over the reviewed deletion Undo window. The policy keeps
// the set of pending deletions the current owner was last shown. A passive status read that
// fails stays quiet unless such a row is known; an owner change starts a new generation with
// nothing known, and a read, Undo or dismissal admitted under an earlier generation can neither
// add to nor remove from what the new generation knows, even after the owner changes back.
module DeletionNoticeFence {
  type Call = { kind: str, admitted: int, row: int, outcome: str }
  type State = {
    owner: int, generation: int, known: Set[int], knownGeneration: int, calls: int -> Call,
    staleEffects: int, surfacedUnknown: bool, hiddenKnown: bool
  }
  pure val Slots = Set(0, 1)
  pure val Rows = Set(0, 1)
  pure val Idle: Call = { kind: "none", admitted: 0, row: -1, outcome: "idle" }
  var s: State
  action init = s' = {
    owner: 0, generation: 0, known: Set(), knownGeneration: 0, calls: Slots.mapBy(_ => Idle),
    staleEffects: 0, surfacedUnknown: false, hiddenKnown: false
  }
  def flying(slot: int, kind: str): bool = s.calls.get(slot).kind == kind and s.calls.get(slot).outcome == "flying"
  def current(slot: int): bool = s.calls.get(slot).admitted == s.generation
  def settle(slot: int, outcome: str): int -> Call = s.calls.set(slot, { ...s.calls.get(slot), outcome: outcome })
  // The signed-in owner changes while the notice is subscribed: a new generation, nothing known.
  action ownerChanges = all { s.generation < 3,
    s' = { ...s, owner: 1 - s.owner, generation: s.generation + 1, known: Set() } }
  action startCall(slot: int, kind: str, row: int): bool = all {
    s.calls.get(slot).outcome != "flying",
    s' = { ...s, calls: s.calls.set(slot, { kind: kind, admitted: s.generation, row: if (kind == "pending") -1 else row, outcome: "flying" }) } }
  // The bridge answers a status read with the rows still inside their notice phases. The answer
  // is always handed on; only a read admitted under the current generation replaces what is known.
  action pendingAnswers(slot: int, rows: Set[int]): bool = all { flying(slot, "pending"),
    s' = { ...s, calls: settle(slot, "returned"),
      known: if (current(slot)) rows else s.known,
      knownGeneration: if (current(slot)) s.generation else s.knownGeneration,
      staleEffects: if (current(slot)) s.staleEffects else s.staleEffects + 1 } }
  // A failed status read is reported only to a generation that knows a pending deletion.
  action pendingFails(slot: int): bool = all { flying(slot, "pending"),
    val surfaced = current(slot) and s.known != Set()
    s' = { ...s, calls: settle(slot, if (surfaced) "error" else "quiet"),
      surfacedUnknown: s.surfacedUnknown or (surfaced and s.known == Set()),
      hiddenKnown: s.hiddenKnown or (not(surfaced) and current(slot) and s.known != Set()) } }
  // Only a confirmed Undo retires its row; an Undo that found the deletion already done does not.
  action undoAnswers(slot: int, confirmed: bool): bool = all { flying(slot, "undo"),
    val applies = current(slot) and confirmed
    s' = { ...s, calls: settle(slot, "returned"),
      known: if (applies) s.known.exclude(Set(s.calls.get(slot).row)) else s.known,
      staleEffects: if (confirmed and not(current(slot))) s.staleEffects + 1 else s.staleEffects } }
  action dismissAnswers(slot: int): bool = all { flying(slot, "dismiss"),
    s' = { ...s, calls: settle(slot, "returned"),
      known: if (current(slot)) s.known.exclude(Set(s.calls.get(slot).row)) else s.known,
      staleEffects: if (current(slot)) s.staleEffects else s.staleEffects + 1 } }
  // An explicit Undo or dismissal that fails is always reported.
  action explicitFails(slot: int): bool = all { flying(slot, "undo") or flying(slot, "dismiss"),
    s' = { ...s, calls: settle(slot, "error") } }
  action step = {
    nondet slot = Slots.oneOf()
    nondet kind = Set("pending", "undo", "dismiss").oneOf()
    nondet row = Rows.oneOf()
    nondet rows = Rows.powerset().oneOf()
    nondet confirmed = Bool.oneOf()
    any { ownerChanges, startCall(slot, kind, row), pendingAnswers(slot, rows), pendingFails(slot),
      undoAnswers(slot, confirmed), dismissAnswers(slot), explicitFails(slot), s' = s }
  }
  // What is known was shown to the generation that is current.
  val KnownIsCurrent = s.known != Set() implies s.knownGeneration == s.generation
  val GenerationFollowsOwner = s.owner == s.generation % 2 and s.generation <= 3
  val FailuresSurfaceOnlyForKnownRows = not(s.surfacedUnknown)
  val KnownFailuresAreNotHidden = not(s.hiddenKnown)
  val CallsAreAdmittedOnce = Slots.forall(slot => s.calls.get(slot).admitted <= s.generation
    and (s.calls.get(slot).outcome == "quiet" implies s.calls.get(slot).kind == "pending"))
  val safety = KnownIsCurrent and GenerationFollowsOwner and FailuresSurfaceOnlyForKnownRows
    and KnownFailuresAreNotHidden and CallsAreAdmittedOnce
  val StaleReadIgnoredAfterReturnWitness = s.staleEffects > 0 and s.generation == 2 and s.known == Set()
  val KnownFailureSurfacedWitness = Slots.exists(slot => s.calls.get(slot).kind == "pending" and s.calls.get(slot).outcome == "error")
  val StaleUndoKeepsRowWitness = s.staleEffects > 0 and s.known != Set()
    and Slots.exists(slot => s.calls.get(slot).kind == "undo" and s.calls.get(slot).outcome == "returned" and not(current(slot)))
  val UnconfirmedUndoKeepsRowWitness = Slots.exists(slot => s.calls.get(slot).kind == "undo" and s.calls.get(slot).outcome == "returned"
    and current(slot) and s.known.contains(s.calls.get(slot).row))
  val QuietAfterDismissWitness = Slots.exists(slot => s.calls.get(slot).kind == "dismiss" and s.calls.get(slot).outcome == "returned")
    and Slots.exists(slot => s.calls.get(slot).kind == "pending" and s.calls.get(slot).outcome == "quiet") and s.knownGeneration == s.generation and s.generation > 0
  run quietUntilARowIsKnownTest = init.then(startCall(0, "pending", 0)).then(pendingFails(0))
    .expect(s.calls.get(0).outcome == "quiet" and safety)
    .then(startCall(0, "pending", 0)).then(pendingAnswers(0, Set(1))).then(startCall(0, "pending", 0)).then(pendingFails(0))
    .expect(s.calls.get(0).outcome == "error" and s.known == Set(1) and safety)
  // A read admitted under the first owner answers after the owner changed and changed back.
  run oldReadCannotReviveWarningsTest = init.then(startCall(0, "pending", 0)).then(ownerChanges).then(ownerChanges)
    .then(pendingAnswers(0, Set(0))).expect(s.known == Set() and s.staleEffects == 1 and safety)
    .then(startCall(1, "pending", 0)).then(pendingFails(1)).expect(s.calls.get(1).outcome == "quiet" and safety)
  run lateUndoCannotClearNewSessionTest = init.then(startCall(0, "pending", 0)).then(pendingAnswers(0, Set(0)))
    .then(startCall(0, "undo", 0)).then(ownerChanges).then(ownerChanges)
    .then(startCall(1, "pending", 0)).then(pendingAnswers(1, Set(0))).then(undoAnswers(0, true))
    .expect(s.known == Set(0) and safety)
  run onlyConfirmedUndoRetiresRowTest = init.then(startCall(0, "pending", 0)).then(pendingAnswers(0, Set(0)))
    .then(startCall(1, "undo", 0)).then(undoAnswers(1, false)).expect(s.known == Set(0) and safety)
    .then(startCall(1, "undo", 0)).then(undoAnswers(1, true)).expect(s.known == Set() and safety)
  run dismissalRetiresRowAndFailureIsReportedTest = init.then(startCall(0, "pending", 0)).then(pendingAnswers(0, Set(0, 1)))
    .then(startCall(1, "dismiss", 1)).then(explicitFails(1)).expect(s.calls.get(1).outcome == "error" and s.known == Set(0, 1) and safety)
    .then(startCall(1, "dismiss", 1)).then(dismissAnswers(1)).expect(s.known == Set(0) and safety)
}
