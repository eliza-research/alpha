// The simulated shade owns list publication and the exact targets of its rendered controls.
module ShadeRowCustody {
  type Key = {id: str, revision: str, source: str}
  type Row = {id: str, revision: str, source: str, canOpen: bool, clearable: bool}
  type Control = {visit: int, rows: List[Row]}
  type Operation = {kind: str, keys: List[Key], pending: bool}
  type State = {shade: bool, screen: str, hidden: bool, live: bool, visit: int, epoch: int,
    items: List[Row], selection: Key, renderedSelection: Key, busy: bool, error: bool, calendarError: bool,
    reads: int, readVisit: int, renders: int, controls: int -> Control,
    operations: List[Operation], operationVisits: List[int], toasts: List[str]}
  var s: State

  pure val none: Key = {id: "", revision: "", source: ""}
  pure def key(row: Row): Key = {id: row.id, revision: row.revision, source: row.source}
  pure def row(id: str, revision: str, source: str, canOpen: bool, clearable: bool): Row =
    {id: id, revision: revision, source: source, canOpen: canOpen, clearable: clearable}
  pure val a = row("a", "1", "own", true, true)
  pure val revisedA = row("a", "2", "own", true, true)
  pure val b = row("b", "1", "external", true, true)
  pure val fixed = row("c", "1", "hosted", false, false)
  pure val samples = Set(List(), List(a), List(revisedA), List(b), List(a, b, fixed))
  pure def showing(st: State): bool = st.shade and st.screen == "home"
  pure def active(st: State): bool = st.live and showing(st) and not(st.hidden)
  pure def noticeKeys(rows: List[Row]): List[Key] = rows.foldl(List(), (acc, row) => acc.append(key(row)))
  pure def clearableKeys(rows: List[Row]): List[Key] =
    rows.foldl(List(), (acc, row) => if (row.clearable) acc.append(key(row)) else acc)
  pure def hasKey(rows: List[Row], target: Key): bool = noticeKeys(rows).indices().exists(i => noticeKeys(rows).nth(i) == target)
  pure def notify(st: State, message: str): State = {...st, toasts: st.toasts.append(message)}
  pure def retire(st: State): State = {...st, visit: st.visit + 1, selection: none}
  pure def render(st: State): State = {
    val selection = if (showing(st)) st.selection else none
    {...st, selection: selection, renderedSelection: selection, renders: st.renders + 1}
  }
  pure def changeView(old: State, changed: State): State =
    if (showing(old) and not(showing(changed))) retire(render(changed)) else render(changed)
  pure def publishSelection(st: State): State =
    if (active(st) and st.selection != st.renderedSelection) render(st) else st
  pure def request(st: State): State =
    if (active(st) and not(st.busy) and st.reads < 8)
      {...st, busy: true, reads: st.reads + 1, readVisit: st.visit}
    else st
  pure def dispatch(st: State, kind: str, targets: List[Key]): State =
    if (st.operations.length() < 6)
      {...st, operations: st.operations.append({kind: kind, keys: targets, pending: true}),
        operationVisits: st.operationVisits.append(st.visit)}
    else st

  action init = s' = {shade: true, screen: "home", hidden: false, live: true, visit: 0, epoch: 0,
    items: List(), selection: none, renderedSelection: none, busy: false, error: false, calendarError: false,
    reads: 0, readVisit: 0, renders: 0, controls: Map(), operations: List(), operationVisits: List(), toasts: List()}
  action poll = s' = request(publishSelection(s))
  action setShade(open: bool): bool = all {s.live, s' = changeView(s, {...s, shade: open})}
  action setScreen(screen: str): bool = all {
    s.live, screen.in(Set("home", "lock", "off", "boot")),
    s' = changeView(s, {...s, screen: screen}),
  }
  action visibility(hidden: bool): bool = all {
    s.live, hidden != s.hidden,
    val changed = retire({...s, hidden: hidden, epoch: s.epoch + 1})
    s' = if (hidden) {...changed, items: List()} else request(render(changed)),
  }
  action deviceState = all {s.live, s' = render(retire({...s, epoch: s.epoch + 1, items: List()}))}
  action unmount = all {s.live, s' = retire({...s, live: false, epoch: s.epoch + 1})}
  action finishPoll(rows: List[Row], result: str): bool = all {
    s.busy, result.in(Set("ok", "unavailable", "error")),
    val settled = {...s, busy: false}
    s' = if (not(active(s)) or s.visit != s.readVisit) settled
      else if (result == "error")
        (if (s.error) settled else notify(render({...settled, error: true, items: List(), selection: none}), "list-error"))
      else {
        val status = {...settled, error: false, calendarError: result == "unavailable"}
        val reported = if (status.calendarError and not(s.calendarError)) notify(status, "calendar-error") else status
        val selection = if (hasKey(rows, s.selection)) s.selection else none
        val published = {...reported, items: rows, selection: selection}
        if (rows == s.items) published else render(published)
      },
  }
  action capture(slot: int): bool = all {
    slot.in(Set(1, 2, 3)),
    s' = {...s, renderedSelection: s.selection, controls: s.controls.put(slot, {visit: s.visit, rows: s.items})},
  }
  pure def useRow(st: State, current: Row, kind: str): State =
    if (kind == "open")
      (if (current.canOpen) dispatch(st, kind, List(key(current))) else notify(st, "no-action"))
    else {
      val chosen = publishSelection({...st, selection: if (current.source == "own") key(current) else none})
      if (kind != "dismiss") chosen
      else if (current.clearable) dispatch(chosen, kind, List(key(current)))
      else notify(chosen, "ongoing")
    }
  action act(slot: int, kind: str, id: str): bool = all {
    s.controls.keys().contains(slot), kind.in(Set("open", "dismiss", "select", "clear")),
    val control = s.controls.get(slot)
    val shown = control.rows.foldl(none, (target, row) => if (row.id == id) key(row) else target)
    val clear = clearableKeys(control.rows)
    s' = if (not(active(s)) or control.visit != s.visit) s
      else if (kind == "clear")
        (if (clear.length() > 0 and clear == clearableKeys(s.items)) dispatch(s, kind, clear) else s)
      else s.items.foldl(s, (acc, row) => if (key(row) == shown) useRow(acc, row, kind) else acc),
  }
  action finishOperation(id: int, result: str): bool = all {
    s.operations.indices().contains(id - 1), s.operations.nth(id - 1).pending,
    result.in(Set("ok", "unavailable", "error")),
    val before = s.operations.nth(id - 1)
    val settled = {...s, operations: s.operations.replaceAt(id - 1, {...before, pending: false})}
    s' = if (not(active(s)) or s.visit != s.operationVisits.nth(id - 1)) settled
      else if (result == "error") request(notify(settled, "action-error"))
      else if (result == "unavailable" and before.kind == "clear") request(notify(settled, "some-changed"))
      else request(settled),
  }
  action step = any {
    poll, setShade(true), setShade(false), setScreen("home"), setScreen("lock"), setScreen("boot"),
    visibility(true), visibility(false), deviceState, unmount,
    {nondet rows = samples.oneOf(); nondet result = Set("ok", "unavailable", "error").oneOf(); finishPoll(rows, result)},
    {nondet slot = Set(1, 2, 3).oneOf(); capture(slot)},
    {nondet slot = Set(1, 2, 3).oneOf(); nondet kind = Set("open", "dismiss", "select", "clear").oneOf();
      nondet id = Set("a", "b", "c").oneOf(); act(slot, kind, id)},
    {nondet id = Set(1, 2, 3, 4, 5, 6).oneOf(); nondet result = Set("ok", "unavailable", "error").oneOf(); finishOperation(id, result)},
    s' = s,
  }

  val SelectionBelongsToCurrentOwnRow = s.selection != none implies
    (active(s) and s.selection.source == "own" and hasKey(s.items, s.selection))
  val NonemptyDispatchKeys = s.operations.indices().forall(i => {
    val op = s.operations.nth(i)
    op.keys.length() > 0 and (op.kind == "clear" or op.keys.length() == 1) and
      op.keys.indices().forall(j => op.keys.nth(j).id != "" and op.keys.nth(j).revision != "")
  })
  val PendingReadHasVisit = s.busy implies (s.reads > 0 and s.readVisit <= s.visit)
  val safety = SelectionBelongsToCurrentOwnRow and NonemptyDispatchKeys and PendingReadHasVisit

  run shadeReentryCannotPublishOldPollTest = init.then(poll).then(finishPoll(List(a), "ok")).then(poll)
    .then(setShade(false)).then(setShade(true)).then(finishPoll(List(b), "ok"))
    .expect(s.items == List(a) and s.toasts == List() and safety)
  run retainedControlsCannotAcquireReplacementTest = init.then(poll).then(finishPoll(List(a), "ok")).then(capture(1))
    .then(poll).then(finishPoll(List(revisedA), "ok"))
    .then(act(1, "open", "a")).then(act(1, "dismiss", "a")).then(act(1, "clear", ""))
    .expect(s.operations == List() and s.selection == none and safety)
  run exactClearReportsPartialAndRefreshesTest = init.then(poll).then(finishPoll(List(a, b, fixed), "ok")).then(capture(1))
    .then(act(1, "clear", "")).then(finishOperation(1, "unavailable"))
    .expect(s.operations.nth(0).keys == List(key(a), key(b)) and s.busy and s.toasts == List("some-changed") and safety)
  run retiredOperationCannotReportOrRefreshTest = init.then(poll).then(finishPoll(List(a), "ok")).then(capture(1))
    .then(act(1, "open", "a")).then(setScreen("lock")).then(setScreen("home")).then(finishOperation(1, "error"))
    .expect(s.reads == 1 and s.toasts == List() and safety)
  run refreshClearsReplacedSelectionTest = init.then(poll).then(finishPoll(List(a), "ok")).then(capture(1))
    .then(act(1, "select", "a")).expect(s.selection == key(a) and safety)
    .then(poll).then(finishPoll(List(revisedA), "ok")).expect(s.selection == none and safety)
}
