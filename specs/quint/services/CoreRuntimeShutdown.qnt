/// Shared runtime stop admission, best-effort completion and strict quiescence.
module CoreRuntimeShutdown {
  val callers = Set(1, 2, 3)
  type State = {
    requested: bool, stopped: bool, inFlight: bool, fast: bool,
    strict: bool, strictResult: str, bestResults: int -> str,
    room: bool, turnAborted: bool, post: bool,
    prepareFails: bool, prepareCalls: int, stopCalls: int, serviceStop: str,
    servicePublished: bool, lookup: bool, handler: bool, eventHandler: bool, generation: int, failures: int
  }
  var s: State
  action initFor(prepareFails: bool): bool = s' = {
    requested: false, stopped: false, inFlight: false, fast: false,
    strict: false, strictResult: "none", bestResults: Map((1,"none"),(2,"none"),(3,"none")),
    room: false, turnAborted: false, post: false, prepareFails: prepareFails,
    prepareCalls: 0, stopCalls: 0, serviceStop: "none",
    servicePublished: true, lookup: true, handler: true, eventHandler: true, generation: 1, failures: 0 }
  action init = initFor(false)
  pure def admit(state: State, fast: bool): State =
    if (state.inFlight or state.stopped) state else {
      ...state, requested: true, inFlight: true, fast: fast,
      turnAborted: state.room,
      prepareCalls: state.prepareCalls + (if (state.requested) 0 else 1),
      failures: state.failures + (if (not(state.requested) and state.prepareFails) 1 else 0)
    }
  action beginBest(id: int, fast: bool): bool = all {
    id.in(callers), s.bestResults.get(id) == "none",
    val admitted = admit(s, fast)
    s' = { ...admitted, bestResults: s.bestResults.set(id,
      if (s.stopped and not(s.inFlight)) "ok" else "pending") }
  }
  action beginStrict(fast: bool): bool = all {
    val admitted = if (s.strict) s else admit(s, fast)
    s' = { ...admitted, strict: true, strictResult: if (s.strict) s.strictResult else "pending" }
  }
  action addRoom = all { not(s.requested), not(s.room), s' = {...s, room: true} }
  action finishRoom = all { s.room, s' = {...s, room: false, turnAborted: false} }
  action addPost = all { not(s.post), s' = {...s, post: true} }
  action finishPost = all { s.post, s' = {...s, post: false} }
  action startServices = all {
    s.inFlight, not(s.stopped), not(s.room), s.fast or not(s.post),
    s' = {...s, stopped: true, stopCalls: 1, serviceStop: "pending", generation: 2 }
  }
  action serviceSettled(success: bool): bool = all {
    s.serviceStop == "pending",
    s' = {...s, serviceStop: if (success) "ok" else "failed", failures: s.failures + (if (success) 0 else 1) }
  }
  action finishBest(timedOut: bool): bool = all {
    s.inFlight, s.stopped,
    (s.serviceStop != "pending") or (s.fast and timedOut),
    s' = {...s, inFlight: false, servicePublished: false, lookup: false, handler: false, eventHandler: false,
      bestResults: callers.mapBy(id => if (s.bestResults.get(id) == "pending") "ok" else s.bestResults.get(id)) }
  }
  action failRoomTimeout = all {
    s.inFlight, s.fast, s.room, not(s.stopped),
    s' = {...s, inFlight: false, failures: s.failures + 1,
      bestResults: callers.mapBy(id => if (s.bestResults.get(id) == "pending") "failed" else s.bestResults.get(id)),
      strictResult: if (s.strictResult == "pending") "failed" else s.strictResult }
  }
  action finishStrict = all {
    s.strictResult == "pending", not(s.inFlight), s.stopped,
    not(s.room), not(s.post), s.serviceStop != "pending",
    s' = {...s, strictResult: if (s.failures == 0) "ok" else "failed" }
  }
  val StopAdmission = not(s.requested) or s.prepareCalls == 1
  val StopSingleFlight = s.stopCalls <= 1 and s.generation == 1 + s.stopCalls
  val StrictSettledResources = s.strictResult != "ok" or
    (s.stopped and not(s.inFlight) and s.serviceStop == "ok" and s.failures == 0)
  val ClearedAfterBest = s.inFlight or not(s.stopped) or (not(s.servicePublished) and not(s.lookup) and not(s.handler) and not(s.eventHandler))
  val TypeOK = s.prepareCalls.in(0.to(1)) and s.stopCalls.in(0.to(1)) and s.failures.in(0.to(3))
    and s.serviceStop.in(Set("none","pending","ok","failed"))
    and s.strictResult.in(Set("none","pending","ok","failed"))
  val safety = StopAdmission and StopSingleFlight and StrictSettledResources and ClearedAfterBest and TypeOK
  action step = any {
    nondet id = callers.oneOf()
    nondet fast = Set(false,true).oneOf()
    beginBest(id,fast),
    nondet fast = Set(false,true).oneOf()
    beginStrict(fast), addRoom, finishRoom,
    addPost, finishPost, startServices,
    serviceSettled(true), serviceSettled(false), finishBest(false), finishBest(true),
    all { s.failures < 2, failRoomTimeout }, finishStrict, s' = s }
  run ordinaryWaitsForPostTest = init.then(addPost).then(beginBest(1,false))
    .expect(not(s.stopped)).then(finishPost).then(startServices).then(serviceSettled(true)).then(finishBest(false))
    .expect(s.bestResults.get(1) == "ok" and safety)
  run strictWaitsAfterFastTest = init.then(addPost).then(beginBest(1,true)).then(startServices).then(finishBest(true))
    .then(beginStrict(true)).expect(s.strictResult == "pending").then(serviceSettled(true)).then(finishPost).then(finishStrict)
    .expect(s.strictResult == "ok" and safety)
  run stopHookFailureTest = init.then(beginStrict(false)).then(startServices).then(serviceSettled(false)).then(finishBest(false)).then(finishStrict)
    .expect(s.strictResult == "failed" and safety)
  run preparationFailureTest = initFor(true).then(beginBest(1,false)).then(startServices).then(serviceSettled(true))
    .then(finishBest(false)).then(beginStrict(false)).then(finishStrict).expect(s.strictResult == "failed" and safety)
  run roomTimeoutRetryTest = init.then(addRoom).then(beginBest(1,true)).then(failRoomTimeout).then(finishRoom)
    .then(beginBest(2,false)).then(startServices).then(serviceSettled(true)).then(finishBest(false)).expect(safety)
  run stickyStrictFailureTest = init.then(addRoom).then(beginStrict(true)).then(failRoomTimeout).then(finishRoom).then(beginStrict(false))
    .expect(s.strictResult == "failed" and not(s.inFlight) and safety)
}
