// Legacy read-only reminder open across refresh ownership and shell navigation visits.
module ReminderOpenIntent {
  type Intent = {id: str, occurrence: str, at: int, view: str, visit: int, followedCalendar: bool}
  type Delivery = {kind: str, intentVisit: int, viewVisit: int}
  type State = {view: str, deferred: str, visit: int, refresh: int, reads: int -> str,
    now: int, foreground: bool, intent: Intent, cache: str, stale: bool, notice: str, delivery: Delivery}
  var s: State

  pure val empty: Intent = {id: "", occurrence: "", at: 0, view: "", visit: 0, followedCalendar: false}
  action initView(view: str): bool = all {
    view.in(Set("home", "calendar", "workflows")),
    s' = {view: view, deferred: "", visit: 0, refresh: 0, reads: Map(), now: 0, foreground: true,
      intent: empty, cache: "", stale: false, notice: "", delivery: {kind: "none", intentVisit: -1, viewVisit: -1}},
  }
  action init = initView("home")

  action navigate(view: str, held: bool): bool = all {
    view.in(Set("home", "notes", "calendar")), s.visit < 4,
    held implies (s.view == "workflows" and view == "calendar" and s.deferred == ""),
    val follows = view == "calendar" and s.intent.id != "" and s.intent.visit == s.visit
      and not(s.intent.followedCalendar) and s.intent.view != "calendar" and s.view == s.intent.view
    s' = {...s, visit: s.visit + 1, view: if (held) s.view else view,
      deferred: if (held) view else s.deferred,
      intent: if (follows) {...s.intent, visit: s.visit + 1, followedCalendar: true} else s.intent},
  }
  action commitNavigation = all { s.deferred != "", s' = {...s, view: s.deferred, deferred: ""} }
  action refresh(id: str, occurrence: str): bool = all {
    id.in(Set("", "tapped")), occurrence.in(Set("", "one")), id == "" implies occurrence == "", s.refresh < 3,
    val generation = s.refresh + 1
    s' = {...s, refresh: generation, reads: s.reads.put(generation, "held"),
      intent: if (id == "") s.intent else
        {id: id, occurrence: occurrence, at: s.now, view: s.view, visit: s.visit, followedCalendar: false}},
  }
  action advance(ms: int): bool = all {
    ms.in(Set(5000, 29999, 30000, 31000)), s.now < 31000, s' = {...s, now: s.now + ms},
  }
  action setForeground(visible: bool): bool = s' = {...s, foreground: visible}

  action finishRead(id: int, outcome: str): bool = all {
    s.reads.keys().contains(id), s.reads.get(id) == "held", outcome.in(Set("one", "other", "failed")),
    val readsAfter = s.reads.set(id, if (outcome == "failed") "failed" else "ok")
    val opens = s.intent.id != "" and s.intent.visit == s.visit and s.now - s.intent.at < 30000
      and s.foreground and (s.view == s.intent.view or s.view == "calendar")
    val kind = if (s.intent.occurrence == "" or s.intent.occurrence == outcome) "detail" else "calendar"
    if (id != s.refresh) s' = {...s, reads: readsAfter}
    else if (outcome == "failed") s' = {...s, reads: readsAfter, stale: true, intent: empty,
      notice: if (s.intent.id != "") "open-failed" else if (not(s.stale)) "refresh-failed" else s.notice}
    else s' = {...s, reads: readsAfter, cache: outcome, stale: false, intent: empty,
      view: if (opens) "calendar" else s.view, visit: if (opens) s.visit + 1 else s.visit,
      delivery: if (opens) {kind: kind, intentVisit: s.intent.visit, viewVisit: s.visit} else s.delivery},
  }
  action step = any {
    refresh("tapped", "one"), refresh("tapped", ""), refresh("", ""), commitNavigation,
    {nondet view = Set("home", "notes", "calendar").oneOf(); nondet held = Bool.oneOf(); navigate(view, held)},
    {nondet ms = Set(5000, 29999, 30000, 31000).oneOf(); advance(ms)},
    {nondet visible = Bool.oneOf(); setForeground(visible)},
    {nondet id = Set(1, 2, 3).oneOf(); nondet outcome = Set("one", "other", "failed").oneOf(); finishRead(id, outcome)},
    s' = s,
  }

  val DeliveryOwnsCurrentVisit = s.delivery.kind != "none" implies
    (s.delivery.intentVisit == s.delivery.viewVisit and s.delivery.viewVisit < s.visit)
  val VisitAndReadAreIndependent = s.intent.visit <= s.visit and s.reads.keys().size() == s.refresh
  val safety = DeliveryOwnsCurrentVisit and VisitAndReadAreIndependent

  run latestResumeStillOpensExactReminderTest = init.then(refresh("tapped", "one")).then(refresh("", ""))
    .then(advance(5000)).then(finishRead(2, "one")).then(finishRead(1, "other"))
    .expect(s.delivery.kind == "detail" and s.cache == "one" and safety)
  run interveningVisitRetiresTapTest = init.then(refresh("tapped", "one"))
    .then(navigate("notes", false)).then(navigate("home", false)).then(finishRead(1, "one"))
    .expect(s.view == "home" and s.delivery.kind == "none" and s.cache == "one" and safety)
  run directCalendarEntryKeepsTapTest = init.then(refresh("tapped", "one"))
    .then(navigate("calendar", false)).then(finishRead(1, "one"))
    .expect(s.delivery.kind == "detail" and s.delivery.intentVisit == 1 and safety)
  run workflowsRowCapturesRequestedVisitTest = initView("workflows").then(navigate("calendar", true))
    .then(refresh("tapped", "one")).then(commitNavigation).then(finishRead(1, "one"))
    .expect(s.delivery.kind == "detail" and s.delivery.intentVisit == 1 and safety)
  run expiredTapKeepsTheCacheTest = init.then(refresh("tapped", "one")).then(advance(30000)).then(finishRead(1, "one"))
    .expect(s.delivery.kind == "none" and s.cache == "one" and safety)
  run differentOccurrenceOnlyOpensCalendarTest = init.then(refresh("tapped", "one")).then(finishRead(1, "other"))
    .expect(s.view == "calendar" and s.delivery.kind == "calendar" and safety)
}
