// Alpha Home edit gestures, pointer ownership and retirement at shell boundaries.
module HomeGesture {
  type Press = {pointer: int, key: str}
  type Drag = {pointer: int, key: str, moved: bool}
  type State = {mounted: bool, surface: str, covered: bool, editing: bool, adding: bool,
    press: Press, drag: Drag, swallow: str, order: List[str], lastCapture: int,
    clickStopped: bool, focusJob: str, focused: str}
  var s: State

  pure val Notes = "alpha:notes"
  pure val Inbox = "alpha:inbox"
  pure val Files = "alpha:files"
  pure val Tiles = Set(Notes, Inbox, Files)
  pure val Pointers = Set(1, 2)
  pure val NoPress: Press = {pointer: 0, key: ""}
  pure val NoDrag: Drag = {pointer: 0, key: "", moved: false}

  action init = s' = {mounted: true, surface: "home", covered: false, editing: false, adding: false,
    press: NoPress, drag: NoDrag, swallow: "", order: List(Notes, Inbox), lastCapture: 0,
    clickStopped: false, focusJob: "", focused: ""}
  pure def active(value: State): bool = value.mounted and value.surface == "home" and not(value.covered)
  pure def includes(value: State, key: str): bool = value.order.indices().exists(i => value.order.nth(i) == key)
  pure def index(value: State, key: str): int =
    value.order.indices().filter(i => value.order.nth(i) == key).fold(-1, (_, found) => found)
  pure def moveTo(value: State, key: str, destination: int): List[str] =
    if (destination < 0 or destination >= value.order.length() or not(includes(value, key))) value.order
    else {
      val left = value.order.select(entry => entry != key)
      left.slice(0, destination).append(key).concat(left.slice(destination, left.length()))
    }
  pure def closeEdit(value: State): State =
    {...value, editing: false, adding: false, press: NoPress, drag: NoDrag}

  action down(pointer: int, key: str, remove: bool): bool = all {
    Pointers.contains(pointer), Tiles.contains(key),
    val busyOther = s.press.pointer != 0 and s.press.pointer != pointer
      or s.drag.pointer != 0 and s.drag.pointer != pointer
    val base = {...s, press: NoPress, swallow: ""}
    s' = if (not(s.mounted) or busyOther) s
      else if (not(active(s)) or not(includes(s, key))) base
      else if (not(s.editing)) {...base, press: {pointer: pointer, key: key}}
      else if (remove) base
      else {...base, drag: {pointer: pointer, key: key, moved: false}}
  }
  action movePointer(pointer: int, far: bool): bool = all {
    Pointers.contains(pointer),
    val base = if (s.press.pointer == pointer and far) {...s, press: NoPress} else s
    s' = if (not(s.mounted)) s
      else if (s.drag.pointer != pointer) base
      else if (not(active(s)) or not(includes(s, s.drag.key))) {...base, drag: NoDrag}
      else if (far and not(s.drag.moved)) {...base, drag: {...s.drag, moved: true}, lastCapture: pointer}
      else base}
  action up(pointer: int, over: str): bool = all {
    Pointers.contains(pointer), over == "" or Tiles.contains(over),
    val base = if (s.press.pointer == pointer) {...s, press: NoPress} else s
    s' = if (not(s.mounted)) s
      else if (s.drag.pointer != pointer) base
      else if (not(active(s)) or not(s.drag.moved) or not(includes(s, s.drag.key))) {...base, drag: NoDrag}
      else {...base, drag: NoDrag, swallow: s.drag.key, order: moveTo(s, s.drag.key, index(s, over))}}
  action cancel(pointer: int): bool = all {Pointers.contains(pointer),
    s' = if (not(s.mounted)) s else {...s,
      press: if (s.press.pointer == pointer) NoPress else s.press,
      drag: if (s.drag.pointer == pointer) NoDrag else s.drag}}
  action hold = all {s.press.pointer != 0,
    s' = if (active(s)) {...s, press: NoPress, swallow: s.press.key, editing: true, adding: false}
      else {...s, press: NoPress}}
  action fireOldHold = s' = s
  action cover(covered: bool): bool = s' = {...s, covered: covered}
  action context(key: str): bool = all {active(s), Tiles.contains(key),
    s' = if (s.editing) {...s, press: NoPress}
      else {...s, press: NoPress, swallow: key, editing: true, adding: false}}

  action click(key: str, remove: bool, keyboard: bool): bool = all {active(s), Tiles.contains(key),
    val held = s.swallow == key
    s' = {...s, swallow: "", clickStopped: held or s.editing,
      order: if (s.editing and not(held) and (remove or keyboard)) s.order.select(entry => entry != key) else s.order}}
  action erase(key: str): bool = all {active(s), s.editing, Tiles.contains(key),
    s' = {...s, order: s.order.select(entry => entry != key)}}
  action arrow(key: str, direction: int): bool = all {
    active(s), s.editing, includes(s, key), direction.in(Set(-1, 1)), s.focusJob == "",
    s' = {...s, order: moveTo(s, key, index(s, key) + direction), focusJob: key}}
  action flushFocus = all {s.focusJob != "",
    s' = {...s, focusJob: "", focused: if (active(s) and includes(s, s.focusJob)) s.focusJob else s.focused}}

  action addSheet = all {active(s), s.editing, s' = {...s, adding: true}}
  action addChoice(key: str): bool = all {active(s), s.editing, s.adding, Tiles.contains(key), not(includes(s, key)),
    s' = {...s, order: s.order.append(key)}}
  action done = all {s.editing, s' = {...s, editing: false, adding: false, drag: NoDrag}}
  action openDrawer = all {s.mounted, s.surface == "home",
    s' = if (s.editing) s else {...s, surface: "drawer", press: NoPress}}
  action openView = all {s.mounted, s' = {...closeEdit(s), surface: "view"}}
  action goHome = all {s.mounted, s' = {...closeEdit(s), surface: "home"}}
  action back = all {s.mounted,
    s' = if (s.surface != "home") {...s, surface: "home"}
      else if (s.adding) {...s, adding: false}
      else if (s.editing) {...s, editing: false, drag: NoDrag}
      else s}
  action unmount = all {s.mounted, s' = {...s, mounted: false, press: NoPress, drag: NoDrag, swallow: ""}}
  action mount = all {not(s.mounted),
    s' = {...s, mounted: true, surface: "home", covered: false, editing: false, adding: false}}

  action step = any {
    hold, fireOldHold, flushFocus, addSheet, done, openDrawer, openView, goHome, back, mount, unmount,
    {nondet pointer = Pointers.oneOf(); nondet key = Tiles.oneOf(); nondet remove = Bool.oneOf(); down(pointer, key, remove)},
    {nondet pointer = Pointers.oneOf(); nondet far = Bool.oneOf(); movePointer(pointer, far)},
    {nondet pointer = Pointers.oneOf(); nondet over = Tiles.union(Set("")).oneOf(); up(pointer, over)},
    {nondet pointer = Pointers.oneOf(); cancel(pointer)},
    {nondet covered = Bool.oneOf(); cover(covered)},
    {nondet key = Tiles.oneOf(); context(key)},
    {nondet key = Tiles.oneOf(); nondet remove = Bool.oneOf(); nondet keyboard = Bool.oneOf(); click(key, remove, keyboard)},
    {nondet key = Tiles.oneOf(); erase(key)},
    {nondet key = Tiles.oneOf(); nondet direction = Set(-1, 1).oneOf(); arrow(key, direction)},
    {nondet key = Tiles.oneOf(); addChoice(key)}, s' = s,
  }
  val UniqueFavorites = s.order.indices().forall(i => Tiles.contains(s.order.nth(i))
    and s.order.indices().filter(j => s.order.nth(j) == s.order.nth(i)).size() == 1)
  val SingleGesture = s.press.pointer == 0 or s.drag.pointer == 0
  val RetiredOwnsNothing = s.mounted or (s.press == NoPress and s.drag == NoDrag and s.swallow == "")
  val EditingOwnsDrag = s.drag.pointer != 0 implies s.editing and s.surface == "home"
  val safety = UniqueFavorites and SingleGesture and RetiredOwnsNothing and EditingOwnsDrag

  run unrelatedPointerCannotCancelHoldTest = init.then(down(1, Notes, false)).then(movePointer(2, true))
    .then(up(2, Inbox)).then(cancel(2)).then(hold).expect(s.editing and s.swallow == Notes and safety)
  run drawerRetiresHeldTimeoutTest = init.then(down(1, Notes, false)).then(openDrawer).then(fireOldHold)
    .expect(s.surface == "drawer" and not(s.editing) and s.press == NoPress and safety)
  run coveredHomeDropsHeldTimeoutTest = init.then(down(1, Notes, false)).then(cover(true)).then(hold)
    .expect(not(s.editing) and s.swallow == "" and s.press == NoPress and safety)
  run wrongPointerCannotDropTest = init.then(context(Notes)).then(down(1, Notes, false)).then(movePointer(2, true))
    .then(up(2, Inbox)).expect(s.order == List(Notes, Inbox) and s.drag.pointer == 1)
    .then(movePointer(1, true)).then(up(1, Inbox)).expect(s.order == List(Inbox, Notes) and safety)
  run remountDoesNotSwallowEarlierClickTest = init.then(context(Notes)).then(unmount).then(mount)
    .then(click(Notes, false, true)).expect(not(s.clickStopped) and s.order == List(Notes, Inbox) and safety)
}
