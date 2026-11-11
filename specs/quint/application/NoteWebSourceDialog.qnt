/// The web-source review of one summary note: visit the source page or remove the link. A dialog
/// accepts one action and never re-enables its controls; a dialog that is closed, hidden, left
/// or over a changed note accepts none. Closing aborts a visit that has not started, and a saved
/// removal closes the dialog that asked for it.
module NoteWebSourceDialog {
  type State = {
    visit: bool, hidden: bool, rev: int, linked: bool,
    gen: int, open: bool, expected: int, busy: bool, acted: int, status: str,
    op: str, opGen: int, edits: int, navigations: int, removals: int, refused: int
  }
  var s: State
  action init = s' = {
    visit: true, hidden: false, rev: 0, linked: true,
    gen: 0, open: false, expected: 0, busy: false, acted: 0, status: "none",
    op: "none", opGen: 0, edits: 0, navigations: 0, removals: 0, refused: 0
  }
  /// The dialog is open in the Notes visit it was opened from, over the note revision it reviewed.
  pure def fresh(v: State): bool = v.open and v.visit and v.rev == v.expected
  /// The dialog that started the running action is still on screen.
  pure def shown(v: State): bool = v.opGen == v.gen and v.open
  /// A dialog opens over a note that has a web source; an earlier dialog closes first.
  action openDialog = all { s.visit, not(s.hidden), s.linked, s.gen < 3,
    s' = { ...s, gen: s.gen + 1, open: true, expected: s.rev, busy: false, acted: 0, status: "none" } }
  action closeDialog = all { s.open, s' = { ...s, open: false } }
  action leaveNotes = all { s.visit, s' = { ...s, visit: false, open: false } }
  action enterNotes = all { not(s.visit), s' = { ...s, visit: true } }
  action hide = all { not(s.hidden), s' = { ...s, hidden: true, open: false } }
  action show = all { s.hidden, s' = { ...s, hidden: false } }
  action outsideEdit = all { s.edits < 2, s' = { ...s, rev: s.rev + 1, edits: s.edits + 1 } }
  /// Visit or Remove is pressed. A dialog that already acted, or is no longer fresh, ignores it.
  action act(kind: str): bool = all { Set("visit", "remove").contains(kind), s.open, s.busy or s.op == "none",
    s' = if (s.busy or not(fresh(s))) { ...s, refused: if (s.refused < 2) s.refused + 1 else 2 }
      else { ...s, busy: true, acted: s.acted + 1, op: kind, opGen: s.gen } }
  /// The visit settles. It can succeed only while its dialog is open: closing aborts its signal.
  /// A visit that happened closes the dialog.
  action visitSettles(ok: bool): bool = all { s.op == "visit", not(ok) or shown(s),
    s' = if (ok) { ...s, op: "none", navigations: s.navigations + 1, open: false }
      else { ...s, op: "none", status: if (shown(s)) "unconfirmed" else s.status } }
  /// Notes persistence answers the removal. A saved removal lands even when its dialog is gone.
  action removeSettles(saved: bool): bool = all { s.op == "remove",
    s' = if (saved) { ...s, op: "none", linked: false, rev: s.rev + 1, removals: s.removals + 1,
        open: if (s.opGen == s.gen) false else s.open }
      else { ...s, op: "none", status: if (shown(s)) "unconfirmed" else s.status } }
  action step = {
    nondet kind = Set("visit", "remove").oneOf()
    nondet ok = Bool.oneOf()
    any { openDialog, closeDialog, leaveNotes, enterNotes, hide, show, outsideEdit, act(kind), visitSettles(ok),
      removeSettles(ok), s' = s }
  }
  val OneActionPerDialog = s.acted.in(Set(0, 1)) and (s.acted == 1) == s.busy
  val HiddenOrLeftPageHasNoDialog = s.open implies (not(s.hidden) and s.visit)
  /// A dialog still open over a note without a web source can no longer act.
  val DialogOverRemovedLinkIsStale = s.open and not(s.linked) implies not(fresh(s))
  val VisitNeedsItsOpenDialog = s.navigations <= s.gen and s.removals.in(Set(0, 1))
  val UnconfirmedDialogStaysBusy = s.status == "unconfirmed" implies s.busy
  val RunningActionKnown = s.op.in(Set("none", "visit", "remove")) and (s.op != "none" implies s.opGen > 0 and s.opGen <= s.gen)
  val safety = OneActionPerDialog and HiddenOrLeftPageHasNoDialog and DialogOverRemovedLinkIsStale
    and VisitNeedsItsOpenDialog and UnconfirmedDialogStaysBusy and RunningActionKnown
  val VisitAbortedByCloseWitness = s.op == "visit" and not(shown(s))
  val VisitedWitness = s.navigations > 0 and not(s.open)
  val RemovedWitness = not(s.linked) and s.removals == 1
  val UnconfirmedWitness = s.status == "unconfirmed" and s.open
  val StalePressIgnoredWitness = s.refused > 0 and not(s.busy) and s.open
  val AbandonedRemovalLandsWitness = not(s.linked) and s.open
  run visitClosesDialogTest = init.then(openDialog).then(act("visit")).expect(s.busy and s.op == "visit" and safety)
    .then(visitSettles(true)).expect(s.navigations == 1 and not(s.open) and safety)
  /// The dialog is closed while the visit waits: the visit is aborted and nothing is shown.
  run closedDialogAbortsVisitTest = init.then(openDialog).then(act("visit")).then(closeDialog)
    .then(visitSettles(false)).expect(s.navigations == 0 and s.status == "none" and safety)
  run changedNoteIgnoresPressTest = init.then(openDialog).then(outsideEdit).then(act("remove"))
    .expect(s.op == "none" and s.refused == 1 and s.linked and not(s.busy) and safety)
  run unconfirmedRemovalKeepsDialogBusyTest = init.then(openDialog).then(act("remove")).then(removeSettles(false))
    .expect(s.status == "unconfirmed" and s.open and s.busy and s.linked and safety)
    .then(act("visit")).expect(s.op == "none" and s.refused == 1 and safety)
  run savedRemovalClosesDialogTest = init.then(openDialog).then(act("remove")).then(removeSettles(true))
    .expect(not(s.linked) and not(s.open) and s.rev == 1 and safety)
  run hiddenPageClosesDialogTest = init.then(openDialog).then(hide).expect(not(s.open) and safety)
    .then(show).expect(not(s.open) and safety)
  /// A removal still waiting when another dialog opens leaves that dialog stale when it lands.
  run abandonedRemovalStalesNewDialogTest = init.then(openDialog).then(act("remove")).then(openDialog)
    .then(removeSettles(true)).expect(s.open and not(s.linked) and not(fresh(s)) and safety)
    .then(act("visit")).expect(s.op == "none" and s.refused == 1 and safety)
}
