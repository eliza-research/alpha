/// The Browser view's covering layers (address editing, the tab switcher, the menu, the library and
/// the find bar), the tab actions of its rendered controls, and which layer Back closes first.
module BrowserViewLayers {
  // The open-tab limit of the source.
  pure val Cap = 8
  // Bound on tab identities. An identity is never reused.
  pure val MaxId = 12
  pure val Libraries = Set("none", "bookmarks", "history")
  pure val BackResults = Set("none", "find", "editing", "tabs", "menu", "library", "history", "unhandled")
  type State = {
    // Tab rows in switcher order, the selected tab and the last identity handed out.
    tabs: List[int], cur: int, used: int,
    // Tabs showing a committed page, and those whose page history can go back.
    loaded: Set[int], backable: Set[int],
    editing: bool, tabsOpen: bool, menu: bool, lib: str,
    // The tab the find bar was opened on, or 0 when the bar is closed.
    findTab: int,
    // The tab-limit message was shown.
    limitNotice: bool,
    // What the latest Back press did; "none" once anything else happened.
    lastBack: str
  }
  var s: State
  pure val start: State = { tabs: List(1), cur: 1, used: 1, loaded: Set(), backable: Set(), editing: false,
    tabsOpen: false, menu: false, lib: "none", findTab: 0, limitNotice: false, lastBack: "none" }
  action init = s' = start
  val open = s.tabs.foldl(Set(), (ids, id) => ids.union(Set(id)))
  pure def acted(t: State): State = { ...t, lastBack: "none" }

  // The menu button. Opening or closing the menu ends address editing.
  action toggleMenu = s' = acted({ ...s, menu: not(s.menu), editing: false })
  action openTabs = s' = acted({ ...s, tabsOpen: true, menu: false, editing: false })
  action closeTabs = all { s.tabsOpen, s' = acted({ ...s, tabsOpen: false }) }
  // The menu's Bookmarks entry, the library's two lists and its close control.
  action openLibrary = s' = acted({ ...s, lib: "bookmarks", menu: false })
  action showLibrary(list: str): bool = all { s.lib != "none", list != "none", s' = acted({ ...s, lib: list }) }
  action closeLibrary = all { s.lib != "none", s' = acted({ ...s, lib: "none" }) }
  // Tapping the address closes the menu and starts editing; Escape in the field ends it.
  action startEdit = s' = acted({ ...s, editing: true, menu: false })
  action escapeEdit = all { s.editing, s' = acted({ ...s, editing: false }) }
  // Enter in the address field loads the page in the selected tab and closes every layer except
  // the find bar. The native host's own clearing of a search on navigation is outside this model.
  action submitAddress(canGoBack: bool): bool = all { s.editing,
    s' = acted({ ...s, editing: false, tabsOpen: false, menu: false, lib: "none", loaded: s.loaded.union(Set(s.cur)),
      backable: if (canGoBack) s.backable.union(Set(s.cur)) else s.backable.exclude(Set(s.cur)) }) }
  // New tab: refused with a message at the limit; otherwise the new tab is selected with its
  // address field open, and the switcher and menu close.
  action newTab = all { s.used < MaxId,
    if (s.tabs.length() >= Cap) s' = acted({ ...s, limitNotice: true })
    else s' = acted({ ...s, tabs: s.tabs.append(s.used + 1), cur: s.used + 1, used: s.used + 1, tabsOpen: false,
      menu: false, editing: true }) }
  // A tab card selects its tab and closes the switcher.
  action pick(id: int): bool = all { s.tabsOpen, open.contains(id), s' = acted({ ...s, cur: id, tabsOpen: false }) }
  // A tab card's close control. Closing the selected tab selects the first remaining one; closing
  // the last tab leaves one new tab. The switcher stays open.
  action closeCard(id: int): bool = all { s.tabsOpen, open.contains(id), s.used < MaxId, {
    val rest = s.tabs.select(tab => tab != id)
    val replaced = rest.length() == 0
    s' = acted({ ...s, tabs: if (replaced) List(s.used + 1) else rest, used: if (replaced) s.used + 1 else s.used,
      cur: if (s.cur != id) s.cur else if (replaced) s.used + 1 else rest.head(),
      loaded: s.loaded.exclude(Set(id)), backable: s.backable.exclude(Set(id)) })
  } }
  // Find in page is offered for a committed page; opening the bar closes the menu.
  action openFind = all { s.loaded.contains(s.cur), s' = acted({ ...s, findTab: s.cur, menu: false }) }
  action closeFind = all { s.findTab != 0, s' = acted({ ...s, findTab: 0 }) }
  // A pop-up the native browser opened becomes the selected tab and closes every layer except
  // the find bar. At the limit it is closed again with the limit message.
  action popupOpened = all { s.used < MaxId,
    if (s.tabs.length() >= Cap) s' = acted({ ...s, used: s.used + 1, limitNotice: true })
    else s' = acted({ ...s, tabs: s.tabs.append(s.used + 1), cur: s.used + 1, used: s.used + 1, editing: false,
      tabsOpen: false, menu: false, lib: "none" }) }
  // A page's video went fullscreen above everything.
  action fullscreen = s' = acted({ ...s, menu: false, tabsOpen: false })
  // Back closes one layer per press, in this order, then goes back in the page's history, and
  // otherwise leaves the press to the shell.
  action back =
    if (s.findTab != 0) s' = { ...s, findTab: 0, lastBack: "find" }
    else if (s.editing) s' = { ...s, editing: false, lastBack: "editing" }
    else if (s.tabsOpen) s' = { ...s, tabsOpen: false, lastBack: "tabs" }
    else if (s.menu) s' = { ...s, menu: false, lastBack: "menu" }
    else if (s.lib != "none") s' = { ...s, lib: "none", lastBack: "library" }
    else if (s.backable.contains(s.cur)) s' = { ...s, lastBack: "history" }
    else s' = { ...s, lastBack: "unhandled" }
  action step = {
    nondet id = 1.to(MaxId).oneOf()
    nondet list = Set("bookmarks", "history").oneOf()
    nondet flag = Set(true, false).oneOf()
    any { toggleMenu, openTabs, closeTabs, openLibrary, showLibrary(list), closeLibrary, startEdit, escapeEdit,
      submitAddress(flag), newTab, pick(id), closeCard(id), openFind, closeFind, popupOpened, fullscreen, back,
      s' = s }
  }

  val layered = s.findTab != 0 or s.editing or s.tabsOpen or s.menu or s.lib != "none"
  val TypeOK = Libraries.contains(s.lib) and BackResults.contains(s.lastBack) and s.used.in(1.to(MaxId)) and
    s.findTab.in(0.to(MaxId)) and open.size() == s.tabs.length()
  val TabsBounded = s.tabs.length() >= 1 and s.tabs.length() <= Cap and open.forall(id => id <= s.used)
  val SelectedIsOpen = open.contains(s.cur)
  val PagesBelongToOpenTabs = s.loaded.subseteq(open) and s.backable.subseteq(s.loaded)
  val MenuClosedWhileEditing = not(s.menu and s.editing)
  // Page history and the shell only get a Back press when no layer is left to close.
  val BackClosesLayersFirst = Set("history", "unhandled").contains(s.lastBack) implies not(layered)
  val UnhandledBackHasNoHistory = s.lastBack == "unhandled" implies not(s.backable.contains(s.cur))
  val LimitNoticeNeedsFullSwitcher = s.limitNotice implies s.used >= Cap
  val safety = TypeOK and TabsBounded and SelectedIsOpen and PagesBelongToOpenTabs and MenuClosedWhileEditing and
    BackClosesLayersFirst and UnhandledBackHasNoHistory and LimitNoticeNeedsFullSwitcher

  val HistoryBackWitness = s.lastBack == "history"
  val UnhandledBackWitness = s.lastBack == "unhandled"
  val LimitNoticeWitness = s.limitNotice and s.tabs.length() == Cap
  // Current behaviour: the menu button still opens the menu over an open library or switcher.
  val MenuOverLibraryWitness = s.menu and s.lib != "none"
  // Current behaviour: the find bar stays recorded for a tab that is no longer selected, so the
  // next Back press closes it.
  val FindBarOffTabWitness = s.findTab != 0 and s.findTab != s.cur

  run backClosesLayersInOrderTest = init.then(startEdit).then(submitAddress(true)).then(openFind).then(openTabs)
    .then(openLibrary).then(startEdit)
    .expect(s.findTab == 1 and s.editing and s.tabsOpen and s.lib == "bookmarks" and safety)
    .then(back).expect(s.lastBack == "find" and s.editing)
    .then(back).expect(s.lastBack == "editing" and s.tabsOpen)
    .then(back).expect(s.lastBack == "tabs" and s.lib == "bookmarks")
    .then(back).expect(s.lastBack == "library" and not(layered))
    .then(back).expect(s.lastBack == "history" and safety)
  run newTabAtLimitTest = init.then(newTab).then(newTab).then(newTab).then(newTab).then(newTab).then(newTab).then(newTab)
    .expect(s.tabs.length() == Cap and s.cur == 8 and s.editing and not(s.limitNotice))
    .then(newTab).expect(s.tabs.length() == Cap and s.cur == 8 and s.limitNotice and safety)
    .then(popupOpened).expect(s.tabs.length() == Cap and s.cur == 8 and s.used == 9 and safety)
  run closingSelectedCardSelectsFirstTest = init.then(newTab).then(newTab).then(openTabs).then(closeCard(3))
    .expect(s.tabs == List(1, 2) and s.cur == 1 and s.tabsOpen and safety)
    .then(closeCard(2)).then(closeCard(1))
    .expect(s.tabs == List(4) and s.cur == 4 and safety)
  run popupClosesLayersTest = init.then(openTabs).then(toggleMenu).then(openLibrary).then(popupOpened)
    .expect(s.cur == 2 and not(layered) and safety)
  run menuEndsEditingTest = init.then(startEdit).then(toggleMenu)
    .expect(s.menu and not(s.editing) and safety)
    .then(startEdit).expect(s.editing and not(s.menu) and safety)
  run bareBackIsUnhandledTest = init.then(back).expect(s.lastBack == "unhandled" and safety)
}
