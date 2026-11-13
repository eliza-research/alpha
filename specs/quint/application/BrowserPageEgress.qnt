/// How the selected Browser page leaves the tab: the system share sheet (one at a time, checked
/// again after the menu closed), sharing by email, copying its link, and bookmarking. A private
/// tab stays out of history but may still be shared, copied or bookmarked by the user's own action.
module BrowserPageEgress {
  // Bound on document revisions of the tab.
  pure val MaxRevision = 5
  pure val MaxCount = 3
  pure val Pages = Set("loading", "ready", "failed")
  pure val Shares = Set("idle", "waiting", "native")
  type State = {
    // Whether the tab is private; fixed when it is created.
    priv: bool,
    // The selected tab's page, whether its address is HTTPS, and its document revision.
    page: str, secure: bool, revision: int,
    foreground: bool, inBrowser: bool,
    // The share sheet request: waiting for the menu to close, then held by the native sheet.
    share: str,
    // The revision the request was made for and the revision handed to the native sheet (0: none).
    captured: int, sent: int,
    nativeShares: int, emails: int, copies: int, bookmarkWrites: int, marked: bool,
    // The page entered browsing history; a secure page was committed; any page was committed.
    visited: bool, secureSeen: bool, readySeen: bool,
    // Messages shown.
    loadNotice: bool, changedNotice: bool, emailNotice: bool, bookmarkNotice: bool, failureNotice: bool,
    // Copy link: refused, done, and the clipboard refusing the write.
    copyNotice: bool, copiedNotice: bool, clipboardNotice: bool,
    // A page without HTTPS failed to open.
    insecureNotice: bool
  }
  var s: State
  pure def start(priv: bool): State = { priv: priv, page: "loading", secure: true, revision: 1, foreground: true,
    inBrowser: true, share: "idle", captured: 0, sent: 0, nativeShares: 0, emails: 0, copies: 0, bookmarkWrites: 0, marked: false,
    visited: false, secureSeen: false, readySeen: false, loadNotice: false, changedNotice: false, emailNotice: false,
    bookmarkNotice: false, failureNotice: false, copyNotice: false, copiedNotice: false, clipboardNotice: false,
    insecureNotice: false }
  // The tab's first address has been submitted and is loading.
  action initNormal = s' = start(false)
  action initPrivate = s' = start(true)
  action init = any { initNormal, initPrivate }

  // The page starts another load: a new document revision.
  action startLoad(https: bool): bool = all { s.page != "loading", s.revision < MaxRevision,
    s' = { ...s, page: "loading", secure: https, revision: s.revision + 1 } }
  // Only a normal tab's committed page enters history.
  action commit = all { s.page == "loading",
    s' = { ...s, page: "ready", visited: s.visited or not(s.priv), secureSeen: s.secureSeen or s.secure, readySeen: true } }
  // A page that cannot open says so itself; one without HTTPS also gets a message naming that.
  action loadFails = all { s.page == "loading",
    s' = { ...s, page: "failed", insecureNotice: s.insecureNotice or not(s.secure) } }
  action hide = all { s.foreground, s' = { ...s, foreground: false } }
  action show = all { not(s.foreground), s' = { ...s, foreground: true } }
  action leaveBrowser = all { s.inBrowser, s' = { ...s, inBrowser: false } }
  action returnToBrowser = all { not(s.inBrowser), s' = { ...s, inBrowser: true } }

  // Share: ignored while a share is in progress, refused unless the page is committed and settled.
  action startShare =
    if (s.share != "idle") s' = s
    else if (s.page != "ready") s' = { ...s, loadNotice: true }
    else s' = { ...s, share: "waiting", captured: s.revision }
  // After the menu closed: the same document must still be showing in the foreground Browser.
  action shareDelayEnds = all { s.share == "waiting",
    if (s.foreground and s.inBrowser and s.revision == s.captured and s.nativeShares < MaxCount)
      s' = { ...s, share: "native", sent: s.captured, nativeShares: s.nativeShares + 1 }
    else all { not(s.foreground and s.inBrowser and s.revision == s.captured),
      s' = { ...s, share: "idle", changedNotice: true } } }
  action nativeShareSettles(ok: bool): bool = all { s.share == "native",
    s' = { ...s, share: "idle", failureNotice: s.failureNotice or not(ok) } }
  // Share by email opens a draft with the page address at once, or says why not.
  action shareEmail = all { s.emails < MaxCount,
    if (s.foreground and s.inBrowser and s.page == "ready") s' = { ...s, emails: s.emails + 1 }
    else s' = { ...s, emailNotice: true } }
  // Copy link writes the committed page's address to the clipboard at the tap, or says why not.
  // The clipboard answers before anything else happens.
  action copyLink(ok: bool): bool = all { s.copies < MaxCount,
    if (not(s.foreground and s.inBrowser and s.page == "ready")) s' = { ...s, copyNotice: true }
    else if (ok) s' = { ...s, copies: s.copies + 1, copiedNotice: true }
    else s' = { ...s, clipboardNotice: true } }
  // Bookmark toggles the saved mark of a committed HTTPS page.
  action toggleBookmark = all { s.bookmarkWrites < MaxCount,
    if (s.page == "ready" and s.secure) s' = { ...s, bookmarkWrites: s.bookmarkWrites + 1, marked: not(s.marked) }
    else s' = { ...s, bookmarkNotice: true } }
  action step = {
    nondet flag = Set(true, false).oneOf()
    any { startLoad(flag), commit, loadFails, hide, show, leaveBrowser, returnToBrowser, startShare, shareDelayEnds,
      nativeShareSettles(flag), shareEmail, copyLink(flag), toggleBookmark, s' = s }
  }

  val TypeOK = Pages.contains(s.page) and Shares.contains(s.share) and s.revision.in(1.to(MaxRevision)) and
    s.nativeShares.in(0.to(MaxCount)) and s.emails.in(0.to(MaxCount)) and s.copies.in(0.to(MaxCount)) and
    s.bookmarkWrites.in(0.to(MaxCount))
  // A request in progress was made for a revision that existed, and the native sheet gets that one.
  val ShareBoundToItsRequest = (s.share != "idle" implies (s.captured >= 1 and s.captured <= s.revision)) and
    (s.share == "native" implies s.sent == s.captured) and (s.sent > 0 iff s.nativeShares > 0)
  val PrivateTabStaysOutOfHistory = s.priv implies not(s.visited)
  val BookmarkNeedsSecurePage = (s.marked or s.bookmarkWrites > 0) implies s.secureSeen
  val EmailNeedsCommittedPage = s.emails > 0 implies s.readySeen
  val ShareNeedsCommittedPage = s.nativeShares > 0 implies s.readySeen
  val CopyNeedsCommittedPage = (s.copies > 0 or s.clipboardNotice) implies s.readySeen
  val CopiedNoticeNeedsCopy = s.copiedNotice iff s.copies > 0
  val safety = TypeOK and ShareBoundToItsRequest and PrivateTabStaysOutOfHistory and BookmarkNeedsSecurePage and
    EmailNeedsCommittedPage and ShareNeedsCommittedPage and CopyNeedsCommittedPage and CopiedNoticeNeedsCopy

  val SharedWitness = s.nativeShares > 0 and s.share == "idle" and not(s.failureNotice)
  val PageChangedBeforeShareWitness = s.changedNotice
  val PageMovedUnderShareSheetWitness = s.share == "native" and s.nativeShares == 1 and s.revision > s.sent
  // Current behaviour: a private page's address can be saved as a bookmark, put in an email draft
  // and copied without a further confirmation; opening it in another browser is the reviewed path.
  val PrivatePageBookmarkedWitness = s.priv and s.marked
  val PrivatePageEmailedWitness = s.priv and s.emails > 0
  val PrivatePageCopiedWitness = s.priv and s.copies > 0
  val InsecurePageFailedWitness = s.insecureNotice and s.page == "failed"

  run shareWaitsForMenuTest = initNormal.then(commit).then(startShare)
    .expect(s.share == "waiting" and s.nativeShares == 0 and safety)
    .then(startShare).expect(s.share == "waiting" and s.captured == 1)
    .then(shareDelayEnds).expect(s.share == "native" and s.sent == 1 and s.nativeShares == 1 and safety)
    .then(startShare).expect(s.nativeShares == 1 and not(s.loadNotice))
    .then(nativeShareSettles(true)).expect(s.share == "idle" and not(s.failureNotice) and safety)
  run navigationDuringDelayRefusesTest = initNormal.then(commit).then(startShare).then(startLoad(true)).then(commit)
    .then(shareDelayEnds)
    .expect(s.share == "idle" and s.changedNotice and s.nativeShares == 0 and safety)
  run hiddenDuringDelayRefusesTest = initNormal.then(commit).then(startShare).then(hide).then(shareDelayEnds)
    .expect(s.share == "idle" and s.changedNotice and s.nativeShares == 0 and safety)
    .then(show).then(startShare).then(shareDelayEnds).expect(s.share == "native" and safety)
  run unloadedPageRefusesEveryEgressTest = initNormal.then(startShare).then(shareEmail).then(toggleBookmark)
    .then(copyLink(true))
    .expect(s.loadNotice and s.emailNotice and s.bookmarkNotice and s.copyNotice and s.share == "idle" and
      s.emails == 0 and s.copies == 0 and s.bookmarkWrites == 0 and safety)
  run insecurePageIsNotBookmarkedTest = initNormal.then(commit).then(startLoad(false)).then(commit).then(toggleBookmark)
    .expect(s.bookmarkNotice and not(s.marked) and safety)
    .then(shareEmail).expect(s.emails == 1 and safety)
  run privateTabEgressTest = initPrivate.then(commit).then(toggleBookmark).then(shareEmail)
    .expect(s.marked and s.emails == 1 and not(s.visited) and safety)
  run copyLinkNeedsShownPageTest = initNormal.then(commit).then(leaveBrowser).then(copyLink(true))
    .expect(s.copyNotice and s.copies == 0 and safety)
    .then(returnToBrowser).then(copyLink(false)).expect(s.clipboardNotice and s.copies == 0 and safety)
    .then(copyLink(true)).expect(s.copies == 1 and s.copiedNotice and safety)
  run insecurePageFailureIsExplainedTest = initNormal.then(commit).then(startLoad(true)).then(loadFails)
    .expect(s.page == "failed" and not(s.insecureNotice) and safety)
    .then(startLoad(false)).then(loadFails).expect(s.insecureNotice and safety)
  run failedShareIsReportedTest = initNormal.then(commit).then(startShare).then(shareDelayEnds)
    .then(nativeShareSettles(false))
    .expect(s.share == "idle" and s.failureNotice and safety)
}
