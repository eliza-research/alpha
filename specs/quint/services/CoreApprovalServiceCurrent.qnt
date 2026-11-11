/// Current synchronous callback-bearing approvals, including refused duplicate delivery and draining stop.
module CoreApprovalServiceCurrent {
  pure val selectors = Set(1, 2)
  type State = {inMap: bool, timer: str, taskExists: bool, result: str, selRuns: int, toRuns: int,
    tpc: str, tHas: bool, spc: int -> str, sHas: int -> bool, cpc: str, stopped: bool,
    stopDone: bool, unavailable: Set[int], blocked: Set[int], deleteCalls: Set[int]}
  var state: State
  var settlementStable: bool
  action init = all {
    state' = {inMap: true, timer: "armed", taskExists: true, result: "none", selRuns: 0, toRuns: 0,
      tpc: "idle", tHas: false, spc: selectors.mapBy(_ => "idle"), sHas: selectors.mapBy(_ => false),
      cpc: "idle", stopped: false, stopDone: false, unavailable: Set(), blocked: Set(), deleteCalls: Set()},
    settlementStable' = true
  }
  action move(after: State): bool = all {state' = after,
    settlementStable' = (settlementStable and (state.result == "none" or after.result == state.result))}
  pure def workCount(s: State): int = (if (s.result == "none") 1 else 0)
    + selectors.fold(0, (sum, selector) => sum + (if (s.spc.get(selector).in(Set("getTask", "onSelect"))) 2
      else if (s.spc.get(selector) == "deleteTask") 1 else 0))
    + (if (s.tpc.in(Set("getTask", "onTimeout", "resolve", "deleteTask"))) 1 else 0)
    + (if (s.cpc == "deleteTask") 1 else 0)
  val pendingWork = workCount(state)
  def settle(result: str): str = if (state.result == "none") result else state.result
  action fire = all {state.timer == "armed", not(state.stopped), move({...state,
    timer: "fired", tHas: state.inMap, inMap: false, tpc: if (state.inMap) "getTask" else "done"})}
  action timeoutTask = all {state.tpc == "getTask", move({...state,
    tpc: if (state.taskExists) "onTimeout" else "resolve", toRuns: state.toRuns + (if (state.taskExists) 1 else 0)})}
  action timeoutCallbackDone = all {state.tpc == "onTimeout", move({...state, tpc: "resolve"})}
  action timeoutCallbackFails = all {state.tpc == "onTimeout", move({...state,
    tpc: "done", inMap: false, result: settle("rejected")})}
  action timeoutResolve = all {state.tpc == "resolve", move({...state, result: settle("timedOut"), tpc: "deleteTask"})}
  action timeoutDelete = all {state.tpc == "deleteTask", move({...state, taskExists: false, tpc: "done"})}
  action deliver(selector: int): bool = all {selectors.contains(selector), state.spc.get(selector) == "idle",
    if (state.stopped) move({...state, spc: state.spc.set(selector, "done"), blocked: state.blocked.union(Set(selector))})
    else all {state.taskExists, move({...state, spc: state.spc.set(selector, "getTask")})}}
  action selectionTask(selector: int): bool = all {selectors.contains(selector), state.spc.get(selector) == "getTask",
    if (state.stopped or not(state.taskExists)) move({...state, spc: state.spc.set(selector, "deleteTask"),
      deleteCalls: state.deleteCalls.union(Set(selector))})
    else if (not(state.inMap)) move({...state, spc: state.spc.set(selector, "done"),
      unavailable: state.unavailable.union(Set(selector))})
    else move({...state, sHas: state.sHas.set(selector, true), inMap: false,
      timer: if (state.timer == "armed") "cleared" else state.timer,
      spc: state.spc.set(selector, "onSelect"), selRuns: state.selRuns + 1})}
  action selectionCallbackDone(selector: int): bool = all {selectors.contains(selector), state.spc.get(selector) == "onSelect",
    move({...state, result: settle("selected"), spc: state.spc.set(selector, "deleteTask"),
      deleteCalls: state.deleteCalls.union(Set(selector))})}
  action selectionCallbackFails(selector: int): bool = all {selectors.contains(selector), state.spc.get(selector) == "onSelect",
    move({...state, result: settle("rejected"), spc: state.spc.set(selector, "done")})}
  action selectionDelete(selector: int): bool = all {selectors.contains(selector), state.spc.get(selector) == "deleteTask",
    move({...state, taskExists: false, spc: state.spc.set(selector, "done")})}
  action cancel = all {not(state.stopped), state.cpc == "idle", move({...state,
    cpc: "deleteTask", inMap: false, timer: if (state.inMap and state.timer == "armed") "cleared" else state.timer,
    result: if (state.inMap) settle("cancelled") else state.result})}
  action cancelDelete = all {state.cpc == "deleteTask", move({...state, taskExists: false, cpc: "done"})}
  action stop = all {not(state.stopped), move({...state, stopped: true, inMap: false,
    timer: if (state.inMap and state.timer == "armed") "cleared" else state.timer,
    result: if (state.inMap) settle("cancelled") else state.result})}
  action finishStop = all {state.stopped, not(state.stopDone), pendingWork == 0, move({...state, stopDone: true})}
  action step = any {fire, timeoutTask, timeoutCallbackDone, timeoutCallbackFails, timeoutResolve, timeoutDelete,
    {nondet selector = selectors.oneOf(); any {deliver(selector), selectionTask(selector),
      selectionCallbackDone(selector), selectionCallbackFails(selector), selectionDelete(selector)}},
    cancel, cancelDelete, stop, finishStop, move(state)}
  val TypeOK = state.timer.in(Set("armed", "fired", "cleared"))
    and state.result.in(Set("none", "selected", "timedOut", "cancelled", "rejected"))
    and state.tpc.in(Set("idle", "getTask", "onTimeout", "resolve", "deleteTask", "done"))
    and state.cpc.in(Set("idle", "deleteTask", "done"))
    and state.spc.keys() == selectors and state.sHas.keys() == selectors
    and state.selRuns >= 0 and state.toRuns >= 0
    and state.unavailable.subseteq(selectors) and state.blocked.subseteq(selectors) and state.deleteCalls.subseteq(selectors)
    and selectors.forall(selector => state.spc.get(selector).in(Set("idle", "getTask", "onSelect", "deleteTask", "done")))
  val AtMostOneCallback = state.selRuns + state.toRuns <= 1
  val ResultAgrees = (state.result == "cancelled" implies state.selRuns + state.toRuns == 0)
    and (state.result == "selected" implies state.toRuns == 0) and (state.result == "timedOut" implies state.selRuns == 0)
  val SingleOwner = (if (state.tHas) 1 else 0) + (if (state.inMap) 1 else 0) <= 1
    and selectors.forall(selector => state.sHas.get(selector) implies not(state.inMap) and not(state.tHas)
      and selectors.exclude(Set(selector)).forall(other => not(state.sHas.get(other))))
  val RefusedCallbackHasNoEffect = state.unavailable.forall(selector => not(state.sHas.get(selector))
    and not(state.deleteCalls.contains(selector)) and state.spc.get(selector) == "done")
  val StoppedAdmissionHasNoEffect = state.blocked.forall(selector => not(state.sHas.get(selector))
    and not(state.deleteCalls.contains(selector)) and state.spc.get(selector) == "done")
  val StopWaitsForWork = state.stopDone implies state.stopped and pendingWork == 0
  val safety = TypeOK and AtMostOneCallback and ResultAgrees and SingleOwner and settlementStable
    and RefusedCallbackHasNoEffect and StoppedAdmissionHasNoEffect and StopWaitsForWork
  /// Fairness assumes admitted callback/storage ports eventually answer; it does not assert bounded wall time.
  val vars = (state, settlementStable)
  temporal Fairness = fire.weakFair(vars) and timeoutTask.weakFair(vars)
    and (timeoutCallbackDone or timeoutCallbackFails).weakFair(vars)
    and timeoutResolve.weakFair(vars) and timeoutDelete.weakFair(vars)
    and selectors.forall(selector => selectionTask(selector).weakFair(vars)
      and (selectionCallbackDone(selector) or selectionCallbackFails(selector)).weakFair(vars)
      and selectionDelete(selector).weakFair(vars))
    and cancelDelete.weakFair(vars) and finishStop.weakFair(vars)
  temporal CheckedTemporal = Fairness implies always(settlementStable)
    and eventually(state.result != "none") and always(state.stopped implies eventually(state.stopDone))
  val UnavailableSelectorWitness = state.unavailable.size() > 0
  val StopWaitingWitness = state.stopped and not(state.stopDone) and pendingWork > 0
  val StopDrainedWitness = state.stopDone
  val FailureSettledWitness = state.result == "rejected"
  run secondSelectionPreservesClaimedTaskTest = init.then(deliver(1)).then(deliver(2)).then(selectionTask(1)).then(selectionTask(2))
    .expect(state.taskExists and state.unavailable == Set(2) and state.deleteCalls == Set() and state.selRuns == 1 and safety)
    .then(selectionCallbackDone(1)).then(selectionDelete(1)).expect(state.result == "selected" and safety)
  run timeoutOwnsCallbackTest = init.then(deliver(1)).then(fire).then(timeoutTask).then(selectionTask(1))
    .expect(state.unavailable == Set(1) and safety).then(timeoutCallbackDone).then(timeoutResolve).then(timeoutDelete)
    .expect(state.result == "timedOut" and safety)
  run failedCallbackSettlesTest = init.then(deliver(1)).then(selectionTask(1)).then(selectionCallbackFails(1))
    .expect(state.result == "rejected" and state.deleteCalls == Set() and safety)
  run stopWaitsForClaimedCallbackTest = init.then(deliver(1)).then(selectionTask(1)).then(stop)
    .expect(StopWaitingWitness and safety).then(selectionCallbackDone(1)).then(selectionDelete(1)).then(finishStop)
    .expect(state.result == "selected" and StopDrainedWitness and safety)
  run stopWaitsForAdmittedReadTest = init.then(deliver(1)).then(stop).expect(StopWaitingWitness and safety)
    .then(selectionTask(1)).then(selectionDelete(1)).then(finishStop).expect(state.result == "cancelled" and safety)
  run stoppedDeliveryHasNoEffectsTest = init.then(stop).then(finishStop).then(deliver(2))
    .expect(state.blocked == Set(2) and StoppedAdmissionHasNoEffect and safety)
  run cancelBeforeReadTest = init.then(deliver(1)).then(cancel).then(cancelDelete).then(selectionTask(1)).then(selectionDelete(1))
    .expect(state.result == "cancelled" and state.selRuns == 0 and safety)
}
