// Exact current Home brief scope, selection and observer publication.
module RetainedHomeBrief {
  type Brief = {summary: str, time: int, agent: str, status: str}
  type State = {scope: str, brief: Brief, accepted: str, events: int,
    listeners: int -> str, calls: int -> int}
  var s: State
  pure val Scopes = Set("", "A", "B")
  pure val Agents = Set("default", "custom", "long")
  pure val Profiles = Set("none", "nonrun", "first", "time", "tie", "failure", "long")
  pure val IDs = 1.to(3)
  pure val Modes = Set("listen", "throw", "removeTwo")
  pure val None: Brief = {summary: "", time: 0, agent: "", status: ""}
  pure def briefFor(profile: str, agent: str): Brief =
    if (Set("none", "nonrun").contains(profile)) None
    else {summary: if (profile == "time") "second" else profile,
      time: if (profile == "first") 1 else if (profile == "long") 3 else 2,
      agent: agent, status: if (profile == "failure") "failed" else "finished"}
  pure def publish(x: State, brief: Brief): State =
    if (x.brief == brief) x
    else {
      val removes = IDs.exists(id => x.listeners.get(id) == "removeTwo")
      {...x, brief: brief, events: x.events + 1,
        calls: IDs.mapBy(id => x.calls.get(id) + if (x.listeners.get(id) == "") 0 else 1),
        listeners: if (removes) x.listeners.set(2, "") else x.listeners}
    }

  action init = s' = {scope: "", brief: None, accepted: "", events: 0,
    listeners: IDs.mapBy(_ => ""), calls: IDs.mapBy(_ => 0)}
  action bind(scope: str): bool = all {
    Scopes.contains(scope),
    s' = if (s.scope == scope) s else publish({...s, scope: scope}, None),
  }
  action remember(scope: str, profile: str, agent: str): bool = all {
    Scopes.contains(scope), Profiles.contains(profile), Agents.contains(agent),
    s' = if (s.scope != scope) {...s, accepted: "no"}
      else publish({...s, accepted: "yes"}, briefFor(profile, agent)),
  }
  action subscribe(id: int, mode: str): bool = all {
    IDs.contains(id), Modes.contains(mode), s.listeners.get(id) == "",
    s' = {...s, listeners: s.listeners.set(id, mode)},
  }
  action unsubscribe(id: int): bool = all {
    IDs.contains(id), s' = {...s, listeners: s.listeners.set(id, "")},
  }
  action step = any {
    { nondet scope = Scopes.oneOf(); bind(scope) },
    { nondet scope = Scopes.oneOf(); nondet profile = Profiles.oneOf(); nondet agent = Agents.oneOf();
      remember(scope, profile, agent) },
    { nondet id = IDs.oneOf(); nondet mode = Modes.oneOf(); subscribe(id, mode) },
    { nondet id = IDs.oneOf(); unsubscribe(id) },
  }
  val safety = all {
    Scopes.contains(s.scope),
    s.brief == None or Set("finished", "failed").contains(s.brief.status),
    IDs.forall(id => s.calls.get(id) <= s.events),
  }
  run latePreviousScopeCannotReplaceCurrentBriefTest = init.then(bind("A"))
    .then(remember("A", "first", "default")).then(bind("B"))
    .then(remember("B", "tie", "custom")).then(remember("A", "time", "default"))
    .expect(s.brief.summary == "tie" and s.accepted == "no" and s.events == 3 and safety)
  run nonRunningOccurrencesDoNotBecomeABriefTest = init.then(remember("", "time", "default"))
    .then(remember("", "nonrun", "default"))
    .expect(s.brief == None and s.events == 2 and safety)
  run sourcePublicationUsesCopiedObserverSetTest = init.then(subscribe(1, "removeTwo"))
    .then(subscribe(2, "listen")).then(subscribe(3, "throw"))
    .then(remember("", "first", "default")).then(remember("", "tie", "default"))
    .expect(s.calls.get(1) == 2 and s.calls.get(2) == 1 and s.calls.get(3) == 2 and safety)
}
