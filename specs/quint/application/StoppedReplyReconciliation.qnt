/// The single later read after a reply was stopped (`scheduleStoppedReply`): the cancel attempt,
/// the check timer, one conversation read, and the notice that follows them. Nothing is sent, and
/// a new request, an explicit reload or an agent change retires the check together with its notice.
/// A new request that is refused before it reaches the agent says the retired check never ran.
module StoppedReplyReconciliation {
  type State = { check: str, cancelAttempt: str, cancelled: bool, notice: str, message: str,
    sending: bool, retiredPending: bool, operation: bool, reads: int, schedules: int, historyRevision: int, replacedWhileBusy: bool }
  var s: State
  // The single check did not settle the stopped reply: the notice says where to look later.
  pure val LoadLater = "unchecked"
  // scheduleStoppedReply(): replaces any earlier check; an earlier turn's confirmed stop is not
  // this turn's outcome.
  pure def scheduled(st: State, withCancel: bool): State = { ...st, check: "scheduled",
    cancelAttempt: if (withCancel) "pending" else "none", cancelled: false, notice: "pending",
    message: if (st.message == "confirmed-stopped") "none" else st.message, reads: 0,
    schedules: st.schedules + 1 }
  pure def retired(st: State): State = { ...st, check: "none", cancelAttempt: "none", notice: "none" }

  action init = s' = { check: "none", cancelAttempt: "none", cancelled: false, notice: "none", message: "none",
    sending: false, retiredPending: false, operation: false, reads: 0, schedules: 0, historyRevision: 0, replacedWhileBusy: false }
  // The end of a request: one that never reached the agent and had retired a pending check leaves
  // the "look later" notice in place of the check it cancelled.
  pure def settled(st: State, dispatched: bool): State = { ...st, sending: false, retiredPending: false,
    notice: if (not(dispatched) and st.retiredPending) LoadLater else st.notice }
  action sendStart = all { not(s.sending), not(s.operation),
    s' = { ...retired(s), sending: true, retiredPending: s.notice.in(Set("pending", "cancelled-pending")) } }
  // The connection operation refuses the new send before it can retire the old check.
  action busySendRefused = all { s.operation, s' = s }
  action sendSettled(dispatched: bool): bool = all { s.sending, s' = settled(s, dispatched) }
  // Stop after the message was dispatched. Resident agents are also asked to abort the turn.
  action sendStopped(dispatched: bool, withCancel: bool): bool = all { s.sending, s.schedules < 3,
    s' = if (dispatched) scheduled(settled(s, true), withCancel) else settled(s, false) }
  // A restored conversation that ends in a recent unanswered turn gets the same read, no cancel.
  action restoredAfterConnect = all { not(s.sending), s.check == "none", s.schedules < 3, s' = scheduled(s, false) }
  action cancelOutcome(aborted: bool): bool = all { s.check == "scheduled", s.cancelAttempt == "pending",
    s' = if (aborted) { ...s, cancelAttempt: "settled", cancelled: true, notice: "cancelled-pending" }
      else { ...s, cancelAttempt: "settled" } }
  // The read waits for the cancel attempt and is skipped while another request or operation runs.
  action timerFires = all { s.check == "scheduled", s.cancelAttempt != "pending",
    s' = if (s.sending or s.operation) { ...s, check: "none", notice: LoadLater }
      else { ...s, check: "reading", reads: s.reads + 1 } }
  action readSettles(kind: str): bool = all { s.check == "reading",
    s' = if (kind == "error") { ...s, check: "none", notice: LoadLater }
      else if (s.sending or s.operation) { ...s, check: "none", notice: LoadLater }
      else if (kind == "unrecorded") { ...s, check: "none", notice: "not-recorded" }
      else if (kind == "unfinished")
        if (s.cancelled) { ...s, check: "none", notice: "none", message: "confirmed-stopped" }
        else { ...s, check: "none", notice: LoadLater }
      else { ...s, check: "none", notice: "none", message: "finished", historyRevision: s.historyRevision + 1,
        replacedWhileBusy: s.sending or s.operation } }
  action operationStart = all { not(s.operation), s' = { ...s, operation: true } }
  action operationEnd = all { s.operation, s' = { ...s, operation: false } }
  // An explicit history load or a new conversation already shows the outcome.
  action explicitReload = all { not(s.sending), s' = retired(s) }
  action agentChanged = s' = { ...retired(s), sending: false, retiredPending: false, operation: false, message: "none" }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet kind = Set("error", "unrecorded", "unfinished", "finished").oneOf()
    any { sendStart, busySendRefused, sendSettled(flag), sendStopped(flag, other), restoredAfterConnect, cancelOutcome(flag), timerFires,
      readSettles(kind), operationStart, operationEnd, explicitReload, agentChanged, s' = s }
  }

  val PendingNoticeHasCheck = s.notice.in(Set("pending", "cancelled-pending")) implies s.check != "none"
  val SingleRead = s.reads <= 1 and (s.check == "reading" implies s.reads == 1)
  val CheckYieldsToNewRequest = s.check != "none" implies not(s.sending)
  val CancelledNoticeNeedsAbort = s.notice == "cancelled-pending" implies s.cancelled
  val ConfirmedStopNeedsAbort = s.message == "confirmed-stopped" implies (s.cancelled and s.check == "none")
  val ChatNotReplacedWhileBusy = not(s.replacedWhileBusy) and s.historyRevision <= s.schedules
  val CancelAttemptBelongsToCheck = s.cancelAttempt != "none" implies s.check != "none" or s.cancelAttempt == "settled"
  val RetiredCheckBelongsToRequest = s.retiredPending implies (s.sending and s.check == "none" and s.notice == "none")
  val safety = RetiredCheckBelongsToRequest and PendingNoticeHasCheck and SingleRead and CheckYieldsToNewRequest and CancelledNoticeNeedsAbort and
    ConfirmedStopNeedsAbort and ChatNotReplacedWhileBusy and CancelAttemptBelongsToCheck

  val CancelledReadWitness = s.check == "reading" and s.cancelled
  val LoadLaterWitness = s.notice == LoadLater
  val FinishedWitness = s.message == "finished" and s.historyRevision == 1

  run stoppedSetup = init.then(sendStart).then(sendStopped(true, true))
  run finishedAfterStopTest = stoppedSetup.expect(s.notice == "pending" and s.check == "scheduled")
    .then(cancelOutcome(false)).then(timerFires).then(readSettles("finished"))
    .expect(s.historyRevision == 1 and s.notice == "none" and s.message == "finished" and s.reads == 1 and safety)
  run confirmedStopTest = stoppedSetup.then(cancelOutcome(true)).expect(s.notice == "cancelled-pending")
    .then(timerFires).then(readSettles("unfinished"))
    .expect(s.message == "confirmed-stopped" and s.notice == "none" and s.historyRevision == 0 and safety)
  // A new message retires the pending check: no later read replaces the chat, and the late
  // cancel result changes nothing.
  run newSendRetiresCheckTest = stoppedSetup.then(sendStart)
    .expect(s.check == "none" and s.notice == "none" and s.sending and safety)
    .then(sendSettled(true)).expect(s.reads == 0 and s.historyRevision == 0 and s.cancelAttempt == "none" and s.notice == "none" and safety)
  run newSendRetiresReadTest = stoppedSetup.then(cancelOutcome(true)).then(timerFires).then(sendStart)
    .expect(s.sending and s.reads == 1 and s.check == "none" and s.notice == "none" and safety)
    .then(sendSettled(true)).expect(s.historyRevision == 0 and s.notice == "none" and safety)
  // The new message never reached the agent, so nothing replaces the check it retired: the notice
  // says the stopped reply was not checked.
  run refusedSendAfterStopSaysUncheckedTest = stoppedSetup.then(cancelOutcome(true)).then(sendStart)
    .expect(s.notice == "none" and s.retiredPending).then(sendSettled(false))
    .expect(s.notice == LoadLater and s.check == "none" and s.reads == 0 and safety)
  run busyAtTimerSkipsReadTest = stoppedSetup.then(cancelOutcome(false)).then(operationStart).then(busySendRefused)
    .expect(s.check == "scheduled" and s.notice == "pending" and safety).then(timerFires)
    .expect(s.notice == LoadLater and s.reads == 0 and s.check == "none" and safety)
  run operationDuringReadKeepsChatTest = stoppedSetup.then(cancelOutcome(true)).then(timerFires).then(operationStart)
    .then(readSettles("finished")).expect(s.notice == LoadLater and s.historyRevision == 0 and safety)
  run laterStopClearsEarlierConfirmationTest = stoppedSetup.then(cancelOutcome(true)).then(timerFires)
    .then(readSettles("unfinished")).then(restoredAfterConnect)
    .expect(s.message == "none" and s.notice == "pending" and not(s.cancelled) and safety)
    .then(timerFires).then(readSettles("unfinished")).expect(s.notice == LoadLater and s.message == "none" and safety)
  run historyReadFailureTest = stoppedSetup.then(cancelOutcome(true)).then(timerFires).then(readSettles("error"))
    .expect(s.notice == LoadLater and s.message == "none" and s.reads == 1 and safety)
  run unrecordedTurnTest = stoppedSetup.then(cancelOutcome(true)).then(timerFires).then(readSettles("unrecorded"))
    .expect(s.notice == "not-recorded" and s.message == "none" and s.reads == 1 and safety)
}
