// Literal conversion of packages/core/tla/RoomHandlerQueue.tla at 4787d51a142.
module CoreRoomHandlerQueueTemplate {
  const Turns: Set[str]
  const NumRooms: int
  const MaxPerRoom: int
  const MaxTotal: int
  const MaxRooms: int
  const MaxWrites: int
  const None: str
  pure val Rooms = 1.to(NumRooms)
  pure val States = Set("idle", "acquiring", "waiting", "owner", "releasing", "unwinding", "done", "refused", "cancelled")
  pure val Terminal = Set("done", "refused", "cancelled")
  pure val Releasing = Set("releasing", "unwinding")
  type State = {queue: int -> List[str], active: int -> str, want: str -> Set[int], held: str -> Set[int],
    pc: str -> str, accepting: str -> Set[int], writes: str -> (int -> int), closed: bool,
    admissionHistory: bool, releaseHistory: bool}
  var s: State
  val vars = s
  def Pending(r: int): int = s.queue.get(r).length() + (if (s.active.get(r) == None) 0 else 1)
  val InUse = Rooms.filter(r => Pending(r) > 0)
  val Total = Rooms.fold(0, (total, r) => total + Pending(r))
  pure def Min(rooms: Set[int]): int = rooms.fold(NumRooms + 1, (low, r) => if (r < low) r else low)
  pure def Max(rooms: Set[int]): int = rooms.fold(0, (high, r) => if (r > high) r else high)
  def Waits(t: str, r: int): bool = s.queue.get(r).indices().exists(i => s.queue.get(r).nth(i) == t)
  pure def Remove(sequence: List[str], t: str): List[str] =
    sequence.foldl([], (kept, turn) => if (turn == t) kept else kept.append(turn))
  val TypeOK = s.queue.keys() == Rooms and s.active.keys() == Rooms and s.want.keys() == Turns
    and s.held.keys() == Turns and s.pc.keys() == Turns and s.accepting.keys() == Turns and s.writes.keys() == Turns
    and Rooms.forall(r => s.active.get(r).in(Turns.union(Set(None)))
      and s.queue.get(r).indices().forall(i => s.queue.get(r).nth(i).in(Turns)))
    and Turns.forall(t => s.want.get(t).subseteq(Rooms) and s.held.get(t).subseteq(Rooms)
      and s.pc.get(t).in(States) and s.accepting.get(t).subseteq(Rooms) and s.writes.get(t).keys() == Rooms
      and Rooms.forall(r => s.writes.get(t).get(r).in(0.to(MaxWrites))))
  pure val initial = {queue: Rooms.mapBy(_ => []), active: Rooms.mapBy(_ => None), want: Turns.mapBy(_ => Set()),
    held: Turns.mapBy(_ => Set()), pc: Turns.mapBy(_ => "idle"), accepting: Turns.mapBy(_ => Set()),
    writes: Turns.mapBy(_ => Rooms.mapBy(_ => 0)), closed: false, admissionHistory: true, releaseHistory: true}
  action Init = s' = initial
  val Initial = s == initial
  // Record the two source action properties without restricting any projected transition.
  action Track(after: State): bool = s' = {...after,
    admissionHistory: s.admissionHistory and (s.closed implies Rooms.forall(r => after.queue.get(r).length() <= s.queue.get(r).length())),
    releaseHistory: s.releaseHistory and Rooms.forall(r => {
      val owner = s.active.get(r)
      if (owner == None or after.active.get(r) == owner) true
      else s.pc.get(owner).in(Releasing) and not(r.in(s.accepting.get(owner))) and s.writes.get(owner).get(r) == 0
    })}
  action Start(t: str, wanted: Set[int]): bool = all {
    s.pc.get(t) == "idle", wanted != Set(),
    Track({...s, want: s.want.set(t, wanted), pc: s.pc.set(t, "acquiring")})
  }
  action Admit(t: str): bool = all {
    s.pc.get(t) == "acquiring",
    val r = Min(s.want.get(t).exclude(s.held.get(t)))
    if (s.closed or (not(r.in(InUse)) and InUse.size() >= MaxRooms) or Total >= MaxTotal or Pending(r) >= MaxPerRoom)
      Track({...s, pc: s.pc.set(t, if (s.held.get(t) == Set()) "refused" else "unwinding")})
    else Track({...s, queue: s.queue.set(r, s.queue.get(r).append(t)), pc: s.pc.set(t, "waiting")})
  }
  action Grant(r: int): bool = all {
    s.active.get(r) == None, s.queue.get(r).length() > 0,
    val t = s.queue.get(r).nth(0)
    val held = s.held.get(t).union(Set(r))
    Track({...s, active: s.active.set(r, t), queue: s.queue.set(r, s.queue.get(r).slice(1, s.queue.get(r).length())),
      held: s.held.set(t, held), accepting: s.accepting.set(t, s.accepting.get(t).union(Set(r))),
      pc: s.pc.set(t, if (held == s.want.get(t)) "owner" else "acquiring")})
  }
  action CancelAt(t: str, r: int): bool = all {
    s.pc.get(t) == "waiting", Waits(t, r),
    Track({...s, queue: s.queue.set(r, Remove(s.queue.get(r), t)),
      pc: s.pc.set(t, if (s.held.get(t) == Set()) "cancelled" else "unwinding")})
  }
  action Cancel(t: str): bool = {
    nondet r = Rooms.oneOf()
    CancelAt(t, r)
  }
  action StartRelease(t: str): bool = all {s.pc.get(t) == "owner", Track({...s, pc: s.pc.set(t, "releasing")})}
  action Nest(t: str, r: int): bool = all {not(r.in(s.held.get(t))), StartRelease(t)}
  action BeginWrite(t: str, r: int): bool = all {
    s.pc.get(t).in(Set("owner", "releasing")), r.in(s.accepting.get(t)), s.writes.get(t).get(r) < MaxWrites,
    Track({...s, writes: s.writes.set(t, s.writes.get(t).set(r, s.writes.get(t).get(r) + 1))})
  }
  action EndWrite(t: str, r: int): bool = all {
    s.writes.get(t).get(r) > 0,
    Track({...s, writes: s.writes.set(t, s.writes.get(t).set(r, s.writes.get(t).get(r) - 1))})
  }
  action StopWrites(t: str): bool = all {
    s.pc.get(t).in(Releasing), s.held.get(t) != Set(),
    val r = Max(s.held.get(t))
    all {r.in(s.accepting.get(t)), Track({...s, accepting: s.accepting.set(t, s.accepting.get(t).exclude(Set(r)))})}
  }
  action Release(t: str): bool = all {
    s.pc.get(t).in(Releasing), s.held.get(t) != Set(),
    val r = Max(s.held.get(t))
    val remaining = s.held.get(t).exclude(Set(r))
    all {
      not(r.in(s.accepting.get(t))), s.writes.get(t).get(r) == 0,
      Track({...s, active: s.active.set(r, None), held: s.held.set(t, remaining),
        pc: if (remaining == Set()) s.pc.set(t, if (s.pc.get(t) == "releasing") "done" else "refused") else s.pc})
    }
  }
  action Close = all {not(s.closed), Track({...s, closed: true})}
  val Finished = Turns.forall(t => s.pc.get(t).in(Terminal))
  action Next = any {
    nondet t = Turns.oneOf()
    nondet wanted = Rooms.powerset().oneOf()
    Start(t, wanted),
    nondet t = Turns.oneOf()
    any {Admit(t), Cancel(t), StartRelease(t), StopWrites(t), Release(t)},
    nondet t = Turns.oneOf()
    nondet r = Rooms.oneOf()
    any {Nest(t, r), BeginWrite(t, r), EndWrite(t, r)},
    nondet r = Rooms.oneOf()
    Grant(r),
    Close, all {Finished, s.closed, s' = s}
  }
  action Step = any {Next, s' = s}
  temporal Fairness = Rooms.forall(r => Grant(r).weakFair(vars)) and Turns.forall(t =>
    Admit(t).weakFair(vars) and StartRelease(t).weakFair(vars) and StopWrites(t).weakFair(vars) and Release(t).weakFair(vars)
    and Rooms.forall(r => EndWrite(t, r).weakFair(vars)))
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  val MutualExclusion = Rooms.forall(r => if (s.active.get(r) == None) true else r.in(s.held.get(s.active.get(r))))
    and Turns.forall(t => s.held.get(t).forall(r => s.active.get(r) == t))
  val WaitersQueued = Turns.forall(t => ((s.pc.get(t) == "waiting") iff Rooms.exists(r => Waits(t, r)))
    and Rooms.forall(r => s.queue.get(r).indices().filter(i => s.queue.get(r).nth(i) == t).size() <= 1))
  val OrderedAcquisition = Turns.forall(t => s.pc.get(t).in(Set("acquiring", "waiting")) implies
    s.held.get(t).forall(h => h < Min(s.want.get(t).exclude(s.held.get(t)))))
  val Bounded = Rooms.forall(r => Pending(r) <= MaxPerRoom) and Total <= MaxTotal and InUse.size() <= MaxRooms
  val WritesUnderLease = Turns.forall(t => s.accepting.get(t).subseteq(s.held.get(t))
    and Rooms.forall(r => (s.writes.get(t).get(r) > 0 implies r.in(s.held.get(t)))
      and (s.pc.get(t).in(Terminal.union(Set("idle"))) implies s.writes.get(t).get(r) == 0)))
  val NoLeakedOwnership = Turns.forall(t => s.pc.get(t).in(Terminal) implies
    (s.held.get(t) == Set() and Rooms.forall(r => not(Waits(t, r)))))
  temporal NoAdmissionAfterClose = always(s.admissionHistory)
  temporal FreedByOwner = always(s.releaseHistory)
  temporal WaiterServed = Turns.forall(t => (s.pc.get(t) == "waiting").leadsTo(s.pc.get(t) != "waiting"))
  temporal TurnFinishes = Turns.forall(t => (s.pc.get(t) == "acquiring").leadsTo(s.pc.get(t).in(Terminal)))
  val Safety = TypeOK and MutualExclusion and WaitersQueued and OrderedAcquisition and Bounded and NoLeakedOwnership and WritesUnderLease
}

module CoreRoomHandlerQueue {
  import CoreRoomHandlerQueueTemplate(Turns = Set("t1", "t2", "t3"), NumRooms = 2,
    MaxPerRoom = 2, MaxTotal = 3, MaxRooms = 2, MaxWrites = 1, None = "None") as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::Safety
  val state = M::s
  action start(t, rooms) = M::Start(t, rooms)
  action admit(t) = M::Admit(t)
  action grant(r) = M::Grant(r)
  action cancel(t, r) = M::CancelAt(t, r)
  action startRelease(t) = M::StartRelease(t)
  action beginWrite(t, r) = M::BeginWrite(t, r)
  action endWrite(t, r) = M::EndWrite(t, r)
  action stopWrites(t) = M::StopWrites(t)
  action release(t) = M::Release(t)
  action close = M::Close
  temporal CheckedTemporal = M::Fairness implies (M::NoAdmissionAfterClose and M::FreedByOwner and M::WaiterServed and M::TurnFinishes)
  run writesDelayReleaseTest = init.then(M::Start("t1", Set(1, 2))).then(M::Admit("t1")).then(M::Grant(1))
    .then(M::Admit("t1")).then(M::Grant(2)).then(M::BeginWrite("t1", 2)).then(M::StartRelease("t1"))
    .then(M::StopWrites("t1")).then(M::BeginWrite("t1", 1)).then(M::EndWrite("t1", 2))
    .then(M::Release("t1")).expect(safety and M::s.held.get("t1") == Set(1))
  run closeRefusesAndUnwindsTest = init.then(M::Start("t1", Set(1, 2))).then(M::Admit("t1")).then(M::Grant(1))
    .then(M::Close).then(M::Admit("t1")).then(M::StopWrites("t1")).then(M::Release("t1"))
    .expect(safety and M::s.pc.get("t1") == "refused")
}

module CoreRoomHandlerQueueCycle {
  import CoreRoomHandlerQueueTemplate(Turns = Set("t1", "t2", "t3"), NumRooms = 2,
    MaxPerRoom = 2, MaxTotal = 4, MaxRooms = 2, MaxWrites = 1, None = "None") as M
  action init = M::Init
  action rawStep = M::Next
  action step = M::Step
  val safety = M::Safety
  val state = M::s
  action start(t, rooms) = M::Start(t, rooms)
  action admit(t) = M::Admit(t)
  action grant(r) = M::Grant(r)
  action cancel(t, r) = M::CancelAt(t, r)
  action startRelease(t) = M::StartRelease(t)
  action beginWrite(t, r) = M::BeginWrite(t, r)
  action endWrite(t, r) = M::EndWrite(t, r)
  action stopWrites(t) = M::StopWrites(t)
  action release(t) = M::Release(t)
  action close = M::Close
  temporal CheckedTemporal = M::Fairness implies (M::NoAdmissionAfterClose and M::FreedByOwner and M::WaiterServed and M::TurnFinishes)
  run cancelledWaiterUnwindsTest = init.then(M::Start("t1", Set(2))).then(M::Admit("t1")).then(M::Grant(2))
    .then(M::Start("t2", Set(2, 1))).then(M::Admit("t2")).then(M::Grant(1)).then(M::Admit("t2"))
    .then(M::CancelAt("t2", 2)).then(M::StopWrites("t2")).then(M::Release("t2"))
    .expect(safety and M::s.pc.get("t2") == "refused" and M::s.active.get(2) == "t1")
  run nestedForeignRoomUnwindsTest = init.then(M::Start("t1", Set(1))).then(M::Admit("t1")).then(M::Grant(1))
    .then(M::Nest("t1", 2)).then(M::StopWrites("t1")).then(M::Release("t1"))
    .expect(safety and M::s.pc.get("t1") == "done")
}
