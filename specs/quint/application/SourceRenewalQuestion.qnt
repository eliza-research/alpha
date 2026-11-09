// A notification Ask reviews one exact phone-source tap before composing.
module SourceRenewalQuestion {
  type State = {
    owner: int, visited: Set[int], pending: int, exact: bool, dialog: int,
    reading: Set[int], settling: Set[int], interrupted: Set[int],
    attempts: Set[int], discarded: Set[int], drafts: Set[int],
    sensitive: bool, composer: bool, notice: str, reportedBy: int
  }
  var s: State
  pure val Owners = Set(1, 2)
  action init = s' = {
    owner: 0, visited: Set(), pending: 0, exact: false, dialog: 0,
    reading: Set(), settling: Set(), interrupted: Set(),
    attempts: Set(), discarded: Set(), drafts: Set(),
    sensitive: false, composer: true, notice: "", reportedBy: 0
  }

  val waiting = s.reading.union(s.settling)
  val reviewing = s.dialog != 0 or s.owner.in(waiting.exclude(s.interrupted))

  action attach(id: int): bool = all {
    id.in(Owners), not(id.in(s.visited)),
    val show = s.pending == id and s.exact and not(s.sensitive)
    s' = {...s, owner: id, visited: s.visited.union(Set(id)), dialog: if (show) id else 0, notice: "synced", reportedBy: 0,
      interrupted: s.interrupted.union(waiting.intersect(Set(s.owner)))},
  }
  action notify(id: int, exact: bool): bool = all {
    id.in(Owners),
    val show = s.owner == id and exact and not(s.sensitive) and not(reviewing)
    s' = {...s, pending: id, exact: exact, dialog: if (show) id else s.dialog},
  }
  action accept = all {
    s.dialog == s.owner, s.dialog != 0, not(s.sensitive), not(s.owner.in(waiting)),
    s' = {...s, dialog: 0, reading: s.reading.union(Set(s.owner))},
  }
  action dismiss = all {
    s.dialog != 0,
    val exactTap = s.dialog == s.pending
    s' = {...s, dialog: 0, pending: if (exactTap) 0 else s.pending, exact: not(exactTap) and s.exact,
      discarded: if (exactTap) s.discarded.union(Set(s.dialog)) else s.discarded},
  }
  action interrupt = s' = {...s, dialog: 0, interrupted: s.interrupted.union(waiting.intersect(Set(s.owner)))}
  action sensitivity(blocked: bool): bool = s' = {...s, sensitive: blocked}
  action conversation(available: bool): bool = s' = {...s, composer: available}

  action readReply(id: int, matches: bool): bool = all {
    id.in(s.reading),
    val admit = id == s.owner and not(id.in(s.interrupted)) and matches and s.composer
      and not(s.sensitive) and s.pending == id and s.exact
    val report = id == s.owner and not(admit)
    s' = {...s, reading: s.reading.exclude(Set(id)), interrupted: s.interrupted.exclude(Set(id)),
      settling: if (admit) s.settling.union(Set(id)) else s.settling,
      attempts: if (admit) s.attempts.union(Set(id)) else s.attempts,
      notice: if (report) "refused" else s.notice, reportedBy: if (report) id else s.reportedBy},
  }
  action settleReply(id: int, success: bool): bool = all {
    id.in(s.settling),
    val retireTap = success and s.pending == id
    val compose = success and id == s.owner and not(id.in(s.interrupted)) and s.composer and not(s.sensitive)
    val report = id == s.owner and not(compose)
    s' = {...s, pending: if (retireTap) 0 else s.pending, exact: not(retireTap) and s.exact,
      settling: s.settling.exclude(Set(id)), interrupted: s.interrupted.exclude(Set(id)),
      drafts: if (compose) s.drafts.union(Set(id)) else s.drafts,
      notice: if (report) "refused" else s.notice, reportedBy: if (report) id else s.reportedBy},
  }
  action step = any {
    { nondet id = Owners.oneOf(); attach(id) },
    { nondet id = Owners.oneOf(); nondet exact = Set(true, false).oneOf(); notify(id, exact) },
    { nondet id = Owners.oneOf(); nondet matches = Set(true, false).oneOf(); readReply(id, matches) },
    { nondet id = Owners.oneOf(); nondet success = Set(true, false).oneOf(); settleReply(id, success) },
    { nondet blocked = Set(true, false).oneOf(); sensitivity(blocked) },
    { nondet available = Set(true, false).oneOf(); conversation(available) },
    accept, dismiss, interrupt, s' = s,
  }

  val DialogOwnedByCurrent = s.dialog == 0 or s.dialog == s.owner
  val FailureOwnedByCurrent = s.reportedBy == 0 or s.reportedBy == s.owner
  val DraftRequiresSettlement = s.drafts.subseteq(s.attempts)
  val StagesAreDisjoint = s.reading.intersect(s.settling) == Set() and s.interrupted.subseteq(waiting)
  val safety = DialogOwnedByCurrent and FailureOwnedByCurrent and DraftRequiresSettlement and StagesAreDisjoint

  run composeCurrentExactQuestionTest = init.then(attach(1)).then(notify(1, true)).then(accept)
    .then(readReply(1, true)).then(settleReply(1, true))
    .expect(s.drafts == Set(1) and s.pending == 0 and safety)
  run retiredSettlementDoesNotReportTest = init.then(attach(1)).then(notify(1, true)).then(accept)
    .then(readReply(1, true)).then(attach(2)).then(notify(2, true)).then(settleReply(1, true))
    .expect(s.notice == "synced" and s.drafts == Set() and s.pending == 2 and s.dialog == 2 and safety)
  run unavailableComposerPreservesTapTest = init.then(attach(1)).then(notify(1, true)).then(accept)
    .then(conversation(false)).then(readReply(1, true))
    .expect(s.pending == 1 and s.attempts == Set() and s.notice == "refused" and safety)
  run wrongSourceNeverOpensTest = init.then(attach(1)).then(notify(1, false))
    .expect(s.dialog == 0 and s.attempts == Set() and safety)
  run interruptedQuestionPreservesTapTest = init.then(attach(1)).then(notify(1, true)).then(interrupt)
    .expect(s.pending == 1 and s.dialog == 0 and s.discarded == Set() and safety)
  run explicitDismissalDiscardsExactTapTest = init.then(attach(1)).then(notify(1, true)).then(dismiss)
    .expect(s.pending == 0 and s.discarded == Set(1) and safety)
  run rejectedNativeSettlementKeepsTapTest = init.then(attach(1)).then(notify(1, true)).then(accept)
    .then(readReply(1, true)).then(settleReply(1, false))
    .expect(s.pending == 1 and s.drafts == Set() and s.notice == "refused" and safety)
}
