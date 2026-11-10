// Agent read-only filter coordinator, from a mounted Files Browse view.
module FilesFilter {
  type Operation = {kind: int, phase: str, queryTicket: int,
    aborted: bool, result: str, count: int}
  type State = {pending: int, filter: int, rows: List[int], access: str, stateGeneration: int,
    filterGeneration: int, writes: int, operations: int -> Operation}
  var s: State
  pure val Ids = 1.to(3)
  pure val Kinds = 1.to(2)
  pure val RowIds = 1.to(4)
  pure val Empty: Operation = {kind: 0, phase: "idle", queryTicket: 0,
    aborted: false, result: "none", count: 0}
  pure def Matches(kind: int): Set[int] = if (kind == 1) Set(1, 3) else Set(2, 3)
  pure def FilterRows(kind: int, input: Set[int]): List[int] =
    List(4, 3, 2, 1).select(row => Matches(kind).contains(row) and input.contains(row))
  pure def Settle(op: Operation, outcome: str, count: int): Operation =
    {...op, phase: "done", result: outcome, count: count}
  action init = s' = {pending: 0, filter: 0, rows: List(), access: "granted", stateGeneration: 1,
    filterGeneration: 0, writes: 0, operations: Ids.mapBy(_ => Empty)}
  action begin(id: int, kind: int): bool = all {
    Ids.contains(id), Kinds.contains(kind), s.operations.get(id).phase == "idle",
    val op = s.operations.get(id)
    if (op.aborted)
      s' = {...s, operations: s.operations.set(id, Settle({...op, kind: kind}, "aborted", 0))}
    else
      s' = {...s, pending: id, operations: s.operations.set(id, {...op, kind: kind, phase: "admission"})}
  }
  action abort(id: int): bool = all {
    Ids.contains(id), not(s.operations.get(id).aborted),
    s' = {...s, operations: s.operations.set(id, {...s.operations.get(id), aborted: true})}
  }
  action accessReply(id: int, access: str): bool = all {
    Ids.contains(id), Set("granted", "denied", "unavailable").contains(access),
    val op = s.operations.get(id)
    all {
      op.phase == "admission",
      if (s.pending == id and not(op.aborted) and access == "granted")
        s' = {...s, filter: id, rows: List(), filterGeneration: s.filterGeneration + 1,
          operations: s.operations.set(id, {...op, phase: "query", queryTicket: s.filterGeneration + 1})}
      else
        s' = {...s, pending: if (s.pending == id) 0 else s.pending,
          operations: s.operations.set(id, Settle(op, if (op.aborted) "aborted" else "failed", 0))}
    }
  }
  action queryReply(id: int, ready: bool, entries: Set[int]): bool = all {
    Ids.contains(id), entries.subseteq(RowIds), s.operations.get(id).phase == "query",
    val op = s.operations.get(id)
    val current = s.pending == id and s.filter == id and not(op.aborted) and op.queryTicket == s.filterGeneration
    val success = current and ready
    val rows = if (success) FilterRows(op.kind, entries) else List()
    s' = {...s, pending: if (s.pending == id) 0 else s.pending, rows: if (current) rows else s.rows,
      operations: s.operations.set(id, Settle(op, if (success) "succeeded" else if (op.aborted) "aborted" else "failed", rows.length()))}
  }
  action clear = all {s.filter != 0, s' = {...s, filter: 0, rows: List()}}
  // A reload with a pending agent filter owns only shared view state and skips a competing query.
  action reload = all {s.pending != 0, s.stateGeneration < 3, s' = {...s, stateGeneration: s.stateGeneration + 1}}
  action step = any {
    {nondet id = Ids.oneOf(); nondet kind = Kinds.oneOf(); begin(id, kind)},
    {nondet id = Ids.oneOf(); abort(id)},
    {nondet id = Ids.oneOf(); nondet access = Set("granted", "denied", "unavailable").oneOf(); accessReply(id, access)},
    {nondet id = Ids.oneOf(); nondet ready = Bool.oneOf(); nondet rows = RowIds.powerset().oneOf(); queryReply(id, ready, rows)},
    clear, reload, s' = s,
  }
  val TypeOK = s.pending.in(0.to(3)) and s.filter.in(0.to(3)) and s.stateGeneration.in(1.to(3))
    and s.filterGeneration.in(0.to(3)) and s.operations.keys() == Ids
    and s.access == "granted" and s.rows.length() <= 2
    and Ids.forall(id => {
      val op = s.operations.get(id)
      op.kind.in(0.to(2)) and op.phase.in(Set("idle", "admission", "query", "done"))
        and op.queryTicket.in(0.to(3)) and op.count.in(0.to(2))
        and op.result.in(Set("none", "failed", "aborted", "succeeded"))
    })
  val PendingOwnsRead = s.pending == 0 or Set("admission", "query").contains(s.operations.get(s.pending).phase)
  val CurrentRowsMatch = if (s.filter == 0) s.rows == List()
    else s.rows.indices().forall(i => Matches(s.operations.get(s.filter).kind).contains(s.rows.nth(i)))
  val FailureHasNoCount = Ids.forall(id => s.operations.get(id).result != "succeeded" implies s.operations.get(id).count == 0)
  val CountReflectsCurrent = if (s.filter == 0) s.rows == List() else s.rows.length() == s.operations.get(s.filter).count
  val safety = TypeOK and PendingOwnsRead and CurrentRowsMatch and FailureHasNoCount and CountReflectsCurrent and s.writes == 0
  run oldFailureCannotEraseNewRowsTest = init.then(begin(1, 1)).then(accessReply(1, "granted"))
    .then(begin(2, 2)).then(accessReply(2, "granted")).then(queryReply(2, true, RowIds))
    .then(queryReply(1, false, Set())).expect(s.rows == List(3, 2) and s.operations.get(1).result == "failed" and safety)
  run deniedReadbackCannotQueryTest = init.then(begin(1, 1)).then(accessReply(1, "denied"))
    .expect(s.access == "granted" and s.filterGeneration == 0 and s.operations.get(1).result == "failed" and safety)
  run clearedQueryCannotPublishTest = init.then(begin(1, 1)).then(accessReply(1, "granted"))
    .then(clear).then(queryReply(1, true, RowIds)).expect(s.rows == List() and s.operations.get(1).result == "failed" and safety)
  run cancelledQueryCannotPublishTest = init.then(begin(1, 1)).then(reload).then(accessReply(1, "granted"))
    .then(abort(1)).then(queryReply(1, true, RowIds)).expect(s.rows == List() and s.operations.get(1).result == "aborted" and safety)
}
