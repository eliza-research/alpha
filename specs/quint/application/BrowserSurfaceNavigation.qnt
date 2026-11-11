/// One tab of the web build's browser surface: each host navigation gets a fresh frame, only
/// that frame's first load commits the page, and a retired frame's late load changes nothing.
module BrowserSurfaceNavigation {
  pure val MaxFrame = 6
  type State = {
    exists: bool,
    // Entries in the tab's own history and the selected one; -1 before the first navigation.
    entries: int, position: int,
    navigation: int, loading: bool, committed: bool, error: str,
    // The frame now in the tab, and the frames that were given an address and can still report a load.
    frame: int, loadable: Set[int],
    // The frame the latest host navigation created.
    navigationFrame: int,
    staleCommit: bool
  }
  var s: State
  action init = s' = { exists: false, entries: 0, position: -1, navigation: 0, loading: false,
    committed: false, error: "", frame: 0, loadable: Set(), navigationFrame: 0, staleCommit: false }
  // A navigation replaces the frame, so callbacks of the earlier frame no longer match.
  pure def loaded(t: State): State = { ...t, navigation: t.navigation + 1, loading: true, committed: false,
    error: "", frame: t.frame + 1, loadable: t.loadable.union(Set(t.frame + 1)), navigationFrame: t.frame + 1 }
  // A tab created again under the same identity has its own frame.
  action create = all { not(s.exists), s.frame < MaxFrame, s' = { ...s, exists: true, frame: s.frame + 1 } }
  action navigate = all { s.exists, s.frame < MaxFrame, s.entries < 3,
    s.position < 2,
    s' = loaded({ ...s, entries: s.position + 2, position: s.position + 1 }) }
  action back = all { s.exists, s.frame < MaxFrame, s.position > 0,
    s' = loaded({ ...s, position: s.position - 1 }) }
  action forward = all { s.exists, s.frame < MaxFrame, s.position < s.entries - 1,
    s' = loaded({ ...s, position: s.position + 1 }) }
  action reload = all { s.exists, s.frame < MaxFrame, s.position >= 0, s' = loaded(s) }
  // Stop swaps in a blank frame that reports nothing.
  action stop = all { s.exists, s.loading, s.frame < MaxFrame,
    s' = { ...s, frame: s.frame + 1, navigation: s.navigation + 1, loading: false, committed: false,
      error: "stopped" } }
  // A load from the current frame commits a loading page. A second load from it means the site
  // navigated on its own inside the frame, which the host cannot follow.
  action frameLoad(id: int): bool = all {
    s.loadable.contains(id),
    s' = if (not(s.exists) or id != s.frame) s
      else if (not(s.loading)) { ...s, navigation: s.navigation + 1, committed: false, error: "inner-navigation" }
      else { ...s, loading: false, committed: true,
        staleCommit: s.staleCommit or id != s.navigationFrame }
  }
  // Closing forgets the tab's history and its navigation count; a tab created again starts both over.
  action close = all { s.exists, s' = { ...s, exists: false, loading: false, committed: false, error: "",
    entries: 0, position: -1, navigation: 0 } }
  action step = {
    nondet id = 1.to(MaxFrame).oneOf()
    any { create, navigate, back, forward, reload, stop, frameLoad(id), close, s' = s }
  }
  val CommittedIsSettled = s.committed implies (s.exists and not(s.loading) and s.error == "" and
    s.loadable.contains(s.frame))
  val SettledWithoutErrorIsCommitted =
    (s.exists and s.position >= 0 and not(s.loading) and s.error == "") implies s.committed
  val LoadingHasNoError = s.loading implies (s.error == "" and not(s.committed) and s.loadable.contains(s.frame))
  val RetiredFrameInert = not(s.staleCommit)
  val PositionInHistory = s.position < s.entries and s.position >= -1 and s.entries <= 3
  val TypeOK = s.error.in(Set("", "stopped", "inner-navigation")) and s.frame.in(0.to(MaxFrame)) and
    s.loadable.subseteq(1.to(MaxFrame))
  val safety = TypeOK and CommittedIsSettled and SettledWithoutErrorIsCommitted and LoadingHasNoError and
    RetiredFrameInert and PositionInHistory
  val LateLoadPendingWitness = s.loading and s.frame > 1 and s.loadable.contains(s.frame - 1)
  val InnerNavigationWitness = s.error == "inner-navigation" and s.exists
  val StoppedWitness = s.error == "stopped" and s.loadable.size() > 0
  // A late load from the frame of an earlier navigation must not commit the newer address.
  run retiredFrameLoadTest = init.then(create).then(navigate).then(navigate)
    .expect(s.frame == 3 and s.loading).then(frameLoad(2))
    .expect(s.loading and not(s.committed)).then(frameLoad(3))
    .expect(s.committed and not(s.loading) and safety)
  run stoppedLoadNeverCommitsTest = init.then(create).then(navigate).then(stop).then(frameLoad(2))
    .expect(not(s.committed) and s.error == "stopped" and safety)
  run innerNavigationTest = init.then(create).then(navigate).then(frameLoad(2)).then(frameLoad(2))
    .expect(not(s.committed) and s.error == "inner-navigation" and s.navigation == 2 and safety)
  run historyCommandsTest = init.then(create).then(navigate).then(frameLoad(2)).then(navigate).then(frameLoad(3))
    .then(back).expect(s.position == 0 and s.loading).then(frameLoad(4)).then(forward).then(frameLoad(5))
    .expect(s.position == 1 and s.committed and safety)
  run closedTabIgnoresLoadTest = init.then(create).then(navigate).then(close).then(frameLoad(2))
    .expect(not(s.committed) and not(s.exists)).then(create).then(frameLoad(2))
    .expect(s.exists and not(s.committed) and s.error == "" and safety)
}
