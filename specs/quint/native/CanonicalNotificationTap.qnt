module CanonicalNotificationTap {
  type Tap = {sequence: int, id: int, owner: int, route: str, verified: bool}
  type Delivery = {token: int, id: int, owner: int, agent: int, view: str, expires: int,
    conversation: bool, message: bool}
  type BridgeCall = {kind: str, phase: str, token: int, actor: int}
  type State = {waiting: Tap, opening: Tap, opener: int, pending: Delivery, readback: Delivery,
    captures: int, issued: int, active: int, lastActor: int, owner: int, agent: int, authorized: bool,
    now: int, bridge: bool, visible: bool, readyEvents: int, call: BridgeCall, posted: Set[int]}

  pure val noTap: Tap = {sequence: 0, id: 0, owner: 0, route: "none", verified: false}
  pure val noDelivery: Delivery = {token: 0, id: 0, owner: 0, agent: 0, view: "none", expires: 0,
    conversation: false, message: false}
  pure val idleCall: BridgeCall = {kind: "none", phase: "idle", token: 0, actor: 0}
  pure val identities = Set(1, 2)
  pure val generations = 1.to(3)
  pure val routes = Set("/chat", "/notes", "/unsupported")
  pure val clocks = Set(0, 1, 300000, 300001, 600001)
  pure val lifetime = 300000
  var s: State

  action init = s' = {waiting: noTap, opening: noTap, opener: 0, pending: noDelivery,
    readback: noDelivery, captures: 0, issued: 0, active: 0, lastActor: 0, owner: 0, agent: 0, authorized: false,
    now: 0, bridge: true, visible: true, readyEvents: 0, call: idleCall, posted: Set()}
  action attach(actor: int, owner: int, agent: int): bool = all {
    actor.in(generations), actor == s.lastActor + 1, s.active == 0, owner.in(identities), agent.in(identities),
    s' = {...s, active: actor, lastActor: actor, owner: owner, agent: agent, authorized: true}
  }
  action detach(retire: bool): bool = s' = {...s, active: 0, owner: 0, agent: 0, authorized: false,
    pending: if (retire) noDelivery else s.pending}
  action authorize(ok: bool): bool = all {s.active != 0, s' = {...s, authorized: ok}}
  action foreground(visible: bool): bool = s' = {...s, visible: visible}
  action destroyBridge = all {s.bridge, s' = {...s, bridge: false}}
  action time(now: int): bool = all {now.in(clocks), now >= s.now, s' = {...s, now: now}}

  action capture(id: int, owner: int, route: str, verified: bool): bool = all {
    id.in(generations), owner.in(identities), route.in(routes), s.captures < 4,
    s' = {...s, captures: s.captures + 1, waiting: {sequence: s.captures + 1,
      id: id, owner: owner, route: route, verified: verified}}
  }
  action rejectIngress = s' = s
  action beginOpen = all {
    s.active != 0, s.authorized, s.opening == noTap, s.waiting != noTap,
    s' = {...s, opening: s.waiting, opener: s.active}
  }
  action finishOpen = all {
    s.opening != noTap,
    val tap = s.opening
    val current = s.active == s.opener and s.authorized and tap.verified and tap.owner == s.owner
    val publish = current and tap.route != "/unsupported"
    val chat = tap.route == "/chat"
    val delivery = {token: s.issued + 1, id: tap.id, owner: s.owner, agent: s.agent,
      view: if (chat) "chat" else "notes", expires: s.now + lifetime, conversation: chat, message: chat}
    s' = {...s, waiting: if (s.waiting.sequence == tap.sequence) noTap else s.waiting,
      opening: noTap, opener: 0, pending: if (publish) delivery else s.pending,
      issued: s.issued + (if (publish) 1 else 0),
      readyEvents: s.readyEvents + (if (publish and s.bridge) 1 else 0)}
  }

  val onScreen = s.visible and s.bridge
  val callFree = s.call.phase.in(Set("idle", "ok", "rejected"))
  val eligibleRead = s.active != 0 and s.authorized and s.pending.token != 0 and s.now <= s.pending.expires
    and s.pending.owner == s.owner and s.pending.agent == s.agent
  action queueRead = all {
    callFree,
    s' = {...s, call: {...idleCall, kind: "read", phase: "queued"}, readback: noDelivery}
  }
  action readResult = all {
    s.call.kind == "read", s.call.phase == "queued",
    val ok = onScreen and (s.active == 0 or s.authorized)
    s' = {...s, call: {...s.call, phase: if (ok) "ok" else "rejected"},
      readback: if (ok and eligibleRead) s.pending else noDelivery}
  }
  action queueAck(token: int): bool = all {
    callFree, token.in(0.to(4)),
    s' = {...s, call: {...idleCall, kind: "ack", phase: "queued", token: token}, readback: noDelivery}
  }
  val checkedActorAvailable = onScreen and s.active != 0 and s.authorized
  action beginAck = all {
    s.call.kind == "ack", s.call.phase == "queued", checkedActorAvailable,
    s' = {...s, call: {...s.call, phase: "checked", actor: s.active}}
  }
  action refuseQueuedAck = all {
    s.call.kind == "ack", s.call.phase == "queued", not(checkedActorAvailable),
    s' = {...s, call: {...s.call, phase: "rejected"}}
  }
  action compareClear = all {
    s.call.phase == "checked",
    val matches = onScreen and s.active == s.call.actor and s.pending.token != 0
      and s.pending.token == s.call.token and s.now <= s.pending.expires
    s' = if (matches) {...s, pending: noDelivery, posted: s.posted.union(Set(s.call.token)),
      call: {...s.call, phase: "posted"}} else {...s, call: {...s.call, phase: "rejected"}}
  }
  action finishAck(ok: bool): bool = all {
    s.call.phase == "posted",
    val accepted = ok and onScreen and s.authorized and s.active == s.call.actor
    s' = {...s, call: {...s.call, phase: if (accepted) "ok" else "rejected"}}
  }

  val PostedTokenNeverRemainsPending = s.pending.token != 0 implies not(s.pending.token.in(s.posted))
  val PostRequiresIssuedIdentity = s.posted.subseteq(1.to(s.issued))
  val RejectedReadHasNoData = (s.call.kind == "read" and s.call.phase == "rejected") implies s.readback == noDelivery
  val safety = PostedTokenNeverRemainsPending and PostRequiresIssuedIdentity and RejectedReadHasNoData
    and s.captures.in(0.to(4)) and s.issued.in(0.to(s.captures))
    and s.lastActor.in(0.to(3)) and s.active.in(0.to(s.lastActor))
    and s.readyEvents.in(0.to(s.issued)) and ((s.opener == 0) == (s.opening == noTap))

  action step = any {
    nondet actor = generations.oneOf()
    nondet owner = identities.oneOf()
    nondet agent = identities.oneOf()
    attach(actor, owner, agent),
    nondet id = generations.oneOf()
    nondet owner = identities.oneOf()
    nondet route = routes.oneOf()
    nondet verified = Set(true, false).oneOf()
    capture(id, owner, route, verified),
    nondet flag = Set(true, false).oneOf()
    any {detach(flag), authorize(flag), foreground(flag), finishAck(flag)},
    nondet token = 0.to(4).oneOf()
    queueAck(token),
    nondet now = clocks.oneOf()
    time(now),
    beginOpen, finishOpen, queueRead, readResult, beginAck, refuseQueuedAck, compareClear, destroyBridge, s' = s
  }

  run coldWaitingTapUsesLatestIntentTest = init.then(capture(1, 1, "/chat", true))
    .then(capture(2, 1, "/notes", true)).then(attach(1, 1, 1)).then(beginOpen).then(finishOpen)
    .expect(safety and s.pending.id == 2 and s.pending.view == "notes" and s.waiting == noTap)
  run oldVerificationCannotClearNewWaitingIntentTest = init.then(attach(1, 1, 1))
    .then(capture(1, 1, "/chat", true)).then(beginOpen).then(capture(2, 1, "/notes", true))
    .then(finishOpen).expect(safety and s.pending.id == 1 and s.waiting.id == 2)
    .then(beginOpen).then(finishOpen).expect(safety and s.pending.id == 2)
  run staleAckCannotClearReplacementTest = init.then(attach(1, 1, 1))
    .then(capture(1, 1, "/chat", true)).then(beginOpen).then(finishOpen).then(queueAck(1)).then(beginAck)
    .then(capture(2, 1, "/notes", true)).then(beginOpen).then(finishOpen).then(compareClear)
    .expect(safety and s.call.phase == "rejected" and s.pending.token == 2 and s.posted == Set())
  run expiredReadDoesNotClearSlotTest = init.then(attach(1, 1, 1))
    .then(capture(1, 1, "/chat", true)).then(beginOpen).then(finishOpen).then(time(300000))
    .then(queueRead).then(readResult).expect(safety and s.readback.token == 1)
    .then(time(300001)).then(queueRead).then(readResult)
    .expect(safety and s.readback == noDelivery and s.pending.token == 1)
  run lostReplyDoesNotRestoreConsumedTokenTest = init.then(attach(1, 1, 1))
    .then(capture(1, 1, "/chat", true)).then(beginOpen).then(finishOpen)
    .then(queueAck(1)).then(beginAck).then(compareClear).then(finishAck(false))
    .then(queueAck(1)).then(beginAck).then(compareClear)
    .expect(safety and s.pending == noDelivery and s.call.phase == "rejected" and s.posted == Set(1))
  run suspensionKeepsTapButWrongOwnerReadIsEmptyTest = init.then(attach(1, 1, 1))
    .then(capture(1, 1, "/chat", true)).then(beginOpen).then(finishOpen)
    .then(detach(false)).then(attach(2, 2, 1)).then(queueRead).then(readResult)
    .expect(safety and s.pending.token == 1 and s.readback == noDelivery)
}
