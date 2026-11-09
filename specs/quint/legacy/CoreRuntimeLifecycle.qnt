// Literal upstream RuntimeLifecycle at 4787d51a142c. Stable model values are
// integer identities; one monitor encodes the source action invariant exactly.
module CoreRuntimeLifecycleTemplate {
  const Turns: Set[int]
  const Stoppers: Set[int]
  const MaxAttempts: int
  const None: int
  pure val Attempts = 1.to(MaxAttempts)
  type State = {ipc: str, initResolved: bool, initFailed: bool, svc: str, svcLate: bool,
    queue: List[int], owner: int, tpc: int -> str, aborted: int -> bool,
    stopReq: bool, stopped: bool, stopPromise: bool, prepareCalls: int, closed: bool, turnsClosed: bool,
    failures: bool, apc: str, aid: int, afast: bool, outcome: int -> str, spc: int -> str,
    sfast: int -> bool, sstrict: int -> bool, sjoined: int -> int, strictP: str}
  var s: State
  var admissionSafe: bool
  val vars = s
  val initVars = (s.ipc, s.initResolved, s.initFailed)
  val svcVars = (s.svc, s.svcLate)
  val turnVars = (s.queue, s.owner, s.tpc, s.aborted)
  val stopVars = (s.stopReq, s.stopped, s.stopPromise, s.prepareCalls, s.closed, s.turnsClosed, s.failures)
  val attVars = (s.apc, s.aid, s.afast, s.outcome)
  val callVars = (s.spc, s.sfast, s.sstrict, s.sjoined, s.strictP)
  val Pending = Turns.filter(t => Set("queued", "lease", "turn").contains(s.tpc.get(t)))
  pure val InitialState = {ipc: "idle", initResolved: false, initFailed: false,
    svc: "none", svcLate: false, queue: [], owner: None, tpc: Turns.mapBy(_ => "idle"), aborted: Turns.mapBy(_ => false),
    stopReq: false, stopped: false, stopPromise: false, prepareCalls: 0, closed: false, turnsClosed: false, failures: false,
    apc: "none", aid: 0, afast: false, outcome: Attempts.mapBy(_ => "pending"),
    spc: Stoppers.mapBy(_ => "idle"), sfast: Stoppers.mapBy(_ => false), sstrict: Stoppers.mapBy(_ => false),
    sjoined: Stoppers.mapBy(_ => 0), strictP: "none"}
  val Initial = s == InitialState and admissionSafe
  action Init = all {s' = InitialState, admissionSafe' = true}
  action Move(after: State): bool = all {s' = after,
    admissionSafe' = (admissionSafe and (s.closed implies after.queue.length() <= s.queue.length()))}

  action IRegister = all {s.ipc == "idle", Move(if (s.stopReq)
    {...s, ipc: "failed", initResolved: true, initFailed: true} else {...s, ipc: "core", svc: "waitInit"})}
  action ICoreWith(ok: bool): bool = all {
    s.ipc == "core",
    Move({...s, ipc: if (ok) "ok" else "failed", initFailed: not(ok), initResolved: true})
  }
  action ICore = {
    nondet ok = Set(true, false).oneOf()
    ICoreWith(ok)
  }
  action SvcResume = all {s.svc == "waitInit", s.initResolved,
    Move({...s, svc: if (s.stopReq or s.initFailed) "skipped" else "starting"})}
  action SvcStarted = all {s.svc == "starting", Move(if (s.stopped or s.stopReq)
    {...s, svc: "stopping", svcLate: true} else {...s, svc: "live"})}
  action SvcStopDone = all {s.svc == "stopping", Move({...s, svc: "stopped"})}

  action TAdmit(t: int): bool = all {s.tpc.get(t) == "idle", Move(if (s.closed)
    {...s, tpc: s.tpc.set(t, "refused")} else {...s, queue: s.queue.append(t), tpc: s.tpc.set(t, "queued")})}
  action TGrant = all {s.owner == None, s.queue.length() > 0,
    val t = s.queue.nth(0)
    Move({...s, owner: t, queue: s.queue.tail(), tpc: s.tpc.set(t, "lease")})}
  action TRun(t: int): bool = all {s.tpc.get(t) == "lease",
    Move({...s, tpc: s.tpc.set(t, "turn"), aborted: s.aborted.set(t, s.turnsClosed)})}
  action TFinish(t: int): bool = all {s.tpc.get(t) == "turn",
    Move({...s, tpc: s.tpc.set(t, "done"), owner: None})}

  pure def BeginAttempt(state: State, caller: int): State = {...state,
    stopPromise: true, aid: state.aid + 1, afast: state.sfast.get(caller), apc: "drain",
    sjoined: state.sjoined.set(caller, state.aid + 1), prepareCalls: state.prepareCalls + (if (state.stopReq) 0 else 1),
    stopReq: true, closed: true, turnsClosed: true,
    aborted: Turns.mapBy(t => state.aborted.get(t) or state.tpc.get(t) == "turn")}
  pure def EnterBestEffort(state: State, caller: int): State = if (state.stopPromise)
    {...state, sjoined: state.sjoined.set(caller, state.aid), spc: state.spc.set(caller, "be")}
    else if (state.stopped) {...state, spc: state.spc.set(caller, if (state.sstrict.get(caller)) "drain" else "done")}
    else BeginAttempt({...state, spc: state.spc.set(caller, "be")}, caller)
  action SCallWith(caller: int, fast: bool, strict: bool): bool = all {
    s.spc.get(caller) == "idle", s.aid < MaxAttempts or s.stopPromise or s.stopped,
    val callerOptions = {...s, sfast: s.sfast.set(caller, fast), sstrict: s.sstrict.set(caller, strict)}
    Move(if (strict and s.strictP != "none") {...callerOptions, spc: s.spc.set(caller, "awaitStrict")}
      else EnterBestEffort({...callerOptions, strictP: if (strict) "running" else s.strictP}, caller))
  }
  action SCall(caller: int): bool = {
    nondet fast = Set(true, false).oneOf()
    nondet strict = Set(true, false).oneOf()
    SCallWith(caller, fast, strict)
  }
  action ADrained = all {s.apc == "drain", Pending.size() == 0, Move({...s, apc: "services"})}
  action ATimeout = all {s.apc == "drain", s.afast, Pending.size() > 0,
    Move({...s, apc: "none", outcome: s.outcome.set(s.aid, "err"), failures: true, stopPromise: false})}
  action AServices = all {s.apc == "services",
    Move({...s, stopped: true, svc: if (s.svc == "live") "stopping" else s.svc, apc: "svcwait"})}
  action ASvcDone = all {s.apc == "svcwait", s.svc != "stopping" or s.svcLate or s.afast,
    Move({...s, apc: "none", outcome: s.outcome.set(s.aid, "ok"), stopPromise: false})}
  action SBestEffortDone(caller: int): bool = all {
    s.spc.get(caller) == "be", s.outcome.get(s.sjoined.get(caller)) != "pending",
    val strict = s.sstrict.get(caller)
    Move(if (s.outcome.get(s.sjoined.get(caller)) == "err")
      {...s, spc: s.spc.set(caller, "done"), strictP: if (strict) "err" else s.strictP}
      else {...s, spc: s.spc.set(caller, if (strict) "drain" else "done")})
  }
  action SStrictDrain(caller: int): bool = all {
    s.spc.get(caller) == "drain", Pending.size() == 0, not(Set("starting", "stopping").contains(s.svc)),
    Move({...s, spc: s.spc.set(caller, "done"), strictP: if (s.failures) "err" else "ok"})
  }
  action SAwaitStrict(caller: int): bool = all {s.spc.get(caller) == "awaitStrict", Set("ok", "err").contains(s.strictP),
    Move({...s, spc: s.spc.set(caller, "done")})}

  val Finished = Set("idle", "ok", "failed").contains(s.ipc) and not(Set("waitInit", "starting", "stopping").contains(s.svc))
    and Pending.size() == 0 and s.apc == "none" and Stoppers.forall(c => Set("idle", "done").contains(s.spc.get(c)))
  action Next = any {
    IRegister, ICore, SvcResume, SvcStarted, SvcStopDone,
    {nondet t = Turns.oneOf(); any {TAdmit(t), TRun(t), TFinish(t)}}, TGrant,
    {nondet caller = Stoppers.oneOf(); any {SCall(caller), SBestEffortDone(caller), SStrictDrain(caller), SAwaitStrict(caller)}},
    ADrained, ATimeout, AServices, ASvcDone, all {Finished, Move(s)}
  }
  action Stutter = all {s' = s, admissionSafe' = admissionSafe}
  action Step = any {Next, Stutter}
  temporal Fairness = ICore.weakFair(vars) and SvcResume.weakFair(vars) and SvcStarted.weakFair(vars) and SvcStopDone.weakFair(vars)
    and TGrant.weakFair(vars) and Turns.forall(t => TRun(t).weakFair(vars) and TFinish(t).weakFair(vars))
    and ADrained.weakFair(vars) and AServices.weakFair(vars) and ASvcDone.weakFair(vars)
    and Stoppers.forall(c => SBestEffortDone(c).weakFair(vars) and SStrictDrain(c).weakFair(vars) and SAwaitStrict(c).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep((s, admissionSafe))) and Fairness

  val LifecycleState = if (s.stopReq) (if (s.stopped and not(s.stopPromise)) "stopped" else "stopping")
    else if (s.initFailed) "failed" else if (not(s.initResolved)) "initializing" else "running"
  val TypeOK = all {
    Set("idle", "core", "ok", "failed").contains(s.ipc),
    Set("none", "waitInit", "skipped", "starting", "live", "stopping", "stopped").contains(s.svc),
    s.tpc.keys() == Turns, Turns.forall(t => Set("idle", "queued", "lease", "turn", "done", "refused").contains(s.tpc.get(t))),
    Turns.union(Set(None)).contains(s.owner), Set("none", "drain", "services", "svcwait").contains(s.apc), s.aid.in(0.to(MaxAttempts)),
    s.outcome.keys() == Attempts, Attempts.forall(a => Set("pending", "ok", "err").contains(s.outcome.get(a))),
    s.spc.keys() == Stoppers, Stoppers.forall(c => Set("idle", "be", "drain", "awaitStrict", "done").contains(s.spc.get(c))),
    Set("none", "running", "ok", "err").contains(s.strictP)
  }
  val PrepareStopOnce = s.prepareCalls <= 1 and (s.stopReq implies s.prepareCalls == 1)
  val SingleAttempt = s.stopPromise == (s.apc != "none")
  val TurnsAbortedAfterStop = Turns.forall(t => s.tpc.get(t) == "turn" and s.stopReq implies s.aborted.get(t))
  val NoStartOnFailedInit = Set("starting", "live").contains(s.svc) implies not(s.initFailed)
  val NoLiveAfterStopped = s.stopped implies (s.svc != "live" or s.apc == "services")
  val StoppedIsQuiet = LifecycleState == "stopped" implies
    s.closed and s.svc != "live" and (s.svc == "stopping" implies s.svcLate or s.afast)
  val StrictMeansQuiescent = s.strictP == "ok" implies
    Pending.size() == 0 and not(s.failures) and not(Set("starting", "live", "stopping").contains(s.svc))
  temporal NoAdmissionAfterClose = always(admissionSafe)
  temporal StopperReturns = Stoppers.forall(c =>
    Set("be", "drain", "awaitStrict").contains(s.spc.get(c)).leadsTo(s.spc.get(c) == "done"))
  temporal TurnsFinish = Turns.forall(t => Set("queued", "lease", "turn").contains(s.tpc.get(t)).leadsTo(s.tpc.get(t) == "done"))
  temporal EagerStartSettles = (s.svc == "waitInit").leadsTo(Set("skipped", "live", "stopped").contains(s.svc))
}

module CoreRuntimeLifecycle {
  import CoreRuntimeLifecycleTemplate(Turns = Set(1, 2), Stoppers = Set(3, 4), MaxAttempts = 2, None = 0) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val sourceState = Model::s
  val sourceLifecycle = Model::LifecycleState
  action sourceRegister = Model::IRegister
  action sourceCoreInit(ok: bool): bool = Model::ICoreWith(ok)
  action sourceServiceResume = Model::SvcResume
  action sourceServiceStarted = Model::SvcStarted
  action sourceServiceStopDone = Model::SvcStopDone
  action sourceAdmit(turnId: int): bool = Model::TAdmit(turnId)
  action sourceGrant = Model::TGrant
  action sourceRun(turnId: int): bool = Model::TRun(turnId)
  action sourceFinish(turnId: int): bool = Model::TFinish(turnId)
  action sourceStop(caller: int, fast: bool, strict: bool): bool = Model::SCallWith(caller, fast, strict)
  action sourceDrained = Model::ADrained
  action sourceServiceStop = Model::AServices
  action sourceServiceSettled = Model::ASvcDone
  action sourceBestDone(caller: int): bool = Model::SBestEffortDone(caller)
  action sourceStrictDrained(caller: int): bool = Model::SStrictDrain(caller)
  action sourceStrictJoinDone(caller: int): bool = Model::SAwaitStrict(caller)
  val safety = Model::TypeOK and Model::PrepareStopOnce and Model::SingleAttempt and Model::TurnsAbortedAfterStop
    and Model::NoStartOnFailedInit and Model::NoLiveAfterStopped and Model::StoppedIsQuiet and Model::StrictMeansQuiescent
  temporal CheckedTemporal = Model::Fairness implies Model::NoAdmissionAfterClose and Model::StopperReturns
    and Model::TurnsFinish and Model::EagerStartSettles
  run leaseEntersAbortedAfterCloseTest = init.then(Model::TAdmit(1)).then(Model::TGrant)
    .then(Model::SCallWith(3, false, true)).then(Model::TRun(1)).then(Model::TAdmit(2))
    .expect(Model::s.aborted.get(1) and Model::s.tpc.get(2) == "refused" and Model::admissionSafe and safety)
  run timeoutAndRetryKeepSinglePrepareTest = init.then(Model::TAdmit(1)).then(Model::TGrant)
    .then(Model::SCallWith(3, true, false)).then(Model::ATimeout).then(Model::SBestEffortDone(3))
    .then(Model::SCallWith(4, false, true)).then(Model::TRun(1)).then(Model::TFinish(1))
    .then(Model::ADrained).then(Model::AServices).then(Model::ASvcDone).then(Model::SBestEffortDone(4)).then(Model::SStrictDrain(4))
    .expect(Model::s.strictP == "err" and Model::s.prepareCalls == 1 and safety)
}
