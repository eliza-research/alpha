/// Normal/private tab projection, the open-tab limit, hydration-gated persistence, the cold-start
/// merge of a saved record, row identity and navigation fencing.
module BrowserSession {
  // The source allows 8 open tabs (normal and private together); 3 stand for that limit.
  pure val Cap = 3
  type State = { normal: Set[int], privateTabs: Set[int], saved: Set[int], active: int,
    epoch: int, captured: int, navigating: bool, committed: bool, pristine: bool,
    history: Set[int], privatePage: bool, privateHistory: Set[int],
    order: List[int], savedOrder: List[int], savedActive: int,
    tabsOpen: bool, focusedTab: int, intendedTab: int,
    // Saving is on only after this launch read the saved record (or cleared it).
    hydrated: bool, restorePending: bool, clearing: bool,
    savedHistory: Set[int], launchSaved: Set[int], launchHistory: Set[int],
    // Pages whose load committed; a failed or abandoned load never joins them.
    committedPages: Set[int],
    // Saved tabs a non-replacing restore added after the open ones and the user has not closed.
    owed: Set[int] }
  var s: State
  pure def without(tabs: List[int], removed: int): List[int] =
    tabs.foldl(List(), (result, id) => if (id == removed) result else result.append(id))
  pure def firstTab(tabs: List[int]): int =
    tabs.foldl(0, (first, id) => if (first == 0) id else first)
  pure def tabSet(tabs: List[int]): Set[int] = tabs.foldl(Set(), (result, id) => result.union(Set(id)))
  action init = s' = { normal: Set(1), privateTabs: Set(), saved: Set(), active: 1,
    epoch: 0, captured: 0, navigating: false, committed: false, pristine: true,
    history: Set(), privatePage: false, privateHistory: Set(), order: List(1),
    savedOrder: List(), savedActive: 0, tabsOpen: false, focusedTab: 0, intendedTab: 0,
    hydrated: true, restorePending: false, clearing: false,
    savedHistory: Set(), launchSaved: Set(), launchHistory: Set(), committedPages: Set(), owed: Set() }
  val open = s.normal.union(s.privateTabs)
  // Saved tabs, in saved order, that are not already open and still fit under the limit.
  val added = s.savedOrder.foldl(List(), (fit, id) =>
    if (open.contains(id) or open.size() + fit.length() >= Cap) fit else fit.append(id))
  action normalTab = all { not(s.normal.contains(2)), open.size() < Cap,
    s' = { ...s, normal: s.normal.union(Set(2)), order: s.order.append(2),
      active: 2, privatePage: false, pristine: false, navigating: false,
      tabsOpen: false, focusedTab: 0, intendedTab: 0 } }
  action thirdNormalTab = all { not(s.normal.contains(4)), open.size() < Cap,
    s' = { ...s, normal: s.normal.union(Set(4)), order: s.order.append(4),
      active: 4, privatePage: false, pristine: false, navigating: false,
      tabsOpen: false, focusedTab: 0, intendedTab: 0 } }
  action privateTab = all { not(s.privateTabs.contains(3)), open.size() < Cap,
    s' = { ...s, privateTabs: s.privateTabs.union(Set(3)), order: s.order.append(3), active: 3,
      privatePage: true, pristine: false, navigating: false,
      tabsOpen: false, focusedTab: 0, intendedTab: 0 } }
  // A pop-up the native browser opened inherits its opener's privacy. Past the limit the
  // renderer closes it again instead of keeping a tab that would never be saved.
  action popupOpened(id: int): bool = all { not(open.contains(id)),
    if (s.privatePage) id == 3 else id.in(Set(2, 4)),
    s' = if (open.size() >= Cap) s
      else { ...s, normal: if (s.privatePage) s.normal else s.normal.union(Set(id)),
        privateTabs: if (s.privatePage) s.privateTabs.union(Set(id)) else s.privateTabs,
        order: s.order.append(id), active: id, pristine: false, navigating: false,
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
      privateHistory: s.privateHistory.exclude(Set(id)), owed: s.owed.exclude(Set(id)),
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
      committedPages: if (s.privatePage) s.committedPages else s.committedPages.union(Set(s.active)),
      privateHistory: if (s.privatePage) s.privateHistory.union(Set(s.active)) else s.privateHistory } }
  // A load that ends in an error page is not a visit.
  action loadFailed = all { s.navigating, s.captured == s.epoch, s' = { ...s, navigating: false } }
  // Nothing is written before the saved record was read, or while it is being cleared.
  action snapshot = all { s.hydrated, not(s.clearing), s' = { ...s, saved: s.normal,
    savedOrder: s.order.foldl(List(), (saved, id) => if (s.normal.contains(id)) saved.append(id) else saved),
    savedActive: if (s.normal.contains(s.active)) s.active else 0, savedHistory: s.history } }
  action closePrivate = {
    val normal = if (s.normal.size() > 0) s.normal else Set(1)
    val order = if (s.normal.size() > 0) without(s.order, 3) else List(1)
    s' = { ...s, normal: normal, order: order, privateTabs: Set(), privateHistory: Set(), owed: s.owed.exclude(Set(3)),
      active: if (normal.contains(s.active)) s.active else firstTab(order),
      privatePage: false, navigating: false, tabsOpen: false, focusedTab: 0, intendedTab: 0 }
  }
  action restart = {
    val normal = if (s.saved.size() > 0) s.saved else Set(1)
    val order = if (s.saved.size() > 0) s.savedOrder else List(1)
    s' = { ...s, normal: normal, order: order, privateTabs: Set(), privateHistory: Set(),
      active: if (normal.contains(s.savedActive)) s.savedActive else firstTab(order), privatePage: false,
      navigating: false, pristine: true, tabsOpen: false, focusedTab: 0, intendedTab: 0,
      history: s.savedHistory, hydrated: true, restorePending: false, clearing: false,
      launchSaved: s.saved, launchHistory: s.savedHistory, owed: Set() }
  }
  // A launch whose saved record has not been read yet: one new tab, nothing may be saved.
  action coldStart = s' = { ...s, normal: Set(1), order: List(1), privateTabs: Set(), privateHistory: Set(),
    active: 1, privatePage: false, navigating: false, pristine: true, tabsOpen: false, focusedTab: 0,
    intendedTab: 0, history: Set(), hydrated: false, restorePending: true, clearing: false,
    launchSaved: s.saved, launchHistory: s.savedHistory, owed: Set() }
  // The read settles while the launch tab is untouched. A failed read leaves saving off, so the
  // record stays as it was.
  action restoreRead(ok: bool): bool = all { s.restorePending, s.pristine or not(ok),
    s' = if (not(ok)) { ...s, restorePending: false }
      else if (s.saved.size() == 0) { ...s, restorePending: false, hydrated: true,
        history: s.history.union(s.savedHistory) }
      else { ...s, restorePending: false, hydrated: true, normal: s.saved, order: s.savedOrder,
        active: if (s.saved.contains(s.savedActive)) s.savedActive else firstTab(s.savedOrder),
        privatePage: false, history: s.history.union(s.savedHistory) } }
  // The read settles after the user already acted: the open tabs stay, still selected, the saved
  // history is merged and the saved tabs that fit follow the open ones, so the next save keeps them.
  action lateRestore = all { not(s.pristine), s.restorePending,
    s' = { ...s, restorePending: false, hydrated: true, normal: s.normal.union(tabSet(added)),
      order: s.order.concat(added), owed: tabSet(added), history: s.history.union(s.savedHistory) } }
  action clearStart = all { not(s.clearing), not(s.restorePending), s' = { ...s, clearing: true } }
  // Clearing closes every normal tab, empties history and the saved record, and keeps private tabs.
  action clearDone(ok: bool): bool = all { s.clearing,
    s' = if (not(ok)) { ...s, clearing: false }
      else {
        val order = if (s.privateTabs.size() == 0) List(1) else s.order.select(id => s.privateTabs.contains(id))
        val active = if (s.privateTabs.contains(s.active)) s.active else firstTab(order)
        { ...s, clearing: false, hydrated: true, normal: if (s.privateTabs.size() == 0) Set(1) else Set(),
          order: order, active: active, privatePage: s.privateTabs.contains(active),
          navigating: s.navigating and s.privatePage,
          history: Set(), saved: Set(), savedOrder: List(), savedActive: 0, savedHistory: Set(),
          launchSaved: Set(), launchHistory: Set(), owed: Set(),
          focusedTab: if (s.privateTabs.contains(s.focusedTab)) s.focusedTab else 0,
          intendedTab: if (s.privateTabs.contains(s.intendedTab)) s.intendedTab else 0 }
      } }
  action retireNavigation = all { s.epoch < 2,
    s' = { ...s, epoch: s.epoch + 1, navigating: false } }
  action step = {
    nondet id = Set(1, 2, 3, 4).oneOf()
    nondet ok = Set(false, true).oneOf()
    any { normalTab, thirdNormalTab, privateTab, popupOpened(id), showTabs, focusTab(id), closeTab(id), activateFocusedTab,
      navigate, commit, loadFailed, snapshot, closePrivate, restart, coldStart, restoreRead(ok), lateRestore,
      clearStart, clearDone(ok), retireNavigation, s' = s }
  }
  val PrivateNeverSaved = s.saved.intersect(Set(3)).size() == 0
  val PrivateHistoryIsolated = s.history.union(s.savedHistory).intersect(Set(3)).size() == 0
  val PrivatePagesDieWithTab = s.privateHistory.subseteq(s.privateTabs)
  val ActiveTabExists = s.normal.contains(s.active) or s.privateTabs.contains(s.active)
  val TabsDisjoint = s.normal.intersect(s.privateTabs).size() == 0
  val OrderedTabs = tabSet(s.order) == s.normal.union(s.privateTabs) and s.order.length() == tabSet(s.order).size()
  val FocusedTabIdentity = s.focusedTab == s.intendedTab and
    (s.focusedTab == 0 or s.normal.union(s.privateTabs).contains(s.focusedTab))
  val TabsBounded = open.size() <= Cap and open.size() > 0
  val HistoryOnlyFromCommitted = s.history.union(s.savedHistory).subseteq(s.committedPages)
  val UnreadRecordNeverOverwritten = not(s.hydrated) implies
    (s.saved == s.launchSaved and s.savedHistory == s.launchHistory)
  val SavedTabsSurviveLateRestore = s.owed.subseteq(s.normal)
  val safety = PrivateNeverSaved and PrivateHistoryIsolated and PrivatePagesDieWithTab and ActiveTabExists and
    TabsDisjoint and OrderedTabs and FocusedTabIdentity and TabsBounded and HistoryOnlyFromCommitted and
    UnreadRecordNeverOverwritten and SavedTabsSurviveLateRestore
  val LateRestoreMergedWitness = s.owed.size() > 0
  val UnreadRecordWitness = not(s.hydrated) and not(s.restorePending) and s.saved.size() > 0 and s.normal.contains(2)
  val TabLimitWitness = open.size() == Cap and s.privateTabs.size() > 0
  val SavedTabDoesNotFitWitness = s.hydrated and s.owed.size() > 0 and not(s.launchSaved.subseteq(s.normal))
  run privateRestartTest = init.then(privateTab).then(navigate).then(commit).then(snapshot)
    .then(restart).expect(s.privateTabs.size() == 0 and s.privateHistory.size() == 0 and safety)
  // A user who acts before the saved record is read keeps the open tabs, and the saved tab is
  // added after them, so the next save still contains it.
  run lateRestoreTest = init.then(thirdNormalTab).then(navigate).then(commit).then(snapshot)
    .then(coldStart).then(normalTab).then(lateRestore)
    .expect(s.active == 2 and s.order == List(1, 2, 4) and s.owed == Set(4) and s.history == Set(4) and safety)
    .then(snapshot).expect(s.saved == Set(1, 2, 4) and safety)
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
  run unreadRecordIsNotSavedTest = init.then(thirdNormalTab).then(navigate).then(commit).then(snapshot)
    .then(coldStart).then(normalTab).expect(not(s.hydrated)).then(snapshot).fail()
  run failedLoadStaysOutOfHistoryTest = init.then(navigate).then(loadFailed)
    .expect(s.history.size() == 0 and not(s.navigating) and safety)
  run failedReadKeepsRecordTest = init.then(normalTab).then(navigate).then(commit).then(snapshot)
    .then(coldStart).then(restoreRead(false)).then(thirdNormalTab).then(navigate).then(commit)
    .expect(not(s.hydrated) and s.saved == Set(1, 2) and s.savedHistory == Set(2) and safety)
    .then(snapshot).fail()
  run tabLimitTest = init.then(normalTab).then(privateTab).expect(open.size() == Cap)
    .then(popupOpened(3)).fail()
  run popupPastLimitIsClosedTest = init.then(normalTab).then(privateTab).then(showTabs).then(focusTab(1))
    .then(activateFocusedTab).then(popupOpened(4)).expect(open == Set(1, 2, 3) and s.active == 1 and safety)
  run clearDataTest = init.then(navigate).then(commit).then(privateTab).then(snapshot)
    .then(clearStart).then(snapshot).fail()
  run clearDataKeepsPrivateTabsTest = init.then(navigate).then(commit).then(privateTab).then(snapshot)
    .then(clearStart).then(clearDone(true))
    .expect(s.normal.size() == 0 and s.privateTabs == Set(3) and s.active == 3 and
      s.saved.size() == 0 and s.history.size() == 0 and safety)
  run closedPrivateTabForgetsPagesTest = init.then(privateTab).then(navigate).then(commit)
    .expect(s.privateHistory == Set(3)).then(closeTab(3)).expect(s.privateHistory.size() == 0 and safety)
}
