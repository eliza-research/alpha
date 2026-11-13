/// Current shared Maps screen guidance, explicit rerouting and owned screen-off sessions.
module NavigationProgress {
  type Navigation = {
    foreground: bool, permission: bool, releases: int, selected: bool,
    routePhase: str, route: int, previousRoute: int, routeRequests: int, pendingRoutes: Set[int], abortedRequests: Set[int],
    navigating: bool, navSession: int, navRoute: int, navStep: int, navCleared: int, follow: bool,
    arrived: bool, offRoute: bool, rerouting: bool, rerouteCleared: bool,
    fixPresent: bool, fixUsable: bool, accuracy: int, displayedStep: int, canReroute: bool,
    watch: int, watchStops: int, bridgeGeneration: int, bridgeOwner: int, bridgeStage: str,
    pendingAvailability: Set[int], pendingStarts: Set[int], registered: Set[int], bridgeDirty: bool,
    backgroundRunning: bool, backgroundStops: int, startCommands: List[int], stopCommands: List[int],
    updateCommands: List[int], pendingUpdates: int -> int
  }
  var s: Navigation
  pure val nativeOwners = 1.to(5)
  pure val positions = Set("past", "near-first", "away-first", "near-second", "near-arrival",
    "away-arrival", "off-76", "off-99", "off-101")
  pure def usable(accuracy: int, precise: bool, age: int): bool =
    precise and accuracy >= 0 and accuracy <= 50 and age >= -5000 and age <= 30000
  pure def projection(state: Navigation): Navigation = {...state,
    displayedStep: if (state.navigating and state.fixPresent and state.routePhase == "ready"
      and not(state.arrived or state.rerouting)) state.navStep else -1,
    canReroute: state.navigating and state.offRoute and state.fixUsable and not(state.rerouting)}
  pure def clearBridge(state: Navigation): Navigation = {...state,
    bridgeOwner: 0, bridgeStage: "none", backgroundRunning: false, bridgeDirty: false,
    registered: state.registered.exclude(Set(state.bridgeOwner))}
  pure def stopBridge(state: Navigation): Navigation = clearBridge({...state,
    bridgeGeneration: state.bridgeGeneration + 1,
    stopCommands: if (state.bridgeOwner == 0) state.stopCommands else state.stopCommands.append(state.bridgeOwner)})
  pure def stopWatch(state: Navigation): Navigation = {...state, watch: 0, watchStops: state.watchStops + 1}
  pure def endGuidance(state: Navigation): Navigation = projection(stopWatch(stopBridge({...state,
    navigating: false, navSession: state.navSession + 1, navRoute: 0, rerouting: false, offRoute: false,
    fixPresent: false, fixUsable: false, accuracy: -1})))
  pure def release(state: Navigation): Navigation = endGuidance({...state,
    releases: state.releases + 1, selected: false, routePhase: "none", route: 0,
    abortedRequests: if (state.selected) state.abortedRequests.union(Set(state.routeRequests)) else state.abortedRequests})
  pure def refusedBackground(state: Navigation): Navigation = {
    val stopped = stopBridge(state)
    if (state.foreground or state.permission) stopped else release(stopped)
  }
  pure def requestUpdate(state: Navigation): Navigation = {...state,
    updateCommands: state.updateCommands.append(state.bridgeOwner),
    pendingUpdates: state.pendingUpdates.set(state.bridgeOwner, state.pendingUpdates.get(state.bridgeOwner) + 1)}
  pure def bridgeLost(state: Navigation, reason: str): Navigation = {
    val noted = {...state, backgroundStops: state.backgroundStops + 1}
    if (reason == "notification") endGuidance(noted)
    else if (state.foreground) noted else release(noted)
  }
  // Init is after one verified provider route is selected and before the user's Start.
  action init = s' = {foreground: true, permission: false, releases: 0, selected: true,
    routePhase: "ready", route: 1, previousRoute: 1, routeRequests: 1, pendingRoutes: Set(), abortedRequests: Set(),
    navigating: false, navSession: 0, navRoute: 0, navStep: 0, navCleared: 0, follow: true, arrived: false,
    offRoute: false, rerouting: false, rerouteCleared: false, fixPresent: false, fixUsable: false,
    accuracy: -1, displayedStep: -1, canReroute: false, watch: 0, watchStops: 0,
    bridgeGeneration: 0, bridgeOwner: 0, bridgeStage: "none", pendingAvailability: Set(),
    pendingStarts: Set(), registered: Set(), bridgeDirty: false, backgroundRunning: false,
    backgroundStops: 0, startCommands: [], stopCommands: [], updateCommands: [], pendingUpdates: nativeOwners.mapBy(_ => 0)}
  action start(nativeEnabled: bool): bool = all {
    s.selected, s.routePhase == "ready", s.foreground, not(s.navigating), s.navSession < 5,
    val sessionId = s.navSession + 1
    val starting = stopBridge({...s, navigating: true, navSession: sessionId, navRoute: s.route, navStep: 0, navCleared: 0,
      follow: true, arrived: false, offRoute: false, rerouting: false,
      fixPresent: false, fixUsable: false, accuracy: -1, watch: sessionId})
    s' = projection(if (nativeEnabled) {...starting, bridgeStage: "availability", bridgeOwner: sessionId,
      pendingAvailability: s.pendingAvailability.union(Set(sessionId))} else starting)
  }
  action available(id: int, allowed: bool): bool = all {
    id.in(s.pendingAvailability),
    val answered = {...s, pendingAvailability: s.pendingAvailability.exclude(Set(id))}
    s' = if (id != s.bridgeOwner) answered
      else if (not(allowed)) refusedBackground(answered)
      else {...answered, bridgeStage: "starting", registered: s.registered.union(Set(id)),
        pendingStarts: s.pendingStarts.union(Set(id)), startCommands: s.startCommands.append(id)}
  }
  action backgroundAck(id: int, accepted: bool): bool = all {
    id.in(s.pendingStarts),
    val answered = {...s, pendingStarts: s.pendingStarts.exclude(Set(id))}
    s' = if (id != s.bridgeOwner)
      (if (accepted) {...answered, stopCommands: s.stopCommands.append(id)} else answered)
      else if (not(accepted)) refusedBackground(answered)
      else {
        val running = {...answered, bridgeStage: "running", backgroundRunning: true, bridgeDirty: false}
        if (s.bridgeDirty) requestUpdate(running) else running
      }
  }
  action backgroundStopped(id: int, reason: str): bool = all {
    reason.in(Set("notification", "unavailable", "task-removed")),
    s' = if (id.in(s.registered) and id == s.bridgeOwner) bridgeLost(clearBridge(s), reason) else s
  }
  action updateResult(id: int, active: bool): bool = all {
    id.in(nativeOwners),
    s.pendingUpdates.get(id) > 0,
    val answered = {...s, pendingUpdates: s.pendingUpdates.set(id, s.pendingUpdates.get(id) - 1)}
    s' = if (not(active) and id == s.bridgeOwner) bridgeLost(stopBridge(answered), "unavailable") else answered
  }
  pure def advanceStep(index: int, point: str): int =
    if (index == 0 and point == "near-first") 1
    else if (index == 1 and point == "near-second") 2 else index
  // Initial straight route: every class below is over 100m clear of the active
  // maneuver, including index0/near-second (112m) and index1/past (115m).
  // Thus all admitted accuracies meet >max(60,2*accuracy); onRoute is separate.
  pure def clearBeyond(index: int, point: str): bool = index < 2 and
    (point.in(Set("past", "near-arrival", "away-arrival", "off-76", "off-99", "off-101"))
      or (index == 0 and point == "near-second"))
  pure def advanceHold(index: int, cleared: int, point: str, onRoute: bool): {index: int, cleared: int} = {
    val advancedIndex = advanceStep(index, point)
    val prior = if (advancedIndex == index) cleared else 0
    if (onRoute and clearBeyond(advancedIndex, point))
      (if (prior == 1) {index: advancedIndex + 1, cleared: 0} else {index: advancedIndex, cleared: 1})
    else {index: advancedIndex, cleared: 0}
  }
  pure def distance(point: str): int =
    if (point == "off-76") 76 else if (point == "off-99") 99 else if (point == "off-101") 101 else 0
  action fix(id: int, accuracy: int, precise: bool, age: int, point: str, description: str): bool = all {
    description.in(Set("unchanged", "changed", "matches-start")),
    point.in(positions), accuracy.in(Set(0, 30, 31, 50, 51)), age.in(Set(-5001, -5000, 0, 30000, 30001)),
    val current = {...s, fixPresent: true, fixUsable: true, accuracy: accuracy}
    val nearest = distance(point)
    val limit = if (accuracy * 2 > 75) accuracy * 2 else 75
    s' = if (not(s.navigating) or s.arrived or id != s.navSession or id != s.watch) s
      else if (not(usable(accuracy, precise, age))) projection({...s, fixPresent: false, fixUsable: false, accuracy: -1})
      else if (s.rerouting or s.routePhase != "ready") projection(current)
      else if (point == "near-arrival" and accuracy <= 30)
        projection(stopWatch(stopBridge({...current, arrived: true, offRoute: false})))
      else {
        val hold = advanceHold(s.navStep, s.navCleared, point, nearest <= limit)
        val nextFix = projection({...current, navStep: hold.index, navCleared: hold.cleared, offRoute: nearest > limit,
          bridgeDirty: if (s.bridgeStage == "starting" and description != "unchanged") description == "changed" else s.bridgeDirty})
        if (s.bridgeStage == "running" and description != "unchanged") requestUpdate(nextFix) else nextFix
      }
  }
  action ageFix = s' = projection({...s, fixUsable: false})
  action locationFailed(id: int): bool =
    s' = if (s.navigating and not(s.arrived) and id == s.navSession) endGuidance(s) else s
  action reroute = all {
    s.routeRequests < 3,
    val requestId = s.routeRequests + 1
    s' = if (s.navigating and s.fixUsable and not(s.rerouting))
      projection({...s, rerouting: true, rerouteCleared: true, offRoute: false,
        routePhase: "loading", previousRoute: s.route, routeRequests: requestId, pendingRoutes: s.pendingRoutes.union(Set(requestId)),
        abortedRequests: s.abortedRequests.union(Set(s.routeRequests))}) else s
  }
  action routeResult(request: int, route: int): bool = all {
    request.in(s.pendingRoutes), route.in(0.to(2)),
    val answered = {...s, pendingRoutes: s.pendingRoutes.exclude(Set(request))}
    val result = {...answered, routePhase: "ready", route: if (route == 0) s.previousRoute else route}
    s' = if (not(s.selected) or request != s.routeRequests or request.in(s.abortedRequests)) answered
      else if (not(s.navigating)) projection(result)
      else if (route == 0) projection({...result, rerouting: false})
      else if (s.rerouting and s.rerouteCleared)
        projection({...result, rerouting: false, navStep: 0, navCleared: 0, navRoute: route})
      else endGuidance(result)
  }
  action end = all {s.navigating, s' = endGuidance(s)}
  action hide = all {
    s.foreground,
    val hidden = {...s, foreground: false}
    val paused = if (s.navigating) endGuidance(hidden) else hidden
    s' = if ((s.navigating and s.bridgeOwner != 0) or s.permission) hidden
      else {...paused, routePhase: if (s.routePhase == "loading") "ready" else s.routePhase,
        abortedRequests: if (s.selected) s.abortedRequests.union(Set(s.routeRequests)) else s.abortedRequests}
  }
  action show = s' = {...s, foreground: true}
  action holdPermission(value: bool): bool = all {s.foreground, s' = {...s, permission: value}}
  action stopFollowing = s' = if (s.navigating) {...s, follow: false} else s
  action recenter = all {s.navigating, s' = {...s, follow: true}}
  action step = any {
    start(true), start(false), end, hide, show, holdPermission(true), holdPermission(false), ageFix, reroute,
    stopFollowing, recenter, locationFailed(s.navSession), locationFailed(s.navSession - 1),
    available(s.bridgeOwner, true), available(s.bridgeOwner, false),
    backgroundAck(s.bridgeOwner, true), backgroundAck(s.bridgeOwner, false),
    {nondet id = 1.to(5).oneOf()
     backgroundAck(id, true)},
    backgroundStopped(s.bridgeOwner, "notification"), backgroundStopped(s.bridgeOwner, "unavailable"),
    updateResult(if (s.bridgeOwner == 0) 1 else s.bridgeOwner, false), routeResult(s.routeRequests, 0), routeResult(s.routeRequests, 2),
    fix(s.navSession, 30, true, 0, "near-first", "changed"), fix(s.navSession, 30, true, 0, "near-second", "changed"),
    fix(s.navSession, 30, true, 0, "off-76", "changed"), fix(s.navSession, 30, true, 0, "near-arrival", "changed"),
    fix(s.navSession, 31, true, 0, "near-arrival", "changed"), fix(s.navSession, 30, false, 0, "past", "changed"),
    s' = s
  }
  val CursorRange = s.navStep.in(0.to(2)) and s.displayedStep.in(Set(-1, 0, 1, 2))
  val ArrivalAccuracy = s.arrived and s.navigating implies s.fixPresent and s.accuracy <= 30
  val ArrivalStopsResources = s.arrived implies s.watch == 0 and s.bridgeOwner == 0 and not(s.backgroundRunning)
  val RerouteOwnsGuidance = s.rerouting implies s.navigating and s.rerouteCleared and s.routePhase == "loading"
  val NativeSessionOwned = s.bridgeOwner != 0 implies s.navigating and s.bridgeOwner == s.navSession
  val RunningHasExactNativeStart = s.backgroundRunning implies s.bridgeStage == "running" and
    s.startCommands.indices().exists(i => s.startCommands.nth(i) == s.bridgeOwner)
  val ReleasedHasNoGuidance = not(s.selected) implies not(s.navigating) and s.navRoute == 0 and s.watch == 0
  val HiddenWatchHasPermissionOrBridge = not(s.foreground) and s.watch != 0 implies
    s.permission or s.bridgeOwner != 0
  val StoppedCommandsCannotTargetOwner = s.bridgeOwner != 0 implies
    not(s.stopCommands.indices().exists(i => s.stopCommands.nth(i) == s.bridgeOwner))
  val ClearanceCounterRange = s.navCleared.in(0.to(1))
  val LastStepHasNoClearance = s.navStep == 2 implies s.navCleared == 0
  val safety = CursorRange and ArrivalAccuracy and ArrivalStopsResources and RerouteOwnsGuidance and NativeSessionOwned and
    RunningHasExactNativeStart and ReleasedHasNoGuidance and HiddenWatchHasPermissionOrBridge and StoppedCommandsCannotTargetOwner and
    ClearanceCounterRange and LastStepHasNoClearance

  run sparseProjectionDoesNotSkipManeuverTest = init.then(start(false))
    .then(fix(1, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 0 and s.displayedStep == 0)
  run exactManeuverAndArrivalClassesTest = init.then(start(false))
    .then(fix(1, 30, true, 0, "away-first", "changed")).expect(s.navStep == 0)
    .then(fix(1, 30, true, 0, "near-first", "changed")).expect(s.navStep == 1)
    .then(fix(1, 31, true, 0, "near-arrival", "changed")).expect(not(s.arrived))
    .then(fix(1, 30, true, 0, "away-arrival", "changed")).expect(not(s.arrived))
    .then(fix(1, 30, true, 0, "near-arrival", "changed")).expect(safety and s.arrived)
  run agedFixIsRetainedButCannotRerouteTest = init.then(start(false)).then(fix(1, 30, true, 0, "off-76", "changed"))
    .then(ageFix).then(reroute).expect(safety and s.fixPresent and not(s.canReroute) and s.routeRequests == 1)
  run rerouteFailureKeepsGuidanceTest = init.then(start(true)).then(available(1, true)).then(backgroundAck(1, true))
    .then(fix(1, 30, true, 0, "off-76", "changed")).then(reroute).then(routeResult(2, 0))
    .expect(safety and s.navigating and s.routePhase == "ready" and s.route == 1 and s.stopCommands == [])
  run retiredStartStopsOnlyItsOwnNativeIdTest = init.then(start(true)).then(available(1, true)).then(end)
    .then(start(true)).then(available(3, true)).then(backgroundAck(3, true)).then(backgroundAck(1, true))
    .expect(safety and s.bridgeOwner == 3 and s.backgroundRunning and s.stopCommands == [1, 1])
  run endingAllowsRouteReplyWithoutRevivingGuidanceTest = init.then(start(false))
    .then(fix(1, 30, true, 0, "off-76", "changed")).then(reroute).then(end).then(routeResult(2, 2))
    .expect(safety and s.route == 2 and not(s.navigating) and s.navRoute == 0)
  run hidingWithoutBackgroundKeepsAdmittedRouteTest = init.then(start(false)).then(fix(1, 30, true, 0, "off-76", "changed"))
    .then(reroute).then(hide).then(routeResult(2, 2))
    .expect(safety and s.routePhase == "ready" and s.route == 1 and not(s.navigating) and s.releases == 0)
  run pendingBackgroundKeepsHiddenScreenTest = init.then(start(true)).then(hide)
    .then(available(1, true)).then(backgroundAck(1, true)).expect(safety and s.backgroundRunning and s.releases == 0)
  run dragAndRecenterTest = init.then(start(false)).then(stopFollowing).expect(not(s.follow))
    .then(recenter).expect(safety and s.follow)
  run hiddenAvailabilityRefusalReleasesWatchTest = init.then(start(true)).then(hide)
    .then(available(1, false)).expect(safety and s.watch == 0 and not(s.navigating) and s.releases == 1)
  run hiddenNativeRefusalReleasesWatchTest = init.then(start(true)).then(available(1, true)).then(hide)
    .then(backgroundAck(1, false)).expect(safety and s.watch == 0 and s.releases == 1)
  run hiddenPermissionSurvivesBackgroundRefusalTest = init.then(start(true)).then(holdPermission(true))
    .then(hide).then(available(1, false)).expect(safety and s.watch == 1 and s.releases == 0)
  run twoClearFixesAdvanceOnceTest = init.then(start(false))
    .then(fix(1, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 0 and s.navCleared == 1)
    .then(fix(1, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 1 and s.navCleared == 0)
    .then(fix(1, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 1 and s.navCleared == 1)
    .then(fix(1, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 2 and s.navCleared == 0)
  run nonClearFixResetsClearanceTest = init.then(start(false))
    .then(fix(1, 30, true, 0, "past", "changed"))
    .then(fix(1, 30, true, 0, "away-first", "changed")).expect(safety and s.navStep == 0 and s.navCleared == 0)
    .then(fix(1, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 0 and s.navCleared == 1)
  run offRouteFixResetsClearanceTest = init.then(start(false))
    .then(fix(1, 30, true, 0, "past", "changed"))
    .then(fix(1, 30, true, 0, "off-76", "changed")).expect(safety and s.navStep == 0 and s.navCleared == 0)
    .then(fix(1, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 0 and s.navCleared == 1)
  run retiredWatchCannotConfirmClearanceTest = init.then(start(false)).then(end).then(start(false))
    .then(fix(3, 30, true, 0, "past", "changed"))
    .then(fix(1, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 0 and s.navCleared == 1)
    .then(fix(3, 30, true, 0, "past", "changed")).expect(safety and s.navStep == 1 and s.navCleared == 0)
}
