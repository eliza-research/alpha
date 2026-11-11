/// The Notes Trash surface in one renderer: single-flight maintenance shared by background and
/// foreground callers, one destructive action at a time, and the full-Trash refusal that is the
/// only way to a permanent deletion without a Trash copy.
module NotesTrashSession {
  type State = {
    live: bool, storageFailed: bool, noteOpen: bool, rows: int,
    maintaining: bool, background: bool, joinReload: bool, passes: int, reloadOwed: bool,
    busy: str, operations: int, trashOpen: bool, confirm: str, full: bool, refused: bool,
    foreverFromRefusal: bool, forever: int
  }
  var s: State
  action init = s' = {
    live: true, storageFailed: false, noteOpen: true, rows: 1,
    maintaining: false, background: false, joinReload: false, passes: 0, reloadOwed: false,
    busy: "none", operations: 0, trashOpen: false, confirm: "none", full: false, refused: false,
    foreverFromRefusal: true, forever: 0
  }
  /// Startup, resume and the 15-minute timer. A pass already running is joined, never doubled.
  action backgroundPass = all { s.live, not(s.storageFailed),
    s' = if (s.maintaining) s else { ...s, maintaining: true, background: true, passes: s.passes + 1 } }
  /// A foreground caller that joins a background pass still re-reads Trash afterwards.
  pure def foreground(v: State): State =
    if (v.maintaining) { ...v, joinReload: v.joinReload or v.background }
    else { ...v, maintaining: true, background: false, passes: v.passes + 1 }
  action notesOpened = all { s.live, s' = foreground(s) }
  action maintenanceDone(removed: bool): bool = all { s.maintaining,
    s' = { ...s, maintaining: false, background: false, joinReload: false, passes: s.passes - 1,
      rows: if (removed and s.rows > 0) s.rows - 1 else s.rows,
      reloadOwed: not(s.background) or removed or s.joinReload } }
  action reload = all { s.reloadOwed, s' = { ...s, reloadOwed: false } }
  /// A full Trash refuses the open note: nothing is written and the exact note is remembered.
  action trashRefusesNote = all { s.live, s.noteOpen, s.busy == "none", not(s.storageFailed),
    s' = { ...s, refused: true, full: true, confirm: "none" } }
  action openTrash = all { s.live,
    s' = foreground({ ...s, refused: false, full: false, trashOpen: true, confirm: "none" }) }
  action closeTrash = all { s.trashOpen, s' = { ...s, trashOpen: false, confirm: "none" } }
  action askErase(kind: str): bool = all { Set("one", "all").contains(kind), s.trashOpen, s.busy == "none",
    s.rows > 0, not(s.full), s' = { ...s, confirm: kind } }
  action cancel = all { s.full or s.confirm != "none",
    s' = { ...s, confirm: "none", full: false, refused: false } }
  /// Back closes the full-Trash choice first, then a confirmation, then Trash itself.
  action back = all { s.full or s.confirm != "none" or s.trashOpen,
    s' = if (s.full) { ...s, full: false, refused: false }
      else if (s.confirm != "none") { ...s, confirm: "none" }
      else { ...s, trashOpen: false } }
  /// The refused note is closed or leaves the list: the next render forgets the refusal.
  action noteLeaves = all { s.noteOpen, s.busy != "forever", s' = { ...s, noteOpen: false } }
  action noteReturns = all { not(s.noteOpen), not(s.full), s' = { ...s, noteOpen: true } }
  action renderSweep = all { s.full, not(s.noteOpen), s' = { ...s, full: false, refused: false } }
  /// The confirmation button: the full-Trash choice deletes that note permanently, otherwise the
  /// confirmed Trash rows are erased.
  action confirmGo = all { s.live, s.busy == "none", s.operations < 3,
    if (s.full) all { s.noteOpen,
      s' = { ...s, busy: if (s.refused) "forever" else "none", operations: if (s.refused) s.operations + 1 else s.operations,
        foreverFromRefusal: s.foreverFromRefusal and s.refused } }
    else all { s.confirm != "none", s.trashOpen,
      // Failed Notes storage can hold a restored copy in an unsaved draft: the confirmation
      // closes and nothing is erased.
      s' = if (s.storageFailed) { ...s, confirm: "none" }
        else { ...s, busy: "erase", confirm: "none", operations: s.operations + 1 } } }
  action restore = all { s.live, s.trashOpen, s.busy == "none", s.rows > 0, s.operations < 3,
    s' = foreground({ ...s, busy: "restore", operations: s.operations + 1 }) }
  action operationDone(outcome: str): bool = all { s.busy != "none", not(s.maintaining) or s.busy != "restore",
    Set("done", "changed", "unconfirmed").contains(outcome),
    val settled = s.busy == "forever" and outcome != "unconfirmed"
    s' = { ...s, busy: "none", reloadOwed: true,
      rows: if (s.busy != "forever" and outcome == "done" and s.rows > 0) s.rows - 1 else s.rows,
      forever: if (s.busy == "forever" and outcome == "done") s.forever + 1 else s.forever,
      noteOpen: if (s.busy == "forever" and outcome == "done") false else s.noteOpen,
      refused: if (settled) false else s.refused, full: if (settled) false else s.full } }
  action storageFails = s' = { ...s, storageFailed: true }
  action step = {
    nondet flag = Bool.oneOf()
    nondet kind = Set("one", "all").oneOf()
    nondet outcome = Set("done", "changed", "unconfirmed").oneOf()
    any { backgroundPass, notesOpened, maintenanceDone(flag), reload, trashRefusesNote, openTrash,
      closeTrash, askErase(kind), cancel, back, noteLeaves, noteReturns, renderSweep, confirmGo,
      restore, operationDone(outcome), storageFails, s' = s }
  }
  val SingleMaintenancePass = s.passes == (if (s.maintaining) 1 else 0)
  val JoinedPassReloads = s.joinReload implies s.maintaining and s.background
  val OneDestructiveAction = s.busy.in(Set("none", "erase", "restore", "forever")) and s.operations.in(0.to(3))
  val FullChoiceHoldsRefusal = s.full == s.refused
  val ConfirmationNeedsOpenTrash = s.confirm != "none" implies s.trashOpen and not(s.full)
  val PermanentOnlyAfterRefusal = s.foreverFromRefusal
  val safety = SingleMaintenancePass and JoinedPassReloads and OneDestructiveAction and FullChoiceHoldsRefusal
    and ConfirmationNeedsOpenTrash and PermanentOnlyAfterRefusal
  val ForegroundJoinedBackgroundWitness = s.joinReload
  val RefusalPendingWitness = s.full and s.refused and s.busy == "forever"
  val ChoiceDismissedDuringDeleteWitness = s.busy == "forever" and not(s.refused)
  val RestoreWaitsForMaintenanceWitness = s.busy == "restore" and s.maintaining
  val DeletedForeverWitness = s.forever == 1
  run timerAndOpenShareOnePassTest = init.then(backgroundPass).then(notesOpened).then(backgroundPass)
    .expect(s.passes == 1 and s.joinReload and safety).then(maintenanceDone(false))
    .expect(s.reloadOwed and not(s.maintaining) and safety)
  run backgroundPassWithoutChangeSkipsReloadTest = init.then(backgroundPass).then(maintenanceDone(false))
    .expect(not(s.reloadOwed) and safety)
  /// Opening Trash forgets the refusal, so the permanent-delete button has nothing to act on.
  run openTrashForgetsRefusalTest = init.then(trashRefusesNote).expect(s.full and s.refused and safety)
    .then(openTrash).expect(not(s.refused) and not(s.full) and s.trashOpen and safety)
    .then(askErase("all")).then(confirmGo).expect(s.busy == "erase" and s.forever == 0 and safety)
  run refusedNoteDeletedForeverTest = init.then(trashRefusesNote).then(confirmGo).then(operationDone("done"))
    .expect(s.forever == 1 and not(s.refused) and not(s.full) and s.busy == "none" and safety)
  run unconfirmedPermanentDeleteKeepsChoiceTest = init.then(trashRefusesNote).then(confirmGo)
    .then(operationDone("unconfirmed")).expect(s.refused and s.full and s.forever == 0 and safety)
  run failedStorageRefusesEraseTest = init.then(openTrash).then(maintenanceDone(false)).then(askErase("one"))
    .then(storageFails).then(confirmGo)
    .expect(s.busy == "none" and s.confirm == "none" and s.rows == 1 and s.operations == 0 and safety)
  run busyBlocksSecondActionTest = init.then(openTrash).then(maintenanceDone(false)).then(restore)
    .expect(s.busy == "restore" and s.maintaining and s.passes == 1 and safety)
    .then(maintenanceDone(false)).then(operationDone("done"))
    .expect(s.busy == "none" and s.rows == 0 and s.reloadOwed and safety)
}
