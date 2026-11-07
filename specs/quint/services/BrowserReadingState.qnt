/// Isolated native page extraction and the separate user-reviewed question draft.
module BrowserReadingState {
  type Reading = {
    owner: int, epoch: int, navigation: int, capturedEpoch: int, capturedNavigation: int,
    foreground: bool, isolated: bool, ready: bool, sensitive: bool,
    phase: str, question: bool, token: bool, approved: bool,
    excerpt: int, reviewedExcerpt: int, remaining: int, consumed: int,
    speech: bool, draft: bool, sent: bool
  }
  var s: Reading
  action init = s' = {
    owner: 1, epoch: 0, navigation: 0, capturedEpoch: 0, capturedNavigation: 0,
    foreground: true, isolated: true, ready: false, sensitive: false,
    phase: "idle", question: false, token: false, approved: false,
    excerpt: 0, reviewedExcerpt: 0, remaining: 0, consumed: 0,
    speech: false, draft: false, sent: false }
  action worldHandshake(authentic: bool): bool = all {
    s.isolated, s.phase == "idle", s' = { ...s, ready: authentic }
  }
  action request(question: bool): bool = all {
    s.phase == "idle", s.foreground, s.isolated, s.ready, not(s.sensitive),
    s' = { ...s, phase: "extracting", question: question, capturedEpoch: s.epoch,
      capturedNavigation: s.navigation, remaining: 2, excerpt: 0, approved: false }
  }
  action extracted(blocked: bool): bool = all {
    s.phase == "extracting", s.capturedEpoch == s.epoch, s.capturedNavigation == s.navigation,
    s' = { ...s, phase: if (blocked) "blocked" else "review",
      sensitive: blocked, excerpt: if (blocked) 0 else 1 }
  }
  action approve = all {
    s.phase == "review", s.remaining > 0, s.foreground,
    s.capturedEpoch == s.epoch, s.capturedNavigation == s.navigation,
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
  action navigation = all {
    s.navigation < 2,
    s' = { ...s, navigation: s.navigation + 1, phase: "idle", ready: false, token: false,
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
  action sensitivePage = s' = { ...s, sensitive: true, phase: "blocked", token: false,
    approved: false, speech: false, excerpt: 0, remaining: 0 }
  action stop = s' = { ...s, phase: "cancelled", token: false, approved: false, speech: false }
  action step = any { worldHandshake(true), worldHandshake(false), request(false), request(true), extracted(false), extracted(true), approve,
    consume, tick, navigation, switchOwner, hide, unsupported, sensitivePage, stop, s' = s }
  val ReviewedSpeech = s.speech implies s.excerpt == s.reviewedExcerpt and s.reviewedExcerpt != 0
  val CurrentReading = s.speech or s.token implies s.foreground and s.isolated and not(s.sensitive)
    and s.capturedEpoch == s.epoch and s.capturedNavigation == s.navigation
  val SingleUseToken = not(s.speech and s.token)
  val SensitiveRefused = s.sensitive implies not(s.speech or s.token)
  val QuestionDoesNotSend = not(s.sent)
  val TypeOK = s.phase.in(Set("idle", "extracting", "blocked", "review", "draft", "approved", "speaking", "expired", "cancelled")) and s.epoch.in(0.to(2)) and s.navigation.in(0.to(2)) and s.remaining.in(0.to(2))
  val safety = TypeOK and ReviewedSpeech and CurrentReading and SingleUseToken and SensitiveRefused and QuestionDoesNotSend
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
    .expect(s.draft and not(s.sent or s.speech or s.token) and safety)
}
