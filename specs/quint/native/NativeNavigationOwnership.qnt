/// Native Maps bridge, service command authority and notification ownership.
module NativeNavigationOwnership {
  type Command = {kind: str, id: int, authority: int}
  type Event = {owner: int, id: int, reason: str}
  type State = {
    destroyed: Set[int], permission: bool, declared: bool, issued: int,
    active: int, activeId: int, owner: int, title: int, text: int,
    terminalStops: int, lastReason: str, events: List[Event],
    commands: List[Command], fallbackStops: int, lastCall: str,
    owned: int, shown: bool, notification: int, notificationTitle: int, notificationText: int,
    savedStop: int, foregroundCalls: int, removeCalls: int, stopSelfCalls: int
  }
  var s: State
  pure val owners = Set(1, 2)
  pure val ids = Set(1, 2)
  action init = s' = {destroyed: Set(), permission: true, declared: true, issued: 0,
    active: 0, activeId: 0, owner: 0, title: 0, text: 0, terminalStops: 0, lastReason: "none",
    events: [], commands: [], fallbackStops: 0, lastCall: "none", owned: 0,
    shown: false, notification: 0, notificationTitle: 0, notificationText: 0,
    savedStop: 0, foregroundCalls: 0, removeCalls: 0, stopSelfCalls: 0}
  pure def queue(state: State, command: str, id: int, authority: int): State = {...state,
    commands: state.commands.append({kind: command, id: id, authority: authority})}
  pure def retire(state: State, reason: str): State = {...state,
    active: 0, activeId: 0, owner: 0, terminalStops: state.terminalStops + 1, lastReason: reason,
    events: if (state.owner.in(state.destroyed)) state.events
      else state.events.append({owner: state.owner, id: state.activeId, reason: reason})}
  pure def retireQueued(state: State, reason: str): State =
    queue(retire(state, reason), "stop", state.activeId, state.active)
  pure def admit(state: State, owner: int, id: int, title: int, text: int): State = {
    val previous = if (state.active == 0) state else retireQueued(state, "replaced")
    {...previous, issued: state.issued + 1, active: state.issued + 1, activeId: id, owner: owner, title: title, text: text}
  }
  action capabilities(declared: bool, permission: bool): bool = s' = {...s, declared: declared, permission: permission}
  action start(owner: int, id: int, title: int, text: int, dispatches: bool): bool = all {
    owner.in(owners), id.in(0.to(2)), title.in(1.to(4)), text.in(1.to(4)), s.issued < 3,
    s' = if (id == 0) {...s, lastCall: "invalid"}
      else if (not(s.declared)) {...s, lastCall: "unavailable"}
      else if (not(s.permission)) {...s, lastCall: "permission"}
      else if (owner.in(s.destroyed)) {...s, lastCall: "unavailable"}
      else {
        val started = admit(s, owner, id, title, text)
        if (dispatches) queue({...started, lastCall: "done"}, "start", id, started.active)
        else {...retireQueued(started, "refused"), lastCall: "unavailable"}
      }
  }
  action supersededStart = all {
    s.issued < 2, s.declared, s.permission, s.destroyed == Set(),
    val first = admit(s, 1, 1, 1, 1)
    val second = admit(queue(first, "start", 1, first.active), 2, 1, 2, 2)
    s' = queue({...second, lastCall: "unavailable"}, "start", 1, second.active)
  }
  action update(owner: int, id: int, title: int, text: int): bool = all {
    owner.in(owners), id.in(ids), title.in(1.to(4)), text.in(1.to(4)),
    s' = if (s.activeId != id or s.owner != owner) {...s, lastCall: "inactive"}
      else queue({...s, title: title, text: text, lastCall: "active"}, "update", id, s.active)
  }
  action stop(owner: int, id: int): bool = all {
    owner.in(owners), id.in(ids),
    s' = if (s.activeId != id or s.owner != owner) {...s, lastCall: "not-stopped"}
      else {...retireQueued(s, "app"), lastCall: "stopped"}
  }
  action fallback(owner: int, id: int, successor: int): bool = all {
    s.activeId == id, s.owner == owner, id.in(ids), successor.in(0.to(2)),
    successor == 0 or (s.issued < 3 and not(successor.in(s.destroyed)) and s.declared and s.permission),
    val retired = retire(s, "app")
    s' = if (successor == 0) {...retired, fallbackStops: s.fallbackStops + 1, lastCall: "stopped"}
      else {
        val admitted = admit(retired, successor, 2, 2, 2)
        queue({...admitted, lastCall: "stopped"}, "start", 2, admitted.active)
      }
  }
  action destroy(owner: int): bool = all {
    owner.in(owners), not(owner.in(s.destroyed)),
    val closed = {...s, destroyed: s.destroyed.union(Set(owner))}
    s' = if (s.owner == owner) retireQueued(closed, "renderer-closed") else closed
  }
  pure def endIfIdle(state: State): State =
    if (state.active != 0) state else {...state, shown: false,
      removeCalls: state.removeCalls + 1, stopSelfCalls: state.stopSelfCalls + 1}
  pure def publish(state: State): State = {...state, owned: state.active, shown: true,
    notification: state.active,
    notificationTitle: if (state.active == 0) 0 else state.title,
    notificationText: if (state.active == 0) 0 else state.text,
    foregroundCalls: state.foregroundCalls + 1}
  pure def deliverCommand(state: State, command: Command, foregroundOk: bool): State = {
    val live = state.active != 0 and state.active == command.authority and state.activeId == command.id
    val updated = if (command.kind == "stop") (if (live) retire(state, "app") else state)
      else if (command.kind == "start" or (command.kind == "update" and live))
        (if (foregroundOk) publish(state) else if (live) retire(state, "refused") else state)
      else state
    endIfIdle(updated)
  }
  action deliver(index: int, foregroundOk: bool): bool = all {
    index.in(s.commands.indices()),
    val command = s.commands.nth(index)
    val remainder = s.commands.slice(0, index).concat(s.commands.slice(index + 1, s.commands.length()))
    s' = deliverCommand({...s, commands: remainder}, command, foregroundOk)
  }
  action saveNotification = all {
    s.notification != 0, s' = {...s, savedStop: s.notification}
  }
  action press(saved: bool): bool = {
    val authority = if (saved) s.savedStop else s.notification
    all {
      authority != 0,
      s' = endIfIdle(if (authority == s.active) retire(s, "notification") else s)
    }
  }
  action malformedStop = s' = endIfIdle(s)
  action taskRemoved = s' = endIfIdle(if (s.owned != 0 and s.owned == s.active) retire(s, "task-removed") else s)
  action serviceDestroyed = s' = if (s.owned != 0 and s.owned == s.active) retire(s, "destroyed") else s
  action step = any {
    start(1, 1, 1, 1, true), start(2, 2, 2, 2, true), start(2, 1, 2, 2, true),
    start(1, 1, 1, 1, false), start(1, 0, 1, 1, true),
    capabilities(true, false), capabilities(false, true), capabilities(true, true),
    supersededStart, destroy(1), destroy(2), stop(1, 1), stop(1, 2), stop(2, 2),
    update(1, 1, 3, 4), update(2, 2, 4, 3),
    fallback(1, 1, 0), fallback(1, 1, 2), deliver(0, true), deliver(0, false), deliver(1, true),
    saveNotification, press(false), press(true), malformedStop, taskRemoved, serviceDestroyed, s' = s
  }
  val ActiveHasLiveOwner = s.active != 0 implies s.owner.in(owners) and not(s.owner.in(s.destroyed)) and s.activeId.in(ids)
  val EmptyHasNoOwner = s.active == 0 implies s.owner == 0 and s.activeId == 0
  val ForegroundHasKnownAuthority = s.shown implies s.notification != 0 and s.notification == s.owned and s.notification <= s.issued
  val RetiredDoesNotExceedIssued = s.terminalStops <= s.issued
  val DeliveredOwnerEventsAreBounded = s.events.length() <= s.terminalStops
  val OnlyAdmittedCommands = s.commands.indices().forall(i => s.commands.nth(i).authority.in(1.to(s.issued)))
  val safety = ActiveHasLiveOwner and EmptyHasNoOwner and ForegroundHasKnownAuthority and RetiredDoesNotExceedIssued and
    DeliveredOwnerEventsAreBounded and OnlyAdmittedCommands
  run lateRendererDestroyPreservesSuccessorTest = init.then(start(1,1,1,1,true)).then(start(2,2,2,2,true)).then(destroy(1))
    .expect(safety and s.owner == 2 and s.activeId == 2 and s.terminalStops == 1)
  run staleStartCannotRemoveCurrentForegroundTest = init.then(start(1,1,1,1,true)).then(start(2,2,2,2,true))
    .then(deliver(2,true)).then(deliver(0,true)).expect(safety and s.shown and s.notificationTitle == 2 and s.stopSelfCalls == 0)
  run staleNotificationCannotStopSamePublicIdTest = init.then(start(1,1,1,1,true)).then(deliver(0,true)).then(saveNotification)
    .then(start(2,1,2,2,true)).then(deliver(1,true)).then(press(true))
    .expect(safety and s.owner == 2 and s.active == 2 and s.notification == 2)
  run fallbackCannotStopNewOwnerTest = init.then(start(1,1,1,1,true)).then(fallback(1,1,2))
    .expect(safety and s.owner == 2 and s.fallbackStops == 0)
  run currentNotificationStopsOnceTest = init.then(start(1,1,1,1,true)).then(deliver(0,true)).then(press(false)).then(press(false))
    .expect(safety and s.terminalStops == 1 and s.events == [{owner: 1, id: 1, reason: "notification"}])
  run failedForegroundRetiresExactOwnerTest = init.then(start(1,1,1,1,true)).then(deliver(0,false))
    .expect(safety and s.active == 0 and s.lastReason == "refused" and not(s.shown))
}
