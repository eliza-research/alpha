// Done, Snooze and Delete on one dated reminder's detail. Each decision is bound to the revision
// the detail showed. A record is journaled before native is asked, a journaled decision is only
// ever read back, and a different decision on the same revision waits until the first is settled.
module ReminderDecision {
  type State = {
    // stale: the reminders shown may be out of date. selected: this reminder's detail is open.
    stale: bool, selected: bool,
    // saving: the reminder write mutex. stage: "idle" | "lookup" (journal read) | "select"
    // (native revision read) | "retained" (record written) | "operate" | "receipt".
    saving: bool, stage: str, decision: str,
    // journal: the decision journaled for the shown revision ("none" when there is none).
    // own: the running handler wrote that record. applied: native carried the journaled decision out.
    journal: str, own: bool, applied: bool,
    // revisionCurrent: native still holds the revision the detail shows.
    revisionCurrent: bool,
    starts: int, retains: int, operates: int,
    // outcome of the last finished decision.
    outcome: str,
    operateWithoutRecord: bool, startedStale: bool
  }
  var s: State
  pure val Decisions = Set("done", "snooze", "cancel")
  action init = s' = { stale: false, selected: true, saving: false, stage: "idle", decision: "none",
    journal: "none", own: false, applied: false, revisionCurrent: true,
    starts: 0, retains: 0, operates: 0, outcome: "none", operateWithoutRecord: false, startedStale: false }
  pure def released(state: State, outcome: str): State =
    { ...state, saving: false, stage: "idle", decision: "none", own: false, outcome: outcome }
  // A confirmed decision removes its record and reads the reminders again, which shows the new revision.
  pure def confirmed(state: State): State =
    { ...released(state, "done"), journal: "none", applied: false, revisionCurrent: true, stale: false }

  // Nothing starts while the shown reminders may be out of date, or while another write runs.
  action start(decision: str): bool = all {
    Decisions.contains(decision), not(s.saving), not(s.stale), s.selected, s.starts < 6,
    s' = { ...s, saving: true, stage: "lookup", decision: decision, starts: s.starts + 1,
      startedStale: s.startedStale or s.stale }
  }
  // A journaled decision of the same kind is read back and never sent again. A different decision
  // on the same revision is refused. A delete with nothing journaled goes to the deletion review.
  action lookup = all {
    s.stage == "lookup",
    s' = if (s.journal != "none" and s.journal != s.decision) released(s, "conflict")
      else if (s.journal != "none") { ...s, stage: "receipt" }
      else if (s.decision == "cancel") released(s, "review")
      else { ...s, stage: "select" }
  }
  // Native is asked for the current revision. A changed reminder is shown again and nothing is
  // journaled; so is a detail the owner already left.
  action selectedRead = all {
    s.stage == "select",
    s' = if (not(s.revisionCurrent)) { ...released(s, "changed"), revisionCurrent: true, stale: false }
      else if (not(s.selected)) released(s, "left")
      else { ...s, stage: "retained", journal: s.decision, own: true, retains: s.retains + 1 }
  }
  // The record is written. If the owner left meanwhile, the unsent record is removed again.
  action afterRetain = all {
    s.stage == "retained",
    s' = if (not(s.selected)) { ...released(s, "left"), journal: "none" }
      else { ...s, stage: "operate", operates: s.operates + 1,
        operateWithoutRecord: s.operateWithoutRecord or s.journal == "none" }
  }
  // result: "succeeded", "lost-applied" (no answer, native did it) or "lost-never" (no answer,
  // native did nothing). A lost answer is followed by one receipt read.
  action operated(result: str): bool = all {
    s.stage == "operate", result.in(Set("succeeded", "lost-applied", "lost-never")),
    s' = if (result == "succeeded") confirmed(s)
      else { ...s, stage: "receipt", applied: result == "lost-applied",
        revisionCurrent: if (result == "lost-applied") false else s.revisionCurrent }
  }
  // Only a receipt that says the decision was carried out removes the record.
  action receipt(ok: bool): bool = all {
    s.stage == "receipt",
    s' = if (ok and s.applied) confirmed(s) else released(s, "unconfirmed")
  }
  action leave = all { s.selected, s' = { ...s, selected: false } }
  action reopen = all { not(s.selected), not(s.saving), s' = { ...s, selected: true } }
  // The reminder changed somewhere else: a notification action or another screen.
  action changedElsewhere = all {
    s.revisionCurrent, s.journal == "none", not(s.saving), s' = { ...s, revisionCurrent: false }
  }
  // A refresh acknowledges a journaled decision that native carried out, then reads the
  // reminders. It never sends a decision. When the read fails the old revision stays shown.
  action refresh(ok: bool): bool = all {
    not(s.saving),
    val settled = if (s.applied) { ...s, journal: "none", applied: false, outcome: "done" } else s
    s' = if (ok) { ...settled, stale: false, revisionCurrent: true } else { ...settled, stale: true }
  }
  action step = {
    nondet decision = Decisions.oneOf()
    nondet result = Set("succeeded", "lost-applied", "lost-never").oneOf()
    nondet ok = Bool.oneOf()
    any {
      start(decision), lookup, selectedRead, afterRetain, operated(result), receipt(ok), leave, reopen,
      changedElsewhere, refresh(ok), s' = s
    }
  }

  // Native is asked at most once per journaled record, and never without one.
  val RecordBeforeOperate = not(s.operateWithoutRecord)
  val OneOperatePerRecord = s.operates <= s.retains and s.retains <= s.starts
  // Only the handler that wrote the record sends it.
  val OnlyOwnRecordSent = s.stage == "operate" implies (s.own and s.journal == s.decision)
  val MutexHeld = (s.saving iff s.stage != "idle") and (s.saving iff s.decision != "none")
  // An unconfirmed decision keeps its record; a confirmed or abandoned one leaves none of its own.
  val UnconfirmedKeepsRecord = (s.stage == "idle" and s.outcome == "unconfirmed") implies s.journal != "none"
  val AppliedHasRecord = s.applied implies s.journal != "none"
  val FreshBeforeDecision = not(s.startedStale)
  val DeleteNeverJournaled = s.journal != "cancel"
  val TypeOK = s.stage.in(Set("idle", "lookup", "select", "retained", "operate", "receipt"))
    and s.decision.in(Decisions.union(Set("none"))) and s.journal.in(Set("none", "done", "snooze", "cancel"))
    and s.starts.in(0.to(6))
    and s.outcome.in(Set("none", "done", "conflict", "review", "changed", "left", "unconfirmed"))
  val safety = TypeOK and RecordBeforeOperate and OneOperatePerRecord and OnlyOwnRecordSent and MutexHeld
    and UnconfirmedKeepsRecord and AppliedHasRecord and FreshBeforeDecision and DeleteNeverJournaled

  // A decision native never carried out: nothing but the owner's own retry reads it again.
  val UnconfirmedRecordWitness = s.stage == "idle" and s.journal != "none" and not(s.applied)
  val ReadBackOnlyWitness = s.stage == "receipt" and not(s.own)
  val ConflictWitness = s.outcome == "conflict" and s.journal != "none"
  val LeftAfterRetainWitness = s.outcome == "left" and s.retains > 0 and s.operates == 0
  val ChangedWitness = s.outcome == "changed"
  val AppliedAwaitingRefreshWitness = s.stage == "idle" and s.applied

  run confirmedDecisionTest = init.then(start("done")).then(lookup).then(selectedRead).then(afterRetain)
    .then(operated("succeeded"))
    .expect(s.outcome == "done" and s.journal == "none" and s.operates == 1 and not(s.saving) and safety)
  // The answer was lost and native did nothing: the same decision again only reads the receipt.
  run retryReadsBackTest = init.then(start("snooze")).then(lookup).then(selectedRead).then(afterRetain)
    .then(operated("lost-never")).then(receipt(true))
    .expect(UnconfirmedRecordWitness and s.outcome == "unconfirmed" and safety)
    .then(start("snooze")).then(lookup).expect(ReadBackOnlyWitness).then(receipt(true))
    .expect(s.operates == 1 and s.journal == "snooze" and s.outcome == "unconfirmed" and safety)
  run otherDecisionWaitsTest = init.then(start("snooze")).then(lookup).then(selectedRead).then(afterRetain)
    .then(operated("lost-never")).then(receipt(false)).then(start("done")).then(lookup)
    .expect(ConflictWitness and s.operates == 1 and not(s.saving) and safety)
    .then(start("cancel")).then(lookup).expect(s.outcome == "conflict" and safety)
  run lostAnswerFoundByRefreshTest = init.then(start("done")).then(lookup).then(selectedRead)
    .then(afterRetain).then(operated("lost-applied")).then(receipt(false))
    .expect(AppliedAwaitingRefreshWitness and s.outcome == "unconfirmed" and safety)
    .then(refresh(true))
    .expect(s.journal == "none" and s.outcome == "done" and s.revisionCurrent and s.operates == 1 and safety)
  run leftBeforeSendTest = init.then(start("done")).then(lookup).then(selectedRead).then(leave)
    .then(afterRetain).expect(LeftAfterRetainWitness and s.journal == "none" and safety)
  run changedReminderNotJournaledTest = init.then(changedElsewhere).then(start("done")).then(lookup)
    .then(selectedRead).expect(ChangedWitness and s.retains == 0 and s.journal == "none" and safety)
  run staleBlocksDecisionTest = init.then(refresh(false)).then(start("done").fail())
  run deleteGoesToReviewTest = init.then(start("cancel")).then(lookup)
    .expect(s.outcome == "review" and s.journal == "none" and s.retains == 0 and safety)
}
