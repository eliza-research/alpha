module FactWriteScope {
  type Row = {id: int, evidence: Set[int]}
  type Room = {rows: Set[Row], padding: int}
  type Request = {room: int, runtime: int, evidence: int, phase: str, seen: Row, checked: int, result: int}
  type State = {rooms: int -> Room, requests: int -> Request, next: int}

  pure val rooms = Set(1, 2)
  pure val runtimes = Set(1, 2)
  pure val slots = 1.to(4)
  pure val noRow: Row = {id: -1, evidence: Set()}
  pure val emptyRoom: Room = {rows: Set(), padding: 0}
  pure val idle: Request = {room: 0, runtime: 0, evidence: 0, phase: "idle", seen: noRow, checked: 0, result: -1}
  pure val seedRow: Row = {id: 0, evidence: Set(0)}
  pure val candidateLimit = 120

  // In these schedules, seed, unrelated rows and attempt IDs order the distinct SQL timestamps.
  pure def rank(room: Room, row: Row): int =
    room.rows.filter(other => other.id > row.id).size() + (if (row.id == 0) room.padding else 0)
  pure def candidate(room: Room): Row =
    room.rows.fold(noRow, (best, row) => if (row.id > best.id and rank(room, row) < candidateLimit) row else best)
  pure def examined(room: Room): int = {
    val total = room.rows.size() + room.padding
    if (total < candidateLimit) total else candidateLimit
  }
  pure def ownsLane(request: Request): bool = request.phase.in(Set("read", "miss", "hit"))
  pure def pending(request: Request): bool = request.phase == "queued" or ownsLane(request)

  var s: State
  def request(id: int): Request = s.requests.get(id)
  def sameLane(a: Request, b: Request): bool = a.room == b.room and a.runtime == b.runtime
  def earlierPending(id: int): bool = slots.exists(other =>
    other < id and pending(request(other)) and sameLane(request(other), request(id)))
  def roomUsed(room: int): bool = slots.exists(id => request(id).room == room)
  def setRequest(id: int, update: Request): State = {...s, requests: s.requests.set(id, update)}

  action init = s' = {rooms: rooms.mapBy(_ => emptyRoom), requests: slots.mapBy(_ => idle), next: 1}
  action seed(room: int): bool = all {
    room.in(rooms), not(roomUsed(room)), s.rooms.get(room) == emptyRoom,
    s' = {...s, rooms: s.rooms.set(room, {rows: Set(seedRow), padding: 0})}
  }
  action pad(room: int, newer: int): bool = all {
    room.in(rooms), newer.in(Set(119, 120)), not(roomUsed(room)),
    s.rooms.get(room) == {rows: Set(seedRow), padding: 0},
    s' = {...s, rooms: s.rooms.set(room, {rows: Set(seedRow), padding: newer})}
  }
  action enqueue(room: int, runtime: int, evidence: int): bool = all {
    s.next.in(slots), room.in(rooms), runtime.in(runtimes), evidence.in(slots),
    val queued = {...idle, room: room, runtime: runtime, evidence: evidence, phase: "queued"}
    s' = {...setRequest(s.next, queued), next: s.next + 1}
  }
  action capture(id: int): bool = {
    val current = request(id)
    all {
      current.phase == "queued", not(earlierPending(id)),
      val room = s.rooms.get(current.room)
      s' = setRequest(id, {...current, phase: "read", seen: candidate(room), checked: examined(room)})
    }
  }
  action admit(id: int): bool = {
    val current = request(id)
    all {
      current.phase == "read", not(current.evidence.in(current.seen.evidence)),
      s' = setRequest(id, {...current, phase: if (current.seen == noRow) "miss" else "hit"})
    }
  }
  action commit(id: int): bool = {
    val current = request(id)
    all {
      current.phase.in(Set("miss", "hit")),
      val old = s.rooms.get(current.room)
      val insert = current.phase == "miss"
      val keptId = if (insert) id else current.seen.id
      val row = {id: keptId, evidence: current.seen.evidence.union(Set(current.evidence))}
      val updated = old.rows.filter(existing => existing.id != keptId).union(Set(row))
      s' = {...setRequest(id, {...current, phase: "done", result: keptId}),
        rooms: s.rooms.set(current.room, {...old, rows: updated})}
    }
  }
  action reject(id: int): bool = {
    val current = request(id)
    all {
      current.phase.in(Set("miss", "hit")),
      s' = setRequest(id, {...current, phase: "rejected"})
    }
  }
  action skipUpdate(id: int): bool = {
    val current = request(id)
    all {
      current.phase == "read", current.evidence.in(current.seen.evidence),
      s' = setRequest(id, {...current, phase: "done", result: current.seen.id})
    }
  }

  action step = any {
    nondet room = rooms.oneOf()
    seed(room),
    nondet room = rooms.oneOf()
    nondet newer = Set(119, 120).oneOf()
    pad(room, newer),
    nondet room = rooms.oneOf()
    nondet runtime = runtimes.oneOf()
    nondet evidence = slots.oneOf()
    enqueue(room, runtime, evidence),
    nondet id = slots.oneOf()
    any {capture(id), admit(id), commit(id), reject(id), skipUpdate(id)},
    s' = s
  }

  val ranks = rooms.mapBy(room =>
    s.rooms.get(room).rows.map(row => {id: row.id, rank: rank(s.rooms.get(room), row)}))
  val OneOwnerPerRuntimeRoom = slots.forall(id => ownsLane(request(id)) implies not(earlierPending(id)))
  val ReadsAndRepliesStayInRoom = slots.forall(id => {
    val current = request(id)
    current.phase == "idle" or {
      val rowIds = s.rooms.get(current.room).rows.map(row => row.id)
      (current.seen == noRow or current.seen.id.in(rowIds)) and
        (if (current.phase == "done") current.result.in(rowIds) else current.result == -1)
    }
  })
  val UniquePhysicalIdsPerRoom = rooms.forall(room => {
    val rows = s.rooms.get(room).rows
    rows.size() == rows.map(row => row.id).size()
  })
  val NoRejectedInsert = slots.forall(id => request(id).phase != "rejected" or
    rooms.forall(room => not(s.rooms.get(room).rows.map(row => row.id).contains(id))))
  val LookupUsesAtMost120Candidates = slots.forall(id => request(id).checked.in(0.to(candidateLimit)))
  val safety = OneOwnerPerRuntimeRoom and ReadsAndRepliesStayInRoom and UniquePhysicalIdsPerRoom
    and NoRejectedInsert and LookupUsesAtMost120Candidates

  run newest119RowsStillPermitReuseTest = init.then(seed(1)).then(pad(1, 119))
    .then(enqueue(1, 1, 1)).then(capture(1)).then(admit(1)).then(commit(1))
    .expect(safety and request(1).result == 0 and request(1).checked == 120 and s.rooms.get(1).rows.size() == 1)
  run newest120RowsEvictOldMatchTest = init.then(seed(1)).then(pad(1, 120))
    .then(enqueue(1, 1, 1)).then(capture(1)).then(admit(1)).then(commit(1))
    .expect(safety and request(1).result == 1 and request(1).checked == 120 and s.rooms.get(1).rows.size() == 2)
  run independentRuntimeLanesCanBothMissTest = init.then(enqueue(1, 1, 1)).then(enqueue(1, 2, 2))
    .then(capture(1)).then(capture(2)).then(admit(1)).then(admit(2)).then(commit(1)).then(commit(2))
    .expect(safety and s.rooms.get(1).rows.size() == 2)
  run differentRoomsHaveIndependentOwnersTest = init.then(enqueue(1, 1, 1)).then(enqueue(2, 1, 2))
    .then(capture(1)).then(capture(2)).then(admit(1)).then(admit(2)).then(commit(1)).then(commit(2))
    .expect(safety and s.rooms.get(1).rows.size() == 1 and s.rooms.get(2).rows.size() == 1)
  run sameRuntimeRoomSuccessorWaitsTest = init.then(enqueue(1, 1, 1)).then(enqueue(1, 1, 2))
    .then(capture(1)).then(capture(2).fail())
  run refusalReleasesFifoLaneAndRetryReusesSuccessorTest = init.then(enqueue(1, 1, 1)).then(enqueue(1, 1, 2))
    .then(capture(1)).then(admit(1)).then(reject(1))
    .then(capture(2)).then(admit(2)).then(commit(2))
    .then(enqueue(1, 1, 1)).then(capture(3)).then(admit(3)).then(commit(3))
    .then(enqueue(1, 1, 1)).then(capture(4)).then(skipUpdate(4))
    .expect(safety and request(3).result == 2 and request(4).result == 2 and
      s.rooms.get(1).rows == Set({id: 2, evidence: Set(1, 2)}))
}
