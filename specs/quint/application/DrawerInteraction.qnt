// Mounted Alpha Apps drawer, exact menu owner and synthetic native App Info boundary.
module DrawerInteraction {
  type Press = {pointer: int, app: int}
  type Focus = {kind: str, app: int}
  type State = {open: bool, inventory: Set[int], query: str, menu: int, press: Press, swallow: int,
    focus: Focus, favorites: Set[int], lastLaunch: int, infoTarget: int, infoPending: bool, infoNotice: bool}
  var s: State

  pure val Apps = Set(1, 2)
  pure val Pointers = Set(1, 2)
  pure val Queries = Set("", "clock", "mail", "missing")
  pure val NoPress: Press = {pointer: 0, app: 0}
  pure val Body: Focus = {kind: "body", app: 0}
  pure def shown(inventory: Set[int], query: str): Set[int] =
    inventory.filter(app => query == "" or query == "clock" and app == 1 or query == "mail" and app == 2)
  val visible = if (s.open) shown(s.inventory, s.query) else Set()
  pure def tile(app: int): Focus = {kind: "tile", app: app}
  pure def focusOf(kind: str, app: int): Focus = {kind: kind, app: app}
  pure def first(value: State, app: int): Focus = focusOf(if (value.favorites.contains(app)) "info" else "add", app)
  pure def menuFocus(focus: Focus): bool = focus.kind == "add" or focus.kind == "info"
  pure def menuClosed(value: State): State = {...value, menu: 0,
    focus: if (value.menu != 0 and (menuFocus(value.focus) or value.focus == Body)
      and shown(value.inventory, value.query).contains(value.menu)) tile(value.menu) else value.focus}
  pure def drawerClosed(value: State): State = {...value, open: false, menu: 0, query: "", press: NoPress, swallow: 0,
    focus: if (value.focus.kind == "outside") value.focus else Body}
  pure def menuOpened(value: State, app: int): State =
    {...value, menu: app, press: NoPress, swallow: app, focus: if (value.menu == app) value.focus else first(value, app)}

  action initWith(favorites: Set[int]): bool = all {favorites.subseteq(Apps),
    s' = {open: false, inventory: Apps, query: "", menu: 0, press: NoPress, swallow: 0, focus: Body,
      favorites: favorites, lastLaunch: 0, infoTarget: 0, infoPending: false, infoNotice: false}}
  action init = { nondet favorites = Set(Set(), Set(2)).oneOf(); initWith(favorites) }
  action openDrawer = all {not(s.open), s' = {...s, open: true}}
  action closeDrawer = all {s.open, s' = drawerClosed(s)}
  action replaceInventory(inventory: Set[int]): bool = all {inventory.subseteq(Apps),
    val remaining = if (s.open) shown(inventory, s.query) else Set()
    s' = {...s, inventory: inventory, menu: if (remaining.contains(s.menu)) s.menu else 0,
      press: if (remaining.contains(s.press.app)) s.press else NoPress,
      swallow: if (remaining.contains(s.swallow)) s.swallow else 0,
      focus: if (s.focus.app != 0 and not(remaining.contains(s.focus.app))) Body else s.focus}}
  action search(query: str): bool = all {s.open, Queries.contains(query), query != s.query,
    val remaining = shown(s.inventory, query)
    s' = {...s, query: query, menu: 0, focus: focusOf("search", 0),
      press: if (remaining.contains(s.press.app)) s.press else NoPress,
      swallow: if (remaining.contains(s.swallow)) s.swallow else 0}}
  action down(app: int, pointer: int): bool = all {visible.contains(app), Pointers.contains(pointer),
    s' = if (s.press.pointer != 0 and s.press.pointer != pointer) s
      else {...s, press: {pointer: pointer, app: app}, swallow: 0}}
  action movePointer(app: int, pointer: int, far: bool): bool = all {visible.contains(app), Pointers.contains(pointer),
    s' = if (s.press.app == app and s.press.pointer == pointer and far) {...s, press: NoPress} else s}
  action release(pointer: int): bool = all {s.open, Pointers.contains(pointer),
    s' = if (s.press.pointer == pointer) {...s, press: NoPress} else s}
  action hold = all {s.press != NoPress, visible.contains(s.press.app), s' = menuOpened(s, s.press.app)}
  action oldTimeout = s' = s
  action context(app: int): bool = all {visible.contains(app), s' = menuOpened(s, app)}
  action tap(app: int): bool = all {visible.contains(app),
    s' = {...s, swallow: 0, lastLaunch: if (s.swallow == app) s.lastLaunch else app,
      focus: if (s.swallow != app and s.focus.kind == "tile") Body else s.focus}}

  action focusOutside = s' = {...s, focus: focusOf("outside", 0)}
  action focusSearch = all {s.open, s' = {...s, focus: focusOf("search", 0)}}
  action menuKey(key: str): bool = all {s.menu != 0, menuFocus(s.focus),
    Set("Home", "End", "ArrowDown", "ArrowUp").contains(key),
    val focus = if (s.favorites.contains(s.menu) or key == "End") focusOf("info", s.menu)
      else if (key == "Home" or s.focus.kind == "info") focusOf("add", s.menu)
      else focusOf("info", s.menu)
    s' = {...s, focus: focus}}
  action escape = all {s.open, s' = if (s.menu == 0) drawerClosed(s) else menuClosed(s)}
  action closeMenu = all {s.menu != 0, s' = menuClosed(s)}
  action addHome = all {s.menu != 0, not(s.favorites.contains(s.menu)),
    s' = drawerClosed({...s, favorites: s.favorites.union(Set(s.menu))})}
  action appInfo = all {s.menu != 0, not(s.infoPending),
    s' = menuClosed({...s, infoTarget: s.menu, infoPending: true, focus: focusOf("info", s.menu)})}
  action infoReply(ok: bool): bool = all {s.infoPending,
    s' = {...s, infoPending: false, infoNotice: s.infoNotice or not(ok)}}

  action step = any {
    openDrawer, closeDrawer, hold, oldTimeout, focusOutside, focusSearch, escape, closeMenu, addHome, appInfo,
    {nondet inventory = Apps.powerset().oneOf(); replaceInventory(inventory)},
    {nondet query = Queries.oneOf(); search(query)},
    {nondet app = Apps.oneOf(); nondet pointer = Pointers.oneOf(); down(app, pointer)},
    {nondet app = Apps.oneOf(); nondet pointer = Pointers.oneOf(); nondet far = Bool.oneOf(); movePointer(app, pointer, far)},
    {nondet pointer = Pointers.oneOf(); release(pointer)},
    {nondet app = Apps.oneOf(); context(app)},
    {nondet app = Apps.oneOf(); tap(app)},
    {nondet key = Set("Home", "End", "ArrowDown", "ArrowUp").oneOf(); menuKey(key)},
    {nondet ok = Bool.oneOf(); infoReply(ok)}, s' = s,
  }
  val OwnsVisibleMenu = s.menu == 0 or visible.contains(s.menu)
  val OwnsVisiblePress = s.press == NoPress or Pointers.contains(s.press.pointer) and visible.contains(s.press.app)
  val CurrentSuppression = s.swallow == 0 or visible.contains(s.swallow)
  val ExactAppInfo = s.infoPending implies Apps.contains(s.infoTarget)
  val safety = OwnsVisibleMenu and OwnsVisiblePress and CurrentSuppression and ExactAppInfo

  run unrelatedPointerKeepsHoldTest = initWith(Set()).then(openDrawer).then(down(1, 1))
    .then(movePointer(1, 2, true)).then(release(2)).then(hold).expect(s.menu == 1 and safety)
  run removedMenuCannotReopenTest = initWith(Set()).then(openDrawer).then(context(1))
    .then(replaceInventory(Set(2))).then(replaceInventory(Apps))
    .expect(s.menu == 0 and s.swallow == 0 and safety)
  run oldHoldCannotRetargetReplacementTest = initWith(Set()).then(openDrawer).then(down(1, 1))
    .then(replaceInventory(Set(2))).then(replaceInventory(Apps)).then(oldTimeout)
    .expect(s.menu == 0 and s.press == NoPress and safety)
  run appInfoClosesMenuAndRestoresExactTileTest = initWith(Set(2)).then(openDrawer).then(context(2))
    .expect(s.focus == focusOf("info", 2)).then(appInfo)
    .expect(s.infoTarget == 2 and s.focus == tile(2) and s.open and safety)
  run lateInfoRejectionReportsAfterDrawerClosesTest = initWith(Set()).then(openDrawer).then(context(2)).then(appInfo)
    .then(closeDrawer).then(infoReply(false)).expect(not(s.open) and s.infoNotice and not(s.infoPending) and safety)
}
