/// The four scan review dialogs as independent small machines: the text review with its
/// one-shot Notes save, retryable PDF export and Keep photo; the searchable review; the
/// page correction preview; and the page capture dialog over a camera that may stop.
module ScanReviewDialogs {
  type Text = { ocr: str, closed: bool, attempted: bool, saveCalls: int, saved: str,
    pdfAttempted: bool, pdfCalls: int, pdfLocked: bool, keep: str, keepCalls: int, keepRetries: int, document: bool }
  type Searchable = { ready: bool, busy: bool, requested: bool, closed: bool, result: str, requestedAtClose: bool }
  type Correction = { busy: str, corners: int, preview: int, corrected: bool, closed: bool, applied: int }
  type Capture = { stream: str, busy: bool, blob: bool, blobWhenEnded: bool, closed: bool, result: str }
  type State = { text: Text, searchable: Searchable, correction: Correction, capture: Capture }
  var s: State
  action init = s' = {
    text: { ocr: "starting", closed: false, attempted: false, saveCalls: 0, saved: "none",
      pdfAttempted: false, pdfCalls: 0, pdfLocked: false, keep: "idle", keepCalls: 0, keepRetries: 0, document: false },
    searchable: { ready: false, busy: false, requested: false, closed: false, result: "none", requestedAtClose: false },
    correction: { busy: "none", corners: 0, preview: -1, corrected: false, closed: false, applied: -1 },
    capture: { stream: "starting", busy: false, blob: false, blobWhenEnded: false, closed: false, result: "none" }
  }
  // Text review.
  action ocrSettled(ok: bool): bool = all { s.text.ocr == "starting", not(s.text.closed),
    s' = { ...s, text: { ...s.text, ocr: if (ok) "ready" else "failed" } } }
  // Save to Notes runs once per review. An unconfirmed save stays latched: the text may already be saved.
  action saveToNotes = all { s.text.ocr == "ready", not(s.text.closed), not(s.text.attempted),
    s' = { ...s, text: { ...s.text, attempted: true, saveCalls: s.text.saveCalls + 1, saved: "pending" } } }
  action notesSettled(saved: bool): bool = all { s.text.saved == "pending",
    s' = { ...s, text: { ...s.text, saved: if (saved) "saved" else "unconfirmed" } } }
  // The photo PDF can be asked for again only after a result that confirms nothing was written.
  action exportPhotoPdf = all { not(s.text.closed), not(s.text.pdfAttempted), s.text.pdfCalls < 3,
    s' = { ...s, text: { ...s.text, pdfAttempted: true, pdfCalls: s.text.pdfCalls + 1 } } }
  action photoPdfSettled(retryable: bool): bool = all { s.text.pdfAttempted, not(s.text.pdfLocked),
    s' = { ...s, text: if (s.text.closed) { ...s.text, pdfLocked: true }
      else { ...s.text, pdfAttempted: not(retryable), pdfLocked: not(retryable) } } }
  // Keep photo can be pressed again only after a failure the host marks retryable: it kept
  // nothing, or it resolves the retry against the same operation. A result after close is dropped.
  action keepPhoto = all { not(s.text.closed), s.text.keep == "idle", s.text.keepCalls < 3,
    s' = { ...s, text: { ...s.text, keep: "pending", keepCalls: s.text.keepCalls + 1 } } }
  action keepSettled(outcome: str): bool = all { s.text.keep == "pending", not(s.text.closed),
    Set("saved", "retryable", "unconfirmed").contains(outcome),
    s' = { ...s, text: if (outcome == "retryable") { ...s.text, keep: "idle", keepRetries: s.text.keepRetries + 1 }
      else { ...s.text, keep: outcome } } }
  action buildDocument = all { not(s.text.closed), s' = { ...s, text: { ...s.text, document: true } } }
  // Back is left to an open document dialog; every other close ends the review and its document.
  action textBack = all { not(s.text.closed),
    s' = if (s.text.document) { ...s, text: { ...s.text, document: false } }
      else { ...s, text: { ...s.text, closed: true } } }
  action textClose = all { not(s.text.closed), s' = { ...s, text: { ...s.text, closed: true, document: false } } }
  // Searchable review.
  action recognised = all { not(s.searchable.closed), s' = { ...s, searchable: { ...s.searchable, ready: true } } }
  action keepText = all { s.searchable.ready, not(s.searchable.busy), not(s.searchable.closed),
    s' = { ...s, searchable: { ...s.searchable, closed: true, result: "reviewed" } } }
  action download = all { s.searchable.ready, not(s.searchable.busy), not(s.searchable.closed),
    s' = { ...s, searchable: { ...s.searchable, busy: true, requested: false } } }
  action providerAsked = all { s.searchable.busy, not(s.searchable.requested), not(s.searchable.closed),
    s' = { ...s, searchable: { ...s.searchable, requested: true } } }
  action prepareFailed = all { s.searchable.busy, not(s.searchable.requested), not(s.searchable.closed),
    s' = { ...s, searchable: { ...s.searchable, busy: false } } }
  action providerSettled(outcome: str): bool = all { s.searchable.busy, s.searchable.requested, not(s.searchable.closed),
    Set("cancelled", "exported", "failed").contains(outcome),
    s' = { ...s, searchable: if (outcome == "cancelled") { ...s.searchable, busy: false, requested: false }
      else { ...s.searchable, closed: true, result: outcome, requestedAtClose: true } } }
  action searchableClose = all { not(s.searchable.closed),
    s' = { ...s, searchable: { ...s.searchable, closed: true, requestedAtClose: s.searchable.requested,
      result: if (s.searchable.busy and s.searchable.requested) "unconfirmed" else "none" } } }
  // Correction: any corner change discards the preview, and only a current preview can be applied.
  action moveCorner = all { s.correction.busy == "none", not(s.correction.closed), s.correction.corners < 3,
    s' = { ...s, correction: { ...s.correction, corners: s.correction.corners + 1, corrected: false, preview: -1 } } }
  action beginWork(kind: str): bool = all { Set("detect", "preview").contains(kind), s.correction.busy == "none",
    not(s.correction.closed),
    s' = { ...s, correction: { ...s.correction, busy: kind,
      corrected: if (kind == "preview") false else s.correction.corrected,
      preview: if (kind == "preview") -1 else s.correction.preview } } }
  action workSettled(ok: bool): bool = all { s.correction.busy != "none", not(s.correction.closed),
    s' = { ...s, correction: if (not(ok)) { ...s.correction, busy: "none" }
      else if (s.correction.busy == "detect" and s.correction.corners < 3)
        { ...s.correction, busy: "none", corners: s.correction.corners + 1, corrected: false, preview: -1 }
      else if (s.correction.busy == "detect") { ...s.correction, busy: "none" }
      else { ...s.correction, busy: "none", corrected: true, preview: s.correction.corners } } }
  action applyCorrection = all { s.correction.corrected, s.correction.busy == "none", not(s.correction.closed),
    s' = { ...s, correction: { ...s.correction, closed: true, applied: s.correction.preview } } }
  action correctionClose = all { not(s.correction.closed),
    s' = { ...s, correction: { ...s.correction, closed: true, busy: "none" } } }
  // Capture: the reviewed frame is kept when the camera stops; only a live camera can retake.
  action cameraStarted(ok: bool): bool = all { s.capture.stream == "starting", not(s.capture.closed),
    s' = { ...s, capture: { ...s.capture, stream: if (ok) "live" else "none" } } }
  action cameraEnded = all { s.capture.stream == "live", not(s.capture.closed),
    s' = { ...s, capture: { ...s.capture, stream: "ended", blobWhenEnded: s.capture.blob } } }
  action capturePage = all { s.capture.stream == "live", not(s.capture.busy), not(s.capture.blob), not(s.capture.closed),
    s' = { ...s, capture: { ...s.capture, busy: true } } }
  action frameEncoded(ok: bool): bool = all { s.capture.busy, not(s.capture.closed),
    s' = { ...s, capture: { ...s.capture, busy: false, blob: ok } } }
  action retake = all { s.capture.blob, s.capture.stream == "live", not(s.capture.closed),
    s' = { ...s, capture: { ...s.capture, blob: false } } }
  action usePage = all { s.capture.blob, not(s.capture.closed),
    s' = { ...s, capture: { ...s.capture, closed: true, result: "page" } } }
  action captureClose = all { not(s.capture.closed),
    s' = { ...s, capture: { ...s.capture, closed: true, busy: false, blob: false } } }
  action step = {
    nondet flag = Bool.oneOf()
    nondet kind = Set("detect", "preview").oneOf()
    nondet outcome = Set("cancelled", "exported", "failed").oneOf()
    nondet kept = Set("saved", "retryable", "unconfirmed").oneOf()
    any { ocrSettled(flag), saveToNotes, notesSettled(flag), exportPhotoPdf, photoPdfSettled(flag), keepPhoto, keepSettled(kept),
      buildDocument, textBack, textClose, recognised, keepText, download, providerAsked, prepareFailed,
      providerSettled(outcome), searchableClose, moveCorner, beginWork(kind), workSettled(flag),
      applyCorrection, correctionClose, cameraStarted(flag), cameraEnded, capturePage, frameEncoded(flag),
      retake, usePage, captureClose, s' = s }
  }
  val NotesSavedOnce = s.text.saveCalls.in(Set(0, 1)) and (s.text.saved != "none" implies s.text.attempted)
  val KeepRetryNeedsRetryableFailure = s.text.keepCalls <= s.text.keepRetries + 1
  val PdfRetryNeedsNonWrite = s.text.pdfLocked implies s.text.pdfAttempted
  val DocumentNeedsOpenReview = s.text.document implies not(s.text.closed)
  val UnconfirmedNeedsProviderRequest = s.searchable.result == "unconfirmed" implies s.searchable.requestedAtClose
  val SearchableResultNeedsReadyText = s.searchable.result.in(Set("reviewed", "exported", "failed", "unconfirmed")) implies s.searchable.ready
  val PreviewMatchesCorners = s.correction.corrected implies s.correction.preview == s.correction.corners
  val AppliedCorrectionWasPreviewed = s.correction.applied != -1 implies s.correction.applied == s.correction.corners
  val UsedPageWasReviewed = s.capture.result == "page" implies s.capture.blob
  val StoppedCameraKeepsCapture = (s.capture.stream == "ended" and s.capture.blobWhenEnded and not(s.capture.closed)) implies s.capture.blob
  val safety = NotesSavedOnce and KeepRetryNeedsRetryableFailure and PdfRetryNeedsNonWrite and DocumentNeedsOpenReview
    and UnconfirmedNeedsProviderRequest and SearchableResultNeedsReadyText and PreviewMatchesCorners
    and AppliedCorrectionWasPreviewed and UsedPageWasReviewed and StoppedCameraKeepsCapture
  val UnconfirmedNotesSaveWitness = s.text.saved == "unconfirmed" and not(s.text.closed)
  val PdfRetriedWitness = s.text.pdfCalls == 2
  val KeepRetriedWitness = s.text.keepCalls == 2 and s.text.keep == "saved"
  val ClosedWhilePreparingWitness = s.searchable.closed and s.searchable.busy and not(s.searchable.requestedAtClose)
  val StalePreviewDiscardedWitness = s.correction.corners > 0 and not(s.correction.corrected) and s.correction.busy == "none"
  val CaptureAfterCameraStoppedWitness = s.capture.stream == "ended" and s.capture.blob and not(s.capture.closed)
  run unconfirmedNotesSaveStaysLatchedTest = init.then(ocrSettled(true)).then(saveToNotes).then(notesSettled(false))
    .expect(s.text.attempted and s.text.saved == "unconfirmed" and s.text.saveCalls == 1 and safety)
  run unconfirmedKeepStaysOffTest = init.then(keepPhoto).then(keepSettled("retryable")).then(keepPhoto)
    .then(keepSettled("unconfirmed"))
    .expect(s.text.keepCalls == 2 and s.text.keep == "unconfirmed" and safety)
  run retryablePdfUnlocksTest = init.then(exportPhotoPdf).then(photoPdfSettled(true)).then(exportPhotoPdf)
    .then(photoPdfSettled(false)).expect(s.text.pdfCalls == 2 and s.text.pdfLocked and safety)
  /// Closing while the PDF is still being prepared reports nothing; after the request it is unconfirmed.
  run searchableCloseOutcomesTest = init.then(recognised).then(download).then(searchableClose)
    .expect(s.searchable.result == "none" and safety)
  run searchableCloseAfterRequestTest = init.then(recognised).then(download).then(providerAsked).then(searchableClose)
    .expect(s.searchable.result == "unconfirmed" and safety)
  run cornerChangeDiscardsPreviewTest = init.then(beginWork("preview")).then(workSettled(true))
    .expect(s.correction.corrected and safety).then(moveCorner).expect(not(s.correction.corrected) and safety)
    .then(beginWork("preview")).then(workSettled(true)).then(applyCorrection)
    .expect(s.correction.applied == 1 and safety)
  /// The camera stops after a page was captured: the capture stays and can still be used.
  run stoppedCameraKeepsCaptureTest = init.then(cameraStarted(true)).then(capturePage).then(frameEncoded(true))
    .then(cameraEnded).expect(s.capture.blob and s.capture.stream == "ended" and safety).then(usePage)
    .expect(s.capture.result == "page" and safety)
  run backClosesDocumentFirstTest = init.then(buildDocument).then(textBack)
    .expect(not(s.text.closed) and not(s.text.document) and safety).then(textBack)
    .expect(s.text.closed and safety)
}
