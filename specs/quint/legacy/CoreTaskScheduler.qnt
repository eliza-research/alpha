// Literal upstream TaskScheduler at 4787d51a142c. Model values are distinct
// integers. The heterogeneous absent registry value is the id-zero entry.
module CoreTaskSchedulerTemplate {
  const Services: Set[int]
  const Adapters: Set[int]
  const Ticks: Set[int]
  const MaxRestarts: int
  const MaxRegs: int
  const QueryCanFail: bool
  const None: int

  type Entry = {svc: int, id: int}
  type Tick = {pc: str, gen: int, id: int, svc: int}
  type State = {registry: Entry, nextId: int, dirty: bool, timer: bool, adapter: int,
    activeTick: int, gen: int, tk: int -> Tick, inRun: int -> int, stopped: int -> bool,
    busy: Set[int], stale: bool, restarts: int, regs: int, taken: int}
  var s: State
  val vars = s
  pure val MaxGen = MaxRestarts + 1
  pure val TickPcs = Set("free", "query", "run", "after")
  pure val Entries = Services.fold(Set(), (entries, svc) =>
    entries.union(1.to(MaxRegs).map(id => {svc: svc, id: id})))
  pure val NoEntry = {svc: None, id: 0}
  pure val FreeTick = {pc: "free", gen: 0, id: 0, svc: None}
  pure val InitialState = {registry: NoEntry, nextId: 0, dirty: false, timer: false,
    adapter: None, activeTick: None, gen: 0, tk: Ticks.mapBy(_ => FreeTick),
    inRun: Services.mapBy(_ => 0), stopped: Services.mapBy(_ => false), busy: Set(),
    stale: false, restarts: 0, regs: 0, taken: None}
  val Initial = s == InitialState
  action Init = s' = InitialState

  pure def Marks(after: State, previousTaken: int): State = {
    ...after, taken: if (after.dirty) None else previousTaken}
  def Current(k: int): bool = s.tk.get(k).gen == s.gen and s.registry != NoEntry and s.registry.id == s.tk.get(k).id
  pure def Settle(state: State, k: int): State = {...state, tk: state.tk.set(k, FreeTick),
    activeTick: if (state.activeTick == k) None else state.activeTick}

  action Fire(k: int): bool = all {
    s.timer, s.adapter != None, s.activeTick == None, s.tk.get(k).pc == "free",
    val take = s.dirty and s.registry != NoEntry and not(s.busy.contains(s.registry.svc))
    s' = {...s,
      dirty: if (s.registry != NoEntry and not(take)) s.dirty else false,
      tk: if (take) s.tk.set(k, {pc: "query", gen: s.gen, id: s.registry.id, svc: s.registry.svc}) else s.tk,
      activeTick: if (take) k else s.activeTick,
      taken: if (take) s.registry.svc else s.taken}
  }
  // Deterministic witnesses for the four original Query branches. Query
  // remains their union; source traces choose the branch they observed.
  action QueryFailure(k: int): bool = all {
    s.tk.get(k).pc == "query", QueryCanFail,
    s' = Marks(Settle({...s, dirty: s.dirty or Current(k)}, k), s.taken)
  }
  action QueryStale(k: int): bool = all {
    s.tk.get(k).pc == "query", not(Current(k)), s' = Marks(Settle(s, k), s.taken)
  }
  action QueryEmpty(k: int): bool = all {
    s.tk.get(k).pc == "query", Current(k), s' = Marks(Settle(s, k), s.taken)
  }
  action QueryRows(k: int): bool = all {
    s.tk.get(k).pc == "query", Current(k),
    val service = s.tk.get(k).svc
    s' = Marks({...s,
      stale: s.stale or s.tk.get(k).gen != s.gen or s.registry.id != s.tk.get(k).id,
      tk: s.tk.set(k, {...s.tk.get(k), pc: if (s.stopped.get(service)) "after" else "run"}),
      inRun: if (s.stopped.get(service)) s.inRun else s.inRun.set(service, s.inRun.get(service) + 1),
      busy: s.busy.union(Set(service))}, s.taken)
  }
  action Query(k: int): bool = any {QueryFailure(k), QueryStale(k), QueryEmpty(k), QueryRows(k)}
  action RunDone(k: int): bool = all {
    Set("run", "after").contains(s.tk.get(k).pc),
    val service = s.tk.get(k).svc
    s' = Marks(Settle({...s,
      inRun: if (s.tk.get(k).pc == "run") s.inRun.set(service, s.inRun.get(service) - 1) else s.inRun,
      busy: s.busy.exclude(Set(service)), dirty: s.dirty or Current(k)}, k), s.taken)
  }
  action Start(a: int): bool = all {
    s.restarts < MaxRestarts, not(s.timer and s.adapter == a),
    s' = Marks({...s, gen: s.gen + 1, adapter: a, activeTick: None, timer: true,
      dirty: if (s.timer) s.dirty or s.registry != NoEntry else s.dirty,
      restarts: s.restarts + 1}, s.taken)
  }
  action Stop = all {
    s.restarts < MaxRestarts,
    s' = {...s, gen: s.gen + 1, timer: false, registry: NoEntry, dirty: false,
      adapter: None, activeTick: None, restarts: s.restarts + 1}
  }
  action Register(service: int): bool = all {
    not(s.stopped.get(service)), s.adapter != None, s.regs < MaxRegs,
    s' = {...s, nextId: s.nextId + 1, registry: {svc: service, id: s.nextId + 1},
      dirty: true, regs: s.regs + 1, taken: None}
  }
  action StopService(service: int): bool = all {
    not(s.stopped.get(service)),
    val owned = s.registry != NoEntry and s.registry.svc == service
    s' = {...s, stopped: s.stopped.set(service, true),
      registry: if (owned) NoEntry else s.registry, dirty: if (owned) false else s.dirty}
  }
  action MarkDirty = all {not(s.dirty), s' = {...s, dirty: true, taken: None}}

  val Finished = Ticks.forall(k => s.tk.get(k).pc == "free")
  action FireAny = {nondet k = Ticks.oneOf(); Fire(k)}
  action Next = any {
    {nondet k = Ticks.oneOf(); any {Fire(k), Query(k), RunDone(k)}},
    {nondet a = Adapters.oneOf(); Start(a)}, Stop,
    {nondet service = Services.oneOf(); any {Register(service), StopService(service)}},
    MarkDirty, all {Finished, s' = s}
  }
  action Stutter = s' = s
  action Step = any {Next, Stutter}
  temporal Fairness = FireAny.weakFair(vars)
    and Ticks.forall(k => Query(k).weakFair(vars) and RunDone(k).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness

  val TypeOK = all {
    Entries.union(Set(NoEntry)).contains(s.registry), s.nextId.in(0.to(MaxRegs)),
    Adapters.union(Set(None)).contains(s.adapter), Ticks.union(Set(None)).contains(s.activeTick),
    s.gen.in(0.to(MaxGen)), s.tk.keys() == Ticks, s.inRun.keys() == Services, s.stopped.keys() == Services,
    Ticks.forall(k => TickPcs.contains(s.tk.get(k).pc) and s.tk.get(k).gen.in(0.to(MaxGen))
      and s.tk.get(k).id.in(0.to(MaxRegs)) and Services.union(Set(None)).contains(s.tk.get(k).svc)),
    Services.forall(service => s.inRun.get(service).in(0.to(Ticks.size()))), s.busy.subseteq(Services),
    s.restarts.in(0.to(MaxRestarts)), s.regs.in(0.to(MaxRegs)), Services.union(Set(None)).contains(s.taken)
  }
  val NoStaleDispatch = not(s.stale)
  val OneRunTickPerService = Services.forall(service => s.inRun.get(service) <= 1)
  val AttachedTickCurrent = if (s.activeTick == None) true else s.tk.get(s.activeTick).gen == s.gen
  val TakenClearsDirty = s.taken != None implies not(s.dirty)
  temporal DirtyServed = Services.forall(service =>
    (s.dirty and s.timer and s.adapter != None and s.registry != NoEntry and s.registry.svc == service
      and not(s.stopped.get(service))).leadsTo(
      s.taken == service or s.registry == NoEntry or s.registry.svc != service or s.adapter == None or s.stopped.get(service)))
  temporal TickSettles = Ticks.forall(k => (s.tk.get(k).pc == "query").leadsTo(s.tk.get(k).pc == "free"))
}

module CoreTaskScheduler {
  import CoreTaskSchedulerTemplate(Services = Set(1, 2), Adapters = Set(3, 4), Ticks = Set(5, 6, 7),
    MaxRestarts = 2, MaxRegs = 2, QueryCanFail = false, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val observed = Model::s
  action startAdapter(a: int): bool = Model::Start(a)
  action stopDaemon = Model::Stop
  action registerService(service: int): bool = Model::Register(service)
  action stopService(service: int): bool = Model::StopService(service)
  action markDirty = Model::MarkDirty
  action fireTick(k: int): bool = Model::Fire(k)
  action queryFailure(k: int): bool = Model::QueryFailure(k)
  action queryStale(k: int): bool = Model::QueryStale(k)
  action queryEmpty(k: int): bool = Model::QueryEmpty(k)
  action queryRows(k: int): bool = Model::QueryRows(k)
  action runDone(k: int): bool = Model::RunDone(k)
  val safety = Model::TypeOK and Model::NoStaleDispatch and Model::OneRunTickPerService
    and Model::AttachedTickCurrent and Model::TakenClearsDirty
  temporal CheckedTemporal = Model::Fairness implies Model::DirtyServed and Model::TickSettles
  run registrationDirtyTakenTest = init.then(Model::Start(3)).then(Model::Register(1)).then(Model::Fire(5))
    .expect(Model::s.taken == 1 and not(Model::s.dirty) and safety)
  run detachedQueryCannotDispatchTest = init.then(Model::Start(3)).then(Model::Register(1)).then(Model::Fire(5))
    .then(Model::Start(4)).then(Model::Query(5)).expect(Model::s.tk.get(5).pc == "free" and safety)
}

module CoreTaskSchedulerRestart {
  import CoreTaskSchedulerTemplate(Services = Set(1, 2), Adapters = Set(3, 4), Ticks = Set(5, 6, 7),
    MaxRestarts = 2, MaxRegs = 2, QueryCanFail = true, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val observed = Model::s
  action startAdapter(a: int): bool = Model::Start(a)
  action stopDaemon = Model::Stop
  action registerService(service: int): bool = Model::Register(service)
  action stopService(service: int): bool = Model::StopService(service)
  action markDirty = Model::MarkDirty
  action fireTick(k: int): bool = Model::Fire(k)
  action queryFailure(k: int): bool = Model::QueryFailure(k)
  action queryStale(k: int): bool = Model::QueryStale(k)
  action queryEmpty(k: int): bool = Model::QueryEmpty(k)
  action queryRows(k: int): bool = Model::QueryRows(k)
  action runDone(k: int): bool = Model::RunDone(k)
  val safety = Model::TypeOK and Model::NoStaleDispatch and Model::OneRunTickPerService
    and Model::AttachedTickCurrent and Model::TakenClearsDirty
  run stoppingOldServicePreservesReplacementTest = init.then(Model::Start(3)).then(Model::Register(1))
    .then(Model::Register(2)).then(Model::StopService(1)).expect(Model::s.registry.svc == 2 and safety)
}
