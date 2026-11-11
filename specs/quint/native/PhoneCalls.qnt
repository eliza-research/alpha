// Call lifecycle, missed calls and agent-proposed calls by name or number placed after one owner approval.
module PhoneCalls {
  type State = {
    ready: bool, unlocked: bool,
    call: str, direction: str, muted: bool, speaker: bool, keypad: bool,
    missed: int, seenMissed: int,
    proposal: str, target: str, matches: int, emergency: bool, numberRevision: int, proposalBase: int,
    approvals: int, agentPlaced: int, ownerPlaced: int, handoffs: int
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    ready: false, unlocked: true,
    call: "none", direction: "none", muted: false, speaker: false, keypad: false,
    missed: 0, seenMissed: 0,
    proposal: "none", target: "none", matches: 0, emergency: false, numberRevision: 0, proposalBase: -1,
    approvals: 0, agentPlaced: 0, ownerPlaced: 0, handoffs: 0
  }
  def ended(x: State): State = {call: "none", direction: "none", muted: false, speaker: false, keypad: false, ...x}
  // ready = verified image holding the dialer role with call permission.
  action becomeReady = s' = {ready: true, ...s}
  action loseReady = all {
    s.call == "none",
    s' = {ready: false, proposal: if (s.proposal.in(Set("resolving", "choosing", "proposed"))) "expired" else s.proposal, ...s}
  }
  action lock = s' = {
    unlocked: false,
    proposal: if (s.proposal.in(Set("resolving", "choosing", "proposed"))) "expired" else s.proposal, ...s}
  action unlock = s' = {unlocked: true, ...s}
  // Owner dialing from keypad, recents or a contact.
  action ownerDial = all {
    s.ready, s.unlocked, s.call == "none",
    s' = {call: "dialing", direction: "out", ownerPlaced: s.ownerPlaced + 1, ...s}
  }
  action remoteAnswers = all { s.call == "dialing", s' = {call: "active", ...s} }
  action incoming = all { s.ready, s.call == "none", s' = {call: "ringing", direction: "in", ...s} }
  // Answering works over the lock screen.
  action answer = all { s.call == "ringing", s' = {call: "active", ...s} }
  action decline = all { s.call == "ringing", s' = ended(s) }
  action ringStops = all {
    s.call == "ringing", s.missed < 3, s' = ended({missed: s.missed + 1, ...s})
  }
  action hold = all { s.call == "active", s' = {call: "held", ...s} }
  action unhold = all { s.call == "held", s' = {call: "active", ...s} }
  action toggleMute = all { s.call.in(Set("active", "held", "dialing")), s' = {muted: not(s.muted), ...s} }
  action toggleSpeaker = all { s.call.in(Set("active", "held", "dialing")), s' = {speaker: not(s.speaker), ...s} }
  action toggleKeypad = all { s.call == "active", s' = {keypad: not(s.keypad), ...s} }
  action hangUp = all { s.call.in(Set("dialing", "active", "held")), s' = ended(s) }
  action remoteEnds = all { s.call.in(Set("dialing", "active", "held")), s' = ended(s) }
  action viewRecents = all { s.ready, s.unlocked, s' = {seenMissed: s.missed, ...s} }
  // Agent request. A number target has exactly one match; a name is looked up in Contacts.
  action agentAsk(target: str, emergency: bool): bool = all {
    s.ready, s.unlocked, s.proposal.in(Set("none", "placed", "declined", "expired", "stale", "unresolved", "handed-off", "failed")),
    target.in(Set("number", "name")),
    s' = {proposal: if (emergency) "handed-off" else if (target == "number") "proposed" else "resolving",
      target: target, emergency: emergency, matches: if (target == "number") 1 else 0,
      proposalBase: if (target == "number") s.numberRevision else -1,
      handoffs: if (emergency) s.handoffs + 1 else s.handoffs, ...s}
  }
  action resolved(matches: int): bool = all {
    s.proposal == "resolving", matches.in(Set(0, 1, 2)),
    s' = {matches: matches,
      proposal: if (matches == 0) "unresolved" else if (matches == 1) "proposed" else "choosing",
      proposalBase: if (matches == 1) s.numberRevision else -1, ...s}
  }
  action choose = all {
    s.proposal == "choosing", s' = {proposal: "proposed", matches: 1, proposalBase: s.numberRevision, ...s}
  }
  action declineProposal = all {
    s.proposal.in(Set("choosing", "proposed")), s' = {proposal: "declined", ...s}
  }
  // The contact's number changes after the card was shown.
  action numberChanges = all {
    s.numberRevision < 2,
    s' = {numberRevision: s.numberRevision + 1,
      proposal: if (s.proposal == "proposed" and s.target == "name") "stale" else s.proposal, ...s}
  }
  action approve(ok: bool): bool = all {
    s.ready, s.unlocked, s.proposal == "proposed", s.call == "none", not(s.emergency),
    s.target == "number" or s.proposalBase == s.numberRevision,
    s' = if (ok) {proposal: "placed", approvals: s.approvals + 1, agentPlaced: s.agentPlaced + 1,
        call: "dialing", direction: "out", ...s}
      else {proposal: "failed", approvals: s.approvals + 1, ...s}
  }
  action repeat = s' = s
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet target = Set("number", "name").oneOf()
    nondet matches = Set(0, 1, 2).oneOf()
    any { becomeReady, loseReady, lock, unlock, ownerDial, remoteAnswers, incoming, answer, decline, ringStops,
      hold, unhold, toggleMute, toggleSpeaker, toggleKeypad, hangUp, remoteEnds, viewRecents,
      agentAsk(target, flag), resolved(matches), choose, declineProposal, numberChanges, approve(flag), repeat }
  }
  val AgentCallNeedsApproval = s.agentPlaced <= s.approvals
  val AmbiguousNeverPlaces = s.proposal.in(Set("choosing", "resolving", "unresolved")) implies s.matches != 1
  val EmergencyNeverAgentPlaced = s.emergency implies s.proposal.in(Set("handed-off", "expired"))
  val PendingProposalIsCurrent = s.proposal == "proposed" implies
    s.matches == 1 and s.ready and s.unlocked and (s.target == "number" or s.proposalBase == s.numberRevision)
  val ControlsOnlyInCall = s.call.in(Set("none", "ringing")) implies not(s.muted) and not(s.speaker) and not(s.keypad)
  val DirectionMatchesCall = (s.call == "none") == (s.direction == "none") and
    (s.call == "ringing" implies s.direction == "in") and (s.call == "dialing" implies s.direction == "out")
  val MissedSeenBounded = s.seenMissed <= s.missed
  val CallNeedsRole = s.call != "none" implies s.ready
  val safety = AgentCallNeedsApproval and AmbiguousNeverPlaces and EmergencyNeverAgentPlaced and
    PendingProposalIsCurrent and ControlsOnlyInCall and DirectionMatchesCall and MissedSeenBounded and CallNeedsRole

  run callByNumberTest = init.then(becomeReady).then(agentAsk("number", false))
    .then(check(s.call == "none")).then(approve(true))
    .then(check(safety and s.call == "dialing" and s.agentPlaced == 1))
  run callByNameOneMatchTest = init.then(becomeReady).then(agentAsk("name", false)).then(resolved(1))
    .then(approve(true)).then(remoteAnswers).then(check(safety and s.call == "active"))
  run ambiguousNameNeedsChoiceTest = init.then(becomeReady).then(agentAsk("name", false)).then(resolved(2))
    .then(check(s.proposal == "choosing" and s.call == "none")).then(choose).then(approve(true))
    .then(check(safety and s.agentPlaced == 1))
  run unknownNameDoesNotCallTest = init.then(becomeReady).then(agentAsk("name", false)).then(resolved(0))
    .then(check(safety and s.proposal == "unresolved" and s.call == "none"))
  run emergencyIsHandedToSystemTest = init.then(becomeReady).then(agentAsk("number", true))
    .then(check(safety and s.proposal == "handed-off" and s.agentPlaced == 0 and s.handoffs == 1))
  run changedNumberStalesProposalTest = init.then(becomeReady).then(agentAsk("name", false)).then(resolved(1))
    .then(numberChanges).then(check(safety and s.proposal == "stale" and s.call == "none"))
  run lockExpiresProposalTest = init.then(becomeReady).then(agentAsk("number", false)).then(lock).then(unlock)
    .then(check(safety and s.proposal == "expired" and s.agentPlaced == 0))
  run missedCallCountsUntilSeenTest = init.then(becomeReady).then(incoming).then(ringStops)
    .then(check(s.missed - s.seenMissed == 1)).then(viewRecents)
    .then(check(safety and s.missed == s.seenMissed))
  run declinedCallIsNotMissedTest = init.then(becomeReady).then(incoming).then(decline)
    .then(check(safety and s.missed == 0))
  run controlsResetAfterCallTest = init.then(becomeReady).then(ownerDial).then(remoteAnswers).then(toggleMute)
    .then(toggleSpeaker).then(toggleKeypad).then(hold).then(remoteEnds)
    .then(check(safety and s.call == "none" and not(s.muted)))
  run answerOverLockTest = init.then(becomeReady).then(lock).then(incoming).then(answer)
    .then(check(safety and s.call == "active"))
  run failedPlacementIsNotACallTest = init.then(becomeReady).then(agentAsk("number", false)).then(approve(false))
    .then(check(safety and s.proposal == "failed" and s.call == "none" and s.agentPlaced == 0))
}
