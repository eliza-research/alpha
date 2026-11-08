/// Lifecycle of the live-only native renderer subscription and its two asynchronous admissions.
module NativeViewSubscription {
  type State = { phase: str, registered: bool, dispatched: bool, ended: int,
    removals: int, unsubscribes: int, delivered: int }
  var s: State
  action init = s' = { phase: "registering", registered: false, dispatched: false,
    ended: 0, removals: 0, unsubscribes: 0, delivered: 0 }
  pure def closed(state: State): State = if (state.ended == 1) state else {
    ...state, ended: 1, removals: if (state.registered) 1 else 0,
    unsubscribes: if (state.dispatched) state.unsubscribes + 1 else state.unsubscribes }
  action close = s' = closed(s)
  action listenerResult(success: bool): bool = all {
    s.phase == "registering",
    s' = if (not(success)) { ...closed(s), phase: "failed" }
      else if (s.ended == 1) { ...s, registered: true, removals: 1, phase: "failed" }
      else { ...s, registered: true, dispatched: true, phase: "subscribing" }
  }
  action subscribeResult(success: bool, matching: bool): bool = all {
    s.phase == "subscribing",
    s' = if (not(success)) { ...closed(s), phase: "failed" }
      else if (s.ended == 0 and matching) { ...s, phase: "ready" }
      else { ...closed(s), phase: "failed", unsubscribes: closed(s).unsubscribes + 1 }
  }
  /// kind 1 is a valid view-interact event, kind 2 is the native terminal frame.
  action frame(subscription: bool, client: bool, kind: int): bool = all {
    kind.in(0.to(2)),
    if (s.ended == 0 and subscription and kind == 1 and client)
      all { s.delivered < 2, s' = { ...s, delivered: s.delivered + 1 } }
    else if (s.ended == 0 and subscription and kind == 2) s' = closed(s)
    else s' = s
  }
  action step = any { close, listenerResult(false), listenerResult(true),
    subscribeResult(false, false), subscribeResult(true, false), subscribeResult(true, true),
    frame(false, false, 0), frame(false, true, 1), frame(true, false, 1),
    frame(true, true, 0), frame(true, true, 1), frame(true, false, 2), s' = s }
  val Bounded = s.phase.in(Set("registering", "subscribing", "ready", "failed"))
    and s.ended.in(0.to(1)) and s.removals.in(0.to(1))
    and s.unsubscribes.in(0.to(2)) and s.delivered.in(0.to(2))
  val ReadyOwnsRegistration = s.phase == "ready" implies s.registered and s.dispatched
  val FailedEnded = s.phase == "failed" implies s.ended == 1
  val ClosedHandleRemoved = s.ended == 1 and s.registered implies s.removals == 1
  val ClosedDispatchRetired = s.ended == 1 and s.dispatched implies s.unsubscribes >= 1
  val safety = Bounded and ReadyOwnsRegistration and FailedEnded and ClosedHandleRemoved and ClosedDispatchRetired
  run happyLifecycleTest = init.then(listenerResult(true)).then(subscribeResult(true, true))
    .then(frame(true, true, 1)).then(close).then(frame(true, true, 1))
    .expect(s.delivered == 1 and s.ended == 1 and safety)
  run closeBeforeRegistrationTest = init.then(close).then(listenerResult(true))
    .expect(s.removals == 1 and s.unsubscribes == 0 and safety)
  run lateSubscriptionReplyTest = init.then(listenerResult(true)).then(close)
    .then(subscribeResult(true, true)).expect(s.unsubscribes == 2 and safety)
  run mismatchedReplyTest = init.then(listenerResult(true)).then(subscribeResult(true, false))
    .expect(s.ended == 1 and s.unsubscribes == 2 and safety)
  run listenerFailureTest = init.then(listenerResult(false)).expect(s.ended == 1 and safety)
  run subscriptionFailureTest = init.then(listenerResult(true)).then(subscribeResult(false, false))
    .expect(s.removals == 1 and s.unsubscribes == 1 and safety)
  run synchronousTerminalTest = init.then(frame(true, false, 2)).then(listenerResult(true))
    .expect(s.ended == 1 and s.removals == 1 and not(s.dispatched) and safety)
  run wrongIdentityTest = init.then(listenerResult(true)).then(subscribeResult(true, true))
    .then(frame(false, true, 1)).then(frame(true, false, 1)).expect(s.delivered == 0 and safety)
}
