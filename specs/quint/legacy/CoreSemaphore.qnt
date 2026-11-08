// Literal conversion of packages/core/tla/Semaphore.tla at 4787d51a142.
module CoreSemaphoreTemplate {
  const Callers: Set[str]
  const N: int
  type State = {permits: int, waiters: List[str], pc: str -> str, aborted: str -> bool,
    listener: str -> bool, queuedAbort: str -> bool, ticket: str -> int, next: int}
  var s: State
  val vars = s
  pure def Remove(sequence: List[str], c: str): List[str] =
    sequence.foldl([], (kept, value) => if (value == c) kept else kept.append(value))
  def Queued(c: str): bool = s.waiters.indices().exists(i => s.waiters.nth(i) == c)
  val Holders = Callers.filter(c => s.pc.get(c) == "holding")
  val TypeOK = s.permits.in(0.to(N)) and s.waiters.indices().forall(i => s.waiters.nth(i).in(Callers))
    and s.pc.keys() == Callers and s.aborted.keys() == Callers and s.listener.keys() == Callers
    and s.queuedAbort.keys() == Callers and s.ticket.keys() == Callers and s.next >= 0
    and Callers.forall(c => s.pc.get(c).in(Set("idle", "waiting", "holding", "done", "rejected")) and s.ticket.get(c) >= 0)
  pure val initial = {permits: N, waiters: [], pc: Callers.mapBy(_ => "idle"),
    aborted: Callers.mapBy(_ => false), listener: Callers.mapBy(_ => false),
    queuedAbort: Callers.mapBy(_ => false), ticket: Callers.mapBy(_ => 0), next: 1}
  action Init = s' = initial
  val Initial = s == initial
  action Acquire(c: str): bool = all {
    s.pc.get(c) == "idle",
    if (s.aborted.get(c)) s' = {...s, pc: s.pc.set(c, "rejected")}
    else if (s.permits > 0) s' = {...s, permits: s.permits - 1, pc: s.pc.set(c, "holding")}
    else s' = {...s, waiters: s.waiters.append(c), pc: s.pc.set(c, "waiting"), ticket: s.ticket.set(c, s.next), next: s.next + 1}
  }
  action Abort(c: str): bool = all {
    not(s.aborted.get(c)),
    s' = {...s, aborted: s.aborted.set(c, true), listener: s.listener.set(c, s.pc.get(c) == "waiting"),
      queuedAbort: s.queuedAbort.set(c, s.pc.get(c) == "waiting")}
  }
  action CancelListener(c: str): bool = all {
    s.listener.get(c),
    s' = {...s, listener: s.listener.set(c, false), waiters: if (Queued(c)) Remove(s.waiters, c) else s.waiters,
      pc: if (Queued(c)) s.pc.set(c, "rejected") else s.pc}
  }
  def Skipped(sequence: List[str]): int = sequence.indices().fold(0, (count, i) =>
    if (count == i and s.aborted.get(sequence.nth(i))) i + 1 else count)
  action Release(c: str): bool = all {
    s.pc.get(c) == "holding",
    val k = Skipped(s.waiters)
    val dead = s.waiters.slice(0, k).foldl(Set(), (ids, id) => ids.union(Set(id)))
    val rest = s.waiters.slice(k, s.waiters.length())
    s' = {...s, permits: if (rest.length() == 0) s.permits + 1 else s.permits,
      waiters: if (rest.length() == 0) [] else rest.slice(1, rest.length()),
      pc: Callers.mapBy(x => if (x == c) "done" else if (rest.length() > 0 and x == rest.nth(0)) "holding"
        else if (x.in(dead)) "rejected" else s.pc.get(x)),
      listener: Callers.mapBy(x => if (x.in(dead)) false else s.listener.get(x))}
  }
  val Finished = Callers.forall(c => s.pc.get(c).in(Set("done", "rejected")) and not(s.listener.get(c)))
  action Next = any {
    nondet c = Callers.oneOf()
    any {Acquire(c), Abort(c), CancelListener(c), Release(c)},
    all {Finished, s' = s}
  }
  action Step = any {Next, s' = s}
  temporal Fairness = Callers.forall(c => Release(c).weakFair(vars) and CancelListener(c).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  val PermitConservation = s.permits + Holders.size() == N
  val NoIdlePermitWithWaiters = s.permits > 0 implies s.waiters.length() == 0
  val WaitersQueued = Callers.forall(c => (s.pc.get(c) == "waiting") iff Queued(c))
    and Callers.forall(c => s.waiters.indices().filter(i => s.waiters.nth(i) == c).size() <= 1)
  val FIFOGrants = Callers.forall(w => Callers.forall(h =>
    (s.pc.get(w) == "waiting" and s.pc.get(h).in(Set("holding", "done")) and s.ticket.get(h) != 0)
      implies s.ticket.get(h) < s.ticket.get(w)))
  val CancelledNeverHolds = Callers.forall(c => s.queuedAbort.get(c) implies not(s.pc.get(c).in(Set("holding", "done"))))
  temporal WaiterServed = Callers.forall(c => (s.pc.get(c) == "waiting").leadsTo(s.pc.get(c) != "waiting"))
  temporal DeadlockFree = always(enabled(Next))
}

module CoreSemaphore {
  import CoreSemaphoreTemplate(Callers = Set("c1", "c2", "c3", "c4"), N = 1) as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::TypeOK and M::PermitConservation and M::NoIdlePermitWithWaiters and M::WaitersQueued and M::FIFOGrants and M::CancelledNeverHolds
  temporal DeadlockFree = M::DeadlockFree
  temporal CheckedTemporal = M::Fairness implies M::WaiterServed
  run cancelledHeadSkippedTest = init.then(M::Acquire("c1")).then(M::Acquire("c2")).then(M::Acquire("c3"))
    .then(M::Abort("c2")).then(M::Release("c1")).expect(safety and M::s.pc.get("c3") == "holding" and not(M::s.listener.get("c2")))
  run cancellationListenerTest = init.then(M::Acquire("c1")).then(M::Acquire("c2")).then(M::Abort("c2"))
    .then(M::CancelListener("c2")).then(M::Release("c1")).expect(safety and M::s.permits == 1)
  run preAbortedCallerTest = init.then(M::Abort("c1")).then(M::Acquire("c1")).expect(safety and M::s.pc.get("c1") == "rejected")
}

module CoreSemaphoreTwo {
  import CoreSemaphoreTemplate(Callers = Set("c1", "c2", "c3", "c4"), N = 2) as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::TypeOK and M::PermitConservation and M::NoIdlePermitWithWaiters and M::WaitersQueued and M::FIFOGrants and M::CancelledNeverHolds
  temporal DeadlockFree = M::DeadlockFree
  temporal CheckedTemporal = M::Fairness implies M::WaiterServed
  run twoOwnersTest = init.then(M::Acquire("c1")).then(M::Acquire("c2")).then(M::Acquire("c3"))
    .then(M::Release("c2")).expect(safety and M::s.pc.get("c3") == "holding" and M::s.pc.get("c1") == "holding")
}
