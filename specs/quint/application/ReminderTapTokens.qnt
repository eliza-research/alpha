// A tapped reminder notification leaves a native token. The renderer opens the exact reminder,
// and consumes the token only after that detail is visible and nothing else happened meanwhile.
module ReminderTapTokens {
  type State = {
    // Native side: the newest pending tap (0 when none), how many taps were issued, whether the
    // tapped reminder is still the exact target, and whether the tap asked a question.
    nativeToken: int, issued: int, retained: bool, targetListed: bool, question: bool,
    lastConsumed: int,
    // Renderer side. stage: "idle" | "read" | "list" | "confirm" | "opened".
    // captured/capturedQuestion: the token the running check read, and whether it asked a question.
    busy: bool, requested: bool, stage: str, captured: int, capturedQuestion: bool,
    interaction: int, interactionAt: int, blocked: bool,
    banner: bool, detail: int, questionOpen: int,
    consumedUnseen: bool, openedWhileBlocked: bool
  }
  var s: State
  action init = s' = { nativeToken: 0, issued: 0, retained: true, targetListed: true, question: false,
    lastConsumed: 0, busy: false, requested: false, stage: "idle", captured: 0, capturedQuestion: false,
    interaction: 0, interactionAt: 0, blocked: false, banner: false, detail: 0, questionOpen: 0,
    consumedUnseen: false, openedWhileBlocked: false }
  // The check still belongs to what the owner is looking at.
  val Current = not(s.blocked) and s.interaction == s.interactionAt
  // A check that ends runs a queued explicit request at once. The request is dropped when the
  // page is blocked or a question review is open; nothing starts it again later.
  pure def finish(state: State): State = {
    pure val idle = { ...state, busy: false, stage: "idle", captured: 0, capturedQuestion: false,
      requested: false }
    if (not(state.requested) or state.blocked or state.questionOpen != 0) idle
    else { ...idle, busy: true, stage: "read", interactionAt: state.interaction }
  }

  action tap(question: bool): bool = all {
    s.issued < 3,
    s' = { ...s, nativeToken: s.issued + 1, issued: s.issued + 1, retained: true,
      targetListed: true, question: question }
  }
  // One check at a time. An explicit request made meanwhile runs once the current check ends.
  action check(explicit: bool): bool = all {
    s.questionOpen == 0,
    if (s.busy) s' = { ...s, requested: s.requested or explicit }
    else all { not(s.blocked),
      s' = { ...s, busy: true, stage: "read", interactionAt: s.interaction } }
  }
  action readPending = all {
    s.stage == "read",
    s' = if (not(Current)) finish(s)
      else if (s.nativeToken == 0) finish({ ...s, banner: false })
      // The original reminder changed: the link is kept and no replacement is opened.
      else if (not(s.retained)) finish({ ...s, banner: true })
      else { ...s, banner: true, stage: "list", captured: s.nativeToken, capturedQuestion: s.question }
  }
  action listed = all {
    s.stage == "list",
    s' = if (not(Current) or not(s.targetListed)) finish(s) else { ...s, stage: "confirm" }
  }
  // The token is read again before anything opens; a newer tap or a changed target stops here.
  action confirm = all {
    s.stage == "confirm", s.interaction < 6,
    s' = if (not(Current) or s.nativeToken != s.captured or not(s.retained)) finish(s)
      else { ...s, stage: "opened", detail: s.captured, interaction: s.interaction + 1,
        interactionAt: s.interaction + 1, openedWhileBlocked: s.openedWhileBlocked or s.blocked }
  }
  // Native consumes only its current token, so a newer queued tap is never consumed here.
  action afterOpen = all {
    s.stage == "opened",
    s' = if (not(Current) or s.detail != s.captured) finish(s)
      else if (s.capturedQuestion) finish({ ...s, questionOpen: s.captured })
      else if (s.nativeToken != s.captured) finish({ ...s, banner: true })
      else finish({ ...s, nativeToken: 0, lastConsumed: s.captured, banner: false,
        consumedUnseen: s.consumedUnseen or s.detail != s.captured })
  }
  // The reviewed question either consumes its own token or releases it for a later tap. It
  // consumes only after reading the token and the reminder again: the page is shown, the detail
  // is still open, and the tap is still for that unchanged, listed reminder.
  action closeQuestion(consume: bool): bool = all {
    s.questionOpen != 0,
    s' = if (consume and not(s.blocked) and s.nativeToken == s.questionOpen and s.retained
          and s.targetListed and s.detail == s.questionOpen)
        { ...s, questionOpen: 0, nativeToken: 0, lastConsumed: s.questionOpen, banner: false }
      else { ...s, questionOpen: 0, banner: s.nativeToken != 0 }
  }
  // Any pointer, key, navigation or Back.
  action interact = all {
    s.interaction < 6, s' = { ...s, interaction: s.interaction + 1, detail: 0 }
  }
  // Hidden page, connection chooser, sensitive context or an open form.
  action setBlocked(value: bool): bool = s' = { ...s, blocked: value }
  action targetChanged = all { s.nativeToken != 0, s' = { ...s, retained: false } }
  action targetUnlisted = all { s.nativeToken != 0, s' = { ...s, targetListed: false } }
  action step = {
    nondet flag = Bool.oneOf()
    any {
      tap(flag), check(flag), readPending, listed, confirm, afterOpen, closeQuestion(flag),
      interact, setBlocked(flag), targetChanged, targetUnlisted, s' = s
    }
  }

  // A token is consumed only after its exact detail was shown.
  val ConsumeAfterVisible = not(s.consumedUnseen)
  // The newest tap is never lost: no pending token means the last issued one was consumed.
  val NewestTapSurvives = (s.issued > 0 and s.nativeToken == 0) implies s.lastConsumed == s.issued
  val TokenIsNewest = s.nativeToken == 0 or s.nativeToken == s.issued
  val SingleCheck = s.busy iff s.stage != "idle"
  val NothingOpensWhileBlocked = not(s.openedWhileBlocked)
  val CapturedOnlyInCheck = (s.captured != 0 implies s.busy) and (s.capturedQuestion implies s.captured != 0)
  val TypeOK = s.stage.in(Set("idle", "read", "list", "confirm", "opened")) and s.issued.in(0.to(3))
    and s.interaction.in(0.to(6)) and s.nativeToken.in(0.to(3))
  val safety = TypeOK and ConsumeAfterVisible and NewestTapSurvives and TokenIsNewest and SingleCheck
    and NothingOpensWhileBlocked and CapturedOnlyInCheck

  val QueuedRecheckWitness = s.requested and s.busy
  val NewerTapDuringCheckWitness = s.captured != 0 and s.nativeToken != s.captured
  val ChangedTargetKeptWitness = s.nativeToken != 0 and not(s.retained) and s.banner
  val QuestionOpenWitness = s.questionOpen != 0
  val ConsumedWitness = s.lastConsumed != 0
  // A newer tap is pending natively, no check is running and none is queued.
  val NewerTapWaitsForOwnerWitness = s.questionOpen != 0 and s.nativeToken != s.questionOpen
    and not(s.busy) and not(s.requested)

  run openAndConsumeTest = init.then(tap(false)).then(check(true)).then(readPending).then(listed)
    .then(confirm).expect(s.detail == 1 and s.nativeToken == 1).then(afterOpen)
    .expect(s.nativeToken == 0 and s.lastConsumed == 1 and not(s.banner) and not(s.busy) and safety)
  // A second notification is tapped while the first is being opened: the first check must not
  // consume the newer token, and the queued request opens it afterwards.
  run newerTapNotConsumedTest = init.then(tap(false)).then(check(true)).then(readPending).then(listed)
    .then(tap(false)).then(check(true)).expect(QueuedRecheckWitness and NewerTapDuringCheckWitness)
    .then(confirm).expect(s.stage == "read" and not(s.requested) and s.nativeToken == 2 and s.detail == 0 and safety)
    .then(readPending).then(listed).then(confirm).then(afterOpen)
    .expect(s.lastConsumed == 2 and s.nativeToken == 0 and safety)
  run newerTapAfterOpenTest = init.then(tap(false)).then(check(true)).then(readPending).then(listed)
    .then(confirm).then(tap(false)).then(afterOpen)
    .expect(s.nativeToken == 2 and s.lastConsumed == 0 and s.banner and safety)
  // The owner did something else before the detail settled: the token stays for later.
  run interactionKeepsTokenTest = init.then(tap(false)).then(check(true)).then(readPending).then(listed)
    .then(confirm).then(interact).then(afterOpen)
    .expect(s.nativeToken == 1 and s.lastConsumed == 0 and not(s.busy) and safety)
  run changedTargetKeepsLinkTest = init.then(tap(false)).then(targetChanged).then(check(true))
    .then(readPending).expect(ChangedTargetKeptWitness and s.detail == 0 and not(s.busy) and safety)
  run blockedCheckDoesNothingTest = init.then(tap(false)).then(setBlocked(true)).then(check(true).fail())
  run questionReleasedTest = init.then(tap(true)).then(check(true)).then(readPending).then(listed)
    .then(confirm).then(afterOpen).expect(QuestionOpenWitness and s.nativeToken == 1)
    .then(check(true).fail())
  // A second tap arrives while the first one's question review opens: its queued check is
  // dropped, the link stays pending and the banner shows it once the review closes.
  run queuedCheckDroppedByQuestionTest = init.then(tap(true)).then(check(true)).then(readPending)
    .then(listed).then(confirm).then(tap(false)).then(check(true)).expect(s.requested)
    .then(afterOpen).expect(NewerTapWaitsForOwnerWitness and safety)
    .then(closeQuestion(true)).expect(s.nativeToken == 2 and s.banner and s.lastConsumed == 0 and safety)
  run queuedCheckDroppedWhileBlockedTest = init.then(tap(false)).then(check(true)).then(readPending)
    .then(check(true)).then(setBlocked(true)).then(listed)
    .expect(not(s.busy) and not(s.requested) and s.nativeToken == 1 and safety)
  run changedReminderKeepsQuestionTokenTest = init.then(tap(true)).then(check(true)).then(readPending)
    .then(listed).then(confirm).then(afterOpen).then(targetChanged).then(closeQuestion(true))
    .expect(s.nativeToken == 1 and s.lastConsumed == 0 and s.banner and safety)
  run questionConsumedTest = init.then(tap(true)).then(check(true)).then(readPending).then(listed)
    .then(confirm).then(afterOpen).then(closeQuestion(true))
    .expect(s.nativeToken == 0 and s.lastConsumed == 1 and safety)
}
