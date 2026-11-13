/// Find in page: the renderer's find bar, its debounced native search, and the native side
/// clearing a search when its tab navigates or stops being shown.
module FindInPage {
  pure val Tabs = Set(1, 2)
  type Event = { id: int, cleared: bool }
  type State = {
    alive: Set[int], cur: int,
    // The tab whose native surface is shown; 0 while every surface is hidden.
    presented: int,
    finding: bool, findTab: int, hasQuery: bool, queryVersion: int, count: int,
    timerArmed: bool, timerTab: int, timerVersion: int, timerHasQuery: bool,
    // Tabs with an active native search.
    nativeQuery: Set[int],
    // Native find events not yet handled by the renderer.
    events: List[Event],
    strayFind: bool, staleSearch: bool
  }
  var s: State
  action init = s' = { alive: Tabs, cur: 1, presented: 1, finding: false, findTab: 0, hasQuery: false,
    queryVersion: 0, count: 0, timerArmed: false, timerTab: 0, timerVersion: 0, timerHasQuery: false,
    nativeQuery: Set(), events: List(), strayFind: false, staleSearch: false }
  pure def idleBar(t: State): State = { ...t, finding: false, findTab: 0, hasQuery: false, count: 0 }
  // The native side reports a cleared search only for a tab that had one.
  pure def nativeClear(t: State, ids: Set[int]): State = { ...t,
    nativeQuery: t.nativeQuery.exclude(ids),
    events: ids.intersect(t.nativeQuery).fold(t.events, (pending, id) => pending.append({ id: id, cleared: true })) }
  action openFind = all {
    s.alive.contains(s.cur), s.queryVersion < 4,
    s' = { ...s, finding: true, findTab: s.cur, hasQuery: false, count: 0, queryVersion: s.queryVersion + 1 }
  }
  // Close, Escape or Back. The debounce is dropped and the native search of the bar's tab is cleared.
  action closeFind = all {
    s.finding, s.events.length() < 2,
    s' = nativeClear({ ...idleBar(s), timerArmed: false }, Set(s.findTab).intersect(s.alive))
  }
  // Typing is possible only while the bar is shown, which is on its own tab.
  action typeQuery(nonEmpty: bool): bool = all {
    s.finding, s.findTab == s.cur, s.queryVersion < 4,
    s' = { ...s, hasQuery: nonEmpty, count: if (nonEmpty) s.count else 0,
      queryVersion: s.queryVersion + 1, timerArmed: true, timerTab: s.cur,
      timerVersion: s.queryVersion + 1, timerHasQuery: nonEmpty }
  }
  // The debounce searches only a tab that is still selected and still owns the bar.
  action timerFires = all {
    s.timerArmed,
    s' = if (s.alive.contains(s.timerTab) and s.timerTab == s.cur and s.timerTab == s.findTab)
        { ...s, timerArmed: false,
          nativeQuery: if (s.timerHasQuery) s.nativeQuery.union(Set(s.timerTab)) else s.nativeQuery.exclude(Set(s.timerTab)),
          strayFind: s.strayFind or s.timerTab != s.cur or s.timerTab != s.findTab,
          staleSearch: s.staleSearch or s.timerVersion != s.queryVersion }
      else { ...s, timerArmed: false }
  }
  action nativeResult(id: int): bool = all {
    s.nativeQuery.contains(id), s.events.length() < 2,
    s' = { ...s, events: s.events.append({ id: id, cleared: false }) }
  }
  // Events for any tab other than the bar's are ignored.
  action deliver = all {
    s.events.length() > 0,
    s' = if (s.events.head().id != s.findTab) { ...s, events: s.events.tail() }
      else if (s.events.head().cleared) { ...idleBar(s), events: s.events.tail() }
      else { ...s, events: s.events.tail(), count: 1 }
  }
  action pick(id: int): bool = all { s.alive.contains(id), id != s.cur, s' = { ...s, cur: id } }
  // The poll shows the selected tab's surface, or none under a menu, sheet or other overlay.
  action present(hidden: bool): bool = all {
    s.events.length() == 0,
    s' = nativeClear({ ...s, presented: if (hidden) 0 else s.cur },
      s.alive.exclude(Set(if (hidden) 0 else s.cur)))
  }
  action navigate(id: int): bool = all {
    s.alive.contains(id), s.events.length() < 2,
    s' = nativeClear(s, Set(id))
  }
  // A closed tab is disposed without a cleared event.
  action closeTab(id: int): bool = {
    // The unchanged guards and alive subseteq Tabs make the remaining set a singleton.
    nondet remaining = s.alive.exclude(Set(id)).oneOf()
    all {
      s.alive.contains(id), s.alive.size() > 1,
      s' = { ...s, alive: s.alive.exclude(Set(id)),
        cur: if (s.cur == id) remaining else s.cur,
        presented: if (s.presented == id) 0 else s.presented,
        nativeQuery: s.nativeQuery.exclude(Set(id)) }
    }
  }
  action step = {
    nondet id = Tabs.oneOf()
    nondet flag = Set(false, true).oneOf()
    any { openFind, closeFind, typeQuery(flag), timerFires, nativeResult(id), deliver, pick(id),
      present(flag), navigate(id), closeTab(id), s' = s }
  }
  val FindTabIffFinding = s.finding iff s.findTab != 0
  val ResultsNeedFindBar = (s.count > 0 or s.hasQuery) implies s.finding
  val SearchIssuedForShownBar = not(s.strayFind)
  val NativeSearchOnLiveTab = s.nativeQuery.subseteq(s.alive)
  val TypeOK = s.alive.subseteq(Tabs) and s.alive.contains(s.cur) and s.queryVersion.in(0.to(4)) and
    s.events.length() <= 3 and s.count.in(0.to(1))
  val safety = TypeOK and FindTabIffFinding and ResultsNeedFindBar and SearchIssuedForShownBar and
    NativeSearchOnLiveTab
  // An empty find bar is not cleared by a tab switch, because the native side has nothing to
  // report. The bar is hidden on the other tab, and the next Back press closes it.
  val HiddenFindBarWitness = s.finding and s.findTab != s.cur and s.alive.contains(s.findTab) and
    s.events.length() == 0 and s.nativeQuery.size() == 0 and s.presented == s.cur and not(s.timerArmed)
  val FindBarOnClosedTabWitness = s.finding and not(s.alive.contains(s.findTab)) and s.events.length() == 0
  // The debounce carries no version: reopening the bar before it fires searches for the earlier text.
  val EarlierTextSearchedWitness = s.staleSearch
  val ClearedEventPendingWitness = s.finding and s.events.length() > 0 and s.events.head().cleared and
    s.events.head().id == s.findTab
  // A tab switch during the debounce must not search a tab that is no longer shown.
  run tabSwitchDuringDebounceTest = init.then(openFind).then(typeQuery(true)).then(pick(2)).then(timerFires)
    .expect(s.nativeQuery.size() == 0 and not(s.strayFind) and not(s.timerArmed) and safety)
  run switchClearsActiveSearchTest = init.then(openFind).then(typeQuery(true)).then(timerFires)
    .then(nativeResult(1)).then(deliver).expect(s.count == 1 and s.nativeQuery == Set(1))
    .then(pick(2)).then(present(false)).expect(s.nativeQuery.size() == 0 and s.finding)
    .then(deliver).expect(not(s.finding) and s.findTab == 0 and s.count == 0 and safety)
  run navigationClearsSearchTest = init.then(openFind).then(typeQuery(true)).then(timerFires)
    .then(navigate(1)).then(deliver).expect(not(s.finding) and s.nativeQuery.size() == 0 and safety)
  run emptyBarOutlivesSwitchTest = init.then(openFind).then(pick(2)).then(present(false))
    .expect(s.finding and s.findTab == 1 and s.events.length() == 0)
    .then(closeFind).expect(not(s.finding) and safety)
  run closeFindClearsNativeSearchTest = init.then(openFind).then(typeQuery(true)).then(timerFires)
    .then(closeFind).expect(s.nativeQuery.size() == 0 and not(s.finding))
    .then(deliver).expect(not(s.finding) and s.events.length() == 0 and safety)
  run closeSelectedTabChoosesRemainingTest = init.then(closeTab(1))
    .expect(s.alive == Set(2) and s.cur == 2 and s.presented == 0 and safety)
  run closeBackgroundTabKeepsSelectionTest = init.then(closeTab(2))
    .expect(s.alive == Set(1) and s.cur == 1 and s.presented == 1 and safety)
}
