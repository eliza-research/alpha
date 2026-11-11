/// Compile-time admission, independent native/cloud runtime profile, and isolated fixture state.
module DevelopmentSurfaces {
  type State = { mocks: bool, devServer: bool, native: bool, profile: str,
    fixture: bool, tools: bool, toolsQuery: bool, remote: bool, syntheticEvents: int, liveEvents: int }
  var s: State
  action init = {
    nondet mocks = Set(false, true).oneOf()
    nondet devServer = Set(false, true).oneOf()
    nondet native = Set(false, true).oneOf()
    nondet profile = Set("native", "cloud").oneOf()
    s' = { mocks: mocks, devServer: devServer, native: native, profile: profile,
      fixture: false, tools: false, toolsQuery: false, remote: false, syntheticEvents: 0, liveEvents: 0 }
  }
  action productionInit = s' = { mocks: false, devServer: false, native: true, profile: "native",
    fixture: false, tools: false, toolsQuery: false, remote: false, syntheticEvents: 0, liveEvents: 0 }
  action developmentInit = s' = { mocks: true, devServer: true, native: false, profile: "native",
    fixture: false, tools: false, toolsQuery: false, remote: false, syntheticEvents: 0, liveEvents: 0 }
  action fixture = all { s.mocks, s' = { ...s, fixture: true } }
  /// Opening the page with ?tools=1 renders the device controls only on the development server
  /// outside Android.
  action showTools = all { s.mocks, s.devServer, not(s.native), s' = { ...s, toolsQuery: true, tools: true } }
  /// The runtime profile is a query choice. It never admits a development surface.
  action switchProfile = s' = { ...s, profile: if (s.profile == "native") "cloud" else "native" }
  action remoteTransport = all { s.mocks, s' = { ...s, remote: true } }
  action syntheticEvent = all { s.mocks, s.fixture, s.syntheticEvents < 2,
    s' = { ...s, syntheticEvents: s.syntheticEvents + 1 } }
  action liveEvent = all { not(s.fixture), s.liveEvents < 2,
    s' = { ...s, liveEvents: s.liveEvents + 1 } }
  /// Any page can carry ?tools=1. Alone it only records the request.
  action craftedQuery = s' = { ...s, toolsQuery: true }
  action step = any { fixture, showTools, switchProfile, remoteTransport, syntheticEvent, liveEvent, craftedQuery, s' = s }
  val ProductionAdmission = not(s.mocks) implies (not(s.fixture) and not(s.remote) and not(s.tools) and s.syntheticEvents == 0)
  val ToolsAdmission = s.tools implies (s.mocks and s.devServer and not(s.native) and s.toolsQuery)
  /// Synthetic and live device events never mix in one session.
  val FixtureIsolation = s.syntheticEvents > 0 implies s.fixture and s.mocks
  val TypeOK = s.profile.in(Set("native", "cloud")) and s.syntheticEvents.in(0.to(2)) and s.liveEvents.in(0.to(2))
  val safety = TypeOK and ProductionAdmission and ToolsAdmission and FixtureIsolation
  val CraftedProductionQueryWitness = not(s.mocks) and s.toolsQuery and s.profile == "cloud"
  val ToolsShownWitness = s.tools
  val SyntheticEventWitness = s.syntheticEvents > 0
  /// A crafted query on a production build shows no tools, fixture or remote transport.
  run craftedProductionQueryTest = productionInit.then(craftedQuery).then(switchProfile)
    .expect(safety and not(s.fixture or s.tools or s.remote) and s.profile == "cloud")
    .then(showTools.fail())
  /// The recorded query shows nothing until the development page renders its controls.
  run queryAloneShowsNoToolsTest = developmentInit.then(craftedQuery)
    .expect(s.toolsQuery and not(s.tools) and safety).then(showTools).expect(ToolsShownWitness and safety)
  run devSimulationTest = developmentInit.then(fixture).then(showTools).then(syntheticEvent)
    .expect(safety and s.syntheticEvents == 1 and s.liveEvents == 0)
}
