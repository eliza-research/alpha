// One SMS thread: unread state, owner draft, agent-suggested reply and owner-tapped reviewed send.
module MessageThreads {
  type State = {
    ready: bool, open: bool,
    inbound: int, readThrough: int, answered: int,
    draft: str, draftText: int, draftBase: int,
    suggest: str, suggestTicket: int, declined: int,
    review: str, reviewText: int,
    taps: int, sends: int, outcome: str, uncertain: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    ready: false, open: false,
    inbound: 0, readThrough: 0, answered: 0,
    draft: "none", draftText: 0, draftBase: -1,
    suggest: "idle", suggestTicket: -1, declined: -1,
    review: "none", reviewText: -1,
    taps: 0, sends: 0, outcome: "none", uncertain: false
  }
  // ready = verified image, SMS role and permission, unlocked and in front.
  action becomeReady = s' = {ready: true, ...s}
  action loseReady = s' = {
    ready: false, open: false, suggest: "idle",
    review: if (s.review == "showing") "none" else s.review, ...s}
  action openThread = all { s.ready, s' = {open: true, readThrough: s.inbound, ...s} }
  action closeThread = all { s.open, s.review != "showing", s' = {open: false, ...s} }
  // A new inbound message retires an untouched agent suggestion; an owner draft is never touched.
  action receive = all {
    s.inbound < 3,
    s' = {inbound: s.inbound + 1,
      readThrough: if (s.open and s.ready) s.inbound + 1 else s.readThrough,
      draft: if (s.draft == "agent") "none" else s.draft,
      draftBase: if (s.draft == "agent") -1 else s.draftBase,
      uncertain: if (s.draft == "agent") false else s.uncertain,
      suggest: "idle",
      review: if (s.review == "showing" and s.draft == "agent") "none" else s.review, ...s}
  }
  // The agent drafts only for an unanswered inbound message and only into an empty composer, and
  // never again for a message whose suggestion the owner dismissed or rewrote.
  action requestSuggestion = all {
    s.ready, s.inbound > s.answered, s.draft == "none", s.suggest == "idle", s.inbound != s.declined,
    s' = {suggest: "running", suggestTicket: s.inbound, ...s}
  }
  action suggestionReply(ticket: int, ok: bool): bool =
    if (s.suggest == "running" and ticket == s.suggestTicket and ticket == s.inbound and s.draft == "none" and s.ready)
      s' = if (ok) {suggest: "idle", draft: "agent", draftBase: ticket, draftText: 0, ...s}
        else {suggest: "failed", ...s}
    else if (s.suggest == "running" and ticket == s.suggestTicket) s' = {suggest: "idle", ...s}
    else s' = s
  action dismissSuggestion = all {
    s.draft == "agent", s.review != "showing", s' = {draft: "none", draftBase: -1, declined: s.draftBase, uncertain: false, ...s}
  }
  // Typing takes ownership; a running suggestion can no longer land.
  action typeText = all {
    s.ready, s.open, s.review != "showing",
    s' = {draft: "owner", draftText: 1 - s.draftText, draftBase: -1, suggest: "idle",
      declined: if (s.draft == "agent") s.draftBase else s.declined, uncertain: false, ...s}
  }
  action clearDraft = all {
    s.draft == "owner", s.review != "showing", s' = {draft: "none", draftBase: -1, uncertain: false, ...s}
  }
  // The owner's send tap opens the native review of the exact text.
  action tapSend = all {
    s.ready, s.draft != "none", s.review == "none",
    s' = {review: "showing", reviewText: s.draftText, taps: s.taps + 1, open: true,
      readThrough: s.inbound, ...s}
  }
  action cancelReview = all { s.review == "showing", s' = {review: "none", ...s} }
  action confirmReview(result: str): bool = all {
    s.ready, s.review == "showing", s.reviewText == s.draftText, s.draft != "none",
    result.in(Set("sent", "failed", "unknown")),
    // An unknown outcome keeps the draft bound to the same operation: confirming it again reads that
    // operation back and never hands a second copy to the radio.
    s' = if (s.uncertain)
        (if (result == "unknown") {review: "none", ...s}
         else if (result == "failed") {review: "none", outcome: "failed", uncertain: false, ...s}
         else {review: "none", outcome: "sent", uncertain: false, draft: "none", draftBase: -1, answered: s.inbound, ...s})
      else if (result == "failed") {review: "none", outcome: "failed", sends: s.sends + 1, ...s}
      else if (result == "unknown") {review: "none", outcome: "unknown", sends: s.sends + 1, uncertain: true, ...s}
      else {review: "none", outcome: "sent", sends: s.sends + 1, draft: "none", draftBase: -1,
        answered: s.inbound, ...s}
  }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet ticket = Set(-1, 0, 1, 2, 3).oneOf()
    nondet result = Set("sent", "failed", "unknown").oneOf()
    any { becomeReady, loseReady, openThread, closeThread, receive, requestSuggestion,
      suggestionReply(ticket, flag), dismissSuggestion, typeText, clearDraft, tapSend, cancelReview,
      confirmReview(result), s' = s }
  }
  val unread = s.inbound - s.readThrough
  val SendNeedsOwnerTap = s.sends <= s.taps
  val SuggestionCurrent = s.draft == "agent" implies s.draftBase == s.inbound and s.inbound > s.answered
  val OwnerDraftKept = s.draft == "owner" implies s.draftBase == -1
  val ReviewShowsDraft = s.review == "showing" implies s.draft != "none" and s.reviewText == s.draftText and s.ready
  val UnreadBounded = unread >= 0 and s.answered <= s.inbound
  val OpenIsRead = s.open implies s.ready and unread == 0
  val SuggestOnlyWhenEmpty = s.suggest == "running" implies s.draft == "none" and s.ready
  val DeclinedIsNotSuggested = s.draft == "agent" implies s.draftBase != s.declined
  val UncertainKeepsDraft = s.uncertain implies s.draft != "none" and s.sends > 0
  val safety = SendNeedsOwnerTap and SuggestionCurrent and OwnerDraftKept and ReviewShowsDraft and
    UnreadBounded and OpenIsRead and SuggestOnlyWhenEmpty and DeclinedIsNotSuggested and UncertainKeepsDraft

  run suggestionSentAfterTapTest = init.then(becomeReady).then(receive).then(requestSuggestion)
    .then(suggestionReply(1, true)).then(check(s.draft == "agent" and s.sends == 0))
    .then(tapSend).then(confirmReview("sent"))
    .then(check(safety and s.sends == 1 and s.taps == 1 and s.draft == "none" and s.answered == 1))
  run newMessageRetiresSuggestionTest = init.then(becomeReady).then(receive).then(requestSuggestion)
    .then(suggestionReply(1, true)).then(receive)
    .then(check(safety and s.draft == "none"))
  run lateSuggestionAfterNewMessageTest = init.then(becomeReady).then(receive).then(requestSuggestion)
    .then(receive).then(suggestionReply(1, true)).then(check(safety and s.draft == "none"))
  run ownerTypingWinsTest = init.then(becomeReady).then(receive).then(requestSuggestion).then(openThread)
    .then(typeText).then(suggestionReply(1, true)).then(check(safety and s.draft == "owner"))
  run ownerDraftSurvivesInboundTest = init.then(becomeReady).then(openThread).then(typeText).then(receive)
    .then(check(safety and s.draft == "owner" and unread == 0))
  run closedThreadCountsUnreadTest = init.then(becomeReady).then(receive).then(receive)
    .then(check(unread == 2)).then(openThread).then(check(safety and unread == 0))
  run failedSendKeepsDraftTest = init.then(becomeReady).then(openThread).then(typeText).then(tapSend)
    .then(confirmReview("failed")).then(check(safety and s.draft == "owner" and s.outcome == "failed"))
  run unknownSendIsNotRetriedTest = init.then(becomeReady).then(openThread).then(typeText).then(tapSend)
    .then(confirmReview("unknown")).then(check(safety and s.draft == "owner" and s.sends == 1 and s.uncertain))
    .then(tapSend).then(confirmReview("unknown")).then(check(safety and s.sends == 1))
    .then(tapSend).then(confirmReview("sent")).then(check(safety and s.sends == 1 and s.taps == 3 and s.draft == "none"))
  run lockDismissesReviewTest = init.then(becomeReady).then(openThread).then(typeText).then(tapSend).then(loseReady)
    .then(check(safety and s.review == "none" and s.sends == 0 and s.draft == "owner"))
  run inboundDuringAgentReviewClosesItTest = init.then(becomeReady).then(receive).then(requestSuggestion)
    .then(suggestionReply(1, true)).then(tapSend).then(receive)
    .then(check(safety and s.review == "none" and s.draft == "none" and s.sends == 0))
  run dismissedSuggestionIsNotOfferedAgainTest = init.then(becomeReady).then(receive).then(requestSuggestion)
    .then(suggestionReply(1, true)).then(dismissSuggestion)
    .then(check(safety and s.draft == "none" and s.declined == 1 and not(s.inbound != s.declined)))
    .then(receive).then(requestSuggestion).then(suggestionReply(2, true))
    .then(check(safety and s.draft == "agent" and s.draftBase == 2))
}
