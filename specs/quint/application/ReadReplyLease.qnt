/// The lease that lets one approved Notes read answer the question that asked for it
/// (`readReplyLeases`): pending, completing, done, cancelled or unconfirmed. The answer is added
/// to the conversation at most once and only while the original binding is still current.
module ReadReplyLease {
  type State = { lease: str, bindingCurrent: bool, approval: str, completions: int, answers: int,
    voiceResumed: int, wasCancelled: bool, cancelRequests: int, taps: int }
  var s: State
  action init = s' = { lease: "none", bindingCurrent: true, approval: "none", completions: 0, answers: 0,
    voiceResumed: 0, wasCancelled: false, cancelRequests: 0, taps: 0 }
  // A proposal with a read reply is retained once, from the chat reply or from pending-action recovery.
  action retain = all { s.bindingCurrent, s' = if (s.lease == "none") { ...s, lease: "pending" } else s }
  action approveTap = all { s.lease != "none", s.approval == "none", s.taps < 3,
    s' = { ...s, approval: "running", taps: s.taps + 1 } }
  // The receipt of the approved read. Completion starts only from a pending lease whose binding,
  // origin and digest are still current; a failed action cancels the lease.
  action receipt(succeeded: bool): bool = all { s.approval == "running",
    s' = if (not(s.bindingCurrent)) { ...s, approval: "none" }
      else if (not(succeeded))
        if (s.lease.in(Set("cancelled", "done"))) { ...s, approval: "none" }
        else { ...s, approval: "none", lease: "cancelled", wasCancelled: true, cancelRequests: s.cancelRequests + 1 }
      else if (s.lease == "pending") { ...s, approval: "none", lease: "completing", completions: s.completions + 1 }
      else { ...s, approval: "none" } }
  // The agent's answer arrives. It is shown and voice resumes only if the lease is still
  // completing for the current binding; otherwise the outcome is unconfirmed, never retried.
  action completionSettles(ok: bool): bool = all { s.completions == 1, s.lease.in(Set("completing", "cancelled")),
    s.answers == 0,
    s' = if (s.lease == "cancelled") { ...s, completions: 2 }
      else if (ok and s.bindingCurrent)
        { ...s, completions: 2, lease: "done", answers: s.answers + 1, voiceResumed: s.voiceResumed + 1 }
      else { ...s, completions: 2, lease: "unconfirmed" } }
  // Leaving the conversation, a sensitive screen or retiring the voice review cancels the lease
  // and aborts the approval that is running for it.
  action cancel = all { s.lease != "none",
    s' = if (s.lease.in(Set("cancelled", "done"))) { ...s, approval: "none" }
      else { ...s, lease: "cancelled", wasCancelled: true, approval: "none", cancelRequests: s.cancelRequests + 1 } }
  action bindingChanged = all { s.bindingCurrent, s' = { ...s, bindingCurrent: false } }
  action step = {
    nondet flag = Set(false, true).oneOf()
    any { retain, approveTap, receipt(flag), completionSettles(flag), cancel, bindingChanged, s' = s }
  }

  val PhaseKnown = s.lease.in(Set("none", "pending", "completing", "done", "cancelled", "unconfirmed"))
  val AtMostOneAnswer = s.answers <= 1 and s.completions <= 2
  val AnswerMeansDone = (s.answers == 1) == (s.lease == "done")
  val CancelledIsFinal = s.wasCancelled implies (s.lease == "cancelled" and s.answers == 0)
  val VoiceResumesWithAnswer = s.voiceResumed == s.answers
  val CompletingHasOneRequest = s.lease == "completing" implies s.completions == 1
  val UnconfirmedNeverRetried = s.lease == "unconfirmed" implies s.completions == 2
  val CancelRequestedOnce = s.cancelRequests <= 1
  val safety = PhaseKnown and AtMostOneAnswer and AnswerMeansDone and CancelledIsFinal and VoiceResumesWithAnswer and
    CompletingHasOneRequest and UnconfirmedNeverRetried and CancelRequestedOnce

  val AnsweredWitness = s.lease == "done" and s.taps == 1
  val UnconfirmedWitness = s.lease == "unconfirmed" and not(s.bindingCurrent)
  val CancelledWhileCompletingWitness = s.wasCancelled and s.completions == 1
  val LateAnswerDroppedWitness = s.wasCancelled and s.completions == 2

  run approvedReadAnswersOnceTest = init.then(retain).then(retain).then(approveTap).then(receipt(true))
    .expect(s.lease == "completing" and s.completions == 1).then(completionSettles(true))
    .expect(s.lease == "done" and s.answers == 1 and s.voiceResumed == 1 and safety)
    .then(approveTap).then(receipt(true)).expect(s.answers == 1 and s.completions == 2 and safety)
  // The answer of a lease cancelled while it was completing is never shown.
  run cancelledWhileCompletingTest = init.then(retain).then(approveTap).then(receipt(true)).then(cancel)
    .expect(s.lease == "cancelled" and s.cancelRequests == 1).then(completionSettles(true))
    .expect(s.lease == "cancelled" and s.answers == 0 and s.voiceResumed == 0 and safety)
  run bindingChangeLeavesUnconfirmedTest = init.then(retain).then(approveTap).then(receipt(true)).then(bindingChanged)
    .then(completionSettles(true)).expect(s.lease == "unconfirmed" and s.answers == 0 and safety)
    .then(approveTap).then(receipt(true)).expect(s.lease == "unconfirmed" and s.completions == 2 and safety)
  run failedActionCancelsLeaseTest = init.then(retain).then(approveTap).then(receipt(false))
    .expect(s.lease == "cancelled" and s.completions == 0 and safety)
  run staleReceiptLeavesLeasePendingTest = init.then(retain).then(approveTap).then(bindingChanged).then(receipt(true))
    .expect(s.lease == "pending" and s.completions == 0 and s.approval == "none" and safety)
}
