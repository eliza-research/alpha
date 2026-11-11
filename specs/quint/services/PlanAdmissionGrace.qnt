/// The stored plan admission record and what an admission does with it: an unreachable Cloud keeps
/// the binding only under a recent record for the same sign-in, and a plan end already past is
/// never carried forward.
module PlanAdmissionGrace {
  type Record = { present: bool, credential: int, age: str, endsAt: str }
  type State = {
    credential: int, record: Record,
    // The plan end held in memory for the signed-in account, and the end a redeemed code reported
    // for this sign-in ("unset": none redeemed).
    memoryEndsAt: str, redeemedEnd: str,
    binding: str, admittedBy: str, notice: str,
    // The plan end the most recent record write stored.
    lastWrittenEnd: str, writes: int
  }
  var s: State
  pure val NO_RECORD = { present: false, credential: 0, age: "fresh", endsAt: "none" }
  action init = s' = {
    credential: 0, record: NO_RECORD, memoryEndsAt: "none", redeemedEnd: "unset",
    binding: "none", admittedBy: "none", notice: "none", lastWrittenEnd: "none", writes: 0
  }
  /// The record this sign-in may rely on: its own, verified within the offline window, with no
  /// plan end already past.
  pure def recent(record: Record, credential: int): bool =
    record.present and credential != 0 and record.credential == credential and record.age == "fresh" and record.endsAt != "past"
  /// The end of the plan window: none for credits, the end Cloud reported with an active plan,
  /// otherwise the last known end. An active plan just read outlives a known end already past.
  pure def planWindowEnd(kind: str, reported: str, lastKnown: str): str =
    if (kind == "credits") "none"
    else if (kind == "active" and reported == "future") "future"
    else if (kind == "active" and lastKnown == "past") "none"
    else lastKnown
  /// A redeemed grant's end comes first, then a recent record's, then the one held in memory.
  def lastKnownEnd: str =
    if (s.redeemedEnd != "unset") s.redeemedEnd
    else if (recent(s.record, s.credential) and s.record.endsAt != "none") s.record.endsAt else s.memoryEndsAt
  action signIn(credential: int): bool = all {
    credential.in(Set(1, 2)), credential != s.credential,
    s' = { ...s, credential: credential, memoryEndsAt: "none", redeemedEnd: "unset", binding: "none", admittedBy: "none", notice: "none" }
  }
  action signOut = all {
    s.credential != 0,
    s' = { ...s, credential: 0, memoryEndsAt: "none", redeemedEnd: "unset", binding: "unbound", admittedBy: "none", notice: "sign-in" }
  }
  /// No stored sign-in, or a newer credential replaced the one being admitted: nothing is bound
  /// and the record is left to the newer sign-in.
  action admitWithoutAccount = s' = { ...s, binding: "unbound", admittedBy: "none", notice: "sign-in", memoryEndsAt: "none" }
  /// Cloud refused this sign-in, at admission or on a background refresh: its offline grace ends.
  action signInRejected = all {
    s.credential != 0,
    s' = { ...s, record: NO_RECORD, binding: "unbound", admittedBy: "none", notice: "sign-in", memoryEndsAt: "none" }
  }
  /// A redeemed code reports the grant's end for this sign-in and updates its stored record.
  action redeem(end: str): bool = all {
    s.credential != 0, s.binding == "cloud", end.in(Set("none", "future")),
    val mine = s.record.present and s.record.credential == s.credential
    s' = { ...s, redeemedEnd: end, memoryEndsAt: end,
      record: if (mine) { ...s.record, endsAt: end } else s.record,
      lastWrittenEnd: if (mine) end else s.lastWrittenEnd }
  }
  /// Cloud cannot be reached for the account or its plan: a recent record keeps the stored binding.
  action admitOffline = all {
    s.credential != 0,
    val kept = recent(s.record, s.credential)
    s' = { ...s, binding: if (kept) "kept" else "unbound", admittedBy: if (kept) "grace" else "none",
      notice: "offline", memoryEndsAt: if (kept) s.record.endsAt else "none" }
  }
  /// The account answered but billing did not: a recent record admits, and nothing is written.
  action admitBillingOutage = all {
    s.credential != 0,
    val admitted = recent(s.record, s.credential)
    s' = { ...s, binding: if (admitted) "cloud" else "unbound", admittedBy: if (admitted) "grace" else "none",
      notice: if (admitted) "none" else "needs-plan",
      memoryEndsAt: if (admitted) planWindowEnd("unavailable", "none", lastKnownEnd) else "none" }
  }
  /// Cloud verified an admitting plan (at admission or on a background refresh): the record is
  /// rewritten for this sign-in with a plan end that is still ahead, or none.
  action verified(kind: str, reported: str): bool = all {
    s.credential != 0, s.writes < 4, kind.in(Set("active", "credits")), reported.in(Set("none", "future")),
    val end = planWindowEnd(kind, reported, lastKnownEnd)
    s' = { ...s, record: { present: true, credential: s.credential, age: "fresh", endsAt: end },
      memoryEndsAt: end, binding: "cloud", admittedBy: "verified", notice: "none",
      lastWrittenEnd: end, writes: s.writes + 1 }
  }
  /// A background refresh that failed leaves the record as it was.
  action refreshFailed = all { s.binding == "cloud", s' = s }
  /// Cloud verified there is no plan: the record is removed and inference is unbound.
  action planEnded = all {
    s.credential != 0,
    s' = { ...s, record: NO_RECORD, memoryEndsAt: "none", binding: "unbound", admittedBy: "none", notice: "plan-ended" }
  }
  action windowPasses = all { s.record.present, s.record.age == "fresh", s' = { ...s, record: { ...s.record, age: "old" } } }
  /// The plan end is reached while the process keeps running.
  action endPasses = all {
    s.record.endsAt == "future" or s.memoryEndsAt == "future" or s.redeemedEnd == "future",
    s' = { ...s, record: { ...s.record, endsAt: if (s.record.endsAt == "future") "past" else s.record.endsAt },
      memoryEndsAt: if (s.memoryEndsAt == "future") "past" else s.memoryEndsAt,
      redeemedEnd: if (s.redeemedEnd == "future") "past" else s.redeemedEnd }
  }
  action step = any {
    signIn(1), signIn(2), signOut, admitWithoutAccount, signInRejected, redeem("none"), redeem("future"),
    admitOffline, admitBillingOutage,
    verified("active", "none"), verified("active", "future"), verified("credits", "none"),
    refreshFailed, planEnded, windowPasses, endPasses, s' = s
  }
  /// A record is never written with a plan end that has already passed.
  val EndsAtNotPast = s.lastWrittenEnd != "past"
  /// An admission without Cloud's answer rests on this sign-in's own record.
  val GraceBoundToCredential = s.admittedBy == "grace" implies
    s.record.present and s.record.credential == s.credential and s.credential != 0
  val KeptOnlyOffline = s.binding == "kept" implies s.notice == "offline" and s.admittedBy == "grace"
  val CloudBindingHasBasis = s.binding == "cloud" implies s.admittedBy != "none" and s.credential != 0
  val PlanEndedRemovesRecord = s.notice == "plan-ended" implies not(s.record.present) and s.binding == "unbound"
  val RedeemedEndBelongsToSignIn = s.redeemedEnd != "unset" implies s.credential != 0
  val SignedOutUnbound = s.credential == 0 implies s.binding.in(Set("none", "unbound")) and s.admittedBy == "none"
  val TypeOK = s.credential.in(0.to(2)) and s.binding.in(Set("none", "cloud", "unbound", "kept"))
    and s.admittedBy.in(Set("none", "verified", "grace"))
    and s.notice.in(Set("none", "offline", "needs-plan", "plan-ended", "sign-in"))
    and s.record.endsAt.in(Set("none", "future", "past")) and s.memoryEndsAt.in(Set("none", "future", "past"))
    and s.redeemedEnd.in(Set("unset", "none", "future", "past"))
    and s.record.age.in(Set("fresh", "old")) and s.writes.in(0.to(4))
  val safety = TypeOK and EndsAtNotPast and GraceBoundToCredential and KeptOnlyOffline and CloudBindingHasBasis and
    PlanEndedRemovesRecord and SignedOutUnbound and RedeemedEndBelongsToSignIn

  val KeptOfflineWitness = s.binding == "kept"
  val PastEndInMemoryWitness = s.memoryEndsAt == "past" and s.binding == "cloud"
  val OtherAccountRecordWitness = s.record.present and s.credential != 0 and s.record.credential != s.credential and s.binding == "unbound" and s.notice == "offline"
  val OldRecordUnbindsWitness = s.record.present and s.record.age == "old" and s.binding == "unbound" and s.notice == "offline"
  val BillingOutageAdmitsWitness = s.binding == "cloud" and s.admittedBy == "grace"
  val RedeemedEndPastWitness = s.redeemedEnd == "past" and s.binding == "cloud"

  /// A renewal checked after the old plan end has passed stores no past end, so the next outage
  /// still keeps the binding.
  run renewalAfterPastEndTest = init.then(signIn(1)).then(verified("active", "future")).then(endPasses)
    .expect(PastEndInMemoryWitness and s.record.endsAt == "past")
    .then(verified("active", "none"))
    .expect(s.record.endsAt == "none" and s.lastWrittenEnd == "none" and s.memoryEndsAt == "none" and safety)
    .then(admitOffline).expect(KeptOfflineWitness and safety)
  run offlineGraceTest = init.then(signIn(1)).then(verified("credits", "none")).then(admitOffline)
    .expect(s.binding == "kept" and s.admittedBy == "grace" and safety)
    .then(windowPasses).then(admitOffline).expect(OldRecordUnbindsWitness and safety)
  run otherAccountRecordIgnoredTest = init.then(signIn(1)).then(verified("active", "none"))
    .then(signIn(2)).then(admitOffline).expect(OtherAccountRecordWitness and safety)
    .then(admitBillingOutage).expect(s.binding == "unbound" and s.notice == "needs-plan" and safety)
  run billingOutageAdmitsFromRecordTest = init.then(signIn(1)).then(verified("active", "future"))
    .then(admitBillingOutage).expect(BillingOutageAdmitsWitness and s.memoryEndsAt == "future" and s.writes == 1 and safety)
  run planEndedRemovesGraceTest = init.then(signIn(1)).then(verified("active", "none")).then(planEnded)
    .then(admitOffline).expect(s.binding == "unbound" and not(s.record.present) and safety)
  /// A record whose plan end has passed gives no offline grace.
  run pastEndGivesNoGraceTest = init.then(signIn(1)).then(verified("active", "future")).then(endPasses)
    .then(admitOffline).expect(s.binding == "unbound" and s.memoryEndsAt == "none" and safety)
  /// A sign-in Cloud refused loses its record; a later outage for the same key keeps nothing.
  run rejectedSignInForgetsGraceTest = init.then(signIn(1)).then(verified("active", "future")).then(signInRejected)
    .expect(not(s.record.present) and s.notice == "sign-in" and safety)
    .then(admitOffline).expect(s.binding == "unbound" and safety)
  /// A redeemed grant's end replaces the stored one, and once it has passed a verified active plan
  /// stores no end.
  run redeemedEndPrecedesRecordTest = init.then(signIn(1)).then(verified("active", "none")).then(redeem("future"))
    .expect(s.record.endsAt == "future" and s.memoryEndsAt == "future" and safety)
    .then(endPasses).expect(RedeemedEndPastWitness)
    .then(verified("active", "none")).expect(s.record.endsAt == "none" and s.lastWrittenEnd == "none" and safety)
}
