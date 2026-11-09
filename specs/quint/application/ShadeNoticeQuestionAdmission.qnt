// Own-notice questions in the simulated development shade.
module ShadeNoticeQuestionAdmission {
  type Composition = {id: int, notice: str}
  type Report = {id: int, result: str}
  type State = {shade: bool, screen: str, hidden: bool, live: bool, epoch: int,
    owner: int, dialog: int, reviews: int -> str, pending: Set[int],
    composed: List[Composition], reported: List[Report], staleEffect: bool}
  var s: State

  action init = s' = {shade: true, screen: "home", hidden: false, live: true, epoch: 0,
    owner: 0, dialog: 0, reviews: Map(), pending: Set(), composed: List(), reported: List(), staleEffect: false}
  val shadeAvailable = s.live and s.shade and s.screen == "home" and not(s.hidden)
  pure def retire(state: State): State = {...state, owner: 0, dialog: 0}
  action ask(notice: str): bool = all {
    shadeAvailable, notice.in(Set("a", "b")), s.reviews.keys().size() < 3,
    val id = s.reviews.keys().size() + 1
    s' = {...s, owner: id, dialog: id, reviews: s.reviews.put(id, notice)},
  }
  action approve = all {
    shadeAvailable, s.dialog != 0, s.dialog == s.owner,
    s' = {...s, dialog: 0, pending: s.pending.union(Set(s.owner))},
  }
  action cancel = all { s.dialog != 0, s' = retire(s) }
  action setShade(open: bool): bool = all {
    s.live,
    s' = if (open) {...s, shade: true} else retire({...s, shade: false}),
  }
  action setScreen(screen: str): bool = all {
    s.live, screen.in(Set("home", "lock", "off")),
    s' = if (screen == "home") {...s, screen: screen} else retire({...s, screen: screen}),
  }
  action visibility(hidden: bool): bool = all {
    s.live, hidden != s.hidden, s.epoch < 4,
    val changed = {...s, hidden: hidden, epoch: s.epoch + 1}
    s' = if (hidden) retire(changed) else changed,
  }
  action deviceState = all { s.live, s.epoch < 4, s' = retire({...s, epoch: s.epoch + 1}) }
  action unmount = all { s.live, s' = retire({...s, live: false, epoch: s.epoch + 1}) }
  action finish(id: int, result: str): bool = all {
    s.pending.contains(id), result.in(Set("exact", "changed", "unavailable")),
    val observed = {...s, pending: s.pending.exclude(Set(id))}
    s' = if (id != s.owner or not(shadeAvailable)) observed
      else if (result == "exact") retire({...observed, shade: false, composed: s.composed.append({id: id, notice: s.reviews.get(id)})})
      else retire({...observed, reported: s.reported.append({id: id, result: result})}),
  }
  action step = any {
    ask("a"), ask("b"), approve, cancel, setShade(true), setShade(false),
    setScreen("home"), setScreen("lock"), setScreen("off"), visibility(true), visibility(false), deviceState, unmount,
    {nondet id = Set(1, 2, 3).oneOf(); nondet result = Set("exact", "changed", "unavailable").oneOf(); finish(id, result)},
    s' = s,
  }

  val DialogHasExactLease = s.dialog != 0 implies (shadeAvailable and s.dialog == s.owner)
  val CurrentOwnerIsActive = s.owner != 0 implies
    (shadeAvailable and s.reviews.keys().contains(s.owner) and (s.dialog == s.owner or s.pending.contains(s.owner)))
  val RetiredReadHasNoEffect = not(s.staleEffect)
  val ComposedNoticeWasReviewed = s.composed.indices().forall(i => {
    val composed = s.composed.nth(i)
    s.reviews.get(composed.id) == composed.notice
  })
  val safety = DialogHasExactLease and CurrentOwnerIsActive and RetiredReadHasNoEffect and ComposedNoticeWasReviewed

  run approvedDialogHandsOffItsLeaseTest = init.then(ask("a")).then(approve)
    .expect(s.dialog == 0 and s.owner == 1 and s.pending == Set(1) and safety)
    .then(finish(1, "exact")).expect(s.composed == List({id: 1, notice: "a"}) and safety)
  run successorReviewRetiresPendingReadTest = init.then(ask("a")).then(approve).then(ask("b"))
    .then(finish(1, "exact")).expect(s.owner == 2 and s.dialog == 2 and s.composed == List() and safety)
    .then(approve).then(finish(2, "exact")).expect(s.composed == List({id: 2, notice: "b"}) and safety)
  run shadeReentryCannotReviveReadTest = init.then(ask("a")).then(approve).then(setShade(false)).then(setShade(true))
    .then(finish(1, "exact")).expect(s.shade and s.owner == 0 and s.composed == List() and safety)
  run foregroundAndLockRetireReadTest = init.then(ask("a")).then(approve).then(visibility(true)).then(visibility(false))
    .then(finish(1, "unavailable")).then(ask("b")).then(approve).then(setScreen("lock")).then(finish(2, "exact"))
    .expect(s.owner == 0 and s.reported == List() and s.composed == List() and safety)
  run currentReadKeepsUnavailableReportTest = init.then(ask("a")).then(approve).then(finish(1, "unavailable"))
    .expect(s.owner == 0 and s.reported == List({id: 1, result: "unavailable"}) and safety)
}
