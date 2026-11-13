// The app's binding of the shared wake-listener stop. On an Android build whose image has not
// declared the listener capability, the app hands the listener's native port to the shared stop
// and keeps one "stop unconfirmed" latch from its verdict; voice settings show the latch. The
// shared stop answers true only for a status that proves capture ended (off, not listening,
// microphone closed) received within its five-second deadline; every other reply, a failed call,
// the deadline and a missing port answer false. Where the image has admitted the listener, or off
// Android, the request is not a stop: it reports true, calls nothing and leaves the latch as it
// was. A reply after the deadline changes nothing; with overlapping requests the last one to
// finish decides the latch.
module WakeListenerStop {
  type Call = { phase: str, confirmed: bool }
  type State = { latch: bool, admitted: bool, calls: int -> Call, lastVerdict: str, portCalls: int, lateReplies: int }
  pure val Slots = Set(0, 1)
  pure val Replies = Set("off", "listening", "microphone-open", "unavailable", "malformed")
  var s: State
  action init = s' = { latch: false, admitted: false, calls: Slots.mapBy(_ => { phase: "idle", confirmed: false }),
    lastVerdict: "none", portCalls: 0, lateReplies: 0 }
  def phase(slot: int): str = s.calls.get(slot).phase
  def finish(slot: int, confirmed: bool, ended: str): State = { ...s, latch: not(confirmed),
    calls: s.calls.set(slot, { phase: ended, confirmed: confirmed }),
    lastVerdict: if (confirmed) "confirmed" else "unconfirmed" }
  // The mounted image declares or withdraws the listener capability.
  action admission(value: bool): bool = all { s.admitted != value, s' = { ...s, admitted: value } }
  // The request reaches the listener port; the shared stop arms its deadline.
  action request(slot: int): bool = all { not(s.admitted), phase(slot) != "waiting", s.portCalls < 6,
    s' = { ...s, calls: s.calls.set(slot, { phase: "waiting", confirmed: false }), portCalls: s.portCalls + 1 } }
  // Without the listener port nothing can prove capture stopped, whatever the image declared.
  action requestWithoutPort(slot: int): bool = all { phase(slot) != "waiting",
    s' = { ...s, latch: true, calls: s.calls.set(slot, { phase: "refused", confirmed: false }), lastVerdict: "unconfirmed" } }
  // An admitted listener is not stopped: the request reports true and decides nothing.
  action requestWhileAdmitted(slot: int): bool = all { s.admitted, phase(slot) != "waiting",
    s' = { ...s, calls: s.calls.set(slot, { phase: "skipped", confirmed: true }) } }
  // Off Android there is no listener to stop.
  action requestOffAndroid(slot: int): bool = all { phase(slot) != "waiting",
    s' = { ...s, calls: s.calls.set(slot, { phase: "skipped", confirmed: true }) } }
  action replyArrives(slot: int, reply: str): bool = all { phase(slot) == "waiting",
    s' = finish(slot, reply == "off", "answered") }
  action replyFails(slot: int): bool = all { phase(slot) == "waiting", s' = finish(slot, false, "answered") }
  // The deadline passes first: the request reports failure while the port call stays outstanding.
  action deadline(slot: int): bool = all { phase(slot) == "waiting", s' = finish(slot, false, "expired") }
  action lateReply(slot: int, reply: str): bool = all { phase(slot) == "expired",
    s' = { ...s, calls: s.calls.set(slot, { ...s.calls.get(slot), phase: "abandoned" }),
      lateReplies: if (reply == "off") s.lateReplies + 1 else s.lateReplies } }
  action step = {
    nondet slot = Slots.oneOf()
    nondet reply = Replies.oneOf()
    nondet value = Set(true, false).oneOf()
    any { admission(value), request(slot), requestWithoutPort(slot), requestWhileAdmitted(slot), requestOffAndroid(slot),
      replyArrives(slot, reply), replyFails(slot), deadline(slot), lateReply(slot, reply), s' = s }
  }
  // The latch is the verdict of the stop that finished last; a skipped request is not a verdict.
  val LatchIsLastVerdict = s.latch == (s.lastVerdict == "unconfirmed")
  val ConfirmedOnlyByAnswerOrSkip = Slots.forall(slot => s.calls.get(slot).confirmed implies phase(slot).in(Set("answered", "skipped")))
  val SkippedReportsTrue = Slots.forall(slot => phase(slot) == "skipped" implies s.calls.get(slot).confirmed)
  val PortCallsBounded = s.portCalls <= 6 and s.lateReplies <= s.portCalls
  val safety = LatchIsLastVerdict and ConfirmedOnlyByAnswerOrSkip and SkippedReportsTrue and PortCallsBounded
  val LateStopKeepsWarningWitness = s.lateReplies > 0 and s.latch and Slots.forall(slot => phase(slot) != "waiting")
  val ConfirmedStopClearsWarningWitness = not(s.latch) and s.lastVerdict == "confirmed" and s.portCalls > 1
  val OverlappingRequestsDisagreeWitness = s.latch and Slots.exists(slot => phase(slot) == "answered" and s.calls.get(slot).confirmed)
  val MissingPortWitness = s.latch and s.portCalls == 0
  // A request made after the image admitted the listener reports true while the earlier warning stays.
  val SkippedRequestKeepsWarningWitness = s.latch and s.admitted and Slots.exists(slot => phase(slot) == "skipped")
  run confirmedStopClearsLatchTest = init.then(request(0)).then(replyArrives(0, "listening"))
    .expect(s.latch and not(s.calls.get(0).confirmed) and safety)
    .then(request(0)).then(replyArrives(0, "off")).expect(not(s.latch) and s.calls.get(0).confirmed and safety)
  // A stop that proves itself only after the deadline is not believed.
  run lateReplyDoesNotClearLatchTest = init.then(request(0)).then(deadline(0)).expect(s.latch and safety)
    .then(lateReply(0, "off")).expect(s.latch and s.lateReplies == 1 and safety)
  run openMicrophoneIsNotAStopTest = init.then(request(0)).then(replyArrives(0, "microphone-open")).expect(s.latch and safety)
    .then(request(1)).then(replyFails(1)).expect(s.latch and safety)
  run missingPortLatchesTest = init.then(requestWithoutPort(0)).expect(s.latch and s.portCalls == 0 and safety)
    .then(admission(true)).then(requestWithoutPort(1)).expect(s.latch and s.portCalls == 0 and safety)
  run lastFinishedRequestDecidesTest = init.then(request(0)).then(request(1)).then(replyArrives(1, "off"))
    .expect(not(s.latch) and safety).then(deadline(0)).expect(s.latch and s.calls.get(1).confirmed and safety)
  run admittedRequestLeavesLatchTest = init.then(request(0)).then(replyFails(0)).expect(s.latch and safety)
    .then(admission(true)).then(requestWhileAdmitted(1))
    .expect(s.latch and s.calls.get(1).confirmed and s.portCalls == 1 and safety)
  run offAndroidRequestCallsNothingTest = init.then(requestOffAndroid(0))
    .expect(not(s.latch) and s.calls.get(0).confirmed and s.portCalls == 0 and s.lastVerdict == "none" and safety)
}
