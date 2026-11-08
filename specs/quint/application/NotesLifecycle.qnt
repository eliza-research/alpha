/// One representative note, queued edits, retained drafts and its write-ahead Trash copy.
/// Content is an opaque identity. Draft presence is separate from empty draft content.
module NotesLifecycle {
  type State = { live: bool, content: str, draft: str, revision: int, expected: int,
    trash: bool, trashContent: str, age: int, deleted: bool, locked: bool, fault: bool,
    storedContent: str, retainedDraft: bool, durableDraft: str, durableBase: str, writes: List[str],
    uncertain: bool, draftConflict: bool }
  var s: State
  val PendingCount = s.writes.length()
  action init = s' = { live: true, content: "original", draft: "original", revision: 0,
    expected: 0, trash: false, trashContent: "", age: 0, deleted: false, locked: false, fault: false,
    storedContent: "original", retainedDraft: false, durableDraft: "", durableBase: "", writes: List(),
    uncertain: false, draftConflict: false }
  action edit = all { s.live, not(s.locked), s' = { ...s, draft: "edited", expected: s.revision } }
  action save = all { s.live, not(s.locked), not(s.fault), s.revision == s.expected, s.revision < 2,
    s' = { ...s, content: s.draft, storedContent: s.draft,
      revision: s.revision + 1, expected: s.revision + 1 } }
  action concurrentSave = all { s.live, s.revision < 2,
    s' = { ...s, content: "concurrent", storedContent: "concurrent", revision: s.revision + 1 } }
  /// The editor updates immediately while the document store serializes commits.
  action enqueue(value: str): bool = all { s.live, not(s.locked or s.fault), s.writes.length() < 2,
    value.in(Set("first", "second")), s' = { ...s, draft: value, writes: s.writes.append(value) } }
  action publishWrite = all { s.writes.length() > 0, not(s.fault), s.storedContent == s.content,
    s' = { ...s, storedContent: s.writes.head() } }
  action confirmWrite = all { s.writes.length() > 0, not(s.fault), s.revision < 2,
    s.storedContent == s.writes.head(),
    s' = { ...s, content: s.writes.head(), writes: s.writes.tail(),
      revision: s.revision + 1, expected: s.revision + 1 } }
  action failWrite(uncertain: bool): bool = all { s.writes.length() > 0,
    uncertain or s.storedContent == s.content,
    s' = { ...s, fault: true, uncertain: s.uncertain or uncertain, writes: s.writes.tail() } }
  action rejectQueued = all { s.fault, s.writes.length() > 0,
    s' = { ...s, writes: s.writes.tail() } }
  action preserveDraft = all { s.fault,
    s' = { ...s, retainedDraft: true, durableDraft: s.draft, durableBase: s.content } }
  action inspectRetainedDraft = all { s.retainedDraft, not(s.fault),
    s' = { ...s, draftConflict: s.live and s.storedContent != s.durableBase and s.storedContent != s.durableDraft } }
  action beginDraftRecovery = all { s.live, s.retainedDraft, s.durableDraft != "", not(s.fault or s.draftConflict),
    s.writes.length() == 0, s.storedContent == s.durableBase,
    s' = { ...s, draft: s.durableDraft, writes: List(s.durableDraft) } }
  action clearRecoveredDraft = all { s.retainedDraft, not(s.fault), s.writes.length() == 0,
    s.content == s.durableDraft, s.storedContent == s.durableDraft,
    s' = { ...s, retainedDraft: false, durableDraft: "", durableBase: "", draftConflict: false } }
  action clearObsoleteDraft = all { not(s.live), s.retainedDraft, not(s.fault),
    s' = { ...s, retainedDraft: false, durableDraft: "", durableBase: "", draftConflict: false } }
  action storageFault = s' = { ...s, fault: true }
  action recoverStorage = s' = { ...s, fault: false }
  action prepareTrash = all { s.live, not(s.locked), not(s.fault), s.writes.length() == 0,
    s' = { ...s, trash: true, trashContent: s.content, age: 0 } }
  action commitDeletion = all { s.live, s.trash, s.trashContent == s.content, not(s.fault), s.writes.length() == 0,
    s' = { ...s, live: false, deleted: true, storedContent: "" } }
  action restore = all { not(s.live), s.trash, s.age < 3, not(s.fault),
    s' = { ...s, live: true, content: s.trashContent, storedContent: s.trashContent, draft: s.trashContent, trash: false,
      trashContent: "", deleted: false } }
  action age = all { s.trash, s.age < 3, s' = { ...s, age: s.age + 1 } }
  action maintenance = all { s.trash, not(s.fault), s.live or s.age >= 3,
    s' = { ...s, trash: false, trashContent: "" } }
  action lock = s' = { ...s, locked: true }
  action unlock = s' = { ...s, locked: false }
  action restart = s' = { ...s, content: s.storedContent, draft: s.storedContent,
    expected: s.revision, fault: false, uncertain: false, writes: List(), draftConflict: false }
  action step = any { edit, save, concurrentSave, storageFault, recoverStorage, prepareTrash,
    enqueue("first"), enqueue("second"), publishWrite, confirmWrite, failWrite(true), failWrite(false),
    rejectQueued, preserveDraft, inspectRetainedDraft, beginDraftRecovery, clearRecoveredDraft, clearObsoleteDraft,
    commitDeletion, restore, age, maintenance, lock, unlock, restart, s' = s }
  val RestorableBytes = (s.deleted and s.age < 3) implies s.trash
  val TombstoneMeaning = s.deleted implies not(s.live)
  val TrashHasContent = s.trash implies s.trashContent != ""
  val ConflictingDraftRetained = s.draftConflict implies s.retainedDraft
  val safety = RestorableBytes and TombstoneMeaning and TrashHasContent and ConflictingDraftRetained
  run failedSaveKeepsDraftTest = init.then(edit).then(storageFault)
    .expect(s.draft == "edited" and s.content == "original" and safety)
  run deletionRestartRestoreTest = init.then(prepareTrash).then(commitDeletion).then(restart)
    .then(restore).expect(s.live and s.content == "original" and safety)
  run expiryTest = init.then(prepareTrash).then(commitDeletion).then(age).then(age).then(age)
    .then(maintenance).expect(not(s.live) and not(s.trash) and safety)
  run concurrentEditTest = init.then(edit).then(concurrentSave)
    .expect(s.expected != s.revision and s.draft == "edited" and safety)
  run queuedUnknownCommitKeepsDraftTest = init.then(enqueue("first")).then(enqueue("second"))
    .then(publishWrite).then(failWrite(true)).then(rejectQueued).then(preserveDraft)
    .expect(s.uncertain and s.durableDraft == "second" and s.storedContent == "first" and safety)
  run restartKeepsConflictingDraftTest = queuedUnknownCommitKeepsDraftTest.then(restart).then(inspectRetainedDraft)
    .expect(s.draft == "first" and s.durableDraft == "second" and s.draftConflict and safety)
  run restartAppliesUncommittedDraftTest = init.then(enqueue("first")).then(enqueue("second"))
    .then(failWrite(true)).then(rejectQueued).then(preserveDraft).then(restart).then(inspectRetainedDraft)
    .then(beginDraftRecovery).then(publishWrite).then(confirmWrite).then(clearRecoveredDraft)
    .expect(s.content == "second" and s.durableDraft == "" and not(s.draftConflict) and safety)
  run deletedNoteDraftDoesNotResurrectTest = queuedUnknownCommitKeepsDraftTest.then(restart)
    .then(prepareTrash).then(commitDeletion).then(restart).then(inspectRetainedDraft).then(clearObsoleteDraft)
    .expect(not(s.live or s.retainedDraft or s.draftConflict) and safety)
}
