/// Send attempts of the chat shell (`p.send` and its SendAttempt): composer sends that hold the
/// composer text and prompts sent from elsewhere that leave it alone, the dispatch decision, the
/// bounded wait for the transport's own result, restore-or-keep after a failure, and which attempt
/// owns the typing indicator when sends overlap across a session change.
module ComposerSend {
  type Attempt = { phase: str, text: str, held: str, argument: bool, session: int, transportCalled: bool, preDispatch: bool,
    streamed: bool, transport: str, posted: bool, outcome: str }
  type State = { draft: str, typing: bool, owner: int, next: int, session: int, changes: int,
    attempts: int -> Attempt, bubbles: Set[int] }
  var s: State
  pure val blank: Attempt = { phase: "none", text: "", held: "", argument: false, session: 0, transportCalled: false,
    preDispatch: false, streamed: false, transport: "idle", posted: false, outcome: "none" }
  pure val Ids = Set(1, 2)
  pure def inFlight(a: Attempt): bool = a.phase.in(Set("connecting", "transport", "settling"))
  // The composer's durable draft is held from a composer send until that send has settled.
  pure def holding(st: State): bool = Ids.exists(id => inFlight(st.attempts.get(id)) and not(st.attempts.get(id).argument))
  // dispatched(): streamed text or an accepted transport call means the agent may have the message.
  pure def dispatched(a: Attempt): bool = a.streamed or (a.transportCalled and not(a.preDispatch))
  // The finally block: the attempt gives up the send only while it still owns it, and the typing
  // indicator is cleared unless a newer attempt owns the send.
  pure def finished(st: State, id: int, outcome: str): State = {
    ...st, attempts: st.attempts.set(id, { ...st.attempts.get(id), phase: "done", outcome: outcome }),
    owner: if (st.owner == id) 0 else st.owner,
    typing: if (st.owner == id or st.owner == 0) false else st.typing }
  // Not dispatched: the unsent bubble is dropped. A composer send's held text returns ahead of
  // newer typing; a prompt sent from elsewhere never writes the composer. After a session change
  // the held text stays with the draft of the session it was typed in and the composer is left alone.
  pure def restored(st: State, id: int): State =
    finished({ ...st, bubbles: st.bubbles.exclude(Set(id)),
      draft: if (st.attempts.get(id).argument or st.attempts.get(id).session != st.session) st.draft
        else if (st.draft == "") st.attempts.get(id).held else "both" }, id, "restored")
  // Dispatched but failed: the agent may have the message. It stays in the transcript, unconfirmed.
  pure def decided(st: State, id: int): State =
    if (dispatched(st.attempts.get(id))) finished(st, id, "unconfirmed") else restored(st, id)

  action init = s' = { draft: "", typing: false, owner: 0, next: 1, session: 0, changes: 0,
    attempts: Ids.mapBy(_ => blank), bubbles: Set() }
  action typeText(text: str): bool = all { text != s.draft, s.changes < 4,
    s' = { ...s, draft: text, changes: s.changes + 1 } }
  // A prompt sent from elsewhere (an explicit argument) is sent as given and leaves the composer
  // text in place. A composer send holds the composer text and clears the composer. A send whose
  // screen, conversation or draft changed while voice was retiring is dropped with nothing changed.
  // No send starts while an earlier composer send still holds its text, even after a session
  // change cleared the indicator: only a prompt sent from elsewhere can be overtaken.
  action send(argument: bool, current: bool): bool = all {
    s.next <= 2, not(s.typing), argument or s.draft != "", not(holding(s)),
    s' = if (not(current)) s
      else { ...s, draft: if (argument) s.draft else "", typing: true, owner: s.next, next: s.next + 1,
        bubbles: s.bubbles.union(Set(s.next)),
        attempts: s.attempts.set(s.next, { ...blank, phase: "connecting", argument: argument, session: s.session,
          text: if (argument) "P" else s.draft, held: if (argument) "" else s.draft }) } }
  // The connection, the screen revision or the client refused before the transport was called.
  action refusedBeforeTransport(id: int): bool = all { s.attempts.get(id).phase == "connecting",
    s' = restored(s, id) }
  action transportCall(id: int): bool = all { s.attempts.get(id).phase == "connecting",
    s' = { ...s, attempts: s.attempts.setBy(id, a => { ...a, phase: "transport", transportCalled: true, transport: "running" }) } }
  // What the agent received is not visible to the phone until the transport settles.
  action serverReceives(id: int): bool = all {
    s.attempts.get(id).transport == "running", not(s.attempts.get(id).posted),
    s' = { ...s, attempts: s.attempts.setBy(id, a => { ...a, posted: true }) } }
  // The transport's own result. A send that is still waiting for it is classified in the same
  // task; a result that arrives after the bounded wait only records what the transport reported.
  pure def transportEnded(st: State, id: int, refused: bool): State = {
    val marked = { ...st, attempts: st.attempts.setBy(id, a => { ...a, transport: "settled", preDispatch: a.preDispatch or refused }) }
    if (inFlight(st.attempts.get(id))) decided(marked, id) else marked
  }
  // The transport itself reports that nothing carrying the message left the phone.
  action transportRefuses(id: int): bool = all {
    s.attempts.get(id).transport == "running", not(s.attempts.get(id).posted), s' = transportEnded(s, id, true) }
  action transportFails(id: int): bool = all {
    s.attempts.get(id).transport == "running", s.attempts.get(id).posted, s' = transportEnded(s, id, false) }
  action streamChunk(id: int): bool = all {
    s.attempts.get(id).phase == "transport", s.attempts.get(id).posted, not(s.attempts.get(id).streamed),
    s' = { ...s, attempts: s.attempts.setBy(id, a => { ...a, streamed: true }) } }
  action reply(id: int): bool = all {
    s.attempts.get(id).phase == "transport", s.attempts.get(id).posted,
    s' = finished({ ...s, attempts: s.attempts.setBy(id, a => { ...a, transport: "settled" }) }, id, "replied") }
  // Stop rejects the client first; the classification still waits for the transport.
  action cancel(id: int): bool = all { s.attempts.get(id).phase == "transport",
    s' = { ...s, attempts: s.attempts.setBy(id, a => { ...a, phase: "settling" }) } }
  // The settle wait is bounded: an unsettled transport is classified from what is known.
  action settleTimeout(id: int): bool = all {
    s.attempts.get(id).phase == "settling", s.attempts.get(id).transport == "running",
    s' = decided(s, id) }
  // A different agent session clears the transcript, the composer and the indicator, and aborts
  // the request in flight. The connect wait of a new send is not interleaved with it here.
  action sessionSwitch = all { s.session < 2, Ids.forall(id => s.attempts.get(id).phase != "connecting"),
    s' = { ...s, session: s.session + 1, draft: "", typing: false, bubbles: Set(),
      attempts: s.attempts.keys().mapBy(id => if (s.attempts.get(id).phase == "transport")
        { ...s.attempts.get(id), phase: "settling" } else s.attempts.get(id)) } }
  action step = {
    nondet id = Ids.oneOf()
    nondet text = Set("", "A", "B").oneOf()
    nondet argument = Set(false, true).oneOf()
    nondet current = Set(false, true).oneOf()
    any { typeText(text), send(argument, current), refusedBeforeTransport(id), transportCall(id),
      serverReceives(id), transportRefuses(id), transportFails(id), streamChunk(id), reply(id), cancel(id),
      settleTimeout(id), sessionSwitch, s' = s }
  }

  val TypingHasLiveOwner = s.typing implies (s.owner != 0 and inFlight(s.attempts.get(if (s.owner == 0) 1 else s.owner)))
  val OwnerKeepsTyping = Ids.forall(id => (s.owner == id and s.attempts.get(id).phase.in(Set("connecting", "transport")))
    implies s.typing)
  val RestoredNeverPosted = Ids.forall(id => s.attempts.get(id).outcome == "restored" implies
    (not(s.attempts.get(id).posted) and not(s.bubbles.contains(id))))
  val UnconfirmedWasHandedOver = Ids.forall(id => s.attempts.get(id).outcome == "unconfirmed" implies
    s.attempts.get(id).transportCalled)
  val OneOutcome = Ids.forall(id => (s.attempts.get(id).phase == "done") == (s.attempts.get(id).outcome != "none"))
  val OnlyComposerSendsHold = Ids.forall(id => s.attempts.get(id).argument implies
    (s.attempts.get(id).held == "" and s.attempts.get(id).text == "P"))
  val OneHeldComposerSend = Ids.filter(id => inFlight(s.attempts.get(id)) and not(s.attempts.get(id).argument)).size() <= 1
  val AttemptSessionKnown = Ids.forall(id => s.attempts.get(id).session <= s.session)
  val safety = AttemptSessionKnown and OneHeldComposerSend and TypingHasLiveOwner and OwnerKeepsTyping and RestoredNeverPosted and UnconfirmedWasHandedOver and
    OneOutcome and OnlyComposerSendsHold

  val OverlappingSendWitness = s.owner == 2 and s.typing and s.attempts.get(1).phase == "settling"
  val RestoredWitness = s.attempts.get(1).outcome == "restored" and s.draft == "both"
  val UnconfirmedAfterTimeoutWitness = s.attempts.get(1).outcome == "unconfirmed" and s.attempts.get(1).transport == "running"
  val ArgumentSendWitness = s.attempts.get(1).argument and s.attempts.get(1).outcome == "replied" and s.draft == "A"

  // A prompt sent from elsewhere reaches the transport while the composer holds other text, and
  // that text is still in the composer afterwards.
  run argumentSendReachesTransportTest = init.then(typeText("A")).then(send(true, true))
    .expect(s.typing and s.attempts.get(1).phase == "connecting" and s.attempts.get(1).text == "P" and s.draft == "A")
    .then(transportCall(1)).then(serverReceives(1)).then(reply(1))
    .expect(s.attempts.get(1).outcome == "replied" and not(s.typing) and s.draft == "A" and safety)
  // A refused prompt from elsewhere drops its bubble and never writes the composer.
  run refusedArgumentKeepsComposerTest = init.then(typeText("A")).then(send(true, true)).then(refusedBeforeTransport(1))
    .expect(s.attempts.get(1).outcome == "restored" and s.draft == "A" and s.bubbles == Set() and not(s.typing) and safety)
  // An earlier send that is still settling after a session change does not clear the indicator
  // of the send that replaced it.
  run staleFinallyKeepsTypingTest = init.then(send(true, true)).then(transportCall(1))
    .then(serverReceives(1)).then(sessionSwitch).expect(not(s.typing) and s.attempts.get(1).phase == "settling")
    .then(typeText("B")).then(send(false, true)).then(transportCall(2)).then(settleTimeout(1))
    .expect(s.attempts.get(1).outcome == "unconfirmed" and s.typing and s.owner == 2 and safety)
    .then(serverReceives(2)).then(reply(2)).expect(not(s.typing) and s.owner == 0 and safety)
  run refusedSendRestoresTextTest = init.then(typeText("A")).then(send(false, true)).then(transportCall(1))
    .then(typeText("B")).then(transportRefuses(1))
    .expect(s.attempts.get(1).outcome == "restored" and s.draft == "both" and s.bubbles == Set() and not(s.typing) and safety)
  run cancelWaitsForTransportTest = init.then(typeText("A")).then(send(false, true)).then(transportCall(1))
    .then(cancel(1)).expect(s.typing and s.draft == "").then(transportRefuses(1))
    .expect(s.attempts.get(1).outcome == "restored" and s.draft == "A" and safety)
  run unsettledCancelStaysSentTest = init.then(typeText("A")).then(send(false, true)).then(transportCall(1))
    .then(serverReceives(1)).then(cancel(1)).then(settleTimeout(1))
    .expect(s.attempts.get(1).outcome == "unconfirmed" and s.draft == "" and s.bubbles == Set(1) and safety)
  // A composer send that is still settling after a session change keeps its hold: the next
  // send does not start until it has settled.
  run heldComposerSendBlocksNextSendTest = init.then(typeText("A")).then(send(false, true)).then(transportCall(1))
    .then(serverReceives(1)).then(sessionSwitch).then(typeText("B"))
    .expect(holding(s) and not(s.typing) and s.next == 2)
    .then(settleTimeout(1)).then(send(false, true))
    .expect(s.owner == 2 and s.typing and s.attempts.get(1).outcome == "unconfirmed" and safety)
  // A composer send refused after a session change does not put its text into the composer of
  // the session that replaced it.
  run refusedAfterSessionChangeLeavesComposerTest = init.then(typeText("A")).then(send(false, true)).then(transportCall(1))
    .then(sessionSwitch).then(typeText("B")).then(transportRefuses(1))
    .expect(s.attempts.get(1).outcome == "restored" and s.draft == "B" and s.bubbles == Set() and safety)
  run staleComposerSendKeepsDraftTest = init.then(typeText("A")).then(send(false, false))
    .expect(s.draft == "A" and not(s.typing) and s.next == 1 and safety)
}
