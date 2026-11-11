/// The agent's Notes operations on the phone (device actions) and where they stop. Phone-side
/// Notes actions act only on Previous notes; with the default source ("the agent's Notes") they
/// refuse and the agent's own canonical Notes action writes instead, outside the phone's
/// "Review phone actions first" preference. Admission, journal and claim are DeviceActionReview.
module NotesAgentSource {
  type State = {
    source: str, storageFailed: bool, reviewFirst: bool, op: str, authority: str,
    view: str, sensitive: bool, workflow: bool,
    selected: bool, targetCurrent: bool, snapshotShared: bool,
    trashCopy: bool, tombstone: bool, trashFull: bool,
    notes: int, edits: int, shared: int, canonicalWrites: int, canonicalUnderReviewFirst: bool,
    outcome: str}
  var s: State
  pure val selectedOps = Set("notes_read_selected", "notes_update", "notes_delete")
  pure val ops = selectedOps.union(Set("create_note", "notes_query"))
  action init = s' = {source: "canonical", storageFailed: false, reviewFirst: false, op: "create_note",
    authority: "none", view: "notes", sensitive: false, workflow: false,
    selected: false, targetCurrent: true, snapshotShared: false,
    trashCopy: false, tombstone: false, trashFull: false,
    notes: 0, edits: 0, shared: 0, canonicalWrites: 0, canonicalUnderReviewFirst: false, outcome: "none"}
  val idle = s.authority == "none"
  val running = not(idle) and s.outcome == "none"
  val previous = s.source == "legacy" and not(s.storageFailed)
  /// Screen binding per operation: query from Home or Notes, selected-record operations from
  /// Notes with the note selected, never from a protected screen.
  val bound = not(s.sensitive) and
    (if (s.op == "create_note") true
     else if (s.op == "notes_query") s.view.in(Set("home", "notes"))
     else s.view == "notes" and s.selected)
  action scene(source: str, view: str, sensitive: bool, selected: bool): bool = all {idle,
    source.in(Set("canonical", "legacy")), view.in(Set("home", "notes", "calendar")),
    s' = {...s, source: source, view: view, sensitive: sensitive, selected: selected, targetCurrent: true}}
  action prefer(reviewFirst: bool): bool = all {idle, s' = {...s, reviewFirst: reviewFirst}}
  action propose(op: str, workflow: bool): bool = all {idle, op.in(ops),
    s' = {...s, op: op, workflow: workflow, outcome: "none", trashCopy: false, tombstone: false}}
  action storageFails = s' = {...s, storageFailed: true}
  action fillTrash = s' = {...s, trashFull: true}
  action noteChanges = s' = {...s, targetCurrent: false}
  /// Only note creation is on the direct allow-list, and never as a workflow step.
  action runDirect = all {idle, s.op == "create_note", not(s.workflow), not(s.reviewFirst), bound,
    s' = {...s, authority: "request"}}
  action approve = all {idle, bound, s' = {...s, authority: "review"}}
  action refuse = all {running,
    not(previous) or not(bound) or (s.op.in(selectedOps) and not(s.targetCurrent)) or
      (s.op == "notes_update" and not(s.snapshotShared)) or (s.op == "notes_delete" and s.trashFull),
    s' = {...s, outcome: "failed"}}
  action create = all {running, previous, s.op == "create_note",
    s' = {...s, notes: s.notes + 1, outcome: "succeeded"}}
  /// A reviewed read shares one snapshot; an update may only follow such a share. The second half
  /// is the server tool contract (update tools take no model-authored fields); the phone executor
  /// does not re-check it, so here it is an ASSUMPTION, not a checked phone rule.
  action share = all {running, previous, bound, s.op.in(Set("notes_query", "notes_read_selected")),
    s.op == "notes_read_selected" implies s.targetCurrent,
    s' = {...s, shared: s.shared + 1, outcome: "succeeded",
      snapshotShared: s.snapshotShared or s.op == "notes_read_selected"}}
  action update = all {running, previous, bound, s.op == "notes_update", s.targetCurrent, s.snapshotShared,
    s' = {...s, edits: s.edits + 1, outcome: "succeeded", snapshotShared: false}}
  /// Deletion: the restorable copy is written first, then the tombstone.
  action writeTrashCopy = all {running, previous, bound, s.op == "notes_delete", s.targetCurrent,
    not(s.trashFull), not(s.trashCopy), s' = {...s, trashCopy: true}}
  action writeTombstone(confirmed: bool): bool = all {running, s.op == "notes_delete", s.trashCopy, not(s.tombstone),
    s' = {...s, tombstone: confirmed, outcome: if (confirmed) "succeeded" else "unknown"}}
  action settle = all {not(idle), s.outcome != "none", s' = {...s, authority: "none", outcome: "none"}}
  /// ASSUMPTION made visible: the agent's own Notes action writes canonical notes with no phone
  /// card, whatever "Review phone actions first" says.
  action canonicalWrite = all {s.source == "canonical", s.canonicalWrites < 2,
    s' = {...s, canonicalWrites: s.canonicalWrites + 1,
      canonicalUnderReviewFirst: s.canonicalUnderReviewFirst or s.reviewFirst}}
  action step = any {
    scene("canonical", "notes", false, true), scene("legacy", "notes", false, true),
    scene("legacy", "notes", false, false), scene("legacy", "home", false, false),
    scene("legacy", "notes", true, true), scene("legacy", "calendar", false, false),
    prefer(true), prefer(false),
    propose("create_note", false), propose("create_note", true), propose("notes_query", false),
    propose("notes_read_selected", false), propose("notes_update", false), propose("notes_delete", false),
    storageFails, fillTrash, noteChanges, runDirect, approve, refuse, create, share, update,
    writeTrashCopy, writeTombstone(true), writeTombstone(false), settle, canonicalWrite}

  val deviceEffects = s.notes + s.edits + s.shared
  val DeviceNotesOpsOnlyOnPreviousNotes = (running or s.outcome == "succeeded") implies
    (s.outcome != "succeeded" or s.source == "legacy")
  val OnlyCreateRunsWithoutCard = s.authority == "request" implies (s.op == "create_note" and not(s.workflow))
  val SelectedNoteBinding = (s.op.in(selectedOps) and s.outcome == "succeeded") implies
    (s.view == "notes" and s.selected and not(s.sensitive))
  val DeleteWritesTrashBeforeTombstone = s.tombstone implies s.trashCopy
  val FullTrashDeletesNothing = (s.op == "notes_delete" and s.trashFull and not(s.trashCopy)) implies not(s.tombstone)
  val ReadsNeedReview = (s.op.in(Set("notes_query", "notes_read_selected")) and not(idle)) implies
    s.authority == "review"
  val ProtectedScreenSharesNothing = (s.sensitive and not(idle)) implies s.outcome != "succeeded"
  val safety = DeviceNotesOpsOnlyOnPreviousNotes and OnlyCreateRunsWithoutCard and SelectedNoteBinding and
    DeleteWritesTrashBeforeTombstone and FullTrashDeletesNothing and ReadsNeedReview and
    ProtectedScreenSharesNothing

  /// KNOWN GAP (app review AGENT-09), registered as an expected violation: the preference does
  /// not cover the agent's canonical Notes writes.
  val ReviewFirstCoversCanonicalNotes = not(s.canonicalUnderReviewFirst)
  val CanonicalWriteIgnoresToggle = s.canonicalUnderReviewFirst

  run defaultSourceRefusesTest = init.then(runDirect).then(refuse)
    .expect(safety and s.outcome == "failed" and s.notes == 0)
  run previousNotesCreateTest = init.then(scene("legacy", "home", false, false)).then(runDirect).then(create)
    .expect(safety and s.notes == 1)
  run readThenUpdateTest = init.then(scene("legacy", "notes", false, true))
    .then(propose("notes_read_selected", false)).then(approve).then(share).then(settle)
    .then(propose("notes_update", false)).then(approve).then(update)
    .expect(safety and s.edits == 1 and s.shared == 1)
  run updateWithoutSnapshotTest = init.then(scene("legacy", "notes", false, true))
    .then(propose("notes_update", false)).then(approve).then(refuse)
    .expect(safety and s.edits == 0 and s.outcome == "failed")
  run changedNoteTest = init.then(scene("legacy", "notes", false, true))
    .then(propose("notes_delete", false)).then(approve).then(noteChanges).then(refuse)
    .expect(safety and not(s.trashCopy) and not(s.tombstone))
  run deleteMovesToTrashTest = init.then(scene("legacy", "notes", false, true))
    .then(propose("notes_delete", false)).then(approve).then(writeTrashCopy)
    .expect(safety and s.trashCopy and not(s.tombstone)).then(writeTombstone(true))
    .expect(safety and s.outcome == "succeeded")
  run fullTrashTest = init.then(scene("legacy", "notes", false, true)).then(fillTrash)
    .then(propose("notes_delete", false)).then(approve).then(refuse)
    .expect(safety and not(s.tombstone) and s.outcome == "failed")
  run canonicalWriteUnderReviewFirstTest = init.then(prefer(true)).then(canonicalWrite)
    .expect(safety and CanonicalWriteIgnoresToggle and not(ReviewFirstCoversCanonicalNotes))
}
