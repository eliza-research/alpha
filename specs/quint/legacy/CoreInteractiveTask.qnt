// Literal upstream InteractiveTask reducer model at 4787d51a142c.
module CoreInteractiveTask {
  pure val Ops = Set("op1", "op2")
  pure val Origins = Set("A", "B")
  pure val OpStates = Set("none", "prepared", "dispatched", "succeeded", "failed", "cancelled", "unknown")
  pure val Statuses = Set("active", "paused", "blocked", "waiting", "completed", "cancelled")
  pure val Results = Set("succeeded", "failed", "unknown")
  pure val Interrupts = Set("pause", "cancel", "recover", "revoke")
  type State = {status: str, auth: str, obs: str, op: str -> str, scopeB: bool, extended: bool}
  var s: State
  // Prefix monitors of the two source action properties. They do not guard steps.
  var history: {outcomesFinal: bool, revocationFinal: bool}
  val vars = s
  pure def Unresolved(status: str): bool = Set("prepared", "dispatched", "unknown").contains(status)
  val U = if (Unresolved(s.op.get("op1"))) "op1" else if (Unresolved(s.op.get("op2"))) "op2" else "none"
  val Ended = Set("completed", "cancelled").contains(s.status)
  val HasPrepared = if (U == "none") false else s.op.get(U) == "prepared"
  val HasDispatched = if (U == "none") false else s.op.get(U) == "dispatched"
  def CancelPrepared(op: str -> str): str -> str = if (HasPrepared) op.set(U, "cancelled") else op
  pure val InitialState: State = {status: "active", auth: "active", obs: "none", op: Ops.mapBy(_ => "none"), scopeB: false, extended: false}
  val Initial = s == InitialState and history.outcomesFinal and history.revocationFinal
  action Init = all {s' = InitialState, history' = {outcomesFinal: true, revocationFinal: true}}
  pure def OutcomesStep(before: State, after: State): bool = Ops.forall(o => {
    val previous = before.op.get(o)
    (Set("succeeded", "failed", "cancelled").contains(previous) implies after.op.get(o) == previous)
      and (previous != "none" implies after.op.get(o) != "none")})
  action Move(after: State): bool = all {s' = after,
    history' = {outcomesFinal: history.outcomesFinal and OutcomesStep(s, after),
      revocationFinal: history.revocationFinal and (s.auth == "revoked" implies after.auth == "revoked")}}
  action Observe(origin: str, resume: bool): bool = all {Origins.contains(origin), not(Ended), s.auth == "active",
    resume implies s.status == "paused", U != "none" implies HasPrepared, origin == "B" implies s.scopeB,
    Move({...s, op: CancelPrepared(s.op), obs: origin, status: if (resume) "active" else s.status})}
  action Extend = all {not(Ended), s.auth == "active", U != "none" implies HasPrepared, not(s.scopeB),
    Move({...s, op: CancelPrepared(s.op), obs: "none", scopeB: true, extended: true})}
  action Retract = all {s.scopeB,
    Move({...s, op: if (HasDispatched) s.op.set(U, "unknown") else CancelPrepared(s.op),
      status: if (HasDispatched) "paused" else s.status, obs: "none", scopeB: false})}
  action Interrupt(kind: str): bool = all {Interrupts.contains(kind), Set("pause", "cancel").contains(kind) implies not(Ended),
    Move({...s, op: if (HasDispatched) s.op.set(U, "unknown") else CancelPrepared(s.op),
      auth: if (kind == "revoke") "revoked" else s.auth,
      status: if (Ended) s.status else if (kind == "cancel") "cancelled" else "paused"})}
  action Prepare(op: str): bool = all {Ops.contains(op), s.status == "active", s.auth == "active", s.obs != "none",
    U == "none", s.op.get(op) == "none", Move({...s, op: s.op.set(op, "prepared")})}
  action Dispatch(op: str): bool = all {Ops.contains(op), not(Ended), U == op, s.op.get(op) == "prepared",
    Move({...s, op: s.op.set(op, "dispatched"), status: "waiting"})}
  action Result(op: str, status: str): bool = all {Ops.contains(op), Results.contains(status), not(Ended), s.op.get(op) == "dispatched",
    Move({...s, op: s.op.set(op, status), status: if (s.status != "waiting") s.status
      else if (status == "unknown") "blocked" else "active"})}
  action Reconcile(op: str, status: str): bool = all {Ops.contains(op), Results.contains(status), s.op.get(op) == "unknown",
    Move({...s, op: s.op.set(op, status), obs: if (status == "unknown") s.obs else "none",
      status: if (status != "unknown" and s.status == "blocked") "paused" else s.status})}
  action Complete = all {not(Ended), U == "none", Move({...s, status: "completed"})}
  action Next = any {Extend, Retract, Complete,
    {nondet origin = Origins.oneOf(); nondet resume = Bool.oneOf(); Observe(origin, resume)},
    {nondet kind = Interrupts.oneOf(); Interrupt(kind)},
    {nondet op = Ops.oneOf(); any {Prepare(op), Dispatch(op)}},
    {nondet op = Ops.oneOf(); nondet status = Results.oneOf(); any {Result(op, status), Reconcile(op, status)}}}
  action Stutter = all {s' = s, history' = history}
  temporal Spec = Initial and always(Next.orKeep((s, history)))
  val TypeOK = Statuses.contains(s.status) and Set("active", "revoked").contains(s.auth)
    and Origins.union(Set("none")).contains(s.obs) and s.op.keys() == Ops and Ops.forall(o => OpStates.contains(s.op.get(o)))
  val AtMostOneUnresolved = Ops.filter(o => Unresolved(s.op.get(o))).size() <= 1
  val WaitingIffDispatched = (s.status == "waiting") == Ops.exists(o => s.op.get(o) == "dispatched")
  val BlockedHasUnknown = s.status == "blocked" implies Ops.exists(o => s.op.get(o) == "unknown")
  val RevokedIsNotRunning = s.auth == "revoked" implies not(Set("active", "waiting").contains(s.status))
  val PreparedIsFenced = Ops.exists(o => s.op.get(o) == "prepared") implies s.obs != "none" and s.auth == "active" and s.status == "active"
  val ObservedOriginIsAllowed = s.obs == "B" implies s.scopeB
  val ScopeComesFromGrant = s.scopeB implies s.extended
  val EndedIsSettled = Ended implies Ops.forall(o => not(Set("prepared", "dispatched").contains(s.op.get(o))))
  temporal OutcomesAreFinal = always(history.outcomesFinal)
  temporal RevocationIsFinal = always(history.revocationFinal)
  action init = Init
  action step = any {Next, Stutter}
  action rawStep = Next
  val safety = TypeOK and AtMostOneUnresolved and WaitingIffDispatched and BlockedHasUnknown and RevokedIsNotRunning
    and PreparedIsFenced and ObservedOriginIsAllowed and ScopeComesFromGrant and EndedIsSettled
  temporal CheckedTemporal = OutcomesAreFinal and RevocationIsFinal
  run retractDispatchedOriginTest = init.then(Extend).then(Observe("B", false)).then(Prepare("op1")).then(Dispatch("op1"))
    .then(Retract).expect(s.op.get("op1") == "unknown" and s.status == "paused" and safety)
  run reconcileUnknownBeforeResumeTest = init.then(Observe("A", false)).then(Prepare("op1")).then(Dispatch("op1"))
    .then(Result("op1", "unknown")).then(Reconcile("op1", "succeeded")).then(Observe("A", true))
    .expect(s.op.get("op1") == "succeeded" and s.status == "active" and history.outcomesFinal and safety)
  run revokeCompletedTaskTest = init.then(Complete).then(Interrupt("revoke"))
    .expect(s.status == "completed" and s.auth == "revoked" and history.revocationFinal and safety)
}
