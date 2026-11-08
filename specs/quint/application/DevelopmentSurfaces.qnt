/// Compile-time admission, independent native/cloud runtime profile, and isolated fixture state.
module DevelopmentSurfaces {
  type State = { mocks: bool, devServer: bool, native: bool, profile: str,
    fixture: bool, tools: bool, remote: bool, syntheticEvents: int, liveEvents: int }
  var s: State
  action init = {
    nondet mocks = Set(false, true).oneOf()
    nondet devServer = Set(false, true).oneOf()
    nondet native = Set(false, true).oneOf()
    nondet profile = Set("native", "cloud").oneOf()
    s' = { mocks: mocks, devServer: devServer, native: native, profile: profile,
      fixture: false, tools: false, remote: false, syntheticEvents: 0, liveEvents: 0 }
  }
  action productionInit = s' = { mocks: false, devServer: false, native: true, profile: "native",
    fixture: false, tools: false, remote: false, syntheticEvents: 0, liveEvents: 0 }
  action developmentInit = s' = { mocks: true, devServer: true, native: false, profile: "native",
    fixture: false, tools: false, remote: false, syntheticEvents: 0, liveEvents: 0 }
  action fixture = all { s.mocks, s' = { ...s, fixture: true } }
  action showTools = all { s.mocks, s.devServer, not(s.native), s' = { ...s, tools: true } }
  action remoteTransport = all { s.mocks, s' = { ...s, remote: true } }
  action syntheticEvent = all { s.mocks, s.fixture, s.syntheticEvents < 2,
    s' = { ...s, syntheticEvents: s.syntheticEvents + 1 } }
  action liveEvent = all { not(s.fixture), s.liveEvents < 2,
    s' = { ...s, liveEvents: s.liveEvents + 1 } }
  action craftedQuery = s' = s
  action step = any { fixture, showTools, remoteTransport, syntheticEvent, liveEvent, craftedQuery }
  val ProductionAdmission = not(s.mocks) implies (not(s.fixture) and not(s.remote) and not(s.tools) and s.syntheticEvents == 0)
  val ToolsAdmission = s.tools implies (s.mocks and s.devServer and not(s.native))
  val ProfileIndependent = s.profile.in(Set("native", "cloud"))
  val safety = ProductionAdmission and ToolsAdmission and ProfileIndependent
  run craftedProductionQueryTest = productionInit.then(craftedQuery).expect(safety and not(s.fixture))
  run devSimulationTest = developmentInit.then(fixture).then(showTools).then(syntheticEvent)
    .expect(safety and s.syntheticEvents == 1 and s.liveEvents == 0)
}
