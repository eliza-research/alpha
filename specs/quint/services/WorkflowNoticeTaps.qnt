/// A tapped workflow notification is read, checked against the agent and then either opened
/// as a run or reviewed as a question. The check competes with workflow operations and view
/// resets, and the native ledger keeps the tap until it is consumed.
module WorkflowNoticeTaps {
  type Taps = {
    ledger: str, question: bool, tapBusy: bool, tapRequested: bool, tapDeferred: bool,
    recheck: bool, operation: bool, generation: int, epoch: int, staleDrop: bool,
    noticeQuestion: bool, openedTap: bool, runOpen: bool, opens: int, asked: bool, composed: bool
  }
  var s: Taps
  action init = s' = {
    ledger: "new", question: false, tapBusy: false, tapRequested: false, tapDeferred: false,
    recheck: false, operation: false, generation: 0, epoch: 0, staleDrop: false,
    noticeQuestion: false, openedTap: false, runOpen: false, opens: 0, asked: false, composed: false }
  /// The owner taps the notification, or its Ask action. The tap is announced to the app.
  action userTap(question: bool): bool = all {
    s.ledger == "new",
    s' = { ...s, ledger: "pending", question: question, recheck: true }
  }
  /// A resume, a connection change or a repeated tap event asks for another check.
  action wakeEvent = all { s.ledger == "pending", s' = { ...s, recheck: true } }
  /// A check starts reading the tap, or leaves a mark for whoever is in its way.
  action checkNotice = all {
    s.recheck,
    if (s.noticeQuestion) s' = { ...s, recheck: false }
    else if (s.tapBusy) s' = { ...s, recheck: false, tapRequested: true }
    else if (s.operation) s' = { ...s, recheck: false, tapDeferred: true }
    else s' = { ...s, recheck: false, tapBusy: true, epoch: s.generation, staleDrop: false }
  }
  /// Any workflow operation, including the Home refresh, moves the view generation on.
  action startOperation = all {
    not(s.operation), s.generation < 4,
    s' = { ...s, operation: true, generation: s.generation + 1 }
  }
  action endOperation = all {
    s.operation,
    s' = { ...s, operation: false, tapDeferred: false, recheck: s.recheck or s.tapDeferred }
  }
  /// Leaving the view or changing account drops the operation without its completion step.
  /// An open question review is interrupted; its tap stays pending.
  action clearView = all {
    s.generation < 4,
    s' = { ...s, generation: s.generation + 1, operation: false, noticeQuestion: false }
  }
  /// The read finishes. `consumed` says whether the native consume succeeded.
  action resolveDone(consumed: bool): bool = all {
    s.tapBusy,
    val settled = { ...s, tapBusy: false, tapRequested: false, recheck: s.recheck or s.tapRequested }
    if (s.ledger != "pending") s' = settled
    else if (s.generation != s.epoch)
      s' = { ...settled, staleDrop: true, tapDeferred: s.tapDeferred or s.operation,
        recheck: settled.recheck or not(s.operation) }
    else if (s.question) s' = { ...settled, noticeQuestion: true }
    else if (s.openedTap)
      s' = { ...settled, ledger: if (consumed) "consumed" else "pending", openedTap: not(consumed) }
    else s' = { ...settled, runOpen: true, opens: s.opens + 1,
      ledger: if (consumed) "consumed" else "pending", openedTap: not(consumed) }
  }
  /// An explicit Cancel returns the tap to the untapped notice.
  action questionCancel = all {
    s.noticeQuestion,
    s' = { ...s, noticeQuestion: false, ledger: "new", question: false }
  }
  /// Continuing consumes the tap first. The draft is filled only while the view is still current.
  action questionCompose(current: bool): bool = all {
    s.noticeQuestion,
    s' = { ...s, noticeQuestion: false, ledger: "consumed", question: false, asked: true, composed: current }
  }
  action step = any {
    userTap(true), userTap(false), wakeEvent, checkNotice, startOperation, endOperation,
    clearView, resolveDone(true), resolveDone(false), questionCancel, questionCompose(true),
    questionCompose(false), s' = s
  }
  /// A failed consume does not reopen the run at every later check.
  val OpenedOncePerTap = s.opens <= 1
  val ConsumedWasHandled = s.ledger == "consumed" implies s.opens == 1 or s.asked
  val RememberedTapIsPending = s.openedTap implies s.ledger == "pending" and s.runOpen and not(s.question)
  val QuestionReviewHasTap = s.noticeQuestion implies s.ledger == "pending" and s.question
  val ComposeNeedsConsume = s.composed implies s.asked and s.ledger == "consumed"
  /// A tap read under a view generation that has moved on is checked again.
  val StaleCheckRepeats = s.staleDrop and s.ledger == "pending" implies
    s.recheck or s.tapDeferred or s.tapRequested or s.tapBusy
  val TypeOK = s.ledger.in(Set("new", "pending", "consumed")) and s.generation.in(0.to(4)) and s.opens.in(0.to(1))
  val safety = TypeOK and OpenedOncePerTap and ConsumedWasHandled and RememberedTapIsPending
    and QuestionReviewHasTap and ComposeNeedsConsume and StaleCheckRepeats
  val StaleReadWitness = s.tapBusy and s.generation != s.epoch and s.ledger == "pending"
  val OpenedUnconsumedWitness = s.openedTap and s.runOpen and not(s.tapBusy)
  val DeferredWithoutOperationWitness = s.tapDeferred and not(s.operation) and not(s.recheck) and s.ledger == "pending"
  val ReleasedQuestionWitness = s.ledger == "new" and s.epoch > 0 and not(s.tapBusy)
  /// A Home refresh starts while the tap is being read. The tap is checked again when that
  /// refresh ends, and the run opens.
  run refreshDuringTapReadTest = init.then(userTap(false)).then(checkNotice).then(startOperation)
    .then(resolveDone(true))
    .expect(s.ledger == "pending" and s.tapDeferred and s.opens == 0 and safety)
    .then(endOperation).expect(s.recheck and safety)
    .then(checkNotice).then(resolveDone(true)).expect(s.ledger == "consumed" and s.opens == 1 and safety)
  run tapDuringOperationDeferredTest = init.then(startOperation).then(userTap(false)).then(checkNotice)
    .expect(s.tapDeferred and not(s.tapBusy) and safety)
    .then(endOperation).then(checkNotice).then(resolveDone(true)).expect(s.opens == 1 and safety)
  /// The consume fails after the run was opened. Later checks only repeat the consume.
  run failedConsumeDoesNotReopenTest = init.then(userTap(false)).then(checkNotice).then(resolveDone(false))
    .expect(s.runOpen and s.openedTap and s.ledger == "pending" and s.opens == 1)
    .then(wakeEvent).then(checkNotice).then(resolveDone(false)).expect(s.opens == 1 and safety)
    .then(wakeEvent).then(checkNotice).then(resolveDone(true))
    .expect(s.opens == 1 and s.ledger == "consumed" and not(s.openedTap) and safety)
  run canceledQuestionStaysUsableTest = init.then(userTap(true)).then(checkNotice).then(resolveDone(true))
    .expect(s.noticeQuestion and s.opens == 0).then(questionCancel)
    .expect(s.ledger == "new" and safety)
    .then(userTap(false)).then(checkNotice).then(resolveDone(true)).expect(s.opens == 1 and safety)
  run interruptedQuestionKeepsTapTest = init.then(userTap(true)).then(checkNotice).then(resolveDone(true))
    .then(clearView).expect(s.ledger == "pending" and not(s.noticeQuestion) and safety)
    .then(wakeEvent).then(checkNotice).then(resolveDone(true)).then(questionCompose(true))
    .expect(s.composed and s.ledger == "consumed" and s.opens == 0 and safety)
  run secondEventWhileReadingTest = init.then(userTap(false)).then(checkNotice).then(wakeEvent)
    .then(checkNotice).expect(s.tapRequested and safety)
    .then(resolveDone(true)).expect(s.recheck and s.ledger == "consumed" and safety)
    .then(checkNotice).then(resolveDone(true)).expect(s.opens == 1 and safety)
}
