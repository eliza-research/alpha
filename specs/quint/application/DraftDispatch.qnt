/// AssistantDraftController queues writes by conversation and retains held text until dispatch.
module DraftDispatch {
  type State = { active: int, ready: bool, failed: bool, draft: str, savedOne: str,
    savedTwo: str, holding: bool, heldBinding: int, queuedBinding: int,
    queuedText: str, markedOne: bool, markedTwo: bool, unsettled: bool, dispatched: bool, error: bool, automaticRestore: bool, paintPending: bool, transportCalled: bool }
  var s: State
  action init = s' = { active: 1, ready: true, failed: false, draft: "A", savedOne: "A",
    savedTwo: "", holding: false, heldBinding: 0, queuedBinding: 0, queuedText: "",
    markedOne: false, markedTwo: false, unsettled: false, dispatched: false, error: false, automaticRestore: false, paintPending: false, transportCalled: false }
  action storageFailed = s' = { ...s, failed: true, error: true }
  action hold = all { not(s.holding or s.unsettled), s.ready, not(s.failed), s.draft == "A", s.queuedBinding == 0,
    s' = { ...s, holding: true, heldBinding: s.active, markedOne: s.active == 1 or s.markedOne, markedTwo: s.active == 2 or s.markedTwo,
      dispatched: false, automaticRestore: false, transportCalled: false } }
  action clearComposer = all { s.holding, s' = { ...s, draft: "", automaticRestore: false } }
  action queueComposerPaint = all { s.holding, not(s.transportCalled), s' = { ...s, paintPending: true } }
  action commitComposerPaint = all { s.paintPending, s' = { ...s, paintPending: false, draft: "" } }
  action tryDispatch = s' = if (s.holding and not(s.paintPending)) { ...s, transportCalled: true } else s
  action typeNew = s' = { ...s, draft: "B", automaticRestore: false }
  action release = all { s.holding, not(s.paintPending),
    s' = if (s.active != s.heldBinding)
      { ...s, holding: false, queuedBinding: s.heldBinding, queuedText: "A" }
    else { ...s, holding: false, draft: if (s.draft == "B") "A+B" else "A",
      queuedBinding: if (s.ready and not(s.failed)) s.active else 0,
      queuedText: if (s.draft == "B") "A+B" else "A" } }
  action commit = all { s.holding,
    s' = { ...s, holding: false, dispatched: true,
      queuedBinding: if (s.heldBinding == 0 or s.failed) 0 else s.heldBinding,
      queuedText: if (s.active == s.heldBinding) s.draft else "" } }
  action flush = all { s.queuedBinding != 0, not(s.failed),
    s' = { ...s, savedOne: if (s.queuedBinding == 1) s.queuedText else s.savedOne,
      savedTwo: if (s.queuedBinding == 2) s.queuedText else s.savedTwo,
      markedOne: s.markedOne and s.queuedBinding != 1, markedTwo: s.markedTwo and s.queuedBinding != 2, queuedBinding: 0 } }
  action saveFailed = all { s.queuedBinding != 0,
    s' = { ...s, queuedBinding: 0, failed: true, error: true } }
  /// A failed release write offers the readable saved copy for conflict review.
  action saveConflict = all { s.queuedBinding != 0,
    s' = { ...s, queuedBinding: 0, failed: true, error: false } }
  action switchConversation = all { s.active != 2,
    s' = { ...s, active: 2, ready: true, failed: false, draft: s.savedTwo, automaticRestore: true } }
  action reopenHeldConversation = all { s.holding, s.heldBinding == s.active,
    s' = { ...s, draft: "", automaticRestore: false } }
  action restart = all { s.queuedBinding == 0,
    s' = { ...s, holding: false, unsettled: if (s.active == 1) s.markedOne else s.markedTwo,
      draft: if ((s.active == 1 and s.markedOne) or (s.active == 2 and s.markedTwo)) ""
        else if (s.active == 1) s.savedOne else s.savedTwo,
      automaticRestore: true, ready: true, failed: false } }
  action rejectedHold = all { s.failed or s.unsettled, s' = s }
  action step = any { queueComposerPaint, commitComposerPaint, tryDispatch, storageFailed, hold, rejectedHold, clearComposer, typeNew, release, commit,
    flush, saveFailed, saveConflict, switchConversation, reopenHeldConversation, restart, s' = s }
  val BoundQueue = s.queuedBinding.in(Set(0, 1, 2)) and s.active.in(Set(1, 2))
  val OneHeldSend = s.holding implies not(s.dispatched)
  val HeldTextNotAutomaticallyOffered = (s.holding and s.heldBinding == s.active and s.automaticRestore) implies s.draft != "A"
  val UnsettledNeverAutomaticallyOffered = s.unsettled implies not(s.holding) and s.draft != "A"
  val safety = (s.transportCalled implies not(s.paintPending)) and BoundQueue and OneHeldSend and HeldTextNotAutomaticallyOffered and UnsettledNeverAutomaticallyOffered
  run deferredComposerPaintBeforeDispatchTest = init.then(hold).then(queueComposerPaint).then(tryDispatch)
    .expect(not(s.transportCalled)).then(commitComposerPaint).then(tryDispatch).then(release).then(flush)
    .expect(s.draft == "A" and s.savedOne == "A" and safety)
  run retainedUntilDispatchTest = init.then(hold).then(clearComposer)
    .expect(s.savedOne == "A").then(commit).then(flush).expect(s.savedOne == "" and s.dispatched and safety)
  run newTypingSurvivesCommitTest = init.then(hold).then(clearComposer).then(typeNew)
    .then(commit).then(flush).expect(s.savedOne == "B" and s.draft == "B" and safety)
  run unsentTextRestoredTest = init.then(hold).then(clearComposer).then(typeNew).then(release).then(flush)
    .expect(s.draft == "A+B" and s.savedOne == "A+B" and safety)
  run retiredBindingCommitTest = init.then(hold).then(clearComposer).then(switchConversation).then(typeNew)
    .then(commit).then(flush).expect(s.savedOne == "" and s.savedTwo == "" and s.draft == "B" and safety)
  run unavailableStorageRefusesHoldTest = init.then(storageFailed).then(rejectedHold)
    .expect(s.draft == "A" and s.savedOne == "A" and not(s.holding) and safety)
  run restartHeldSendRequiresReviewTest = init.then(hold).then(clearComposer).then(restart).then(rejectedHold)
    .expect(s.unsettled and s.draft == "" and s.markedOne and safety)
  run reopeningDoesNotOfferHeldTextTest = init.then(hold).then(reopenHeldConversation)
    .expect(s.holding and s.draft == "" and safety)
  run failedClearKeepsRecoveryTest = init.then(hold).then(clearComposer).then(commit).then(saveFailed)
    .expect(s.savedOne == "A" and s.error and s.dispatched and safety)
}
