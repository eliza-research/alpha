/// Separate legacy Trash/CAS and canonical resident Notes contracts. Content is an opaque identity.
module NotesLifecycle {
  type Canonical = {
    current: bool, owner: int, visibleOwner: int, phase: str,
    note: bool, revision: int, content: str,
    reading: bool, readToken: int, readOwner: int, invalidated: bool,
    draft: bool, draftToken: int, base: int, version: int, text: str,
    writing: bool, writeToken: int, writeOwner: int, writeVersion: int, writeText: str,
    queued: bool, queuedVersion: int, followup: bool, unknown: bool, review: bool, writes: int,
    folder: bool, folderId: int, folderName: int, folderRevision: int, noteFolder: bool, noteFolderId: int
  }
  pure val canonicalInitial = {
    current: true, owner: 0, visibleOwner: 0, phase: "ready",
    note: true, revision: 0, content: "original",
    reading: false, readToken: 0, readOwner: 0, invalidated: false,
    draft: false, draftToken: 0, base: 0, version: 0, text: "",
    writing: false, writeToken: 0, writeOwner: 0, writeVersion: 0, writeText: "",
    queued: false, queuedVersion: 0, followup: false, unknown: false, review: false, writes: 0,
    folder: true, folderId: 0, folderName: 0, folderRevision: 0, noteFolder: true, noteFolderId: 0
  }
  type State = { mode: str, canonical: Canonical, live: bool, content: str, draft: str, revision: int, expected: int,
    trash: bool, trashContent: str, age: int, deleted: bool, locked: bool, fault: bool }
  var s: State
  action initLegacy = s' = { mode: "legacy", canonical: canonicalInitial, live: true, content: "original", draft: "original", revision: 0,
    expected: 0, trash: false, trashContent: "", age: 0, deleted: false, locked: false, fault: false }
  action edit = all { s.live, not(s.locked), s' = { ...s, draft: "edited", expected: s.revision } }
  action save = all { s.live, not(s.locked), not(s.fault), s.revision == s.expected, s.revision < 2,
    s' = { ...s, content: s.draft, revision: s.revision + 1, expected: s.revision + 1 } }
  action concurrentSave = all { s.live, s.revision < 2,
    s' = { ...s, content: "concurrent", revision: s.revision + 1 } }
  action storageFault = s' = { ...s, fault: true }
  action recoverStorage = s' = { ...s, fault: false }
  action prepareTrash = all { s.live, not(s.locked), not(s.fault),
    s' = { ...s, trash: true, trashContent: s.content, age: 0 } }
  action commitDeletion = all { s.live, s.trash, s.trashContent == s.content, not(s.fault),
    s' = { ...s, live: false, deleted: true } }
  action restore = all { not(s.live), s.trash, s.age < 3, not(s.fault),
    s' = { ...s, live: true, content: s.trashContent, draft: s.trashContent, trash: false,
      trashContent: "", deleted: false } }
  action age = all { s.trash, s.age < 3, s' = { ...s, age: s.age + 1 } }
  action maintenance = all { s.trash, not(s.fault), s.live or s.age >= 3,
    s' = { ...s, trash: false, trashContent: "" } }
  action lock = s' = { ...s, locked: true }
  action unlock = s' = { ...s, locked: false }
  action restart = s' = { ...s, draft: s.content, expected: s.revision, fault: false }
  action legacyStep = any { edit, save, concurrentSave, storageFault, recoverStorage, prepareTrash,
    commitDeletion, restore, age, maintenance, lock, unlock, restart, s' = s }

  action initCanonical = s' = { mode: "canonical", canonical: canonicalInitial,
    live: true, content: "original", draft: "original", revision: 0, expected: 0,
    trash: false, trashContent: "", age: 0, deleted: false, locked: false, fault: false }
  action init = any { initLegacy, initCanonical }
  val c = s.canonical
  val canonicalSelection = c.current and c.note and c.draft and
    (c.version == 0 or c.base == c.revision)
  val canonicalFolderVisible = c.note and c.noteFolder and c.folder and c.noteFolderId == c.folderId
  val canonicalCanSave = c.current and c.draft and not(c.writing) and
    c.base == c.revision and c.version > 0 and c.writes < 2 and c.revision < 3
  val canonicalCanAutoSave = canonicalCanSave and c.followup and not(c.unknown)

  action canonicalOpen = all {
    c.current, c.note, not(c.writing), not(c.draft), c.draftToken < 3,
    s' = { ...s, canonical: { ...c, draft: true, draftToken: c.draftToken + 1,
      base: c.revision, version: 0, text: c.content } }
  }
  action canonicalEdit = all {
    c.current, c.draft, c.version < 2,
    s' = { ...s, canonical: { ...c, version: c.version + 1, text: if (c.version == 0) "edited" else "newer" } }
  }
  action canonicalRefresh = all {
    c.current, not(c.reading), not(c.writing), c.readToken < 3,
    s' = { ...s, canonical: { ...c, reading: true, readToken: c.readToken + 1,
      readOwner: c.owner, invalidated: false, phase: "loading" } }
  }
  action canonicalInvalidate = all {
    c.current,
    if (c.reading or c.writing) s' = { ...s, canonical: { ...c, invalidated: true } }
    else canonicalRefresh
  }
  action canonicalReadResult(owner: int, token: int, revision: int, present: bool): bool = {
    if (c.current and c.reading and owner == c.owner and owner == c.readOwner and token == c.readToken) {
      if (revision < c.revision) s' = { ...s, canonical: { ...c, reading: false, phase: "review", review: true } }
      else {
        val content = if (revision > c.revision) "external" else c.content
        val dirty = c.draft and c.version > 0
        val conflict = dirty and c.base != revision
        val review = (c.review and (dirty or c.unknown)) or conflict
        s' = { ...s, canonical: { ...c, reading: false, note: present,
          revision: revision, content: content, visibleOwner: owner,
          draft: c.draft and (dirty or present),
          base: if (dirty) c.base else revision,
          text: if (dirty) c.text else if (present) content else "",
          review: review,
          phase: if (review) "review" else "ready" } }
      }
    } else s' = s
  }
  action canonicalReadFailure = all {
    c.current, c.reading,
    s' = { ...s, canonical: { ...c, reading: false, phase: "review", review: true } }
  }
  action canonicalSave = all {
    canonicalCanSave,
    s' = { ...s, canonical: { ...c, writing: true, phase: "saving",
      writeToken: c.draftToken, writeOwner: c.owner, writeVersion: c.version, writeText: c.text,
      reading: false, invalidated: c.invalidated or c.reading,
      followup: false, unknown: false, writes: c.writes + 1 } }
  }
  action canonicalQueueSave = all {
    c.current, c.writing, c.draft,
    s' = { ...s, canonical: { ...c, queued: true, queuedVersion: c.version } }
  }
  action canonicalSaveResult(owner: int, token: int, confirmed: bool): bool = {
    if (c.current and c.writing and owner == c.owner and owner == c.writeOwner and token == c.writeToken) {
      if (confirmed) {
        val sameDraft = c.draft and c.draftToken == token
        val editedMeanwhile = sameDraft and c.version > c.writeVersion
        s' = { ...s, canonical: { ...c, writing: false, phase: "ready", revision: c.revision + 1,
          content: c.writeText, visibleOwner: owner, review: false, unknown: false,
          base: if (sameDraft) c.revision + 1 else c.base,
          version: if (sameDraft and not(editedMeanwhile)) 0 else c.version,
          text: if (sameDraft and not(editedMeanwhile)) c.writeText else c.text,
          followup: c.queued and editedMeanwhile and c.queuedVersion > c.writeVersion, queued: false } }
      } else s' = { ...s, canonical: { ...c, writing: false, phase: "review",
        review: true, unknown: true, queued: false, followup: false } }
    } else s' = s
  }
  action canonicalAutoSave = all { canonicalCanAutoSave, canonicalSave }
  action canonicalDiscardDraft = all {
    c.current, not(c.writing),
    s' = { ...s, canonical: { ...c, draft: false, version: 0, text: "",
      review: false, followup: false, unknown: false, invalidated: true } }
  }
  action canonicalCreateFolder(expected: int, stored: bool): bool = {
    if (c.current and not(c.folder) and expected == c.folderRevision and c.folderRevision < 2 and c.folderId < 1 and stored)
      s' = { ...s, canonical: { ...c, folder: true, folderId: c.folderId + 1,
        folderName: 0, folderRevision: c.folderRevision + 1 } }
    else s' = s
  }
  action canonicalRenameFolder(expected: int, name: int, stored: bool): bool = {
    if (c.current and c.folder and expected == c.folderRevision and c.folderRevision < 2 and stored)
      s' = { ...s, canonical: { ...c, folderName: name, folderRevision: c.folderRevision + 1 } }
    else s' = s
  }
  action canonicalDeleteFolder(expected: int, stored: bool): bool = {
    if (c.current and c.folder and expected == c.folderRevision and c.folderRevision < 2 and stored)
      s' = { ...s, canonical: { ...c, folder: false, folderRevision: c.folderRevision + 1 } }
    else s' = s
  }
  action canonicalRetire = all {
    c.current, s' = { ...s, canonical: { ...c, current: false, phase: "retired",
      note: false, draft: false, reading: false, writing: false,
      invalidated: false, followup: false, queued: false } }
  }
  action canonicalStep = {
    nondet owner = 0.to(1).oneOf()
    nondet token = 0.to(3).oneOf()
    nondet revision = 0.to(3).oneOf()
    nondet present = Set(false, true).oneOf()
    any { canonicalOpen, canonicalEdit, canonicalRefresh, canonicalInvalidate,
      canonicalReadResult(owner, token, revision, present), canonicalReadFailure,
      canonicalSave, canonicalQueueSave, canonicalSaveResult(owner, token, present),
      canonicalAutoSave, canonicalDiscardDraft,
      canonicalRenameFolder(revision, 0, present), canonicalRenameFolder(revision, 1, present),
      canonicalCreateFolder(revision, present), canonicalDeleteFolder(revision, present), canonicalRetire, s' = s }
  }
  action step = any {
    all { s.mode == "legacy", legacyStep },
    all { s.mode == "canonical", canonicalStep }
  }
  val CanonicalAuthority = c.note implies c.current and c.visibleOwner == c.owner
  val SerializedCanonicalRequests = not(c.reading and c.writing)
  val UnknownWriteHasNoAutomaticReplay = c.unknown implies not(c.followup or c.queued)
  val RetiredCanonicalEmpty = not(c.current) implies not(c.note or c.draft or c.reading or c.writing)
  val CanonicalBounds = c.revision.in(0.to(3)) and c.version.in(0.to(2)) and c.writes.in(0.to(2))
  val canonicalSafety = CanonicalAuthority and SerializedCanonicalRequests and
    UnknownWriteHasNoAutomaticReplay and RetiredCanonicalEmpty and CanonicalBounds

  val RestorableBytes = (s.deleted and s.age < 3) implies s.trash
  val TombstoneMeaning = s.deleted implies not(s.live)
  val TrashHasContent = s.trash implies s.trashContent != ""
  val safety = RestorableBytes and TombstoneMeaning and TrashHasContent and canonicalSafety
  run failedSaveKeepsDraftTest = initLegacy.then(edit).then(storageFault)
    .expect(s.draft == "edited" and s.content == "original" and safety)
  run deletionRestartRestoreTest = initLegacy.then(prepareTrash).then(commitDeletion).then(restart)
    .then(restore).expect(s.live and s.content == "original" and safety)
  run expiryTest = initLegacy.then(prepareTrash).then(commitDeletion).then(age).then(age).then(age)
    .then(maintenance).expect(not(s.live) and not(s.trash) and safety)
  run concurrentEditTest = initLegacy.then(edit).then(concurrentSave)
    .expect(s.expected != s.revision and s.draft == "edited" and safety)

  run canonicalDirtyRefreshKeepsDraftTest = initCanonical.then(canonicalOpen).then(canonicalEdit)
    .then(canonicalRefresh).then(canonicalReadResult(0, 1, 1, true))
    .expect(c.text == "edited" and c.content == "external" and c.base == 0 and c.review and not(canonicalSelection) and safety)
  run canonicalCleanRefreshFollowsSnapshotTest = initCanonical.then(canonicalOpen)
    .then(canonicalRefresh).then(canonicalReadResult(0, 1, 1, true))
    .expect(c.text == "external" and c.base == 1 and c.version == 0 and canonicalSelection and safety)
  run canonicalInvalidationsCoalesceTest = initCanonical.then(canonicalRefresh)
    .then(canonicalInvalidate).then(canonicalInvalidate)
    .expect(c.readToken == 1 and c.invalidated)
    .then(canonicalReadResult(0, 1, 1, true)).then(canonicalRefresh)
    .expect(c.readToken == 2 and not(c.invalidated) and safety)
  run canonicalWriteRetiresOlderReadTest = initCanonical.then(canonicalOpen).then(canonicalEdit)
    .then(canonicalRefresh).then(canonicalSave).then(canonicalReadResult(0, 1, 2, true))
    .expect(c.revision == 0 and c.writing)
    .then(canonicalSaveResult(0, 1, true)).expect(c.content == "edited" and c.revision == 1 and safety)
  run canonicalTypingDuringSaveQueuesOnlyNewEditTest = initCanonical.then(canonicalOpen).then(canonicalEdit)
    .then(canonicalSave).then(canonicalEdit).then(canonicalQueueSave).then(canonicalSaveResult(0, 1, true))
    .expect(c.version == 2 and c.base == 1 and c.text == "newer" and c.content == "edited" and canonicalCanAutoSave)
    .then(canonicalAutoSave).then(canonicalSaveResult(0, 1, true))
    .expect(c.version == 0 and c.writes == 2 and c.revision == 2 and c.content == "newer" and safety)
  run canonicalUnknownWriteRetainsDraftTest = initCanonical.then(canonicalOpen).then(canonicalEdit)
    .then(canonicalSave).then(canonicalQueueSave).then(canonicalSaveResult(0, 1, false))
    .expect(c.text == "edited" and c.version == 1 and c.content == "original" and c.unknown and not(canonicalCanAutoSave) and safety)
  run canonicalExplicitRetryRemainsAvailableTest = initCanonical.then(canonicalOpen).then(canonicalEdit)
    .then(canonicalSave).then(canonicalSaveResult(0, 1, false))
    .expect(c.unknown and not(canonicalCanAutoSave) and canonicalCanSave)
    .then(canonicalSave).then(canonicalSaveResult(0, 1, true))
    .expect(c.content == "edited" and c.writes == 2 and not(c.unknown) and safety)
  run canonicalQueueBeforeNewEditDoesNotReplayTest = initCanonical.then(canonicalOpen).then(canonicalEdit)
    .then(canonicalSave).then(canonicalQueueSave).then(canonicalEdit).then(canonicalSaveResult(0, 1, true))
    .expect(c.text == "newer" and c.content == "edited" and not(canonicalCanAutoSave) and safety)
  run canonicalReadFailureRecoversTest = initCanonical.then(canonicalRefresh).then(canonicalReadFailure)
    .expect(c.review).then(canonicalRefresh).then(canonicalReadResult(0, 2, 1, true))
    .expect(not(c.review) and c.phase == "ready" and safety)
  run canonicalForeignReadCannotPublishTest = initCanonical.then(canonicalRefresh)
    .then(canonicalReadResult(1, 1, 2, true)).expect(c.reading and c.revision == 0)
    .then(canonicalReadResult(0, 1, 1, true)).expect(c.revision == 1 and safety)
  run canonicalRetiredOwnerCannotPublishTest = initCanonical.then(canonicalOpen).then(canonicalEdit)
    .then(canonicalSave).then(canonicalRetire).then(canonicalSaveResult(0, 1, true))
    .expect(not(c.current or c.note or c.draft) and c.content == "original" and safety)
  run canonicalFolderRenameKeepsMembershipTest = initCanonical.then(canonicalRenameFolder(0, 1, true))
    .expect(c.folderName == 1 and c.noteFolder and canonicalFolderVisible and c.revision == 0 and safety)
  run canonicalDeletedFolderIsUnfiledTest = initCanonical.then(canonicalDeleteFolder(0, true))
    .expect(c.note and c.noteFolder and not(canonicalFolderVisible) and c.content == "original" and safety)
  run canonicalNewFolderNeverAdoptsOldReferenceTest = initCanonical.then(canonicalDeleteFolder(0, true))
    .then(canonicalCreateFolder(1, true))
    .expect(c.note and c.folder and c.folderId == 1 and c.noteFolderId == 0 and not(canonicalFolderVisible) and safety)
  run canonicalFolderCasRejectsStaleWriteTest = initCanonical.then(canonicalRenameFolder(0, 1, true))
    .then(canonicalDeleteFolder(0, true)).expect(c.folder and c.folderRevision == 1 and safety)
  run canonicalMissingCleanSelectionClosesTest = initCanonical.then(canonicalOpen).then(canonicalRefresh)
    .then(canonicalReadResult(0, 1, 1, false)).expect(not(c.draft or canonicalSelection) and safety)
  run canonicalDiscardIsExplicitTest = initCanonical.then(canonicalOpen).then(canonicalEdit)
    .then(canonicalSave).then(canonicalSaveResult(0, 1, false)).then(canonicalDiscardDraft)
    .then(canonicalRefresh).then(canonicalReadResult(0, 1, 1, true))
    .expect(not(c.draft or c.review) and c.content == "external" and safety)
}
