/// Per-runtime turn ownership, cancellation and asynchronous-context lookup.
module CoreTurnControllers {
  val ids = Set(1, 2, 3)
  val registries = Set(1, 2)
  val rooms = Set(1, 2)
  type Event = {registry: int, room: int, kind: str}
  type State = {
    active: Set[int], aborted: Set[int], reasons: int -> str,
    results: int -> str, registry: int -> int, room: int -> int,
    order: List[int], roomOrder: int -> List[int], listening: Set[int], events: List[Event],
    closedReason: int -> str, signal: int, queryRegistry: int, queryRoom: int, abortable: bool, changed: bool, abortedRooms: Set[int]
  }
  var s: State
  pure val initial: State = {
    active: Set(), aborted: Set(), reasons: ids.mapBy(_ => "none"),
    results: ids.mapBy(_ => "unused"), registry: ids.mapBy(_ => 0),
    room: ids.mapBy(_ => 0), order: [], roomOrder: Map((1, []), (2, [])), listening: registries, events: [],
    closedReason: registries.mapBy(_ => "none"), signal: 0, queryRegistry: 0, queryRoom: 0, abortable: false, changed: false, abortedRooms: Set()
  }
  action init = s' = initial
  pure def emit(state: State, registry: int, room: int, kind: str): List[Event] =
    if (registry.in(state.listening)) state.events.append({registry: registry, room: room, kind: kind}) else state.events
  pure def matching(state: State, registry: int, room: int): Set[int] =
    state.active.filter(id => state.registry.get(id) == registry and state.room.get(id) == room)
  pure def lookup(state: State, registry: int, room: int, self: int): int =
    if (self != 0 and state.registry.get(self) == registry and state.room.get(self) == room) self
    else state.order.foldl(0, (latest, id) => if (id.in(matching(state, registry, room))) id else latest)
  action begin(id: int, registry: int, room: int): bool = all {
    id.in(ids), registry.in(registries), room.in(rooms), s.results.get(id) == "unused",
    val reason = s.closedReason.get(registry)
    s' = {...s, active: s.active.union(Set(id)),
      aborted: if (reason == "none") s.aborted else s.aborted.union(Set(id)), reasons: s.reasons.set(id, reason),
      results: s.results.set(id, "running"),
      registry: s.registry.set(id, registry), room: s.room.set(id, room), order: s.order.append(id),
      roomOrder: if (matching(s, registry, room).size() == 0) s.roomOrder.set(registry, s.roomOrder.get(registry).append(room)) else s.roomOrder,
      events: emit(s, registry, room, "started")}
  }
  action settle(id: int, success: bool): bool = all {
    id.in(s.active),
    s' = {...s, active: s.active.exclude(Set(id)), results: s.results.set(id, if (success) "ok" else "failed"),
      roomOrder: if (matching(s, s.registry.get(id), s.room.get(id)).size() == 1)
        s.roomOrder.set(s.registry.get(id), s.roomOrder.get(s.registry.get(id)).foldl([], (kept, room) => if (room != s.room.get(id)) kept.append(room) else kept)) else s.roomOrder,
      events: emit(s, s.registry.get(id), s.room.get(id),
        if (success) "completed" else if (id.in(s.aborted)) "aborted-cleanup" else "errored")}
  }
  action query(registry: int, room: int, self: int): bool = all {
    registry.in(registries), room.in(rooms), self == 0 or self.in(s.active),
    s' = {...s, signal: lookup(s, registry, room, self), queryRegistry: registry, queryRoom: room,
      abortable: matching(s, registry, room).exclude(s.aborted).exclude(Set(self)).size() > 0}
  }
  action abortRoom(registry: int, room: int, self: int, reason: str): bool = all {
    registry.in(registries), room.in(rooms), self == 0 or self.in(s.active), reason.in(Set("stop", "shutdown")),
    val victims = matching(s, registry, room).exclude(s.aborted).exclude(Set(self))
    s' = {...s, aborted: s.aborted.union(victims), changed: victims.size() > 0,
      reasons: ids.mapBy(id => if (id.in(victims)) reason else s.reasons.get(id)),
      events: if (victims.size() > 0) emit(s, registry, room, "aborted") else s.events}
  }
  pure def abortRegistry(state: State, registry: int, reason: str): State = {
    val victims = state.active.filter(id => state.registry.get(id) == registry).exclude(state.aborted)
    val affected = victims.map(id => state.room.get(id))
    {...state, aborted: state.aborted.union(victims), abortedRooms: affected,
      reasons: ids.mapBy(id => if (id.in(victims)) reason else state.reasons.get(id)),
      events: state.roomOrder.get(registry).foldl(state.events, (events, room) =>
        if (room.in(affected) and registry.in(state.listening))
          events.append({registry: registry, room: room, kind: "aborted"}) else events)}
  }
  action abortAll(registry: int, reason: str): bool = all {
    registry.in(registries), reason.in(Set("stop", "shutdown")), s' = abortRegistry(s, registry, reason)
  }
  action closeTurns(registry: int, reason: str): bool = all {
    registry.in(registries), reason.in(Set("stop", "shutdown")),
    s' = abortRegistry({...s, closedReason: s.closedReason.set(registry, reason)}, registry, reason)
  }
  action listen(registry: int, subscribed: bool): bool = all {
    registry.in(registries),
    s' = {...s, listening: if (subscribed) s.listening.union(Set(registry)) else s.listening.exclude(Set(registry))}
  }
  val ActiveResults = s.active == ids.filter(id => s.results.get(id) == "running")
  val ReasonsOwned = ids.forall(id => id.in(s.aborted) == (s.reasons.get(id) != "none"))
  val TypeOK = s.active.subseteq(ids) and s.aborted.subseteq(ids) and s.listening.subseteq(registries)
    and s.signal.in(ids.union(Set(0))) and s.abortedRooms.subseteq(rooms)
    and ids.forall(id => s.results.get(id).in(Set("unused", "running", "ok", "failed")))
  val SignalOwned = s.signal == 0 or (s.registry.get(s.signal) == s.queryRegistry and s.room.get(s.signal) == s.queryRoom)
  val ClosedTurnsAborted = s.active.forall(id => s.closedReason.get(s.registry.get(id)) != "none" implies id.in(s.aborted))
  val safety = ActiveResults and ReasonsOwned and SignalOwned and ClosedTurnsAborted and TypeOK
  action step = any {
    nondet id = ids.oneOf()
    nondet registry = registries.oneOf()
    nondet room = rooms.oneOf()
    begin(id, registry, room),
    nondet id = ids.oneOf()
    nondet success = Set(false, true).oneOf()
    settle(id, success),
    nondet registry = registries.oneOf()
    nondet room = rooms.oneOf()
    nondet self = ids.union(Set(0)).oneOf()
    query(registry, room, self),
    nondet registry = registries.oneOf()
    nondet room = rooms.oneOf()
    nondet self = ids.union(Set(0)).oneOf()
    abortRoom(registry, room, self, "stop"),
    nondet registry = registries.oneOf()
    abortAll(registry, "shutdown"),
    nondet registry = registries.oneOf()
    nondet reason = Set("stop", "shutdown").oneOf()
    closeTurns(registry, reason),
    nondet registry = registries.oneOf()
    nondet subscribed = Set(false, true).oneOf()
    listen(registry, subscribed),
    s' = s
  }
  run separateRegistriesTest = init.then(begin(1,1,1)).then(query(2,1,1)).expect(s.signal == 0 and safety)
  run sameRoomSelfExclusionTest = init.then(begin(1,1,1)).then(begin(2,1,1)).then(abortRoom(1,1,2,"stop"))
    .expect(s.aborted == Set(1)).then(query(1,1,2)).expect(s.signal == 2 and not(s.abortable) and safety)
  run newestSignalTest = init.then(begin(1,1,1)).then(begin(2,1,1)).then(query(1,1,0)).expect(s.signal == 2)
    .then(settle(2,true)).then(query(1,1,0)).expect(s.signal == 1 and safety)
  run abortAllIncludesSelfTest = init.then(begin(1,1,1)).then(begin(2,1,2)).then(begin(3,2,1)).then(abortAll(1,"shutdown"))
    .expect(s.aborted == Set(1,2) and s.abortedRooms == Set(1,2) and safety)
  run cancelledWorkCanReturnTest = init.then(begin(1,1,1)).then(abortRoom(1,1,0,"stop")).then(settle(1,true))
    .expect(s.results.get(1) == "ok" and s.events.nth(s.events.length() - 1).kind == "completed" and safety)
  run cancellationReasonRetainedTest = init.then(begin(1,1,1)).then(abortRoom(1,1,0,"stop")).then(abortAll(1,"shutdown"))
    .then(settle(1,false)).expect(s.reasons.get(1) == "stop" and s.events.nth(s.events.length() - 1).kind == "aborted-cleanup" and safety)
  run observerRemovalTest = init.then(listen(1,false)).then(begin(1,1,1)).then(settle(1,false))
    .expect(s.events.length() == 0 and safety)
  run closedTurnStartsAbortedTest = init.then(closeTurns(1,"shutdown")).then(begin(1,1,1)).then(begin(2,2,1))
    .expect(s.aborted == Set(1) and s.reasons.get(1) == "shutdown" and safety)
  run reclosePreservesEarlierReasonTest = init.then(begin(1,1,1)).then(closeTurns(1,"shutdown")).then(closeTurns(1,"stop"))
    .then(begin(2,1,1)).expect(s.reasons.get(1) == "shutdown" and s.reasons.get(2) == "stop" and safety)
}
