// Historical design translation; the executable Quint model is retained here.
module Maps {
  type State = { Design: str, net: str, plan: str, cloud: str, session: str,
    tried: bool, message: str, screen: str, route: bool, assistant: bool,
    agentReq: str, faults: int, asks: int }
  type TransitionHistory = { HonestErrors: bool, AgentLands: bool, NavSurvivesAssistant: bool, RouteKeptOnFailure: bool }
  var s: State
  var history: TransitionHistory
  val vars = (s, history)
  pure val MaxFaults = 2
  pure val MaxAgent = 2
  pure val Screens = Set("Away", "Base", "Results", "Place", "Route", "Nav", "Arrived")
  pure val Causes = Set("offline", "plan", "down")
  val TypeOK = Set("up", "down").contains(s.net) and Set("active", "none").contains(s.plan)
    and Set("ok", "down").contains(s.cloud) and Set("idle", "connecting", "ready", "error").contains(s.session)
    and Set("none", "connectProvider").union(Causes).contains(s.message) and Screens.contains(s.screen)
    and Set("none", "search", "route", "navigate").contains(s.agentReq)
    and s.faults >= 0 and s.faults <= MaxFaults and s.asks >= 0 and s.asks <= MaxAgent
  pure def serviceUp(x: State): bool = x.net == "up" and x.plan == "active" and x.cloud == "ok"
  pure def cause(x: State): str = if (x.net == "down") "offline" else if (x.plan == "none") "plan" else "down"
  val ServiceUp = serviceUp(s)
  val Cause = cause(s)
  def Shown(c) = if (s.Design == "current") "connectProvider" else c
  pure def initialState(design, net, plan, cloud) = { Design: design, net: net, plan: plan, cloud: cloud,
    session: "idle", tried: false, message: "none", screen: "Away", route: false,
    assistant: false, agentReq: "none", faults: 0, asks: 0 }
  // Persistent monitors are the exact state extension for the original
  // action properties. They observe transitions without constraining them.
  pure val initialChecks = { HonestErrors: true, AgentLands: true, NavSurvivesAssistant: true, RouteKeptOnFailure: true }
  pure def HonestErrorsRelation(before: State, after: State): bool = (after.message != before.message and after.message != "none") implies after.message == cause(after)
  pure def AgentLandsRelation(before: State, after: State): bool = (before.agentReq != "none" and after.agentReq == "none" and serviceUp(before)
      and before.session == "ready") implies Set("Results", "Route").contains(after.screen)
  pure def NavSurvivesAssistantRelation(before: State, after: State): bool = (before.screen == "Nav" and before.assistant and not(after.assistant)) implies after.screen == "Nav"
  pure def RouteKeptOnFailureRelation(before: State, after: State): bool = (before.screen == "Nav" and before.route and after.faults > before.faults) implies after.route
  action Track(after: State): bool = all {
    s' = after,
    history' = { HonestErrors: history.HonestErrors and HonestErrorsRelation(s, after),
      AgentLands: history.AgentLands and AgentLandsRelation(s, after),
      NavSurvivesAssistant: history.NavSurvivesAssistant and NavSurvivesAssistantRelation(s, after),
      RouteKeptOnFailure: history.RouteKeptOnFailure and RouteKeptOnFailureRelation(s, after) }
  }
  val HonestErrorsInvariant = history.HonestErrors
  val AgentLandsInvariant = history.AgentLands
  val NavSurvivesAssistantInvariant = history.NavSurvivesAssistant
  val RouteKeptOnFailureInvariant = history.RouteKeptOnFailure
  action StartState(design, net, plan, cloud) = all { s' = { Design: design, net: net, plan: plan, cloud: cloud,
    session: "idle", tried: false, message: "none", screen: "Away", route: false,
    assistant: false, agentReq: "none", faults: 0, asks: 0 }, history' = initialChecks }
  action Init(design) = {
    nondet net = Set("up", "down").oneOf()
    nondet plan = Set("active", "none").oneOf()
    nondet cloud = Set("ok", "down").oneOf()
    StartState(design, net, plan, cloud)
  }
  action checkerInit = {
    nondet net = Set("up", "down").oneOf()
    nondet plan = Set("active", "none").oneOf()
    nondet cloud = Set("ok", "down").oneOf()
    all { s' = initialState("proposed", net, plan, cloud), history' = initialChecks }
  }
  action checkerCurrentInit = {
    nondet net = Set("up", "down").oneOf()
    nondet plan = Set("active", "none").oneOf()
    nondet cloud = Set("ok", "down").oneOf()
    all { s' = initialState("current", net, plan, cloud), history' = initialChecks }
  }
  action init = Init("proposed")
  action currentInit = Init("current")
  action Connect = all { Set("idle", "error").contains(s.session),
    if (s.Design == "current") s.screen != "Away" and not(s.tried) else s.session == "idle" or ServiceUp,
    Track({ ...s, session: "connecting", tried: true }) }
  action Connected = all { s.session == "connecting", Track({ ...s,
    session: if (ServiceUp) "ready" else "error", message: if (ServiceUp) "none" else Shown(Cause) }) }
  action OpenMaps = all { s.screen == "Away", Track({ ...s, screen: "Base" }) }
  action Search = all { Set("Base", "Results", "Place").contains(s.screen), Track({ ...s,
    screen: "Results", session: if (s.Design == "current" and s.session == "error") "connecting" else s.session }) }
  action PickPlace = all { s.screen == "Results", s.session == "ready", Track({ ...s, screen: "Place" }) }
  action Directions = all { s.screen == "Place", s.session == "ready", Track({ ...s,
    screen: "Route", route: ServiceUp, message: if (ServiceUp) "none" else Shown(Cause) }) }
  action Start = all { s.screen == "Route", s.route, Track({ ...s, screen: "Nav" }) }
  action Arrive = all { s.screen == "Nav", Track({ ...s, screen: "Arrived", route: false }) }
  val BackEnabled = Set("Results", "Place", "Route", "Nav", "Arrived").contains(s.screen)
  action Back = all { BackEnabled, Track({ ...s,
    screen: if (s.screen == "Results") "Base" else if (s.screen == "Place") "Results"
      else if (s.screen == "Route") "Place" else if (s.screen == "Nav") "Route" else "Base" }) }
  action LeaveMaps = all { Set("Base", "Results", "Place", "Route", "Arrived").contains(s.screen),
    Track({ ...s, screen: "Away" }) }
  action OffRoute = all { s.screen == "Nav", s.faults < MaxFaults,
    if (ServiceUp) Track({ ...s, faults: s.faults + 1 })
    else if (s.Design == "current") Track({ ...s, faults: s.faults + 1,
      screen: "Route", route: false, message: Shown(Cause) })
    else Track({ ...s, faults: s.faults + 1, message: Cause }) }
  action OpenAssistant = all { not(s.assistant), Track({ ...s, assistant: true }) }
  action CloseAssistant = all { s.assistant, Track({ ...s, assistant: false,
    screen: if (s.Design == "current" and s.screen == "Nav") "Route" else s.screen }) }
  action AgentAsks(kind) = all { s.assistant, s.agentReq == "none", s.asks < MaxAgent,
    Track({ ...s, agentReq: kind, asks: s.asks + 1 }) }
  action AgentResult = all { s.agentReq != "none",
    any {
      all { s.session == "ready", ServiceUp, Track({ ...s, agentReq: "none",
        screen: if (s.agentReq == "search") "Results" else "Route",
        route: s.agentReq != "search", message: "none" }) },
      all { s.Design == "proposed", not(ServiceUp), s.session != "connecting",
        Track({ ...s, agentReq: "none", message: Cause }) },
      all { s.Design == "current", s.session != "ready",
        Track({ ...s, agentReq: "none", message: "connectProvider" }) }
    } }
  action Fault = all { s.faults < MaxFaults,
    any {
      all { s.net == "up", Track({ ...s, net: "down", faults: s.faults + 1,
        session: if (s.session == "ready") "error" else s.session }) },
      all { s.cloud == "ok", Track({ ...s, cloud: "down", faults: s.faults + 1,
        session: if (s.session == "ready") "error" else s.session }) }
    } }
  action Heal = all { s.net == "down" or s.cloud == "down", Track({ ...s, net: "up", cloud: "ok" }) }
  action Subscribe = all { s.plan == "none", Track({ ...s, plan: "active" }) }
  action Owner = any { OpenMaps, Search, PickPlace, Directions, Start, Arrive, Back,
    LeaveMaps, OpenAssistant, CloseAssistant, AgentAsks("search"), AgentAsks("route"), AgentAsks("navigate") }
  action Next = any { Owner, Connect, Connected, AgentResult, OffRoute, Fault, Heal, Subscribe }
  action step = any { Next, Track(s) }
  temporal Fairness = Connect.weakFair(s) and Connected.weakFair(s)
    and AgentResult.weakFair(s) and Heal.weakFair(s) and Subscribe.weakFair(s)
  val Initial = (history == initialChecks) and TypeOK and Set("current", "proposed").contains(s.Design) and s == initialState(s.Design, s.net, s.plan, s.cloud)
  temporal Spec = (Initial and s.Design == "proposed") and always(Next.orKeep(vars)) and Fairness
  temporal CurrentSpec = (Initial and s.Design == "current") and always(Next.orKeep(vars)) and Fairness
  val NoProviderTalk = s.message != "connectProvider"
  // Back's guard has no additional constraints and the assignment is total.
  val AlwaysBack = Set("Results", "Place", "Route", "Nav", "Arrived").contains(s.screen) implies BackEnabled
  temporal HonestErrors = always(history.HonestErrors)
  temporal SelfHealing = leadsTo(eventually(always(ServiceUp)), s.session == "ready")
  temporal AgentLands = always(history.AgentLands)
  temporal AgentServed = leadsTo(s.agentReq != "none" and ServiceUp,
    Set("Results", "Route", "Nav", "Place", "Arrived").contains(s.screen) or not(ServiceUp))
  temporal NavSurvivesAssistant = always(history.NavSurvivesAssistant)
  temporal RouteKeptOnFailure = always(history.RouteKeptOnFailure)
  temporal CheckedHonestErrors = Fairness implies HonestErrors
  temporal CheckedAgentLands = Fairness implies AgentLands
  temporal CheckedNavSurvivesAssistant = Fairness implies NavSurvivesAssistant
  temporal CheckedRouteKeptOnFailure = Fairness implies RouteKeptOnFailure
  temporal CheckedSelfHealing = Fairness implies SelfHealing
  temporal CheckedAgentServed = Fairness implies AgentServed
  temporal CheckedTemporal = Fairness implies (HonestErrors and SelfHealing and AgentLands
    and AgentServed and NavSurvivesAssistant and RouteKeptOnFailure)
  val safety = TypeOK and NoProviderTalk and AlwaysBack and HonestErrorsInvariant and AgentLandsInvariant and NavSurvivesAssistantInvariant and RouteKeptOnFailureInvariant
  run agentStartsMapsTest = StartState("proposed", "up", "active", "ok")
    .then(OpenAssistant).then(AgentAsks("route")).then(Connect).then(Connected).then(AgentResult)
    .expect(s.screen == "Route" and s.route and safety)
  run navigationSurvivesAssistantTest = StartState("proposed", "up", "active", "ok")
    .then(OpenAssistant).then(AgentAsks("route")).then(Connect).then(Connected).then(AgentResult)
    .then(Start).then(CloseAssistant).expect(s.screen == "Nav" and s.route and safety)
  run failedRerouteKeepsRouteTest = StartState("proposed", "up", "active", "ok")
    .then(OpenAssistant).then(AgentAsks("route")).then(Connect).then(Connected).then(AgentResult)
    .then(Start).then(Fault).then(OffRoute).expect(s.screen == "Nav" and s.route and safety)
  run recoveryTest = StartState("proposed", "down", "active", "ok").then(Connect).then(Connected)
    .expect(s.message == "offline" and safety).then(Heal).then(Connect).then(Connected)
    .expect(s.session == "ready" and s.message == "none" and safety)
  run currentProviderTalkTest = StartState("current", "down", "active", "ok").then(OpenMaps)
    .then(Connect).then(Connected).expect(not(NoProviderTalk) and not(HonestErrorsInvariant))
  run currentAssistantStopsGuidanceTest = StartState("current", "up", "active", "ok")
    .then(OpenMaps).then(Connect).then(Connected).then(Search).then(PickPlace).then(Directions)
    .then(Start).then(OpenAssistant).then(CloseAssistant).expect(s.screen == "Route" and s.route and not(NavSurvivesAssistantInvariant))
  run currentRerouteLosesRouteTest = StartState("current", "up", "active", "ok")
    .then(OpenMaps).then(Connect).then(Connected).then(Search).then(PickPlace).then(Directions)
    .then(Start).then(Fault).then(OffRoute).expect(not(s.route) and not(RouteKeptOnFailureInvariant))
}
