// The browser calendar's local port for linked calendar sync: one stored event read, updated
// from the provider or staged for deletion on behalf of the sync controller. Every call is
// fenced by the controller's binding and the calendar source it was created for, an update
// names the revision the controller last read, and a pending deletion holds the event.
module CalendarLinkedLocalPort {
  type State = {
    // bound: the controller's owner and Google binding are still the enabled ones.
    // sourceSame: the stored calendar is still the source this port was created for.
    bound: bool, sourceSame: bool,
    // The event in the stored calendar: present, its revision, and an unresolved deletion.
    exists: bool, revision: int, pending: bool,
    // known: the revision the controller last read (-1 before any read).
    known: int,
    // The call in progress. phase: "admitted" after the first check, "written" once the
    // document step ended and only the closing check remains. wrote: the revision an update
    // stored (-1 otherwise); the owner may edit the event again before the closing check.
    op: str, phase: str, expected: int, ownerCurrent: bool, result: str, wrote: int,
    outcome: str,
    // Notices sent to the page, completed calls and stored writes made by the port.
    documentNotices: int, deletionNotices: int, finished: int, writes: int,
    // What a stored write found: a revision other than the one named, an ended binding or a
    // replaced source, an unresolved deletion. lateAbort: a write whose call then gave no result.
    staleWrite: bool, unboundWrite: bool, heldWrite: bool, lateAbort: bool
  }
  var s: State
  pure val Ops = Set("get", "apply", "delete")
  pure val Outcomes = Set("none", "snapshot", "missing", "applied", "staged", "absent", "aborted", "pending",
    "changed", "invalid")
  action init = s' = { bound: true, sourceSame: true, exists: true, revision: 0, pending: false, known: -1,
    op: "none", phase: "idle", expected: -1, ownerCurrent: true, result: "none", wrote: -1, outcome: "none",
    documentNotices: 0, deletionNotices: 0, finished: 0, writes: 0,
    staleWrite: false, unboundWrite: false, heldWrite: false, lateAbort: false }
  pure def ended(st: State, outcome: str): State =
    { ...st, op: "none", phase: "idle", expected: -1, result: "none", wrote: -1, outcome: outcome }
  // A stored write, with what it found recorded.
  pure def wrote(st: State, result: str): State = {
    ...st, phase: "written", result: result, writes: st.writes + 1,
    staleWrite: st.staleWrite or st.revision != st.expected or not(st.exists),
    unboundWrite: st.unboundWrite or not(st.bound) or not(st.sourceSame),
    heldWrite: st.heldWrite or st.pending
  }
  // The call starts: an unbound controller is refused before anything is read, and a provider
  // event that cannot be stored without losing fields before anything is written. An update or
  // deletion names the revision the controller holds.
  action begin(kind: str, valid: bool): bool = all {
    s.op == "none", Ops.contains(kind), kind == "get" or s.known >= 0,
    s' = if (not(s.bound)) ended(s, "aborted")
      else if (kind == "apply" and not(valid)) ended(s, "invalid")
      else { ...s, op: kind, phase: "admitted", expected: if (kind == "get") -1 else s.known, ownerCurrent: true }
  }
  // The person the deletion would be attributed to changed while it waited for the calendar.
  action ownerChanged = all {
    s.op == "delete", s.phase == "admitted", s.ownerCurrent, s' = { ...s, ownerCurrent: false }
  }
  // The stored calendar is read and, for an update or deletion, changed in the same transaction.
  action transact = all {
    s.phase == "admitted",
    s' = if (not(s.bound) or not(s.sourceSame)) ended(s, "aborted")
      else if (s.exists and s.pending) ended(s, "pending")
      else if (s.op == "get")
        { ...ended(s, if (s.exists) "snapshot" else "missing"), known: if (s.exists) s.revision else -1,
          finished: s.finished + 1 }
      else if (s.op == "apply")
        if (not(s.exists) or s.revision != s.expected) ended(s, "changed")
        else { ...wrote(s, "applied"), revision: s.revision + 1, wrote: s.revision + 1 }
      else if (not(s.exists)) { ...s, phase: "written", result: "absent" }
      else if (s.revision != s.expected or not(s.ownerCurrent)) ended(s, "changed")
      else { ...wrote(s, "staged"), pending: true }
  }
  // The closing check: a controller unbound meanwhile gets no result and the page no notice,
  // though a write already made stays.
  action finish = all {
    s.phase == "written",
    s' = if (not(s.bound)) { ...ended(s, "aborted"), lateAbort: s.lateAbort or s.result != "absent" }
      else { ...ended(s, s.result), finished: s.finished + 1,
        known: if (s.result == "applied") s.wrote else s.known,
        documentNotices: s.documentNotices + 1,
        deletionNotices: if (s.op == "delete") s.deletionNotices + 1 else s.deletionNotices }
  }
  // The owner's own changes to the stored calendar, and the controller's binding ending.
  action localEdit = all {
    s.exists, not(s.pending), s.revision < 4, s' = { ...s, revision: s.revision + 1 }
  }
  action ownerStagesDeletion = all { s.exists, not(s.pending), s' = { ...s, pending: true } }
  action undoDeletion = all { s.pending, s' = { ...s, pending: false } }
  action finalizeDeletion = all { s.pending, s' = { ...s, pending: false, exists: false } }
  action sourceReplaced = all { s.sourceSame, s' = { ...s, sourceSame: false } }
  action unbind = all { s.bound, s' = { ...s, bound: false } }
  action step = {
    nondet kind = Ops.oneOf()
    nondet valid = Bool.oneOf()
    // The port's own steps are taken more often than the owner's, and the changes that cannot be
    // taken back (a finished deletion, a replaced source, an ended binding) least often, so
    // sampled walks complete calls.
    nondet lot = 0.to(9).oneOf()
    any {
      begin(kind, valid), transact, finish,
      all { lot <= 3, any { ownerChanged, localEdit, ownerStagesDeletion, undoDeletion } },
      all { lot == 0, any { finalizeDeletion, sourceReplaced, unbind } },
      s' = s
    }
  }

  // The port never overwrites an event the controller has not read at its current revision.
  val NoStaleWrite = not(s.staleWrite)
  // Nothing is written for an unbound controller or into a different calendar source.
  val WritesAreFenced = not(s.unboundWrite)
  // An event with an unresolved deletion is neither updated nor staged again.
  val PendingDeletionHolds = not(s.heldWrite)
  val OneCall = (s.op == "none") == (s.phase == "idle") and (s.phase == "written" implies s.op != "get")
    and (s.result != "none") == (s.phase == "written") and (s.wrote >= 0) == (s.result == "applied")
  // The page is told only about calls that completed for a bound controller.
  val NoticesFollowCompletion = s.documentNotices <= s.finished and s.deletionNotices <= s.documentNotices
  val WritesAreCounted = s.writes <= s.revision + s.deletionNotices + 1
  // The controller never holds a revision newer than the stored one.
  val KnownWasRead = s.known <= s.revision
  val TypeOK = s.op.in(Ops.union(Set("none"))) and s.phase.in(Set("idle", "admitted", "written"))
    and Outcomes.contains(s.outcome) and s.result.in(Set("none", "applied", "staged", "absent"))
    and s.revision.in(0.to(40)) and s.known >= -1 and s.expected >= -1 and s.wrote >= -1 and s.wrote <= s.revision
  val safety = TypeOK and NoStaleWrite and WritesAreFenced and PendingDeletionHolds and OneCall
    and NoticesFollowCompletion and WritesAreCounted and KnownWasRead

  val AppliedWitness = s.outcome == "applied" and s.known == s.revision and s.revision > 0
  val StagedWitness = s.outcome == "staged" and s.pending and s.exists
  val StaleRefusedWitness = s.outcome == "changed" and s.writes == 0 and s.revision > 0
  val PendingBlockedWitness = s.outcome == "pending" and s.pending
  val SourceReplacedWitness = s.outcome == "aborted" and s.bound and not(s.sourceSame)
  // The update was stored, then the binding ended before the closing check: no result, no notice.
  val WrittenThenAbortedWitness = s.lateAbort and s.outcome == "aborted" and s.documentNotices == 0
  val AbsentDeleteWitness = s.outcome == "absent" and not(s.exists)

  run readThenApplyTest = init.then(begin("get", true)).then(transact)
    .expect(s.outcome == "snapshot" and s.known == 0)
    .then(begin("apply", true)).then(transact).expect(s.phase == "written" and s.revision == 1)
    .then(finish).expect(AppliedWitness and s.documentNotices == 1 and s.deletionNotices == 0 and safety)
  // The owner edited the event after the controller read it: the update is refused, nothing written.
  run staleUpdateRefusedTest = init.then(begin("get", true)).then(transact).then(localEdit)
    .then(begin("apply", true)).then(transact)
    .expect(StaleRefusedWitness and s.revision == 1 and s.documentNotices == 0 and safety)
    .then(begin("get", true)).then(transact).then(begin("apply", true)).then(transact).then(finish)
    .expect(s.outcome == "applied" and s.revision == 2 and safety)
  run pendingDeletionBlocksTest = init.then(begin("get", true)).then(transact).then(ownerStagesDeletion)
    .then(begin("apply", true)).then(transact).expect(PendingBlockedWitness and s.writes == 0)
    .then(begin("get", true)).then(transact).expect(s.outcome == "pending")
    .then(undoDeletion).then(begin("apply", true)).then(transact).then(finish)
    .expect(s.outcome == "applied" and safety)
  // A deletion from sync is staged with the owner's Undo window; the event itself stays.
  run deleteIsStagedTest = init.then(begin("get", true)).then(transact).then(begin("delete", true)).then(transact)
    .then(finish).expect(StagedWitness and s.deletionNotices == 1 and s.documentNotices == 1 and s.revision == 0)
    .then(begin("delete", true)).then(transact).expect(s.outcome == "pending" and s.writes == 1 and safety)
  run deleteByAnotherOwnerRefusedTest = init.then(begin("get", true)).then(transact).then(begin("delete", true))
    .then(ownerChanged).then(transact).expect(s.outcome == "changed" and not(s.pending) and safety)
  run replacedSourceAbortsTest = init.then(begin("get", true)).then(transact).then(begin("apply", true))
    .then(sourceReplaced).then(transact).expect(SourceReplacedWitness and s.writes == 0 and safety)
  run unboundBeforeStartTest = init.then(begin("get", true)).then(transact).then(unbind)
    .then(begin("apply", true)).expect(s.outcome == "aborted" and s.op == "none" and s.writes == 0 and safety)
  run unboundAfterWriteTest = init.then(begin("get", true)).then(transact).then(begin("apply", true)).then(transact)
    .then(unbind).then(finish)
    .expect(WrittenThenAbortedWitness and s.revision == 1 and s.known == 0 and s.finished == 1 and safety)
  // The owner edits the event between the stored update and the closing check: the controller
  // is given the revision its update stored, so its next update is refused until it reads again.
  run editAfterWriteTest = init.then(begin("get", true)).then(transact).then(begin("apply", true)).then(transact)
    .then(localEdit).then(finish).expect(s.outcome == "applied" and s.known == 1 and s.revision == 2)
    .then(begin("apply", true)).then(transact).expect(s.outcome == "changed" and s.writes == 1 and safety)
  run lossyProviderEventRefusedTest = init.then(begin("get", true)).then(transact).then(begin("apply", false))
    .expect(s.outcome == "invalid" and s.op == "none" and s.writes == 0 and safety)
  run absentDeleteTest = init.then(begin("get", true)).then(transact).then(ownerStagesDeletion)
    .then(finalizeDeletion).then(begin("delete", true)).then(transact).then(finish)
    .expect(AbsentDeleteWitness and s.writes == 0 and s.deletionNotices == 1 and safety)
}
