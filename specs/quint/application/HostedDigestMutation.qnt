// Renderer journal and publication ownership during a scheduled digest save.
module HostedDigestMutation {
  type State = {owner: int, visited: Set[int], loaded: bool, pending: str, busy: bool, notice: str,
    journal: int -> str, stage: int -> str, mutations: Set[int], removes: Set[int], refreshes: Set[int],
    calls: int -> int, reviewWrites: int -> int, dispatchWrites: int -> int}
  var s: State
  pure val Owners = Set(1, 2)
  pure val JournalPhases = Set("", "review", "dispatched", "legacy")
  pure val Replies = Set("saved", "rejected", "unconfirmed")
  pure def idle(x: State, owner: int): State = {...x, stage: x.stage.set(owner, "")}

  action initFor(first: str, second: str): bool = all {
    JournalPhases.contains(first), JournalPhases.contains(second),
    s' = {owner: 0, visited: Set(), loaded: false, pending: "", busy: false, notice: "",
      journal: Map(1 -> first, 2 -> second), stage: Owners.mapBy(_ => ""),
      mutations: Set(), removes: Set(), refreshes: Set(), calls: Owners.mapBy(_ => 0),
      reviewWrites: Owners.mapBy(_ => 0), dispatchWrites: Owners.mapBy(_ => 0)},
  }
  action init = {
    nondet first = JournalPhases.oneOf()
    nondet second = JournalPhases.oneOf()
    initFor(first, second)
  }
  action attach(owner: int): bool = all {
    Owners.contains(owner), not(s.visited.contains(owner)),
    s' = {...s, owner: owner, visited: s.visited.union(Set(owner)), loaded: false, pending: "", busy: false},
  }
  // History, a successful read and opening the panel are grouped before any mutation tap.
  action restore(owner: int): bool = all {
    owner == s.owner, Owners.contains(owner), not(s.loaded), s.refreshes == Set(),
    s' = {...s, loaded: true, pending: s.journal.get(owner), notice: ""},
  }
  action retry(owner: int): bool = all {
    Owners.contains(owner), owner == s.owner, s.loaded, s.pending != "", not(s.busy), s.stage.get(owner) == "",
    val review = s.pending == "review"
    s' = {...s, busy: true, pending: "dispatched", journal: s.journal.set(owner, "dispatched"),
      stage: s.stage.set(owner, "mutation"), mutations: s.mutations.union(Set(owner)),
      calls: s.calls.set(owner, s.calls.get(owner) + 1),
      reviewWrites: s.reviewWrites.set(owner, s.reviewWrites.get(owner) + if (review) 1 else 0),
      dispatchWrites: s.dispatchWrites.set(owner, s.dispatchWrites.get(owner) + if (review) 1 else 2)},
  }
  action discard(owner: int): bool = all {
    Owners.contains(owner), owner == s.owner, s.loaded, s.pending == "review", not(s.busy), s.stage.get(owner) == "",
    s' = {...s, stage: s.stage.set(owner, "discard"), removes: s.removes.union(Set(owner))},
  }
  action mutationReply(owner: int, reply: str): bool = all {
    s.mutations.contains(owner), Replies.contains(reply),
    val returned = {...s, mutations: s.mutations.exclude(Set(owner))}
    s' = if (owner != s.owner) idle(returned, owner)
      else if (reply == "unconfirmed") {...idle(returned, owner), busy: false, notice: "unconfirmed"}
      else {...returned, stage: s.stage.set(owner, reply), removes: s.removes.union(Set(owner))},
  }
  action removeReply(owner: int, ok: bool): bool = all {
    s.removes.contains(owner),
    val phase = s.stage.get(owner)
    val returned = {...s, removes: s.removes.exclude(Set(owner)),
      journal: if (ok) s.journal.set(owner, "") else s.journal}
    s' = if (owner != s.owner) idle(returned, owner)
      else if (not(ok)) {...idle(returned, owner), busy: false,
        notice: if (phase == "discard") "discardRefused" else if (phase == "rejected") "clearRefused" else "unconfirmed"}
      else if (phase == "discard") {...idle(returned, owner), pending: "", notice: "discarded"}
      else {...returned, pending: "", stage: s.stage.set(owner, if (phase == "rejected") "refresh-rejected" else "refresh-saved"), refreshes: s.refreshes.union(Set(owner))},
  }
  action refreshReply(owner: int): bool = all {
    s.refreshes.contains(owner),
    val settled = idle({...s, refreshes: s.refreshes.exclude(Set(owner))}, owner)
    s' = if (owner != s.owner) settled
      else {...settled, busy: false, notice: if (s.stage.get(owner) == "refresh-rejected") "sourceRejected" else ""},
  }
  action step = any {
    { nondet owner = Owners.oneOf(); attach(owner) },
    { nondet owner = Owners.oneOf(); restore(owner) },
    { nondet owner = Owners.oneOf(); retry(owner) },
    { nondet owner = Owners.oneOf(); discard(owner) },
    { nondet owner = Owners.oneOf(); nondet reply = Replies.oneOf(); mutationReply(owner, reply) },
    { nondet owner = Owners.oneOf(); nondet ok = Bool.oneOf(); removeReply(owner, ok) },
    { nondet owner = Owners.oneOf(); refreshReply(owner) },
  }
  val safety = all {
    JournalPhases.contains(s.pending),
    s.pending != "" implies s.loaded and Owners.contains(s.owner),
    s.refreshes.size() <= 1,
    s.busy implies s.loaded and (s.mutations.union(s.removes).union(s.refreshes)).contains(s.owner),
    s.mutations.forall(owner => s.journal.get(owner) == "dispatched"),
    Owners.forall(owner => s.reviewWrites.get(owner) + s.dispatchWrites.get(owner) == s.calls.get(owner) * 2),
    s.mutations.intersect(s.removes.union(s.refreshes)) == Set(),
    s.removes.intersect(s.refreshes) == Set(),
  }
  run retiredJournalClearDoesNotRefreshReplacementTest = initFor("dispatched", "legacy").then(attach(1))
    .then(restore(1)).then(retry(1)).then(mutationReply(1, "saved")).then(attach(2)).then(removeReply(1, true))
    .expect(s.journal.get(1) == "" and s.journal.get(2) == "legacy" and s.refreshes == Set() and safety)
  run oldCleanupKeepsNewSaveBusyTest = initFor("review", "legacy").then(attach(1)).then(restore(1))
    .then(retry(1)).then(mutationReply(1, "saved")).then(attach(2)).then(restore(2)).then(retry(2))
    .then(removeReply(1, true)).expect(s.busy and s.mutations == Set(2) and safety)
  run lateRejectionCannotPublishToReplacementTest = initFor("dispatched", "dispatched").then(attach(1))
    .then(restore(1)).then(retry(1)).then(mutationReply(1, "rejected")).then(removeReply(1, true))
    .then(attach(2)).then(refreshReply(1)).expect(s.notice == "" and s.journal.get(2) == "dispatched" and safety)
  run unconfirmedRemoteKeepsExactRetryTest = initFor("review", "").then(attach(1)).then(restore(1))
    .then(retry(1)).then(mutationReply(1, "unconfirmed"))
    .expect(s.pending == "dispatched" and s.journal.get(1) == "dispatched" and not(s.busy) and safety)
  run discardClearsOnlyAnUnsentReviewTest = initFor("review", "legacy").then(attach(1)).then(restore(1))
    .then(discard(1)).then(removeReply(1, true)).expect(s.notice == "discarded" and s.calls.get(1) == 0 and safety)
}
