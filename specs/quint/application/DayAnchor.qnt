// Day offsets counted from today, across local midnight: loaded rows are read again by a
// midnight timer or on resume, and open forms are re-anchored so their civil date holds.
module DayAnchor {
  type State = {
    today: int, mounted: bool,
    // refreshDue: the date changed and the midnight timer (or a resume) has not yet run.
    refreshDue: bool,
    // Device and reminder rows carry offsets computed on rowReadDay; rowDay is an event's civil day.
    rowsShown: bool, rowReadDay: int, rowDay: int,
    // form: "none" | "creation" (retained new-event form) | "edit" (retained edit of a device,
    // reminder or Google event) | "plain" (a form no draft retains, such as a new reminder; it
    // keeps its own anchor from the first render that shows it).
    form: str, formOff: int, formAnchor: int, formIntended: int,
    // closedEditDay: the day an editor of a saved item was last closed unsaved here (-1 when none).
    closedEditDay: int,
    saved: bool, savedRetained: bool, savedWhileDue: bool, savedDay: int, savedIntended: int
  }
  var s: State
  action init = s' = { today: 0, mounted: true, refreshDue: false,
    rowsShown: true, rowReadDay: 0, rowDay: 1,
    form: "none", formOff: 0, formAnchor: 0, formIntended: 0, closedEditDay: -1,
    saved: false, savedRetained: false, savedWhileDue: false, savedDay: 0, savedIntended: 0 }
  val RowOff = s.rowDay - s.rowReadDay
  val Retained = s.form.in(Set("creation", "edit"))
  // Each render shifts an open form's offset by the days since its anchor, retained or not.
  pure def anchored(state: State): State =
    if (state.form != "none" and state.formAnchor != state.today)
      { ...state, formOff: state.formOff + state.formAnchor - state.today, formAnchor: state.today }
    else state

  // A form opens from the day list or an event's detail, so no other form is open. A form that
  // was closed keeps no anchor: the next one is anchored on the day it opens.
  action openForm(kind: str, off: int): bool = all {
    s.mounted, s.form == "none", kind.in(Set("creation", "edit", "plain")), off.in(0.to(1)),
    s' = { ...s, form: kind, formOff: off, formAnchor: s.today, formIntended: s.today + off }
  }
  action closeForm = all {
    s.form != "none",
    s' = { ...s, form: "none", closedEditDay: if (s.form == "edit") s.today else s.closedEditDay }
  }
  // Local midnight passes. While mounted, a timer set for it is now due.
  action midnight = all {
    s.today < 2, s' = { ...s, today: s.today + 1, refreshDue: s.mounted }
  }
  // The timer (or the app resuming) reads the rows again; that publication also re-renders, which
  // re-anchors an open form. A failed device read hides its rows instead of showing old offsets.
  action refresh(ok: bool): bool = all {
    s.mounted,
    s' = anchored({ ...s, refreshDue: false, rowsShown: ok,
      rowReadDay: if (ok) s.today else s.rowReadDay })
  }
  // Any other state change re-renders too.
  action render = all { s.mounted, s' = anchored(s) }
  // Save resolves the form's offset against the current day. A saved device event reads the
  // device rows again; the midnight timer stays set.
  action save = all {
    s.form != "none", not(s.saved),
    s' = { ...s, saved: true, savedRetained: Retained, savedWhileDue: s.refreshDue,
      savedDay: s.today + s.formOff, savedIntended: s.formIntended, form: "none",
      rowsShown: Retained or s.rowsShown, rowReadDay: if (Retained) s.today else s.rowReadDay }
  }
  action unmount = all {
    s.mounted,
    s' = { ...s, mounted: false, refreshDue: false, rowsShown: false, form: "none", closedEditDay: -1 }
  }
  // Mounting reads the rows and sets the next midnight timer.
  action mount = all {
    not(s.mounted), s' = { ...s, mounted: true, rowsShown: true, rowReadDay: s.today }
  }
  action step = {
    nondet kind = Set("creation", "edit", "plain").oneOf()
    nondet off = 0.to(1).oneOf()
    nondet ok = Bool.oneOf()
    any { openForm(kind, off), closeForm, midnight, refresh(ok), render, save, unmount, mount, s' = s }
  }

  // Shown rows carry today's offsets unless the midnight refresh is still due.
  val RowsFollowDate = s.rowsShown implies (s.rowReadDay == s.today or s.refreshDue)
  val RowOffIsCivilDay = (s.rowsShown and s.rowReadDay == s.today) implies s.today + RowOff == s.rowDay
  // An open form is anchored to today, or to an earlier day only while the refresh is due.
  val FormFollowsDate = s.form != "none" implies (s.formAnchor == s.today or s.refreshDue)
  // Re-anchoring never changes the civil date a form means.
  val FormKeepsCivilDate = s.form != "none" implies s.formAnchor + s.formOff == s.formIntended
  val SaveOnIntendedDay = (s.saved and not(s.savedWhileDue)) implies s.savedDay == s.savedIntended
  val DueOnlyWhileMounted = s.refreshDue implies s.mounted
  val TypeOK = s.today.in(0.to(2)) and s.form.in(Set("none", "creation", "edit", "plain"))
    and s.rowReadDay.in(0.to(2)) and s.formAnchor.in(0.to(2))
    and s.closedEditDay.in((-1).to(2)) and s.closedEditDay <= s.today
  val safety = TypeOK and RowsFollowDate and RowOffIsCivilDay and FormFollowsDate
    and FormKeepsCivilDate and SaveOnIntendedDay and DueOnlyWhileMounted

  val StaleRowsAwaitingTimerWitness = s.rowsShown and s.rowReadDay != s.today and s.refreshDue
  val ReanchoredFormWitness = Retained and s.formOff < 0
  val PlainFormReanchoredWitness = s.form == "plain" and s.formOff < 0
  // The date changed and the form has not been rendered since: saving now lands a day late.
  val SavedBeforeTimerWitness = s.saved and s.savedWhileDue and s.savedDay != s.savedIntended
  // The editor of an item is open again on a later day than the one it was last closed on.
  val ReopenedEditWitness = s.form == "edit" and s.closedEditDay >= 0 and s.closedEditDay < s.formAnchor
    and s.formAnchor == s.today
  val RowsHiddenAfterFailedReadWitness = s.mounted and not(s.rowsShown) and s.today > 0

  // The screen stays on across midnight: the timer reads the rows again with today's offsets.
  run midnightRefreshTest = init.then(midnight)
    .expect(StaleRowsAwaitingTimerWitness and RowOff == 1 and safety)
    .then(refresh(true)).expect(RowOff == 0 and s.rowReadDay == 1 and not(s.refreshDue) and safety)
  run retainedFormReanchoredTest = init.then(openForm("creation", 1)).then(midnight).then(refresh(true))
    .expect(s.formOff == 0 and s.formAnchor == 1 and safety).then(save)
    .expect(s.savedDay == 1 and s.savedIntended == 1 and safety)
  run retainedEditReanchoredTest = init.then(openForm("edit", 0)).then(midnight).then(render)
    .expect(ReanchoredFormWitness and s.formOff == -1 and safety).then(refresh(true)).then(save)
    .expect(s.savedDay == 0 and s.savedIntended == 0 and safety)
  run failedReadHidesRowsTest = init.then(midnight).then(refresh(false))
    .expect(RowsHiddenAfterFailedReadWitness and safety)
    .then(refresh(true)).expect(s.rowsShown and RowOff == 0 and safety)
  run remountReadsTodayTest = init.then(unmount).then(midnight).expect(not(s.refreshDue))
    .then(mount).expect(s.rowReadDay == 1 and RowOff == 0 and safety)
  // A new reminder's form has no retained draft; it still keeps the day it was opened for.
  run plainFormFollowsDateTest = init.then(openForm("plain", 0)).then(midnight).then(refresh(true))
    .expect(PlainFormReanchoredWitness and s.formOff == -1 and safety).then(save)
    .expect(s.savedDay == 0 and s.savedIntended == 0 and safety)
  // An editor closed before midnight and opened again after it is a fresh form for today.
  run reopenedEditAnchoredTodayTest = init.then(openForm("edit", 1)).then(closeForm).then(midnight)
    .then(refresh(true)).then(openForm("edit", 0))
    .expect(ReopenedEditWitness and s.formAnchor == 1 and s.formOff == 0 and s.formIntended == 1 and safety)
    .then(render).expect(s.formOff == 0 and safety).then(save)
    .expect(s.savedDay == 1 and s.savedIntended == 1 and safety)
  // Saved in the instant between midnight and the timer: the offset still counts from yesterday.
  run saveBeforeTimerTest = init.then(openForm("creation", 0)).then(midnight).then(save)
    .expect(SavedBeforeTimerWitness and s.savedDay == 1 and safety)
}
