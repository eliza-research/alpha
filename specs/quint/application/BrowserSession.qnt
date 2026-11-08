/// Normal/private tab projection, persistence merge, row identity and navigation fencing.
module BrowserSession {
  type State = { normal: Set[int], privateTabs: Set[int], saved: Set[int], active: int,
    epoch: int, captured: int, navigating: bool, committed: bool, pristine: bool,
    history: Set[int], privatePage: bool, privateHistory: Set[int],
    order: List[int], savedOrder: List[int], savedActive: int,
    tabsOpen: bool, focusedTab: int, intendedTab: int }
  var s: State
  pure def without(tabs: List[int], removed: int): List[int] =
    tabs.foldl(List(), (result, id) => if (id == removed) result else result.append(id))
  pure def firstTab(tabs: List[int]): int =
    tabs.foldl(0, (first, id) => if (first == 0) id else first)
  pure def tabSet(tabs: List[int]): Set[int] = tabs.foldl(Set(), (result, id) => result.union(Set(id)))
  action init = s' = { normal: Set(1), privateTabs: Set(), saved: Set(), active: 1,
    epoch: 0, captured: 0, navigating: false, committed: false, pristine: true,
    history: Set(), privatePage: false, privateHistory: Set(), order: List(1),
    savedOrder: List(), savedActive: 0, tabsOpen: false, focusedTab: 0, intendedTab: 0 }
  action normalTab = all { not(s.normal.contains(2)),
    s' = { ...s, normal: s.normal.union(Set(2)), order: s.order.append(2),
      active: 2, privatePage: false, pristine: false, navigating: false,
      tabsOpen: false, focusedTab: 0, intendedTab: 0 } }
  action thirdNormalTab = all { not(s.normal.contains(4)),
    s' = { ...s, normal: s.normal.union(Set(4)), order: s.order.append(4),
      active: 4, privatePage: false, pristine: false, navigating: false,
      tabsOpen: false, focusedTab: 0, intendedTab: 0 } }
  action privateTab = all { not(s.privateTabs.contains(3)),
    s' = { ...s, privateTabs: s.privateTabs.union(Set(3)), order: s.order.append(3), active: 3,
      privatePage: true, pristine: false, navigating: false,
      tabsOpen: false, focusedTab: 0, intendedTab: 0 } }
  action showTabs = s' = { ...s, tabsOpen: true }
  action focusTab(id: int): bool = all { s.tabsOpen, s.normal.union(s.privateTabs).contains(id),
    s' = { ...s, focusedTab: id, intendedTab: id } }
  action closeTab(id: int): bool = all { s.normal.union(s.privateTabs).contains(id), {
    val remaining = without(s.order, id)
    val empty = remaining.length() == 0
    val order = if (empty) List(1) else remaining
    val normal = if (empty) Set(1) else s.normal.exclude(Set(id))
    val privateTabs = s.privateTabs.exclude(Set(id))
    val active = if (s.active == id) firstTab(order) else s.active
    s' = { ...s, normal: normal, privateTabs: privateTabs, order: order, active: active,
      privatePage: privateTabs.contains(active),
      focusedTab: if (s.focusedTab == id) 0 else s.focusedTab,
      intendedTab: if (s.intendedTab == id) 0 else s.intendedTab }
  } }
  action activateFocusedTab = all { s.focusedTab != 0, s.tabsOpen,
    s' = { ...s, active: s.focusedTab, privatePage: s.privateTabs.contains(s.focusedTab),
      tabsOpen: false, focusedTab: 0, intendedTab: 0 } }
  action navigate = all { s.epoch < 2, s' = { ...s, epoch: s.epoch + 1,
    captured: s.epoch + 1, navigating: true, committed: false, pristine: false } }
  action commit = all { s.navigating, s.captured == s.epoch,
    s' = { ...s, navigating: false, committed: true,
      history: if (s.privatePage) s.history else s.history.union(Set(s.active)),
      privateHistory: if (s.privatePage) s.privateHistory.union(Set(s.active)) else s.privateHistory } }
  action snapshot = s' = { ...s, saved: s.normal,
    savedOrder: s.order.foldl(List(), (saved, id) => if (s.normal.contains(id)) saved.append(id) else saved),
    savedActive: if (s.normal.contains(s.active)) s.active else 0 }
  action closePrivate = {
    val normal = if (s.normal.size() > 0) s.normal else Set(1)
    val order = if (s.normal.size() > 0) without(s.order, 3) else List(1)
    s' = { ...s, normal: normal, order: order, privateTabs: Set(), privateHistory: Set(),
      active: if (normal.contains(s.active)) s.active else firstTab(order),
      privatePage: false, navigating: false, tabsOpen: false, focusedTab: 0, intendedTab: 0 }
  }
  action restart = {
    val normal = if (s.saved.size() > 0) s.saved else Set(1)
    val order = if (s.saved.size() > 0) s.savedOrder else List(1)
    s' = { ...s, normal: normal, order: order, privateTabs: Set(), privateHistory: Set(),
      active: if (normal.contains(s.savedActive)) s.savedActive else firstTab(order), privatePage: false,
      navigating: false, pristine: true, tabsOpen: false, focusedTab: 0, intendedTab: 0 }
  }
  action lateRestore = all { not(s.pristine), s' = s }
  action retireNavigation = all { s.epoch < 2,
    s' = { ...s, epoch: s.epoch + 1, navigating: false } }
  action step = {
    nondet id = Set(1, 2, 3, 4).oneOf()
    any { normalTab, thirdNormalTab, privateTab, showTabs, focusTab(id), closeTab(id), activateFocusedTab,
      navigate, commit, snapshot, closePrivate, restart, lateRestore, retireNavigation, s' = s }
  }
  val PrivateNeverSaved = s.saved.intersect(Set(3)).size() == 0
  val PrivateHistoryIsolated = s.history.intersect(Set(3)).size() == 0
  val ActiveTabExists = s.normal.contains(s.active) or s.privateTabs.contains(s.active)
  val TabsDisjoint = s.normal.intersect(s.privateTabs).size() == 0
  val OrderedTabs = tabSet(s.order) == s.normal.union(s.privateTabs) and s.order.length() == tabSet(s.order).size()
  val FocusedTabIdentity = s.focusedTab == s.intendedTab and
    (s.focusedTab == 0 or s.normal.union(s.privateTabs).contains(s.focusedTab))
  val safety = PrivateNeverSaved and PrivateHistoryIsolated and ActiveTabExists and TabsDisjoint and OrderedTabs and FocusedTabIdentity
  run privateRestartTest = init.then(privateTab).then(navigate).then(commit).then(snapshot)
    .then(restart).expect(s.privateTabs.size() == 0 and s.privateHistory.size() == 0 and safety)
  run lateRestoreTest = init.then(normalTab).then(lateRestore).expect(s.active == 2 and safety)
  run normalHistoryTest = init.then(navigate).then(commit).then(snapshot)
    .then(restart).expect(s.history.contains(1) and safety)
  run closeEarlierTabKeepsFocusTest = init.then(normalTab).then(thirdNormalTab).then(showTabs)
    .then(focusTab(2)).then(closeTab(1)).expect(s.focusedTab == 2 and safety)
    .then(activateFocusedTab).expect(s.active == 2 and safety)
  run closeFocusedTabClearsFocusTest = init.then(normalTab).then(showTabs).then(focusTab(2)).then(closeTab(2))
    .expect(s.focusedTab == 0 and s.active == 1 and safety)
  run normalSelectionRestoredTest = init.then(normalTab).then(snapshot).then(restart)
    .expect(s.active == 2 and s.order == List(1, 2) and safety)
  run closureFallbackUsesOrderTest = init.then(thirdNormalTab).then(normalTab).then(closeTab(1)).then(closeTab(2))
    .expect(s.active == 4 and s.order == List(4) and safety)
}
