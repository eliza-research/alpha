// Foreground timer and bridge-call ownership. Android/package trust and actual
// eventual network availability remain independent environmental obligations.
module AutomaticAppUpdateSchedule {
  type State = {active: bool, disposed: bool, busy: bool, failures: int, wakeAt: int, valid: bool}
  type Poll = {phase: str, capability: str, pending: bool, candidate: bool, requests: int,
    lastCapability: str, lastPending: bool, lastCandidate: bool, lastCurrent: bool, lastIdle: bool}
  var state: State
  var poll: Poll
  val emptyPoll = {phase:"idle", capability:"unread", pending:false, candidate:false, requests:0,
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
    poll' = {...poll, phase: if (not(available)) "retry"
      else if (not(state.valid)) "canceled" else if (not(idle)) "retry" else "facts"}
  }
  action readFacts(capability: str, pending: bool, candidate: bool, idle: bool): bool = all {
    state.busy, poll.phase == "facts",
    Set("starting", "supported", "permission-required", "unsupported").contains(capability),
    now' = now, state' = state,
    poll' = {...poll, capability:capability, pending:pending, candidate:candidate,
      phase: if (not(state.valid)) "canceled" else if (not(idle)) "retry"
        else if (pending) "answered" else if (capability == "starting") "retry"
        else if (capability != "supported" or not(candidate)) "answered" else "ready"}
  }
  action dispatch = all {
    state.busy, state.active, state.valid, not(state.disposed), poll.phase == "ready",
    poll.capability == "supported", not(poll.pending), poll.candidate, poll.requests < 3,
    now' = now, state' = state,
    poll' = {...poll, phase:"install", requests:poll.requests + 1,
      lastCapability:poll.capability, lastPending:poll.pending,
      lastCandidate:poll.candidate, lastCurrent:state.valid, lastIdle:true}
  }
  action installReply(status: str): bool = all {
    state.busy, poll.phase == "install",
    Set("starting", "permission-required", "unsupported", "answered").contains(status),
    now' = now, state' = state,
    poll' = {...poll, phase:if (status == "starting") "retry" else "answered"}
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
      and poll.lastCurrent and poll.lastIdle)
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
    readFacts(capability, pending, candidate, idle),
    dispatch,
    nondet status = Set("starting", "permission-required", "unsupported", "answered").oneOf()
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
    .then(readCheck(true, true)).then(readFacts("starting", false, true, true)).then(finishPoll(true))
    .expect(safety and poll.requests == 0 and state.wakeAt == 1)
    .then(advance(1)).then(beginPoll).then(readCheck(true, true))
    .then(readFacts("supported", false, true, true)).then(dispatch)
    .then(installReply("answered")).then(finishPoll(false))
    .expect(safety and poll.requests == 1 and state.failures == 0 and state.wakeAt == 5)
  run coldInstallReplyRetriesWithoutOverlappingTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("supported", false, true, true)).then(dispatch)
    .then(installReply("starting")).then(finishPoll(true))
    .expect(safety and poll.requests == 1 and state.wakeAt == 1)
    .then(advance(1)).then(beginPoll).then(readCheck(true, true))
    .then(readFacts("supported", false, true, true)).then(dispatch)
    .then(installReply("answered")).then(finishPoll(false))
    .expect(safety and poll.requests == 2 and state.failures == 0)
  run pendingPrecedesColdCapabilityAndDoesNotDispatchTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("starting", true, true, true)).then(finishPoll(false))
    .expect(safety and poll.requests == 0 and state.failures == 0 and state.wakeAt == 4)
  run lateColdFactsAfterResumeLoseAuthorityTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(active(false)).then(active(true))
    .then(readFacts("starting", false, true, true)).then(finishPoll(false))
    .expect(safety and poll.requests == 0 and state.wakeAt == 0)
  run disposedColdReplyNeverRearmsTest = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("supported", false, true, true)).then(dispatch)
    .then(dispose).then(installReply("starting")).then(finishPoll(true)).then(active(true))
    .expect(safety and state.disposed and not(state.active) and poll.requests == 1)
  action readyPoll = init.then(active(true)).then(beginPoll)
    .then(readCheck(true, true)).then(readFacts("supported", false, true, true))
  run readyCannotBackgroundTest = readyPoll.then(active(false).fail())
  run readyCannotDisposeTest = readyPoll.then(dispose.fail())
  run readyDispatchCompletesTest = readyPoll
    .expect(poll.phase == "ready" and state.valid and state.active)
    .then(dispatch).then(installReply("answered")).then(finishPoll(false))
    .expect(safety and poll.requests == 1 and not(state.busy))

}
