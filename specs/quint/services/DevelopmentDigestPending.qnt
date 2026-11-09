// Selected pending digest slot. Raw encodings and payload identities are distinguished.
module DevelopmentDigestPending {
  type Value = {payload: int, phase: str, pretty: bool}
  type Cached = {known: bool, raw: Value}
  type State = {
    stored: Value, caches: int -> Cached, actor: int, before: Value, proposed: Value, expected: Value,
    result: str, casAttempted: bool, reads: int, compares: int, commits: int, operations: int,
  }
  var s: State
  pure val Tabs = Set(1, 2)
  pure val Payloads = Set(1, 2, 3, 4, 5, 6)
  pure val Phases = Set("legacy", "review", "dispatched")
  pure val Faults = Set("none", "before", "after")
  pure val Empty = {payload: 0, phase: "none", pretty: false}
  pure val Unread = {known: false, raw: Empty}
  pure def permitsAdvance(prior: Value, candidate: Value): bool =
    prior.payload == candidate.payload and prior.phase.in(Set("review", "legacy")) and candidate.phase == "dispatched"

  action startState(payload: int, phase: str, pretty: bool): bool = all {
    (payload == 0 and phase == "none" and not(pretty)) or (Payloads.contains(payload) and Phases.contains(phase)),
    s' = {stored: {payload: payload, phase: phase, pretty: pretty}, caches: Map(1 -> Unread, 2 -> Unread),
      actor: 0, before: Empty, proposed: Empty, expected: Empty, result: "idle", casAttempted: false,
      reads: 0, compares: 0, commits: 0, operations: 0},
  }
  action init = any {
    startState(0, "none", false),
    { nondet payload = Payloads.oneOf()
      nondet phase = Phases.oneOf()
      nondet pretty = Bool.oneOf()
      startState(payload, phase, pretty) },
  }
  action read(tab: int): bool = all {
    Tabs.contains(tab), s.operations < 12,
    s' = {...s, caches: s.caches.set(tab, {known: true, raw: s.stored}), actor: tab,
      before: s.stored, proposed: Empty, expected: Empty, result: "read", casAttempted: false,
      reads: s.reads + 1, operations: s.operations + 1},
  }
  action reopen(tab: int): bool = all {
    Tabs.contains(tab), s.operations < 12,
    s' = {...s, caches: s.caches.set(tab, Unread), actor: tab,
      before: s.stored, proposed: Empty, expected: Empty, result: "reopened", casAttempted: false,
      operations: s.operations + 1},
  }
  action save(tab: int, payload: int, phase: str, fault: str): bool = all {
    Tabs.contains(tab), s.operations < 12, Faults.contains(fault),
    (payload == 0 and phase == "none") or (Payloads.contains(payload) and Phases.contains(phase)),
    { val cached = s.caches.get(tab)
      val expected = if (cached.known) cached.raw else s.stored
      val value = {payload: payload, phase: phase, pretty: false}
      val guard = expected != Empty and value != Empty and expected != value and not(permitsAdvance(expected, value))
      val commit = not(guard) and fault != "before" and expected == s.stored
      val result = if (guard) "guard" else if (fault == "before") "unavailable"
        else if (not(commit)) "conflict" else if (fault == "after") "lost" else "saved"
      s' = {...s, stored: if (commit) value else s.stored,
        caches: s.caches.set(tab, {known: true, raw: if (result == "saved") value else expected}), actor: tab,
        before: s.stored, proposed: value, expected: if (guard) Empty else expected, result: result, casAttempted: not(guard),
        reads: s.reads + (if (cached.known) 0 else 1),
        compares: s.compares + (if (guard) 0 else 1), commits: s.commits + (if (commit) 1 else 0),
        operations: s.operations + 1} },
  }
  // A legacy host writer can change only serialization, bypassing the renderer's pending guard.
  action hostReencode: bool = all {
    s.operations < 12, s.stored.pretty,
    s' = {...s, stored: {...s.stored, pretty: false}, actor: 0, before: s.stored,
      proposed: {...s.stored, pretty: false}, expected: s.stored, result: "reencoded", casAttempted: true,
      compares: s.compares + 1, commits: s.commits + 1, operations: s.operations + 1},
  }

  val ExistingIntentOnlyAdvancesPhase = (s.result.in(Set("saved", "lost")) and s.before != Empty
    and s.proposed != Empty and s.proposed != s.before) implies permitsAdvance(s.before, s.proposed)
  val RefusedWritesLeaveExactBytes = (s.result.in(Set("guard", "conflict", "unavailable"))) implies s.stored == s.before
  val CommittedWritesUseExactExpectedBytes = s.result.in(Set("saved", "lost", "reencoded")) implies
    s.casAttempted and s.expected == s.before and s.stored == s.proposed
  val ConflictMeansDifferentExpectedBytes = (s.result == "conflict") implies s.casAttempted and s.expected != s.before
  val LostAcknowledgementKeepsObservedBytes = (s.result == "lost") implies s.caches.get(s.actor).raw == s.expected
  val GuardNeverReachesHost = (s.result == "guard") implies not(s.casAttempted)
  val safety = ExistingIntentOnlyAdvancesPhase and RefusedWritesLeaveExactBytes and CommittedWritesUseExactExpectedBytes
    and ConflictMeansDifferentExpectedBytes and LostAcknowledgementKeepsObservedBytes and GuardNeverReachesHost

  action step = any {
    all {s.operations < 12, { nondet tab = Tabs.oneOf()
      read(tab) }},
    all {s.operations < 12, { nondet tab = Tabs.oneOf()
      reopen(tab) }},
    all {s.operations < 12, { nondet tab = Tabs.oneOf()
      nondet payload = Payloads.oneOf()
      nondet phase = Phases.oneOf()
      nondet fault = Faults.oneOf()
      save(tab, payload, phase, fault) }},
    all {s.operations < 12, { nondet tab = Tabs.oneOf()
      nondet fault = Faults.oneOf()
      save(tab, 0, "none", fault) }},
    hostReencode, s' = s,
  }

  run reviewedIntentAdvancesWithoutPayloadChangeTest = startState(0, "none", false)
    .then(save(1, 1, "review", "none")).then(save(1, 1, "dispatched", "none"))
    .expect(s.stored.phase == "dispatched" and s.stored.payload == 1 and safety)
  run legacyRetryUsesOriginalNoncanonicalBytesTest = startState(1, "legacy", true)
    .then(read(1)).then(save(1, 1, "dispatched", "none"))
    .expect(s.expected.pretty and s.stored.phase == "dispatched" and safety)
  run changedPayloadAndDowngradeCannotReachHostTest = startState(1, "review", false)
    .then(save(1, 2, "dispatched", "none")).expect(s.result == "guard" and s.compares == 0)
    .then(save(1, 1, "dispatched", "none")).then(save(1, 1, "review", "none"))
    .expect(s.result == "guard" and s.stored.phase == "dispatched" and safety)
  run staleTabCannotAdvanceOrClearAnotherCommitTest = startState(1, "review", false).then(read(1)).then(read(2))
    .then(save(1, 1, "dispatched", "none")).then(save(2, 1, "dispatched", "none"))
    .expect(s.result == "conflict").then(save(2, 0, "none", "none"))
    .expect(s.result == "conflict" and s.stored.phase == "dispatched" and safety)
  run lostAcknowledgementRequiresReadbackTest = startState(1, "review", false).then(save(1, 1, "dispatched", "after"))
    .expect(s.result == "lost" and s.stored.phase == "dispatched" and safety)
    .then(save(1, 1, "dispatched", "none")).expect(s.result == "conflict")
    .then(reopen(1)).then(read(1)).then(save(1, 1, "dispatched", "none"))
    .expect(s.result == "saved" and s.commits == 2 and safety)
  run rawByteDriftRejectsEquivalentLegacyRetryTest = startState(1, "legacy", true).then(read(1))
    .then(hostReencode).then(save(1, 1, "dispatched", "none"))
    .expect(s.result == "conflict" and s.stored.phase == "legacy" and s.expected.pretty and safety)
}
