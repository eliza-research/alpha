// Renderer reservation and retirement of native hosted inbox setup.
module HostedBackgroundAdmission {
  type Attempt = {session: str, phase: str, active: bool, retired: bool,
    begins: int, configs: int, cancels: int, cancelFault: str, outcome: str}
  type State = {android: bool, attempts: int -> Attempt, disables: int, target: str, pauseOutcome: str}
  var s: State
  pure val IDs = Set(1, 2)
  pure val Sessions = Set("A", "B")
  pure val Faults = Set("none", "first", "all")
  pure val Empty: Attempt = {session: "", phase: "", active: false, retired: false,
    begins: 0, configs: 0, cancels: 0, cancelFault: "none", outcome: ""}
  pure def complete(a: Attempt, outcome: str): Attempt =
    {...a, phase: "done", active: false, outcome: outcome}
  pure def cancelRefused(a: Attempt, ordinal: int): bool =
    a.cancelFault == "all" or (a.cancelFault == "first" and ordinal == 1)
  pure def afterCancel(a: Attempt, count: int): Attempt =
    complete({...a, cancels: a.cancels + count},
      if (cancelRefused(a, a.cancels + count)) "cancelRefused" else if (a.retired) "aborted" else "false")
  pure def retire(a: Attempt): Attempt =
    if (not(a.active) or a.retired) a
    else {...a, retired: true, cancels: a.cancels + if (a.phase == "config") 1 else 0}

  action initFor(android: bool): bool = s' = {android: android, attempts: IDs.mapBy(_ => Empty),
    disables: 0, target: "", pauseOutcome: ""}
  action init = { nondet android = Bool.oneOf(); initFor(android) }
  action start(id: int, session: str, preaborted: bool, fault: str): bool = all {
    IDs.contains(id), Sessions.contains(session), Faults.contains(fault), s.attempts.get(id) == Empty,
    val initial = {...Empty, session: session, cancelFault: fault, retired: preaborted}
    val attempt =
      if (not(s.android)) complete(initial, "false")
      else if (preaborted) complete(initial, "aborted")
      else {...initial, active: true, phase: "begin", begins: 1}
    s' = {...s, attempts: s.attempts.set(id, attempt)},
  }
  action abort(id: int): bool = all {
    IDs.contains(id), s.attempts.get(id) != Empty,
    s' = {...s, attempts: s.attempts.set(id, retire(s.attempts.get(id)))},
  }
  action pause(session: str, ok: bool): bool = all {
    Sessions.union(Set("all")).contains(session),
    s' = {...s,
      attempts: IDs.mapBy(id => {
        val attempt = s.attempts.get(id)
        if (session == "all" or session == attempt.session) retire(attempt) else attempt
      }),
      disables: s.disables + if (s.android) 1 else 0,
      target: if (s.android) session else s.target,
      pauseOutcome: if (ok or not(s.android)) "ok" else "refused"},
  }
  action beginReply(id: int, ok: bool): bool = all {
    IDs.contains(id), s.attempts.get(id).phase == "begin",
    val a = s.attempts.get(id)
    val attempt =
      if (not(ok)) afterCancel(a, 1)
      else if (a.retired) afterCancel(a, 2)
      else {...a, phase: "config", configs: 1}
    s' = {...s, attempts: s.attempts.set(id, attempt)},
  }
  action configReply(id: int, ok: bool): bool = all {
    IDs.contains(id), s.attempts.get(id).phase == "config",
    val a = s.attempts.get(id)
    val attempt = if (ok and not(a.retired)) complete(a, "true") else afterCancel(a, 1)
    s' = {...s, attempts: s.attempts.set(id, attempt)},
  }
  action step = any {
    { nondet id = IDs.oneOf(); nondet session = Sessions.oneOf(); nondet pre = Bool.oneOf();
      nondet fault = Faults.oneOf(); start(id, session, pre, fault) },
    { nondet id = IDs.oneOf(); abort(id) },
    { nondet session = Sessions.union(Set("all")).oneOf(); nondet ok = Bool.oneOf(); pause(session, ok) },
    { nondet id = IDs.oneOf(); nondet ok = Bool.oneOf(); beginReply(id, ok) },
    { nondet id = IDs.oneOf(); nondet ok = Bool.oneOf(); configReply(id, ok) },
  }
  val safety = all {
    IDs.forall(id => {
      val a = s.attempts.get(id)
      (a.active == Set("begin", "config").contains(a.phase)) and
      (a.configs <= a.begins) and (a.cancels <= 2) and
      (a.outcome == "true" implies a.configs == 1 and not(a.retired))
    }),
    not(s.android) implies s.disables == 0 and IDs.forall(id => s.attempts.get(id).begins == 0),
  }
  run pauseTargetsOnlyTheExactSessionTest = initFor(true).then(start(1, "A", false, "none"))
    .then(start(2, "B", false, "none")).then(beginReply(1, true)).then(pause("A", true))
    .then(configReply(1, true)).then(beginReply(2, true)).then(configReply(2, true))
    .expect(s.attempts.get(1).outcome == "aborted" and s.attempts.get(2).outcome == "true" and safety)
  run cancelledReservationNeverConfiguresTest = initFor(true).then(start(1, "A", false, "none"))
    .then(abort(1)).then(beginReply(1, true))
    .expect(s.attempts.get(1).configs == 0 and s.attempts.get(1).cancels == 2 and safety)
  run browserSetupDoesNotReserveNativeStateTest = initFor(false).then(start(1, "A", true, "none"))
    .then(pause("all", false)).expect(s.attempts.get(1).outcome == "false" and s.pauseOutcome == "ok" and safety)
  run failedCancelReplyRemainsObservableTest = initFor(true).then(start(1, "A", false, "all"))
    .then(beginReply(1, true)).then(abort(1)).then(configReply(1, false))
    .expect(s.attempts.get(1).outcome == "cancelRefused" and s.attempts.get(1).cancels == 2 and safety)
}
