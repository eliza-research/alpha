// Literal upstream TaskService at 4787d51a142c. Keep its Set ownership
// abstraction; the source refinement of repaired counted ownership is separate.
module CoreTaskServiceTemplate {
  const Mode: str
  const Kind: str
  const Blocking: bool
  const Tm: int
  const DueRunners: Set[int]
  const DaemonRunners: Set[int]
  const ByIdRunners: Set[int]
  const MaxRequests: int
  const MaxPauses: int
  const None: int

  type Row = {exists: bool, paused: bool, due: bool, failing: bool, wake: bool, wakeDue: bool, rev: int}
  type Snap = {paused: bool, due: bool, wake: bool, rev: int}
  type State = {row: Row, snap: int -> Snap, pc: int -> str, outcome: int -> str,
    activeTick: int, inSet: bool, armed: bool, deferred: bool, unseen: bool,
    starts: int, unserved: Set[int], requests: int, pauses: int}
  var s: State
  val vars = s
  pure val Timers = if (Mode == "local") Set(Tm) else Set()
  pure val Scheduled = Timers.union(DueRunners).union(DaemonRunners)
  pure val Runners = Scheduled.union(ByIdRunners)
  pure val Repeat = Kind == "repeat"
  pure val Guarded = not(Repeat) or Blocking
  pure val MaxRev = MaxRequests + Runners.size()
  pure val AbsentSnap = {paused: false, due: false, wake: false, rev: -1}
  pure val NoneOutcome = "none"
  pure val Rows = 1.to(6).powerset().map(flags => 0.to(MaxRev).map(rev => {
    exists: flags.contains(1), paused: flags.contains(2), due: flags.contains(3),
    failing: flags.contains(4), wake: flags.contains(5), wakeDue: flags.contains(6), rev: rev
  })).flatten()
  pure val Snaps = 1.to(3).powerset().map(flags => 0.to(MaxRev).map(rev => {
    paused: flags.contains(1), due: flags.contains(2), wake: flags.contains(3), rev: rev
  })).flatten()
  pure val States = Set("idle", "read", "select", "recheck", "exec", "write", "release", "done")
  val Executing = Runners.filter(r => Set("exec", "write", "release").contains(s.pc.get(r)))
  pure def DueRow(row: Row): bool = row.due or (row.wake and row.wakeDue and not(row.failing))
  pure def SnapOf(row: Row): Snap = {paused: row.paused, due: DueRow(row), wake: row.wake, rev: row.rev}
  pure val InitialState = {
    row: {exists: true, paused: false, due: true, failing: false, wake: false, wakeDue: false, rev: 0},
    snap: Runners.mapBy(_ => AbsentSnap), pc: Runners.mapBy(_ => "idle"), outcome: Runners.mapBy(_ => NoneOutcome),
    activeTick: None, inSet: false, armed: Mode == "local", deferred: false, unseen: false,
    starts: 0, unserved: Set(), requests: 0, pauses: 0}
  val Initial = s == InitialState
  action Init = s' = InitialState
  pure def End(state: State, r: int, rearm: bool): State = {...state,
    activeTick: if (state.activeTick == r) None else state.activeTick,
    deferred: if (state.activeTick == r) false else state.deferred,
    armed: state.armed or (state.activeTick == r and state.deferred) or (Timers.contains(r) and rearm),
    pc: state.pc.set(r, if (Timers.contains(r)) "idle" else "done"), snap: state.snap.set(r, AbsentSnap)}
  pure def MarkDirty(state: State): State = {...state, unseen: true, armed: state.armed or Mode == "local"}
  action Begin(r: int): bool = all {
    s.pc.get(r) == "idle",
    any {
      all {Timers.contains(r), s.armed, s' = if (s.activeTick != None) {...s, armed: false, deferred: true}
        else {...s, armed: false, activeTick: r, pc: s.pc.set(r, "read")}},
      all {DueRunners.contains(r), s.activeTick == None, s' = {...s, activeTick: r, pc: s.pc.set(r, "read")}},
      all {DaemonRunners.union(ByIdRunners).contains(r), s' = {...s, pc: s.pc.set(r, "read")}}
    }
  }
  action Read(r: int): bool = all {
    s.pc.get(r) == "read",
    val read = {...s, unseen: if (Timers.union(DueRunners).contains(r)) false else s.unseen}
    s' = if (s.row.exists) {...read, snap: s.snap.set(r, SnapOf(s.row)), pc: s.pc.set(r, "select")}
      else End(read, r, false)
  }
  pure def StartWorker(state: State, r: int): State = {...state,
    pc: state.pc.set(r, "exec"), starts: if (state.starts < 2) state.starts + 1 else 2,
    unserved: state.unserved.filter(k => k > state.snap.get(r).rev)}
  action Select(r: int): bool = all {
    s.pc.get(r) == "select",
    val row = s.snap.get(r)
    s' = if ((Scheduled.contains(r) and (row.paused or (Repeat and not(row.due)) or (Repeat and Blocking and s.inSet)))
          or (Guarded and s.inSet)) End(s, r, true)
      else if (Repeat) StartWorker({...s, inSet: true}, r)
      else {...s, inSet: true, pc: s.pc.set(r, "recheck")}
  }
  action RecheckFound(r: int): bool = all {s.pc.get(r) == "recheck", s.row.exists, s' = StartWorker(s, r)}
  action RecheckMissingOrFailed(r: int): bool = all {s.pc.get(r) == "recheck", s' = {...s, pc: s.pc.set(r, "release")}}
  action Recheck(r: int): bool = any {RecheckFound(r), RecheckMissingOrFailed(r)}
  val Outcomes = Set("preserve").union(if (Repeat) Set("ok", "fail").union(
    if (s.requests < MaxRequests) Set("okWake") else Set()) else Set("ok"))
  action WorkWith(r: int, o: str): bool = all {
    s.pc.get(r) == "exec", Outcomes.contains(o),
    s' = {...s, outcome: s.outcome.set(r, o), pc: s.pc.set(r, if (o == "preserve") "release" else "write"),
      starts: if (o == "preserve" and not(Repeat)) s.starts - 1 else s.starts}
  }
  action Work(r: int): bool = all {
    s.pc.get(r) == "exec",
    nondet o = Outcomes.oneOf()
    WorkWith(r, o)
  }
  action Write(r: int): bool = all {
    s.pc.get(r) == "write",
    val snapshot = s.snap.get(r)
    val outcome = s.outcome.get(r)
    val consume = snapshot.wake or outcome == "okWake"
    val retained = s.row.wake and s.row.rev != snapshot.rev
    val finishing = MarkDirty({...s, pc: s.pc.set(r, "release")})
    if (not(Repeat)) s' = {...finishing, row: {...s.row, exists: false}}
    else if (outcome == "fail") s' = {...finishing, row: {...s.row, due: false, failing: true}}
    else if (outcome == "okWake") {
      nondet d = Bool.oneOf()
      s' = {...finishing, row: {...s.row, due: false, failing: false, wake: true,
        wakeDue: (retained and s.row.wakeDue) or d, rev: s.row.rev + 1},
        unserved: s.unserved.union(Set(s.row.rev + 1)), requests: s.requests + 1}
    } else s' = {...finishing, row: {...s.row, due: false, failing: false,
      wake: if (consume) retained else s.row.wake,
      wakeDue: if (consume) retained and s.row.wakeDue else s.row.wakeDue}}
  }
  action Release(r: int): bool = all {s.pc.get(r) == "release", s' = End({...s, inSet: false}, r, true)}
  action Elapse = all {Repeat, s.row.exists, not(s.row.due), s' = {...s, row: {...s.row, due: true}}}
  action WakeElapse = all {Repeat, s.row.wake, not(s.row.wakeDue), s' = {...s, row: {...s.row, wakeDue: true}}}
  action Request = all {
    Repeat, s.row.exists, s.requests < MaxRequests,
    s' = MarkDirty({...s, row: {...s.row, wake: true, wakeDue: s.row.wake and s.row.wakeDue, rev: s.row.rev + 1},
      unserved: s.unserved.union(Set(s.row.rev + 1)), requests: s.requests + 1})
  }
  action TogglePause = all {s.row.exists, s.pauses < MaxPauses,
    s' = MarkDirty({...s, row: {...s.row, paused: not(s.row.paused)}, pauses: s.pauses + 1})}
  val Finished = Runners.exclude(Timers).forall(r => s.pc.get(r) == "done")
  action RunnerStep(r: int): bool = any {Read(r), Select(r), Recheck(r), Work(r), Write(r), Release(r)}
  action Next = any {
    {nondet r = Runners.oneOf(); any {Begin(r), RunnerStep(r)}},
    Elapse, WakeElapse, Request, TogglePause, all {Finished, s' = s}
  }
  action Stutter = s' = s
  action Step = any {Next, Stutter}
  temporal Fairness = Runners.forall(r => RunnerStep(r).weakFair(vars))
    and Timers.union(DaemonRunners).union(ByIdRunners).forall(r => Begin(r).weakFair(vars))
    and DueRunners.forall(r => Begin(r).strongFair(vars))
    and Elapse.weakFair(vars) and WakeElapse.weakFair(vars)
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  val TypeOK = all {
    Rows.contains(s.row), s.snap.keys() == Runners, s.pc.keys() == Runners, s.outcome.keys() == Runners,
    Runners.forall(r => (s.snap.get(r) == AbsentSnap or Snaps.contains(s.snap.get(r)))
      and States.contains(s.pc.get(r)) and Set("ok", "fail", "okWake", "preserve", NoneOutcome).contains(s.outcome.get(r))),
    Runners.union(Set(None)).contains(s.activeTick), s.starts.in(0.to(2)), s.unserved.subseteq(1.to(MaxRev)),
    s.requests.in(0.to(MaxRev)), s.pauses.in(0.to(MaxPauses))
  }
  val OneShotAtMostOnce = not(Repeat) implies s.starts <= 1
  val OneShotDeletedAfterRun = not(Repeat) and not(s.row.exists) implies s.starts == 1
  val BlockingNoOverlap = Guarded implies Executing.size() <= 1
  val ClaimHeld = Guarded and Executing.size() > 0 implies s.inSet
  val NoLostWake = Repeat and s.unserved.size() > 0 implies s.row.wake
  val PausedNotSelected = Scheduled.forall(r =>
    Set("recheck", "exec", "write", "release").contains(s.pc.get(r)) implies not(s.snap.get(r).paused))
  val DirtyArmed = Mode == "local" and s.unseen implies (s.armed or s.deferred or
    (if (Timers.contains(Tm)) s.pc.get(Tm) == "read" else false))
  temporal RunnerFinishes = Runners.exclude(Timers).forall(r => (s.pc.get(r) != "idle").leadsTo(s.pc.get(r) == "done"))
  temporal WriteSeen = Mode == "local" implies s.unseen.leadsTo(not(s.unseen))
  temporal WakeServed = Mode == "local" and Repeat implies
    1.to(MaxRev).forall(k => s.unserved.contains(k).leadsTo(not(s.unserved.contains(k)) or s.row.paused))
}

module CoreTaskService {
  import CoreTaskServiceTemplate(Mode = "daemon", Kind = "oneshot", Blocking = true, Tm = 1,
    DueRunners = Set(2), DaemonRunners = Set(3), ByIdRunners = Set(), MaxRequests = 0, MaxPauses = 1, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::OneShotAtMostOnce and Model::OneShotDeletedAfterRun and Model::BlockingNoOverlap
    and Model::ClaimHeld and Model::NoLostWake and Model::PausedNotSelected and Model::DirtyArmed
  temporal CheckedTemporal = Model::Fairness implies Model::RunnerFinishes and Model::WriteSeen and Model::WakeServed
  run staleOneShotSnapshotDoesNotRerunTest = init.then(Model::Begin(2)).then(Model::Read(2)).then(Model::Begin(3)).then(Model::Read(3))
    .then(Model::Select(2)).then(Model::RecheckFound(2)).then(Model::WorkWith(2, "ok")).then(Model::Write(2)).then(Model::Release(2))
    .then(Model::Select(3)).then(Model::Recheck(3)).then(Model::Release(3))
    .expect(Model::s.starts == 1 and not(Model::s.row.exists) and safety)
  run preservedOneShotRemainsEligibleTest = init.then(Model::Begin(2)).then(Model::Read(2)).then(Model::Select(2))
    .then(Model::RecheckFound(2)).then(Model::WorkWith(2, "preserve")).then(Model::Release(2))
    .expect(Model::s.row.exists and Model::s.starts == 0 and not(Model::s.inSet) and safety)
}

module CoreTaskServiceDaemonRepeat {
  import CoreTaskServiceTemplate(Mode = "daemon", Kind = "repeat", Blocking = true, Tm = 1,
    DueRunners = Set(2), DaemonRunners = Set(3), ByIdRunners = Set(4), MaxRequests = 1, MaxPauses = 1, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::OneShotAtMostOnce and Model::OneShotDeletedAfterRun and Model::BlockingNoOverlap
    and Model::ClaimHeld and Model::NoLostWake and Model::PausedNotSelected and Model::DirtyArmed
  temporal CheckedTemporal = Model::Fairness implies Model::RunnerFinishes and Model::WriteSeen and Model::WakeServed
  run daemonCannotOverlapBlockingOwnerTest = init.then(Model::Begin(4)).then(Model::Read(4)).then(Model::Select(4))
    .then(Model::Begin(3)).then(Model::Read(3)).then(Model::Select(3))
    .expect(Model::s.pc.get(3) == "done" and Model::s.inSet and safety)
}

module CoreTaskServiceLocalOneshot {
  import CoreTaskServiceTemplate(Mode = "local", Kind = "oneshot", Blocking = true, Tm = 1,
    DueRunners = Set(2), DaemonRunners = Set(), ByIdRunners = Set(4), MaxRequests = 0, MaxPauses = 2, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::OneShotAtMostOnce and Model::OneShotDeletedAfterRun and Model::BlockingNoOverlap
    and Model::ClaimHeld and Model::NoLostWake and Model::PausedNotSelected and Model::DirtyArmed
  temporal CheckedTemporal = Model::Fairness implies Model::RunnerFinishes and Model::WriteSeen and Model::WakeServed
  run timerDefersWhileHostTickOwnsQueryTest = init.then(Model::Begin(2)).then(Model::Begin(1)).expect(Model::s.deferred and not(Model::s.armed) and safety)
}

module CoreTaskServiceLocalRepeat {
  import CoreTaskServiceTemplate(Mode = "local", Kind = "repeat", Blocking = true, Tm = 1,
    DueRunners = Set(), DaemonRunners = Set(), ByIdRunners = Set(4), MaxRequests = 1, MaxPauses = 1, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::OneShotAtMostOnce and Model::OneShotDeletedAfterRun and Model::BlockingNoOverlap
    and Model::ClaimHeld and Model::NoLostWake and Model::PausedNotSelected and Model::DirtyArmed
  temporal CheckedTemporal = Model::Fairness implies Model::RunnerFinishes and Model::WriteSeen and Model::WakeServed
  run wakeRequestArmsLocalTimerTest = init.then(Model::Request).then(Model::WakeElapse).then(Model::Begin(1)).then(Model::Read(1)).then(Model::Select(1))
    .expect(Model::s.unserved == Set() and Model::s.row.rev == 1 and safety)
}
