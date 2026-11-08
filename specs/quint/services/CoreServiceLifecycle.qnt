/// Finite projection of the shared service lifecycle and its actual host registries.
module CoreServiceLifecycle {
  val ids = Set(1, 2)
  val callers = Set(1, 2, 3)
  type State = {
    classes: Set[int], initReady: bool, initOpen: bool, alias: bool,
    stopRequested: bool, stopped: bool,
    instances: Set[int], starting: Set[int], failed: Set[int], observers: Set[int],
    startCalls: int -> int, hookResults: int -> str,
    stopOps: int -> str, stopCalls: int -> int,
    results: int -> str, values: int -> int,
    status: str, handler: str, servicePromise: bool, startingType: bool,
    generation: int, retirementFailures: int, observerFailures: int
  }
  var s: State
  pure def first(instances: Set[int]): int = if (1.in(instances)) 1 else if (2.in(instances)) 2 else 0
  pure def count(values: int -> int): int = values.get(1) + values.get(2)
  action initFor(classes: Set[int], ready: bool, open: bool, initial: Set[int], alias: bool): bool =
    s' = { classes: classes, initReady: ready, initOpen: open, alias: alias,
      stopRequested: false, stopped: false, instances: initial, starting: Set(), failed: Set(), observers: Set(),
      startCalls: Map((1, 0), (2, 0)), hookResults: Map((1, "unused"), (2, "unused")),
      stopOps: Map((1, "none"), (2, "none")), stopCalls: Map((1, 0), (2, 0)),
      results: Map((1, "unused"), (2, "unused"), (3, "unused")),
      values: Map((1, 0), (2, 0), (3, 0)),
      status: if (initial.size() > 0) "registered" else "pending",
      handler: "pending", servicePromise: true, startingType: false,
      generation: 0, retirementFailures: 0, observerFailures: 0 }
  action init = initFor(ids, true, false, Set(), false)
  action beginEnsure(id: int): bool = all {
    id.in(callers), s.results.get(id) == "unused",
    s' = { ...s, results: s.results.set(id, if (s.stopRequested) "null" else "barrier") }
  }
  action admitEnsure(id: int): bool = all {
    s.results.get(id) == "barrier",
    s.stopRequested or s.initReady or (s.initOpen and s.instances.size() > 0),
    val fast = s.initOpen and s.instances.size() > 0
    val absent = s.classes.size() == 0
    val toStart = s.classes.filter(k => not(k.in(s.instances)) and not(k.in(s.starting))
      and not(s.instances.size() > 0 and k.in(s.failed)))
    val start = if (s.stopRequested or fast or absent) Set() else toStart
    val immediate = s.stopRequested or fast or absent
    s' = { ...s,
      results: s.results.set(id, if (s.stopRequested or absent) "null" else if (fast) "ok" else "waiting"),
      values: s.values.set(id, if (fast and not(s.stopRequested)) first(s.instances) else 0),
      starting: s.starting.union(start),
      startCalls: ids.mapBy(k => s.startCalls.get(k) + (if (k.in(start)) 1 else 0)),
      hookResults: ids.mapBy(k => if (k.in(start)) "pending" else s.hookResults.get(k)),
      status: if (start.size() > 0 and s.instances.size() == 0) "registering" else s.status,
      startingType: if (immediate) s.startingType else true,
      generation: s.generation + start.size() }
  }
  action ready = all { not(s.initReady), s' = { ...s, initReady: true, initOpen: false } }
  action requestStop(stopped: bool): bool = s' = { ...s, stopRequested: true, stopped: stopped }
  action returned(id: int, result: str, sendFailure: bool): bool = all {
    id.in(s.starting), s.hookResults.get(id) == "pending", result.in(Set("instance", "rejected", "null")),
    val late = result == "instance" and (s.stopRequested or s.stopped)
    val publish = result == "instance" and not(late)
    s' = { ...s, hookResults: s.hookResults.set(id, result),
      instances: if (publish) s.instances.union(Set(id)) else s.instances,
      observers: if (publish and not(sendFailure)) s.observers.union(Set(id)) else s.observers,
      stopOps: if (late) s.stopOps.set(id, "pending") else s.stopOps,
      stopCalls: if (late) s.stopCalls.set(id, s.stopCalls.get(id) + 1) else s.stopCalls,
      generation: s.generation + (if (late) 1 else 0) }
  }
  action settled(id: int, success: bool, observerFailure: bool): bool = all {
    id.in(s.starting), s.hookResults.get(id) != "pending",
    not(s.stopOps.get(id) == "pending"),
    success implies (id.in(s.instances) and id.in(s.observers)),
    s' = { ...s, starting: s.starting.exclude(Set(id)), observers: s.observers.exclude(Set(id)),
      failed: if (success) s.failed.exclude(Set(id)) else s.failed.union(Set(id)),
      status: if (success) s.status else "failed",
      handler: if (not(success) and not(s.alias) and s.handler == "pending") "rejected" else s.handler,
      servicePromise: if (not(success) and not(s.alias) and s.handler == "pending") false else s.servicePromise,
      startingType: if (s.starting.exclude(Set(id)).size() == 0) false else s.startingType,
      observerFailures: s.observerFailures + (if (observerFailure) 1 else 0) }
  }
  action completeEnsure(id: int): bool = all {
    s.results.get(id) == "waiting", s.starting.size() == 0,
    val success = s.instances.size() > 0
    s' = { ...s, results: s.results.set(id, if (success) "ok" else "failed"),
      values: s.values.set(id, first(s.instances)), status: if (success) "registered" else "failed",
      handler: if (s.handler == "pending") (if (success) "resolved" else "rejected") else s.handler,
      servicePromise: if (not(success) and s.handler == "pending") false else s.servicePromise,
      startingType: false }
  }
  action beginStop(id: int): bool = all {
    id.in(ids), id.in(s.instances),
    val fresh = s.stopOps.get(id) == "none"
    s' = { ...s, stopOps: if (fresh) s.stopOps.set(id, "pending") else s.stopOps,
      stopCalls: if (fresh) s.stopCalls.set(id, s.stopCalls.get(id) + 1) else s.stopCalls,
      generation: s.generation + (if (fresh) 1 else 0) }
  }
  action finishStop(id: int, success: bool): bool = all {
    s.stopOps.get(id) == "pending",
    s' = { ...s, stopOps: s.stopOps.set(id, if (success) "ok" else "failed"),
      retirementFailures: s.retirementFailures + (if (success) 0 else 1) }
  }
  action invalidStop = all {
    s.retirementFailures < 3,
    s' = { ...s, retirementFailures: s.retirementFailures + 1 }
  }
  val OrderedFirst = callers.forall(id => s.results.get(id) != "ok" or s.values.get(id).in(ids))
  val SingleFlightStop = ids.forall(id => s.stopCalls.get(id) <= 1)
  val PublishedBeforeObservers = s.observers.subseteq(s.instances)
  val RetirementGeneration = s.generation == count(s.startCalls) + count(s.stopCalls)
  val TypeOK = s.instances.subseteq(ids) and s.starting.subseteq(ids) and s.failed.subseteq(ids)
    and s.generation >= 0 and s.retirementFailures >= 0
    and callers.forall(id => s.results.get(id).in(Set("unused", "barrier", "waiting", "ok", "null", "failed")))
  val safety = OrderedFirst and SingleFlightStop and PublishedBeforeObservers and RetirementGeneration and TypeOK
  action step = any {
    nondet id = callers.oneOf()
    beginEnsure(id),
    nondet id = callers.oneOf()
    admitEnsure(id),
    nondet id = callers.oneOf()
    completeEnsure(id),
    ready, requestStop(false), requestStop(true),
    nondet id = ids.oneOf()
    nondet result = Set("instance", "rejected", "null").oneOf()
    nondet sendFailure = Set(false, true).oneOf()
    returned(id, result, sendFailure),
    nondet id = ids.oneOf()
    nondet success = Set(false, true).oneOf()
    nondet observerFailure = Set(false, true).oneOf()
    settled(id, success, observerFailure),
    nondet id = ids.oneOf()
    beginStop(id),
    nondet id = ids.oneOf()
    nondet success = Set(false, true).oneOf()
    finishStop(id, success), invalidStop, s' = s }
  run concurrentStartTest = init.then(beginEnsure(1)).then(admitEnsure(1)).then(beginEnsure(2)).then(admitEnsure(2))
    .expect(count(s.startCalls) == 2).then(returned(2, "instance", false)).then(settled(2, true, false))
    .then(returned(1, "instance", false)).then(settled(1, true, false))
    .then(completeEnsure(1)).then(completeEnsure(2)).expect(s.values.get(1) == 1 and safety)
  run partialFailureTest = init.then(beginEnsure(1)).then(admitEnsure(1)).then(returned(1, "rejected", false))
    .then(settled(1, false, false)).then(returned(2, "instance", false)).then(settled(2, true, false))
    .then(completeEnsure(1)).expect(s.results.get(1) == "ok" and s.handler == "rejected" and safety)
  run lateStartTest = init.then(beginEnsure(1)).then(admitEnsure(1)).then(requestStop(true))
    .then(returned(1, "instance", false)).then(finishStop(1, true)).then(settled(1, false, false))
    .expect(not(1.in(s.instances)) and safety)
  run stopSingleFlightTest = initFor(Set(1), true, false, Set(1), false).then(beginStop(1)).then(beginStop(1))
    .then(finishStop(1, false)).then(beginStop(1)).expect(s.stopCalls.get(1) == 1 and s.retirementFailures == 1 and safety)
  run observerFailureTest = initFor(Set(1), true, false, Set(), false).then(beginEnsure(1)).then(admitEnsure(1))
    .then(returned(1, "instance", false)).then(settled(1, true, true)).then(completeEnsure(1))
    .expect(s.results.get(1) == "ok" and s.observerFailures == 1 and safety)
  run initializationFastPathTest = initFor(Set(1), false, true, Set(1), false).then(beginEnsure(1)).then(admitEnsure(1))
    .expect(s.results.get(1) == "ok" and s.generation == 0 and safety)
}
