// Literal upstream ApprovalService at 4787d51a142c. Model-value selectors are integer identities.
module CoreApprovalServiceTemplate {
  const Selectors: Set[int]
  const CanFail: bool
  type State = {inMap: bool, timer: str, taskExists: bool, result: str, selRuns: int, toRuns: int,
    tpc: str, tHas: bool, spc: int -> str, sHas: int -> bool, cpc: str, stopped: bool}
  var s: State
  // Exact prefix monitor for the source action property SettlesOnce.
  var settledOnce: bool
  val vars = s
  pure val InitialState: State = {inMap: true, timer: "armed", taskExists: true, result: "none",
    selRuns: 0, toRuns: 0, tpc: "idle", tHas: false, spc: Selectors.mapBy(_ => "idle"),
    sHas: Selectors.mapBy(_ => false), cpc: "idle", stopped: false}
  val Initial = s == InitialState and settledOnce
  action Init = all {s' = InitialState, settledOnce' = true}
  action Move(after: State): bool = all {s' = after,
    settledOnce' = (settledOnce and (s.result == "none" or after.result == s.result))}
  // Source Settle changes only result; surrounding actions frame every other variable.
  def Settle(result: str): str = if (s.result == "none") result else s.result
  action Fire = all {s.timer == "armed", Move({...s, timer: "fired", tHas: s.inMap,
    inMap: false, tpc: if (s.inMap) "getTask" else "done"})}
  action TGetTask = all {s.tpc == "getTask", Move({...s,
    tpc: if (s.taskExists) "onTimeout" else "resolve", toRuns: s.toRuns + (if (s.taskExists) 1 else 0)})}
  action TCallbackDone = all {s.tpc == "onTimeout", Move({...s, tpc: "resolve"})}
  action TCallbackFails = all {CanFail, s.tpc == "onTimeout",
    Move({...s, tpc: "done", inMap: false, result: Settle("rejected")})}
  action TResolve = all {s.tpc == "resolve", Move({...s, result: Settle("timedOut"), tpc: "deleteTask"})}
  action TDelete = all {s.tpc == "deleteTask", Move({...s, taskExists: false, tpc: "done"})}
  action Deliver(selector: int): bool = all {Selectors.contains(selector), s.spc.get(selector) == "idle", s.taskExists,
    Move({...s, spc: s.spc.set(selector, "getTask")})}
  action SGetTask(selector: int): bool = all {Selectors.contains(selector), s.spc.get(selector) == "getTask",
    if (not(s.taskExists)) Move({...s, spc: s.spc.set(selector, "deleteTask")})
    else Move({...s, sHas: s.sHas.set(selector, s.inMap), inMap: false,
      timer: if (s.inMap and s.timer == "armed") "cleared" else s.timer,
      spc: s.spc.set(selector, if (s.inMap) "onSelect" else "deleteTask"),
      selRuns: s.selRuns + (if (s.inMap) 1 else 0)})}
  action SCallbackDone(selector: int): bool = all {Selectors.contains(selector), s.spc.get(selector) == "onSelect",
    Move({...s, result: Settle("selected"), spc: s.spc.set(selector, "deleteTask")})}
  action SCallbackFails(selector: int): bool = all {Selectors.contains(selector), CanFail, s.spc.get(selector) == "onSelect",
    Move({...s, result: Settle("rejected"), spc: s.spc.set(selector, "done")})}
  action SDelete(selector: int): bool = all {Selectors.contains(selector), s.spc.get(selector) == "deleteTask",
    Move({...s, taskExists: false, spc: s.spc.set(selector, "done")})}
  action Cancel = all {s.cpc == "idle", Move({...s, cpc: "deleteTask", inMap: false,
    timer: if (s.inMap and s.timer == "armed") "cleared" else s.timer,
    result: if (s.inMap) Settle("cancelled") else s.result})}
  action CancelDelete = all {s.cpc == "deleteTask", Move({...s, taskExists: false, cpc: "done"})}
  action Stop = all {not(s.stopped), Move({...s, stopped: true, inMap: false,
    timer: if (s.inMap and s.timer == "armed") "cleared" else s.timer,
    result: if (s.inMap) Settle("cancelled") else s.result})}
  val Finished = s.timer != "armed" and Set("idle", "done").contains(s.tpc)
    and Set("idle", "done").contains(s.cpc) and Selectors.forall(c => Set("idle", "done").contains(s.spc.get(c)))
  action Next = any {Fire, TGetTask, TCallbackDone, TCallbackFails, TResolve, TDelete,
    {nondet selector = Selectors.oneOf(); any {Deliver(selector), SGetTask(selector), SCallbackDone(selector), SCallbackFails(selector), SDelete(selector)}},
    Cancel, CancelDelete, Stop, all {Finished, Move(s)}}
  action Stutter = all {s' = s, settledOnce' = settledOnce}
  action Step = any {Next, Stutter}
  temporal Fairness = Fire.weakFair(vars) and TGetTask.weakFair(vars)
    and (TCallbackDone or TCallbackFails).weakFair(vars) and TResolve.weakFair(vars) and TDelete.weakFair(vars)
    and Selectors.forall(c => SGetTask(c).weakFair(vars)
      and (SCallbackDone(c) or SCallbackFails(c)).weakFair(vars) and SDelete(c).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep((s, settledOnce))) and Fairness
  val TypeOK = Set("armed", "fired", "cleared").contains(s.timer)
    and Set("none", "selected", "timedOut", "cancelled", "rejected").contains(s.result)
    and s.selRuns >= 0 and s.toRuns >= 0 and Set("idle", "getTask", "onTimeout", "resolve", "deleteTask", "done").contains(s.tpc)
    and s.spc.keys() == Selectors and s.sHas.keys() == Selectors
    and Selectors.forall(c => Set("idle", "getTask", "onSelect", "deleteTask", "done").contains(s.spc.get(c)))
    and Set("idle", "deleteTask", "done").contains(s.cpc)
  val AtMostOneCallback = s.selRuns + s.toRuns <= 1
  val ResultAgrees = (s.result == "cancelled" implies s.selRuns + s.toRuns == 0)
    and (s.result == "selected" implies s.toRuns == 0) and (s.result == "timedOut" implies s.selRuns == 0)
  val SingleOwner = (if (s.tHas) 1 else 0) + (if (s.inMap) 1 else 0) <= 1
    and Selectors.forall(c => s.sHas.get(c) implies not(s.inMap) and not(s.tHas)
      and Selectors.exclude(Set(c)).forall(other => not(s.sHas.get(other))))
  temporal SettlesOnce = always(settledOnce)
  temporal CallerSettles = eventually(s.result != "none")
}
module CoreApprovalService {
  import CoreApprovalServiceTemplate(Selectors = Set(1, 2), CanFail = true) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::AtMostOneCallback and Model::ResultAgrees and Model::SingleOwner
  temporal CheckedTemporal = Model::Fairness implies Model::SettlesOnce and Model::CallerSettles
  run selectionFailureSettlesTest = init.then(Model::Deliver(1)).then(Model::SGetTask(1)).then(Model::SCallbackFails(1))
    .then(Model::Deliver(2)).then(Model::SGetTask(2)).then(Model::SDelete(2))
    .expect(Model::s.result == "rejected" and Model::s.selRuns == 1 and Model::settledOnce and safety)
  run timeoutFailureSettlesTest = init.then(Model::Fire).then(Model::TGetTask).then(Model::TCallbackFails)
    .expect(Model::s.result == "rejected" and Model::s.toRuns == 1 and safety)
}
module CoreApprovalServiceRace {
  import CoreApprovalServiceTemplate(Selectors = Set(1, 2), CanFail = false) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::AtMostOneCallback and Model::ResultAgrees and Model::SingleOwner
  temporal CheckedTemporal = Model::Fairness implies Model::SettlesOnce and Model::CallerSettles
  run timerWinsSelectionRaceTest = init.then(Model::Deliver(1)).then(Model::Fire).then(Model::TGetTask)
    .then(Model::SGetTask(1)).then(Model::SDelete(1)).then(Model::TCallbackDone).then(Model::TResolve).then(Model::TDelete)
    .expect(Model::s.result == "timedOut" and Model::s.toRuns == 1 and Model::s.selRuns == 0 and safety)
  run stopCannotStealCallbackTest = init.then(Model::Deliver(1)).then(Model::SGetTask(1)).then(Model::Stop)
    .then(Model::SCallbackDone(1)).expect(Model::s.result == "selected" and Model::s.stopped and safety)
}
