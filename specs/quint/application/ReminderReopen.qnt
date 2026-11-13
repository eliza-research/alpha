// Reopen and Reopen tomorrow on the detail of one completed one-off reminder. The owner reviews
// the new time first, and a time that passed during the review is refused. The update is bound
// to the revision the detail showed and journaled before native is asked; a journaled update is
// only ever read back. A confirmed update is acknowledged, then the reminders are read once more:
// it is reported as reopened only when that read shows a new open occurrence at the reviewed time.
module ReminderReopen {
  type State = {
    // stale: the reminders shown may be out of date. selected: this reminder's detail is open.
    // completed: the detail shows the reminder as completed. nativeCompleted: native holds it so.
    stale: bool, selected: bool, completed: bool, nativeCompleted: bool,
    // saving: the reminder write mutex. stage: "idle" | "lookup" (journal read) | "select"
    // (native revision read) | "retained" (record written) | "operate" | "receipt" | "readback".
    saving: bool, stage: str, mode: str,
    // journal: the reopen journaled for the shown revision, by its mode ("none" when there is
    // none). journalFresh: a press now would compute the schedule that record holds.
    // own: the running handler wrote that record. applied: native carried the journaled update out.
    journal: str, journalFresh: bool, own: bool, applied: bool,
    // revisionCurrent: native still holds the revision the detail shows.
    revisionCurrent: bool,
    starts: int, retains: int, operates: int,
    // outcome of the last press or refresh.
    outcome: str,
    operateWithoutRecord: bool, startedStale: bool, startedOpen: bool, startedUnreviewed: bool
  }
  var s: State
  pure val Modes = Set("open", "tomorrow")
  pure val Lost = Set("succeeded", "lost-applied", "lost-never")
  action init = s' = { stale: false, selected: true, completed: true, nativeCompleted: true, saving: false,
    stage: "idle", mode: "none", journal: "none", journalFresh: true, own: false, applied: false,
    revisionCurrent: true, starts: 0, retains: 0, operates: 0, outcome: "none",
    operateWithoutRecord: false, startedStale: false, startedOpen: false, startedUnreviewed: false }
  pure def released(state: State, outcome: str): State =
    { ...state, saving: false, stage: "idle", mode: "none", own: false, outcome: outcome }
  // A confirmed update removes its record; the read back comes next.
  pure def acknowledged(state: State): State =
    { ...state, stage: "readback", journal: "none", journalFresh: true, own: false, applied: false }

  // Reopen is offered on a completed reminder whose shown state is current, with no other write
  // running. The owner approves the reviewed time; when that time passed meanwhile nothing starts.
  // The review took long enough that a journaled schedule no longer matches either.
  action start(mode: str, approved: bool, passed: bool): bool = all {
    Modes.contains(mode), not(s.saving), not(s.stale), s.selected, s.completed, s.starts < 6,
    s' = if (not(approved)) { ...s, outcome: "declined" }
      else if (passed) { ...s, outcome: "passed", journalFresh: s.journal == "none" }
      else { ...s, saving: true, stage: "lookup", mode: mode, starts: s.starts + 1,
        startedStale: s.startedStale or s.stale, startedOpen: s.startedOpen or not(s.completed),
        startedUnreviewed: s.startedUnreviewed or not(approved) or passed }
  }
  // A journaled reopen with the same schedule is read back and never sent again. Any other
  // journaled update on the same revision is refused: the other mode, or a schedule computed
  // at an earlier time.
  action lookup = all {
    s.stage == "lookup",
    s' = if (s.journal == "none") { ...s, stage: "select" }
      else if (s.journal != s.mode or not(s.journalFresh)) released(s, "conflict")
      else { ...s, stage: "receipt" }
  }
  // Native is asked for the current revision. A changed reminder is shown again and nothing is
  // journaled; so is a detail the owner already left.
  action selectedRead = all {
    s.stage == "select",
    s' = if (not(s.revisionCurrent))
        { ...released(s, "changed"), revisionCurrent: true, stale: false, completed: s.nativeCompleted }
      else if (not(s.selected)) released(s, "left")
      else { ...s, stage: "retained", journal: s.mode, journalFresh: true, own: true, retains: s.retains + 1 }
  }
  // The record is written. If the owner left meanwhile, the unsent record is removed again.
  action afterRetain = all {
    s.stage == "retained",
    s' = if (not(s.selected)) { ...released(s, "left"), journal: "none", journalFresh: true }
      else { ...s, stage: "operate", operates: s.operates + 1,
        operateWithoutRecord: s.operateWithoutRecord or s.journal == "none" }
  }
  // result: "succeeded", "lost-applied" (no answer, native did it) or "lost-never" (no answer,
  // native did nothing). A lost answer is followed by one receipt read.
  action operated(result: str): bool = all {
    s.stage == "operate", Lost.contains(result),
    s' = if (result == "succeeded") { ...acknowledged(s), nativeCompleted: false, revisionCurrent: false }
      else if (result == "lost-applied")
        { ...s, stage: "receipt", applied: true, nativeCompleted: false, revisionCurrent: false }
      else { ...s, stage: "receipt" }
  }
  // Only a receipt that says the update was carried out removes the record.
  action receipt(ok: bool): bool = all {
    s.stage == "receipt",
    s' = if (ok and s.applied) acknowledged(s) else released(s, "unconfirmed")
  }
  // The reminders are read once more. found: "match" (a new open occurrence at the reviewed
  // time), "changed" (the reminder was completed again meanwhile) or "failed" (the read failed).
  // Only a match is reported as reopened and shown; otherwise the detail keeps what it showed.
  action readback(found: str): bool = all {
    s.stage == "readback", found.in(Set("match", "changed", "failed")),
    s' = if (found == "match") { ...released(s, "reopened"), completed: false, revisionCurrent: true, stale: false }
      else { ...released(s, "unread"), nativeCompleted: found == "changed" }
  }
  action leave = all { s.selected, s' = { ...s, selected: false } }
  action show = all { not(s.selected), not(s.saving), s' = { ...s, selected: true } }
  // The reminder changed somewhere else without being reopened: its text, from another screen.
  action changedElsewhere = all {
    s.revisionCurrent, s.journal == "none", not(s.saving), s' = { ...s, revisionCurrent: false }
  }
  // The owner completes the reopened reminder again, which shows the new completed revision.
  action completeAgain = all {
    not(s.saving), not(s.stale), not(s.completed), not(s.nativeCompleted), s.journal == "none", s.revisionCurrent,
    s' = { ...s, completed: true, nativeCompleted: true }
  }
  // Enough time passes that a press computes a different schedule from the journaled one.
  action tick = all {
    not(s.saving), s.journal != "none", s.journalFresh, s' = { ...s, journalFresh: false }
  }
  // A refresh acknowledges a journaled update that native carried out, then reads the
  // reminders. It never sends an update. When the read fails the old revision stays shown.
  action refresh(ok: bool): bool = all {
    not(s.saving),
    val settled = if (s.applied) { ...s, journal: "none", journalFresh: true, applied: false, outcome: "acknowledged" } else s
    s' = if (ok) { ...settled, stale: false, revisionCurrent: true, completed: s.nativeCompleted }
      else { ...settled, stale: true }
  }
  action step = {
    nondet mode = Modes.oneOf()
    nondet result = Lost.oneOf()
    nondet found = Set("match", "changed", "failed").oneOf()
    nondet ok = Bool.oneOf()
    // The owner mostly approves, and the reviewed time rarely passes.
    nondet lot = 0.to(5).oneOf()
    any {
      start(mode, lot != 0, lot == 1), lookup, selectedRead, afterRetain, operated(result), receipt(ok),
      readback(found), leave, show, changedElsewhere, completeAgain, tick, refresh(ok), s' = s
    }
  }

  // Native is asked at most once per journaled record, and never without one.
  val RecordBeforeOperate = not(s.operateWithoutRecord)
  val OneOperatePerRecord = s.operates <= s.retains and s.retains <= s.starts
  // Only the handler that wrote the record sends it.
  val OnlyOwnRecordSent = s.stage == "operate" implies (s.own and s.journal == s.mode and s.journalFresh)
  val MutexHeld = (s.saving iff s.stage != "idle") and (s.saving iff s.mode != "none")
  // An unconfirmed update keeps its record; the read back runs only once the record is gone.
  val UnconfirmedKeepsRecord = (s.stage == "idle" and s.outcome == "unconfirmed") implies s.journal != "none"
  val ReadbackAfterAcknowledge = s.stage == "readback" implies (s.journal == "none" and not(s.applied))
  val OwnHasRecord = s.own implies s.journal == s.mode
  val AppliedHasRecord = s.applied implies (s.journal != "none" and not(s.nativeCompleted))
  // Nothing is written from an out-of-date detail, for a reminder shown as open, without the
  // owner's approval, or after the reviewed time passed.
  val FreshBeforeReopen = not(s.startedStale)
  val OnlyCompletedReopened = not(s.startedOpen)
  val ReviewedBeforeWrite = not(s.startedUnreviewed)
  // The detail shows the reminder as open only when native holds it open.
  val ShownOpenIsOpen = not(s.completed) implies not(s.nativeCompleted)
  val NoRecordIsFresh = s.journal == "none" implies s.journalFresh
  val TypeOK = s.stage.in(Set("idle", "lookup", "select", "retained", "operate", "receipt", "readback"))
    and s.mode.in(Modes.union(Set("none"))) and s.journal.in(Modes.union(Set("none")))
    and s.starts.in(0.to(6))
    and s.outcome.in(Set("none", "declined", "passed", "conflict", "changed", "left", "unconfirmed", "unread",
      "reopened", "acknowledged"))
  val safety = TypeOK and RecordBeforeOperate and OneOperatePerRecord and OnlyOwnRecordSent and MutexHeld
    and UnconfirmedKeepsRecord and ReadbackAfterAcknowledge and AppliedHasRecord and FreshBeforeReopen
    and OnlyCompletedReopened and ReviewedBeforeWrite and ShownOpenIsOpen and NoRecordIsFresh and OwnHasRecord

  val ReopenedWitness = s.outcome == "reopened" and not(s.completed) and s.stage == "idle"
  val TimePassedWitness = s.outcome == "passed" and s.starts == 0
  // An update native never carried out: only the owner's own retry reads it again.
  val UnconfirmedRecordWitness = s.stage == "idle" and s.journal != "none" and not(s.applied)
  val ReadBackOnlyWitness = s.stage == "receipt" and not(s.own)
  // The journaled reopen was computed at an earlier time: the same press is refused.
  val MovedScheduleWitness = s.outcome == "conflict" and not(s.journalFresh) and s.stage == "idle"
  val OtherModeWitness = s.outcome == "conflict" and s.journalFresh and s.journal != "none"
  val LeftAfterRetainWitness = s.outcome == "left" and s.retains > 0 and s.operates == 0
  val ChangedWitness = s.outcome == "changed"
  val AppliedAwaitingRefreshWitness = s.stage == "idle" and s.applied
  // Native reopened the reminder, the record is gone, and the detail still shows it completed.
  val UnreadWitness = s.outcome == "unread" and s.completed and not(s.nativeCompleted) and s.journal == "none"
  val CompletedAgainWitness = s.outcome == "unread" and s.nativeCompleted

  run reopenedTest = init.then(start("open", true, false)).then(lookup).then(selectedRead).then(afterRetain)
    .then(operated("succeeded")).expect(s.stage == "readback" and s.journal == "none" and s.saving)
    .then(readback("match"))
    .expect(ReopenedWitness and s.operates == 1 and not(s.saving) and s.revisionCurrent and safety)
    .then(start("tomorrow", true, false).fail())
  run declinedReviewTest = init.then(start("tomorrow", false, false))
    .expect(s.outcome == "declined" and not(s.saving) and s.starts == 0 and safety)
  run timePassedDuringReviewTest = init.then(start("open", true, true))
    .expect(TimePassedWitness and not(s.saving) and s.retains == 0 and safety)
  // The answer was lost and native did nothing: the same press again only reads the receipt.
  run retryReadsBackTest = init.then(start("tomorrow", true, false)).then(lookup).then(selectedRead)
    .then(afterRetain).then(operated("lost-never")).then(receipt(true))
    .expect(UnconfirmedRecordWitness and s.outcome == "unconfirmed" and safety)
    .then(start("tomorrow", true, false)).then(lookup).expect(ReadBackOnlyWitness).then(receipt(true))
    .expect(s.operates == 1 and s.journal == "tomorrow" and s.outcome == "unconfirmed" and safety)
  run otherModeWaitsTest = init.then(start("tomorrow", true, false)).then(lookup).then(selectedRead)
    .then(afterRetain).then(operated("lost-never")).then(receipt(false)).then(start("open", true, false))
    .then(lookup).expect(OtherModeWitness and s.operates == 1 and not(s.saving) and safety)
  // The same press at a later time computes another schedule and is refused, not sent again.
  run movedScheduleWaitsTest = init.then(start("open", true, false)).then(lookup).then(selectedRead)
    .then(afterRetain).then(operated("lost-never")).then(receipt(false)).then(tick)
    .then(start("open", true, false)).then(lookup)
    .expect(MovedScheduleWitness and s.operates == 1 and s.journal == "open" and safety)
  run lostAnswerFoundByReceiptTest = init.then(start("open", true, false)).then(lookup).then(selectedRead)
    .then(afterRetain).then(operated("lost-applied")).then(receipt(true))
    .expect(s.stage == "readback" and s.journal == "none").then(readback("match"))
    .expect(ReopenedWitness and s.operates == 1 and safety)
  run lostAnswerFoundByRefreshTest = init.then(start("open", true, false)).then(lookup).then(selectedRead)
    .then(afterRetain).then(operated("lost-applied")).then(receipt(false))
    .expect(AppliedAwaitingRefreshWitness and s.outcome == "unconfirmed" and s.completed and safety)
    .then(refresh(true))
    .expect(s.journal == "none" and s.outcome == "acknowledged" and not(s.completed) and s.operates == 1 and safety)
  // The read back failed: the record is gone and the next press finds the reminder changed.
  run failedReadbackTest = init.then(start("open", true, false)).then(lookup).then(selectedRead)
    .then(afterRetain).then(operated("succeeded")).then(readback("failed"))
    .expect(UnreadWitness and not(s.revisionCurrent) and safety)
    .then(start("open", true, false)).then(lookup).then(selectedRead)
    .expect(ChangedWitness and not(s.completed) and s.operates == 1 and s.retains == 1 and safety)
  run completedAgainBeforeReadbackTest = init.then(start("tomorrow", true, false)).then(lookup)
    .then(selectedRead).then(afterRetain).then(operated("succeeded")).then(readback("changed"))
    .expect(CompletedAgainWitness and s.completed and s.journal == "none" and safety)
  run leftBeforeSendTest = init.then(start("open", true, false)).then(lookup).then(selectedRead).then(leave)
    .then(afterRetain).expect(LeftAfterRetainWitness and s.journal == "none" and safety)
  run changedReminderNotJournaledTest = init.then(changedElsewhere).then(start("open", true, false))
    .then(lookup).then(selectedRead).expect(ChangedWitness and s.retains == 0 and s.journal == "none" and safety)
  run staleBlocksReopenTest = init.then(refresh(false)).then(start("open", true, false).fail())
  run reopenedThenCompletedAgainTest = init.then(start("open", true, false)).then(lookup).then(selectedRead)
    .then(afterRetain).then(operated("succeeded")).then(readback("match")).then(completeAgain)
    .then(start("tomorrow", true, false)).then(lookup).then(selectedRead).then(afterRetain)
    .then(operated("succeeded")).then(readback("match"))
    .expect(ReopenedWitness and s.operates == 2 and s.retains == 2 and safety)
}
