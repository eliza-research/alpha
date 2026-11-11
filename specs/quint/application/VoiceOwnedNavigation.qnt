/// A screen change the agent asks for during a voice conversation (`navigationContinuation`,
/// `chatCurrent` and the shell navigation wrappers of the voice surface). The turn claims one
/// destination; only the shell's own change to that destination, made while the claim is applied, keeps voice running,
/// the destination's context is pinned when the screen commits, and voice stays on the new screen
/// only when the change was delivered with exactly that context. Any other navigation retires voice.
module VoiceOwnedNavigation {
  type State = { voice: bool, view: int, chatView: int, contextRevision: int, preparedRevision: int,
    claim: str, claimView: int, switched: bool, pinnedRevision: int, attempted: bool, applyResult: str,
    retained: int, pins: int, retiredUnconfirmed: int, retiredByUser: int, refusedClaims: int }
  var s: State
  pure val Views = Set(0, 1, 2)
  // cleanup(): the voice surface closes and gives up its claim.
  pure def closed(st: State): State = { ...st, voice: false, claim: "none", attempted: false }
  // chatCurrent(): the chat is on its own screen with its prepared context, or on the claimed
  // destination with the pinned context (before the pin, only a destination other than its own).
  pure def current(st: State): bool = st.voice and (
    (st.view == st.chatView and st.contextRevision == st.preparedRevision) or
    (st.claim != "none" and st.view == st.claimView and
      (if (st.claim == "pinned") st.contextRevision == st.pinnedRevision else st.claimView != st.chatView)))

  action init = s' = { voice: false, view: 0, chatView: 0, contextRevision: 0, preparedRevision: 0,
    claim: "none", claimView: 0, switched: false, pinnedRevision: 0, attempted: false, applyResult: "none",
    retained: 0, pins: 0, retiredUnconfirmed: 0, retiredByUser: 0, refusedClaims: 0 }
  action startVoice = all { not(s.voice),
    s' = { ...s, voice: true, chatView: s.view, preparedRevision: s.contextRevision, claim: "none", attempted: false,
      applyResult: "none" } }
  // apply(): a turn claims a destination and the shell makes its own navigation inside the claim,
  // in the same task, so voice is kept through it. `moved` is whether the shell switched screens.
  // A second claim, or one from a chat that is no longer current, is refused and leaves the
  // existing claim alone.
  action claimDestination(target: int, moved: bool): bool = all { s.voice, s.refusedClaims < 3,
    s' = if (s.claim != "none" or not(current(s))) { ...s, refusedClaims: s.refusedClaims + 1 }
      else { ...s, claim: "committed", claimView: target, switched: moved, attempted: true, applyResult: "none",
        view: if (moved) target else s.view,
        contextRevision: if (moved and target != s.view) s.contextRevision + 1 else s.contextRevision } }
  // The committed screen reports its context: it is pinned only for the claimed destination.
  action contextPinned = all { s.claim == "committed", s.view == s.claimView,
    s' = { ...s, claim: "pinned", pinnedRevision: s.contextRevision, pins: s.pins + 1 } }
  // The selection on the screen changes: its context is no longer the one that was prepared or pinned.
  action contextChanges = all { s.contextRevision < 4, s' = { ...s, contextRevision: s.contextRevision + 1 } }
  // The claim's own result: true only for a switched, pinned destination that is still current.
  action applySettles = all { s.claim.in(Set("committed", "pinned")), s.applyResult == "none",
    s' = { ...s, applyResult: if (s.switched and s.claim == "pinned" and current(s)) "true" else "false" } }
  // Open, Home or Back by the person, or by anything other than the claim: voice is retired.
  action userNavigates(target: int): bool = all { s.retiredByUser < 3,
    s' = if (s.voice) { ...closed(s), view: target, contextRevision: s.contextRevision + 1, retiredByUser: s.retiredByUser + 1 }
      else { ...s, view: target, contextRevision: s.contextRevision + 1 } }
  // finish(): the navigation acknowledgement. Voice continues on the destination only when it was
  // delivered, pinned and is still exactly what is shown; anything else retires voice.
  action finish(delivered: bool): bool = all { s.voice, s.attempted, s.claim.in(Set("committed", "pinned")),
    s' = if (delivered and s.claim == "pinned" and current(s) and s.view == s.claimView)
        { ...s, claim: "none", attempted: false, chatView: s.claimView, preparedRevision: s.contextRevision, retained: s.retained + 1 }
      else { ...closed(s), retiredUnconfirmed: s.retiredUnconfirmed + 1 } }
  action stopVoice = all { s.voice, s' = closed(s) }
  action step = {
    nondet target = Views.oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    any { startVoice, claimDestination(target, other), contextPinned, contextChanges, applySettles,
      userNavigates(target), finish(flag), stopVoice, s' = s }
  }

  val ClaimNeedsVoice = s.claim != "none" implies (s.voice and s.attempted)
  val VoiceFollowsItsScreen = s.voice implies (s.view == s.chatView or (s.claim != "none" and s.view == s.claimView))
  val RetainedNeedsPinnedContext = s.retained <= s.pins
  val ApplyTrueNeedsPin = s.applyResult == "true" implies s.pins > 0
  val PinnedIsOnDestination = s.claim == "pinned" implies (s.view == s.claimView and s.pinnedRevision <= s.contextRevision)
  val RevisionsOrdered = s.preparedRevision <= s.contextRevision
  val CountersBounded = s.refusedClaims <= 3 and s.retiredByUser <= 3 and s.retiredUnconfirmed >= 0
  val safety = ClaimNeedsVoice and VoiceFollowsItsScreen and RetainedNeedsPinnedContext and ApplyTrueNeedsPin and
    PinnedIsOnDestination and RevisionsOrdered and CountersBounded

  val RetainedOnDestinationWitness = s.retained == 1 and s.voice and s.view == 2 and s.chatView == 2
  val UnconfirmedRetiresVoiceWitness = s.retiredUnconfirmed > 0 and not(s.voice) and s.pins > 0
  val UserNavigationDropsClaimWitness = s.retiredByUser > 0 and s.pins > 0 and s.retained == 0
  val SecondClaimRefusedWitness = s.refusedClaims > 0 and s.claim == "pinned"

  run agentNavigationKeepsVoiceTest = init.then(startVoice).then(claimDestination(1, true))
    .expect(s.voice and s.view == 1 and s.claim == "committed" and safety)
    .then(contextPinned).then(applySettles).expect(s.applyResult == "true")
    .then(finish(true)).expect(s.voice and s.chatView == 1 and s.claim == "none" and s.retained == 1 and safety)
  // The selection moves between the pin and the acknowledgement: voice does not continue on a
  // context the turn never saw.
  run changedContextRetiresVoiceTest = init.then(startVoice).then(claimDestination(1, true))
    .then(contextPinned).then(contextChanges).then(applySettles).expect(s.applyResult == "false")
    .then(finish(true)).expect(not(s.voice) and s.retiredUnconfirmed == 1 and s.retained == 0 and safety)
  run undeliveredNavigationRetiresVoiceTest = init.then(startVoice).then(claimDestination(2, true))
    .then(contextPinned).then(finish(false)).expect(not(s.voice) and s.retiredUnconfirmed == 1 and safety)
  run userNavigationRetiresVoiceTest = init.then(startVoice).then(claimDestination(1, true))
    .then(userNavigates(2)).expect(not(s.voice) and s.claim == "none" and s.view == 2 and s.retiredByUser == 1 and safety)
  run secondClaimIsRefusedTest = init.then(startVoice).then(claimDestination(1, true))
    .then(claimDestination(2, true)).expect(s.refusedClaims == 1 and s.claimView == 1 and s.claim == "committed" and safety)
  run unswitchedScreenIsNeverPinnedTest = init.then(startVoice).then(claimDestination(1, false))
    .then(applySettles).expect(s.applyResult == "false" and s.view == 0)
    .then(finish(true)).expect(not(s.voice) and s.retained == 0 and safety)
}
