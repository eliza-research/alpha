/// The browser's confirmation dialogs: one open review per identity, approval only while the
/// app is shown and unlocked, a single settlement per request, and listener cleanup.
module BrowserReviews {
  pure val Reviews = Set(1, 2)
  type State = {
    foreground: bool, screenLocked: bool,
    // Reviews with an open dialog, and the reviews whose event listeners are installed.
    pending: Set[int], listening: Set[int],
    calls: int -> int, settled: int -> int,
    // How the most recent settled request for each review ended.
    last: int -> str,
    approvedHidden: bool
  }
  var s: State
  action init = s' = { foreground: true, screenLocked: false, pending: Set(), listening: Set(),
    calls: Reviews.mapBy(id => 0), settled: Reviews.mapBy(id => 0), last: Reviews.mapBy(id => "none"),
    approvedHidden: false }
  val shown = s.foreground and not(s.screenLocked)
  pure def verdict(foreground: bool, screenLocked: bool): str =
    if (foreground and not(screenLocked)) "approved" else "denied"
  // Every open review ends as not confirmed.
  pure def denyAll(t: State): State = { ...t, pending: Set(), listening: Set(),
    settled: Reviews.mapBy(id => if (t.pending.contains(id)) t.settled.get(id) + 1 else t.settled.get(id)),
    last: Reviews.mapBy(id => if (t.pending.contains(id)) "denied" else t.last.get(id)) }
  // A request while the same review is open, or while the app is hidden or locked, is refused
  // at once and opens nothing.
  action confirm(id: int): bool = all {
    Reviews.contains(id), s.calls.get(id) < 3,
    s' = if (s.pending.contains(id) or not(shown))
        { ...s, calls: s.calls.setBy(id, count => count + 1), settled: s.settled.setBy(id, count => count + 1),
          last: s.last.set(id, "refused") }
      else { ...s, calls: s.calls.setBy(id, count => count + 1), pending: s.pending.union(Set(id)),
        listening: s.listening.union(Set(id)) }
  }
  // The confirm button rechecks that the app is shown and unlocked at the moment of the click.
  action approve(id: int): bool = all {
    s.pending.contains(id),
    s' = { ...s, pending: s.pending.exclude(Set(id)), listening: s.listening.exclude(Set(id)),
      settled: s.settled.setBy(id, count => count + 1),
      last: s.last.set(id, verdict(s.foreground, s.screenLocked)),
      approvedHidden: s.approvedHidden or
        (verdict(s.foreground, s.screenLocked) == "approved" and (not(s.foreground) or s.screenLocked)) }
  }
  // Cancel, Back, Escape or the owner cancelling the review.
  action dismiss(id: int): bool = all {
    s.pending.contains(id),
    s' = { ...s, pending: s.pending.exclude(Set(id)), listening: s.listening.exclude(Set(id)),
      settled: s.settled.setBy(id, count => count + 1), last: s.last.set(id, "denied") }
  }
  action hide = s' = denyAll({ ...s, foreground: false })
  action show = s' = { ...s, foreground: true }
  action lockScreen = s' = denyAll({ ...s, screenLocked: true })
  action unlockScreen = s' = { ...s, screenLocked: false }
  action step = {
    nondet id = Reviews.oneOf()
    any { confirm(id), approve(id), dismiss(id), hide, show, lockScreen, unlockScreen, s' = s }
  }
  val OpenImpliesShown = s.pending.size() > 0 implies shown
  val ListenersMatchOpen = s.listening == s.pending
  val SettledOnce = Reviews.forall(id =>
    s.calls.get(id) - s.settled.get(id) == (if (s.pending.contains(id)) 1 else 0))
  val ApprovedOnlyWhileShown = not(s.approvedHidden)
  val TypeOK = s.pending.subseteq(Reviews) and
    Reviews.forall(id => s.last.get(id).in(Set("none", "approved", "denied", "refused")) and s.calls.get(id).in(0.to(3)))
  val safety = TypeOK and OpenImpliesShown and ListenersMatchOpen and SettledOnce and ApprovedOnlyWhileShown
  val TwoReviewsOpenWitness = s.pending == Reviews
  val DuplicateRefusedWitness = Reviews.exists(id => s.pending.contains(id) and s.last.get(id) == "refused")
  val ApprovedWitness = Reviews.exists(id => s.last.get(id) == "approved" and s.settled.get(id) > 1)
  val RefusedWhileLockedWitness = s.screenLocked and Reviews.exists(id => s.last.get(id) == "refused")
  // A second request for an open review does not disturb it and is refused.
  run duplicateRefusedTest = init.then(confirm(1)).then(confirm(1))
    .expect(s.pending == Set(1) and s.last.get(1) == "refused" and s.calls.get(1) == 2 and s.settled.get(1) == 1)
    .then(approve(1)).expect(s.last.get(1) == "approved" and s.settled.get(1) == 2 and safety)
  // Hiding the app settles every open review as not confirmed, and removes its listeners.
  run hiddenCancelsTest = init.then(confirm(1)).then(confirm(2)).then(hide)
    .expect(s.pending.size() == 0 and s.listening.size() == 0 and
      s.last.get(1) == "denied" and s.last.get(2) == "denied" and safety)
  run hiddenRequestRefusedTest = init.then(hide).then(confirm(1))
    .expect(s.pending.size() == 0 and s.last.get(1) == "refused" and safety)
  run lockCancelsTest = init.then(confirm(2)).then(lockScreen)
    .expect(s.pending.size() == 0 and s.last.get(2) == "denied").then(confirm(2))
    .expect(s.last.get(2) == "refused" and safety)
  run dismissThenReopenTest = init.then(confirm(1)).then(dismiss(1)).then(confirm(1))
    .expect(s.pending == Set(1) and s.last.get(1) == "denied" and safety)
}
