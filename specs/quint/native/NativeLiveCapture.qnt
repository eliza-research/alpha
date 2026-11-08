/// Shared bridge and LiveCaptureController admission, source startup and teardown.
module NativeLiveCapture {
  type Source = {allocated: bool, running: bool, released: bool, stopped: bool}
  type State = {epoch: int, foreground: bool, destroyed: bool, inCall: bool, permission: bool,
    active: int, ticketEpoch: int -> int, ids: int -> int, cancelled: Set[int], discarded: Set[int],
    attached: Set[int], permissions: Set[int], queued: Set[int], opening: int, live: int, current: int,
    cleanup: bool, stopQueued: Set[int], interrupted: str, outcomes: int -> str,
    sources: int -> Source, startsDuringCall: int, frames: int, ended: int, endReason: str,
    admitted: bool, admittedEpoch: int, admissionEpoch: int, admittedCall: bool,
    admittedForeground: bool, admittedDestroyed: bool}
  var s: State
  val slots = Set(1, 2)
  val emptySource = {allocated: false, running: false, released: false, stopped: false}
  pure def retire(value: State, ticket: int): State = if (ticket == 0) value else {
    val source = value.sources.get(ticket)
    {...value, cancelled: value.cancelled.union(Set(ticket)), attached: value.attached.exclude(Set(ticket)), discarded: value.discarded.union(Set(ticket)),
      sources: value.sources.set(ticket, {...source, stopped: source.allocated, running: false,
        released: source.released or (source.allocated and value.opening != ticket)})}
  }
  action init = s' = {epoch: 0, foreground: true, destroyed: false, inCall: false, permission: true,
    active: 0, ticketEpoch: slots.mapBy(_ => -1), ids: slots.mapBy(_ => 0), cancelled: Set(), discarded: Set(),
    attached: Set(), permissions: Set(), queued: Set(), opening: 0, live: 0, current: 0,
    cleanup: false, stopQueued: Set(), interrupted: "none", outcomes: slots.mapBy(_ => "none"),
    sources: slots.mapBy(_ => emptySource), startsDuringCall: 0, frames: 0, ended: 0, endReason: "none",
    admitted: false, admittedEpoch: 0, admissionEpoch: 0, admittedCall: false,
    admittedForeground: false, admittedDestroyed: false}
  action setPermission(value: bool): bool = s' = {...s, permission: value}
  action setCall(value: bool): bool = s' = {...s, inCall: value}
  action request(ticket: int, id: int): bool = all {
    ticket.in(slots), id.in(slots), s.outcomes.get(ticket) == "none",
    val refused = s.destroyed or not(s.foreground) or s.inCall
    val retired = if (refused) s else retire(s, s.active)
    s' = {...retired, active: if (refused) s.active else ticket,
      ids: retired.ids.set(ticket, id), ticketEpoch: retired.ticketEpoch.set(ticket, if (refused) -1 else s.epoch),
      permissions: if (not(refused or s.permission)) retired.permissions.union(Set(ticket)) else retired.permissions,
      queued: if (not(refused) and s.permission) retired.queued.union(Set(ticket)) else retired.queued,
      outcomes: retired.outcomes.set(ticket, if (s.destroyed or not(s.foreground)) "cancelled" else if (s.inCall) "call" else "pending")}
  }
  action permissionReply(ticket: int, granted: bool): bool = all {
    ticket.in(slots), s.outcomes.get(ticket) == "pending", not(ticket.in(s.queued)),
    val current = ticket.in(s.permissions) and ticket == s.active and not(ticket.in(s.cancelled)) and s.ticketEpoch.get(ticket) == s.epoch
    s' = {...s, permission: granted, permissions: s.permissions.exclude(Set(ticket)),
      queued: if (current and granted) s.queued.union(Set(ticket)) else s.queued,
      outcomes: s.outcomes.set(ticket, if (not(current)) "cancelled" else if (not(granted)) "permission" else "pending")}
  }
  action beginOpen(ticket: int): bool = all {
    ticket.in(s.queued), s.opening == 0,
    val allowed = s.foreground and not(s.destroyed or s.inCall) and ticket == s.active and not(ticket.in(s.cancelled)) and s.ticketEpoch.get(ticket) == s.epoch
    val previous = if (allowed and s.live != 0) s.sources.set(s.live, {...s.sources.get(s.live), running: false, stopped: true, released: true}) else s.sources
    s' = {...s, queued: s.queued.exclude(Set(ticket)),
      opening: if (allowed) ticket else 0, attached: if (allowed) s.attached.union(Set(ticket)) else s.attached,
      sources: if (allowed) previous.set(ticket, {allocated: true, running: false, released: false, stopped: false}) else previous,
      live: if (allowed) 0 else s.live, current: if (allowed) 0 else s.current,
      interrupted: "none", outcomes: s.outcomes.set(ticket, if (allowed) "pending" else "cancelled")}
  }
  action finishOpen(opens: bool, releases: bool): bool = all {
    s.opening != 0,
    val ticket = s.opening
    val allowed = opens and s.foreground and not(s.destroyed or s.inCall) and ticket == s.active and not(ticket.in(s.cancelled)) and s.ticketEpoch.get(ticket) == s.epoch
    val result = if (allowed) "recording" else if (not(opens)) "capture" else "cancelled"
    s' = {...s, opening: 0, live: if (allowed) ticket else s.live, current: if (allowed) ticket else s.current,
      sources: s.sources.set(ticket, {allocated: true, running: allowed,
        released: not(allowed) and releases, stopped: not(allowed)}),
      startsDuringCall: s.startsDuringCall + (if (opens and s.inCall) 1 else 0),
      outcomes: s.outcomes.set(ticket, result), admitted: allowed, admittedEpoch: s.ticketEpoch.get(ticket),
      admissionEpoch: s.epoch, admittedCall: s.inCall, admittedForeground: s.foreground, admittedDestroyed: s.destroyed}
  }
  action stop(id: int, discard: bool): bool = all {
    id.in(slots),
    val ticket = s.active
    val matches = ticket != 0 and s.ids.get(ticket) == id
    val source = if (matches) s.sources.get(ticket) else emptySource
    s' = {...s, attached: if (matches) s.attached.exclude(Set(ticket)) else s.attached, cancelled: if (matches) s.cancelled.union(Set(ticket)) else s.cancelled,
      discarded: if (matches and discard) s.discarded.union(Set(ticket)) else s.discarded,
      sources: if (matches and ticket.in(s.attached)) s.sources.set(ticket, {...source, running: false, stopped: true,
        released: source.allocated and s.opening != ticket}) else s.sources,
      stopQueued: s.stopQueued.union(Set(id))}
  }
  action finishStop(id: int): bool = all {
    id.in(s.stopQueued), s.opening == 0,
    val matches = s.live != 0 and s.ids.get(s.live) == id
    s' = {...s, stopQueued: s.stopQueued.exclude(Set(id)), live: if (matches) 0 else s.live, current: if (matches) 0 else s.current}
  }
  action pauseHost = all {
    s.epoch < 3,
    val retired = retire(s, s.active)
    s' = {...retired, epoch: s.epoch + 1, foreground: false, interrupted: "cancelled", cleanup: true}
  }
  action resumeHost = s' = {...s, foreground: true}
  action closeHost = all {
    not(s.destroyed), s.epoch < 3,
    val retired = retire(s, s.active)
    s' = {...retired, epoch: s.epoch + 1, destroyed: true, permissions: Set(), interrupted: "cancelled", cleanup: true}
  }
  action cleanup = all {s.cleanup, s.opening == 0, s' = {...s, live: 0, current: 0, cleanup: false}}
  action interruptForCall = {
    val ticket = s.current
    s' = {...s, interrupted: "call", sources: if (ticket == 0) s.sources else s.sources.set(ticket,
      {...s.sources.get(ticket), running: false, stopped: true, released: true})}
  }
  action emitFrames(ticket: int): bool = all {
    ticket.in(slots), s.frames < 2,
    val owned = not(s.destroyed) and s.foreground and ticket == s.active and s.ticketEpoch.get(ticket) == s.epoch and not(ticket.in(s.discarded))
    s' = {...s, frames: s.frames + (if (owned) 1 else 0)}
  }
  action emitEnded(ticket: int, reason: str): bool = all {
    reason.in(Set("none", "call", "capture")),
    ticket.in(slots), s.ended < 2,
    val owned = not(s.destroyed) and s.foreground and ticket == s.active and s.ticketEpoch.get(ticket) == s.epoch and not(ticket.in(s.discarded))
    s' = {...s, ended: s.ended + (if (owned) 1 else 0), endReason: if (owned) reason else s.endReason}
  }
  action step = {
    nondet ticket = slots.oneOf()
    nondet id = slots.oneOf()
    nondet flag = Bool.oneOf()
    any {setPermission(flag), setCall(flag), request(ticket, id), permissionReply(ticket, flag), beginOpen(ticket),
      finishOpen(flag, true), finishOpen(flag, false), stop(id, flag), finishStop(id), pauseHost, resumeHost,
      closeHost, cleanup, interruptForCall, emitFrames(ticket), emitEnded(ticket, "none"), emitEnded(ticket, "call"), emitEnded(ticket, "capture"), s' = s}
  }
  val CurrentStartupGate = s.admitted implies s.admittedEpoch == s.admissionEpoch and s.admittedForeground and not(s.admittedCall or s.admittedDestroyed)
  val ReleasedIsStopped = slots.forall(ticket => s.sources.get(ticket).released implies not(s.sources.get(ticket).running))
  val PointerOwnership = (s.live == 0 or s.sources.get(s.live).allocated) and s.current == s.live
  val DiscardIsCancelled = s.discarded.subseteq(s.cancelled)
  val Bounded = s.epoch.in(0.to(3)) and s.startsDuringCall.in(0.to(2))
  val safety = CurrentStartupGate and ReleasedIsStopped and PointerOwnership and DiscardIsCancelled and Bounded
  run permissionDuringCallTest = init.then(setPermission(false)).then(request(1, 1)).then(setCall(true))
    .then(permissionReply(1, true)).then(beginOpen(1)).expect(safety and s.outcomes.get(1) == "cancelled")
  run callDuringNativeOpenTest = init.then(request(1, 1)).then(beginOpen(1)).then(setCall(true)).then(interruptForCall)
    .then(finishOpen(true, true)).expect(safety and s.current == 0 and s.startsDuringCall == 1)
  run cancelledOpenReleasedTest = init.then(request(1, 1)).then(beginOpen(1)).then(stop(1, true)).then(finishOpen(true, true))
    .then(finishStop(1)).expect(safety and s.sources.get(1).released and s.current == 0)
  run replacementRejectsOldPermissionTest = init.then(setPermission(false)).then(request(1, 1)).then(request(2, 2))
    .then(permissionReply(1, true)).expect(safety and s.outcomes.get(1) == "cancelled")
  run explicitStopKeepsTailTest = init.then(request(1, 1)).then(beginOpen(1)).then(finishOpen(true, true))
    .then(stop(1, false)).then(emitFrames(1)).then(emitEnded(1, "none")).then(finishStop(1))
    .expect(safety and s.frames == 1 and s.ended == 1)
  run lifecycleDiscardsTailTest = init.then(request(1, 1)).then(beginOpen(1)).then(finishOpen(true, true))
    .then(pauseHost).then(emitFrames(1)).then(cleanup).expect(safety and s.frames == 0 and s.current == 0)
}
