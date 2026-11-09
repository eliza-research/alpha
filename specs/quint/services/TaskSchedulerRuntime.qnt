/// Current shared daemon with two agent queues and independent process tasks.
module TaskSchedulerRuntime {
  type Registration = {service: int, id: int}
  type Group = {agent: int, rows: List[int]}
  type Tick = {phase: str, generation: int, adapter: int, cohort: int -> Registration,
    service: int, rows: List[int], groups: List[Group]}
  type Process = {exists: bool, aborted: bool, phase: str, returned: bool, calls: int, callsAtAbort: int}
  type State = {generation: int, nextId: int, adapter: int, timer: bool, active: int,
    dirty: Set[int], registry: int -> Registration, stopped: int -> bool, busy: Set[int], ticks: int -> Tick,
    scopeReports: int -> int, queryReports: int -> int, runReports: int -> int,
    processOwners: int -> int, processes: int -> Process, staleDispatch: bool}
  var s: State
  pure val agents = Set(1, 2)
  pure val services = 1.to(3)
  pure val slots = 1.to(3)
  pure val processIds = 1.to(3)
  pure def agentOf(service: int): int = if (service == 2) 2 else 1
  pure def nameOf(process: int): int = if (process == 3) 2 else 1
  pure def agentOfRow(row: int): int = if (row <= 2) 1 else if (row <= 4) 2 else if (row == 5) 0 else 3
  pure val absent = {service: 0, id: 0}
  pure val noCohort = agents.mapBy(_ => absent)
  pure val free = {phase: "free", generation: 0, adapter: 0, cohort: noCohort,
    service: 0, rows: [], groups: []}
  pure val noProcess = {exists: false, aborted: false, phase: "idle", returned: false, calls: 0, callsAtAbort: 0}
  pure val zeroReports = services.mapBy(_ => 0)
  action init = s' = {generation: 0, nextId: 0, adapter: 0, timer: false, active: 0,
    dirty: Set(), registry: noCohort, stopped: services.mapBy(_ => false), busy: Set(), ticks: slots.mapBy(_ => free),
    scopeReports: zeroReports, queryReports: zeroReports, runReports: zeroReports,
    processOwners: agents.mapBy(_ => 0), processes: processIds.mapBy(_ => noProcess), staleDispatch: false}
  pure def hasProcess(owners: int -> int): bool = agents.exists(name => owners.get(name) != 0)
  action startAdapter(adapter: int): bool = all {
    adapter.in(1.to(2)), s.generation < 5,
    s' = if (s.timer and s.adapter == adapter) s else {...s, generation: s.generation + 1,
      adapter: adapter, timer: true, active: 0, dirty: if (s.timer)
        s.dirty.union(agents.filter(agent => s.registry.get(agent) != absent)) else s.dirty}
  }
  action stopDaemon = all {
    s.generation < 5, s' = {...s, generation: s.generation + 1, adapter: 0, active: 0,
      timer: hasProcess(s.processOwners), registry: noCohort, dirty: Set()}
  }
  action registerService(service: int): bool = all {
    services.contains(service), s.adapter != 0, not(s.stopped.get(service)), s.nextId < 6,
    val agent = agentOf(service)
    s' = {...s, registry: s.registry.set(agent, {service: service, id: s.nextId + 1}),
      nextId: s.nextId + 1, dirty: s.dirty.union(Set(agent))}
  }
  action stopService(service: int): bool = all {
    services.contains(service),
    val agent = agentOf(service)
    val owned = s.registry.get(agent).service == service
    s' = {...s, stopped: s.stopped.set(service, true),
      registry: if (owned) s.registry.set(agent, absent) else s.registry,
      dirty: if (owned) s.dirty.exclude(Set(agent)) else s.dirty}
  }
  action markDirty(agent: int): bool = all {agents.contains(agent), s.adapter != 0,
    s' = {...s, dirty: s.dirty.union(Set(agent))}}
  pure def queueProcesses(state: State): State = {...state, processes: processIds.mapBy(id => {
    val process = state.processes.get(id)
    if (state.processOwners.get(nameOf(id)) == id and process.phase == "idle") {...process, phase: "queued"}
    else process
  })}
  action fireTick(slot: int): bool = all {
    s.timer, slots.contains(slot),
    val withProcesses = queueProcesses(s)
    if (s.adapter == 0 or s.active != 0) s' = withProcesses
    else {
      val taken = s.dirty.filter(agent => not(s.busy.contains(s.registry.get(agent).service)))
      val captured = taken.filter(agent => s.registry.get(agent) != absent)
      val afterCapture = {...withProcesses, dirty: s.dirty.exclude(taken)}
      if (captured.size() == 0) s' = afterCapture
      else all {
        s.ticks.get(slot).phase == "free",
        s' = {...afterCapture, active: slot, ticks: s.ticks.set(slot, {...free, phase: "query",
          generation: s.generation, adapter: s.adapter,
          cohort: agents.mapBy(agent => if (captured.contains(agent)) s.registry.get(agent) else absent)})}
      }
    }
  }
  pure def current(state: State, tick: Tick, agent: int): bool = tick.generation == state.generation
    and tick.cohort.get(agent) != absent and state.registry.get(agent) == tick.cohort.get(agent)
  pure def settle(state: State, slot: int): State = {...state, ticks: state.ticks.set(slot, free),
    active: if (state.active == slot) 0 else state.active}
  pure def addReports(reports: int -> int, owners: Set[int], count: int): int -> int = services.mapBy(service =>
    if (owners.contains(service)) min(reports.get(service) + count, 40) else reports.get(service))
  pure def min(left: int, right: int): int = if (left < right) left else right
  pure def owners(state: State, tick: Tick): Set[int] = agents.filter(agent => current(state, tick, agent))
    .map(agent => tick.cohort.get(agent).service)
  action queryFailure(slot: int): bool = all {
    slots.contains(slot), s.ticks.get(slot).phase == "query",
    val tick = s.ticks.get(slot)
    val rearm = agents.filter(agent => current(s, tick, agent))
    s' = settle({...s, dirty: s.dirty.union(rearm), queryReports: addReports(s.queryReports, owners(s, tick), 1)}, slot)
  }
  pure def groupRows(rows: List[int]): List[Group] = if (rows.length() == 0) [] else {
    val first = agentOfRow(rows.nth(0))
    val otherRows = rows.select(row => agentOfRow(row) != first)
    val grouped = [{agent: first, rows: rows.select(row => agentOfRow(row) == first)}]
    if (otherRows.length() == 0) grouped else grouped.append({agent: agentOfRow(otherRows.nth(0)), rows: otherRows})
  }
  pure def advance(state: State, slot: int, groups: List[Group]): State = {
    val tick = state.ticks.get(slot)
    val currentGroups = groups.select(group => current(state, tick, group.agent))
    if (currentGroups.length() == 0) settle(state, slot) else {
      val group = currentGroups.nth(0)
      val service = tick.cohort.get(group.agent).service
      {...state, busy: state.busy.union(Set(service)),
        staleDispatch: state.staleDispatch or not(current(state, tick, group.agent)) or state.stopped.get(service),
        ticks: state.ticks.set(slot, {...tick, phase: "running", service: service, rows: group.rows, groups: currentGroups.tail()})}
    }
  }
  action queryRows(slot: int, rows: List[int]): bool = all {
    slots.contains(slot), s.ticks.get(slot).phase == "query", rows.length() <= 6,
    rows.indices().forall(index => rows.nth(index).in(1.to(6))),
    val tick = s.ticks.get(slot)
    if (tick.generation != s.generation) s' = settle(s, slot) else {
      val scoped = rows.select(row => if (agents.contains(agentOfRow(row))) tick.cohort.get(agentOfRow(row)) != absent else false)
      val accepted = scoped.select(row => current(s, tick, agentOfRow(row)))
      val outOfScope = rows.length() - scoped.length()
      s' = advance({...s, scopeReports: addReports(s.scopeReports, owners(s, tick), outOfScope)}, slot, groupRows(accepted))
    }
  }
  action finishGroup(slot: int, failed: bool): bool = all {
    slots.contains(slot), s.ticks.get(slot).phase == "running",
    val tick = s.ticks.get(slot)
    val agent = agentOf(tick.service)
    s' = advance({...s, busy: s.busy.exclude(Set(tick.service)),
      dirty: if (current(s, tick, agent)) s.dirty.union(Set(agent)) else s.dirty,
      runReports: addReports(s.runReports, Set(tick.service), if (failed) 1 else 0)}, slot, tick.groups)
  }
  action registerProcess(id: int): bool = all {
    processIds.contains(id), not(s.processes.get(id).exists), s.processOwners.get(nameOf(id)) == 0,
    s' = {...s, timer: true, processOwners: s.processOwners.set(nameOf(id), id),
      processes: s.processes.set(id, {...noProcess, exists: true})}
  }
  action disposeProcess(id: int): bool = all {
    processIds.contains(id), s.processes.get(id).exists,
    val process = s.processes.get(id)
    val retained = if (s.processOwners.get(nameOf(id)) == id) s.processOwners.set(nameOf(id), 0) else s.processOwners
    s' = {...s, processOwners: retained, timer: s.adapter != 0 or hasProcess(retained),
      processes: s.processes.set(id, {...process, aborted: true, callsAtAbort: process.calls})}
  }
  action enterProcess(id: int): bool = all {
    processIds.contains(id), s.processes.get(id).phase == "queued",
    val process = s.processes.get(id)
    s' = {...s, processes: s.processes.set(id, if (process.aborted) {...process, phase: "idle"}
      else {...process, phase: "running", calls: min(process.calls + 1, 40)})}
  }
  action finishProcess(id: int): bool = all {
    processIds.contains(id), s.processes.get(id).phase == "running",
    s' = {...s, processes: s.processes.set(id, {...s.processes.get(id), phase: "idle"})}
  }
  action disposerReturned(id: int): bool = all {
    processIds.contains(id), s.processes.get(id).aborted, s.processes.get(id).phase == "idle",
    s' = {...s, processes: s.processes.set(id, {...s.processes.get(id), returned: true})}
  }
  val TickPhase = slots.mapBy(slot => s.ticks.get(slot).phase)
  val TickGeneration = slots.mapBy(slot => s.ticks.get(slot).generation)
  val TickAdapter = slots.mapBy(slot => s.ticks.get(slot).adapter)
  val TickCohort = slots.mapBy(slot => s.ticks.get(slot).cohort)
  val TickService = slots.mapBy(slot => s.ticks.get(slot).service)
  val TickRows = slots.mapBy(slot => s.ticks.get(slot).rows)
  val ProcessExists = processIds.mapBy(id => s.processes.get(id).exists)
  val ProcessAborted = processIds.mapBy(id => s.processes.get(id).aborted)
  val ProcessActive = processIds.mapBy(id => s.processes.get(id).phase != "idle")
  val ProcessReturned = processIds.mapBy(id => s.processes.get(id).returned)
  val ProcessCalls = processIds.mapBy(id => s.processes.get(id).calls)
  val SharedTimerOwned = s.timer == (s.adapter != 0 or hasProcess(s.processOwners))
  val AttachedTickCurrent = if (s.active == 0) true else s.adapter != 0 and
    s.ticks.get(s.active).phase != "free" and s.ticks.get(s.active).generation == s.generation
    and s.ticks.get(s.active).adapter == s.adapter
  val BusyOwnersExact = s.busy == slots.filter(slot => s.ticks.get(slot).phase == "running").map(slot => s.ticks.get(slot).service)
    and services.forall(service => slots.filter(slot => s.ticks.get(slot).phase == "running" and s.ticks.get(slot).service == service).size() <= 1)
  val CurrentRegistrationsOwnAgents = agents.forall(agent => if (s.registry.get(agent) == absent) true else
    agentOf(s.registry.get(agent).service) == agent and not(s.stopped.get(s.registry.get(agent).service)))
  val DeliveredRowsInCohort = slots.forall(slot => {
    val tick = s.ticks.get(slot)
    tick.phase == "running" implies tick.cohort.get(agentOf(tick.service)).service == tick.service and
      tick.rows.indices().forall(index => agentOfRow(tick.rows.nth(index)) == agentOf(tick.service))
  })
  val NoStaleDispatch = not(s.staleDispatch)
  val ProcessOwnerPreserved = processIds.forall(id => {
    val process = s.processes.get(id)
    (s.processOwners.get(nameOf(id)) == id) == (process.exists and not(process.aborted))
  })
  val RetiredProcessCannotStart = processIds.forall(id => {
    val process = s.processes.get(id)
    (process.aborted implies process.calls == process.callsAtAbort) and
      (process.returned implies process.aborted and process.phase == "idle")
  })
  val safety = SharedTimerOwned and AttachedTickCurrent and BusyOwnersExact and CurrentRegistrationsOwnAgents
    and DeliveredRowsInCohort and NoStaleDispatch and ProcessOwnerPreserved and RetiredProcessCannotStart
  action step = any {
    startAdapter(1), startAdapter(2), stopDaemon, markDirty(1), markDirty(2),
    {nondet service = services.oneOf(); any {registerService(service), stopService(service)}},
    {nondet slot = slots.oneOf(); any {fireTick(slot), queryFailure(slot), queryRows(slot, []), queryRows(slot, [3, 5, 2, 1, 6]),
      queryRows(slot, [1, 4]), queryRows(slot, [1]), queryRows(slot, [3]), finishGroup(slot, false), finishGroup(slot, true)}},
    {nondet id = processIds.oneOf(); any {registerProcess(id), disposeProcess(id), enterProcess(id), finishProcess(id), disposerReturned(id)}},
    s' = s
  }
  run mixedScopeBatchesInOrderTest = init.then(startAdapter(1)).then(registerService(1)).then(registerService(2))
    .then(fireTick(1)).then(queryRows(1, [3, 5, 2, 1, 6]))
    .expect(s.ticks.get(1).service == 2 and s.scopeReports.get(1) == 2 and s.scopeReports.get(2) == 2 and safety)
    .then(finishGroup(1, false)).expect(s.ticks.get(1).rows == [2, 1] and s.ticks.get(1).service == 1 and safety)
  run changedRegistrationRetiresQueuedGroupTest = init.then(startAdapter(1)).then(registerService(1)).then(registerService(2))
    .then(fireTick(1)).then(queryRows(1, [3, 1])).then(registerService(3)).then(finishGroup(1, false))
    .expect(s.active == 0 and s.dirty.contains(1) and s.busy == Set() and safety)
  run restartSkipsDetachedBusyServiceTest = init.then(startAdapter(1)).then(registerService(1)).then(registerService(2))
    .then(fireTick(1)).then(queryRows(1, [1, 3])).then(stopDaemon).then(startAdapter(2))
    .then(registerService(1)).then(registerService(2)).then(fireTick(2))
    .expect(s.ticks.get(2).cohort.get(1) == absent and s.ticks.get(2).cohort.get(2).service == 2 and s.dirty.contains(1) and safety)
  run oldProcessDisposalKeepsReplacementTest = init.then(registerProcess(1)).then(fireTick(1)).then(enterProcess(1))
    .then(disposeProcess(1)).then(registerProcess(2)).then(fireTick(1)).then(enterProcess(2))
    .then(finishProcess(1)).then(disposerReturned(1)).then(disposeProcess(1))
    .expect(s.timer and s.processOwners.get(1) == 2 and s.processes.get(2).phase == "running" and safety)
  run disposedQueuedProcessNeverEntersTest = init.then(registerProcess(1)).then(fireTick(1)).then(disposeProcess(1))
    .then(enterProcess(1)).then(disposerReturned(1)).expect(s.processes.get(1).calls == 0 and not(s.timer) and safety)
  run stoppingDaemonKeepsProcessTimerTest = init.then(startAdapter(1)).then(registerProcess(1)).then(stopDaemon)
    .then(fireTick(1)).then(enterProcess(1)).expect(s.timer and s.adapter == 0 and s.processes.get(1).calls == 1 and safety)
}
