// Exact connector registration custody after the authenticated shared runtime repair.
module CoreConnectorCustody {
  type Capture = {runtime: int, owner: int}
  type Route = {owner: int, label: str}
  type Lane = {
    owner: int, rival: bool, retired: Set[int], disposing: bool, phase: str, stops: int,
    capture: Capture, detached: bool, continuation: str, routes: int -> Route, claims: int -> Set[int]
  }
  type State = {isolation: bool, lanes: int -> Lane}
  var s: State

  pure val Runtimes = Set(1, 2)
  pure val Owners = Set(1, 2, 3)
  // Default message, named message, default post, named post, legacy send.
  pure val Keys = Set(1, 2, 3, 4, 5)
  pure val DefaultKeys = Set(1, 3, 5)
  pure val NamedKeys = Set(2, 4)
  pure val Missing = {owner: 0, label: "missing"}
  pure val Empty = {owner: 0, rival: false, retired: Set(), disposing: false, phase: "idle", stops: 0,
    capture: {runtime: 0, owner: 0}, detached: false, continuation: "none",
    routes: Keys.mapBy(_ => Missing), claims: Owners.mapBy(_ => Set())}

  pure def claim(l: Lane, owner: int, selected: Set[int], label: str): Lane = {
    ...l,
    routes: Keys.mapBy(key => if (selected.contains(key)) {owner: owner, label: label} else l.routes.get(key)),
    claims: Owners.mapBy(id => if (id == owner) l.claims.get(id).union(selected) else l.claims.get(id).exclude(selected))
  }
  pure def removeRoutes(l: Lane, owner: int): Lane = {
    ...l, retired: l.retired.union(Set(owner)),
    routes: Keys.mapBy(key => if (l.routes.get(key).owner == owner) Missing else l.routes.get(key))
  }
  pure def captureMatches(l: Lane, runtime: int): bool =
    l.capture.runtime == runtime and l.capture.owner == l.owner and l.owner != 0 and not(l.retired.contains(l.owner))
  pure def oldPublication(l: Lane, runtime: int, selected: Set[int], label: str): Lane =
    if (captureMatches(l, runtime)) claim(l, l.capture.owner, selected, label) else l

  action initHeld(detached: bool): bool = {
    val held = {...Empty, owner: 1, phase: "starting", capture: {runtime: 1, owner: 1}, detached: detached}
    s' = {isolation: false, lanes: Map((1, claim(held, 1, DefaultKeys, "initial")), (2, Empty))}
  }
  action initIsolation = s' = {isolation: true, lanes: Runtimes.mapBy(_ => {...Empty, owner: 1})}
  action init = any {initHeld(false), initHeld(true), initIsolation}
  action update(runtime: int, changed: Lane): bool = s' = {...s, lanes: s.lanes.set(runtime, changed)}

  action beginStart(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    all {
      s.isolation, l.owner == 1, l.phase == "idle",
      update(runtime, {...l, phase: "starting", capture: {runtime: runtime, owner: 1}}),
    }
  }
  action returnStart(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    val live = captureMatches(l, runtime)
    val selected = if (s.isolation) Set(1) else DefaultKeys
    val label = if (not(s.isolation)) "late" else if (runtime == 1) "quint-left-owner" else "quint-right-owner"
    val published = if (l.detached) l else oldPublication(l, runtime, selected, label)
    all {
      l.phase == "starting",
      update(runtime, {...published, phase: if (live) "published" else "stopping",
        stops: if (live) l.stops else l.stops+1,
        continuation: if (l.detached) "waiting" else "none"}),
    }
  }
  action beginDispose(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    all {
      l.owner == 1, not(l.retired.contains(1)), not(l.disposing),
      update(runtime, {...l, disposing: true}),
    }
  }
  action withdraw(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    val withdrawn = removeRoutes(l, 1)
    all {
      l.owner == 1, not(l.retired.contains(1)), l.phase.in(Set("starting", "published")),
      update(runtime, {...withdrawn, disposing: false,
        phase: if (l.phase == "published") "stopping" else "starting",
        stops: l.stops + (if (l.phase == "published") 1 else 0)}),
    }
  }
  action finishUnload(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    all {
      l.owner == 1, l.retired.contains(1), l.phase == "stopping",
      update(runtime, {...l, owner: 0, phase: "stopped", claims: l.claims.set(1, Set())}),
    }
  }
  action continueDetached(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    val changed = oldPublication(l, runtime, DefaultKeys, "late")
    all {
      l.continuation == "waiting",
      update(runtime, {...changed, continuation: "done"}),
    }
  }
  action registerReplacement(runtime: int, publishes: bool): bool = {
    val l = s.lanes.get(runtime)
    val changed = {...l, owner: 2}
    all {
      not(s.isolation), l.owner == 0, l.retired.contains(1), not(l.retired.contains(2)),
      update(runtime, if (publishes) claim(changed, 2, DefaultKeys, "replacement") else changed),
    }
  }
  action unloadReplacement(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    val changed = removeRoutes(l, 2)
    all {
      l.owner == 2,
      update(runtime, {...changed, owner: 0, claims: l.claims.set(2, Set())}),
    }
  }
  action registerRival(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    val default = claim({...l, rival: true}, 3, DefaultKeys, "rival")
    all {
      not(s.isolation), not(l.rival), not(l.retired.contains(3)),
      update(runtime, claim(default, 3, NamedKeys, "sibling")),
    }
  }
  action unloadRival(runtime: int): bool = {
    val l = s.lanes.get(runtime)
    val changed = removeRoutes(l, 3)
    all {
      l.rival,
      update(runtime, {...changed, rival: false, claims: l.claims.set(3, Set())}),
    }
  }
  action hostClaim(runtime: int): bool = all {
    not(s.isolation),
    update(runtime, claim(s.lanes.get(runtime), 0, DefaultKeys, "host")),
  }

  pure def namedKeys(selected: Set[int], defaultKey: int, namedKey: int): Set[str] =
    (if (selected.contains(defaultKey)) Set("default") else Set()).union(
      if (selected.contains(namedKey)) Set("sibling") else Set())
  pure def view(l: Lane): {
    owner: str, rival: bool, ownerKeys: Set[str], rivalKeys: Set[str], ownerPostKeys: Set[str], rivalPostKeys: Set[str],
    ownerLegacyKey: bool, rivalLegacyKey: bool, default: str, sibling: str, defaultPost: str, siblingPost: str,
    route: str, siblingRoute: str, legacyRoute: str, servicePublished: bool, classPresent: bool,
    stopCalls: int, disposing: bool, continuation: str
  } = {
    val owner = if (l.owner == 0) Set() else l.claims.get(l.owner)
    val rival = l.claims.get(3)
    val default = l.routes.get(1).label
    val named = l.routes.get(2).label
    {
      owner: if (l.owner == 0) "absent" else if (l.owner == 1) "first" else "replacement",
      rival: l.rival, ownerKeys: namedKeys(owner, 1, 2), rivalKeys: namedKeys(rival, 1, 2),
      ownerPostKeys: namedKeys(owner, 3, 4), rivalPostKeys: namedKeys(rival, 3, 4),
      ownerLegacyKey: owner.contains(5), rivalLegacyKey: rival.contains(5),
      default: default, sibling: named, defaultPost: l.routes.get(3).label, siblingPost: l.routes.get(4).label,
      route: default, siblingRoute: if (named == "missing") default else named, legacyRoute: l.routes.get(5).label,
      servicePublished: l.phase == "published", classPresent: l.owner == 1 and not(l.retired.contains(1)),
      stopCalls: l.stops, disposing: l.disposing, continuation: l.continuation
    }
  }
  val sourceView = view(s.lanes.get(1))
  val isolationView = Runtimes.mapBy(runtime => {
    val l = s.lanes.get(runtime)
    {route: l.routes.get(1).label, owned: if (l.owner == 0) false else l.claims.get(l.owner).contains(1),
      published: l.phase == "published", stopped: l.stops}
  })

  val PublicRoutesHaveExactLiveOwner = Runtimes.forall(runtime => {
    val l = s.lanes.get(runtime)
    Keys.forall(key => {
      val route = l.routes.get(key)
      route.owner != 0 implies
        ((route.owner == l.owner or (route.owner == 3 and l.rival)) and
          not(l.retired.contains(route.owner)) and l.claims.get(route.owner).contains(key))
    })
  })
  val PublicRoutesKeepGenerationProvenance = Runtimes.forall(runtime => {
    val l = s.lanes.get(runtime)
    Keys.forall(key => {
      val route = l.routes.get(key)
      if (route.owner == 0) route.label == "missing" or (route.label == "host" and DefaultKeys.contains(key))
      else if (route.owner == 1) {
        if (s.isolation) key == 1 and route.label == (if (runtime == 1) "quint-left-owner" else "quint-right-owner")
        else DefaultKeys.contains(key) and route.label.in(Set("initial", "late"))
      } else if (route.owner == 2) DefaultKeys.contains(key) and route.label == "replacement"
      else route.owner == 3 and route.label == (if (NamedKeys.contains(key)) "sibling" else "rival")
    })
  })
  val ExactKeyHasAtMostOneClaim = Runtimes.forall(runtime => Keys.forall(key =>
    Owners.filter(owner => s.lanes.get(runtime).claims.get(owner).contains(key)).size() <= 1))
  val StartStampStaysLocal = Runtimes.forall(runtime => {
    val l = s.lanes.get(runtime)
    l.phase != "idle" implies l.capture == {runtime: runtime, owner: 1}
  })
  val WithdrawnServiceDoesNotPublish = Runtimes.forall(runtime => {
    val l = s.lanes.get(runtime)
    l.retired.contains(1) implies l.phase != "published"
  })
  val StopIsSingleFlight = Runtimes.forall(runtime => s.lanes.get(runtime).stops <= 1)
  val safety = PublicRoutesHaveExactLiveOwner and PublicRoutesKeepGenerationProvenance
    and ExactKeyHasAtMostOneClaim and StartStampStaysLocal
    and WithdrawnServiceDoesNotPublish and StopIsSingleFlight

  action step = any {
    { nondet runtime = (if (s.isolation) Runtimes else Set(1)).oneOf()
      any {beginStart(runtime), returnStart(runtime), beginDispose(runtime), withdraw(runtime), finishUnload(runtime),
        continueDetached(runtime), registerReplacement(runtime, true), registerReplacement(runtime, false),
        unloadReplacement(runtime), registerRival(runtime), unloadRival(runtime), hostClaim(runtime)} },
    s' = s
  }

  run lateReturnedStartDoesNotReopenRouteTest = initHeld(false).then(withdraw(1)).then(returnStart(1))
    .then(finishUnload(1)).expect(sourceView.default == "missing" and sourceView.stopCalls == 1 and safety)
  run detachedOldStampCannotTakeReplacementTest = initHeld(true).then(withdraw(1)).then(returnStart(1))
    .then(finishUnload(1)).then(registerReplacement(1, true)).then(continueDetached(1))
    .expect(sourceView.default == "replacement" and sourceView.ownerKeys == Set("default") and safety)
    .then(unloadReplacement(1)).expect(sourceView.default == "missing" and safety)
  run earlyRivalRetainsBothExactClaimsTest = initHeld(false).then(registerRival(1)).then(withdraw(1))
    .then(returnStart(1)).then(finishUnload(1)).expect(sourceView.route == "rival" and sourceView.siblingRoute == "sibling" and safety)
  run unscopedHostPublicationSurvivesOldStopTest = initHeld(false).then(withdraw(1)).then(hostClaim(1))
    .then(returnStart(1)).then(finishUnload(1)).expect(sourceView.route == "host" and sourceView.owner == "absent" and safety)
  run disposeSettlesBeforeWithdrawalTest = initHeld(false).then(beginDispose(1)).then(returnStart(1))
    .expect(sourceView.disposing and sourceView.servicePublished and sourceView.route == "late" and safety)
    .then(withdraw(1)).then(finishUnload(1)).expect(sourceView.default == "missing" and safety)
  run sharedClassUsesSeparateRuntimeStampsTest = initIsolation.then(beginStart(1)).then(beginStart(2))
    .then(returnStart(1)).then(returnStart(2)).then(withdraw(1)).then(finishUnload(1))
    .expect(isolationView.get(1).route == "missing" and isolationView.get(2).owned and isolationView.get(2).published and safety)
}
