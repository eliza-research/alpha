/// Maps keeps navigation on the phone while service requests are generation fenced.
module MapsNavigation {
  type Navigation = {
    owner: int, epoch: int, requestEpoch: int, generation: int, requestGeneration: int,
    phase: str, route: int, previousRoute: int, routeOwner: int,
    locationGranted: bool, fixFresh: bool, guidance: bool, assistant: bool,
    foreground: bool, directStart: bool, failure: str, rerouting: bool
  }
  var s: Navigation
  action init = s' = {
    owner: 1, epoch: 0, requestEpoch: 0, generation: 0, requestGeneration: 0,
    phase: "idle", route: 0, previousRoute: 0, routeOwner: 0,
    locationGranted: false, fixFresh: false, guidance: false, assistant: false,
    foreground: true, directStart: false, failure: "none", rerouting: false }
  action grantLocation = s' = { ...s, locationGranted: true }
  action receiveFix(fresh: bool): bool = all {
    s.locationGranted, s' = { ...s, fixFresh: fresh }
  }
  action requestRoute = all {
    s.foreground, not(s.guidance), s.generation < 2,
    s' = { ...s, phase: if (s.locationGranted and s.fixFresh) "planning" else "awaiting-location",
      generation: s.generation + 1, requestGeneration: s.generation + 1,
      requestEpoch: s.epoch, previousRoute: s.route, failure: "none" }
  }
  action resumeWithFix = all {
    s.phase == "awaiting-location", s.locationGranted, s.fixFresh,
    s' = { ...s, phase: "planning" }
  }
  action routeReply(generation: int, epoch: int, success: bool): bool = all {
    s.phase == "planning",
    if (generation == s.generation and epoch == s.epoch)
      s' = { ...s, phase: if (success) "ready" else "error",
        route: if (success) generation else s.previousRoute,
        routeOwner: if (success) s.owner else s.routeOwner,
        failure: if (success) "none" else "network" }
    else s' = s
  }
  action start = all {
    s.phase == "ready", s.route != 0, s.locationGranted, s.fixFresh,
    s' = { ...s, guidance: true, phase: "navigating" }
  }
  /// Agent direct start uses a separately read owner preference, defaulting to false.
  action allowDirectStart = s' = { ...s, directStart: true }
  action agentStart = all {
    s.directStart, s.phase == "ready", s.route != 0, s.locationGranted, s.fixFresh,
    s' = { ...s, guidance: true, phase: "navigating" }
  }
  action beginReroute = all {
    s.guidance, not(s.rerouting), s.fixFresh, s.generation < 2,
    s' = { ...s, rerouting: true, previousRoute: s.route,
      generation: s.generation + 1, requestGeneration: s.generation + 1, requestEpoch: s.epoch }
  }
  action rerouteReply(success: bool): bool = all {
    s.rerouting, s.requestEpoch == s.epoch, s.requestGeneration == s.generation,
    s' = { ...s, rerouting: false, route: if (success) s.generation else s.previousRoute,
      failure: if (success) "none" else "network" }
  }
  action showAssistant = s' = { ...s, assistant: true }
  action dismissAssistant = s' = { ...s, assistant: false }
  action background = s' = { ...s, foreground: false }
  action foreground = s' = { ...s, foreground: true }
  /// Rebuilding transport for the same authenticated session preserves route ownership.
  action refreshClient = s' = s
  action staleFix = s' = { ...s, fixFresh: false }
  action stop = s' = { ...s, phase: "stopped", guidance: false, rerouting: false }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1,
      phase: "idle", route: 0, routeOwner: 0, guidance: false, rerouting: false }
  }
  action step = any {
    grantLocation, receiveFix(true), receiveFix(false), requestRoute, resumeWithFix,
    routeReply(s.generation, s.epoch, true), routeReply(s.generation, s.epoch, false),
    routeReply(0, s.epoch, true), routeReply(s.generation, 3, true), start,
    allowDirectStart, agentStart, beginReroute, rerouteReply(true), rerouteReply(false),
    showAssistant, dismissAssistant, background, foreground, refreshClient, staleFix, stop, switchOwner, s' = s
  }
  val GuidanceHasRoute = s.guidance implies s.route > 0 and s.routeOwner == s.owner
  val RerouteKeepsRoute = s.rerouting implies s.guidance and s.route == s.previousRoute
  val RetiredRouteHidden = s.route > 0 implies s.routeOwner == s.owner
  val FailedRerouteKept = s.guidance and s.failure == "network" implies s.route == s.previousRoute
  val TypeOK = s.phase.in(Set("idle", "awaiting-location", "planning", "ready", "error", "navigating", "stopped")) and s.generation.in(0.to(2)) and s.route.in(0.to(2)) and s.epoch.in(0.to(2))
  val safety = TypeOK and GuidanceHasRoute and RerouteKeepsRoute and RetiredRouteHidden and FailedRerouteKept
  run waitingForLocationTest = init.then(requestRoute).expect(s.phase == "awaiting-location")
    .then(grantLocation).then(receiveFix(true)).then(resumeWithFix)
    .then(routeReply(1, 0, true)).then(start).expect(s.guidance and safety)
  run staleReplyTest = init.then(grantLocation).then(receiveFix(true)).then(requestRoute)
    .then(routeReply(0, 0, true)).expect(s.route == 0)
    .then(routeReply(1, 0, true)).expect(s.route == 1 and safety)
  run assistantAndRerouteTest = init.then(grantLocation).then(receiveFix(true)).then(requestRoute)
    .then(routeReply(1, 0, true)).then(start).then(showAssistant).then(beginReroute)
    .then(rerouteReply(false)).expect(s.guidance and s.assistant and s.route == 1 and safety)
  run accountRetirementTest = init.then(grantLocation).then(receiveFix(true)).then(requestRoute)
    .then(routeReply(1, 0, true)).then(start).then(switchOwner)
    .expect(s.route == 0 and not(s.guidance) and safety)
  run sameAccountRefreshTest = init.then(grantLocation).then(receiveFix(true)).then(requestRoute)
    .then(refreshClient).then(routeReply(1, 0, true)).then(start).then(refreshClient)
    .expect(s.guidance and s.route == 1 and s.owner == 1 and safety)
}
