/// The Maps share question in chat: the newest agent reply may carry two answer buttons. A
/// button keeps the session, conversation, message and text it was rendered for, and a tap
/// sends its answer as one ordinary chat message only while all of them still hold and the
/// composer is free. A failed send offers the question again.
module MapsShareChoice {
  type Offer = { message: int, session: int, conversation: int, revision: int }
  type Send = { message: int, session: int, conversation: int, revision: int, offer: Offer, quiet: bool }
  type Chat = {
    // The shell and connection: mounted, page hidden, connection sheet open, connection busy,
    // reply streaming, voice recording, a typed draft, a message edit in progress.
    live: bool, hidden: bool, sheetOpen: bool, busy: bool, typing: bool, recording: bool,
    draft: bool, editing: bool,
    // The signed-in session (0 is none) and the selected conversation.
    session: int, conversation: int,
    // The newest message: its id, who wrote it, whether it carries the question, its text version.
    newest: int, fromAgent: bool, question: bool, revision: int,
    // The buttons drawn by the last render (message 0 is none).
    offer: Offer,
    answered: Set[int], inflight: Set[int], sends: Set[Send], delivered: int -> int,
    lastTap: str, notice: str
  }
  var s: Chat
  pure val Messages = 1.to(4)
  pure val MaxRevision = 2
  pure val none: Offer = { message: 0, session: 0, conversation: 0, revision: 0 }
  /// The button's own fence: same session and conversation, and the question is still the
  /// newest message with the text it was rendered from.
  pure def current(c: Chat, offer: Offer): bool = and {
    offer.session != 0, c.session == offer.session, c.conversation == offer.conversation,
    c.newest == offer.message, c.fromAgent, c.revision == offer.revision
  }
  /// Nothing else owns the composer or the connection.
  pure def quiet(c: Chat): bool =
    c.live and not(c.hidden) and not(c.sheetOpen) and not(c.busy) and not(c.typing) and not(c.recording)
  /// Whether a render draws the buttons on the newest message.
  pure def open(c: Chat): bool =
    c.newest != 0 and c.fromAgent and c.question and not(c.answered.contains(c.newest)) and c.session != 0

  action init = s' = {
    live: true, hidden: false, sheetOpen: false, busy: false, typing: false, recording: false,
    draft: false, editing: false, session: 1, conversation: 1,
    newest: 0, fromAgent: false, question: false, revision: 0, offer: none,
    answered: Set(), inflight: Set(), sends: Set(), delivered: Messages.mapBy(id => 0),
    lastTap: "none", notice: "none"
  }
  action agentReply(question: bool): bool = all {
    s.newest < 4,
    s' = { ...s, newest: s.newest + 1, fromAgent: true, question: question, revision: 0 }
  }
  action userMessage = all {
    s.newest < 4,
    s' = { ...s, newest: s.newest + 1, fromAgent: false, question: false, revision: 0 }
  }
  /// The newest reply's text is replaced, as while it streams or when its projection changes.
  action replaceText(question: bool): bool = all {
    s.newest != 0, s.fromAgent, s.revision < MaxRevision,
    s' = { ...s, revision: s.revision + 1, question: question }
  }
  /// A render draws buttons only on the newest reply, and never for an answered question.
  action render = s' = { ...s, offer: if (open(s))
    { message: s.newest, session: s.session, conversation: s.conversation, revision: s.revision } else none }
  /// A tap on a drawn button. A stale or busy tap does nothing; a draft or an open edit is
  /// kept and named in a notice; otherwise the question is marked answered and the answer sent.
  action tap = all {
    s.offer.message != 0,
    s' = if (s.answered.contains(s.offer.message) or not(quiet(s)) or not(current(s, s.offer)))
        { ...s, lastTap: "ignored" }
      else if (s.draft) { ...s, lastTap: "draft", notice: "draft" }
      else if (s.editing) { ...s, lastTap: "editing", notice: "editing" }
      else { ...s, lastTap: "sent", answered: s.answered.union(Set(s.offer.message)),
        inflight: s.inflight.union(Set(s.offer.message)),
        sends: s.sends.union(Set({ message: s.newest, session: s.session, conversation: s.conversation,
          revision: s.revision, offer: s.offer, quiet: quiet(s) and not(s.draft) and not(s.editing) })) }
  }
  /// The chat send settles. A refused send withdraws the answered mark, and says so while mounted.
  action sendSettles(message: int, ok: bool): bool = all {
    s.inflight.contains(message),
    s' = if (ok) { ...s, inflight: s.inflight.exclude(Set(message)),
        delivered: s.delivered.setBy(message, count => count + 1) }
      else { ...s, inflight: s.inflight.exclude(Set(message)), answered: s.answered.exclude(Set(message)),
        notice: if (s.live) "failed" else s.notice }
  }
  action setHidden(flag: bool): bool = s' = { ...s, hidden: flag }
  action setSheetOpen(flag: bool): bool = s' = { ...s, sheetOpen: flag }
  action setBusy(flag: bool): bool = s' = { ...s, busy: flag }
  action setTyping(flag: bool): bool = s' = { ...s, typing: flag }
  action setRecording(flag: bool): bool = s' = { ...s, recording: flag }
  action setDraft(flag: bool): bool = s' = { ...s, draft: flag }
  action setEditing(flag: bool): bool = s' = { ...s, editing: flag }
  action changeSession(target: int): bool = all { target != s.session, s' = { ...s, session: target } }
  action changeConversation(target: int): bool = all {
    target != s.conversation, s' = { ...s, conversation: target }
  }
  action unmount = all { s.live, s' = { ...s, live: false } }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet message = Messages.oneOf()
    nondet target = 0.to(2).oneOf()
    nondet room = 1.to(2).oneOf()
    // Changes that take the composer or the account away are drawn less often.
    nondet draw = 0.to(3).oneOf()
    any {
      agentReply(flag), userMessage, replaceText(flag), render, tap, sendSettles(message, flag),
      all { draw == 0, any {
        setHidden(flag), setSheetOpen(flag), setBusy(flag), setTyping(flag), setRecording(flag),
        setDraft(flag), setEditing(flag), changeSession(target), changeConversation(room), unmount } },
      s' = s
    }
  }

  val TypeOK = s.newest.in(0.to(4)) and s.session.in(0.to(2)) and s.conversation.in(1.to(2)) and
    s.revision.in(0.to(MaxRevision)) and s.lastTap.in(Set("none", "ignored", "draft", "editing", "sent")) and
    s.notice.in(Set("none", "draft", "editing", "failed"))
  /// Buttons are drawn only under a signed-in session.
  val OfferNeedsSession = s.offer.message != 0 implies s.offer.session != 0
  val InFlightIsAnswered = s.inflight.subseteq(s.answered)
  /// One question's answer reaches the conversation at most once.
  val DeliveredAtMostOnce = Messages.forall(id => s.delivered.get(id) <= 1)
  val DeliveredStaysAnswered = Messages.forall(id => s.delivered.get(id) > 0 implies
    s.answered.contains(id) and not(s.inflight.contains(id)))
  /// An answer goes to the session and conversation that asked, for the text that was shown.
  val SendMatchesOffer = s.sends.forall(send => and {
    send.session != 0, send.session == send.offer.session, send.conversation == send.offer.conversation,
    send.message == send.offer.message, send.revision == send.offer.revision
  })
  /// Nothing is sent over a draft, an edit, a hidden page, a recording or a busy connection.
  val SendOnlyWhenQuiet = s.sends.forall(send => send.quiet)
  val safety = TypeOK and OfferNeedsSession and InFlightIsAnswered and DeliveredAtMostOnce and
    DeliveredStaysAnswered and SendMatchesOffer and SendOnlyWhenQuiet

  val StaleTapIgnoredWitness = s.lastTap == "ignored" and quiet(s) and not(s.answered.contains(s.offer.message))
  val FailedSendReopensWitness = s.notice == "failed" and s.sends.size() > 0 and s.answered == Set()
  val DeliveredWitness = Messages.exists(id => s.delivered.get(id) == 1)
  val DraftKeptWitness = s.lastTap == "draft" and s.draft and s.sends == Set()
  val SecondAttemptDeliveredWitness = s.notice == "failed" and Messages.exists(id => s.delivered.get(id) == 1)

  run oneTapSendsOnceTest = init.then(agentReply(true)).then(render)
    .expect(s.offer.message == 1)
    .then(tap).expect(s.lastTap == "sent" and s.inflight == Set(1))
    .then(tap).expect(s.lastTap == "ignored" and s.sends.size() == 1)
    .then(render).expect(s.offer == none)
    .then(sendSettles(1, true)).expect(s.delivered.get(1) == 1 and s.answered == Set(1) and safety)
  run olderQuestionIsHistoryTest = init.then(agentReply(true)).then(render).then(userMessage)
    .then(tap).expect(s.lastTap == "ignored" and s.sends == Set())
    .then(render).expect(s.offer == none and safety)
  run draftAndEditAreKeptTest = init.then(agentReply(true)).then(render).then(setDraft(true))
    .then(tap).expect(s.notice == "draft" and s.sends == Set() and s.answered == Set())
    .then(setDraft(false)).then(setEditing(true))
    .then(tap).expect(s.notice == "editing" and s.sends == Set())
    .then(setEditing(false)).then(tap).expect(s.lastTap == "sent" and safety)
  run retainedButtonCannotCrossAccountTest = init.then(agentReply(true)).then(render)
    .then(changeSession(2)).then(tap).expect(s.lastTap == "ignored")
    .then(changeSession(1)).then(changeConversation(2)).then(tap).expect(s.lastTap == "ignored")
    .then(changeConversation(1)).then(replaceText(true)).then(tap)
    .expect(s.lastTap == "ignored" and s.sends == Set() and safety)
    .then(render).then(tap).expect(s.lastTap == "sent" and safety)
  run busyComposerSendsNothingTest = init.then(agentReply(true)).then(render)
    .then(setRecording(true)).then(tap).then(setRecording(false))
    .then(setHidden(true)).then(tap).then(setHidden(false))
    .then(setBusy(true)).then(tap).then(setBusy(false))
    .then(setTyping(true)).then(tap).then(setTyping(false))
    .then(setSheetOpen(true)).then(tap)
    .expect(s.lastTap == "ignored" and s.sends == Set() and s.answered == Set() and safety)
  run failedSendOffersQuestionAgainTest = init.then(agentReply(true)).then(render).then(tap)
    .then(sendSettles(1, false))
    .expect(s.notice == "failed" and s.answered == Set() and s.delivered.get(1) == 0)
    .then(render).expect(s.offer.message == 1)
    .then(tap).then(sendSettles(1, true)).expect(s.delivered.get(1) == 1 and safety)
  run signedOutRenderDrawsNoButtonsTest = init.then(changeSession(0)).then(agentReply(true)).then(render)
    .expect(s.offer == none and safety)
}
