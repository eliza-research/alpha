// Plain local-agent requests across the Capacitor bridge: the renderer's abort, the native
// cancelRequest that withdraws the call, and the two request workers that dispatch owned calls.
module NativeRequestWithdrawal {
  // phase is the native worker's progress: "none", "queued" (admitted, waiting for a worker),
  // "enrolling" (a worker holds it, before the guard that precedes dispatch), "sent" (on the
  // transport, worker blocked) and "finished". call is the bridge call's answer: "none", "open",
  // "resolved", "withdrawn" or "superseded". renderer is the caller's view: "none", "waiting",
  // "aborted" (abort seen, cancelRequest not yet delivered), "cancelled" (delivered) or "settled".
  type State = {
    phase: int -> str, call: int -> str, renderer: int -> str,
    withdrawable: Set[int], sent: Set[int], withdrawnAt: int -> str, answers: int -> int,
    outcome: str
  }
  pure val Requests = Set(1, 2, 3)
  pure val Workers = 2
  var s: State
  action check(condition: bool): bool = all {assert(condition), s' = s}
  action init = s' = {
    phase: Requests.mapBy(_ => "none"), call: Requests.mapBy(_ => "none"),
    renderer: Requests.mapBy(_ => "none"), withdrawable: Set(), sent: Set(),
    withdrawnAt: Requests.mapBy(_ => "none"), answers: Requests.mapBy(_ => 0), outcome: "none"
  }
  pure def busy(state: State): int =
    Requests.filter(r => state.phase.get(r) == "enrolling" or state.phase.get(r) == "sent").size()
  // The renderer sends the request with a fresh withdrawal id; native admits it as a pending call.
  action request(r: int): bool = all {
    r.in(Requests), s.phase.get(r) == "none",
    s' = {phase: s.phase.set(r, "queued"), call: s.call.set(r, "open"), renderer: s.renderer.set(r, "waiting"),
      withdrawable: s.withdrawable.union(Set(r)), outcome: "admitted", ...s}
  }
  // A free worker takes a queued call. One that is no longer pending stops at the first guard.
  action take(r: int): bool = all {
    r.in(Requests), s.phase.get(r) == "queued", busy(s) < Workers,
    if (s.call.get(r) == "open") s' = {phase: s.phase.set(r, "enrolling"), outcome: "enrolling", ...s}
    else s' = {phase: s.phase.set(r, "finished"), withdrawable: s.withdrawable.exclude(Set(r)), outcome: "dropped-queued", ...s}
  }
  // The guard between enrollment and dispatch: only a call that is still pending reaches the runtime.
  action dispatch(r: int): bool = all {
    r.in(Requests), s.phase.get(r) == "enrolling",
    if (s.call.get(r) == "open") s' = {phase: s.phase.set(r, "sent"), sent: s.sent.union(Set(r)), outcome: "sent", ...s}
    else s' = {phase: s.phase.set(r, "finished"), withdrawable: s.withdrawable.exclude(Set(r)), outcome: "dropped-enrolling", ...s}
  }
  // The transport answers or times out. Only a call that is still pending is resolved.
  action transportAnswers(r: int): bool = all {
    r.in(Requests), s.phase.get(r) == "sent",
    s' = {phase: s.phase.set(r, "finished"), withdrawable: s.withdrawable.exclude(Set(r)),
      call: if (s.call.get(r) == "open") s.call.set(r, "resolved") else s.call,
      answers: if (s.call.get(r) == "open") s.answers.setBy(r, n => n + 1) else s.answers,
      renderer: if (s.call.get(r) == "open" and s.renderer.get(r) == "waiting") s.renderer.set(r, "settled") else s.renderer,
      outcome: if (s.call.get(r) == "open") "resolved" else "answer-discarded", ...s}
  }
  // The caller's signal aborts: the renderer stops waiting at once and sends cancelRequest.
  action abort(r: int): bool = all {
    r.in(Requests), s.renderer.get(r) == "waiting",
    s' = {renderer: s.renderer.set(r, "aborted"), outcome: "aborted", ...s}
  }
  // cancelRequest arrives on the bridge. A call still registered and pending is answered now and
  // stops being owned; anything else (finished, superseded) is left alone.
  action cancelRequest(r: int): bool = all {
    r.in(Requests), s.renderer.get(r) == "aborted",
    if (s.withdrawable.contains(r) and s.call.get(r) == "open")
      s' = {renderer: s.renderer.set(r, "cancelled"), call: s.call.set(r, "withdrawn"),
        withdrawable: s.withdrawable.exclude(Set(r)), withdrawnAt: s.withdrawnAt.set(r, s.phase.get(r)),
        answers: s.answers.setBy(r, n => n + 1), outcome: "withdrawn", ...s}
    else s' = {renderer: s.renderer.set(r, "cancelled"), withdrawable: s.withdrawable.exclude(Set(r)),
      outcome: "nothing-to-withdraw", ...s}
  }
  // A lifecycle change (start, stop, destroyed bridge) answers every pending call of the surface.
  action supersede: bool = all {
    Requests.exists(r => s.call.get(r) == "open"),
    s' = {call: s.call.keys().mapBy(r => if (s.call.get(r) == "open") "superseded" else s.call.get(r)),
      answers: s.answers.keys().mapBy(r => if (s.call.get(r) == "open") s.answers.get(r) + 1 else s.answers.get(r)),
      renderer: s.renderer.keys().mapBy(r => if (s.call.get(r) == "open" and s.renderer.get(r) == "waiting") "settled" else s.renderer.get(r)),
      outcome: "superseded", ...s}
  }
  action step = any {
    nondet r = Requests.oneOf()
    any {request(r), take(r), dispatch(r), transportAnswers(r), abort(r), cancelRequest(r)},
    supersede,
    s' = s
  }

  val TypeOK = Requests.forall(r => and {
    s.phase.get(r).in(Set("none", "queued", "enrolling", "sent", "finished")),
    s.call.get(r).in(Set("none", "open", "resolved", "withdrawn", "superseded")),
    s.renderer.get(r).in(Set("none", "waiting", "aborted", "cancelled", "settled")),
    s.withdrawnAt.get(r).in(Set("none", "queued", "enrolling", "sent"))
  })
  // A request withdrawn before its worker passed the dispatch guard never reaches the runtime.
  val WithdrawnBeforeDispatchNeverSent = Requests.forall(r =>
    s.withdrawnAt.get(r).in(Set("queued", "enrolling")) implies not(s.sent.contains(r)))
  // Only a call that was pending when its worker reached the guard is on the transport.
  val SentWasOwned = Requests.forall(r => s.phase.get(r) == "sent" implies s.sent.contains(r))
  // Every bridge call is answered at most once, whichever of answer, withdrawal or supersession wins.
  val AnsweredAtMostOnce = Requests.forall(r => s.answers.get(r) <= 1 and (s.call.get(r) == "open" implies s.answers.get(r) == 0))
  // Once cancelRequest has been delivered the native call is no longer pending.
  val DeliveredCancellationAnswersCall = Requests.forall(r => s.renderer.get(r) == "cancelled" implies s.call.get(r) != "open")
  // The withdrawal registry holds only calls whose worker has not finished, so it cannot grow.
  val RegistryHoldsLiveWorkOnly = s.withdrawable.forall(r => s.phase.get(r).in(Set("queued", "enrolling", "sent")))
  val WorkersBounded = busy(s) <= Workers
  val safety = and {TypeOK, WithdrawnBeforeDispatchNeverSent, SentWasOwned, AnsweredAtMostOnce,
    DeliveredCancellationAnswersCall, RegistryHoldsLiveWorkOnly, WorkersBounded}

  val WithdrawnWhileQueuedWitness = Requests.exists(r => s.withdrawnAt.get(r) == "queued" and s.phase.get(r) == "finished")
  val WithdrawnWhileEnrollingWitness = Requests.exists(r => s.withdrawnAt.get(r) == "enrolling" and s.phase.get(r) == "finished")
  // Withdrawal after dispatch answers the call but the worker stays on the transport.
  val WithdrawnAfterDispatchHoldsWorkerWitness = Requests.exists(r => s.withdrawnAt.get(r) == "sent" and s.phase.get(r) == "sent")
  val LateCancellationFindsNothingWitness = s.outcome == "nothing-to-withdraw"
  val QueuedBehindBusyWorkersWitness = busy(s) == Workers and Requests.exists(r => s.phase.get(r) == "queued")

  // Both workers are on the transport; the third request is aborted while it waits. Without a
  // withdrawal it would be dispatched as soon as a worker came free.
  run abortedQueuedRequestIsNeverSentTest = init.then(request(1)).then(take(1)).then(dispatch(1))
    .then(request(2)).then(take(2)).then(dispatch(2)).then(request(3))
    .then(check(busy(s) == Workers and s.phase.get(3) == "queued"))
    .then(abort(3)).then(cancelRequest(3))
    .then(check(s.call.get(3) == "withdrawn" and s.answers.get(3) == 1 and not(s.withdrawable.contains(3))))
    .then(transportAnswers(1)).then(take(3))
    .then(check(s.phase.get(3) == "finished" and not(s.sent.contains(3)) and s.outcome == "dropped-queued" and busy(s) == 1))
  run abortDuringEnrollmentStopsBeforeDispatchTest = init.then(request(1)).then(take(1)).then(abort(1)).then(cancelRequest(1))
    .then(check(s.withdrawnAt.get(1) == "enrolling")).then(dispatch(1))
    .then(check(s.phase.get(1) == "finished" and s.sent == Set() and s.answers.get(1) == 1))
  run abortAfterDispatchAnswersCallButKeepsWorkerTest = init.then(request(1)).then(take(1)).then(dispatch(1))
    .then(abort(1)).then(cancelRequest(1))
    .then(check(s.call.get(1) == "withdrawn" and s.phase.get(1) == "sent" and busy(s) == 1))
    .then(transportAnswers(1))
    .then(check(s.outcome == "answer-discarded" and s.answers.get(1) == 1 and busy(s) == 0))
  run completedRequestIsNotWithdrawnTest = init.then(request(1)).then(take(1)).then(dispatch(1)).then(transportAnswers(1))
    .then(check(s.call.get(1) == "resolved" and s.renderer.get(1) == "settled" and s.withdrawable == Set()))
    .then(request(2)).then(abort(2)).then(take(2)).then(dispatch(2)).then(transportAnswers(2)).then(cancelRequest(2))
    .then(check(s.outcome == "nothing-to-withdraw" and s.call.get(2) == "resolved" and s.answers.get(2) == 1))
  run supersededCallIsNotAnsweredAgainTest = init.then(request(1)).then(abort(1)).then(supersede)
    .then(cancelRequest(1))
    .then(check(s.call.get(1) == "superseded" and s.answers.get(1) == 1 and s.withdrawable == Set()))
    .then(take(1)).then(check(s.phase.get(1) == "finished" and s.sent == Set()))
}
