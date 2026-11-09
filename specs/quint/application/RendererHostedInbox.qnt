// Browser and Android renderer-fallback digest retention before provider acknowledgement.
module RendererHostedInbox {
  type State = {scope: str, phase: str, client: bool, cancelled: bool, result: str,
    rows: int -> int, retained: Set[int], removals: Set[int], notices: Set[int],
    getCalls: int, ackCalls: int, ackCommits: int, lastAck: int, waitingAck: int,
    noticeCalls: int, posted: int}
  var s: State
  pure val IDs = Set(1, 2)
  pure val Versions = Set(1, 2)
  pure val Scopes = Set("browser", "fallback")
  pure val Seeds = Set("empty", "evicted", "retained")
  pure val Faults = Set("none", "rowBefore", "rowAfter", "indexBefore", "indexAfter", "noticeClear")
  pure val NoticeReplies = Set("ok", "refused", "lost")
  pure val AckReplies = Set("ok", "refused", "lost")
  pure def end(x: State, result: str): State = {...x, phase: "idle", result: result, waitingAck: 0}

  action initFor(scope: str, seed: str): bool = all {
    Scopes.contains(scope), Seeds.contains(seed),
    s' = {scope: scope, phase: "idle", client: seed != "empty", cancelled: false, result: "",
      rows: IDs.mapBy(id => if (id == 1 and seed != "empty") 1 else 0),
      retained: if (seed == "retained") Set(1) else Set(),
      removals: if (seed == "empty") Set() else Set(1), notices: Set(),
      getCalls: 0, ackCalls: 0, ackCommits: 0, lastAck: 0, waitingAck: 0, noticeCalls: 0, posted: 0},
  }
  action init = { nondet scope = Scopes.oneOf(); nondet seed = Seeds.oneOf(); initFor(scope, seed) }
  action start = all {
    s.phase == "idle",
    s' = {...s, phase: "results", cancelled: false, client: true, removals: Set(), notices: Set(),
      rows: IDs.mapBy(id => if (s.removals.contains(id) and not(s.retained.contains(id))) 0 else s.rows.get(id)),
      noticeCalls: s.noticeCalls + s.notices.size(), posted: s.posted + s.notices.size(),
      getCalls: s.getCalls + 1},
  }
  action abort = all { s.phase != "idle", s' = {...s, cancelled: true} }
  action emptyPage = all {
    s.phase == "results",
    s' = end(s, if (s.cancelled) "aborted" else "complete"),
  }

  pure def recordRow(x: State, id: int, version: int, fault: str, notice: str): State = {
    val existing = x.rows.get(id)
    val stored = {...x, rows: x.rows.set(id, version)}
    val notices = if (x.retained.contains(id)) x.notices else x.notices.union(Set(id))
    val indexed = {...stored, retained: x.retained.union(Set(id)), notices: notices}
    val attempts = if (fault == "noticeClear" and notice == "ok" and notices.size() > 0) 1 else notices.size()
    val attempted = {...indexed, noticeCalls: x.noticeCalls + attempts,
      posted: x.posted + if (notice == "refused") 0 else attempts}
    val drained = if (notice == "ok") {...attempted, notices: Set()} else attempted
    if (existing != 0 and existing != version) end(x, "changed")
    else if (existing == 0 and fault == "rowBefore") end(x, "refused")
    else if ((existing == 0 and fault == "rowAfter") or fault == "indexBefore") end(stored, "refused")
    else if (fault == "indexAfter") end(indexed, "refused")
    else if (notice == "ok" and notices.size() > 0 and fault == "noticeClear") end(attempted, "refused")
    else {...drained, phase: "ack", waitingAck: id, ackCalls: x.ackCalls + 1}
  }
  action deliver(id: int, version: int, fault: str, notice: str): bool = all {
    s.phase == "results", IDs.contains(id), Versions.contains(version),
    Faults.contains(fault), NoticeReplies.contains(notice),
    s' = if (s.cancelled) end(s, "aborted") else recordRow(s, id, version, fault, notice),
  }
  action acknowledge(reply: str): bool = all {
    s.phase == "ack", AckReplies.contains(reply),
    val accepted = reply != "refused"
    val updated = {...s, waitingAck: 0,
      ackCommits: s.ackCommits + if (accepted) 1 else 0,
      lastAck: if (accepted) s.waitingAck else s.lastAck}
    s' = if (s.cancelled and reply == "ok") end(updated, "aborted")
      else if (reply != "ok") end(updated, "refused")
      else {...updated, phase: "results", getCalls: s.getCalls + 1},
  }
  action step = any {
    start, abort, emptyPage,
    { nondet id = IDs.oneOf(); nondet version = Versions.oneOf(); nondet fault = Faults.oneOf();
      nondet notice = NoticeReplies.oneOf(); deliver(id, version, fault, notice) },
    { nondet reply = AckReplies.oneOf(); acknowledge(reply) },
  }
  val safety = all {
    s.retained.forall(id => s.rows.get(id) != 0),
    s.notices.subseteq(s.retained),
    (s.phase == "ack") == (s.waitingAck != 0),
    s.phase == "ack" implies s.retained.contains(s.waitingAck),
    s.ackCommits <= s.ackCalls,
    s.posted <= s.noticeCalls,
  }
  run orphanReadBackBeforeAcknowledgementTest = initFor("browser", "empty")
    .then(start).then(deliver(1, 1, "rowAfter", "ok")).expect(s.rows.get(1) == 1 and s.retained.size() == 0)
    .then(start).then(deliver(1, 1, "none", "ok")).then(acknowledge("ok")).then(emptyPage)
    .expect(s.retained == Set(1) and s.ackCommits == 1 and safety)
  run staleProviderBodyCannotReplaceHistoryTest = initFor("fallback", "retained")
    .then(start).then(deliver(1, 2, "none", "ok"))
    .expect(s.result == "changed" and s.rows.get(1) == 1 and s.ackCalls == 0 and safety)
  run refusedNoticeRetainsRetryTest = initFor("browser", "empty")
    .then(start).then(deliver(1, 1, "none", "refused")).then(acknowledge("lost"))
    .expect(s.ackCommits == 1 and s.notices == Set(1))
    .then(start).then(emptyPage).expect(s.notices.size() == 0 and s.posted == 1 and safety)
  run retirementAfterAckDispatchKeepsDurableResultTest = initFor("browser", "empty")
    .then(start).then(deliver(2, 1, "none", "ok")).then(abort).then(acknowledge("ok"))
    .expect(s.result == "aborted" and s.ackCommits == 1 and s.retained == Set(2) and safety)
}
