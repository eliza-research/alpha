/// The source-document review of one text note on Android: link a picked file, open the linked
/// source, verify a picked file against the link, or remove the link. One action runs per dialog.
/// Every await is followed by a check that the dialog is still open over the unchanged note; a
/// stale action stops without writing. The picker selection of an action is always given back,
/// and a retained source reference outlives the selection only while a note names it.
module NoteSourceDialog {
  /// `stage` is the port call the action waits on; `prior` is the reference its dialog showed
  /// when the action began.
  type Op = { stage: str, mode: str, selection: int, file: int, ref: int, prior: int }
  type State = {
    visit: bool, rev: int, link: int, linkRef: int,
    gen: int, open: bool, expected: int, source: int, sourceRef: int, viewerOpened: bool, status: str,
    op: Op, opGen: int,
    serial: int, grants: Set[int], leaked: Set[int], refSerial: int, refs: Set[int],
    edits: int, views: int, cancels: int, maintains: int
  }
  var s: State
  pure val idle: Op = { stage: "none", mode: "none", selection: 0, file: 0, ref: 0, prior: 0 }
  pure val Files = Set(1, 2)
  /// The note starts without a source, with a linked file, or with a linked file whose
  /// reference Android retains.
  action initFor(link: int, referenced: bool): bool = all { Set(0, 1).contains(link), link != 0 or not(referenced),
    s' = {
      visit: true, rev: 0, link: link, linkRef: if (referenced) 1 else 0,
      gen: 0, open: false, expected: 0, source: 0, sourceRef: 0, viewerOpened: false, status: "none",
      op: idle, opGen: 0,
      serial: 0, grants: Set(), leaked: Set(), refSerial: if (referenced) 1 else 0, refs: if (referenced) Set(1) else Set(),
      edits: 0, views: 0, cancels: 0, maintains: 0
    } }
  action init = {
    nondet link = Set(0, 1).oneOf()
    nondet referenced = Bool.oneOf()
    initFor(link, referenced and link != 0)
  }
  /// The dialog is open in the Notes visit it was opened from, over the note revision it reviewed.
  pure def fresh(v: State): bool = v.open and v.visit and v.rev == v.expected
  /// The running action belongs to the dialog on screen and that dialog is still fresh.
  pure def current(v: State): bool = v.opGen == v.gen and fresh(v)
  pure def shown(v: State): bool = v.opGen == v.gen and v.open
  pure def say(v: State, status: str): State = if (shown(v)) { ...v, status: status } else v
  /// The action ends: its selection, if any, is given back before the dialog accepts another.
  pure def finished(v: State): State =
    if (v.op.selection != 0) { ...v, op: { ...v.op, stage: "release" } } else { ...v, op: idle }
  pure def closed(v: State): State =
    { ...v, open: false, cancels: if (v.open and v.viewerOpened) v.cancels + 1 else v.cancels }
  /// A dialog opens over the open text note; an earlier dialog closes first. An action of the
  /// earlier dialog that is still waiting runs on without its dialog.
  action openDialog = all { s.visit, s.gen < 3,
    s' = { ...closed(s), gen: s.gen + 1, open: true, expected: s.rev, source: s.link, sourceRef: s.linkRef,
      viewerOpened: false, status: "none" } }
  action closeDialog = all { s.open, s' = closed(s) }
  action leaveNotes = all { s.visit, s' = { ...closed(s), visit: false } }
  action enterNotes = all { not(s.visit), s' = { ...s, visit: true } }
  /// The note is changed elsewhere while the dialog is open.
  action outsideEdit = all { s.edits < 2, s' = { ...s, rev: s.rev + 1, edits: s.edits + 1 } }
  /// Link or verify: the system picker opens.
  action choose(mode: str): bool = all { Set("link", "open").contains(mode), fresh(s), s.op.stage == "none",
    mode == "link" or s.source != 0, s.serial < 3,
    s' = { ...s, op: { ...idle, stage: "pick", mode: mode, prior: s.sourceRef }, opGen: s.gen, status: "choosing" } }
  /// The picker answers. A selection is a grant from that moment, whatever happens next.
  action pickSettles(result: str): bool = all { s.op.stage == "pick", Set("selected", "cancelled", "refused").contains(result),
    val id = s.serial + 1
    val picked = if (result == "selected") { ...s, serial: id, grants: s.grants.union(Set(id)), op: { ...s.op, selection: id } } else s
    s' = if (not(current(picked))) finished(picked)
      else if (result == "cancelled") finished(say(picked, "cancelled"))
      else if (result == "refused") finished(say(picked, "error"))
      else { ...picked, op: { ...picked.op, stage: "read" } } }
  /// The selected bytes are read and reviewed. `matches` is false when the bytes changed between
  /// the read and the review; `versioned` is true when the selection can be retained.
  action readSettles(ok: bool, file: int, matches: bool, versioned: bool): bool = all { s.op.stage == "read", Files.contains(file),
    s' = if (not(ok)) finished(say(s, "error"))
      else if (not(current(s))) finished(s)
      else if (not(matches)) finished(say(s, "error"))
      else if (s.op.mode == "link")
        { ...s, op: { ...s.op, file: file, stage: if (versioned) "retain" else "save" } }
      else if (file != s.source) finished(say(s, "error"))
      else { ...s, viewerOpened: true, views: s.views + 1, op: { ...s.op, file: file, stage: "view" } } }
  /// Android keeps the selection's read grant under a reference the note can name.
  action retainSettles(ok: bool): bool = all { s.op.stage == "retain",
    val id = s.refSerial + 1
    val kept = { ...s, refSerial: id, refs: s.refs.union(Set(id)), op: { ...s.op, ref: id } }
    s' = if (not(ok)) finished(say(s, "error"))
      else if (not(current(kept))) finished(kept)
      else { ...kept, op: { ...kept.op, stage: "save" } } }
  /// Remove the link of the note: a save with no source.
  action remove = all { fresh(s), s.op.stage == "none", s.source != 0,
    s' = { ...s, op: { ...idle, stage: "save", mode: "remove", prior: s.sourceRef }, opGen: s.gen } }
  /// Notes persistence answers the save issued by a fresh dialog. A saved link replaces the
  /// note's link; a replaced reference asks for maintenance, also when the dialog is gone.
  action saveSettles(saved: bool): bool = all { s.op.stage == "save",
    s' = if (not(saved)) finished(say(s, "error"))
      else {
        val stored = { ...s, rev: s.rev + 1, link: s.op.file, linkRef: s.op.ref,
          maintains: if (s.op.prior != 0 and s.op.prior != s.op.ref) s.maintains + 1 else s.maintains }
        val reviewed = if (s.opGen == s.gen)
            { ...stored, expected: stored.rev, source: s.op.file, sourceRef: s.op.ref }
          else stored
        finished(say(reviewed, if (s.op.mode == "remove") "removed" else "linked"))
      } }
  action viewSettles(ok: bool): bool = all { s.op.stage == "view",
    s' = finished(say(s, if (ok) "opened" else "error")) }
  /// Open the linked source through its retained reference; no picker and no selection.
  action openLinked = all { fresh(s), s.op.stage == "none", s.sourceRef != 0,
    s' = { ...s, viewerOpened: true, views: s.views + 1, status: "opening",
      op: { ...idle, stage: "linked", mode: "linked", file: s.source, ref: s.sourceRef, prior: s.sourceRef }, opGen: s.gen } }
  action linkedSettles(ok: bool): bool = all { s.op.stage == "linked",
    s' = { ...say(s, if (ok) "opened" else "error"), op: idle } }
  /// The selection is given back. A refused release leaves the grant with the picker.
  action releaseSettles(ok: bool): bool = all { s.op.stage == "release",
    val base = if (ok) { ...s, grants: s.grants.exclude(Set(s.op.selection)) }
      else say({ ...s, leaked: s.leaked.union(Set(s.op.selection)) }, "release-failed")
    s' = { ...base, op: idle } }
  /// Notes maintenance tells Android which references a note still names; the rest are released.
  /// A reference retained by the action in flight is younger than the three-day grace.
  action maintain = s' = { ...s, refs: s.refs.filter(id => id == s.linkRef or id == s.op.ref) }
  action step = {
    nondet mode = Set("link", "open").oneOf()
    nondet result = Set("selected", "cancelled", "refused").oneOf()
    nondet read = Set("failed", "changed", "one", "two").oneOf()
    nondet ok = Bool.oneOf()
    nondet versioned = Bool.oneOf()
    any { openDialog, closeDialog, leaveNotes, enterNotes, outsideEdit, choose(mode), pickSettles(result),
      readSettles(read != "failed", if (read == "two") 2 else 1, read != "changed", versioned), retainSettles(ok), remove, saveSettles(ok), viewSettles(ok),
      openLinked, linkedSettles(ok), releaseSettles(ok), maintain, s' = s }
  }
  /// A picker grant is held only by the action that is using it, or was refused its release.
  val SelectionHeldOnlyByRunningAction = s.grants.forall(id => id == s.op.selection or s.leaked.contains(id))
  val FinishedActionHoldsNothing = s.op.stage == "none" implies s.op == idle
  /// The reference a note names is retained for as long as the note names it.
  val LinkedReferenceRetained = s.linkRef == 0 or (s.link != 0 and s.refs.contains(s.linkRef))
  val DialogShowsStoredLinkWhileFresh = fresh(s) and s.op.stage != "save" implies (s.source == s.link and s.sourceRef == s.linkRef)
  val ViewerCancelledOncePerDialog = s.cancels <= s.gen and s.cancels <= s.views
  val WaitingStagesKnown = s.op.stage.in(Set("none", "pick", "read", "retain", "save", "view", "linked", "release"))
    and (s.op.stage.in(Set("read", "retain", "view", "release")) implies s.op.selection != 0)
  val StatusOnlyFromShownDialog = s.gen == 0 implies s.status == "none"
  val safety = SelectionHeldOnlyByRunningAction and FinishedActionHoldsNothing and LinkedReferenceRetained
    and DialogShowsStoredLinkWhileFresh and ViewerCancelledOncePerDialog and WaitingStagesKnown and StatusOnlyFromShownDialog
  val StaleActionReleasedWitness = s.op.stage == "release" and s.opGen == s.gen and not(fresh(s)) and s.status == "choosing"
  val OrphanReferenceWitness = s.refs.exists(id => id != s.linkRef) and s.op.stage == "none"
  val LinkSaveIssuedWitness = s.op.stage == "save" and s.op.mode == "link"
  val LinkSavedWitness = s.op.mode == "link" and s.link == s.op.file and s.rev > s.edits
  val ReleaseRefusedWitness = s.leaked != Set() and s.status == "release-failed"
  val ReplacedReferenceMaintainedWitness = s.maintains > 0
  val MatchingFileOpenedWitness = s.op.stage == "view" and s.op.file == s.source
  val OtherFileRefusedWitness = s.op.stage == "release" and s.op.mode == "open" and s.status == "error" and s.views == 0
  val LinkedReferenceOpenedWitness = s.op.stage == "linked"
  val ViewerAnsweredWitness = s.op.mode == "open" and s.op.stage == "release" and s.op.file != 0
  val AbandonedActionOutlivesDialogWitness = s.op.stage != "none" and s.opGen != s.gen
  run linkRetainsReferenceAndReleasesSelectionTest = initFor(0, false).then(openDialog).then(choose("link")).then(pickSettles("selected"))
    .expect(s.grants == Set(1) and s.op.stage == "read" and safety)
    .then(readSettles(true, 1, true, true)).then(retainSettles(true)).then(saveSettles(true))
    .expect(s.link == 1 and s.linkRef == 1 and s.op.stage == "release" and s.status == "linked" and safety)
    .then(releaseSettles(true))
    .expect(s.grants == Set() and s.refs == Set(1) and s.op == idle and fresh(s) and safety)
  /// The note changes while the picker is open: nothing is linked and the selection is given back.
  run changedNoteStopsLinkTest = initFor(0, false).then(openDialog).then(choose("link")).then(outsideEdit).then(pickSettles("selected"))
    .expect(s.op.stage == "release" and s.link == 0 and s.status == "choosing" and safety)
    .then(releaseSettles(true)).expect(s.grants == Set() and s.rev == 1 and s.link == 0 and safety)
  /// The dialog closes after the reference was retained: the reference stays until maintenance.
  run closedDialogLeavesReferenceForMaintenanceTest = initFor(0, false).then(openDialog).then(choose("link")).then(pickSettles("selected"))
    .then(readSettles(true, 1, true, true)).then(closeDialog).then(retainSettles(true))
    .expect(s.refs == Set(1) and s.link == 0 and s.op.stage == "release" and safety)
    .then(maintain).expect(s.refs == Set(1) and safety)
    .then(releaseSettles(true)).then(maintain).expect(s.refs == Set() and s.grants == Set() and safety)
  run verifyRefusesOtherFileTest = initFor(0, false).then(openDialog).then(choose("link")).then(pickSettles("selected"))
    .then(readSettles(true, 1, true, false)).then(saveSettles(true)).then(releaseSettles(true))
    .expect(s.link == 1 and s.linkRef == 0 and safety)
    .then(choose("open")).then(pickSettles("selected")).then(readSettles(true, 2, true, false))
    .expect(s.views == 0 and s.status == "error" and s.op.stage == "release" and safety)
    .then(releaseSettles(true)).then(choose("open")).then(pickSettles("selected")).then(readSettles(true, 1, true, false))
    .expect(s.views == 1 and s.viewerOpened and safety).then(viewSettles(true)).then(releaseSettles(true))
    .then(closeDialog).expect(s.cancels == 1 and s.grants == Set() and safety)
  run removeDropsLinkAndAsksMaintenanceTest = initFor(0, false).then(openDialog).then(choose("link")).then(pickSettles("selected"))
    .then(readSettles(true, 2, true, true)).then(retainSettles(true)).then(saveSettles(true)).then(releaseSettles(true))
    .then(remove).then(saveSettles(true))
    .expect(s.link == 0 and s.linkRef == 0 and s.maintains == 1 and s.status == "removed" and s.op == idle and safety)
    .then(maintain).expect(s.refs == Set() and safety)
  run refusedReleaseIsReportedTest = initFor(0, false).then(openDialog).then(choose("link")).then(pickSettles("selected"))
    .then(readSettles(false, 1, true, false)).then(releaseSettles(false))
    .expect(s.leaked == Set(1) and s.grants == Set(1) and s.status == "release-failed" and s.op == idle and safety)
  /// A dialog opened while an abandoned action still waits: that action finishes on its own.
  run abandonedActionFinishesWithoutDialogTest = initFor(1, true).then(openDialog).then(choose("link")).then(openDialog)
    .expect(s.gen == 2 and s.opGen == 1 and s.status == "none" and safety)
    .then(pickSettles("selected")).expect(s.op.stage == "release" and s.status == "none" and safety)
    .then(releaseSettles(true)).expect(s.grants == Set() and s.link == 1 and s.linkRef == 1 and safety)
  run linkedReferenceOpensWithoutPickerTest = initFor(1, true).then(openDialog).then(openLinked)
    .expect(s.viewerOpened and s.serial == 0 and s.status == "opening" and safety)
    .then(linkedSettles(true)).then(leaveNotes).expect(s.cancels == 1 and not(s.open) and s.status == "opened" and safety)
  /// A removal still waiting when another dialog opens asks for maintenance when it lands.
  run abandonedRemovalStillAsksMaintenanceTest = initFor(1, true).then(openDialog).then(remove).then(openDialog)
    .then(saveSettles(true))
    .expect(s.link == 0 and s.maintains == 1 and s.status == "none" and not(fresh(s)) and s.op == idle and safety)
  run unsavedLinkKeepsOldSourceTest = initFor(0, false).then(openDialog).then(choose("link")).then(pickSettles("selected"))
    .then(readSettles(true, 1, true, false)).then(saveSettles(false))
    .expect(s.link == 0 and s.source == 0 and s.status == "error" and safety)
}
