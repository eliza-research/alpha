// Literal conversion of packages/core/tla/ProviderExecution.tla at 4787d51a142.
module CoreProviderExecutionTemplate {
  const Callers: Set[str]
  const Signalled: Set[str]
  const Keyed: Set[str]
  const MaxExec: int
  pure val Execs = 1.to(MaxExec)
  pure val Causes = Set("none", "waiters", "stop")
  type State = {map: int, active: Set[int], created: Set[int], waiters: int -> int,
    cause: int -> str, settled: int -> bool, cleaned: int -> bool, exec: str -> int,
    pc: str -> str, sigAborted: str -> bool, stopping: bool, stopped: bool}
  var s: State
  val vars = s
  def Attached(e: int): Set[str] = Callers.filter(c => s.pc.get(c) == "attached" and s.exec.get(c) == e)
  val TypeOK = s.map.in(Execs.union(Set(0))) and s.active.subseteq(Execs) and s.created.subseteq(Execs)
    and s.waiters.keys() == Execs and s.cause.keys() == Execs and s.settled.keys() == Execs and s.cleaned.keys() == Execs
    and s.exec.keys() == Callers and s.pc.keys() == Callers and s.sigAborted.keys() == Callers
    and Execs.forall(e => s.waiters.get(e) >= 0 and s.cause.get(e).in(Causes))
    and Callers.forall(c => s.exec.get(c).in(Execs.union(Set(0))) and s.pc.get(c).in(Set("idle", "attached", "done")))
  pure val initial = {map: 0, active: Set(), created: Set(), waiters: Execs.mapBy(_ => 0),
    cause: Execs.mapBy(_ => "none"), settled: Execs.mapBy(_ => false), cleaned: Execs.mapBy(_ => false),
    exec: Callers.mapBy(_ => 0), pc: Callers.mapBy(_ => "idle"), sigAborted: Callers.mapBy(_ => false),
    stopping: false, stopped: false}
  action Init = s' = initial
  val Initial = s == initial
  val Fresh = s.created.size() + 1
  action Attach(c: str): bool = all {
    s.pc.get(c) == "idle", s.created.size() < MaxExec or (c.in(Keyed) and s.map != 0),
    val coalesced = c.in(Keyed) and s.map != 0
    val e = if (coalesced) s.map else Fresh
    val map1 = if (not(coalesced) and c.in(Keyed)) e else s.map
    val cause1 = if (not(coalesced) and s.stopping) "stop" else s.cause.get(e)
    val leaves = c.in(Signalled) and s.sigAborted.get(c)
    val w = s.waiters.get(e) + (if (leaves) 0 else 1)
    val lastLeaves = leaves and w == 0
    s' = {...s, created: s.created.union(Set(e)), active: if (coalesced) s.active else s.active.union(Set(e)),
      waiters: s.waiters.set(e, w), cause: s.cause.set(e, if (lastLeaves and cause1 == "none") "waiters" else cause1),
      map: if (lastLeaves and map1 == e) 0 else map1, exec: s.exec.set(c, e),
      pc: s.pc.set(c, if (leaves) "done" else "attached")}
  }
  action AbortSignal(c: str): bool = all {
    c.in(Signalled), not(s.sigAborted.get(c)),
    val marked = {...s, sigAborted: s.sigAborted.set(c, true)}
    if (s.pc.get(c) == "attached") {
      val e = s.exec.get(c)
      val lastLeaves = s.waiters.get(e) == 1
      s' = {...marked, waiters: s.waiters.set(e, s.waiters.get(e) - 1), pc: s.pc.set(c, "done"),
        map: if (lastLeaves and s.map == e) 0 else s.map,
        cause: if (lastLeaves and s.cause.get(e) == "none") s.cause.set(e, "waiters") else s.cause}
    } else s' = marked
  }
  action SettleWork(e: int): bool = all {
    e.in(s.created), not(s.settled.get(e)), s' = {...s, settled: s.settled.set(e, true)}
  }
  action SettleAborted(e: int): bool = all {s.cause.get(e) != "none", SettleWork(e)}
  action Cleanup(e: int): bool = all {
    s.settled.get(e), not(s.cleaned.get(e)),
    s' = {...s, cleaned: s.cleaned.set(e, true), active: s.active.exclude(Set(e)), map: if (s.map == e) 0 else s.map}
  }
  action CallerSettle(c: str): bool = all {
    s.pc.get(c) == "attached",
    val e = s.exec.get(c)
    all {s.settled.get(e), s.cleaned.get(e),
      s' = {...s, waiters: s.waiters.set(e, s.waiters.get(e) - 1), pc: s.pc.set(c, "done")}}
  }
  action RequestStop = all {not(s.stopping), s' = {...s, stopping: true}}
  action StopComposer = all {
    s.stopping, not(s.stopped),
    s' = {...s, stopped: true, active: Set(), map: 0,
      cause: Execs.mapBy(e => if (e.in(s.active) and s.cause.get(e) == "none") "stop" else s.cause.get(e))}
  }
  val Finished = Callers.forall(c => s.pc.get(c) == "done") and s.created.forall(e => s.cleaned.get(e)) and s.stopped
  action Next = any {
    nondet c = Callers.oneOf()
    any {Attach(c), AbortSignal(c), CallerSettle(c)},
    nondet e = Execs.oneOf()
    any {SettleWork(e), SettleAborted(e), Cleanup(e)},
    RequestStop, StopComposer, all {Finished, s' = s}
  }
  action Step = any {Next, s' = s}
  temporal Fairness = Execs.forall(e => SettleAborted(e).weakFair(vars) and Cleanup(e).weakFair(vars))
    and Callers.forall(c => CallerSettle(c).weakFair(vars)) and StopComposer.weakFair(vars)
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  val WaiterCount = s.created.forall(e => s.waiters.get(e) == Attached(e).size())
  val AbortOnlyWhenUnwanted = s.created.forall(e =>
    (s.cause.get(e) == "waiters" implies Attached(e) == Set()) and (s.cause.get(e) == "stop" implies s.stopping))
  val UnwantedWorkAborted = s.created.forall(e => (not(s.settled.get(e)) and s.waiters.get(e) == 0) implies s.cause.get(e) != "none")
  val NoJoinAborting = if (s.map == 0) true else s.cause.get(s.map) == "none" or (s.cause.get(s.map) == "stop" and s.stopping)
  val StopReachesAll = s.stopped implies s.created.forall(e => not(s.settled.get(e)) implies s.cause.get(e) != "none")
  val MapActive = s.map != 0 implies s.map.in(s.active)
  temporal AbortedCallerLeaves = Callers.forall(c =>
    (if (s.pc.get(c) == "attached") s.cause.get(s.exec.get(c)) != "none" else false).leadsTo(s.pc.get(c) == "done"))
  temporal StopReleasesCallers = Callers.forall(c => (s.pc.get(c) == "attached" and s.stopped).leadsTo(s.pc.get(c) == "done"))
  val Safety = TypeOK and WaiterCount and AbortOnlyWhenUnwanted and UnwantedWorkAborted and NoJoinAborting and StopReachesAll and MapActive
}

module CoreProviderExecution {
  import CoreProviderExecutionTemplate(Callers = Set("a", "b", "c"), Signalled = Set("a", "b"), Keyed = Set("a", "b", "c"), MaxExec = 3) as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::Safety
  val observed = M::s
  action Attach(c) = M::Attach(c)
  action AbortSignal(c) = M::AbortSignal(c)
  action SettleWork(e) = M::SettleWork(e)
  action SettleAborted(e) = M::SettleAborted(e)
  action Cleanup(e) = M::Cleanup(e)
  action CallerSettle(c) = M::CallerSettle(c)
  action RequestStop = M::RequestStop
  action StopComposer = M::StopComposer
  temporal CheckedTemporal = M::Fairness implies (M::AbortedCallerLeaves and M::StopReleasesCallers)
  run lastCallerRetiresExecutionTest = init.then(M::Attach("a")).then(M::Attach("b")).then(M::AbortSignal("a"))
    .expect(safety and M::s.waiters.get(1) == 1 and M::s.cause.get(1) == "none")
    .then(M::AbortSignal("b")).then(M::Attach("c")).then(M::SettleAborted(1)).then(M::Cleanup(1))
    .expect(safety and M::s.map == 2 and M::s.cause.get(1) == "waiters")
  run stopSettlesSignallessCallerTest = init.then(M::Attach("c")).then(M::RequestStop).then(M::StopComposer)
    .then(M::SettleAborted(1)).then(M::Cleanup(1)).then(M::CallerSettle("c")).expect(safety and M::s.pc.get("c") == "done")
}

module CoreProviderExecutionOneoff {
  import CoreProviderExecutionTemplate(Callers = Set("a", "b", "c"), Signalled = Set("a", "c"), Keyed = Set("a", "b"), MaxExec = 3) as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::Safety
  val observed = M::s
  action Attach(c) = M::Attach(c)
  action AbortSignal(c) = M::AbortSignal(c)
  action SettleWork(e) = M::SettleWork(e)
  action SettleAborted(e) = M::SettleAborted(e)
  action Cleanup(e) = M::Cleanup(e)
  action CallerSettle(c) = M::CallerSettle(c)
  action RequestStop = M::RequestStop
  action StopComposer = M::StopComposer
  temporal CheckedTemporal = M::Fairness implies (M::AbortedCallerLeaves and M::StopReleasesCallers)
  run independentExecutionTest = init.then(M::Attach("a")).then(M::Attach("c")).then(M::AbortSignal("c"))
    .then(M::Attach("b")).expect(safety and M::s.map == 1 and M::s.waiters.get(1) == 2 and M::s.cause.get(2) == "waiters")
  run preCancelledOneoffTest = init.then(M::AbortSignal("c")).then(M::Attach("c"))
    .expect(safety and M::s.pc.get("c") == "done" and M::s.cause.get(1) == "waiters")
}
