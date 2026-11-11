/// How the renderer shows and withdraws the native browser page: the poll's request, sent only
/// when it differs from the last one, answers applied only for the latest request, and a
/// presentation failure reported once and retried.
module BrowserSurfacePresentation {
  // 0 withdraws the page; 1 and 2 are two page geometries. -1 forgets the last request so the
  // next poll sends again.
  pure val Hidden = 0
  pure val Forgotten = -1
  type State = {
    inBrowser: bool,
    // A menu, the tab switcher, a dialog, the shade or another layer that must cover the page.
    overlay: bool,
    // The app itself is not visible (a stopped Activity or a hidden document).
    appHidden: bool,
    tabReady: bool, disposed: bool,
    lastRequest: int,
    // Requests the native side has not answered, oldest first.
    unanswered: List[int],
    // The geometry the native side last acknowledged, 0 when none; it positions the page-input block.
    acknowledged: int,
    // What the native side shows.
    native: int,
    // Failures shown to the user, and failures that a later success ended.
    failed: bool, reports: int, recoveries: int
  }
  var s: State
  action init = s' = { inBrowser: false, overlay: false, appHidden: false, tabReady: false, disposed: false,
    lastRequest: Forgotten, unanswered: List(), acknowledged: 0, native: Hidden, failed: false,
    reports: 0, recoveries: 0 }
  val covered = s.overlay or not(s.inBrowser) or not(s.tabReady)
  // A request equal to the last one is not sent again. Withdrawing forgets the acknowledged geometry.
  pure def requested(t: State, payload: int): State =
    if (payload == t.lastRequest) t
    else { ...t, lastRequest: payload, unanswered: t.unanswered.append(payload),
      acknowledged: if (payload == Hidden) 0 else t.acknowledged }
  // The 100 ms poll. A hidden app is left alone: the native side has hidden the page itself, and
  // withdrawing it would end what the page is in the middle of. Off the Browser with the page
  // already withdrawn there is nothing to send.
  action poll(geometry: int): bool = all {
    not(s.disposed), geometry.in(Set(1, 2)), s.unanswered.length() < 3,
    s' = if (s.appHidden or (not(s.inBrowser) and s.lastRequest == Hidden)) s
      else requested(s, if (covered) Hidden else geometry)
  }
  // Leaving the Browser and every render under a covering layer withdraw the page at once, whether
  // or not the app is shown. A tab that is not ready is withdrawn by the poll instead.
  action withdraw = all { not(s.disposed), s.overlay or not(s.inBrowser), s.unanswered.length() < 3,
    s' = requested(s, Hidden) }
  // The native side answers in order. Only the answer to the latest request counts; a failure
  // forgets the request so the next poll sends it again, and is reported once until a success.
  action answer(ok: bool): bool = all {
    s.unanswered.length() > 0,
    val payload = s.unanswered.head()
    val native = if (ok) payload else s.native
    s' = if (s.disposed or s.lastRequest != payload) { ...s, unanswered: s.unanswered.tail(), native: native }
      else if (ok) { ...s, unanswered: s.unanswered.tail(), native: native, failed: false,
        recoveries: if (s.failed) s.recoveries + 1 else s.recoveries,
        acknowledged: if (payload != Hidden) payload else s.acknowledged }
      else { ...s, unanswered: s.unanswered.tail(), native: native, lastRequest: Forgotten, acknowledged: 0,
        failed: true, reports: if (s.failed) s.reports else s.reports + 1 }
  }
  // A visibility change, a resumed page surface, or a dialog closing: the next poll sends again.
  action forget = all { not(s.disposed), s' = { ...s, lastRequest: Forgotten } }
  action enterBrowser = s' = { ...s, inBrowser: true }
  action leaveBrowser = s' = { ...s, inBrowser: false }
  action setOverlay(shown: bool): bool = s' = { ...s, overlay: shown }
  action setAppHidden(hidden: bool): bool = s' = { ...s, appHidden: hidden }
  action tabCreated = s' = { ...s, tabReady: true }
  action dispose = s' = { ...s, disposed: true }
  action step = {
    nondet geometry = Set(1, 2).oneOf()
    nondet flag = Set(false, true).oneOf()
    any { poll(geometry), withdraw, answer(flag), forget, enterBrowser, leaveBrowser, setOverlay(flag),
      setAppHidden(flag), tabCreated, dispose, s' = s }
  }
  // A withdrawn page has no acknowledged geometry left to block input with.
  val WithdrawnHasNoAcknowledgedPage = s.lastRequest == Hidden implies s.acknowledged == 0
  val FailedHasNoAcknowledgedPage = s.failed implies s.acknowledged == 0
  val FailureReportedOncePerEpisode = s.reports == s.recoveries + (if (s.failed) 1 else 0)
  val RequestsAreDistinct = s.unanswered.length() <= 3 and
    (s.unanswered.length() > 0 and s.lastRequest != Forgotten implies s.unanswered.nth(s.unanswered.length() - 1) == s.lastRequest)
  val TypeOK = s.lastRequest.in(Set(Forgotten, Hidden, 1, 2)) and s.acknowledged.in(0.to(2)) and s.native.in(0.to(2))
  val safety = TypeOK and WithdrawnHasNoAcknowledgedPage and FailedHasNoAcknowledgedPage and
    FailureReportedOncePerEpisode and RequestsAreDistinct
  val StaleAnswerPendingWitness = s.unanswered.length() > 1
  val RetryAfterFailureWitness = s.failed and s.unanswered.length() > 0 and s.reports == 1
  // The page stays as it was while the app is hidden, even under a covering layer.
  val KeptWhileAppHiddenWitness = s.appHidden and s.overlay and s.native > 0 and s.lastRequest > 0 and
    s.unanswered.length() == 0
  // An answer to an earlier geometry must not become the acknowledged geometry of a later request.
  run staleAnswerIgnoredTest = init.then(enterBrowser).then(tabCreated).then(poll(1)).then(poll(2))
    .expect(s.unanswered == List(1, 2)).then(answer(true))
    .expect(s.acknowledged == 0 and s.native == 1).then(answer(true))
    .expect(s.acknowledged == 2 and s.native == 2 and safety)
  run overlayWithdrawsTest = init.then(enterBrowser).then(tabCreated).then(poll(1)).then(answer(true))
    .then(setOverlay(true)).then(withdraw).expect(s.acknowledged == 0 and s.lastRequest == Hidden)
    .then(answer(true)).expect(s.native == Hidden).then(poll(1)).expect(s.unanswered.length() == 0 and safety)
  run failureReportedOnceTest = init.then(enterBrowser).then(tabCreated).then(poll(1)).then(answer(false))
    .expect(s.failed and s.reports == 1 and s.lastRequest == Forgotten).then(poll(1)).then(answer(false))
    .expect(s.reports == 1 and safety).then(poll(1)).then(answer(true))
    .expect(not(s.failed) and s.acknowledged == 1 and safety)
  run hiddenAppKeepsPageTest = init.then(enterBrowser).then(tabCreated).then(poll(1)).then(answer(true))
    .then(setAppHidden(true)).then(setOverlay(true)).then(poll(1))
    .expect(s.lastRequest == 1 and s.native == 1 and s.unanswered.length() == 0 and safety)
  run idleOffBrowserTest = init.then(poll(1)).expect(s.unanswered == List(Hidden)).then(answer(true))
    .then(poll(1)).then(poll(2)).expect(s.unanswered.length() == 0 and s.lastRequest == Hidden and safety)
  run sameGeometryNotResentTest = init.then(enterBrowser).then(tabCreated).then(poll(1)).then(poll(1))
    .expect(s.unanswered == List(1)).then(answer(true)).then(forget).then(poll(1))
    .expect(s.unanswered == List(1) and safety)
}
