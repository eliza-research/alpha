// Literal conversion of packages/core/tla/SingleFlightMemo.tla at 4787d51a142.
module CoreSingleFlightMemoTemplate {
  const Readers: Set[str]
  const Writers: Set[str]
  pure val Fetches = 1.to(Readers.size())
  type State = {db: int, entry: int, nfetch: int, fval: int -> int, fstate: int -> str,
    rpc: str -> str, rf: str -> int, floor: str -> int, wpc: str -> str, wver: str -> int, completed: int}
  var s: State
  val vars = s
  pure def Max(a: int, b: int): int = if (a > b) a else b
  val TypeOK = s.db >= 0 and s.entry.in(Fetches.union(Set(0))) and s.nfetch.in(0.to(Readers.size()))
    and s.fval.keys() == Fetches and s.fstate.keys() == Fetches and s.rpc.keys() == Readers
    and s.rf.keys() == Readers and s.floor.keys() == Readers and s.wpc.keys() == Writers and s.wver.keys() == Writers
    and s.completed >= 0
    and Fetches.forall(f => s.fval.get(f) >= -1 and s.fstate.get(f).in(Set("pending", "resolved", "rejected")))
    and Readers.forall(r => s.rpc.get(r).in(Set("idle", "waiting", "served", "failed"))
      and s.rf.get(r).in(Fetches.union(Set(0))) and s.floor.get(r) >= 0)
    and Writers.forall(w => s.wpc.get(w).in(Set("idle", "committed", "done")) and s.wver.get(w) >= 0)
  pure val initial = {db: 0, entry: 0, nfetch: 0, fval: Fetches.mapBy(_ => -1), fstate: Fetches.mapBy(_ => "pending"),
    rpc: Readers.mapBy(_ => "idle"), rf: Readers.mapBy(_ => 0), floor: Readers.mapBy(_ => 0),
    wpc: Writers.mapBy(_ => "idle"), wver: Writers.mapBy(_ => 0), completed: 0}
  action Init = s' = initial
  val Initial = s == initial
  pure def Start(state: State, r: str, f: int): State = {...state, rpc: state.rpc.set(r, "waiting"),
    rf: state.rf.set(r, f), floor: state.floor.set(r, state.completed)}
  action ReadShared(r: str): bool = all {s.rpc.get(r) == "idle", s.entry != 0, s' = Start(s, r, s.entry)}
  action ReadFetch(r: str): bool = all {
    s.rpc.get(r) == "idle", val f = s.nfetch + 1
    s' = Start({...s, entry: f, nfetch: f}, r, f)
  }
  action FetchRead(f: int): bool = all {
    f <= s.nfetch, s.fval.get(f) == -1, s' = {...s, fval: s.fval.set(f, s.db)}
  }
  action FetchResolve(f: int): bool = all {
    s.fstate.get(f) == "pending", s.fval.get(f) != -1, s' = {...s, fstate: s.fstate.set(f, "resolved")}
  }
  action FetchReject(f: int): bool = all {
    f <= s.nfetch, s.fstate.get(f) == "pending",
    s' = {...s, fstate: s.fstate.set(f, "rejected"), entry: if (s.entry == f) 0 else s.entry}
  }
  action Serve(r: str): bool = all {
    s.rpc.get(r) == "waiting",
    val result = s.fstate.get(s.rf.get(r))
    all {result != "pending", s' = {...s, rpc: s.rpc.set(r, if (result == "resolved") "served" else "failed")}}
  }
  action Expire = all {s.entry != 0, s' = {...s, entry: 0}}
  action Commit(w: str): bool = all {
    s.wpc.get(w) == "idle",
    s' = {...s, db: s.db + 1, wver: s.wver.set(w, s.db + 1), wpc: s.wpc.set(w, "committed")}
  }
  action Invalidate(w: str): bool = all {
    s.wpc.get(w) == "committed",
    s' = {...s, entry: 0, completed: Max(s.completed, s.wver.get(w)), wpc: s.wpc.set(w, "done")}
  }
  val Finished = Readers.forall(r => s.rpc.get(r).in(Set("served", "failed"))) and Writers.forall(w => s.wpc.get(w) == "done")
  action Next = any {
    nondet r = Readers.oneOf()
    any {ReadShared(r), ReadFetch(r), Serve(r)},
    nondet f = Fetches.oneOf()
    any {FetchRead(f), FetchResolve(f), FetchReject(f)},
    nondet w = Writers.oneOf()
    any {Commit(w), Invalidate(w)},
    Expire, all {Finished, s' = s}
  }
  action Step = any {Next, s' = s}
  temporal Fairness = Fetches.forall(f => FetchRead(f).weakFair(vars) and FetchResolve(f).weakFair(vars))
    and Readers.forall(r => Serve(r).weakFair(vars)) and Writers.forall(w => Invalidate(w).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  val NoStaleAfterInvalidate = Readers.forall(r => if (s.rpc.get(r) == "served") s.fval.get(s.rf.get(r)) >= s.floor.get(r) else true)
  val RejectedNotCached = if (s.entry == 0) true else s.fstate.get(s.entry) != "rejected"
  pure def Permutations(ids: Set[str]): Set[str -> str] =
    ids.setOfMaps(ids).filter(m => ids.map(id => m.get(id)) == ids)
  pure val Symmetry = Permutations(Readers).union(Permutations(Writers))
  temporal ReaderFinishes = Readers.forall(r => (s.rpc.get(r) == "waiting").leadsTo(s.rpc.get(r).in(Set("served", "failed"))))
  val Safety = TypeOK and NoStaleAfterInvalidate and RejectedNotCached
}

module CoreSingleFlightMemo {
  import CoreSingleFlightMemoTemplate(Readers = Set("r1", "r2"), Writers = Set("w1", "w2")) as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::Safety
  val observed = M::s
  action ReadShared(r) = M::ReadShared(r)
  action ReadFetch(r) = M::ReadFetch(r)
  action FetchRead(f) = M::FetchRead(f)
  action FetchResolve(f) = M::FetchResolve(f)
  action FetchReject(f) = M::FetchReject(f)
  action Serve(r) = M::Serve(r)
  action Expire = M::Expire
  action Commit(w) = M::Commit(w)
  action Invalidate(w) = M::Invalidate(w)
  temporal CheckedTemporal = M::Fairness implies M::ReaderFinishes
  run readerSharesFetchTest = init.then(M::ReadFetch("r1")).then(M::ReadShared("r2")).then(M::FetchRead(1))
    .then(M::FetchResolve(1)).then(M::Serve("r1")).then(M::Serve("r2")).expect(safety and M::s.nfetch == 1)
  run rejectionEvictsOnlyItsEntryTest = init.then(M::ReadFetch("r1")).then(M::ReadFetch("r2"))
    .then(M::FetchReject(1)).then(M::Serve("r1")).expect(safety and M::s.entry == 2)
}

module CoreSingleFlightMemoSafety {
  import CoreSingleFlightMemoTemplate(Readers = Set("r1", "r2", "r3"), Writers = Set("w1", "w2")) as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::Safety
  val observed = M::s
  action ReadShared(r) = M::ReadShared(r)
  action ReadFetch(r) = M::ReadFetch(r)
  action FetchRead(f) = M::FetchRead(f)
  action FetchResolve(f) = M::FetchResolve(f)
  action FetchReject(f) = M::FetchReject(f)
  action Serve(r) = M::Serve(r)
  action Expire = M::Expire
  action Commit(w) = M::Commit(w)
  action Invalidate(w) = M::Invalidate(w)
  pure val Symmetry = M::Symmetry
  run invalidationFencesNewReaderTest = init.then(M::ReadFetch("r1")).then(M::FetchRead(1))
    .then(M::Commit("w1")).then(M::Invalidate("w1")).then(M::ReadFetch("r2")).then(M::ReadShared("r3"))
    .then(M::FetchRead(2)).then(M::FetchResolve(2)).then(M::Serve("r3"))
    .expect(safety and M::s.floor.get("r3") == 1 and M::s.fval.get(2) == 1)
}
