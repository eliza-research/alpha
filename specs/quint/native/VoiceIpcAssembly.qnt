/// NativeVoiceIpc.exchange owns one handle and assembles a bounded response without retry.
module VoiceIpcAssembly {
  type State = {
    phase: str, active: int, foreignActive: bool, opened: bool, claimed: bool, cancelled: bool,
    guardCurrent: bool, deadline: bool, status: int, bytes: int, complete: bool,
    failure: str, dispatches: int, returned: bool, resultStatus: int,
    resultBytes: int, validatedCurrent: bool, validatedFailure: str
  }
  var s: State
  action initFor(occupied: bool): bool = s' = {
    phase: "idle", active: if (occupied) 2 else 0, foreignActive: occupied, opened: false, claimed: false,
    cancelled: false, guardCurrent: true, deadline: false, status: 0, bytes: 0,
    complete: false, failure: "none", dispatches: 0, returned: false,
    resultStatus: 0, resultBytes: 0, validatedCurrent: false, validatedFailure: "none" }
  action init = {
    nondet occupied = Set(false, true).oneOf()
    initFor(occupied)
  }
  action open = all {
    s.phase == "idle", s.guardCurrent,
    s' = { ...s, phase: "opened", opened: true }
  }
  action claim = all {
    s.phase == "opened",
    if (s.active == 0) s' = { ...s, phase: "claimed", active: 1, claimed: true }
    else s' = { ...s, phase: "failed", cancelled: true, failure: "concurrent" }
  }
  action schedule(accepted: bool): bool = all {
    s.phase == "claimed",
    if (accepted) s' = { ...s, phase: "ready", deadline: true }
    else s' = { ...s, phase: "failed", active: if (s.active == 1) 0 else s.active, cancelled: true, failure: "schedule" }
  }
  action dispatch = all {
    s.phase == "ready", s.guardCurrent, s.failure == "none",
    s' = { ...s, phase: "requesting", dispatches: 1 }
  }
  action refuseDispatch = all {
    s.phase == "ready", not(s.guardCurrent) or s.failure != "none",
    s' = { ...s, phase: "failed", failure: if (s.failure == "none") "guard" else s.failure }
  }
  action response(status: int): bool = all {
    s.phase == "requesting", s.guardCurrent, status.in(Set(0, 200, 500)),
    s' = { ...s, status: status }
  }
  /// Chunks may precede response status. The native callback enforces cumulative byte size.
  action chunk(amount: int): bool = all {
    s.phase == "requesting", s.guardCurrent, amount.in(Set(0, 1, 2)),
    if (s.bytes + amount <= 2) s' = { ...s, bytes: s.bytes + amount }
    else s' = { ...s, cancelled: true, failure: if (s.failure == "none") "bounds" else s.failure }
  }
  action completion(error: bool): bool = all {
    s.phase == "requesting", s.guardCurrent,
    if (error) s' = { ...s, cancelled: true, failure: if (s.failure == "none") "transport" else s.failure }
    else s' = { ...s, complete: true }
  }
  action malformed = all {
    s.phase == "requesting",
    s' = { ...s, cancelled: true, failure: if (s.failure == "none") "event" else s.failure }
  }
  action staleEvent = all {
    s.phase == "requesting", not(s.guardCurrent),
    s' = { ...s, cancelled: true, failure: if (s.failure == "none") "guard" else s.failure }
  }
  /// A deadline after the return decision cannot change the response already selected.
  action deadlineFires = all {
    s.deadline,
    s' = { ...s, cancelled: true, failure: if (s.failure == "none") "deadline" else s.failure }
  }
  action guardChanges = s' = { ...s, guardCurrent: false }
  action replaceHandle = all { s.claimed, s' = { ...s, active: 2, foreignActive: true, guardCurrent: false } }
  action requestReturns = all {
    s.phase == "requesting",
    val valid = s.guardCurrent and s.failure == "none" and s.complete and s.status != 0
    s' = { ...s, phase: if (valid) "returned" else "failed", returned: valid,
      resultStatus: if (valid) s.status else 0, resultBytes: if (valid) s.bytes else 0,
      validatedCurrent: valid, validatedFailure: s.failure,
      failure: if (s.failure != "none") s.failure else if (not(s.guardCurrent)) "guard"
        else if (not(s.complete) or s.status == 0) "incomplete" else "none" }
  }
  action cleanup = all {
    s.phase.in(Set("returned", "failed")),
    s' = { ...s, phase: "released", deadline: false, cancelled: true,
      active: if (s.active == 1) 0 else s.active, bytes: 0 }
  }
  action step = any {
    open, claim, schedule(true), schedule(false), dispatch, refuseDispatch,
    response(0), response(200), response(500), chunk(0), chunk(1), chunk(2),
    completion(true), completion(false), malformed, staleEvent, deadlineFires,
    guardChanges, replaceHandle, requestReturns, cleanup, s' = s
  }
  val BoundedBody = s.bytes.in(0.to(2)) and s.resultBytes.in(0.to(2))
  val OneRequest = s.dispatches <= 1 and (s.dispatches == 1 implies s.claimed)
  val ValidatedReturn = s.returned implies s.resultStatus != 0 and s.complete and
    s.validatedCurrent and s.validatedFailure == "none"
  val ReleasedResources = s.phase == "released" implies
    not(s.deadline) and s.cancelled and s.bytes == 0 and s.active != 1
  val ForeignHandlePreserved = s.foreignActive implies s.active == 2
  val TypeOK = s.phase.in(Set("idle", "opened", "claimed", "ready", "requesting", "returned", "failed", "released"))
    and s.active.in(0.to(2)) and s.status.in(Set(0, 200, 500))
  val safety = TypeOK and BoundedBody and OneRequest and ValidatedReturn and ReleasedResources and ForeignHandlePreserved
  run assemblyTest = initFor(false).then(open).then(claim).then(schedule(true)).then(dispatch)
    .then(chunk(1)).then(response(200)).then(chunk(1)).then(completion(false)).then(requestReturns)
    .expect(s.returned and s.resultBytes == 2).then(cleanup).expect(safety and s.active == 0)
  run missingCompletionTest = initFor(false).then(open).then(claim).then(schedule(true)).then(dispatch)
    .then(response(200)).then(requestReturns).then(cleanup).expect(not(s.returned) and s.failure == "incomplete" and safety)
  run deadlineBeforeDispatchTest = initFor(false).then(open).then(claim).then(schedule(true))
    .then(deadlineFires).then(refuseDispatch).then(cleanup).expect(s.dispatches == 0 and safety)
  run firstFailureTest = initFor(false).then(open).then(claim).then(schedule(true)).then(dispatch)
    .then(chunk(2)).then(chunk(1)).then(deadlineFires).then(completion(false)).then(requestReturns)
    .then(cleanup).expect(s.failure == "bounds" and not(s.returned) and safety)
  run concurrentHandleTest = initFor(true).then(open).then(claim).then(cleanup)
    .expect(s.active == 2 and s.cancelled and s.dispatches == 0 and safety)
  run replacedHandleTest = initFor(false).then(open).then(claim).then(schedule(true)).then(dispatch)
    .then(replaceHandle).then(staleEvent).then(requestReturns).then(cleanup).expect(s.active == 2 and safety)
  run schedulingFailureTest = initFor(false).then(open).then(claim).then(schedule(false)).then(cleanup)
    .expect(s.dispatches == 0 and not(s.deadline) and safety)
  run replacementBeforeScheduleFailureTest = initFor(false).then(open).then(claim).then(replaceHandle)
    .then(schedule(false)).expect(s.active == 2 and s.foreignActive and safety)
    .then(cleanup).expect(s.active == 2 and s.cancelled and s.dispatches == 0 and safety)
  run deadlineAfterReturnDecisionTest = initFor(false).then(open).then(claim).then(schedule(true)).then(dispatch)
    .then(response(500)).then(completion(false)).then(requestReturns).then(deadlineFires).then(cleanup)
    .expect(s.returned and s.resultStatus == 500 and s.failure == "deadline" and safety)
}
