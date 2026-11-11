/// The Maps screen shows one of six modes computed from independent flags. User controls
/// exist only in the modes that draw them; agent requests set the flags directly.
module MapsScreenModes {
  type Screen = {
    searching: bool, hasQuery: bool, selected: str, directions: bool, originMode: bool,
    navigating: bool, screenOff: bool, hidden: bool,
    // "Use current location": the screen's busy flag and the controller's one-fix watch.
    locating: bool, watch: bool,
    // Starting point: the text shown, whether the controller holds an origin, and its route.
    originText: str, origin: bool, routeReady: bool, typedOriginReplaced: bool,
    // The destination's most recent explicit choice.
    lastChoice: str,
    // Cross-app search hand-off: offered by render, consumed once outside it.
    handoffQuery: bool, handoffPending: bool, requests: int, handoffs: int
  }
  var s: Screen
  pure val MaxRequests = 3
  pure def choosingOrigin(v: Screen): bool =
    v.originMode and v.directions and not(v.navigating) and v.selected != "none"
  pure def mode(v: Screen): str =
    if (v.navigating) "nav" else if (choosingOrigin(v)) "origin" else if (v.directions) "dir"
    else if (v.selected != "none") "place" else if (v.searching) "results" else "base"
  /// The destination search field is drawn outside the route sheet and guidance.
  pure def searchShown(v: Screen): bool = not(v.directions) and not(v.navigating)
  pure def handoffDiscarded(v: Screen): Screen = { ...v, handoffPending: false, handoffQuery: false }
  pure def guidanceEnded(v: Screen): Screen = { ...v, navigating: false, screenOff: false }
  /// Enter in the search field: a typed search replaces a pending hand-off.
  pure def submitted(v: Screen): Screen =
    { ...handoffDiscarded(v), selected: "none", searching: true, lastChoice: "search" }
  /// Leaving Maps keeps only the search text and its results sheet.
  pure def released(v: Screen): Screen =
    { ...guidanceEnded(handoffDiscarded(v)), directions: false, originMode: false, locating: false,
      watch: false, selected: "none", origin: false, routeReady: false, lastChoice: "none" }

  action init = s' = {
    searching: false, hasQuery: false, selected: "none", directions: false, originMode: false,
    navigating: false, screenOff: false, hidden: false, locating: false, watch: false,
    originText: "empty", origin: false, routeReady: false, typedOriginReplaced: false,
    lastChoice: "none", handoffQuery: false, handoffPending: false, requests: 0, handoffs: 0
  }
  action focusSearch = all {
    searchShown(s), not(s.searching), s' = { ...s, selected: "none", searching: true }
  }
  action typeQuery = all {
    searchShown(s),
    s' = { ...handoffDiscarded(s), hasQuery: true, selected: "none", searching: true, lastChoice: "typing" }
  }
  action clearQuery = all {
    searchShown(s), s' = { ...s, hasQuery: false, selected: "none", searching: true, lastChoice: "typing" }
  }
  action submitSearch = all { searchShown(s), s.hasQuery, s' = submitted(s) }
  action pickResult = all {
    mode(s) == "results",
    s' = { ...s, selected: "place", searching: false, routeReady: false, lastChoice: "place" }
  }
  action pickSaved = all {
    mode(s).in(Set("base", "results")),
    s' = { ...handoffDiscarded(s), selected: "place", searching: false, routeReady: false, lastChoice: "place" }
  }
  action closePlace = all { mode(s) == "place", s' = { ...s, selected: "none" } }
  /// The route sheet opens without asking for the device's location.
  action openDirections = all { mode(s) == "place", s' = { ...s, directions: true } }
  /// For a place when no route sheet is open, for the route origin when one is.
  action locate = all {
    not(s.navigating), not(s.locating), not(s.hidden),
    s' = { ...handoffDiscarded(s), locating: true, watch: true, searching: false,
      selected: if (s.directions) s.selected else "none",
      lastChoice: if (s.directions) s.lastChoice else "locate" }
  }
  /// The requested fix settles. The controller takes a usable fix as its origin, which
  /// retires its route; the screen acts on it only while its busy flag is still set.
  action fixArrives(usable: bool): bool = {
    val settled = { ...s, watch: false }
    val moved = { ...guidanceEnded(settled), origin: true, routeReady: false }
    all {
      s.watch,
      s' = if (not(usable)) { ...settled, locating: false }
        else if (not(s.locating)) moved
        else if (s.directions)
          { ...moved, locating: false, originText: "location", searching: false,
            typedOriginReplaced: s.typedOriginReplaced or s.originText == "typed" }
        else { ...moved, locating: false, selected: "location", searching: false }
    }
  }
  /// Typing a starting point clears the controller's origin and its route.
  action editOrigin = all {
    mode(s).in(Set("dir", "origin")),
    s' = { ...s, originMode: if (mode(s) == "dir") false else s.originMode, originText: "typed",
      origin: false, routeReady: false }
  }
  action searchOrigin = all {
    mode(s).in(Set("dir", "origin")), s.originText.in(Set("typed", "chosen")),
    s' = { ...s, originMode: true }
  }
  /// A chosen starting point, or typed coordinates, becomes the origin and ends the location watch.
  action chooseOrigin = all {
    mode(s) == "origin" or (mode(s) == "dir" and s.originText == "typed"),
    s' = { ...s, originMode: false, originText: "chosen", origin: true, watch: false, routeReady: false }
  }
  action routePlanned(ready: bool): bool = all {
    s.directions, not(s.navigating), s.origin, s' = { ...s, routeReady: ready }
  }
  action start = all { mode(s) == "dir", s.routeReady, not(s.hidden), s' = { ...s, navigating: true } }
  action screenOffStarted = all { s.navigating, not(s.screenOff), s' = { ...s, screenOff: true } }
  /// The native session ends by itself: guidance goes on in front and Maps is released when hidden.
  action screenOffLost = all {
    s.screenOff, s' = if (s.hidden) released(s) else { ...s, screenOff: false }
  }
  /// End on the sheet, or Stop on the notification.
  action end = all { s.navigating, s' = guidanceEnded(s) }
  /// System Back unwinds one layer: origin search, route sheet or guidance, place, search.
  action back = {
    val base = handoffDiscarded(s)
    s' = if (s.originMode) { ...base, originMode: false }
      else if (s.directions or s.navigating) { ...guidanceEnded(base), directions: false }
      else if (s.selected != "none") { ...base, selected: "none" }
      else { ...base, searching: false, hasQuery: false }
  }
  action leave = s' = released(s)
  /// A hidden page keeps Maps only for guidance with its screen-off session.
  action hide = all {
    not(s.hidden),
    s' = if (s.navigating and s.screenOff) { ...s, hidden: true } else { ...released(s), hidden: true }
  }
  action show = all { s.hidden, s' = { ...s, hidden: false } }
  /// Agent requests are refused while guidance is active.
  action agentShowPlace = all {
    not(s.navigating), not(s.hidden),
    s' = { ...handoffDiscarded(s), directions: false, originMode: false, searching: false,
      locating: false, selected: "place", routeReady: false, lastChoice: "place" }
  }
  action agentShowDirections = all {
    not(s.navigating), not(s.hidden),
    s' = { ...handoffDiscarded(s), originMode: false, searching: false, locating: false,
      originText: "empty", origin: false, directions: true, selected: "place", routeReady: false,
      lastChoice: "place" }
  }
  action agentPlanFrom = all {
    s.directions, not(s.navigating), not(s.hidden),
    s' = { ...s, originMode: false, originText: "location", origin: true, watch: false, routeReady: false }
  }
  /// Another app opens Maps with a one-use search.
  action crossAppQuery = all {
    not(s.handoffQuery), not(s.hidden), s.requests < MaxRequests,
    s' = { ...s, handoffQuery: true, requests: s.requests + 1 }
  }
  action offerHandoff = all {
    s.handoffQuery, not(s.handoffPending), not(s.hidden), s' = { ...s, handoffPending: true }
  }
  /// The hand-off runs only if nothing newer discarded it and Maps is still shown.
  action consumeHandoff = all {
    s.handoffPending,
    s' = if (not(s.handoffQuery) or s.hidden) { ...s, handoffPending: false }
      else { ...submitted(released(s)), hasQuery: true, handoffs: s.handoffs + 1 }
  }
  action step = {
    nondet flag = Set(false, true).oneOf()
    // Events that close Maps layers are drawn less often, so sampled traces reach guidance.
    nondet draw = 0.to(3).oneOf()
    any {
      // Nothing is tapped or typed on a hidden page.
      all { not(s.hidden), any {
        focusSearch, typeQuery, clearQuery, submitSearch, pickResult, pickSaved, closePlace,
        openDirections, locate, editOrigin, searchOrigin, chooseOrigin, start,
        agentShowPlace, agentShowDirections, agentPlanFrom, crossAppQuery, offerHandoff,
        all { draw == 0, any { end, back, leave, hide } } } },
      all { s.hidden, draw == 0, end },
      fixArrives(flag), routePlanned(flag), screenOffStarted, screenOffLost, show, consumeHandoff,
      s' = s
    }
  }

  val TypeOK = s.selected.in(Set("none", "place", "location")) and
    s.originText.in(Set("empty", "location", "typed", "chosen")) and
    s.lastChoice.in(Set("none", "typing", "search", "place", "locate")) and
    s.requests.in(0.to(MaxRequests)) and s.handoffs.in(0.to(MaxRequests))
  val NavigationNeedsRouteSheet = s.navigating implies s.directions and s.selected != "none"
  val DirectionsNeedDestination = s.directions implies s.selected != "none"
  val OriginPickNeedsRouteSheet = s.originMode implies s.directions
  val ReadyRouteNeedsOrigin = s.routeReady implies s.origin
  val ScreenOffNeedsGuidance = s.screenOff implies s.navigating
  /// Guidance on a hidden page always has its screen-off session.
  val HiddenGuidanceHasScreenOffSession = s.navigating and s.hidden implies s.screenOff
  val HandoffNeedsQuery = s.handoffPending implies s.handoffQuery
  /// One cross-app search is applied at most once.
  val HandoffAppliedOncePerRequest = s.handoffs <= s.requests and
    (s.handoffQuery implies s.handoffs < s.requests)
  val safety = TypeOK and NavigationNeedsRouteSheet and DirectionsNeedDestination and
    OriginPickNeedsRouteSheet and ReadyRouteNeedsOrigin and ScreenOffNeedsGuidance and
    HiddenGuidanceHasScreenOffSession and HandoffNeedsQuery and HandoffAppliedOncePerRequest

  // Properties the source does not have; they are outside `safety`. The busy flag is cleared
  // only by a settled fix, an agent request or leaving Maps, so it outlives a watch that a
  // chosen origin ended, and a fix that settles late is applied over newer input.
  val LocatingHasWatchDesired = s.locating implies s.watch
  val LateFixKeepsSearchDesired = s.selected == "location" implies s.lastChoice != "search"
  val LateFixKeepsTypedOriginDesired = not(s.typedOriginReplaced)

  val GuidanceModeWitness = mode(s) == "nav"
  val OriginPickWitness = mode(s) == "origin"
  val HiddenGuidanceWitness = s.navigating and s.hidden
  val HandoffAppliedWitness = s.handoffs > 0
  val CurrentLocationPlaceWitness = s.selected == "location" and mode(s) == "place"

  run modesInOrderTest = init.expect(mode(s) == "base")
    .then(typeQuery).then(submitSearch).expect(mode(s) == "results")
    .then(pickResult).expect(mode(s) == "place")
    .then(openDirections).expect(mode(s) == "dir" and not(s.locating))
    .then(editOrigin).then(searchOrigin).expect(mode(s) == "origin")
    .then(chooseOrigin).then(routePlanned(true)).then(start).expect(mode(s) == "nav" and safety)
    .then(back).expect(mode(s) == "place" and not(s.navigating) and safety)
  run backUnwindsOneLayerTest = init.then(typeQuery).then(submitSearch).then(pickResult)
    .then(openDirections).then(editOrigin).then(searchOrigin)
    .then(back).expect(mode(s) == "dir")
    .then(back).expect(mode(s) == "place")
    .then(back).expect(mode(s) == "base" and s.hasQuery)
    .then(back).expect(mode(s) == "base" and not(s.hasQuery) and safety)
  run handoffDiscardedByNewerActionTest = init.then(crossAppQuery).then(offerHandoff)
    .then(typeQuery)
    .expect(s.handoffs == 0 and not(s.handoffQuery) and not(s.handoffPending) and safety)
    .then(consumeHandoff.fail())
  run handoffAppliedOnceTest = init.then(crossAppQuery).then(offerHandoff).then(consumeHandoff)
    .expect(s.handoffs == 1 and mode(s) == "results" and s.hasQuery and not(s.handoffQuery) and safety)
    .then(offerHandoff.fail())
  run hiddenGuidanceNeedsScreenOffSessionTest = init.then(agentShowDirections).expect(mode(s) == "dir")
    .then(agentPlanFrom).then(routePlanned(true)).then(start).then(screenOffStarted).then(hide)
    .expect(mode(s) == "nav" and s.hidden and safety)
    .then(screenOffLost).expect(mode(s) == "base" and safety)
    .then(show).then(agentShowDirections).then(agentPlanFrom).then(routePlanned(true)).then(start)
    .then(hide).expect(mode(s) == "base" and not(s.navigating) and safety)
  run pendingFixEndsGuidanceTest = init.then(agentShowDirections).then(agentPlanFrom)
    .then(routePlanned(true)).then(locate).expect(s.locating and s.routeReady)
    .then(start).expect(mode(s) == "nav")
    .then(fixArrives(true))
    .expect(mode(s) == "dir" and not(s.routeReady) and s.originText == "location" and safety)
  run chosenOriginLeavesLocationBusyTest = init.then(typeQuery).then(submitSearch).then(pickResult)
    .then(openDirections).then(locate).expect(s.locating and s.watch)
    .then(editOrigin).then(searchOrigin).then(chooseOrigin)
    .expect(s.locating and not(s.watch) and not(LocatingHasWatchDesired) and safety)
    .then(locate.fail())
  run lateFixReplacesSearchAndTypedOriginTest = init.then(locate).then(typeQuery).then(submitSearch)
    .expect(mode(s) == "results" and s.locating)
    .then(fixArrives(true))
    .expect(mode(s) == "place" and s.selected == "location" and not(LateFixKeepsSearchDesired) and safety)
    .then(openDirections).then(locate).then(editOrigin).expect(s.originText == "typed")
    .then(fixArrives(true))
    .expect(s.originText == "location" and not(LateFixKeepsTypedOriginDesired) and safety)
}
