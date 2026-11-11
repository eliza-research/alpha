// Admission to the platform share sheet. No application destination chooser exists.
module SharePanelAdmission {
  type State = {busy: bool, calls: int, finished: int, hidden: bool, current: bool}
  var s: State
  action init = s' = {busy: false, calls: 0, finished: 0, hidden: false, current: true}
  action visibility(hidden: bool): bool = s' = {...s, hidden: hidden}
  action selection(current: bool): bool = s' = {...s, current: current}
  action open = s' = if (s.busy or s.hidden or not(s.current)) s
    else {...s, busy: true, calls: s.calls + 1}
  action finish = all {s.busy, s' = {...s, busy: false, finished: s.finished + 1}}
  action step = any {visibility(true), visibility(false), selection(true), selection(false),
    open, finish, s' = s}
  val OneChooserAtATime = s.calls - s.finished == (if (s.busy) 1 else 0)
  val CompletionHasAnAttempt = s.finished <= s.calls and s.finished >= 0
  val safety = OneChooserAtATime and CompletionHasAnAttempt
  run repeatedTapDoesNotDuplicateTest = init.then(open).then(open)
    .expect(s.calls == 1 and safety).then(finish).expect(not(s.busy) and safety)
  run inactiveSelectionDoesNotShareTest = init.then(selection(false)).then(open)
    .expect(s.calls == 0 and safety).then(selection(true)).then(visibility(true)).then(open)
    .expect(s.calls == 0 and safety)
  run anotherShareAfterCancellationTest = init.then(open).then(finish).then(open)
    .expect(s.calls == 2 and s.busy and safety)
}
