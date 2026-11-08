// Renderer maneuver cursor and retry loop, with native background-session ownership.
module NavigationProgress {
  type Navigation = {
    navigating: bool, navSession: int, route: int, navStep: int, follow: bool,
    arrived: bool, offRoute: bool, rerouting: bool, rerouteCleared: bool,
    requestGeneration: int, requestSession: int, requestRoute: int,
    fixReady: bool, accuracy: int, navDistance: int, routeDistance: int,
    lastStep: int, nearSteps: Set[int], projectedStep: int, displayedStep: int,
    retryTimer: bool, retryAttempts: int, retryDelay: int, failedReroute: bool,
    locationWatch: bool, foreground: bool, backgroundPending: bool,
    backgroundRunning: bool, bridgeRegistered: bool, nativeSession: int, nativeOwner: int,
    stoppedNativeSessions: Set[int], nativeStops: int
  }
  var s: Navigation
  action check(condition: bool): bool = all {assert(condition), s' = s}
  pure def advanced(index: int, near: Set[int]): int =
    if (index == 0 and near.contains(0))
      (if (near.contains(1)) 2 else 1)
    else if (index == 1 and near.contains(1)) 2 else index
  pure def usable(accuracy: int, precise: bool, age: int): bool =
    precise and accuracy >= 0 and accuracy <= 50 and age <= 30000 and age >= -5000
  pure def retryDelay(attempts: int): int =
    if (attempts == 0) 10000 else if (attempts == 1) 20000
    else if (attempts == 2) 40000 else 60000
  pure def schedule(state: Navigation): Navigation =
    if (state.navigating and not(state.arrived))
      {retryTimer: true, retryAttempts: if (state.retryAttempts < 4) state.retryAttempts + 1 else 4,
        retryDelay: retryDelay(state.retryAttempts), ...state}
    else state
  pure def stopped(state: Navigation): Navigation = {
    navigating: false, navSession: state.navSession + 1, route: 0,
    rerouting: false, offRoute: false, fixReady: false, locationWatch: false,
    backgroundPending: false, backgroundRunning: false, bridgeRegistered: false, nativeSession: 0,
    nativeOwner: 0, retryTimer: false, retryAttempts: 0,
    stoppedNativeSessions: if (state.nativeSession == 0) state.stoppedNativeSessions
      else state.stoppedNativeSessions.union(Set(state.nativeSession)),
    nativeStops: if (state.nativeSession == 0) state.nativeStops else state.nativeStops + 1,
    ...state
  }
  action init = s' = {
    navigating: false, navSession: 0, route: 0, navStep: 0, follow: true,
    arrived: false, offRoute: false, rerouting: false, rerouteCleared: false,
    requestGeneration: 0, requestSession: 0, requestRoute: 0,
    fixReady: false, accuracy: 0, navDistance: 100, routeDistance: 0,
    lastStep: 0, nearSteps: Set(), projectedStep: 0, displayedStep: 0,
    retryTimer: false, retryAttempts: 0, retryDelay: 0, failedReroute: false,
    locationWatch: false, foreground: true, backgroundPending: false,
    backgroundRunning: false, bridgeRegistered: false, nativeSession: 0, nativeOwner: 0,
    stoppedNativeSessions: Set(), nativeStops: 0
  }
  action start(route: int): bool = all {
    not(s.navigating), s.foreground, s.navSession < 3, route.in(Set(1, 2)),
    s' = {navigating: true, navSession: s.navSession + 1, route: route,
      navStep: 0, displayedStep: 0, lastStep: 0, nearSteps: Set(), follow: true,
      arrived: false, offRoute: false, rerouting: false, rerouteCleared: false,
      fixReady: false, retryTimer: false, retryAttempts: 0, failedReroute: false,
      locationWatch: true, backgroundPending: true, backgroundRunning: false, bridgeRegistered: false, ...s}
  }
  action bridgeRegisters = all {
    s.navigating, s.backgroundPending, s' = s.with("bridgeRegistered", true)
  }
  // Native availability/permission failure leaves foreground-only guidance.
  action backgroundResult(session: int, permitted: bool): bool =
    if (s.navigating and s.backgroundPending and session == s.navSession)
      s' = {backgroundPending: false, backgroundRunning: permitted, bridgeRegistered: permitted,
        nativeSession: if (permitted) session else 0,
        nativeOwner: if (permitted) 1 else 0, ...s}
    else s' = s
  pure def nearby(first: int, second: int, third: int): Set[int] =
    Set(0, 1, 2).filter(index => (if (index == 0) first else if (index == 1) second else third) < 40)
  action measuredFix(session: int, accuracy: int, precise: bool, age: int,
      destination: int, routeDistance: int, first: int, second: int, third: int, projected: int): bool =
    onFix(session, accuracy, precise, age, destination, routeDistance, nearby(first, second, third), projected)
  action onFix(session: int, accuracy: int, precise: bool, age: int,
               destination: int, routeDistance: int, near: Set[int], projected: int): bool = all {
    accuracy.in(Set(0, 30, 31, 50, 51)), age.in(Set(-5001, -5000, 0, 30000, 30001)),
    destination.in(Set(24, 25, 100)), routeDistance.in(Set(0, 75, 76, 100, 101)),
    near.subseteq(Set(0, 1, 2)), projected.in(0.to(2)),
    if (not(s.navigating) or not(s.locationWatch) or session != s.navSession) s' = s
    else if (not(usable(accuracy, precise, age))) s' = s.with("fixReady", false)
    else if (s.rerouting)
      s' = {fixReady: true, accuracy: accuracy, routeDistance: routeDistance, ...s}
    else if (destination < 25 and accuracy <= 30)
      s' = {fixReady: true, accuracy: accuracy, navDistance: destination,
        routeDistance: routeDistance, arrived: true, offRoute: false,
        retryTimer: false, locationWatch: false, backgroundPending: false,
        backgroundRunning: false, bridgeRegistered: false, nativeSession: 0, nativeOwner: 0,
        stoppedNativeSessions: if (s.nativeSession == 0) s.stoppedNativeSessions
          else s.stoppedNativeSessions.union(Set(s.nativeSession)),
        nativeStops: if (s.nativeSession == 0) s.nativeStops else s.nativeStops + 1, ...s}
    else s' = {
      fixReady: true, accuracy: accuracy, navDistance: destination, routeDistance: routeDistance,
      arrived: false, offRoute: routeDistance > (if (accuracy * 2 > 75) accuracy * 2 else 75),
      lastStep: s.navStep, nearSteps: near, projectedStep: projected,
      navStep: advanced(s.navStep, near), displayedStep: advanced(s.navStep, near), ...s}
  }
  // Freshness is rechecked at reroute time even without a newer location event.
  action ageFix = s' = s.with("fixReady", false)
  action beginReroute = all {
    s.navigating, not(s.arrived), not(s.rerouting), s.fixReady, s.requestGeneration < 3,
    s' = {rerouting: true, rerouteCleared: false, offRoute: false,
      requestGeneration: s.requestGeneration + 1, requestSession: s.navSession,
      requestRoute: s.route, retryTimer: false, ...s}
  }
  action controllerLoading(session: int, generation: int): bool =
    if (s.rerouting and session == s.requestSession and generation == s.requestGeneration)
      s' = s.with("rerouteCleared", true)
    else s' = s
  // An old ready route emitted before loading cannot satisfy a new reroute.
  action controllerReady(session: int, generation: int, route: int): bool = all {
    route.in(Set(1, 2)),
    if (s.navigating and s.rerouting and s.rerouteCleared and
        session == s.navSession and generation == s.requestGeneration)
      s' = {route: route, navStep: 0, displayedStep: 0, lastStep: 0, nearSteps: Set(),
        rerouting: false, retryTimer: false, retryAttempts: 0, failedReroute: false, ...s}
    else s' = s
  }
  action controllerFailed(session: int, generation: int): bool =
    if (s.navigating and s.rerouting and s.rerouteCleared and
        session == s.navSession and generation == s.requestGeneration)
      s' = schedule({rerouting: false, failedReroute: true, ...s})
    else s' = s
  action retryFires = all {
    s.retryTimer,
    if (not(s.navigating) or s.arrived or s.rerouting or s.route == 0)
      s' = s.with("retryTimer", false)
    else if (s.fixReady and s.routeDistance <= (if (s.accuracy * 2 > 75) s.accuracy * 2 else 75))
      s' = {retryTimer: false, retryAttempts: 0, ...s}
    else if (s.fixReady and s.requestGeneration < 3)
      s' = {retryTimer: false, rerouting: true, rerouteCleared: false, offRoute: false,
        requestGeneration: s.requestGeneration + 1, requestSession: s.navSession,
        requestRoute: s.route, ...s}
    else if (not(s.fixReady)) s' = schedule(s.with("retryTimer", false))
    else s' = s
  }
  action recenter = all {s.navigating, s' = s.with("follow", true)}
  action stop = all {s.navigating, s.navSession < 4, s' = stopped(s)}
  action nativeStop(session: int, reason: str): bool = all {
    reason.in(Set("notification", "refused", "destroyed", "task-removed")),
    if (session != s.nativeSession or s.nativeSession == 0) s' = s
    else if (reason == "notification" or not(s.foreground)) all {
      s.navSession < 4, s' = stopped(s)
    }
    else s' = {backgroundRunning: false, bridgeRegistered: false, nativeSession: 0, nativeOwner: 0,
      stoppedNativeSessions: s.stoppedNativeSessions.union(Set(session)),
      nativeStops: s.nativeStops + 1, ...s}
  }
  action removeTask(assistantTask: bool, ownerAlive: bool): bool =
    if (assistantTask or ownerAlive or s.nativeSession == 0) s' = s
    else nativeStop(s.nativeSession, "task-removed")
  action hide =
    if (s.navigating and not(s.backgroundRunning) and not(s.bridgeRegistered)) all {
      s.navSession < 4, s' = stopped(s).with("foreground", false)
    }
    else s' = s.with("foreground", false)
  action show = s' = s.with("foreground", true)
  action step = {
    nondet session = 0.to(4).oneOf()
    nondet generation = 0.to(3).oneOf()
    nondet route = Set(1, 2).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet accuracy = Set(0, 30, 31, 50, 51).oneOf()
    nondet age = Set(-5001, -5000, 0, 30000, 30001).oneOf()
    nondet destination = Set(24, 25, 100).oneOf()
    nondet distance = Set(0, 75, 76, 100, 101).oneOf()
    nondet projected = 0.to(2).oneOf()
    nondet first = Set(39, 40, 100).oneOf()
    nondet second = Set(39, 40, 100).oneOf()
    nondet reason = Set("notification", "refused", "destroyed", "task-removed").oneOf()
    any {start(route), bridgeRegisters, backgroundResult(session, flag),
      measuredFix(session, accuracy, flag, age, destination, distance, first, second, 100, projected), ageFix,
      beginReroute, controllerLoading(session, generation), controllerReady(session, generation, route),
      controllerFailed(session, generation), retryFires, recenter, stop,
      nativeStop(session, reason), removeTask(flag, flag), hide, show, s' = s}
  }
  val CursorRange = s.navStep.in(0.to(2)) and s.displayedStep == s.navStep
  val ManeuverRequiresProximity = s.navStep == advanced(s.lastStep, s.nearSteps)
  val ArrivalRequiresAccurateFix = s.arrived implies s.navDistance < 25 and s.accuracy <= 30
  val ArrivalStopsResources = s.arrived implies not(s.locationWatch) and not(s.backgroundRunning) and not(s.retryTimer)
  val RerouteKeepsRoute = s.rerouting implies s.navigating and s.route == s.requestRoute
  val FailedRerouteKeepsRoute = s.failedReroute and s.navigating implies s.route == s.requestRoute
  val BoundedBackoff = s.retryAttempts.in(0.to(4)) and
    (s.retryTimer implies s.retryDelay.in(Set(10000, 20000, 40000, 60000)))
  val NativeSessionOwned = s.backgroundRunning implies s.navigating and s.bridgeRegistered and s.nativeSession == s.navSession and s.nativeOwner == 1
  val NativeStopOnce = s.nativeStops == s.stoppedNativeSessions.size()
  val safety = CursorRange and ManeuverRequiresProximity and ArrivalRequiresAccurateFix and
    ArrivalStopsResources and RerouteKeepsRoute and FailedRerouteKeepsRoute and
    BoundedBackoff and NativeSessionOwned and NativeStopOnce

  run inaccurateArrivalRejectedTest = init.then(start(1))
    .then(onFix(1, 31, true, 0, 24, 0, Set(), 2)).then(check(not(s.arrived)))
    .then(onFix(1, 30, true, 0, 25, 0, Set(), 2)).then(check(not(s.arrived)))
    .then(onFix(1, 30, true, 0, 24, 0, Set(), 2)).then(check(safety and s.arrived))
  run sparseProjectionDoesNotSkipManeuverTest = init.then(start(1))
    .then(onFix(1, 30, true, 0, 100, 0, Set(), 2)).then(check(s.navStep == 0 and s.projectedStep == 2))
    .then(onFix(1, 30, true, 0, 100, 0, Set(0), 2)).then(check(s.navStep == 1))
    .then(onFix(1, 30, true, 0, 100, 0, Set(1), 2)).then(check(safety and s.navStep == 2))
  run exactFortyMeterBoundaryTest = init.then(start(1))
    .then(measuredFix(1, 30, true, 0, 100, 0, 40, 100, 100, 2)).then(check(s.navStep == 0))
    .then(measuredFix(1, 30, true, 0, 100, 0, 39, 40, 100, 2)).then(check(s.navStep == 1))
    .then(measuredFix(1, 30, true, 0, 100, 0, 100, 39, 100, 2)).then(check(safety and s.navStep == 2))
  run oldReadyCannotCompleteRerouteTest = init.then(start(1))
    .then(onFix(1, 30, true, 0, 100, 100, Set(), 0)).then(beginReroute)
    .then(controllerReady(1, 1, 2)).then(check(s.rerouting and s.route == 1))
    .then(controllerLoading(1, 1)).then(controllerReady(1, 0, 2)).then(check(s.rerouting))
    .then(controllerReady(1, 1, 2)).then(check(safety and s.route == 2 and s.navStep == 0))
  run failureBackoffAndRecoveryTest = init.then(start(1))
    .then(onFix(1, 50, true, 0, 100, 101, Set(), 0)).then(beginReroute)
    .then(controllerLoading(1, 1)).then(controllerFailed(1, 1))
    .then(check(s.retryTimer and s.retryDelay == 10000 and s.route == 1))
    .then(ageFix).then(retryFires).then(check(s.retryDelay == 20000))
    .then(onFix(1, 50, true, 0, 100, 100, Set(), 0)).then(retryFires)
    .then(check(safety and not(s.retryTimer) and s.retryAttempts == 0))
  run arrivalCancelsRetryAndBackgroundTest = init.then(start(1)).then(backgroundResult(1, true))
    .then(onFix(1, 30, true, 0, 100, 100, Set(), 0)).then(beginReroute)
    .then(controllerLoading(1, 1)).then(controllerFailed(1, 1))
    .then(onFix(1, 30, true, 0, 24, 0, Set(), 0))
    .then(check(safety and s.arrived and not(s.retryTimer) and s.nativeStops == 1))
  run oldSessionCannotStopSuccessorTest = init.then(start(1)).then(backgroundResult(1, true))
    .then(stop).then(start(2)).then(backgroundResult(3, true)).then(nativeStop(1, "destroyed"))
    .then(removeTask(true, false)).then(check(safety and s.backgroundRunning and s.route == 2))
    .then(nativeStop(3, "notification")).then(check(safety and not(s.navigating) and s.nativeStops == 2))
  run staleLocationCannotMoveCursorTest = init.then(start(1)).then(stop).then(start(2))
    .then(onFix(1, 0, true, 0, 24, 0, Set(0, 1), 2))
    .then(check(safety and not(s.arrived) and s.navStep == 0))
  run pendingNativeStartKeepsBridgeSessionTest = init.then(start(1)).then(bridgeRegisters).then(hide)
    .then(check(s.navigating and s.backgroundPending and not(s.backgroundRunning)))
    .then(backgroundResult(1, true)).then(check(safety and s.backgroundRunning))
  run foregroundOnlyHiddenStopsTest = init.then(start(1)).then(backgroundResult(1, false)).then(hide)
    .then(check(safety and not(s.navigating) and s.navSession == 2))
  run unusableFixDoesNotAdvanceTest = init.then(start(1))
    .then(onFix(1, 51, true, 0, 24, 0, Set(0, 1), 2))
    .then(onFix(1, 30, true, 30001, 24, 0, Set(0, 1), 2))
    .then(onFix(1, 30, false, 0, 24, 0, Set(0, 1), 2))
    .then(check(safety and not(s.fixReady) and not(s.arrived) and s.navStep == 0))
}
