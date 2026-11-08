// Files tree sessions, paging, reviewed mutations and per-item partial outcomes.
// Source entry points are installFilesTreeAdapter and AlphaFilesPlugin.
module FilesTree {
  type State = {
    native: bool, active: bool, hidden: bool, epoch: int, granted: bool,
    session: int, folder: int, requestFolder: int, requestEpoch: int,
    listingPending: bool, morePending: bool, cursor: bool, shown: Set[int],
    existing: Set[int], capabilities: Set[int], revisions: int -> int, parents: int -> int,
    selection: Set[int], preview: int, previewKind: str, picker: bool, pickerEpoch: int,
    review: str, expected: int -> int, reviewed: Set[int], destination: int,
    permanent: bool, pending: Set[int], attempted: Set[int], succeeded: Set[int],
    failed: Set[int], phase: str, folderHasChildren: bool,
    lastAppliedRevision: int, lastExpectedRevision: int, lastDeleteConfirmed: bool,
    effects: int, visibleRows: Set[int], focusedRow: int, intendedRow: int, activatedRow: int
  }
  var s: State
  pure val Ids = Set(1, 2, 3)
  pure val Folders = Set(10, 20)
  action init = {
    nondet native = Bool.oneOf()
    s' = { native: native, active: true, hidden: false, epoch: 0, granted: false,
      session: 0, folder: 10, requestFolder: 10, requestEpoch: 0,
      listingPending: false, morePending: false, cursor: false, shown: Set(),
      existing: Set(1, 2), capabilities: Set(), revisions: Ids.mapBy(_ => 0),
      parents: Ids.mapBy(_ => 10), selection: Set(), preview: 0, previewKind: "none", picker: false, pickerEpoch: 0,
      review: "none", expected: Ids.mapBy(_ => 0), reviewed: Set(), destination: 20,
      permanent: false, pending: Set(), attempted: Set(), succeeded: Set(), failed: Set(),
      phase: "idle", folderHasChildren: false, lastAppliedRevision: 0,
      lastExpectedRevision: 0, lastDeleteConfirmed: true, effects: 0,
      visibleRows: Set(), focusedRow: 0, intendedRow: 0, activatedRow: 0 }
  }
  // Presentation rows include Recent metadata. Rendering a row grants no file capability.
  action renderRows(rows: Set[int]): bool = all { s.active, rows.subseteq(Ids),
    s' = { ...s, visibleRows: rows,
      focusedRow: if (rows.contains(s.focusedRow)) s.focusedRow else 0,
      intendedRow: if (rows.contains(s.intendedRow)) s.intendedRow else 0 } }
  action focusRow(id: int): bool = all { s.active, not(s.hidden), s.visibleRows.contains(id),
    s' = { ...s, focusedRow: id, intendedRow: id, activatedRow: 0 } }
  action activateRow = all { s.active, not(s.hidden), s.focusedRow != 0,
    not(s.listingPending), s.phase != "dispatching",
    s' = { ...s, activatedRow: s.focusedRow, focusedRow: 0, intendedRow: 0 } }
  action chooseTree = all { s.active, s.phase != "dispatching", s.session < 2,
    s' = { ...s, granted: true, session: s.session + 1, shown: Set(), capabilities: Set(),
      selection: Set(), preview: 0, previewKind: "none", phase: "idle", review: "none" } }
  action load(folder: int): bool = all { Folders.contains(folder), s.active, s.granted,
    not(s.listingPending), s.phase != "dispatching",
    s' = { ...s, requestFolder: folder, requestEpoch: s.epoch, listingPending: true,
      morePending: false, review: "none", selection: Set() } }
  action loadMore = all { s.active, s.granted, s.cursor, not(s.listingPending), s.phase != "dispatching",
    s' = { ...s, requestFolder: s.folder, requestEpoch: s.epoch,
      listingPending: true, morePending: true } }
  action listReply = all { s.listingPending,
    if (s.active and s.granted and s.requestEpoch == s.epoch) {
      val allRows = s.existing.filter(id => s.parents.get(id) == s.requestFolder)
      val first = allRows.filter(id => id == 1)
      val rows = if (s.morePending) s.shown.union(allRows) else first
      s' = { ...s, folder: s.requestFolder, shown: rows, capabilities: s.capabilities.union(rows),
        listingPending: false, morePending: false, cursor: not(allRows.subseteq(rows)), selection: Set() }
    } else s' = { ...s, listingPending: false, morePending: false } }
  action pickFile = all { s.active, not(s.picker), not(s.listingPending), s.phase != "dispatching",
    s' = { ...s, picker: true, pickerEpoch: s.epoch, hidden: true, focusedRow: 0, intendedRow: 0 } }
  // System pickers hide the document. Epoch and active-view checks admit the return.
  action pickerReply(id: int): bool = all { s.picker, s.existing.contains(id),
    s' = { ...s, picker: false, hidden: false,
      preview: if (s.active and s.pickerEpoch == s.epoch) id else 0,
      previewKind: if (s.active and s.pickerEpoch == s.epoch) "picker" else "none" } }
  action selectRow(id: int): bool = all { s.active, s.shown.contains(id), s.phase != "dispatching", not(s.listingPending),
    s' = { ...s, selection: s.selection.union(Set(id)) } }
  action previewRow(id: int): bool = all { s.active, s.granted, s.capabilities.contains(id), not(s.listingPending), s.phase != "dispatching",
    s.existing.contains(id), s' = { ...s, preview: id, previewKind: "tree" } }
  action review(kind: str): bool = all { s.active, s.granted, s.phase != "dispatching", not(s.listingPending), not(s.picker),
    Set("create", "rename", "move", "delete").contains(kind),
    kind == "create" or s.selection != Set(),
    s' = { ...s, review: kind, phase: "review", expected: s.revisions,
      reviewed: if (kind == "create") Set(3) else s.selection,
      permanent: false, succeeded: Set(), failed: Set(), attempted: Set() } }
  action confirmPermanent = all { s.phase == "review", s.review == "delete",
    s' = { ...s, permanent: true } }
  action confirm = all { s.phase == "review", s.active, s.granted,
    s.review != "delete" or s.permanent,
    s' = { ...s, phase: "dispatching", pending: s.reviewed, attempted: Set() } }
  action applyItem(id: int, providerSucceeds: bool): bool = all {
    s.phase == "dispatching", s.pending.contains(id), not(s.attempted.contains(id)),
    {
      val current = s.granted and (s.review == "create" or
        (s.existing.contains(id) and s.capabilities.contains(id) and s.revisions.get(id) == s.expected.get(id)))
      val permitted = current and (s.review != "delete" or (s.permanent and (id != 3 or not(s.folderHasChildren))))
        and (s.review != "move" or s.parents.get(id) != s.destination)
        and s.revisions.get(id) < 2 and s.effects < 4
      val applied = providerSucceeds and permitted
      s' = { ...s, pending: s.pending.exclude(Set(id)), attempted: s.attempted.union(Set(id)),
        succeeded: if (applied) s.succeeded.union(Set(id)) else s.succeeded,
        failed: if (applied) s.failed else s.failed.union(Set(id)),
        existing: if (applied and s.review == "delete") s.existing.exclude(Set(id))
          else if (applied and s.review == "create") s.existing.union(Set(id)) else s.existing,
        revisions: if (applied) s.revisions.set(id, s.revisions.get(id) + 1) else s.revisions,
        parents: if (applied and s.review == "move") s.parents.set(id, s.destination)
          else if (applied and s.review == "create") s.parents.set(id, s.folder) else s.parents,
        capabilities: if (applied and Set("move", "delete").contains(s.review)) s.capabilities.exclude(Set(id)) else s.capabilities,
        preview: if (applied and id == s.preview) 0 else s.preview,
        previewKind: if (applied and id == s.preview) "none" else s.previewKind,
        lastAppliedRevision: if (applied) s.revisions.get(id) else s.lastAppliedRevision,
        lastExpectedRevision: if (applied) (if (s.review == "create") s.revisions.get(id) else s.expected.get(id)) else s.lastExpectedRevision,
        lastDeleteConfirmed: if (applied) (s.review != "delete" or s.permanent) else s.lastDeleteConfirmed,
        effects: if (applied) s.effects + 1 else s.effects }
    }
  }
  action stopRevokedBatch = all { s.phase == "dispatching", not(s.granted),
    s' = { ...s, pending: Set() } }
  action finish = all { s.phase == "dispatching", s.pending == Set(),
    s' = { ...s, phase: if (s.succeeded == Set()) "failed" else if (s.failed == Set()) "done" else "partial",
      review: "none", selection: Set(), shown: s.shown.intersect(s.capabilities) } }
  action sourceChanges(id: int): bool = all { s.existing.contains(id), s.revisions.get(id) < 2,
    s' = { ...s, revisions: s.revisions.set(id, s.revisions.get(id) + 1) } }
  action childrenAppear = s' = { ...s, folderHasChildren: true }
  action revoke = s' = { ...s, granted: false, capabilities: Set(), shown: Set(),
    selection: Set(), preview: 0, previewKind: "none", cursor: false }
  action leave = all { s.epoch < 2, s' = { ...s, active: false, epoch: s.epoch + 1,
    selection: Set(), preview: 0, previewKind: "none", focusedRow: 0, intendedRow: 0,
    review: if (s.phase == "dispatching") s.review else "none" } }
  action enter = s' = { ...s, active: true, hidden: false }
  action restart = all { s.epoch < 2, s' = { ...s, epoch: s.epoch + 1, active: true,
    picker: false, hidden: false, listingPending: false, morePending: false,
    capabilities: if (s.native) Set() else s.capabilities,
    shown: if (s.native) Set() else s.shown, selection: Set(), preview: 0, previewKind: "none",
    phase: "idle", review: "none", pending: Set(), visibleRows: Set(), focusedRow: 0, intendedRow: 0 } }
  action step = any {
    { nondet folder = Folders.oneOf(); load(folder) },
    { nondet id = Ids.oneOf(); pickerReply(id) },
    { nondet id = Ids.oneOf(); selectRow(id) },
    { nondet id = Ids.oneOf(); previewRow(id) },
    { nondet kind = Set("create", "rename", "move", "delete").oneOf(); review(kind) },
    { nondet id = Ids.oneOf(); nondet success = Bool.oneOf(); applyItem(id, success) },
    { nondet id = Ids.oneOf(); sourceChanges(id) },
    { nondet rows = Set(Set(), Set(1), Set(2), Set(3), Set(1, 2), Set(1, 3), Set(2, 3), Ids).oneOf(); renderRows(rows) },
    { nondet id = Ids.oneOf(); focusRow(id) },
    chooseTree, loadMore, listReply, pickFile, confirmPermanent, confirm, stopRevokedBatch, finish,
    childrenAppear, revoke, leave, enter, restart, activateRow, s' = s
  }
  val ExactReviewedRevision = s.lastAppliedRevision == s.lastExpectedRevision
  val DestructionConfirmed = s.lastDeleteConfirmed
  val PartialOutcomesDisjoint = s.succeeded.intersect(s.failed) == Set()
  val EachItemAttemptedOnce = s.pending.intersect(s.attempted) == Set()
  val RevokedCapabilitiesEmpty = not(s.granted) implies s.capabilities == Set() and s.previewKind != "tree"
  val SelectionFromListing = s.selection.subseteq(s.shown)
  val FocusedRowIdentity = s.focusedRow == s.intendedRow and
    (s.focusedRow == 0 or s.visibleRows.contains(s.focusedRow))
  val TypeOK = Folders.contains(s.folder) and s.existing.subseteq(Ids) and s.pending.subseteq(Ids)
    and s.revisions.keys() == Ids and s.epoch.in(0.to(2)) and s.effects.in(0.to(4))
  val safety = ExactReviewedRevision and DestructionConfirmed and PartialOutcomesDisjoint
    and EachItemAttemptedOnce and RevokedCapabilitiesEmpty and SelectionFromListing and TypeOK and FocusedRowIdentity
  run partialBatchTest = init.then(chooseTree).then(load(10)).then(listReply).then(loadMore).then(listReply)
    .then(selectRow(1)).then(selectRow(2)).then(review("delete")).then(confirmPermanent)
    .then(confirm).then(applyItem(1, true)).then(applyItem(2, false)).then(finish)
    .expect(s.phase == "partial" and not(s.existing.contains(1)) and s.existing.contains(2) and safety)
  run staleRevisionTest = init.then(chooseTree).then(load(10)).then(listReply).then(selectRow(1))
    .then(review("rename")).then(sourceChanges(1)).then(confirm).then(applyItem(1, true)).then(finish)
    .expect(s.phase == "failed" and s.effects == 0 and safety)
  run permissionLossMidBatchTest = init.then(chooseTree).then(load(10)).then(listReply).then(loadMore).then(listReply)
    .then(selectRow(1)).then(selectRow(2)).then(review("move")).then(confirm).then(applyItem(1, true))
    .then(revoke).then(applyItem(2, true)).then(finish).expect(s.phase == "partial" and s.effects == 1 and safety)
  run hiddenPickerReturnTest = init.then(pickFile).expect(s.hidden).then(pickerReply(1))
    .expect(s.preview == 1 and not(s.hidden) and safety)
  run stalePickerReturnTest = init.then(pickFile).then(leave).then(pickerReply(1))
    .expect(s.preview == 0 and safety)
  run folderCreationTest = init.then(chooseTree).then(review("create")).then(confirm)
    .then(applyItem(3, true)).then(finish).expect(s.existing.contains(3) and safety)
  run recentInsertionKeepsFocusTest = init.then(renderRows(Set(1, 2))).then(focusRow(1))
    .then(renderRows(Set(1, 2, 3))).then(activateRow)
    .expect(s.activatedRow == 1 and s.capabilities == Set() and safety)
  run removedRowClearsFocusTest = init.then(renderRows(Set(1, 2))).then(focusRow(1))
    .then(renderRows(Set(2))).expect(s.focusedRow == 0 and safety)
}
