// Scope-keyed promise ownership in the pinned renderer digest inbox.
module RendererDigestQueue {
  type Request = {scope: str, order: int, phase: str, cancelled: bool, gets: int}
  type State = {lastOrder: int, requests: int -> Request}
  var s: State
  pure val IDs = 1.to(4)
  pure val Scopes = Set("web", "android-fallback")
  pure val Empty: Request = {scope: "", order: 0, phase: "", cancelled: false, gets: 0}
  pure def running(x: State, scope: str): Set[int] =
    IDs.filter(id => x.requests.get(id).scope == scope and x.requests.get(id).phase == "running")
  pure def queue(x: State, scope: str): Set[int] =
    IDs.filter(id => x.requests.get(id).scope == scope and x.requests.get(id).phase == "queued")

  pure def advance(x: State, scope: str): State =
    if (running(x, scope).size() > 0) x
    else {
      val pending = queue(x, scope)
      val eligible = pending.filter(id => not(x.requests.get(id).cancelled))
      val first = eligible.fold(0, (best, id) =>
        if (best == 0) id else if (x.requests.get(id).order < x.requests.get(best).order) id else best)
      val retired = pending.filter(id => x.requests.get(id).cancelled and
        (if (first == 0) true else x.requests.get(id).order < x.requests.get(first).order))
      {...x, requests: IDs.mapBy(id => {
        val request = x.requests.get(id)
        if (id == first) {...request, phase: "running", gets: 1}
        else if (retired.contains(id)) {...request, phase: "aborted"}
        else request
      })}
    }

  action init = s' = {lastOrder: 0, requests: IDs.mapBy(_ => Empty)}
  action submit(id: int, scope: str): bool = all {
    IDs.contains(id), Scopes.contains(scope), s.requests.get(id) == Empty,
    val request: Request = {...Empty, scope: scope, order: s.lastOrder + 1, phase: "queued"}
    s' = advance({...s, lastOrder: s.lastOrder + 1, requests: s.requests.set(id, request)}, scope),
  }
  action abort(id: int): bool = all {
    IDs.contains(id), Set("queued", "running").contains(s.requests.get(id).phase),
    s' = {...s, requests: s.requests.set(id, {...s.requests.get(id), cancelled: true})},
  }
  action finish(id: int, replied: bool): bool = all {
    IDs.contains(id), s.requests.get(id).phase == "running",
    val request = s.requests.get(id)
    val outcome = if (not(replied)) "refused" else if (request.cancelled) "aborted" else "complete"
    s' = advance({...s, requests: s.requests.set(id, {...request, phase: outcome})}, request.scope),
  }
  action step = any {
    { nondet id = IDs.oneOf(); nondet scope = Scopes.oneOf(); submit(id, scope) },
    { nondet id = IDs.oneOf(); abort(id) },
    { nondet id = IDs.oneOf(); nondet replied = Bool.oneOf(); finish(id, replied) },
    s' = s,
  }
  val safety = all {
    Scopes.forall(scope => running(s, scope).size() <= 1),
    Scopes.forall(scope => queue(s, scope).size() > 0 implies running(s, scope).size() == 1),
    IDs.forall(id => {
      val request = s.requests.get(id)
      (request.phase == "queued" implies request.gets == 0) and
        (Set("running", "complete", "refused").contains(request.phase) implies request.gets == 1)
    }),
  }
  run abortedQueueEntryDoesNotDispatchTest = init.then(submit(1, "web")).then(submit(2, "web"))
    .then(submit(3, "web")).then(abort(2)).then(abort(1)).then(finish(1, true))
    .expect(s.requests.get(2).phase == "aborted" and s.requests.get(2).gets == 0 and
      s.requests.get(3).phase == "running" and safety)
  run fallbackRunsIndependentlyOfTheWebScopeTest = init.then(submit(1, "web"))
    .then(submit(2, "android-fallback")).then(submit(3, "web"))
    .expect(s.requests.get(1).phase == "running" and s.requests.get(2).phase == "running" and
      s.requests.get(3).phase == "queued" and safety)
  run failedPredecessorReleasesTheScopeTest = init.then(submit(1, "android-fallback"))
    .then(submit(2, "android-fallback")).then(finish(1, false)).then(finish(2, true))
    .expect(s.requests.get(1).phase == "refused" and s.requests.get(2).phase == "complete" and safety)
}
