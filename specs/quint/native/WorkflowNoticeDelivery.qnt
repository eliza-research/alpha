module WorkflowNoticeDelivery {
  type Route = {owner: int, binding: int, runId: int, token: int}
  type Receipt = {binding: int, content: int, status: str}
  type Call = {kind: str, phase: str, owner: int, binding: int, runId: int,
    content: int, reply: str, terminal: str}
  type State = {owner: int, route: Route, receipt: Receipt, call: Call, visible: bool,
    bridge: bool, allowed: bool, generation: int, manager: str, posts: int, cancels: int}

  pure val noRoute: Route = {owner: 0, binding: 0, runId: 0, token: 0}
  pure val noReceipt: Receipt = {binding: 0, content: 0, status: "absent"}
  pure val noCall: Call = {kind: "none", phase: "idle", owner: 0, binding: 0, runId: 0,
    content: 0, reply: "none", terminal: "none"}
  pure val owners = Set(1, 2)
  pure val contentClasses = 1.to(3)
  pure val writeModes = Set("ok", "before", "after")
  pure val postModes = Set("visible", "late", "lost", "refused", "blocked")
  pure val receiptStates = Set("absent", "applying", "succeeded", "failed", "unknown", "withdrawn")
  var s: State

  action init = s' = {owner: -1, route: noRoute, receipt: noReceipt, call: noCall,
    visible: true, bridge: true, allowed: true, generation: 1, manager: "none", posts: 0, cancels: 0}
  val onScreen = s.visible and s.bridge
  val free = s.call.phase.in(Set("idle", "done"))
  val ReplyAcknowledged = s.call.phase == "done" and s.call.reply == "succeeded"
  val exactReceipt = s.receipt.binding == s.call.binding and s.receipt.content == s.call.content
  val routeOwnerMatches = s.owner == -1 or s.call.owner == s.owner
  val desiredRoute = {owner: s.call.owner, binding: s.call.binding, runId: s.call.runId, token: 1}
  pure def reply(state: State, status: str): State =
    {...state, call: {...state.call, phase: "done", reply: status}}
  action owner(owner: int): bool = all {owner.in(0.to(2)), s' = {...s, owner: owner}}
  action foreground(visible: bool): bool = s' = {...s, visible: visible}
  action permission(allowed: bool): bool = s' = {...s, allowed: allowed}
  action destroy = all {s.bridge, s' = {...s, bridge: false}}
  action reopen = all {
    free, s.generation == 1,
    s' = {...s, generation: 2, bridge: true, visible: true, call: noCall}
  }
  action queuePublish(owner: int, binding: int, runId: int, content: int): bool = all {
    free, owner.in(owners), binding.in(owners), runId.in(owners), content.in(contentClasses),
    s' = {...s, call: {...noCall, kind: "publish", phase: "queued",
      owner: owner, binding: binding, runId: runId, content: content}}
  }
  action queueReceipt(binding: int, content: int): bool = all {
    free, binding.in(owners), content.in(contentClasses),
    s' = {...s, call: {...noCall, kind: "receipt", phase: "queued", binding: binding, content: content}}
  }
  action claimRoute(mode: str): bool = all {
    s.call.kind == "publish", s.call.phase == "queued", mode.in(writeModes),
    val admitted = onScreen and routeOwnerMatches and (s.route == noRoute or s.route == desiredRoute)
    val persisted = admitted and s.route == noRoute and mode != "before"
    val prepared = {...s, route: if (persisted) desiredRoute else s.route}
    s' = if (admitted and (s.route != noRoute or mode == "ok")) {...prepared, call: {...s.call, phase: "routed"}}
      else reply(prepared, "rejected")
  }
  action refuseRouted = all {
    s.call.phase == "routed", not(onScreen),
    s' = reply(s, "rejected")
  }
  action claimDelivery(mode: str): bool = all {
    s.call.phase == "routed", onScreen, s.receipt == noReceipt, mode.in(writeModes),
    val initial = if (s.allowed) "applying" else "failed"
    val claimed = if (mode == "before") s else
      {...s, receipt: {binding: s.call.binding, content: s.call.content, status: initial}}
    s' = if (mode != "ok") reply(claimed, "rejected")
      else if (initial == "failed") reply(claimed, "failed")
      else {...claimed, call: {...s.call, phase: "claimed"}}
  }
  action notify(mode: str): bool = all {
    s.call.phase == "claimed", postModes.contains(mode), (mode == "blocked") == not(s.allowed),
    val effect = not(mode.in(Set("blocked", "refused")))
    val listed = if (mode == "late") "hidden" else if (effect) "exact" else "none"
    s' = {...s, posts: s.posts + (if (effect) 1 else 0), manager: listed,
      call: {...s.call, phase: "posted", terminal: if (mode == "visible") "succeeded" else "unknown"}}
  }
  action finish(mode: str): bool = all {
    s.call.phase == "posted", mode.in(writeModes),
    val stored = if (mode == "before") s else {...s, receipt: {...s.receipt, status: s.call.terminal}}
    s' = reply(stored, if (mode == "ok") s.call.terminal else "rejected")
  }
  action retained(mode: str): bool = all {
    mode.in(writeModes),
    s.call.kind == "receipt" and s.call.phase == "queued" or
      s.call.kind == "publish" and s.call.phase == "routed" and s.receipt != noReceipt,
    val status = s.receipt.status
    val reconciled = if (status.in(Set("applying", "unknown")))
      (if (s.manager == "exact") "succeeded" else "unknown") else status
    val write = status != reconciled
    val stored = if (write and mode != "before") {...s, receipt: {...s.receipt, status: reconciled}} else s
    s' = if (not(onScreen)) reply(s, "rejected")
      else if (status == "absent") reply(s, "unknown")
      else if (not(exactReceipt)) reply(s, "rejected")
      else reply(stored, if (write and mode != "ok") "rejected" else reconciled)
  }
  action reveal = all {s.manager == "hidden", s' = {...s, manager: "exact"}}
  action replaceVisible = all {s.manager == "exact", s' = {...s, manager: "different"}}
  action dismiss = all {s.manager.in(Set("exact", "hidden", "different")), s' = {...s, manager: "none"}}
  action withdrawTo(owner: int, mode: str): bool = all {
    free, owner.in(0.to(2)), mode.in(writeModes), s.cancels < 2,
    val withdraw = s.route != noRoute and s.route.owner != owner
    val writesReceipt = withdraw and s.receipt != noReceipt
    val cancel = withdraw and (not(writesReceipt) or mode == "ok")
    s' = {...s, owner: owner,
      receipt: if (writesReceipt and mode != "before") {...s.receipt, status: "withdrawn"} else s.receipt,
      manager: if (cancel) "none" else s.manager,
      cancels: s.cancels + (if (cancel) 1 else 0)}
  }

  val AtMostOneManagerPost = s.posts.in(0.to(1))
  val PostedNoticeHasExactDurableClaim = (s.posts > 0) implies
    (s.route != noRoute and s.receipt != noReceipt and s.route.binding == s.receipt.binding)
  val ConfirmedReplyHasSucceededReceipt = ReplyAcknowledged implies
    (exactReceipt and s.receipt.status.in(Set("succeeded", "withdrawn")))
  val safety = AtMostOneManagerPost and PostedNoticeHasExactDurableClaim and ConfirmedReplyHasSucceededReceipt
    and s.receipt.status.in(receiptStates) and s.generation.in(1.to(2))

  action step = any {
    nondet id = 0.to(2).oneOf()
    nondet mode = writeModes.oneOf()
    any {owner(id), withdrawTo(id, mode)},
    nondet flag = Set(true, false).oneOf()
    any {foreground(flag), permission(flag)},
    nondet owner = owners.oneOf()
    nondet binding = owners.oneOf()
    nondet runId = owners.oneOf()
    nondet content = contentClasses.oneOf()
    queuePublish(owner, binding, runId, content),
    nondet binding = owners.oneOf()
    nondet content = contentClasses.oneOf()
    queueReceipt(binding, content),
    nondet mode = writeModes.oneOf()
    any {claimRoute(mode), claimDelivery(mode), finish(mode), retained(mode)},
    nondet mode = postModes.oneOf()
    notify(mode),
    refuseRouted, reveal, replaceVisible, dismiss, destroy, reopen, s' = s
  }

  run durableClaimPrecedesAcknowledgedPostTest = init.then(queuePublish(1, 1, 1, 1)).then(claimRoute("ok"))
    .then(claimDelivery("ok")).expect(safety and s.receipt.status == "applying" and s.posts == 0)
    .then(notify("visible")).then(finish("ok")).expect(safety and ReplyAcknowledged and s.posts == 1)
  run foregroundLossPreservesOnlyPreparedRouteTest = init.then(queuePublish(1, 1, 1, 1)).then(claimRoute("ok"))
    .then(foreground(false)).then(refuseRouted)
    .expect(safety and s.route.token == 1 and s.receipt == noReceipt and s.posts == 0)
  run uncertainClaimNeverRepostsTest = init.then(queuePublish(1, 1, 1, 1)).then(claimRoute("ok"))
    .then(claimDelivery("after")).then(reopen).then(queuePublish(1, 1, 1, 1))
    .then(claimRoute("ok")).then(retained("ok"))
    .expect(safety and s.receipt.status == "unknown" and s.posts == 0)
  run lateExactActiveReadReconcilesWithoutRepostTest = init.then(queuePublish(1, 1, 1, 1))
    .then(claimRoute("ok")).then(claimDelivery("ok")).then(notify("late")).then(finish("ok"))
    .then(reveal).then(queueReceipt(1, 1)).then(retained("ok"))
    .expect(safety and ReplyAcknowledged and s.posts == 1)
  run lostTerminalWriteCanBeRecoveredByExactReadTest = init.then(queuePublish(1, 1, 1, 1))
    .then(claimRoute("ok")).then(claimDelivery("ok")).then(notify("visible")).then(finish("before"))
    .expect(safety and not(ReplyAcknowledged) and s.receipt.status == "applying")
    .then(queueReceipt(1, 1)).then(retained("ok")).expect(safety and ReplyAcknowledged and s.posts == 1)
  run explicitOwnerRejectsStaleQueuedRouteTest = init.then(owner(1)).then(queuePublish(1, 1, 1, 1))
    .then(owner(2)).then(claimRoute("ok"))
    .expect(safety and s.call.reply == "rejected" and s.route == noRoute)
  run withdrawalWriteFaultKeepsOwnerFenceTest = init.then(queuePublish(1, 1, 1, 1))
    .then(claimRoute("ok")).then(claimDelivery("ok")).then(notify("visible")).then(finish("ok"))
    .then(withdrawTo(2, "after"))
    .expect(safety and s.owner == 2 and s.receipt.status == "withdrawn" and s.cancels == 0)
    .then(queuePublish(1, 1, 1, 1)).then(claimRoute("ok")).expect(s.call.reply == "rejected")
    .then(withdrawTo(2, "ok")).expect(safety and s.cancels == 1 and s.manager == "none")
}
