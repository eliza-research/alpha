/// One agent automation in the Automations list, and the journal entry of a change to it.
/// A change is recorded before it is sent and released when its outcome is known: by the reply,
/// by a definite refusal, by a complete fresh list that proves it, or by the owner after
/// checking the record. A list proves a removal when the row is gone and an enable or disable
/// when the row shows the requested value. It never proves a run request, and a list with a
/// failed source proves nothing.
module AutomationRequestSettlement {
  type Req = { id: int, kind: str, target: bool }
  type Automations = {
    exists: bool, enabled: bool, runs: int,
    loaded: bool, complete: bool, knownExists: bool, knownEnabled: bool,
    retained: Req, busy: bool, flight: Set[Req], reply: str, unknown: bool,
    admissions: int, deletes: int, lastRelease: str, releasedKind: str, releasedOn: str, lateApplied: bool
  }
  var s: Automations
  pure val none: Req = { id: 0, kind: "none", target: false }
  action init = s' = {
    exists: true, enabled: false, runs: 0,
    loaded: true, complete: true, knownExists: true, knownEnabled: false,
    retained: none, busy: false, flight: Set(), reply: "none", unknown: false,
    admissions: 0, deletes: 0, lastRelease: "none", releasedKind: "none", releasedOn: "none", lateApplied: false }
  pure def release(v: Automations, why: str): Automations =
    { ...v, retained: none, unknown: false, lastRelease: why, releasedKind: v.retained.kind,
      releasedOn: if (why != "list") "none" else if (v.complete) "complete" else "partial" }
  /// A change needs a list read for this connection and no retained change on the row.
  action change(kind: str, target: bool): bool = all {
    s.loaded, s.knownExists, not(s.busy), s.retained == none, s.admissions < 3,
    kind == "enable" implies target != s.knownEnabled,
    val req = { id: s.admissions + 1, kind: kind, target: if (kind == "enable") target else false }
    s' = { ...s, retained: req, busy: true, flight: s.flight.union(Set(req)), reply: "none",
      admissions: s.admissions + 1 }
  }
  /// The agent applies a request to the row it names, or refuses one for a row that is gone.
  action serverTake(r: Req): bool = all {
    s.flight.contains(r),
    val answered = s.busy and s.retained == r
    val late = s.retained != r
    if (not(s.exists))
      s' = { ...s, flight: s.flight.exclude(Set(r)), reply: if (answered) "rejected" else s.reply }
    else s' = { ...s, flight: s.flight.exclude(Set(r)),
      exists: r.kind != "delete", enabled: if (r.kind == "enable") r.target else s.enabled,
      runs: if (r.kind == "fire") s.runs + 1 else s.runs,
      deletes: if (r.kind == "delete") s.deletes + 1 else s.deletes,
      lateApplied: s.lateApplied or (late and r.kind == "enable" and r.target != s.enabled),
      reply: if (answered) "ok" else s.reply }
  }
  action requestLost(r: Req): bool = all { s.flight.contains(r), s' = { ...s, flight: s.flight.exclude(Set(r)) } }
  action okReply = all { s.busy, s.reply == "ok", s' = { ...release(s, "reply"), busy: false, reply: "none" } }
  /// A definite refusal is a known non-change.
  action refusedReply = all {
    s.busy, s.reply == "rejected", s' = { ...release(s, "refused"), busy: false, reply: "none" }
  }
  /// No answer, or one that does not say what happened: the entry stays and the row is locked.
  action unknownReply = all { s.busy, s' = { ...s, busy: false, reply: "none", unknown: true } }
  /// A list read. Only a read with every source answered settles a retained change.
  action refresh(complete: bool): bool = all {
    not(s.busy),
    val read = { ...s, loaded: true, complete: complete, knownExists: s.exists, knownEnabled: s.enabled }
    val proven = complete and (
      (s.retained.kind == "delete" and not(s.exists)) or
      (s.retained.kind == "enable" and s.exists and s.enabled == s.retained.target))
    if (proven) s' = release(read, "list") else s' = read
  }
  /// The owner releases an unconfirmed change after checking the record. Nothing is sent again.
  action allowAnother = all { not(s.busy), s.retained != none, s' = release(s, "owner") }
  /// Another connection: nothing may be changed until its list has been read.
  action switchConnection = s' = { ...s, loaded: false, busy: false, reply: "none" }
  /// Someone else enables or disables the automation.
  action remoteToggle = all { s.exists, s' = { ...s, enabled: not(s.enabled) } }
  action step = any {
    change("delete", false), change("enable", true), change("enable", false), change("fire", false),
    okReply, refusedReply, unknownReply, refresh(true), refresh(false), allowAnother,
    switchConnection, remoteToggle,
    { nondet r = s.flight.oneOf()
      any { serverTake(r), requestLost(r) } },
    s' = s
  }
  val BusyMeansRetained = s.busy implies s.retained != none
  val UnknownStaysLocked = s.unknown implies s.retained != none
  val RunNeverSettledByList = s.lastRelease == "list" implies s.releasedKind.in(Set("delete", "enable"))
  val PartialListSettlesNothing = s.releasedOn != "partial"
  /// A removal is applied at most once, and one the list settled can never apply later.
  val RemovedOnce = s.deletes <= 1 and (s.deletes == 1 implies not(s.exists))
  val OneRetainedAtATime = s.flight.forall(r => r.id <= s.admissions) and s.retained.id.in(Set(0, s.admissions))
  val TypeOK = s.reply.in(Set("none", "ok", "rejected")) and s.admissions.in(0.to(3)) and s.runs.in(0.to(3))
    and s.lastRelease.in(Set("none", "reply", "refused", "list", "owner"))
  val safety = TypeOK and BusyMeansRetained and UnknownStaysLocked and RunNeverSettledByList
    and PartialListSettlesNothing and RemovedOnce and OneRetainedAtATime
  val ListSettledRemovalWitness = s.lastRelease == "list" and s.releasedKind == "delete" and s.retained == none
  val RunStaysLockedWitness = s.retained.kind == "fire" and s.unknown and s.runs == 1 and s.complete and s.loaded
  val PartialListKeepsLockWitness = s.retained.kind == "delete" and not(s.exists) and not(s.complete) and not(s.busy)
  /// A list that showed the requested value released an enable whose request was still on its
  /// way; that request later undid a newer choice.
  val LateEnableOverridesWitness = s.lateApplied
  run lostReplyRemovalSettledByListTest = init.then(change("delete", false))
    .then(serverTake({ id: 1, kind: "delete", target: false })).then(unknownReply)
    .expect(s.unknown and s.retained.kind == "delete" and safety)
    .then(refresh(true)).expect(s.retained == none and s.lastRelease == "list" and not(s.knownExists) and safety)
  run partialListSettlesNothingTest = init.then(change("delete", false))
    .then(serverTake({ id: 1, kind: "delete", target: false })).then(unknownReply).then(refresh(false))
    .expect(s.retained.kind == "delete" and s.unknown and safety)
    .then(change("fire", false).fail())
  run runRequestNeedsOwnerTest = init.then(change("fire", false))
    .then(serverTake({ id: 1, kind: "fire", target: false })).then(unknownReply).then(refresh(true))
    .expect(s.retained.kind == "fire" and s.runs == 1 and safety)
    .then(allowAnother).expect(s.retained == none and s.lastRelease == "owner" and s.runs == 1 and safety)
  run refusedChangeReleasedTest = init.then(change("delete", false))
    .then(serverTake({ id: 1, kind: "delete", target: false })).then(okReply).then(refresh(true))
    .expect(not(s.knownExists) and s.retained == none and safety)
    .then(change("fire", false).fail())
  run unreadConnectionBlocksChangeTest = init.then(switchConnection).then(change("enable", true).fail())
  /// The list shows the requested value because someone else set it. The delayed request is
  /// released, and later overrides a newer choice.
  run lateEnableOverridesTest = init.then(change("enable", true)).then(unknownReply).then(remoteToggle)
    .then(refresh(true)).expect(s.retained == none and s.lastRelease == "list" and s.flight.size() == 1 and safety)
    .then(change("enable", false)).then(serverTake({ id: 2, kind: "enable", target: false })).then(okReply)
    .expect(not(s.enabled) and safety)
    .then(serverTake({ id: 1, kind: "enable", target: true })).expect(s.enabled and s.lateApplied and safety)
}
