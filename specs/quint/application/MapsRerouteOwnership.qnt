module MapsRerouteOwnership {
  type State = {
    session: int, guidanceSession: int, guidanceRoute: int, rerouting: bool, fixReady: bool,
    phase: str, route: int, origin: int, requestOrigins: List[int],
    pending: Set[int], aborted: Set[int], watches: int,
    agent: str, agentSession: int, settledFor: int
  }
  var s: State

  action init = s' = {
    session: 0, guidanceSession: 0, guidanceRoute: 0, rerouting: false, fixReady: false,
    phase: "ready", route: 1, origin: 1, requestOrigins: [1],
    pending: Set(), aborted: Set(), watches: 0, agent: "none", agentSession: 0, settledFor: 0
  }

  pure def stop(value: State): State = {...value, session: value.session + 1,
    guidanceSession: 0, guidanceRoute: 0, rerouting: false, fixReady: false, watches: 0}

  action start = all {
    s.guidanceSession == 0, s.phase == "ready", s.session < 4,
    val generation = s.session + 1
    s' = {...s, session: generation, guidanceSession: generation, guidanceRoute: s.route, watches: 1},
  }
  action fix = all {
    s.guidanceSession != 0,
    s' = {...s, fixReady: true},
  }
  action agentReroute = all {
    s.guidanceSession != 0, s.fixReady, s.requestOrigins == [1], s.agent == "none",
    s' = {...s, rerouting: true, phase: "loading",
      requestOrigins: [1, 2], pending: Set(2), agent: "pending", agentSession: s.guidanceSession},
  }
  action duplicateTap = all { s.rerouting, s' = s }
  action end = all { s.guidanceSession != 0, s' = stop(s) }

  action replan = all {
    s.guidanceSession == 0, s.requestOrigins == [1, 2],
    s' = {...s, phase: "loading", route: 0, origin: 0, requestOrigins: [1, 2, 3],
      pending: s.pending.union(Set(3)), aborted: s.aborted.union(Set(2))},
  }

  action routeReply(id: int, publicId: int): bool = all {
    id.in(s.pending), publicId.in(if (id == 2) Set(0, 1, 2) else Set(3)),
    val answered = {...s, pending: s.pending.exclude(Set(id))}
    val current = not(id.in(s.aborted))
    val exactGuidance = id == 2 and current and s.rerouting and s.agentSession == s.guidanceSession
    val planned = if (not(current)) answered
      else if (publicId == 0 and id == 2) {...answered, phase: "ready", route: 1, origin: 1}
      else if (publicId == 0) {...answered, phase: "error", route: 0, origin: 0}
      else {...answered, phase: "ready", route: publicId, origin: id}
    val guided = if (not(exactGuidance)) planned
      else if (publicId == 0) {...planned, rerouting: false}
      else {...planned, rerouting: false, guidanceRoute: publicId}
    s' = if (id != 2) guided
      else if (not(exactGuidance)) {...guided, agent: "retired"}
      else {...guided, agent: if (publicId == 0) "refused" else "accepted", settledFor: s.guidanceSession},
  }

  action step = any {
    start, fix, agentReroute, duplicateTap, end, replan,
    { nondet publicId = Set(0, 1, 2).oneOf(); routeReply(2, publicId) },
    routeReply(3, 3), s' = s
  }

  val GuidanceOwnsWatch = if (s.guidanceSession == 0)
    s.watches == 0 and s.guidanceRoute == 0 and not(s.fixReady or s.rerouting)
    else s.watches == 1 and s.guidanceSession == s.session and s.guidanceRoute != 0
  val ExactPublication =
    (s.phase == "ready" implies (s.route != 0 and s.origin != 0))
    and ((s.route == 0) == (s.origin == 0))
    and (s.rerouting implies (2.in(s.pending) and not(2.in(s.aborted)) and s.agentSession == s.guidanceSession))
    and (s.origin == 3 implies s.route == 3 and s.requestOrigins == [1, 2, 3])
  val ExactAgentSettlement =
    (s.agent.in(Set("accepted", "refused")) implies s.settledFor != 0 and s.settledFor == s.agentSession)
    and (s.agent == "retired" implies s.settledFor == 0)
    and (s.agent == "pending") == 2.in(s.pending)
  val safety = GuidanceOwnsWatch and ExactPublication and ExactAgentSettlement

  run readyToReroute = init.then(start).then(fix).then(agentReroute)
  run replacement = readyToReroute.then(end).then(replan).then(routeReply(3, 3)).then(start)
  run samePublicIdCanBeNewRouteTest = readyToReroute.then(duplicateTap).then(routeReply(2, 1))
    .expect(safety and s.agent == "accepted" and s.guidanceRoute == 1 and s.origin == 2)
  run exactLiveRefusalKeepsGuidanceTest = readyToReroute.then(routeReply(2, 0))
    .expect(safety and s.agent == "refused" and s.phase == "ready" and s.watches == 1)
  run lateSuccessCannotReturnReplacementTest = replacement.then(routeReply(2, 2))
    .expect(safety and s.agent == "retired" and s.guidanceSession == 3 and s.guidanceRoute == 3 and s.origin == 3)
  run lateRefusalCannotReturnReplacementTest = replacement.then(routeReply(2, 0))
    .expect(safety and s.agent == "retired" and s.guidanceSession == 3 and s.guidanceRoute == 3 and s.origin == 3)
  run endKeepsAdmittedReviewRouteTest = readyToReroute.then(end).then(routeReply(2, 2))
    .expect(safety and s.agent == "retired" and s.guidanceSession == 0 and s.origin == 2)
}
