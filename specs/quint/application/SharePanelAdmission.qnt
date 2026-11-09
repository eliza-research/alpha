// Exact renderer ownership of the common destination chooser.
module SharePanelAdmission {
  type Effect = {panel: int, destination: str, closed: bool}
  type State = {seen: int, active: int, hidden: bool, invalid: Set[int], emails: Set[int],
    settled: Set[int], effects: List[Effect], notice: bool, alerts: int}
  var s: State

  action init = s' = {seen: 0, active: 0, hidden: false, invalid: Set(), emails: Set(),
    settled: Set(), effects: List(), notice: false, alerts: 0}

  pure def close(state: State): State =
    if (state.active == 0) state
    else {...state, active: 0, settled: state.settled.union(Set(state.active)), notice: false}

  action open(email: bool): bool = all {
    s.seen < 3,
    val id = s.seen + 1
    val previous = close(s)
    s' = if (s.hidden) {...previous, seen: id, settled: previous.settled.union(Set(id))}
      else {...previous, seen: id, active: id, emails: if (email) s.emails.union(Set(id)) else s.emails},
  }

  action retire = s' = close(s)
  action visibility(hidden: bool): bool =
    s' = if (hidden) close({...s, hidden: true}) else {...s, hidden: false}
  action invalidate = all {
    s.active != 0, s' = {...s, invalid: s.invalid.union(Set(s.active))},
  }
  action poll = s' = if (s.invalid.contains(s.active)) close(s) else s
  action choose(id: int, destination: str, outcome: str): bool = all {
    id > 0, id <= s.seen, destination.in(Set("email", "external", "copy", "save", "cancel")),
    outcome.in(Set("ok", "abort", "fail")),
    val available = destination != "email" or s.emails.contains(id)
    val previous = close(s)
    s' = if (id != s.active or s.hidden or not(available)) s
      else if (s.invalid.contains(id)) {...s, notice: true}
      else if (destination == "cancel") previous
      else {...previous, effects: s.effects.append({panel: id, destination: destination, closed: true}),
        alerts: if (outcome == "fail") s.alerts + 1 else s.alerts},
  }

  action step = any {
    open(true), open(false), retire, visibility(true), visibility(false), invalidate, poll,
    { nondet id = Set(1, 2, 3).oneOf()
      nondet destination = Set("email", "external", "copy", "save", "cancel").oneOf()
      nondet outcome = Set("ok", "abort", "fail").oneOf()
      choose(id, destination, outcome) },
    s' = s,
  }

  val ActivePanelIsUnsettled = s.active != 0 implies (not(s.hidden) and not(s.settled.contains(s.active)))
  val EffectFollowsExactClose = s.effects.indices().forall(i => {
    val effect = s.effects.nth(i)
    effect.closed and s.settled.contains(effect.panel)
      and (effect.destination != "email" or s.emails.contains(effect.panel))
  })
  val EachPanelDispatchesOnce = s.effects.indices().forall(i =>
    s.effects.indices().forall(j => i == j or s.effects.nth(i).panel != s.effects.nth(j).panel))
  val NoticeBelongsToStaleSelection = s.notice implies (s.active != 0 and s.invalid.contains(s.active))
  val safety = ActivePanelIsUnsettled and EffectFollowsExactClose and EachPanelDispatchesOnce and NoticeBelongsToStaleSelection

  run replacementRetiresEarlierButtonsTest = init.then(open(true)).then(open(false))
    .then(choose(1, "external", "ok")).expect(s.active == 2 and s.settled == Set(1) and s.effects == List() and safety)
    .then(choose(2, "email", "ok")).then(choose(2, "copy", "ok")).then(choose(2, "copy", "ok"))
    .expect(s.effects == List({panel: 2, destination: "copy", closed: true}) and safety)
  run changedSelectionIsRetiredWithoutFallbackTest = init.then(open(true)).then(invalidate)
    .then(choose(1, "email", "ok")).expect(s.active == 1 and s.notice and safety)
    .then(poll).then(choose(1, "external", "ok")).expect(s.active == 0 and s.effects == List() and not(s.notice) and safety)
  run hiddenRequestAndCancellationCannotDispatchTest = init.then(open(true)).then(visibility(true))
    .then(open(false)).then(visibility(false)).then(open(true)).then(choose(3, "cancel", "ok"))
    .then(choose(3, "save", "ok")).expect(s.active == 0 and s.settled == Set(1, 2, 3) and s.effects == List() and safety)
  run exactDestinationFailureNeverFallsBackTest = init.then(open(true)).then(choose(1, "external", "abort"))
    .then(open(true)).then(choose(2, "email", "fail")).expect(s.effects.length() == 2 and s.alerts == 1 and safety)
}
