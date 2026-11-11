// Device-calendar writes from the Calendar form and event detail: creation receipts, the single
// write in progress, the unconfirmed-write latch on one event, and inspect-then-delete.
module CalendarDeviceWrites {
  type State = {
    // form: "none" | "new" | "edit". formEpoch changes whenever the form is replaced or closed,
    // so a running save can tell that the form it submitted is no longer the one shown.
    form: str, separate: bool, formEpoch: int,
    // saving: one create, edit or delete at a time. stage names the awaited step.
    saving: bool, stage: str, opKind: str, opEpoch: int, opSeparate: bool,
    // The native creation journal. An entry is written "unknown" before the provider insert and
    // turns "saved" when the insert returns or a later read finds its event. Only a saved entry
    // can be acknowledged. unknownExists counts unknown entries whose event is in the provider.
    unknownReceipts: int, unknownExists: int, savedReceipts: int,
    // What the last receipt read showed here, and whether that read failed.
    pendingShown: bool, recoveryFailed: bool,
    // uncertain: an edit or delete of the selected event may have reached the provider. A forced
    // read of the range holding the event clears it, because that read shows the outcome: the
    // event is listed as it now is (the edit's result, or a delete that did not happen), or the
    // deleted event is gone. latchReached: the unconfirmed change took effect. latchReads counts
    // completed reads of that range that left the latch; otherRangeReads counts completed reads
    // of another range, which show nothing about the event. releasedUnapplied: a read released
    // a delete latch whose event is still listed, and no later delete has removed that event.
    uncertain: bool, uncertainKind: str, latchReached: bool, latchReads: int,
    otherRangeReads: int, releasedUnapplied: bool,
    selected: bool, events: int,
    blindDuplicate: bool, latchedWrite: bool
  }
  var s: State
  pure val Stages = Set("idle", "receipts", "writing", "acknowledging", "inspecting", "deleting")
  action init = s' = { form: "none", separate: false, formEpoch: 0,
    saving: false, stage: "idle", opKind: "none", opEpoch: 0, opSeparate: false,
    unknownReceipts: 0, unknownExists: 0, savedReceipts: 0,
    pendingShown: false, recoveryFailed: false,
    uncertain: false, uncertainKind: "none", latchReached: false, latchReads: 0,
    otherRangeReads: 0, releasedUnapplied: false,
    selected: true, events: 1,
    blindDuplicate: false, latchedWrite: false }
  val Receipts = s.unknownReceipts + s.savedReceipts
  val OwnsForm = s.opEpoch == s.formEpoch
  pure def released(state: State): State =
    { ...state, saving: false, stage: "idle", opKind: "none" }
  // Reading the journal lets native settle unknown entries whose event exists.
  pure def journalRead(state: State): State =
    { ...state, savedReceipts: state.savedReceipts + state.unknownExists,
      unknownReceipts: state.unknownReceipts - state.unknownExists, unknownExists: 0,
      pendingShown: state.unknownReceipts + state.savedReceipts > 0, recoveryFailed: false }

  // A separate creation is offered only beside the recovery notice and needs explicit confirmation.
  action newForm(separate: bool): bool = all {
    s.formEpoch < 5, not(separate) or s.pendingShown,
    s' = { ...s, form: "new", separate: separate, formEpoch: s.formEpoch + 1 }
  }
  action openEdit = all {
    s.formEpoch < 5, s.selected, s.events > 0,
    s' = { ...s, form: "edit", separate: false, formEpoch: s.formEpoch + 1 }
  }
  action closeForm = all {
    s.formEpoch < 5, s.form != "none",
    s' = { ...s, form: "none", separate: false, formEpoch: s.formEpoch + 1 }
  }
  // Saving an existing event is refused while an earlier change is unconfirmed.
  action startSave = all {
    s.form != "none", not(s.saving), s.form == "new" or not(s.uncertain),
    s' = { ...s, saving: true, stage: if (s.form == "new") "receipts" else "writing",
      opKind: if (s.form == "new") "create" else "edit", opEpoch: s.formEpoch,
      opSeparate: s.separate }
  }
  // Earlier receipts are read before a create. Any unacknowledged receipt stops a plain create;
  // a failed read stops it too and is reported as recovery being unavailable.
  action readReceipts(ok: bool): bool = all {
    s.stage == "receipts",
    s' = if (not(ok)) { ...released(s), recoveryFailed: if (OwnsForm) true else s.recoveryFailed,
        pendingShown: if (OwnsForm) false else s.pendingShown }
      else if (not(OwnsForm)) released(journalRead(s))
      else if (Receipts > 0 and not(s.opSeparate)) released(journalRead(s))
      else { ...journalRead(s), stage: "writing" }
  }
  // Native refuses a plain create while another entry is unacknowledged.
  action createRefused = all {
    s.stage == "writing", s.opKind == "create", Receipts > 0, not(s.opSeparate),
    s' = released(journalRead(s))
  }
  action createSaved = all {
    s.stage == "writing", s.opKind == "create", Receipts == 0 or s.opSeparate,
    s.events < 3, s.savedReceipts < 3,
    s' = { ...s, savedReceipts: s.savedReceipts + 1, events: s.events + 1,
      blindDuplicate: s.blindDuplicate or (Receipts > 0 and not(s.opSeparate)),
      saving: OwnsForm, stage: if (OwnsForm) "acknowledging" else "idle",
      opKind: if (OwnsForm) "create" else "none",
      form: if (OwnsForm) "none" else s.form,
      formEpoch: s.formEpoch }
  }
  // The answer was lost: the journal keeps the entry as unknown, and the insert may have happened.
  action createLost(reached: bool): bool = all {
    s.stage == "writing", s.opKind == "create", Receipts == 0 or s.opSeparate,
    s.events < 3, s.unknownReceipts < 2,
    s' = { ...released(s), unknownReceipts: s.unknownReceipts + 1,
      unknownExists: if (reached) s.unknownExists + 1 else s.unknownExists,
      events: if (reached) s.events + 1 else s.events,
      blindDuplicate: s.blindDuplicate or (Receipts > 0 and not(s.opSeparate)),
      pendingShown: true }
  }
  // A lost acknowledgement leaves a saved receipt for the next check to clear.
  action acknowledge(ok: bool): bool = all {
    s.stage == "acknowledging", s.savedReceipts > 0,
    s' = if (ok) { ...released(s), savedReceipts: s.savedReceipts - 1 }
      else { ...released(s), pendingShown: true }
  }
  // Checking receipts confirms saved creations and recreates nothing. An unknown entry whose
  // event does not exist stays in the journal.
  action checkCreations(ok: bool): bool = all {
    not(s.saving),
    s' = if (ok) { ...journalRead(s), savedReceipts: 0,
        pendingShown: s.unknownReceipts - s.unknownExists > 0 }
      else { ...s, recoveryFailed: true }
  }
  action editResult(outcome: str): bool = all {
    s.stage == "writing", s.opKind == "edit", outcome.in(Set("saved", "conflict", "lost")),
    s' = { ...released(s), latchedWrite: s.latchedWrite or s.uncertain,
      uncertain: s.uncertain or outcome == "lost",
      uncertainKind: if (outcome == "lost") "edit" else s.uncertainKind,
      latchReached: if (outcome == "lost") true else s.latchReached,
      latchReads: if (outcome == "lost") 0 else s.latchReads,
      otherRangeReads: if (outcome == "lost") 0 else s.otherRangeReads,
      form: if (outcome == "saved" and OwnsForm) "none" else s.form }
  }
  action startDelete = all {
    s.selected, s.events > 0, not(s.saving), not(s.uncertain),
    s' = { ...s, saving: true, stage: "inspecting", opKind: "delete", opEpoch: s.formEpoch }
  }
  // Nothing is dispatched unless the reviewed event is still the current one.
  action inspect(ready: bool): bool = all {
    s.stage == "inspecting",
    s' = if (ready) { ...s, stage: "deleting" } else released(s)
  }
  // An unknown answer leaves the latch; the delete may or may not have removed the event.
  action deleteOutcome(outcome: str, reached: bool): bool = all {
    s.stage == "deleting", outcome.in(Set("queued", "deleted", "conflict", "unknown")),
    reached implies outcome == "unknown",
    s' = { ...released(s), latchedWrite: s.latchedWrite or s.uncertain,
      uncertain: s.uncertain or outcome == "unknown",
      uncertainKind: if (outcome == "unknown") "delete" else s.uncertainKind,
      latchReached: if (outcome == "unknown") reached else s.latchReached,
      latchReads: if (outcome == "unknown") 0 else s.latchReads,
      otherRangeReads: if (outcome == "unknown") 0 else s.otherRangeReads,
      releasedUnapplied: s.releasedUnapplied and not(outcome == "deleted" or reached),
      events: if (outcome == "deleted" or reached) s.events - 1 else s.events }
  }
  action deleteResult(outcome: str): bool = deleteOutcome(outcome, false)
  // The event's Refresh and the status line's retry read the device calendars again. covers: the
  // read range holds the latched event. Such a read shows the outcome and releases the latch:
  // the event is listed (an edit's result, or a delete the provider never applied), or a deleted
  // event is no longer listed. A failed read, or a read of another range, releases nothing.
  pure def readShowsOutcome(state: State): bool =
    state.uncertainKind == "edit" or state.latchReached or state.events > 0
  action readAgain(ok: bool, covers: bool): bool = all {
    s.uncertain,
    s' = if (ok and covers and readShowsOutcome(s))
        { ...s, uncertain: false, uncertainKind: "none", latchReached: false, latchReads: 0,
          otherRangeReads: 0,
          releasedUnapplied: s.releasedUnapplied
            or (s.uncertainKind == "delete" and not(s.latchReached)) }
      else if (ok and covers)
        { ...s, latchReads: if (s.latchReads < 2) s.latchReads + 1 else s.latchReads }
      else if (ok)
        { ...s, otherRangeReads: if (s.otherRangeReads < 2) s.otherRangeReads + 1 else s.otherRangeReads }
      else s
  }
  action retryStatus(ok: bool): bool = readAgain(ok, true)
  // A new component instance starts with no latch and no receipt view; the journal is durable.
  action remount = all {
    not(s.saving), s.formEpoch < 5,
    s' = { ...s, form: "none", separate: false, formEpoch: s.formEpoch + 1, uncertain: false,
      uncertainKind: "none", latchReached: false, latchReads: 0, otherRangeReads: 0,
      pendingShown: false, recoveryFailed: false }
  }
  action step = {
    nondet flag = Bool.oneOf()
    nondet covers = Bool.oneOf()
    nondet outcome = Set("saved", "conflict", "lost", "queued", "deleted", "unknown").oneOf()
    any {
      newForm(flag), openEdit, closeForm, startSave, readReceipts(flag), createRefused, createSaved,
      createLost(flag), acknowledge(flag), checkCreations(flag), editResult(outcome), startDelete,
      inspect(flag), deleteOutcome(outcome, flag), readAgain(flag, covers), remount, s' = s
    }
  }

  // No second event is created while an earlier creation is unreviewed, unless the owner
  // explicitly asked for a separate one.
  val NoBlindDuplicate = not(s.blindDuplicate)
  val CreateWaitsForReceipts = (s.stage == "writing" and s.opKind == "create")
    implies (Receipts == 0 or s.opSeparate)
  val SingleWrite = (s.saving iff s.stage != "idle") and (s.saving iff s.opKind != "none")
  // No edit or delete is dispatched while an earlier one is unconfirmed.
  val LatchBlocksWrites = not(s.latchedWrite)
  val LatchHoldsDelete = not(s.uncertain and s.stage.in(Set("inspecting", "deleting")))
  val LatchKindSet = s.uncertain iff s.uncertainKind != "none"
  // No latch survives a completed read of the range holding its event: an edit and a delete are
  // both released, whether or not the change reached the provider.
  val CoveringReadReleasesLatch = s.latchReads == 0
  // A latch is released only by such a read or by a new instance, so while it is released after
  // an unapplied delete the event is still there to edit or delete again.
  val UnappliedDeleteKeepsEvent = (s.releasedUnapplied and not(s.uncertain)) implies s.events > 0
  val OtherRangeReadsNeedLatch = s.otherRangeReads.in(0.to(2))
    and (s.otherRangeReads > 0 implies s.uncertain)
  val JournalConsistent = s.unknownExists <= s.unknownReceipts and s.unknownExists >= 0
    and s.savedReceipts >= 0 and s.unknownReceipts >= 0
  val TypeOK = Stages.contains(s.stage) and s.form.in(Set("none", "new", "edit"))
    and s.opKind.in(Set("none", "create", "edit", "delete")) and s.events.in(0.to(3))
    and s.formEpoch.in(0.to(5)) and s.unknownReceipts.in(0.to(2)) and s.savedReceipts.in(0.to(5))
  val safety = TypeOK and NoBlindDuplicate and CreateWaitsForReceipts and SingleWrite
    and LatchBlocksWrites and LatchHoldsDelete and LatchKindSet and CoveringReadReleasesLatch
    and UnappliedDeleteKeepsEvent and OtherRangeReadsNeedLatch and JournalConsistent

  val UncertainLatchWitness = s.uncertain and not(s.saving)
  // The delete did not happen and the event is still listed: reading again released the latch.
  val ReleasedUnappliedDeleteWitness = s.releasedUnapplied and not(s.uncertain) and s.events > 0
  // A read of another range left the latch in place.
  val OtherRangeReadWitness = s.uncertain and s.otherRangeReads > 0
  val UnknownReceiptWitness = s.unknownReceipts > 0 and s.unknownExists == 0 and not(s.saving)
  val SeparateCreate = s.stage == "writing" and s.opSeparate and Receipts > 0
  val SeparateFormWitness = s.form == "new" and s.separate
  val SupersededSaveWitness = s.saving and s.opEpoch != s.formEpoch
  val RecoveryFailedWitness = s.recoveryFailed

  run confirmedCreateTest = init.then(newForm(false)).then(startSave).then(readReceipts(true))
    .then(createSaved).expect(s.stage == "acknowledging" and s.form == "none")
    .then(acknowledge(true))
    .expect(s.events == 2 and Receipts == 0 and not(s.saving) and safety)
  // The answer to a create was lost and the event exists: a second save creates nothing until
  // the receipt is checked, and checking it confirms the first event.
  run lostCreateBlocksSecondTest = init.then(newForm(false)).then(startSave).then(readReceipts(true))
    .then(createLost(true)).expect(s.unknownReceipts == 1 and s.events == 2 and not(s.saving))
    .then(startSave).then(readReceipts(true))
    .expect(not(s.saving) and s.events == 2 and s.savedReceipts == 1 and safety)
    .then(startSave).then(readReceipts(true)).expect(not(s.saving) and s.events == 2)
    .then(checkCreations(true)).expect(Receipts == 0 and not(s.pendingShown))
    .then(startSave).then(readReceipts(true)).expect(s.stage == "writing" and safety)
  // Nothing was created: the unknown entry stays, a plain create is refused, and only an
  // explicitly separate creation goes ahead.
  run separateCreationTest = init.then(newForm(false)).then(startSave).then(readReceipts(true))
    .then(createLost(false)).expect(UnknownReceiptWitness)
    .then(checkCreations(true)).expect(s.unknownReceipts == 1 and s.pendingShown)
    .then(startSave).then(readReceipts(true)).expect(not(s.saving) and s.events == 1)
    .then(newForm(true)).then(startSave).then(readReceipts(true)).expect(SeparateCreate)
    .then(createSaved).then(acknowledge(true))
    .expect(s.events == 2 and s.unknownReceipts == 1 and safety)
  run plainCreateRefusedByNativeTest = init.then(newForm(false)).then(startSave)
    .then(readReceipts(true)).then(createLost(false)).then(startSave).then(readReceipts(true))
    .then(createSaved.fail())
  // An unconfirmed edit blocks further changes until the device calendars are read again.
  run latchClearableTest = init.then(openEdit).then(startSave).then(editResult("lost"))
    .expect(UncertainLatchWitness).then(startDelete.fail())
  run latchClearedByRetryTest = init.then(openEdit).then(startSave).then(editResult("lost"))
    .then(retryStatus(false)).expect(s.uncertain).then(retryStatus(true)).expect(not(s.uncertain))
    .then(startDelete).then(inspect(true)).then(deleteResult("deleted"))
    .expect(s.events == 0 and not(s.saving) and safety)
  // An unconfirmed delete that removed the event is cleared by the next read.
  run reachedDeleteClearsTest = init.then(startDelete).then(inspect(true)).then(deleteOutcome("unknown", true))
    .expect(s.uncertain and s.events == 0).then(retryStatus(true))
    .expect(not(s.uncertain) and safety)
  // An unconfirmed delete that never happened: the event is still listed, so the next read of its
  // range releases it and the owner can delete it again. It does not stay held for the instance.
  run unappliedDeleteReleasedTest = init.then(startDelete).then(inspect(true))
    .then(deleteOutcome("unknown", false)).expect(s.uncertain and s.events == 1)
    .then(readAgain(false, true)).expect(s.uncertain)
    .then(readAgain(true, true))
    .expect(ReleasedUnappliedDeleteWitness and s.latchReads == 0 and safety)
    .then(startDelete).then(inspect(true)).then(deleteResult("deleted"))
    .expect(s.events == 0 and not(s.uncertain) and not(s.saving) and safety)
  // A read of another range shows nothing about the event and releases nothing.
  run otherRangeReadKeepsLatchTest = init.then(startDelete).then(inspect(true))
    .then(deleteOutcome("unknown", false)).then(readAgain(true, false))
    .expect(OtherRangeReadWitness and safety)
    .then(readAgain(true, true)).expect(not(s.uncertain) and s.events == 1 and safety)
  run otherRangeReadStillBlocksDeleteTest = init.then(startDelete).then(inspect(true))
    .then(deleteOutcome("unknown", false)).then(readAgain(true, false)).then(startDelete.fail())
  run remountClearsLatchTest = init.then(startDelete).then(inspect(true))
    .then(deleteOutcome("unknown", false)).then(readAgain(true, false)).then(remount)
    .expect(not(s.uncertain)).then(startDelete).expect(s.stage == "inspecting" and safety)
  run latchBlocksEditSaveTest = init.then(startDelete).then(inspect(true)).then(deleteResult("unknown"))
    .then(openEdit).then(startSave.fail())
  // The form was replaced while its save was reading receipts: nothing is written for it.
  run supersededSaveTest = init.then(newForm(false)).then(startSave).then(newForm(false))
    .expect(SupersededSaveWitness).then(readReceipts(true))
    .expect(not(s.saving) and s.events == 1 and Receipts == 0 and safety)
  run changedEventNotDeletedTest = init.then(startDelete).then(inspect(false))
    .expect(not(s.saving) and s.events == 1 and not(s.uncertain) and safety)
}
