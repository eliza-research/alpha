// Literal upstream ServiceLifecycle at 4787d51a142c. Class and caller model
// values use disjoint integers. Instance numbers retain their original order.
module CoreServiceLifecycleTemplate {
  const Classes: Set[int]
  const LateClasses: Set[int]
  const Owned: Set[int]
  const Callers: Set[int]
  const MaxInst: int
  const MaxRetries: int
  const None: int
  assume OneEarlyOwner = Owned.size() == 1 and Owned.subseteq(Classes.exclude(LateClasses))
  pure val Inst = 1.to(MaxInst)
  pure val OwnedClass = Owned.chooseSome()
  type State = {types: Set[int], byClass: int -> int, starting: int -> bool, failed: int -> bool,
    sc: int -> str, att: int -> int, scInst: int -> int, published: Set[int], status: str,
    nextInst: int, cls: int -> int, late: int -> bool, stopCalls: int -> int, stopOp: int -> str,
    epc: int -> str, tries: int -> int, ewait: int -> (int -> int), stopReq: bool, stopped: bool,
    rpc: str, rcur: int, rvisited: Set[int], lastEnsure: int, upc: str, ucur: int, uwait: int -> int}
  var s: State
  val vars = s
  val startVars = (s.byClass, s.starting, s.failed, s.sc, s.att, s.scInst, s.nextInst, s.cls, s.late)
  val callerVars = (s.epc, s.tries, s.ewait, s.lastEnsure)
  val stopVars = (s.stopReq, s.stopped, s.rpc, s.rcur, s.rvisited)
  val unloadVars = (s.upc, s.ucur, s.uwait)
  val Created = 1.to(s.nextInst - 1)
  pure val InFlight = Set("awaitStart", "event", "lateStop")
  pure val NoWait = Classes.mapBy(_ => 0)
  pure val InitialState: State = {
    types: Classes.exclude(LateClasses), byClass: Classes.mapBy(_ => None), starting: Classes.mapBy(_ => false),
    failed: Classes.mapBy(_ => false), sc: Classes.mapBy(_ => "idle"), att: NoWait, scInst: Classes.mapBy(_ => None),
    published: Set(), status: "pending", nextInst: 1, cls: Inst.mapBy(_ => None), late: Inst.mapBy(_ => false),
    stopCalls: Inst.mapBy(_ => 0), stopOp: Inst.mapBy(_ => "none"), epc: Callers.mapBy(_ => "idle"),
    tries: Callers.mapBy(_ => 0), ewait: Callers.mapBy(_ => NoWait), stopReq: false, stopped: false,
    rpc: "idle", rcur: None, rvisited: Set(), lastEnsure: None, upc: "idle", ucur: None, uwait: NoWait}
  val Initial = s == InitialState
  action Init = s' = InitialState
  pure def Rebuild(bc: int -> int, ts: Set[int]): Set[int] = ts.map(c => bc.get(c)).exclude(Set(None))
  pure def StopOnce(state: State, i: int): State = if (state.stopOp.get(i) != "none") state else
    {...state, stopOp: state.stopOp.set(i, "running"), stopCalls: state.stopCalls.set(i, state.stopCalls.get(i) + 1)}

  action EBegin(e: int): bool = all {s.epc.get(e) == "idle", not(s.stopReq), s' = {...s, epc: s.epc.set(e, "ensure")}}
  action EEnsure(e: int): bool = all {
    s.epc.get(e) == "ensure",
    if (s.stopReq or s.types.size() == 0) s' = {...s, epc: s.epc.set(e, "done")}
    else {
      val startedImpl = s.types.exists(c => s.byClass.get(c) != None)
      val spawn = s.types.filter(c => s.byClass.get(c) == None and not(s.starting.get(c)) and not(startedImpl and s.failed.get(c)))
      val join = s.types.filter(c => s.byClass.get(c) == None and s.starting.get(c))
      s' = {...s, starting: Classes.mapBy(c => s.starting.get(c) or spawn.contains(c)),
        sc: Classes.mapBy(c => if (spawn.contains(c)) "awaitStart" else s.sc.get(c)),
        att: Classes.mapBy(c => s.att.get(c) + (if (spawn.contains(c)) 1 else 0)),
        ewait: s.ewait.set(e, Classes.mapBy(c => if (spawn.contains(c)) s.att.get(c) + 1 else if (join.contains(c)) s.att.get(c) else 0)),
        status: if (spawn.size() > 0 and s.published.size() == 0) "registering" else s.status,
        lastEnsure: e, epc: s.epc.set(e, "wait")}
    }
  }
  def Settled(e: int): bool = Classes.forall(c => s.ewait.get(e).get(c) > 0 implies
    s.att.get(c) > s.ewait.get(e).get(c) or s.sc.get(c) == "idle")
  action ESettle(e: int): bool = all {
    s.epc.get(e) == "wait", Settled(e),
    val base = {...s, ewait: s.ewait.set(e, NoWait)}
    val retry = s.tries.get(e) < MaxRetries and not(s.stopReq or s.stopped)
    s' = if (s.published.size() > 0) {...base, status: "registered", epc: s.epc.set(e, "done")}
      else {...base, status: if (s.types.size() == 0) "unknown" else "failed",
        epc: s.epc.set(e, if (retry) "delay" else "done"),
        tries: if (retry) s.tries.set(e, s.tries.get(e) + 1) else s.tries}
  }
  action EDelay(e: int): bool = all {s.epc.get(e) == "delay",
    s' = {...s, epc: s.epc.set(e, if (s.stopReq or s.stopped) "done" else "ensure")}}

  action StartFail(c: int): bool = all {s.sc.get(c) == "awaitStart",
    s' = {...s, sc: s.sc.set(c, "idle"), starting: s.starting.set(c, false), failed: s.failed.set(c, true)}}
  action StartOk(c: int): bool = all {
    s.sc.get(c) == "awaitStart", s.nextInst <= MaxInst,
    val i = s.nextInst
    val created = {...s, nextInst: i + 1, cls: s.cls.set(i, c)}
    if (s.stopped or s.stopReq or not(s.types.contains(c))) s' = StopOnce({...created,
      late: s.late.set(i, s.stopped or s.stopReq), scInst: s.scInst.set(c, i), sc: s.sc.set(c, "lateStop")}, i)
    else {
      val byClass = s.byClass.set(c, i)
      s' = {...created, byClass: byClass, published: Rebuild(byClass, s.types), status: "registered", sc: s.sc.set(c, "event")}
    }
  }
  action StartEvent(c: int): bool = all {s.sc.get(c) == "event",
    s' = {...s, sc: s.sc.set(c, "idle"), starting: s.starting.set(c, false), failed: s.failed.set(c, false)}}
  action StartLateStopped(c: int): bool = all {
    s.sc.get(c) == "lateStop", s.stopOp.get(s.scInst.get(c)) == "done",
    s' = {...s, sc: s.sc.set(c, "idle"), scInst: s.scInst.set(c, None),
      starting: s.starting.set(c, false), failed: s.failed.set(c, true)}
  }
  action StopOpDone(i: int): bool = all {s.stopOp.get(i) == "running", s' = {...s, stopOp: s.stopOp.set(i, "done")}}
  action RegisterLate(c: int): bool = all {LateClasses.exclude(s.types).contains(c), not(s.stopReq),
    s' = {...s, types: s.types.union(Set(c)), status: "pending"}}

  action RRequest = all {s.rpc == "idle", s' = {...s, stopReq: true, rpc: "services"}}
  action RServices = all {s.rpc == "services", s' = {...s, stopped: true, rpc: "stopping"}}
  action RStopNext = all {
    s.rpc == "stopping",
    nondet i = s.published.exclude(s.rvisited).oneOf()
    s' = StopOnce({...s, rcur: i, rvisited: s.rvisited.union(Set(i)), rpc: "stopInst"}, i)
  }
  action RStopWait = all {s.rpc == "stopInst", s.stopOp.get(s.rcur) == "done", s' = {...s, rpc: "stopping", rcur: None}}
  action RClear = all {s.rpc == "stopping", s.published.subseteq(s.rvisited),
    s' = {...s, rpc: "done", byClass: Classes.mapBy(_ => None), starting: Classes.mapBy(_ => false),
      failed: Classes.mapBy(_ => false), published: Set()}}

  pure def UStopTaken(state: State, i: int): State = if (i != None) StopOnce({...state, upc: "stop"}, i)
    else {...state, failed: state.failed.set(OwnedClass, false), upc: "done"}
  pure def UStatus(published: Set[int], types: Set[int]): str =
    if (published.size() > 0) "registered" else if (types.size() > 0) "pending" else "unknown"
  action UStart = all {
    s.upc == "idle",
    if (s.types.size() == 0) s' = {...s, upc: "done"}
    else {
      val entry = if (s.lastEnsure == None) false else s.epc.get(s.lastEnsure) == "wait"
      val inflight = entry or s.starting.get(OwnedClass)
      val awaited = Classes.mapBy(c => if (c == OwnedClass and s.starting.get(c)) s.att.get(c)
        else if (entry) s.ewait.get(s.lastEnsure).get(c) else 0)
      val i = s.byClass.get(OwnedClass)
      s' = {...s, types: s.types.exclude(Owned), byClass: s.byClass.set(OwnedClass, None),
        published: s.published.exclude(Set(i)), ucur: i, uwait: if (inflight) awaited else s.uwait,
        upc: if (inflight) "wait" else "drain"}
    }
  }
  action UAwaited = all {s.upc == "wait", Classes.forall(c => s.uwait.get(c) > 0 implies
    s.att.get(c) > s.uwait.get(c) or s.sc.get(c) == "idle"), s' = {...s, upc: "drain"}}
  action UDrain = all {s.upc == "drain", s' = UStopTaken({...s, status: UStatus(s.published, s.types)}, s.ucur)}
  action UStopped = all {s.upc == "stop", s.stopOp.get(s.ucur) == "done",
    s' = {...s, failed: s.failed.set(OwnedClass, false), upc: "done"}}

  val Finished = Callers.forall(e => Set("idle", "done").contains(s.epc.get(e)))
    and Set("idle", "done").contains(s.rpc) and Set("idle", "done").contains(s.upc)
    and Classes.forall(c => s.sc.get(c) == "idle") and Inst.forall(i => s.stopOp.get(i) != "running")
  action Next = any {
    {nondet e = Callers.oneOf(); any {EBegin(e), EEnsure(e), ESettle(e), EDelay(e)}},
    {nondet c = Classes.oneOf(); any {RegisterLate(c), StartFail(c), StartOk(c), StartEvent(c), StartLateStopped(c)}},
    {nondet i = Inst.oneOf(); StopOpDone(i)}, RRequest, RServices, RStopNext, RStopWait, RClear,
    UStart, UAwaited, UDrain, UStopped, all {Finished, s' = s}
  }
  action Stutter = s' = s
  action Step = any {Next, Stutter}
  temporal Fairness = Callers.forall(e => EEnsure(e).weakFair(vars) and ESettle(e).weakFair(vars) and EDelay(e).weakFair(vars))
    and Classes.forall(c => (StartFail(c) or StartOk(c)).weakFair(vars) and StartEvent(c).weakFair(vars) and StartLateStopped(c).weakFair(vars))
    and Inst.forall(i => StopOpDone(i).weakFair(vars))
    and RServices.weakFair(vars) and RStopNext.weakFair(vars) and RStopWait.weakFair(vars) and RClear.weakFair(vars)
    and UAwaited.weakFair(vars) and UDrain.weakFair(vars) and UStopped.weakFair(vars)
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness

  val TypeOK = all {
    s.types.subseteq(Classes), s.byClass.keys() == Classes, s.starting.keys() == Classes, s.failed.keys() == Classes,
    s.sc.keys() == Classes, s.att.keys() == Classes, s.scInst.keys() == Classes, s.uwait.keys() == Classes,
    Classes.forall(c => Inst.union(Set(None)).contains(s.byClass.get(c)) and InFlight.union(Set("idle")).contains(s.sc.get(c))
      and s.att.get(c) >= 0 and Inst.union(Set(None)).contains(s.scInst.get(c)) and s.uwait.get(c) >= 0),
    s.published.subseteq(Inst), Set("pending", "registering", "registered", "failed", "unknown").contains(s.status),
    s.nextInst.in(1.to(MaxInst + 1)), s.cls.keys() == Inst, s.late.keys() == Inst, s.stopCalls.keys() == Inst, s.stopOp.keys() == Inst,
    Inst.forall(i => Classes.union(Set(None)).contains(s.cls.get(i)) and s.stopCalls.get(i) >= 0 and Set("none", "running", "done").contains(s.stopOp.get(i))),
    s.epc.keys() == Callers, s.ewait.keys() == Callers,
    Callers.forall(e => Set("idle", "ensure", "wait", "delay", "done").contains(s.epc.get(e))
      and s.ewait.get(e).keys() == Classes and Classes.forall(c => s.ewait.get(e).get(c) >= 0)),
    Set("idle", "services", "stopping", "stopInst", "done").contains(s.rpc),
    Callers.union(Set(None)).contains(s.lastEnsure), Set("idle", "wait", "drain", "stop", "done").contains(s.upc)
  }
  val OneLivePerClass = Classes.forall(c => Created.filter(i => s.cls.get(i) == c and s.stopCalls.get(i) == 0).size() <= 1)
  val StopAtMostOnce = Inst.forall(i => s.stopCalls.get(i) <= 1)
  val NoLatePublish = s.published.forall(i => not(s.late.get(i)))
  val NoOrphan = Created.forall(i => s.stopCalls.get(i) == 0 implies
    s.published.contains(i) or (Set("wait", "drain").contains(s.upc) and i == s.ucur))
  val StatusConsistent = s.status == "failed" implies s.published.size() == 0
  val NoStatusWithoutClasses = s.upc == "done" and s.types.size() == 0 and not(s.stopped) implies s.status == "unknown"
  val StoppedNotReachable = s.rpc == "done" implies s.published.size() == 0
  temporal StopReachesAll = s.stopReq.leadsTo(Classes.forall(c => s.sc.get(c) == "idle") and Created.forall(i => s.stopCalls.get(i) >= 1))
  temporal CallersReturn = Callers.forall(e => (s.epc.get(e) == "ensure").leadsTo(s.epc.get(e) == "done"))
}

module CoreServiceLifecycle {
  import CoreServiceLifecycleTemplate(Classes = Set(11, 12), LateClasses = Set(12), Owned = Set(11),
    Callers = Set(21, 22), MaxInst = 3, MaxRetries = 0, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::OneLivePerClass and Model::StopAtMostOnce and Model::NoLatePublish
    and Model::NoOrphan and Model::StatusConsistent and Model::NoStatusWithoutClasses and Model::StoppedNotReachable
  temporal CheckedTemporal = Model::Fairness implies Model::StopReachesAll and Model::CallersReturn
  run lateStartIsStoppedOnceTest = init.then(Model::EBegin(21)).then(Model::EEnsure(21)).then(Model::RRequest)
    .then(Model::StartOk(11)).then(Model::StopOpDone(1)).then(Model::StartLateStopped(11)).then(Model::ESettle(21))
    .expect(Model::s.published == Set() and Model::s.stopCalls.get(1) == 1 and safety)
}

module CoreServiceLifecycleSiblings {
  import CoreServiceLifecycleTemplate(Classes = Set(11, 12), LateClasses = Set(12), Owned = Set(11),
    Callers = Set(21, 22), MaxInst = 4, MaxRetries = 1, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::OneLivePerClass and Model::StopAtMostOnce and Model::NoLatePublish
    and Model::NoOrphan and Model::StatusConsistent and Model::NoStatusWithoutClasses and Model::StoppedNotReachable
  run failedClassLeavesSiblingAvailableTest = init.then(Model::RegisterLate(12)).then(Model::EBegin(21)).then(Model::EEnsure(21))
    .then(Model::StartFail(11)).then(Model::StartOk(12)).then(Model::StartEvent(12)).then(Model::ESettle(21))
    .then(Model::EBegin(22)).then(Model::EEnsure(22)).expect(Model::s.att.get(11) == 1 and Model::s.published == Set(1) and safety)
}
