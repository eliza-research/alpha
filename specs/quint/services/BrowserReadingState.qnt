/// Isolated native page extraction, the separate user-reviewed question draft and its
/// empty-excerpt fallback when the page cannot be read in isolation.
module BrowserReadingState {
  type Reading = {
    owner: int, epoch: int, navigation: int, capturedEpoch: int, capturedNavigation: int,
    foreground: bool, isolated: bool, ready: bool, sensitive: bool,
    phase: str, question: bool, token: bool, approved: bool,
    excerpt: int, reviewedExcerpt: int, remaining: int, consumed: int,
    speech: bool, draft: bool, userText: str, sawSensitive: bool
  }
  var s: Reading
  action init = s' = {
    owner: 1, epoch: 0, navigation: 0, capturedEpoch: 0, capturedNavigation: 0,
    foreground: true, isolated: true, ready: false, sensitive: false,
    phase: "idle", question: false, token: false, approved: false,
    excerpt: 0, reviewedExcerpt: 0, remaining: 0, consumed: 0,
    speech: false, draft: false, userText: "none", sawSensitive: false }
  action worldHandshake(authentic: bool): bool = all {
    s.isolated, s.phase == "idle", s' = { ...s, ready: authentic }
  }
  action request(question: bool): bool = all {
    s.phase == "idle", s.foreground, s.isolated, s.ready, not(s.sensitive),
    s' = { ...s, phase: "extracting", question: question, capturedEpoch: s.epoch,
      capturedNavigation: s.navigation, remaining: 2, excerpt: 0, approved: false,
      draft: false, userText: "none" }
  }
  /// Ask about page only: when the page cannot be read in isolation the review opens with an
  /// empty excerpt, and nothing can be approved until the user supplies text.
  action requestQuestionFallback = all {
    s.phase == "idle", s.foreground, not(s.isolated), not(s.sensitive),
    s' = { ...s, phase: "review", question: true, capturedEpoch: s.epoch,
      capturedNavigation: s.navigation, remaining: 2, excerpt: 0, approved: false,
      draft: false, userText: "none" }
  }
  action pasteText(sensitiveText: bool): bool = all {
    s.phase == "review", s.question, s.excerpt == 0,
    s' = { ...s, userText: if (sensitiveText) "sensitive" else "clean" }
  }
  action extracted(blocked: bool): bool = all {
    s.phase == "extracting", s.capturedEpoch == s.epoch, s.capturedNavigation == s.navigation,
    s' = { ...s, phase: if (blocked) "blocked" else "review",
      sensitive: blocked, sawSensitive: s.sawSensitive or blocked, excerpt: if (blocked) 0 else 1 }
  }
  action approve = all {
    s.phase == "review", s.remaining > 0, s.foreground,
    s.capturedEpoch == s.epoch, s.capturedNavigation == s.navigation,
    s.excerpt != 0 or (s.question and s.userText == "clean"),
    s' = { ...s, phase: if (s.question) "draft" else "approved",
      token: not(s.question), approved: not(s.question), reviewedExcerpt: s.excerpt,
      draft: s.question }
  }
  action consume = all {
    s.phase == "approved", s.token, s.approved, s.remaining > 0, s.foreground,
    s.capturedEpoch == s.epoch, s.capturedNavigation == s.navigation,
    s' = { ...s, phase: "speaking", token: false, approved: false,
      consumed: s.consumed + 1, speech: true }
  }
  action tick = all {
    s.remaining > 0,
    s' = { ...s, remaining: s.remaining - 1,
      phase: if (s.remaining == 1) "expired" else s.phase,
      token: s.token and s.remaining > 1, approved: s.approved and s.remaining > 1,
      speech: s.speech and s.remaining > 1 }
  }
  /// Sensitivity is decided per page, so a later page is judged on its own.
  action navigation = all {
    s.navigation < 2,
    s' = { ...s, navigation: s.navigation + 1, phase: "idle", ready: false, sensitive: false, token: false,
      approved: false, speech: false, remaining: 0 }
  }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1,
      phase: "idle", token: false, approved: false, speech: false, remaining: 0 }
  }
  action hide = s' = { ...s, foreground: false, phase: "cancelled", token: false,
    approved: false, speech: false, remaining: 0 }
  action unsupported = s' = { ...s, isolated: false, phase: "idle", ready: false, token: false,
    approved: false, speech: false, remaining: 0 }
  action sensitivePage = s' = { ...s, sensitive: true, sawSensitive: true, phase: "blocked", token: false,
    approved: false, speech: false, excerpt: 0, remaining: 0 }
  action stop = s' = { ...s, phase: "cancelled", token: false, approved: false, speech: false }
  action step = any { worldHandshake(true), worldHandshake(false), request(false), request(true),
    requestQuestionFallback, pasteText(false), pasteText(true), extracted(false), extracted(true), approve,
    consume, tick, navigation, switchOwner, hide, unsupported, sensitivePage, stop, s' = s }
  val ReviewedSpeech = s.speech implies s.excerpt == s.reviewedExcerpt and s.reviewedExcerpt != 0
  val CurrentReading = s.speech or s.token implies s.foreground and s.isolated and not(s.sensitive)
    and s.capturedEpoch == s.epoch and s.capturedNavigation == s.navigation
  val SingleUseToken = not(s.speech and s.token)
  val SensitiveRefused = s.sensitive implies not(s.speech or s.token)
  val DraftHasReviewedContent = s.draft implies (s.question and
    (s.reviewedExcerpt != 0 or s.userText == "clean"))
  val FallbackNeverSpeaks = (s.question and s.excerpt == 0) implies not(s.speech or s.token)
  val TypeOK = s.phase.in(Set("idle", "extracting", "blocked", "review", "draft", "approved", "speaking", "expired", "cancelled")) and s.epoch.in(0.to(2)) and s.navigation.in(0.to(2)) and s.remaining.in(0.to(2)) and s.userText.in(Set("none", "clean", "sensitive"))
  val safety = TypeOK and ReviewedSpeech and CurrentReading and SingleUseToken and SensitiveRefused and
    DraftHasReviewedContent and FallbackNeverSpeaks
  val FallbackDraftWitness = s.draft and s.reviewedExcerpt == 0 and not(s.isolated)
  val ReadableAfterSensitivePageWitness = s.sawSensitive and not(s.sensitive) and s.ready and s.phase == "idle"
  val SensitivePasteHeldWitness = s.phase == "review" and s.userText == "sensitive"
  run readingTest = init.then(worldHandshake(true)).then(request(false)).then(extracted(false)).then(approve)
    .then(consume).expect(s.speech and not(s.token) and s.consumed == 1 and safety)
  run spoofedHandshakeTest = init.then(worldHandshake(false)).expect(not(s.ready) and s.phase == "idle" and safety)
  run sensitiveDocumentTest = init.then(worldHandshake(true)).then(request(false)).then(extracted(true))
    .expect(s.phase == "blocked" and s.excerpt == 0 and safety)
  run expiredReviewTest = init.then(worldHandshake(true)).then(request(false)).then(extracted(false)).then(approve)
    .then(tick).then(tick).expect(not(s.token or s.speech) and safety)
  run pageNavigationCancelsTest = init.then(worldHandshake(true)).then(request(false)).then(extracted(false)).then(approve)
    .then(navigation).expect(not(s.token or s.speech) and safety)
  run questionDraftTest = init.then(worldHandshake(true)).then(request(true)).then(extracted(false)).then(approve)
    .expect(s.draft and not(s.speech or s.token) and safety)
  /// One sensitive page does not stop a later page from being read.
  run sensitiveThenNextPageTest = init.then(worldHandshake(true)).then(request(false)).then(extracted(true))
    .expect(s.sensitive and s.phase == "blocked").then(navigation).expect(not(s.sensitive))
    .then(worldHandshake(true)).then(request(false)).then(extracted(false)).then(approve).then(consume)
    .expect(s.speech and s.sawSensitive and safety)
  run fallbackNeedsUserTextTest = init.then(unsupported).then(requestQuestionFallback)
    .expect(s.phase == "review" and s.excerpt == 0).then(pasteText(true))
    .expect(s.phase == "review" and not(s.draft)).then(pasteText(false)).then(approve)
    .expect(s.draft and s.reviewedExcerpt == 0 and not(s.speech or s.token) and safety)
}
