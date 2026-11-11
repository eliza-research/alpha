/// The Maps screen draws one map plane for the mounted map element and the current basemap.
/// A changed element or basemap, a retry and leaving Maps each retire the plane in place, and
/// every callback of a plane is fenced by the generation it was built under.
module MapPlaneOwnership {
  type Report = { source: int, generation: int }
  type Plane = {
    active: bool, disposed: bool,
    // The basemap the screen would draw now (1 is the world map, 2 and 3 are Cloud rasters).
    basemap: int,
    // What the plane in place was built for (0 is none), and the generation fence.
    planeElement: int, planeBasemap: int, generation: int,
    // The plane object the adapter holds (0 is none); planes are named by their generation.
    plane: int, built: Set[int], destroyed: Set[int],
    // What reached the screen: its map state, each state report, and the copyright line's plane.
    mapState: str, reports: Set[Report], copyrightFrom: int, retries: int, lastEvent: str
  }
  var s: Plane
  pure val MaxGeneration = 6
  pure val Generations = 1.to(MaxGeneration)
  pure val Kinds = Set("ready", "loading", "error", "copyright")
  /// A callback acts only for the plane of this generation, on an undisposed, shown Maps screen.
  pure def current(p: Plane, generation: int): bool =
    generation == p.generation and p.planeElement != 0 and not(p.disposed) and p.active
  pure def retired(p: Plane): Plane =
    { ...p, generation: p.generation + 1, copyrightFrom: 0,
      destroyed: if (p.plane != 0) p.destroyed.union(Set(p.plane)) else p.destroyed }
  /// Retry and release leave nothing in place.
  pure def dropped(p: Plane): Plane = { ...retired(p), plane: 0, planeElement: 0, planeBasemap: 0 }
  pure def reported(p: Plane, source: int, state: str): Plane =
    { ...p, mapState: state, reports: p.reports.union(Set({ source: source, generation: p.generation })) }

  action init = s' = {
    active: true, disposed: false, basemap: 1, planeElement: 0, planeBasemap: 0, generation: 0,
    plane: 0, built: Set(), destroyed: Set(), mapState: "loading", reports: Set(), copyrightFrom: 0,
    retries: 0, lastEvent: "none"
  }
  /// The map element is mounted or drawn again. A plane is built only for a new element or
  /// basemap; when building fails the screen is told, if this is still the generation in place.
  action render(element: int, constructs: bool): bool = {
    val mounted = { ...retired(s), planeElement: element, planeBasemap: s.basemap }
    all {
      // A disposed adapter no longer supplies the screen's bindings.
      s.generation < MaxGeneration, not(s.disposed),
      s' = if (element == s.planeElement and s.basemap == s.planeBasemap) s
        else if (constructs)
          { ...mounted, plane: mounted.generation, built: mounted.built.union(Set(mounted.generation)) }
        else if (current(mounted, mounted.generation)) reported(mounted, mounted.generation, "error")
        else mounted
    }
  }
  action setBasemap(basemap: int): bool = all { basemap != s.basemap, s' = { ...s, basemap: basemap } }
  /// A plane reports that it is ready, loading again or failed, or names its copyright line.
  action planeEvent(source: int, kind: str): bool = all {
    s.built.contains(source),
    s' = if (not(current(s, source))) { ...s, lastEvent: "ignored" }
      else if (kind == "copyright") { ...s, copyrightFrom: source, lastEvent: "applied" }
      else { ...reported(s, source, kind), lastEvent: "applied" }
  }
  /// The retry control, drawn on a shown Maps screen: the screen shows the map as loading again.
  action retry = all {
    s.active, not(s.disposed), s.generation < MaxGeneration,
    s' = { ...dropped(s), retries: s.retries + 1, mapState: "loading" }
  }
  /// Maps is left, hidden or its provider changes.
  action release = all { s.generation < MaxGeneration, s' = dropped(s) }
  action setActive(flag: bool): bool = all { flag != s.active, s' = { ...s, active: flag } }
  action dispose = all { not(s.disposed), s' = { ...s, disposed: true } }
  /// Not part of `step`: a plane callback without the generation fence.
  action unfencedEvent(source: int, kind: str): bool = all {
    s.built.contains(source), kind != "copyright", s' = { ...reported(s, source, kind), lastEvent: "applied" }
  }
  action step = {
    nondet element = 1.to(2).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet basemap = 1.to(3).oneOf()
    nondet source = Generations.oneOf()
    nondet kind = Kinds.oneOf()
    // Leaving and disposal are drawn less often, so sampled traces keep planes in place.
    nondet draw = 0.to(3).oneOf()
    any {
      render(element, flag), setBasemap(basemap), planeEvent(source, kind), retry,
      all { draw == 0, any { release, setActive(flag), dispose } },
      s' = s
    }
  }

  val TypeOK = s.generation.in(0.to(MaxGeneration)) and s.basemap.in(1.to(3)) and
    s.planeElement.in(0.to(2)) and s.planeBasemap.in(0.to(3)) and
    s.mapState.in(Set("loading", "ready", "error")) and s.lastEvent.in(Set("none", "applied", "ignored"))
  /// The screen hears about the map only from the plane of the generation in place.
  val ReportsFromCurrentPlane = s.reports.forall(report => report.source == report.generation)
  val CopyrightFromCurrentPlane = s.copyrightFrom.in(Set(0, s.generation))
  /// At most one plane is alive, and it is the one the adapter holds.
  val OnePlaneAlive = s.built.exclude(s.destroyed).subseteq(Set(s.plane))
  val PlaneBuiltForMount = s.built.contains(s.plane) and not(s.destroyed.contains(s.plane)) implies
    s.plane == s.generation and s.planeElement != 0 and s.planeBasemap != 0
  val PlanesNamedByGeneration = s.built.forall(plane => plane <= s.generation) and s.plane <= s.generation
  val safety = TypeOK and ReportsFromCurrentPlane and CopyrightFromCurrentPlane and OnePlaneAlive and
    PlaneBuiltForMount and PlanesNamedByGeneration

  val StaleEventIgnoredWitness = s.lastEvent == "ignored" and s.active and not(s.disposed) and s.plane == s.generation
  val FailedBuildReportedWitness = s.mapState == "error" and not(s.built.contains(s.generation)) and s.generation > 0
  val RetryRebuiltWitness = s.retries > 0 and s.plane == s.generation and s.mapState == "ready"
  val BasemapSwapWitness = s.built.size() >= 2 and s.plane == s.generation and s.planeBasemap != 1 and s.copyrightFrom == s.generation
  val HeldPlaneDestroyedWitness = s.plane != 0 and s.destroyed.contains(s.plane)

  run planeReportsReadyTest = init.then(render(1, true))
    .expect(s.plane == 1 and s.generation == 1)
    .then(render(1, true)).expect(s.generation == 1 and s.built == Set(1))
    .then(planeEvent(1, "ready")).expect(s.mapState == "ready" and s.lastEvent == "applied" and safety)
  run basemapChangeRetiresPlaneTest = init.then(render(1, true)).then(planeEvent(1, "ready"))
    .then(setBasemap(2)).then(render(1, true))
    .expect(s.plane == 2 and s.destroyed == Set(1) and s.planeBasemap == 2)
    .then(planeEvent(1, "error")).expect(s.mapState == "ready" and s.lastEvent == "ignored")
    .then(planeEvent(2, "copyright")).expect(s.copyrightFrom == 2 and safety)
  run retryDropsFailedPlaneTest = init.then(render(1, true)).then(planeEvent(1, "error"))
    .expect(s.mapState == "error")
    .then(retry).expect(s.plane == 0 and s.destroyed == Set(1) and s.generation == 2 and s.retries == 1)
    .expect(s.mapState == "loading")
    .then(planeEvent(1, "error")).expect(s.mapState == "loading" and s.lastEvent == "ignored")
    .then(render(1, true)).then(planeEvent(3, "ready")).expect(s.mapState == "ready" and safety)
  run failedBuildTellsScreenTest = init.then(render(1, false))
    .expect(s.mapState == "error" and s.plane == 0 and s.built == Set() and safety)
    .then(render(1, false)).expect(s.generation == 1)
    .then(retry).then(render(1, true)).expect(s.plane == 3 and safety)
  run failedRebuildKeepsRetiredPlaneTest = init.then(render(1, true)).then(setBasemap(2))
    .then(render(1, false))
    .expect(s.plane == 1 and s.destroyed == Set(1) and s.mapState == "error" and HeldPlaneDestroyedWitness and safety)
    .then(planeEvent(1, "ready")).expect(s.mapState == "error" and s.lastEvent == "ignored" and safety)
  run leftScreenHearsNothingTest = init.then(render(1, true)).then(setActive(false))
    .then(planeEvent(1, "error")).expect(s.mapState == "loading" and s.lastEvent == "ignored")
    .then(release).expect(s.plane == 0 and s.destroyed == Set(1))
    .then(setActive(true)).then(render(2, true)).then(planeEvent(3, "ready"))
    .expect(s.mapState == "ready" and safety)
  run unfencedEventWouldReachScreenTest = init.then(render(1, true)).then(retry).then(render(1, true))
    .then(unfencedEvent(1, "error")).expect(s.mapState == "error" and not(ReportsFromCurrentPlane))
}
