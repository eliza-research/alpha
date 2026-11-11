// User-selected content links share the Browser view, with stale-view cancellation.
module ContentLinks {
  var s: {view: int, origin: int, pending: bool, live: bool, token: int, selected: int, opened: int}
  action init = s' = {view: 0, origin: 0, pending: false, live: true, token: 0, selected: 0, opened: 0}
  action click = all {s.live, s.token < 2, s' = {...s, pending: true, origin: s.view, token: s.token + 1, selected: s.token + 1}}
  action leave = s' = {...s, view: 1}
  action retire = s' = {...s, live: false, pending: false}
  action finish(id: int): bool = all {
    s.pending, id.in(Set(1,2)),
    s' = if(s.selected != id) s else if(s.live and s.view == s.origin)
      {...s, pending: false, view: 2, opened: id} else {...s, pending: false}
  }
  action step = any {click, leave, retire, finish(1), finish(2), s' = s}
  val safety = s.opened == 0 or s.opened <= s.selected
  run currentLinkOpensBrowser = init.then(click).then(finish(1)).expect(s.view == 2 and s.opened == 1 and safety)
  run changedViewStaysVisible = init.then(click).then(leave).then(finish(1)).expect(s.view == 1 and s.opened == 0 and safety)
  run replacedLinkCannotPresent = init.then(click).then(click).then(finish(1)).expect(s.opened == 0 and s.pending and safety)
}
