/// Focus ownership in retained and same-depth replacement Settings pages.
module SettingsPageFocus {
  type State = { page: int, focus: int, saved: int -> int }
  var s: State
  pure def controls(page: int): Set[int] =
    if (page == 0) Set(1, 2) else if (page == 1) Set(3, 4)
    else if (page == 2) Set(5) else if (page == 3) Set(6, 7) else Set(8)
  pure def first(page: int): int =
    if (page == 0) 1 else if (page == 1) 3 else if (page == 2) 5 else if (page == 3) 6 else 8
  action init = s' = {page: 0, focus: 0, saved: Map(0 -> 0, 1 -> 0, 2 -> 0, 3 -> 0, 4 -> 0)}
  action focus(control: int): bool = all {
    controls(s.page).contains(control), s' = {...s, focus: control, saved: s.saved.set(s.page, control)}
  }
  action show(page: int): bool = {
    val target = if (s.saved.get(page) == 0) first(page) else s.saved.get(page)
    val remembered = if (page == 0) Map(0 -> target, 1 -> 0, 2 -> 0, 3 -> 0, 4 -> 0) else s.saved.set(page, target)
    all {page.in(0.to(4)), page != s.page, s' = {page: page, focus: target, saved: remembered}}
  }
  action remount = s' = {...s, focus: 0}
  action step = any {nondet page = 0.to(4).oneOf() show(page),
    nondet control = 1.to(8).oneOf() focus(control), remount}
  val safety = s.page.in(0.to(4)) and (s.focus == 0 or controls(s.page).contains(s.focus))
    and 0.to(4).forall(page => s.saved.get(page) == 0 or controls(page).contains(s.saved.get(page)))
  run sameDepthBackTest = init.then(focus(1)).then(show(1)).then(focus(4)).then(show(2))
    .then(show(1)).expect(s.focus == 4 and safety).then(show(0)).expect(s.focus == 1 and safety)
  run licensesBackTest = init.then(focus(2)).then(show(3)).then(focus(7)).then(show(4))
    .then(show(3)).expect(s.focus == 7 and safety).then(show(0)).expect(s.focus == 2 and safety)
  run replacedControlTest = init.then(focus(1)).then(show(1)).then(focus(4)).then(show(2))
    .then(remount).then(show(1)).expect(s.focus == 4 and safety)
}
