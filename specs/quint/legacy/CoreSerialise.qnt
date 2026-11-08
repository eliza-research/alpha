// Literal conversion of packages/core/tla/Serialise.tla at 4787d51a142.
module CoreSerialiseTemplate {
  const Calls: Set[str]
  type State = {chain: List[str], pc: str -> str, outcome: str -> str}
  var s: State
  val vars = s
  pure val initial = {chain: [], pc: Calls.mapBy(_ => "idle"), outcome: Calls.mapBy(_ => "none")}
  action Init = s' = initial
  val Initial = s == initial
  def Pos(c: str): int = s.chain.indices().fold(0, (position, i) => if (s.chain.nth(i) == c) i + 1 else position)
  val TypeOK = s.chain.indices().forall(i => s.chain.nth(i).in(Calls))
    and s.pc.keys() == Calls and s.outcome.keys() == Calls
    and Calls.forall(c => s.pc.get(c).in(Set("idle", "queued", "running", "done"))
      and s.outcome.get(c).in(Set("none", "ok", "threw")))
  action Invoke(c: str): bool = all {
    s.pc.get(c) == "idle", s' = {...s, chain: s.chain.append(c), pc: s.pc.set(c, "queued")}
  }
  action Start(c: str): bool = all {
    s.pc.get(c) == "queued",
    if (Pos(c) <= 1) true else s.pc.get(s.chain.nth(Pos(c) - 2)) == "done",
    s' = {...s, pc: s.pc.set(c, "running")}
  }
  action FinishAs(c: str, outcome: str): bool = all {
    s.pc.get(c) == "running", outcome.in(Set("ok", "threw")),
    s' = {...s, pc: s.pc.set(c, "done"), outcome: s.outcome.set(c, outcome)}
  }
  action Finish(c: str): bool = {
    nondet outcome = Set("ok", "threw").oneOf()
    FinishAs(c, outcome)
  }
  val Finished = Calls.forall(c => s.pc.get(c) == "done")
  action Next = any {
    nondet c = Calls.oneOf()
    any {Invoke(c), Start(c), Finish(c)},
    all {Finished, s' = s}
  }
  action Step = any {Next, s' = s}
  temporal Fairness = Calls.forall(c => Start(c).weakFair(vars) and Finish(c).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  val MutualExclusion = Calls.filter(c => s.pc.get(c) == "running").size() <= 1
  val CallOrder = s.chain.indices().forall(i => s.chain.indices().forall(j =>
    (i < j and s.pc.get(s.chain.nth(j)).in(Set("running", "done"))) implies s.pc.get(s.chain.nth(i)) == "done"))
  temporal CallFinishes = Calls.forall(c => (s.pc.get(c) == "queued").leadsTo(s.pc.get(c) == "done"))
  temporal DeadlockFree = always(enabled(Next))
}

module CoreSerialise {
  import CoreSerialiseTemplate(Calls = Set("a", "b", "c", "d")) as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::TypeOK and M::MutualExclusion and M::CallOrder
  temporal DeadlockFree = M::DeadlockFree
  temporal CheckedTemporal = M::Fairness implies M::CallFinishes
  val state = M::s
  action invoke(caller: str): bool = M::Invoke(caller)
  action start(caller: str): bool = M::Start(caller)
  action finish(caller: str, outcome: str): bool = M::FinishAs(caller, outcome)
  run rejectionReleasesNextTest = init.then(M::Invoke("a")).then(M::Invoke("b")).then(M::Start("a"))
    .then(M::FinishAs("a", "threw")).then(M::Start("b")).then(M::FinishAs("b", "ok")).expect(safety)
  run arrivalOrderTest = init.then(M::Invoke("d")).then(M::Invoke("a")).then(M::Start("d"))
    .expect(safety and M::s.pc.get("a") == "queued").then(M::Start("a").fail())
}
