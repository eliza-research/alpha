// Durable reminder intents: a creation record retained before scheduleReminder, and an operation
// record retained before operateReminder. Recovery only reads; it never schedules or operates.
module ReminderIntents {
  type State = {
    // Creation history, bounded by Cap. A pending row is "known" when the reminder it asked for
    // is saved natively (a readback will find it) and "absent" when it is not.
    pendingKnown: int, pendingAbsent: int, foundRows: int,
    // The running create: "idle" | "retain" | "dispatch".
    saving: bool, stage: str, formHasId: bool, attemptRetained: bool,
    // formRow: the open form's own creation row: "none" | "absent" | "known" | "found".
    formRow: str,
    attempts: int, schedules: int, dispatchWithoutRecord: bool,
    createRefusedFull: bool,
    // Operation intents (cancel, complete, snooze, update), bounded by OpCap. "succeeded" rows
    // have a native receipt waiting to be acknowledged; "unknown" rows have none.
    opsSucceeded: int, opsUnknown: int, opStage: str, opRetained: bool,
    opAttempts: int, operates: int, operateWithoutRecord: bool
  }
  var s: State
  // Stand-ins for the stores' 32-row and 100-row limits.
  pure val Cap = 2
  pure val OpCap = 2
  action init = s' = { pendingKnown: 0, pendingAbsent: 0, foundRows: 0,
    saving: false, stage: "idle", formHasId: false, attemptRetained: false, formRow: "none",
    attempts: 0, schedules: 0, dispatchWithoutRecord: false,
    createRefusedFull: false,
    opsSucceeded: 0, opsUnknown: 0, opStage: "idle", opRetained: false,
    opAttempts: 0, operates: 0, operateWithoutRecord: false }
  val Pending = s.pendingKnown + s.pendingAbsent
  val Ops = s.opsSucceeded + s.opsUnknown
  pure def finished(state: State): State =
    { ...state, saving: false, stage: "idle", attemptRetained: false }
  // A reminder refresh reads only: creations whose reminder is saved become found, and operations
  // with a native receipt are acknowledged. Every confirmed save or operation ends with one.
  pure def refreshed(state: State): State =
    { ...state, foundRows: state.foundRows + state.pendingKnown, pendingKnown: 0, opsSucceeded: 0,
      formRow: if (state.formRow == "known") "found" else state.formRow }

  // A new reminder while an earlier creation is unconfirmed needs the owner's explicit choice.
  action startCreate(separate: bool): bool = all {
    not(s.saving), s.opStage == "idle", not(s.formHasId), s.attempts < 4, Pending == 0 or separate,
    s' = { ...s, saving: true, stage: "retain", attempts: s.attempts + 1 }
  }
  // The record is saved before anything is scheduled. Found rows make room for it; pending rows
  // never do, so a history full of pending rows refuses the save.
  action retain = all {
    s.stage == "retain",
    s' = if (Pending >= Cap) { ...finished(s), createRefusedFull: true }
      else { ...s, stage: "dispatch", attemptRetained: true, formHasId: true,
        foundRows: if (Pending + 1 + s.foundRows > Cap) Cap - Pending - 1 else s.foundRows }
  }
  // The form changed or the view left before scheduleReminder: the unsent record is removed.
  action abandon = all {
    s.stage == "dispatch", s' = { ...finished(s), formHasId: false }
  }
  // outcome: "scheduled" (saved and read back), "refused" (definite refusal, nothing saved),
  // "lost-saved" (no answer, the reminder exists), "lost-absent" (no answer, nothing saved).
  action dispatch(outcome: str): bool = all {
    s.stage == "dispatch", outcome.in(Set("scheduled", "refused", "lost-saved", "lost-absent")),
    val sent = { ...finished(s), schedules: s.schedules + 1,
      dispatchWithoutRecord: s.dispatchWithoutRecord or not(s.attemptRetained) }
    s' = if (outcome.in(Set("scheduled", "lost-saved")))
        refreshed({ ...sent, foundRows: s.foundRows + 1, formHasId: false })
      else if (outcome == "refused") { ...sent, formHasId: false }
      else { ...sent, pendingAbsent: s.pendingAbsent + 1, formHasId: true, formRow: "absent" }
  }
  // Saving the same form again only reads: the form's own row is checked, never scheduled again.
  // Once that row is found the form closes and the reminders are read again.
  action saveAgain = all {
    not(s.saving), s.opStage == "idle", s.formHasId,
    s' = if (s.formRow == "absent") s
      else refreshed({ ...s, formHasId: false, formRow: "none",
        pendingKnown: if (s.formRow == "known") s.pendingKnown - 1 else s.pendingKnown,
        foundRows: if (s.formRow == "known") s.foundRows + 1 else s.foundRows })
  }
  action closeForm = all {
    not(s.saving), s.formHasId, s' = { ...s, formHasId: false, formRow: "none" }
  }
  // The native save lands after the readback missed it: the open form's, or an earlier one's.
  action lateSave(own: bool): bool = all {
    if (own) s.formRow == "absent" else s.pendingAbsent > (if (s.formRow == "absent") 1 else 0),
    s' = { ...s, pendingAbsent: s.pendingAbsent - 1, pendingKnown: s.pendingKnown + 1,
      formRow: if (own) "known" else s.formRow }
  }
  // Every refresh checks pending rows against the saved reminders.
  action reconcileCreations = all { s.pendingKnown > 0, s' = refreshed(s) }
  // The handler keeps an operation record before operateReminder, and removes it only when it
  // never called it.
  // One reminder write runs at a time, and a reminder's detail is not reachable under an open form.
  action startOperation = all {
    s.opStage == "idle", not(s.saving), not(s.formHasId), Ops < OpCap, s.opAttempts < 4,
    s' = { ...s, opStage: "retained", opRetained: true, opAttempts: s.opAttempts + 1 }
  }
  action abandonOperation = all {
    s.opStage == "retained", s' = { ...s, opStage: "idle", opRetained: false }
  }
  // outcome: "succeeded" (acknowledged at once), "lost-applied" (the receipt exists),
  // "lost-never" (native never applied it and has no receipt).
  action operate(outcome: str): bool = all {
    s.opStage == "retained", outcome.in(Set("succeeded", "lost-applied", "lost-never")),
    val sent = { ...s, opStage: "idle", opRetained: false, operates: s.operates + 1,
      operateWithoutRecord: s.operateWithoutRecord or not(s.opRetained) }
    s' = if (outcome == "succeeded") refreshed(sent)
      else if (outcome == "lost-applied") { ...sent, opsSucceeded: s.opsSucceeded + 1 }
      else { ...sent, opsUnknown: s.opsUnknown + 1 }
  }
  // Reconciliation acknowledges succeeded receipts and executes nothing.
  action reconcileOperations = all { s.opsSucceeded > 0, s' = refreshed(s) }
  // An owner's explicit removal of an unconfirmed record. It is kept out of `step` because the
  // Android reminder screens offer no such action; the scenarios below use it to show what it frees.
  action ownerDiscard(kind: str): bool = all {
    kind.in(Set("creation", "operation")),
    if (kind == "creation") all { s.pendingAbsent > 0, not(s.saving),
      s' = { ...s, pendingAbsent: s.pendingAbsent - 1, formHasId: false, formRow: "none" } }
    else all { s.opsUnknown > 0, s.opStage == "idle", s' = { ...s, opsUnknown: s.opsUnknown - 1 } }
  }
  action step = {
    nondet flag = Bool.oneOf()
    nondet own = Bool.oneOf()
    nondet outcome = Set("scheduled", "refused", "lost-saved", "lost-absent").oneOf()
    nondet result = Set("succeeded", "lost-applied", "lost-never").oneOf()
    any {
      startCreate(flag), retain, abandon, dispatch(outcome), saveAgain, closeForm, lateSave(own),
      reconcileCreations, startOperation, abandonOperation, operate(result), reconcileOperations,
      s' = s
    }
  }

  // Nothing is scheduled or operated without its durable record, and never twice per attempt.
  val RecordBeforeDispatch = not(s.dispatchWithoutRecord) and not(s.operateWithoutRecord)
  val OneDispatchPerAttempt = s.schedules <= s.attempts and s.operates <= s.opAttempts
  val HistoryBounded = Pending + s.foundRows <= Cap and Ops <= OpCap
    and s.pendingKnown >= 0 and s.pendingAbsent >= 0 and s.foundRows >= 0
  // A form keeps its creation id only while that creation's record is kept.
  val FormIdHasRecord = s.formHasId implies (s.stage == "dispatch" or Pending + s.foundRows > 0)
  // The open form's row is one of the rows the history holds.
  val FormRowCounted = (s.formRow != "none" implies s.formHasId)
    and (s.formRow == "absent" implies s.pendingAbsent > 0)
    and (s.formRow == "known" implies s.pendingKnown > 0)
    and (s.formRow == "found" implies s.foundRows > 0)
  // Creating a reminder and operating on one never run together.
  val OneReminderWrite = not(s.saving and s.opStage != "idle")
  val SavingHasStage = s.saving iff s.stage != "idle"
  val RetainedWhileDispatching = (s.stage == "dispatch" implies s.attemptRetained)
    and (s.opStage == "retained" implies s.opRetained)
  // The save is refused for a full history only when pending rows fill it.
  val FullOnlyByPending = s.createRefusedFull implies s.attempts > Cap
  val TypeOK = s.stage.in(Set("idle", "retain", "dispatch")) and s.opStage.in(Set("idle", "retained"))
    and s.attempts.in(0.to(4)) and s.opAttempts.in(0.to(4))
    and s.formRow.in(Set("none", "absent", "known", "found"))
  val safety = TypeOK and RecordBeforeDispatch and OneDispatchPerAttempt and HistoryBounded
    and FormIdHasRecord and SavingHasStage and RetainedWhileDispatching and FullOnlyByPending
    and FormRowCounted and OneReminderWrite

  // Pending rows whose reminder never existed: recovery cannot resolve them.
  val UnresolvableCreationWitness = s.pendingAbsent > 0 and not(s.saving)
  val HistoryFullOfPendingWitness = s.pendingAbsent == Cap
  val UnknownOperationWitness = s.opsUnknown > 0 and s.opStage == "idle"
  val OperationsFullWitness = s.opsUnknown == OpCap
  val FoundRowWitness = s.foundRows > 0
  // An earlier creation's reminder is saved while the open form's own save is still unconfirmed.
  val OtherRowKnownWitness = s.formRow == "absent" and s.pendingKnown > 0

  run confirmedCreateTest = init.then(startCreate(false)).then(retain).then(dispatch("scheduled"))
    .expect(s.foundRows == 1 and Pending == 0 and s.schedules == 1 and not(s.formHasId) and safety)
  run refusedCreateLeavesNothingTest = init.then(startCreate(false)).then(retain).then(dispatch("refused"))
    .expect(Pending == 0 and s.foundRows == 0 and not(s.formHasId) and safety)
    .then(startCreate(false)).then(retain).expect(s.stage == "dispatch")
  // The answer was lost and nothing was saved: the same form never schedules again.
  run lostCreateNeverRepeatsTest = init.then(startCreate(false)).then(retain).then(dispatch("lost-absent"))
    .expect(UnresolvableCreationWitness and s.formHasId).then(saveAgain)
    .expect(s.schedules == 1 and s.pendingAbsent == 1 and safety)
    .then(startCreate(true).fail())
  run lateSaveFoundTest = init.then(startCreate(false)).then(retain).then(dispatch("lost-absent"))
    .then(lateSave(true)).then(reconcileCreations)
    .expect(Pending == 0 and s.foundRows == 1 and s.schedules == 1 and safety)
  run separateCreateNeedsChoiceTest = init.then(startCreate(false)).then(retain)
    .then(dispatch("lost-absent")).then(closeForm).then(startCreate(false).fail())
  run foundRowsMakeRoomTest = init.then(startCreate(false)).then(retain).then(dispatch("scheduled"))
    .then(startCreate(false)).then(retain).then(dispatch("scheduled")).expect(s.foundRows == Cap)
    .then(startCreate(false)).then(retain)
    .expect(s.stage == "dispatch" and s.foundRows == Cap - 1 and safety)
  // Unconfirmed creations nothing was saved for fill the history and no reminder can be created.
  // Recovery never clears them; an explicit owner discard does.
  run fullHistoryNeedsOwnerDiscardTest = init.then(startCreate(false)).then(retain)
    .then(dispatch("lost-absent")).then(closeForm).then(startCreate(true)).then(retain)
    .then(dispatch("lost-absent")).then(closeForm).expect(HistoryFullOfPendingWitness)
    .then(reconcileCreations.fail())
  run ownerDiscardFreesHistoryTest = init.then(startCreate(false)).then(retain)
    .then(dispatch("lost-absent")).then(closeForm).then(startCreate(true)).then(retain)
    .then(dispatch("lost-absent")).then(closeForm).then(startCreate(true)).then(retain)
    .expect(s.createRefusedFull and not(s.saving) and s.schedules == 2 and safety)
    .then(ownerDiscard("creation")).then(startCreate(true)).then(retain)
    .expect(s.stage == "dispatch" and safety)
  // Another creation's reminder turned up: saving this form again still finds nothing of its own.
  run saveAgainChecksOwnRowTest = init.then(startCreate(false)).then(retain).then(dispatch("lost-absent"))
    .then(closeForm).then(startCreate(true)).then(retain).then(dispatch("lost-absent"))
    .then(lateSave(false)).expect(OtherRowKnownWitness).then(saveAgain)
    .expect(s.formHasId and s.pendingKnown == 1 and s.pendingAbsent == 1 and s.schedules == 2 and safety)
    .then(lateSave(true)).then(saveAgain)
    .expect(not(s.formHasId) and Pending == 0 and s.foundRows == 2 and s.schedules == 2 and safety)
  run oneWriteAtATimeTest = init.then(startCreate(false)).then(startOperation.fail())
  run abandonedCreateRemovedTest = init.then(startCreate(false)).then(retain).then(abandon)
    .expect(Pending == 0 and s.schedules == 0 and not(s.formHasId) and safety)
  run lostOperationAcknowledgedTest = init.then(startOperation).then(operate("lost-applied"))
    .expect(s.opsSucceeded == 1).then(reconcileOperations)
    .expect(Ops == 0 and s.operates == 1 and safety)
  // An operation native never applied has no receipt: reconciliation keeps it for good.
  run neverAppliedOperationStaysTest = init.then(startOperation).then(operate("lost-never"))
    .expect(UnknownOperationWitness).then(reconcileOperations.fail())
  run operationsFullTest = init.then(startOperation).then(operate("lost-never"))
    .then(startOperation).then(operate("lost-never")).expect(OperationsFullWitness)
    .then(startOperation.fail())
  run ownerDiscardFreesOperationsTest = init.then(startOperation).then(operate("lost-never"))
    .then(startOperation).then(operate("lost-never")).then(ownerDiscard("operation"))
    .then(startOperation).expect(s.opStage == "retained" and safety)
}
