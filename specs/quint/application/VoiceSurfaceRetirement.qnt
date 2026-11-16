/// Leaving the voice surface of the chat (`cleanup`, `retirement`, `stopVoiceConversation`): the
/// capture, conversation and speech it held are stopped on one chain, the chat holds a retirement
/// until that chain settles, and a typed message or a new voice start waits for it. A stop that
/// could not be confirmed keeps voice closed for the rest of the app process; it never withholds
/// a typed message, which needs no microphone.
module VoiceSurfaceRetirement {
  type State = { surface: str, media: bool, stoppingPending: bool, retirement: str, mediaUnconfirmed: bool,
    everUnconfirmed: bool, panel: str, sendWaiting: bool, asked: int, sends: int, staleSends: int,
    sentUnconfirmed: int, refusedStarts: int, panelBeforeVoice: str, heldPanel: str,
    returnPanel: str, panelBindingCurrent: bool, holds: int, restores: int }
  var s: State
  // Shown chat detents. Hidden voice presentation has its own product decision.
  pure val ShownPanels = Set("input", "sheet", "full")
  // cleanup(): what the surface held moves onto the stopping chain, and the chat keeps a
  // retirement for it. A chain that already failed stays failed.
  pure def left(st: State, returnPanel: str): State =
    if (not(st.media)) { ...st, surface: "closed", panel: returnPanel }
    else { ...st, surface: "closed", media: false,
      stoppingPending: not(st.mediaUnconfirmed), retirement: if (st.mediaUnconfirmed) "error" else "stopping",
      heldPanel: st.panel, returnPanel: returnPanel, panelBindingCurrent: true, holds: st.holds + 1 }

  action init = s' = { surface: "closed", media: false, stoppingPending: false, retirement: "none",
    mediaUnconfirmed: false, everUnconfirmed: false, panel: "input", panelBeforeVoice: "input",
    heldPanel: "input", returnPanel: "input", panelBindingCurrent: true,
    sendWaiting: false, asked: 0, sends: 0, staleSends: 0,
    sentUnconfirmed: 0, refusedStarts: 0, holds: 0, restores: 0 }
  // A voice conversation or Transcribe. Neither starts while earlier voice media is still
  // stopping or was never confirmed stopped.
  action startVoice(dictation: bool): bool = all { s.surface == "closed", s.holds < 3,
    s' = if (s.retirement != "none" or s.mediaUnconfirmed) { ...s, refusedStarts: s.refusedStarts + 1 }
      else { ...s, surface: if (dictation) "dictation" else "conversation", panelBeforeVoice: s.panel,
        panel: if (s.panel == "full") "full" else "sheet" } }
  // The surface opens a capture, a conversation session or reply speech.
  action mediaStarts = all { s.surface != "closed", not(s.media), s' = { ...s, media: true } }
  // cancelChat remembers the original shown panel unless the stop control preserves
  // its current detent. Keyboard returns to input, or stays full if it began full.
  action cancelChat(policy: str): bool = all {
    s.surface != "closed", policy.in(Set("original", "keyboard", "preserve")),
    val target = if (policy == "preserve") s.panel
      else if (policy == "keyboard" and s.panelBeforeVoice != "full") "input" else s.panelBeforeVoice
    s' = left(s, target)
  }
  action leave = cancelChat("original")
  // Owned speech reports that its cleanup could not be confirmed while the surface is still open.
  action speechCleanupFails = all { s.surface != "closed", s.media,
    s' = { ...s, mediaUnconfirmed: true, everUnconfirmed: true } }
  action panelChanged(panel: str): bool = all {
    s.surface == "closed", panel.in(ShownPanels), panel != s.panel, s' = s.with("panel", panel)
  }
  action panelBindingChanged(current: bool): bool = all {
    s.stoppingPending, current != s.panelBindingCurrent, s' = s.with("panelBindingCurrent", current)
  }
  // The stopping chain settles. Only a confirmed stop releases the retirement and puts the chat
  // panel back when nothing else changed it. A waiting message goes out either way when it is still
  // the message the person asked to send; one whose screen, conversation or draft changed is dropped.
  action stoppingSettles(confirmed: bool, sendCurrent: bool): bool = all { s.stoppingPending,
    val canReturn = s.retirement == "stopping" and s.panel == s.heldPanel and s.panelBindingCurrent
    s' = if (confirmed)
        { ...s, stoppingPending: false, retirement: "none", sendWaiting: false,
          panel: if (canReturn) s.returnPanel else s.panel,
          restores: if (canReturn) s.restores + 1 else s.restores,
          sends: if (s.sendWaiting and sendCurrent) s.sends + 1 else s.sends,
          staleSends: if (s.sendWaiting and not(sendCurrent)) s.staleSends + 1 else s.staleSends }
      else { ...s, stoppingPending: false, mediaUnconfirmed: true, everUnconfirmed: true,
        retirement: if (s.retirement == "stopping") "error" else s.retirement, sendWaiting: false,
        sends: if (s.sendWaiting and sendCurrent) s.sends + 1 else s.sends,
        sentUnconfirmed: if (s.sendWaiting and sendCurrent) s.sentUnconfirmed + 1 else s.sentUnconfirmed,
        staleSends: if (s.sendWaiting and not(sendCurrent)) s.staleSends + 1 else s.staleSends } }
  // Back on a retirement whose stop was never confirmed puts its panel away and returns the chat.
  // Voice stays closed.
  action dismissError = all { s.retirement == "error",
    s' = { ...s, retirement: "none", panel: s.returnPanel, restores: s.restores + 1 } }
  // A typed message first retires voice and waits for the chain. With unconfirmed media that
  // chain has already failed; the message goes out at once.
  action send = all { not(s.sendWaiting), s.asked < 4,
    val after = if (s.surface == "conversation" or s.surface == "dictation") left(s, s.panel) else s
    val counted = { ...after, asked: after.asked + 1 }
    s' = if (counted.stoppingPending) { ...counted, sendWaiting: true }
      else if (counted.mediaUnconfirmed)
        { ...counted, sends: counted.sends + 1, sentUnconfirmed: counted.sentUnconfirmed + 1 }
      else { ...counted, sends: counted.sends + 1 } }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet target = ShownPanels.oneOf()
    nondet policy = Set("original", "keyboard", "preserve").oneOf()
    any { startVoice(flag), mediaStarts, cancelChat(policy), speechCleanupFails, panelChanged(target),
      panelBindingChanged(other), stoppingSettles(flag, other), dismissError, send, s' = s }
  }

  val HoldTracksChain = (s.retirement == "stopping" implies s.stoppingPending) and
    (s.retirement == "error" implies (s.mediaUnconfirmed and not(s.stoppingPending)))
  val UnconfirmedIsKept = s.everUnconfirmed == s.mediaUnconfirmed
  val ClosedSurfaceHoldsNoMedia = s.surface == "closed" implies not(s.media)
  val OpenSurfaceHasNoHold = s.surface != "closed" implies (s.retirement == "none" and not(s.stoppingPending))
  val WaitingSendHasChain = s.sendWaiting implies (s.stoppingPending and s.surface == "closed")
  val PanelReturnsAfterHold = s.restores <= s.holds and
    Set(s.panel, s.heldPanel, s.returnPanel, s.panelBeforeVoice).subseteq(ShownPanels)
  // Every typed message is sent, still waiting for the stop, or dropped because what the person
  // was sending changed while it waited. Unconfirmed media accounts for none of them.
  val TypedSendIsNeverLost = s.asked == s.sends + s.staleSends + (if (s.sendWaiting) 1 else 0)
  val UnconfirmedSendsAreSends = s.sentUnconfirmed <= s.sends and (s.sentUnconfirmed > 0 implies s.mediaUnconfirmed)
  val safety = HoldTracksChain and UnconfirmedIsKept and ClosedSurfaceHoldsNoMedia and OpenSurfaceHasNoHold and
    WaitingSendHasChain and PanelReturnsAfterHold and TypedSendIsNeverLost and UnconfirmedSendsAreSends

  val SendWaitingWitness = s.sendWaiting and s.retirement == "stopping"
  val RetirementErrorWitness = s.retirement == "error" and s.refusedStarts > 0
  val SentDespiteUnconfirmedMediaWitness = s.sentUnconfirmed > 0 and s.surface == "closed" and s.refusedStarts > 0
  val WaitingSendSurvivesFailedStopWitness = s.sentUnconfirmed > 0 and s.retirement == "error" and s.asked == 1
  val UserPanelKeptWitness = s.panel != s.heldPanel and s.panel != s.returnPanel and s.restores == 0
    and s.retirement == "none" and s.holds == 1

  // A message typed during a voice conversation is sent only after the conversation's capture
  // and speech have stopped.
  run typedMessageWaitsForVoiceStopTest = init.then(startVoice(false)).then(mediaStarts).then(send)
    .expect(s.surface == "closed" and s.sendWaiting and s.sends == 0 and s.retirement == "stopping" and safety)
    .then(stoppingSettles(true, true))
    .expect(s.sends == 1 and s.retirement == "none" and s.panel == "sheet" and safety)
  run changedDraftDropsWaitingSendTest = init.then(startVoice(false)).then(mediaStarts).then(send)
    .then(stoppingSettles(true, false)).expect(s.sends == 0 and s.staleSends == 1 and not(s.sendWaiting) and safety)
  run voiceWaitsForRetirementTest = init.then(startVoice(false)).then(mediaStarts).then(leave).then(startVoice(false))
    .expect(s.surface == "closed" and s.refusedStarts == 1 and safety).then(stoppingSettles(true, false))
    .then(startVoice(true)).expect(s.surface == "dictation" and s.refusedStarts == 1 and safety)
  run unconfirmedStopKeepsVoiceClosedTest = init.then(startVoice(false)).then(mediaStarts).then(leave)
    .then(stoppingSettles(false, false)).expect(s.retirement == "error" and s.mediaUnconfirmed and safety)
    .then(startVoice(false)).then(send)
    .expect(s.surface == "closed" and s.refusedStarts == 1 and s.sends == 1 and s.sentUnconfirmed == 1 and safety)
  // Voice media that was never confirmed stopped does not withhold typed messages: each one after
  // it goes out, while voice stays closed.
  run typedMessagesSurviveUnconfirmedStopTest = init.then(startVoice(false)).then(mediaStarts).then(leave)
    .then(stoppingSettles(false, false)).then(dismissError).then(send).then(send).then(send)
    .expect(s.asked == 3 and s.sends == 3 and s.staleSends == 0 and s.mediaUnconfirmed and safety)
    .then(startVoice(false)).expect(s.surface == "closed" and s.refusedStarts == 1 and safety)
  // A message typed during the conversation whose stop then fails is sent when it is still current,
  // and dropped only when the draft or screen changed while it waited.
  run waitingMessageSentWhenStopFailsTest = init.then(startVoice(false)).then(mediaStarts).then(send)
    .expect(s.sendWaiting and s.sends == 0 and safety).then(stoppingSettles(false, true))
    .expect(s.sends == 1 and s.sentUnconfirmed == 1 and s.retirement == "error" and not(s.sendWaiting) and safety)
  run changedDraftDroppedWhenStopFailsTest = init.then(startVoice(true)).then(mediaStarts).then(send)
    .then(stoppingSettles(false, false))
    .expect(s.sends == 0 and s.staleSends == 1 and s.retirement == "error" and safety)
  run dismissedErrorKeepsVoiceClosedTest = init.then(startVoice(false)).then(mediaStarts).then(leave)
    .then(stoppingSettles(false, false)).then(panelChanged("full")).then(dismissError)
    .expect(s.retirement == "none" and s.panel == "input" and s.mediaUnconfirmed and safety)
    .then(startVoice(true)).expect(s.surface == "closed" and s.refusedStarts == 1 and safety)
  run userPanelChoiceIsKeptTest = init.then(startVoice(false)).then(mediaStarts).then(leave).then(panelChanged("full"))
    .then(stoppingSettles(true, false)).expect(s.panel == "full" and s.restores == 0 and s.retirement == "none" and safety)
  run idleSurfaceLeavesNoHoldTest = init.then(startVoice(true)).then(leave)
    .expect(s.panel == "input" and s.retirement == "none" and not(s.stoppingPending) and s.holds == 0 and safety)
  run confirmedCloseReturnsToInputTest = init.then(startVoice(false)).then(mediaStarts).then(leave)
    .expect(s.panel == "sheet" and s.retirement == "stopping")
    .then(stoppingSettles(true, false)).expect(s.panel == "input" and s.retirement == "none" and safety)
  run preservingStopKeepsSheetTest = init.then(startVoice(false)).then(mediaStarts).then(cancelChat("preserve"))
    .then(stoppingSettles(true, false)).expect(s.panel == "sheet" and s.retirement == "none" and safety)
  run keyboardFromSheetReturnsToInputTest = init.then(panelChanged("sheet")).then(startVoice(false)).then(mediaStarts)
    .then(cancelChat("keyboard")).then(stoppingSettles(true, false)).expect(s.panel == "input" and safety)
  run keyboardFromFullKeepsFullTest = init.then(panelChanged("full")).then(startVoice(false)).then(mediaStarts)
    .then(cancelChat("keyboard")).then(stoppingSettles(true, false)).expect(s.panel == "full" and safety)
  run changedBindingSkipsPanelReturnTest = init.then(startVoice(false)).then(mediaStarts).then(leave)
    .then(panelBindingChanged(false)).then(stoppingSettles(true, false))
    .expect(s.panel == "sheet" and s.retirement == "none" and s.restores == 0 and safety)
  run restoredBindingAllowsPanelReturnTest = init.then(startVoice(false)).then(mediaStarts).then(leave)
    .then(panelBindingChanged(false)).then(panelBindingChanged(true)).then(stoppingSettles(true, false))
    .expect(s.panel == "input" and s.retirement == "none" and s.restores == 1 and safety)
}
