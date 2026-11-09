/// Ordered scan pages, associated text layers, serialized draft writes and irreversible export.
module ScanDocument {
  type Page = { image: int, text: int }
  type Scan = {
    native: bool, pages: List[Page], phase: str, closed: bool, hidden: bool,
    picker: bool, replacing: bool, exported: bool, output: str, exportPages: List[Page],
    queued: List[List[Page]], saving: bool, pendingPages: List[Page], pendingExpected: int,
    pendingAuto: bool, autoSaved: bool, userSaved: bool, serial: int, storedRevision: int,
    expectedRevision: int, savedPages: List[Page], conflict: bool
  }
  var s: Scan
  action initFor(native: bool): bool = s' = {
    native: native, pages: [], phase: "review", closed: false, hidden: false,
    picker: false, replacing: false, exported: false, output: "none", exportPages: [],
    queued: [], saving: false, pendingPages: [], pendingExpected: 0,
    pendingAuto: false, autoSaved: false, userSaved: false, serial: 0, storedRevision: 0,
    expectedRevision: 0, savedPages: [], conflict: false }
  action init = {
    nondet native = Set(false, true).oneOf()
    initFor(native)
  }
  val editable = not(s.closed or s.exported) and s.phase == "review" and s.queued.length() < 2
  pure def queuePages(native: bool, queued: List[List[Page]], pages: List[Page]): List[List[Page]] =
    if (native and pages.length() > 0) queued.append(pages) else queued
  action add(image: int): bool = all {
    editable, s.pages.length() < 2, image.in(1.to(4)),
    val pages = s.pages.append({ image: image, text: 0 })
    s' = { ...s, pages: pages, queued: queuePages(s.native, s.queued, pages) }
  }
  action reorder = all {
    editable, s.pages.length() == 2,
    val pages = [s.pages.nth(1), s.pages.nth(0)]
    s' = { ...s, pages: pages, queued: queuePages(s.native, s.queued, pages) }
  }
  /// Replacing/correcting an image retires its old OCR text layer.
  action correct = all {
    editable, s.pages.length() > 0,
    val pages = s.pages.replaceAt(0, { image: 3, text: 0 })
    s' = { ...s, pages: pages, queued: queuePages(s.native, s.queued, pages) }
  }
  action keepReviewedText = all {
    editable, s.pages.length() > 0,
    val pages = s.pages.foldl([], (pages, page) => pages.append({ image: page.image, text: page.image }))
    s' = { ...s, pages: pages, queued: queuePages(s.native, s.queued, pages) }
  }
  action removeFirst = all {
    editable, s.pages.length() > 0,
    val pages = s.pages.tail()
    s' = { ...s, pages: pages, queued: queuePages(s.native, s.queued, pages) }
  }
  action beginAutoSave = all {
    not(s.closed or s.saving), s.queued.length() > 0,
    s' = { ...s, saving: true, pendingPages: s.queued.head(), queued: s.queued.tail(),
      pendingExpected: s.expectedRevision, pendingAuto: true }
  }
  action beginManualSave = all {
    not(s.closed or s.saving), s.phase == "review", s.queued.length() == 0, s.pages.length() > 0,
    s' = { ...s, phase: "saving", saving: true, pendingPages: s.pages,
      pendingExpected: s.expectedRevision, pendingAuto: false }
  }
  action saveCommit = all {
    s.saving, not(s.closed), s.pendingExpected == s.storedRevision, s.serial < 4,
    s' = { ...s, saving: false, savedPages: s.pendingPages, pendingPages: [],
      serial: s.serial + 1, storedRevision: s.serial + 1, expectedRevision: s.serial + 1,
      autoSaved: s.autoSaved or s.pendingAuto, userSaved: s.userSaved or not(s.pendingAuto), conflict: false,
      phase: if (s.phase == "saving") "review" else s.phase }
  }
  action saveFailure = all {
    s.saving,
    s' = { ...s, saving: false, pendingPages: [], conflict: true,
      phase: if (s.phase == "saving") "review" else s.phase }
  }
  action competingDraft = all {
    s.serial < 4,
    s' = { ...s, serial: s.serial + 1, storedRevision: s.serial + 1,
      savedPages: [{ image: 4, text: 0 }] }
  }
  action loadDraft(confirmed: bool): bool = all {
    not(s.closed or s.saving), s.phase == "review", s.queued.length() == 0,
    s.storedRevision != 0, confirmed or s.pages.length() == 0,
    s' = { ...s, pages: s.savedPages, expectedRevision: s.storedRevision,
      autoSaved: false, userSaved: true, exported: false, output: "none", conflict: false }
  }
  /// User-confirmed deletion retires the stored draft and preserves the open pages.
  action deleteDraft = all {
    not(s.closed or s.saving), s.phase == "review", s.queued.length() == 0,
    s.expectedRevision != 0, s.expectedRevision == s.storedRevision,
    s' = { ...s, storedRevision: 0, expectedRevision: 0, savedPages: [], autoSaved: false, userSaved: false }
  }
  action beginPicker(replacing: bool): bool = all {
    editable, replacing implies s.pages.length() > 0,
    replacing or s.pages.length() < 2,
    s' = { ...s, phase: "picking", picker: s.native, replacing: replacing }
  }
  action picked(valid: bool): bool = all {
    s.phase == "picking", not(s.closed),
    val pages = if (not(valid)) s.pages else if (s.replacing)
      s.pages.replaceAt(0, { image: 2, text: 0 }) else s.pages.append({ image: 2, text: 0 })
    s' = { ...s, phase: "review", picker: false, pages: pages,
      queued: if (valid) queuePages(s.native, s.queued, pages) else s.queued }
  }
  action beginExport = all {
    not(s.closed or s.exported), s.phase == "review", s.pages.length() > 0,
    s' = { ...s, phase: "preparing", exportPages: s.pages, output: "none" }
  }
  action conversionFailed = all {
    s.phase == "preparing", s' = { ...s, phase: "review", output: "conversion-failed" }
  }
  action requestExport = all {
    s.phase == "preparing", not(s.closed),
    s' = { ...s, phase: "exporting", picker: true }
  }
  pure def retryable(outcome: str): bool = outcome.in(Set("cancelled", "failed", "unavailable", "too-large"))
  action exportReply(outcome: str): bool = all {
    s.phase == "exporting", not(s.closed),
    outcome.in(Set("cancelled", "failed", "unavailable", "too-large", "exported", "requested", "unverified")),
    s' = { ...s, phase: "review", picker: false, output: outcome, exported: not(retryable(outcome)) }
  }
  /// A thrown export call may have written a file. The same review stays locked.
  action exportThrew = all {
    s.phase == "exporting", not(s.closed),
    s' = { ...s, phase: "review", picker: false, output: "unverified", exported: true }
  }
  action clearAutoDraft = all {
    s.output == "exported", s.autoSaved, not(s.saving), s.queued.length() == 0,
    s.expectedRevision != 0, s.expectedRevision == s.storedRevision,
    s' = { ...s, storedRevision: 0, expectedRevision: 0, savedPages: [], autoSaved: false }
  }
  /// The system picker may hide the WebView without closing its owning review.
  action hide = if (s.picker) s' = { ...s, hidden: true }
    else s' = { ...s, hidden: true, closed: true, phase: "closed", pages: [],
      queued: [], saving: false, pendingPages: [] }
  action resume = s' = { ...s, hidden: false }
  action close = s' = { ...s, closed: true, phase: "closed", pages: [],
    queued: [], saving: false, pendingPages: [], picker: false }
  action reopen = all { s.closed, s' = { ...s, closed: false, hidden: false,
    phase: "review", exported: false, output: "none", expectedRevision: 0, autoSaved: false } }
  action step = any {
    add(1), add(2), reorder, correct, keepReviewedText, removeFirst, beginAutoSave,
    beginManualSave, saveCommit, saveFailure, competingDraft, loadDraft(true), loadDraft(false),
    deleteDraft, beginPicker(true), beginPicker(false), picked(true), picked(false),
    beginExport, conversionFailed, requestExport, exportReply("cancelled"), exportReply("failed"),
    exportReply("unavailable"), exportReply("too-large"), exportReply("exported"),
    exportReply("requested"), exportReply("unverified"), exportThrew, clearAutoDraft,
    hide, resume, close, reopen, s' = s
  }
  pure def layersMatch(pages: List[Page]): bool = pages.indices().forall(index => pages.nth(index).text == 0 or pages.nth(index).text == pages.nth(index).image)
  val TextStaysWithPage = layersMatch(s.pages) and layersMatch(s.savedPages) and layersMatch(s.exportPages)
  val BoundedDraft = s.pages.length() <= 2 and s.queued.length() <= 2 and s.serial <= 4
  val WriterSerialized = s.saving implies s.pendingPages.length() > 0
  val ImmutableExport = s.phase.in(Set("preparing", "exporting")) implies s.exportPages == s.pages
  val UnknownExportLocked = s.output.in(Set("exported", "requested", "unverified")) and not(s.closed) implies s.exported
  val ClosedNoWriter = s.closed implies not(s.saving)
  val TypeOK = s.phase.in(Set("review", "saving", "picking", "preparing", "exporting", "closed"))
    and s.output.in(Set("none", "conversion-failed", "cancelled", "failed", "unavailable", "too-large", "exported", "requested", "unverified"))
  /// Desired source-comment contract. Current code violates this after explicit save of an auto-draft.
  val ExplicitlySavedDraftPreserved = s.userSaved and s.output == "exported" implies s.storedRevision != 0
  val safety = TypeOK and TextStaysWithPage and BoundedDraft and WriterSerialized and ImmutableExport and UnknownExportLocked and ClosedNoWriter
  run orderedLayersTest = initFor(false).then(add(1)).then(add(2)).then(keepReviewedText)
    .then(reorder).expect(s.pages.head().image == 2 and s.pages.head().text == 2 and safety)
    .then(correct).expect(s.pages.head().image == 3 and s.pages.head().text == 0 and safety)
  run serializedAutosaveTest = initFor(true).then(add(1)).then(add(2)).then(beginAutoSave)
    .then(saveCommit).expect(s.savedPages.length() == 1).then(beginAutoSave).then(saveCommit)
    .expect(s.savedPages.length() == 2 and s.expectedRevision == s.storedRevision and safety)
  run staleCasTest = initFor(false).then(add(1)).then(beginManualSave).then(competingDraft)
    .then(saveFailure).expect(s.conflict and s.pages.head().image == 1 and s.savedPages.head().image == 4 and safety)
  run nativePickerVisibilityTest = initFor(true).then(beginPicker(false)).then(hide)
    .expect(not(s.closed)).then(resume).then(picked(true)).expect(s.pages.length() == 1 and safety)
  run unknownExportTest = initFor(false).then(add(1)).then(beginExport).then(requestExport)
    .then(exportThrew).expect(s.exported and s.output == "unverified" and safety)
  run cancelledExportRetryTest = initFor(false).then(add(1)).then(beginExport).then(requestExport)
    .then(exportReply("cancelled")).then(beginExport).expect(not(s.exported) and safety)
  run exportWaitsForQueuedDraftsTest = initFor(true).then(add(1)).then(add(2))
    .then(beginExport).then(requestExport).then(exportReply("exported"))
    .then(beginAutoSave).then(saveCommit).then(beginAutoSave).then(saveCommit)
    .then(clearAutoDraft).expect(s.storedRevision == 0 and s.exported and safety)
  run automaticDraftCleanupTest = initFor(true).then(add(1)).then(beginAutoSave).then(saveCommit)
    .then(beginExport).then(requestExport).then(exportReply("exported")).then(clearAutoDraft)
    .expect(s.storedRevision == 0 and s.exported and safety)
  /// Current source retains autoSaved through an explicit save of that same draft.
  run explicitSaveAfterAutosaveCounterexampleTest = initFor(true).then(add(1)).then(beginAutoSave).then(saveCommit)
    .then(beginManualSave).then(saveCommit).then(beginExport).then(requestExport)
    .then(exportReply("exported")).then(clearAutoDraft).expect(not(ExplicitlySavedDraftPreserved) and safety)
  run loadedDraftRetainedTest = initFor(false).then(add(1)).then(beginManualSave).then(saveCommit)
    .then(loadDraft(true)).then(beginExport).then(requestExport).then(exportReply("exported"))
    .expect(s.storedRevision != 0 and not(s.autoSaved) and safety)
}
