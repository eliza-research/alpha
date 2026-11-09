/// Native download review, exact-origin cookies, captured bytes and MediaStore publication.
module BrowserDownloads {
  type Download = {
    privateTab: bool, tabOpen: bool, navigation: int, reviewedNavigation: int,
    phase: str, kind: str, sourceOrigin: int, targetOrigin: int,
    cookie: bool, cookieSent: bool, reviewed: bool, entry: bool,
    persisted: bool, pendingFile: bool, published: bool, completed: bool,
    cancelled: bool, redirects: int, captureToken: int, nextChunk: int,
    chunks: int
  }
  var s: Download
  action initFor(privateTab: bool): bool = s' = {
    privateTab: privateTab, tabOpen: true, navigation: 0, reviewedNavigation: 0,
    phase: "idle", kind: "none", sourceOrigin: 1, targetOrigin: 1,
    cookie: false, cookieSent: false, reviewed: false, entry: false,
    persisted: false, pendingFile: false, published: false, completed: false,
    cancelled: false, redirects: 0, captureToken: 1, nextChunk: 0,
    chunks: 0 }
  action init = {
    nondet privateTab = Set(false, true).oneOf()
    initFor(privateTab)
  }
  action request(kind: str): bool = all {
    s.phase == "idle", s.tabOpen, kind.in(Set("public", "signed", "blob", "data")),
    s' = { ...s, kind: kind, phase: if (kind == "blob") "capturing" else "review",
      cookie: kind == "signed", pendingFile: kind.in(Set("blob", "data")),
      reviewedNavigation: s.navigation }
  }
  /// Only the expected isolated main-frame nonce and next chunk may append bytes.
  action chunk(token: int, index: int): bool = all {
    s.phase == "capturing", s.chunks < 2,
    if (token != s.captureToken) s' = s
    else if (index == s.nextChunk)
      s' = { ...s, nextChunk: s.nextChunk + 1, chunks: s.chunks + 1, pendingFile: true }
    else s' = { ...s, phase: "failed", nextChunk: 0, chunks: 0, pendingFile: false }
  }
  action captureDone = all {
    s.phase == "capturing",
    s' = { ...s, phase: "review" }
  }
  action approve = all {
    s.phase == "review", s.tabOpen, s.reviewedNavigation == s.navigation,
    s' = { ...s, reviewed: true, entry: true,
      phase: if (s.kind == "public") "queued" else if (s.kind == "signed") "fetching" else "publishing",
      persisted: s.kind == "public" and not(s.privateTab) }
  }
  action requestHop = all {
    s.phase == "fetching", not(s.cancelled),
    s' = { ...s, cookieSent: s.targetOrigin == s.sourceOrigin and s.cookie }
  }
  action redirect(origin: int): bool = all {
    s.phase == "fetching", not(s.cancelled), s.redirects < 2, origin.in(Set(1, 2)),
    s' = { ...s, targetOrigin: origin, redirects: s.redirects + 1, cookieSent: false }
  }
  action response = all {
    s.phase == "fetching", not(s.cancelled),
    s' = { ...s, phase: "publishing", pendingFile: true, cookieSent: false }
  }
  action publish = all {
    s.phase == "publishing", not(s.cancelled), s.reviewed,
    s' = { ...s, phase: "completed", pendingFile: false, published: true,
      completed: true, persisted: s.entry and not(s.privateTab) }
  }
  /// DownloadManager completion is learned from the actual provider row.
  action osReceipt(success: bool): bool = all {
    s.phase == "queued",
    s' = { ...s, phase: if (success) "completed" else "failed",
      completed: success, published: success }
  }
  action navigate = all {
    s.navigation < 2,
    s' = { ...s, navigation: s.navigation + 1,
      phase: if (s.phase.in(Set("review", "capturing"))) "cancelled" else s.phase,
      pendingFile: if (s.phase.in(Set("review", "capturing"))) false else s.pendingFile }
  }
  action cancel = all {
    s.phase != "publishing" or s.kind == "signed",
    s' = { ...s, phase: "cancelled", cancelled: true, entry: false,
      persisted: false, pendingFile: false, cookieSent: false }
  }
  action closeTab = s' = { ...s, tabOpen: false,
    entry: s.entry and not(s.privateTab), persisted: s.persisted and not(s.privateTab),
    phase: if (s.phase.in(Set("review", "capturing")) or
      s.privateTab and s.kind == "signed" and s.phase.in(Set("fetching", "publishing"))) "cancelled" else s.phase,
    cancelled: s.cancelled or s.privateTab and s.kind == "signed" and s.phase.in(Set("fetching", "publishing")),
    pendingFile: if (s.phase.in(Set("review", "capturing")) or s.privateTab and s.kind == "signed") false else s.pendingFile,
    cookieSent: false }
  action clearHistory = s' = { ...s, entry: false, persisted: false, cookieSent: false,
    cancelled: s.cancelled or s.kind == "signed" and s.phase.in(Set("fetching", "publishing")),
    phase: if (s.kind == "signed" and s.phase.in(Set("fetching", "publishing"))) "cancelled" else s.phase,
    pendingFile: if (s.kind == "signed" and s.phase.in(Set("fetching", "publishing"))) false else s.pendingFile }
  action failedCopy = all {
    s.phase == "publishing", s' = { ...s, phase: "failed", pendingFile: false,
      cookieSent: false, persisted: s.entry and not(s.privateTab) }
  }
  action networkFailure = all {
    s.phase == "fetching",
    s' = { ...s, phase: "failed", cookieSent: false, persisted: s.entry and not(s.privateTab) }
  }
  action restart = s' = { ...s, tabOpen: false,
    entry: s.persisted, cookie: false, cookieSent: false,
    phase: if (s.phase.in(Set("fetching", "publishing", "capturing", "review"))) "cancelled" else s.phase,
    pendingFile: false }
  action step = any {
    request("public"), request("signed"), request("blob"), request("data"),
    chunk(1, s.nextChunk), chunk(0, s.nextChunk), chunk(1, 3), captureDone,
    approve, requestHop, redirect(1), redirect(2), response, publish, osReceipt(true),
    osReceipt(false), navigate, cancel, closeTab, clearHistory, failedCopy, networkFailure, restart, s' = s
  }
  val CookieOrigin = s.cookieSent implies s.targetOrigin == s.sourceOrigin and s.kind == "signed" and not(s.cancelled)
  val PrivateListNeverPersisted = s.privateTab implies not(s.persisted)
  val ReviewedPublication = s.published implies s.reviewed
  val CompletedFromEvidence = s.completed implies s.published and not(s.pendingFile)
  val CapturedBytesOrdered = s.nextChunk == s.chunks and s.chunks <= 2
  val CancelledCaptureCleaned = s.phase == "cancelled" implies not(s.pendingFile)
  val TypeOK = s.phase.in(Set("idle", "capturing", "review", "queued", "fetching", "publishing", "completed", "failed", "cancelled")) and s.kind.in(Set("none", "public", "signed", "blob", "data")) and s.redirects.in(0.to(2)) and s.navigation.in(0.to(2))
  val safety = TypeOK and CookieOrigin and PrivateListNeverPersisted and ReviewedPublication and CompletedFromEvidence and CapturedBytesOrdered and CancelledCaptureCleaned
  run redirectCookieTest = initFor(false).then(request("signed")).then(approve).then(requestHop)
    .expect(s.cookieSent).then(redirect(2)).then(requestHop).expect(not(s.cookieSent))
    .then(response).then(publish).expect(s.completed and s.persisted and safety)
  run privateFetchCloseTest = initFor(true).then(request("signed")).then(approve).then(requestHop)
    .then(closeTab).expect(s.cancelled and not(s.entry or s.persisted or s.pendingFile) and safety)
  run privateFileRemainsTest = initFor(true).then(request("data")).then(approve).then(publish)
    .then(closeTab).expect(s.published and not(s.entry or s.persisted) and safety)
  run capturedChunkTest = initFor(false).then(request("blob")).then(chunk(0, 0))
    .expect(s.chunks == 0).then(chunk(1, 0)).then(captureDone).then(approve).then(failedCopy).expect(not(s.pendingFile or s.published) and safety)
  run outOfOrderChunkTest = initFor(false).then(request("blob")).then(chunk(1, 0))
    .then(chunk(1, 0)).expect(s.phase == "failed" and not(s.pendingFile) and safety)
  run emptyBlobTest = initFor(false).then(request("blob")).then(captureDone)
    .then(approve).then(publish).expect(s.published and s.chunks == 0 and safety)
  run publicTransferOutlivesTabTest = initFor(false).then(request("public")).then(approve)
    .then(closeTab).then(osReceipt(true)).expect(s.completed and safety)
}
