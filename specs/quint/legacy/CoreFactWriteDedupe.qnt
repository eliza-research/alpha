// Literal conversion of packages/core/tla/FactWriteDedupe.tla at 4787d51a142.
module CoreFactWriteDedupeTemplate {
  const Writers: Set[str]
  const Prefilled: bool
  const Serialised: bool
  const Seed: str
  type State = {rows: List[Set[str]], pc: str -> str, seen: str -> Set[str], owner: str}
  var s: State
  val vars = s
  pure val initial = {rows: if (Prefilled) [Set(Seed)] else [],
    pc: Writers.mapBy(_ => "idle"), seen: Writers.mapBy(_ => Set()), owner: Seed}
  action Init = s' = initial
  val Initial = s == initial
  val TypeOK = s.rows.indices().forall(i => s.rows.nth(i).subseteq(Writers.union(Set(Seed))))
    and s.pc.keys() == Writers and s.seen.keys() == Writers and s.owner.in(Writers.union(Set(Seed)))
    and Writers.forall(w => s.pc.get(w).in(Set("idle", "hit", "miss", "done")) and s.seen.get(w).subseteq(Writers.union(Set(Seed))))
  action Check(w: str): bool = all {
    s.pc.get(w) == "idle", Serialised implies s.owner == Seed,
    s' = {...s, owner: if (Serialised) w else s.owner,
      pc: s.pc.set(w, if (s.rows.length() == 0) "miss" else "hit"),
      seen: if (s.rows.length() == 0) s.seen else s.seen.set(w, s.rows.nth(0))}
  }
  action Update(w: str): bool = all {
    s.pc.get(w) == "hit",
    s' = {...s, rows: s.rows.replaceAt(0, s.seen.get(w).union(Set(w))), pc: s.pc.set(w, "done"),
      owner: if (Serialised) Seed else s.owner}
  }
  action Insert(w: str): bool = all {
    s.pc.get(w) == "miss",
    s' = {...s, rows: s.rows.append(Set(w)), pc: s.pc.set(w, "done"), owner: if (Serialised) Seed else s.owner}
  }
  val Finished = Writers.forall(w => s.pc.get(w) == "done")
  action Next = any {
    nondet w = Writers.oneOf()
    any {Check(w), Update(w), Insert(w)},
    all {Finished, s' = s}
  }
  action Step = any {Next, s' = s}
  temporal Fairness = Writers.forall(w => (Check(w) or Update(w) or Insert(w)).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  val NoDuplicateFact = s.rows.length() <= 1
  val NoLostEvidence = Writers.forall(w => s.pc.get(w) == "done" implies s.rows.indices().exists(i => w.in(s.rows.nth(i))))
  temporal WriteReturns = Writers.forall(w => eventually(s.pc.get(w) == "done"))
  temporal DeadlockFree = always(enabled(Next))
}

module CoreFactWriteDedupe {
  import CoreFactWriteDedupeTemplate(Writers = Set("w1", "w2", "w3"), Prefilled = false, Serialised = true, Seed = "Seed") as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::TypeOK and M::NoDuplicateFact and M::NoLostEvidence
  temporal DeadlockFree = M::DeadlockFree
  temporal CheckedTemporal = M::Fairness implies M::WriteReturns
  run equivalentInsertTest = init.then(M::Check("w1")).then(M::Insert("w1")).then(M::Check("w2"))
    .then(M::Update("w2")).expect(safety and M::s.rows == [Set("w1", "w2")])
  run writerExclusionTest = init.then(M::Check("w1")).expect(safety).then(M::Check("w2").fail())
}

module CoreFactWriteDedupePrefilled {
  import CoreFactWriteDedupeTemplate(Writers = Set("w1", "w2", "w3"), Prefilled = true, Serialised = true, Seed = "Seed") as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::TypeOK and M::NoDuplicateFact and M::NoLostEvidence
  temporal DeadlockFree = M::DeadlockFree
  temporal CheckedTemporal = M::Fairness implies M::WriteReturns
  run retainedEvidenceTest = init.then(M::Check("w2")).then(M::Update("w2")).then(M::Check("w1"))
    .then(M::Update("w1")).expect(safety and M::s.rows == [Set("Seed", "w1", "w2")])
}
