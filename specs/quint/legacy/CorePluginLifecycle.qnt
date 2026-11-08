// Literal upstream PluginLifecycle at 4787d51a142c. Actor identities and
// service-class indices are disjoint. CHOOSE over instance IDs picks the least.
module CorePluginLifecycleTemplate {
  const NumClasses: int
  const Unloaders: Set[int]
  const Loaders: Set[int]
  const Registrars: Set[int]
  const Stoppers: Set[int]
  const Rivals: Set[int]
  const StartsInFlight: bool
  const InitMayFail: bool
  const StopMayFail: bool
  const StartMayFail: bool
  const None: int
  pure val Classes = 1.to(NumClasses)
  pure val Actors = Unloaders.union(Loaders).union(Registrars).union(Stoppers).union(Rivals)
  pure val MaxInst = NumClasses * (1 + Loaders.size())
  pure val Insts = 1.to(MaxInst)
  pure val Owners = Set("A", "B", "none")
  type State = {pc: int -> str, running: int, cur: int -> int, waitSet: int -> Set[int],
    queue: int -> Set[int], visited: Set[int], joinOf: int -> int, stopFailed: bool,
    owned: bool, pluginsA: bool, tdActive: int, regActive: int, disposeCalls: int,
    types: Set[int], byClass: int -> int, starting: int -> int, failedC: Set[int], services: Set[int],
    live: Set[int], stopCalls: int -> int, stopOps: Set[int], nextInst: int, stopRequested: bool,
    registry: str, ownsA: bool, ownsB: bool, lastReg: str}
  var s: State
  val vars = s
  val ctl = (s.cur, s.waitSet, s.queue, s.visited, s.joinOf, s.stopFailed)
  val plug = (s.owned, s.pluginsA, s.tdActive, s.regActive, s.disposeCalls)
  val svc = (s.types, s.byClass, s.starting, s.failedC, s.services, s.live, s.stopCalls, s.stopOps, s.nextInst, s.stopRequested)
  val conn = (s.registry, s.ownsA, s.ownsB, s.lastReg)
  def Free(a: int): bool = s.running == None or s.running == a
  pure def Go(state: State, a: int, phase: str): State = {...state, pc: state.pc.set(a, phase)}
  pure val Rest = Set("idle", "done", "ok", "err")
  pure val InitialRegistry = if (StartsInFlight or NumClasses == 0) "none" else "A"
  pure val InitialServices = if (StartsInFlight) Set() else Classes
  pure val InitialState: State = {pc: Actors.mapBy(_ => "idle"), running: None, cur: Actors.mapBy(_ => 0),
    waitSet: Unloaders.mapBy(_ => Set()), queue: Unloaders.mapBy(_ => Set()), visited: Set(),
    joinOf: Registrars.union(Unloaders).mapBy(_ => None), stopFailed: false,
    owned: Registrars.size() == 0, pluginsA: Registrars.size() == 0, tdActive: None, regActive: None, disposeCalls: 0,
    types: if (Registrars.size() == 0) Classes else Set(), byClass: Classes.mapBy(c => if (StartsInFlight) 0 else c),
    starting: Classes.mapBy(c => if (StartsInFlight) c else 0), failedC: Set(), services: InitialServices,
    live: InitialServices, stopCalls: Insts.mapBy(_ => 0), stopOps: Set(), nextInst: NumClasses + 1, stopRequested: false,
    registry: InitialRegistry, ownsA: InitialRegistry == "A", ownsB: false, lastReg: InitialRegistry}
  val Initial = s == InitialState
  action Init = s' = InitialState

  action UCall(u: int): bool = all {
    s.pc.get(u) == "idle", Free(u),
    val base = {...s, running: None}
    s' = if (not(s.owned)) Go(base, u, "done")
      else if (s.tdActive != None) Go({...base, joinOf: s.joinOf.set(u, s.tdActive)}, u, "join")
      else Go({...base, tdActive: u, disposeCalls: s.disposeCalls + 1}, u, "dispose")
  }
  action UJoin(u: int): bool = all {s.pc.get(u) == "join", Free(u),
    val result = s.pc.get(s.joinOf.get(u))
    all {Set("done", "err").contains(result), s' = Go(s, u, result)}}
  action UDispose(u: int): bool = all {
    s.pc.get(u) == "dispose", Free(u),
    val inflight = Classes.filter(c => s.starting.get(c) != 0)
    val taken = Classes.map(c => s.byClass.get(c)).exclude(Set(0))
    s' = Go({...s, registry: if (s.ownsA) "none" else s.registry, types: Set(), byClass: Classes.mapBy(_ => 0),
      services: s.services.exclude(taken), queue: s.queue.set(u, taken), waitSet: s.waitSet.set(u, inflight), running: None}, u, "inflight")
  }
  action UInflight(u: int): bool = all {s.pc.get(u) == "inflight", Free(u),
    s.waitSet.get(u).forall(c => s.starting.get(c) == 0), s' = Go({...s, running: u}, u, "stop")}
  pure def least(ids: Set[int]): int = ids.fold(MaxInst + 1, (best, id) => if (id < best) id else best)
  action UStop(u: int): bool = all {
    s.pc.get(u) == "stop", s.running == u,
    val queued = s.queue.get(u)
    if (queued.size() == 0) s' = Go({...s, failedC: Set()}, u, "finish")
    else {
      val i = least(queued)
      s' = Go({...s, stopCalls: if (s.stopOps.contains(i)) s.stopCalls else s.stopCalls.set(i, s.stopCalls.get(i) + 1),
        stopOps: s.stopOps.union(Set(i)), cur: s.cur.set(u, i), running: None}, u, "stopwait")
    }
  }
  action UStopWait(u: int): bool = all {
    s.pc.get(u) == "stopwait", Free(u),
    val i = s.cur.get(u)
    val base = Go({...s, live: s.live.exclude(Set(i)), queue: s.queue.set(u, s.queue.get(u).exclude(Set(i))), running: u}, u, "stop")
    any {s' = base, all {StopMayFail, s' = {...base, stopFailed: true}}}
  }
  action UFinish(u: int): bool = all {s.pc.get(u) == "finish", s.running == u,
    s' = Go({...s, owned: false, pluginsA: false, tdActive: None, running: None}, u, if (s.stopFailed) "err" else "done")}

  action LCall(l: int): bool = all {s.pc.get(l) == "idle", Free(l),
    s' = Go({...s, running: None}, l, if (s.stopRequested) "done" else "init")}
  action LBegin(l: int): bool = all {
    s.pc.get(l) == "init", Free(l),
    val eligible = s.types.filter(c => s.byClass.get(c) == 0 and s.starting.get(c) == 0
      and (s.failedC.contains(c) implies s.types.forall(x => s.byClass.get(x) == 0)))
    val base = Go({...s, running: None}, l, "done")
    s' = if (s.stopRequested or s.types.size() == 0) base else {...base,
      starting: Classes.mapBy(c => if (eligible.contains(c)) s.nextInst + c - 1 else s.starting.get(c)),
      nextInst: s.nextInst + NumClasses}
  }
  action SDone(c: int): bool = all {
    s.starting.get(c) != 0, Free(c),
    val i = s.starting.get(c)
    val base = {...s, starting: s.starting.set(c, 0), running: None}
    any {
      all {StartMayFail, s' = {...base, failedC: s.failedC.union(Set(c))}},
      if (s.stopRequested or not(s.types.contains(c))) s' = {...base, failedC: s.failedC.union(Set(c)),
        stopCalls: s.stopCalls.set(i, s.stopCalls.get(i) + 1), stopOps: s.stopOps.union(Set(i))}
      else {
        val byClass = s.byClass.set(c, i)
        s' = {...base, failedC: s.failedC.exclude(Set(c)), byClass: byClass,
          services: s.types.map(x => byClass.get(x)).exclude(Set(0)), live: s.live.union(Set(i)),
          registry: "A", lastReg: "A", ownsA: s.owned, ownsB: false}
      }
    }
  }

  action TReq(t: int): bool = all {s.pc.get(t) == "idle", Free(t),
    s' = Go({...s, stopRequested: true, running: None}, t, "drain")}
  action TDrain(t: int): bool = all {s.pc.get(t) == "drain", Free(t), Classes.forall(c => s.starting.get(c) == 0),
    s' = Go({...s, running: t}, t, "svc")}
  action TSvc(t: int): bool = all {
    s.pc.get(t) == "svc", s.running == t,
    val remaining = s.services.exclude(s.visited)
    if (remaining.size() == 0) s' = Go({...s, byClass: Classes.mapBy(_ => 0), running: None}, t, "done")
    else {
      val i = least(remaining)
      s' = Go({...s, visited: s.visited.union(Set(i)), stopCalls: if (s.stopOps.contains(i)) s.stopCalls else s.stopCalls.set(i, s.stopCalls.get(i) + 1),
        stopOps: s.stopOps.union(Set(i)), cur: s.cur.set(t, i), running: None}, t, "svcwait")
    }
  }
  action TSvcWait(t: int): bool = all {s.pc.get(t) == "svcwait", Free(t),
    s' = Go({...s, live: s.live.exclude(Set(s.cur.get(t))), running: t}, t, "svc")}
  action BReg(b: int): bool = all {s.pc.get(b) == "idle", Free(b),
    s' = Go({...s, registry: "B", lastReg: "B", ownsA: false, ownsB: true}, b, "done")}

  action RCall(r: int): bool = all {
    s.pc.get(r) == "idle", Free(r),
    val base = {...s, running: None}
    s' = if (s.stopRequested) Go(base, r, "err")
      else if (s.regActive != None) Go({...base, joinOf: s.joinOf.set(r, s.regActive)}, r, "join")
      else if (s.pluginsA) Go(base, r, "ok")
      else Go({...base, pluginsA: true, regActive: r}, r, "init")
  }
  action RInit(r: int): bool = all {
    s.pc.get(r) == "init", Free(r),
    val base = {...s, regActive: None, running: None}
    any {all {InitMayFail, s' = Go({...base, pluginsA: false}, r, "err")}, s' = Go({...base, owned: true}, r, "ok")}
  }
  action RJoin(r: int): bool = all {s.pc.get(r) == "join", Free(r),
    val result = s.pc.get(s.joinOf.get(r))
    all {Set("ok", "err").contains(result), s' = Go(s, r, result)}}

  val Quiescent = s.running == None and Actors.forall(a => Rest.contains(s.pc.get(a))) and Classes.forall(c => s.starting.get(c) == 0)
  val Finished = Quiescent and Actors.forall(a => s.pc.get(a) != "idle")
  action Unload(u: int): bool = any {UCall(u), UJoin(u), UDispose(u), UInflight(u), UStop(u), UStopWait(u), UFinish(u)}
  action Load(l: int): bool = any {LCall(l), LBegin(l)}
  action Stop(t: int): bool = any {TReq(t), TDrain(t), TSvc(t), TSvcWait(t)}
  action Register(r: int): bool = any {RCall(r), RInit(r), RJoin(r)}
  action Next = any {
    {nondet u = Unloaders.oneOf(); Unload(u)}, {nondet l = Loaders.oneOf(); Load(l)},
    {nondet c = Classes.oneOf(); SDone(c)}, {nondet t = Stoppers.oneOf(); Stop(t)},
    {nondet b = Rivals.oneOf(); BReg(b)}, {nondet r = Registrars.oneOf(); Register(r)},
    all {Finished, s' = s}
  }
  action Stutter = s' = s
  action Step = any {Next, Stutter}
  temporal Fairness = Unloaders.forall(u => Unload(u).weakFair(vars)) and Loaders.forall(l => Load(l).weakFair(vars))
    and Classes.forall(c => SDone(c).weakFair(vars)) and Stoppers.forall(t => Stop(t).weakFair(vars))
    and Rivals.forall(b => BReg(b).weakFair(vars)) and Registrars.forall(r => Register(r).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness

  val TypeOK = all {
    Actors.union(Classes).union(Set(None)).contains(s.running), s.types.subseteq(Classes),
    s.byClass.keys() == Classes, s.starting.keys() == Classes,
    Classes.forall(c => s.byClass.get(c).in(0.to(MaxInst)) and s.starting.get(c).in(0.to(MaxInst))),
    s.failedC.subseteq(Classes), s.services.subseteq(Insts), s.live.subseteq(Insts), s.stopCalls.keys() == Insts,
    Insts.forall(i => s.stopCalls.get(i) >= 0), s.stopOps.subseteq(Insts), Owners.contains(s.registry), Owners.contains(s.lastReg)
  }
  pure val TeardownStates = Set("dispose", "inflight", "stop", "stopwait", "finish")
  val TeardownExclusive = Unloaders.filter(u => TeardownStates.contains(s.pc.get(u))).size() <= 1 and s.disposeCalls <= 1
  val StopAtMostOnce = Insts.forall(i => s.stopCalls.get(i) <= 1)
  val NoOrphanInstance = Quiescent implies s.live.forall(i => s.services.contains(i) and s.types.exists(c => s.byClass.get(c) == i))
  val StopStopsAll = Quiescent and Stoppers.exists(t => s.pc.get(t) == "done") implies s.live.size() == 0
  val ConnectorOwnedByLast = ((s.owned and s.ownsA and s.tdActive == None) implies s.registry == "A")
    and (s.ownsB implies s.registry == "B") and (s.lastReg == "B" implies s.registry == "B")
  val NoOrphanConnector = Quiescent and s.registry == "A" implies s.owned
  val RegisterHonest = Registrars.forall(r => Unloaders.size() == 0 and s.pc.get(r) == "ok" implies s.pluginsA)
  temporal Terminates = eventually(Finished)
}

module CorePluginLifecycle {
  import CorePluginLifecycleTemplate(NumClasses = 2, Unloaders = Set(11,12), Loaders = Set(21),
    Registrars = Set(), Stoppers = Set(31), Rivals = Set(41), StartsInFlight = true,
    InitMayFail = true, StopMayFail = true, StartMayFail = true, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::TeardownExclusive and Model::StopAtMostOnce and Model::NoOrphanInstance
    and Model::StopStopsAll and Model::ConnectorOwnedByLast and Model::NoOrphanConnector and Model::RegisterHonest
  temporal CheckedTemporal = Model::Fairness implies Model::Terminates
  run eagerStartRetiresDuringUnloadTest = init.then(Model::UCall(11)).then(Model::UDispose(11)).then(Model::SDone(1))
    .expect(Model::s.byClass.get(1) == 0 and not(Model::s.live.contains(1)) and safety)
}

module CorePluginLifecycleRegister {
  import CorePluginLifecycleTemplate(NumClasses = 0, Unloaders = Set(), Loaders = Set(),
    Registrars = Set(51,52), Stoppers = Set(), Rivals = Set(), StartsInFlight = false,
    InitMayFail = true, StopMayFail = false, StartMayFail = false, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::TeardownExclusive and Model::StopAtMostOnce and Model::NoOrphanInstance
    and Model::StopStopsAll and Model::ConnectorOwnedByLast and Model::NoOrphanConnector and Model::RegisterHonest
  temporal CheckedTemporal = Model::Fairness implies Model::Terminates
  run registrationJoinsOwnerResultTest = init.then(Model::RCall(51)).then(Model::RCall(52)).then(Model::RInit(51)).then(Model::RJoin(52))
    .expect(Model::s.pc.get(52) == Model::s.pc.get(51) and safety)
}

module CorePluginLifecycleServices {
  import CorePluginLifecycleTemplate(NumClasses = 2, Unloaders = Set(11,12), Loaders = Set(21,22),
    Registrars = Set(), Stoppers = Set(31), Rivals = Set(41), StartsInFlight = false,
    InitMayFail = true, StopMayFail = true, StartMayFail = true, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::TeardownExclusive and Model::StopAtMostOnce and Model::NoOrphanInstance
    and Model::StopStopsAll and Model::ConnectorOwnedByLast and Model::NoOrphanConnector and Model::RegisterHonest
  temporal CheckedTemporal = Model::Fairness implies Model::Terminates
  run laterConnectorSurvivesUnloadTest = init.then(Model::BReg(41)).then(Model::UCall(11)).then(Model::UCall(12)).then(Model::UDispose(11))
    .expect(Model::s.registry == "B" and Model::s.pc.get(12) == "join" and safety)
}
