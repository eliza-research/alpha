// Foreground timer, cached offer ownership and bridge-call admission. Android
// verifies the actual digest and offered APK at the install boundary.
module AutomaticAppUpdateSchedule {
  type State = {active: bool, disposed: bool, busy: bool, failures: int, wakeAt: int, valid: bool}
  // Zero is absent or unbound. Positive values identify distinct cached offer
  // objects with a native digest, including a newer read of the same bytes.
  type Poll = {phase: str, capability: str, pending: bool, candidate: bool, requests: int,
    cachedOffer: int, attemptedOffer: int, cachedManual: bool,
    lastCapability: str, lastPending: bool, lastCandidate: bool, lastCurrent: bool, lastIdle: bool}
  var state: State
  var poll: Poll
  val emptyPoll = {phase:"idle", capability:"unread", pending:false, candidate:false, requests:0,
    cachedOffer:0, attemptedOffer:0, cachedManual:false,
    lastCapability:"unread", lastPending:false, lastCandidate:false, lastCurrent:false, lastIdle:false}
  var now: int
  action init = all {
    now' = 0, poll' = emptyPoll,
    state' = {active:false, disposed:false, busy:false, failures:0, wakeAt:0, valid:true}
  }
  action active(value: bool): bool = all {
    // Facts admission, parsing and dispatch are one synchronous JS continuation.
    // The ready microstep has no lifecycle-event interleaving in the source.
    poll.phase != "ready",
    now' = now, poll' = poll,
    state' = if (state.disposed) state else {...state, active:value,
      valid: if (state.busy and state.active != value) false else state.valid}
  }
  action advance(value: int): bool = all {value >= now, now' = value, state' = state, poll' = poll}
  action begin = all {
    state.active, not(state.disposed), not(state.busy), now >= state.wakeAt, poll.phase == "idle",
    now' = now, state' = {...state, busy:true, valid:true}, poll' = poll
  }
  pure def finished(before: State, time: int, failed: bool): State = {
    val failures = if (failed) if (before.failures < 20) before.failures + 1 else 20 else 0
    val delay = if (not(failed) or failures >= 3) 4 else if (failures == 2) 2 else 1
    { ...before, busy:false, failures:failures, valid:true,
      wakeAt: if (not(before.valid)) time else time + delay }
  }
  action finish(failed: bool): bool = all {
    state.busy, poll.phase == "idle",
    now' = now, state' = finished(state, now, failed), poll' = poll
  }

  // The native port supplies capability classes. Its SDK/consent/boot clock is
  // owned by the native admission model, not duplicated by the renderer.
  action beginPoll = all {
    state.active, not(state.disposed), not(state.busy), now >= state.wakeAt,
    poll.phase == "idle", poll.requests < 3,
    now' = now, state' = {...state, busy:true, valid:true},
    poll' = {...poll, phase:"check", capability:"unread", pending:false, candidate:false}
  }
  action readCheck(available: bool, idle: bool): bool = all {
    state.busy, poll.phase == "check", now' = now, state' = state,
    poll' = {...poll, cachedOffer:if (available) poll.cachedOffer else 0,
      phase: if (not(available)) "retry"
        else if (not(state.valid)) "canceled" else if (not(idle)) "retry" else "facts"}
  }
  action readFacts(capability: str, pending: bool, candidate: bool, idle: bool, offer: int): bool = all {
    state.busy, poll.phase == "facts",
    Set("starting", "supported", "permission-required", "unsupported").contains(capability),
    offer >= 0 and offer <= 3,
    now' = now, state' = state,
    poll' = {...poll, capability:capability, pending:pending, candidate:candidate, cachedOffer:offer, cachedManual:candidate,
      phase: if (not(state.valid)) "canceled" else if (not(idle)) "retry"
        else if (pending) "answered" else if (capability == "starting") "retry"
        else if (capability != "supported" or not(candidate)) "answered"
        else if (offer == 0) "retry" else "ready"}
  }
  action dispatch = all {
    state.busy, state.active, state.valid, not(state.disposed), poll.phase == "ready",
    poll.capability == "supported", not(poll.pending), poll.candidate, poll.requests < 3,
    poll.cachedOffer > 0,
    now' = now, state' = state,
    poll' = {...poll, phase:"install", requests:poll.requests + 1, attemptedOffer:poll.cachedOffer,
      lastCapability:poll.capability, lastPending:poll.pending,
      lastCandidate:poll.candidate, lastCurrent:state.valid, lastIdle:true}
  }
  action replaceOffer(offer: int): bool = all {
    state.busy, poll.phase == "install",
    offer > 0 and offer <= 3 and offer != poll.cachedOffer and offer != poll.attemptedOffer,
    now' = now, state' = state, poll' = {...poll, cachedOffer:offer, cachedManual:true}
  }
  action installReply(status: str): bool = all {
    state.busy, poll.phase == "install",
    Set("starting", "permission-required", "unsupported", "offer-unavailable", "offer-retired", "answered").contains(status),
    now' = now, state' = state,
    poll' = {...poll,
      cachedOffer: if (Set("offer-unavailable", "offer-retired").contains(status) and poll.cachedOffer == poll.attemptedOffer) 0
        else poll.cachedOffer,
      cachedManual: poll.cachedManual and not(status == "offer-retired" and poll.cachedOffer == poll.attemptedOffer),
      phase: if (Set("starting", "offer-unavailable", "offer-retired").contains(status)) "retry" else "answered"}
  }
  action finishPoll(failed: bool): bool = all {
    state.busy,
    if (failed) poll.phase == "retry" else Set("answered", "canceled").contains(poll.phase),
    now' = now, state' = finished(state, now, failed), poll' = {...poll, phase:"idle"}
  }
  action dispose = all {
    poll.phase != "ready",
    now' = now, poll' = poll,
    state' = {...state, disposed:true, active:false, valid:not(state.busy)}
  }
  val NativeRequestWasAdmitted = poll.requests == 0 or
    (poll.lastCapability == "supported" and not(poll.lastPending) and poll.lastCandidate
      and poll.lastCurrent and poll.lastIdle and poll.attemptedOffer > 0)
  val PollHasOneOwner = poll.phase == "idle" or state.busy
  val safety = NativeRequestWasAdmitted and PollHasOneOwner and
    poll.requests >= 0 and poll.requests <= 3 and state.failures >= 0 and state.failures <= 20 and
    (not(state.disposed) or not(state.active)) and
    (state.busy or state.valid) and state.wakeAt >= 0
  action step = any {
    active(true), active(false), begin, finish(true), finish(false), dispose, beginPoll,
    nondet available = Set(false, true).oneOf()
    nondet idle = Set(false, true).oneOf()
    readCheck(available, idle),
    nondet capability = Set("starting", "supported", "permission-required", "unsupported").oneOf()
    nondet pending = Set(false, true).oneOf()
    nondet candidate = Set(false, true).oneOf()
    nondet idle = Set(false, true).oneOf()
    nondet offer = 0.to(3).oneOf()
    readFacts(capability, pending, candidate, idle, offer),
    dispatch,
    nondet offer = 1.to(3).oneOf(); replaceOffer(offer),
    nondet status = Set("starting", "permission-required", "unsupported", "offer-unavailable", "offer-retired", "answered").oneOf()
    installReply(status),
    finishPoll(true), finishPoll(false),
    nondet time = 0.to(20).oneOf(); advance(time),
    all {state'=state, now'=now, poll'=poll}
  }
  run staysForegroundAndFindsLaterReleaseTest = init.then(active(true)).then(begin).then(finish(false))
    .then(advance(3)).expect(now < state.wakeAt).then(advance(4)).then(begin).then(finish(false))
    .expect(safety and state.wakeAt == 8)
  run offlineRetriesAreBoundedAndRecoverTest = init.then(active(true)).then(begin).then(finish(true))
    .then(advance(1)).then(begin).then(finish(true)).then(advance(3)).then(begin).then(finish(true))
    .expect(state.wakeAt == 7).then(advance(7)).then(begin).then(finish(false))
    .expect(safety and state.failures == 0 and state.wakeAt == 11)
  run backgroundInvalidatesBeforeLaterEffectTest = init.then(active(true)).then(begin)
    .then(active(false)).then(active(true)).expect(not(state.valid) and state.busy)
    .then(finish(false)).expect(safety and state.wakeAt == 0)
    .then(begin).then(finish(false)).expect(state.wakeAt == 4)
  run disposedInFlightCannotAcquireAnotherAttemptTest = init.then(active(true)).then(begin)
    .then(dispose).expect(not(state.valid)).then(finish(true)).then(active(true))
    .expect(safety and state.disposed and not(state.active))
  run coldSnapshotRetriesBeforeAnyNativeRequestTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("starting", false, true, true, 1)).then(finishPoll(true))
    .expect(safety and poll.requests == 0 and state.wakeAt == 1)
    .then(advance(1)).then(beginPoll).then(readCheck(true, true))
    .then(readFacts("supported", false, true, true, 1)).then(dispatch)
    .then(installReply("answered")).then(finishPoll(false))
    .expect(safety and poll.requests == 1 and state.failures == 0 and state.wakeAt == 5)
  run coldInstallReplyRetriesWithoutOverlappingTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("supported", false, true, true, 1)).then(dispatch)
    .then(installReply("starting")).then(finishPoll(true))
    .expect(safety and poll.requests == 1 and state.wakeAt == 1)
    .then(advance(1)).then(beginPoll).then(readCheck(true, true))
    .then(readFacts("supported", false, true, true, 1)).then(dispatch)
    .then(installReply("answered")).then(finishPoll(false))
    .expect(safety and poll.requests == 2 and state.failures == 0)
  run pendingPrecedesColdCapabilityAndDoesNotDispatchTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("starting", true, true, true, 1)).then(finishPoll(false))
    .expect(safety and poll.requests == 0 and state.failures == 0 and state.wakeAt == 4)
  run lateColdFactsAfterResumeLoseAuthorityTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(active(false)).then(active(true))
    .then(readFacts("starting", false, true, true, 1)).then(finishPoll(false))
    .expect(safety and poll.requests == 0 and state.wakeAt == 0)
  run disposedColdReplyNeverRearmsTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("supported", false, true, true, 1)).then(dispatch)
    .then(dispose).then(installReply("starting")).then(finishPoll(true)).then(active(true))
    .expect(safety and state.disposed and not(state.active) and poll.requests == 1)
  action readyPoll = active(true).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("supported", false, true, true, 1))
  run readyCannotBackgroundTest = init.then(readyPoll).then(active(false).fail())
  run readyCannotDisposeTest = init.then(readyPoll).then(dispose.fail())
  run readyDispatchCompletesTest = init.then(readyPoll)
    .expect(poll.phase == "ready" and state.valid and state.active)
    .then(dispatch).then(installReply("answered")).then(finishPoll(false))
    .expect(safety and poll.requests == 1 and not(state.busy))
  run unboundOfferBacksOffBeforeDispatchTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("supported", false, true, true, 0)).then(finishPoll(true))
    .expect(safety and poll.requests == 0 and state.wakeAt == 1)
    .then(advance(1)).then(beginPoll).then(readCheck(true, true))
    .then(readFacts("supported", false, true, true, 1)).then(dispatch)
    .then(installReply("answered")).then(finishPoll(false))
    .expect(safety and poll.attemptedOffer == 1 and poll.requests == 1)
  run retiredOfferClearsExactCacheTest = init.then(readyPoll).then(dispatch)
    .then(installReply("offer-retired")).then(finishPoll(true))
    .expect(safety and poll.cachedOffer == 0 and not(poll.cachedManual) and state.wakeAt == 1)
    .then(advance(1)).then(beginPoll).then(readCheck(true, true))
    .then(readFacts("supported", false, true, true, 2)).then(dispatch)
    .then(installReply("answered")).then(finishPoll(false))
    .expect(safety and poll.attemptedOffer == 2 and poll.requests == 2)
  run unavailableOfferKeepsConcurrentRefreshTest = init.then(readyPoll).then(dispatch).then(replaceOffer(2))
    .then(installReply("offer-unavailable")).then(finishPoll(true))
    .expect(safety and poll.cachedOffer == 2 and poll.cachedManual and poll.attemptedOffer == 1 and state.wakeAt == 1)
  run retiredOfferKeepsConcurrentRefreshTest = init.then(readyPoll).then(dispatch).then(replaceOffer(2))
    .then(installReply("offer-retired")).then(finishPoll(true))
    .expect(safety and poll.cachedOffer == 2 and poll.cachedManual and poll.attemptedOffer == 1 and state.wakeAt == 1)
  run unavailableOfferPreservesManualTest = init.then(readyPoll).then(dispatch)
    .then(installReply("offer-unavailable")).then(finishPoll(true))
    .expect(safety and poll.cachedOffer == 0 and poll.cachedManual and state.wakeAt == 1)

}
