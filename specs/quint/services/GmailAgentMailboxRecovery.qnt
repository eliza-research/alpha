// One selected owner grant, two representative turn/message/revision IDs, two invocations.
module GmailAgentMailboxRecovery {
  type Proposal = {request: int, message: int, history: int, kind: str}
  type Receipt = {state: str, kind: str, message: int}
  type State = {
    phase: str, result: str, invocations: int, sameScope: bool, request: int, message: int, kind: str,
    durable: int -> Receipt, priorState: str, history: int, proposal: Proposal, sent: Proposal,
    reviewed: bool, grantConfirmed: bool, aborted: bool, calls: List[str],
    dispatched: bool, totalDispatches: int, recoveryReads: int, firstError: str,
  }
  var s: State
  pure val Ids = Set(1, 2)
  pure val Kinds = Set("archive", "trash", "mark-read", "mark-unread")
  pure val DurableStates = Set("none", "prepared", "dispatched", "succeeded", "rejected", "outcome-unknown")
  pure val NonPreparedReceipts = DurableStates.exclude(Set("none", "prepared"))
  pure val EmptyReceipt = {state: "none", kind: "none", message: 0}
  pure val EmptyProposal = {request: 0, message: 0, history: 0, kind: "none"}
  pure val PriorReplies = Set("canonical", "lookup-error", "wrong-kind", "wrong-id", "bad-labels")
  pure val ReviewReplies = Set("exact", "history", "message", "kind", "from", "digest", "receipt-state",
    "receipt-kind", "receipt-id", "provider-refused")
  pure val AccountReplies = Set("matching", "revoked", "foreign", "disconnected", "abort")
  pure val DispatchReplies = Set("canonical", "lost", "bad-labels", "abort")
  pure val RecoveryReplies = Set("canonical", "lookup-error", "wrong-kind", "wrong-id", "bad-labels", "abort")
  pure def outcome(state: str): str = if (state == "succeeded") "ok" else "unconfirmed"

  pure def receipt(state: str, kind: str, message: int): Receipt =
    if (state == "none") EmptyReceipt else {state: state, kind: kind, message: if (state == "succeeded") message else 0}
  action startState(request: int, durable: str, kind: str, message: int): bool = all {
    Ids.contains(request), DurableStates.contains(durable), Kinds.contains(kind), Ids.contains(message),
    s' = {phase: "idle", result: "none", invocations: 0, sameScope: false, request: 0, message: 0,
      kind: "none", durable: Map(1 -> EmptyReceipt, 2 -> EmptyReceipt).set(request, receipt(durable, kind, message)), priorState: "none",
      history: 0, proposal: EmptyProposal, sent: EmptyProposal, reviewed: false, grantConfirmed: false,
      aborted: false, calls: [], dispatched: false, totalDispatches: 0, recoveryReads: 0, firstError: "none"},
  }
  action init = {
    nondet request = Ids.oneOf()
    nondet durable = DurableStates.oneOf()
    nondet kind = Kinds.oneOf()
    nondet message = Ids.oneOf()
    startState(request, durable, kind, message)
  }
  action begin(sameScope: bool, message: int, request: int, kind: str): bool = {
    val valid = sameScope and Ids.contains(message) and Ids.contains(request) and Kinds.contains(kind)
    all {
      s.phase.in(Set("idle", "done")), s.invocations < 2,
      message.in(Ids.union(Set(0))), request.in(Ids.union(Set(0))), kind.in(Kinds.union(Set("send"))),
      s' = {...s, phase: if (valid) "lookup" else "done", result: if (valid) "none" else "invalid-selection",
        invocations: s.invocations + 1, sameScope: sameScope, request: request, message: message, kind: kind,
        priorState: "none", history: 0, proposal: EmptyProposal, sent: EmptyProposal, reviewed: false,
        grantConfirmed: false, aborted: false, calls: [], dispatched: false, recoveryReads: 0, firstError: "none"},
    }
  }
  action lookup(reply: str): bool = all {
    s.phase == "lookup", PriorReplies.contains(reply),
    reply.in(Set("wrong-kind", "wrong-id")) implies s.durable.get(s.request).state != "none",
    reply == "bad-labels" implies s.durable.get(s.request).state == "succeeded",
    { val durable = s.durable.get(s.request)
      val sameKind = durable.state == "none" or durable.kind == s.kind
      val proceed = reply == "canonical" and sameKind and durable.state.in(Set("none", "prepared"))
      val result = if (proceed) "none" else if (reply == "lookup-error") "lookup-error"
        else if (reply == "wrong-id") "invalid-receipt" else if (reply == "wrong-kind" or not(sameKind)) "wrong-operation"
        else if (reply == "bad-labels" or (durable.state == "succeeded" and durable.message != s.message)) "labels"
        else outcome(durable.state)
      s' = {...s, phase: if (proceed) "message" else "done", result: result,
        priorState: durable.state, calls: s.calls.append("lookup")} },
  }
  action readMessage(history: int): bool = all {
    s.phase == "message", history.in(Ids.union(Set(0))),
    s' = {...s, history: history, phase: if (history == 0) "done" else "prepare",
      result: if (history == 0) "history-unavailable" else "none", calls: s.calls.append("message")},
  }
  action prepare(reply: str): bool = {
    val exact = reply == "exact"
    val result = if (exact) "none" else if (reply == "receipt-id") "invalid-receipt"
      else if (reply == "provider-refused") "prepare-refused" else "review-changed"
    all {
      s.phase == "prepare", ReviewReplies.contains(reply),
      s' = {...s, phase: if (exact) "accounts" else "done", result: result, reviewed: exact,
        durable: if (reply == "provider-refused") s.durable else s.durable.set(s.request, receipt("prepared", s.kind, s.message)),
        proposal: {request: s.request, message: s.message, history: s.history, kind: s.kind}, calls: s.calls.append("prepare")},
    }
  }
  action accounts(reply: str): bool = all {
    s.phase == "accounts", AccountReplies.contains(reply),
    s' = {...s, phase: if (reply == "matching") "dispatch" else "done",
      result: if (reply == "matching") "none" else if (reply == "abort") "aborted" else "permission-changed",
      grantConfirmed: reply == "matching", aborted: reply == "abort", calls: s.calls.append("accounts")},
  }
  action abortBeforeDispatch: bool = all {
    s.phase == "dispatch",
    s' = {...s, phase: "done", result: "aborted", aborted: true},
  }
  action dispatch(providerState: str, reply: str): bool = {
    val recovery = reply.in(Set("lost", "bad-labels"))
    val aborted = reply == "abort"
    all {
      s.phase == "dispatch", DispatchReplies.contains(reply),
      DurableStates.contains(providerState), providerState != "none",
      reply == "bad-labels" implies providerState == "succeeded",
      s' = {...s, phase: if (recovery) "recovery" else "done",
        result: if (recovery) "none" else if (aborted) "aborted" else outcome(providerState),
        firstError: if (reply == "lost") "dispatch-error" else if (reply == "bad-labels") "labels" else "none",
        durable: s.durable.set(s.request, receipt(providerState, s.kind, s.message)), dispatched: true, totalDispatches: s.totalDispatches + 1,
        sent: s.proposal, aborted: aborted, calls: s.calls.append("dispatch")},
    }
  }
  action readback(reply: str): bool = all {
    s.phase == "recovery", RecoveryReplies.contains(reply),
    reply == "bad-labels" implies s.durable.get(s.request).state == "succeeded",
    { val durable = s.durable.get(s.request)
      val matching = durable.state != "none" and durable.kind == s.kind
        and (durable.state != "succeeded" or durable.message == s.message)
      s' = {...s, phase: "done", result: if (reply == "canonical" and matching) outcome(durable.state) else s.firstError,
        aborted: reply == "abort", recoveryReads: s.recoveryReads + 1, calls: s.calls.append("readback")} },
  }

  val DispatchUsesExactReviewAndGrant = s.dispatched implies
    s.sameScope and Kinds.contains(s.kind) and Ids.contains(s.request) and s.reviewed and s.grantConfirmed
    and s.sent == {request: s.request, message: s.message, history: s.history, kind: s.kind} and s.sent == s.proposal
  val NonPreparedReceiptNeverResubmits = NonPreparedReceipts.contains(s.priorState) implies not(s.dispatched)
  val RecoveryReadsAtMostOnce = s.recoveryReads <= 1 and (s.recoveryReads > 0 implies s.dispatched)
  val DispatchAtMostOncePerInvocation = s.totalDispatches <= s.invocations
    and s.calls.select(call => call == "dispatch").length() == (if (s.dispatched) 1 else 0)
  val AbortedInvocationNeverReportsSuccess = s.aborted implies s.result != "ok"
  val safety = DispatchUsesExactReviewAndGrant and NonPreparedReceiptNeverResubmits
    and RecoveryReadsAtMostOnce and DispatchAtMostOncePerInvocation and AbortedInvocationNeverReportsSuccess

  action step = any {
    all {s.phase.in(Set("idle", "done")), s.invocations < 2,
      { nondet scope = Bool.oneOf()
        nondet message = Ids.union(Set(0)).oneOf()
        nondet request = Ids.union(Set(0)).oneOf()
        nondet kind = Kinds.union(Set("send")).oneOf()
        begin(scope, message, request, kind) }},
    all {s.phase == "lookup", { nondet reply = PriorReplies.oneOf()
      lookup(reply) }},
    all {s.phase == "message", { nondet history = Ids.union(Set(0)).oneOf()
      readMessage(history) }},
    all {s.phase == "prepare", { nondet reply = ReviewReplies.oneOf()
      prepare(reply) }},
    all {s.phase == "accounts", { nondet reply = AccountReplies.oneOf()
      accounts(reply) }},
    abortBeforeDispatch,
    all {s.phase == "dispatch", { nondet durable = DurableStates.exclude(Set("none")).oneOf()
      nondet reply = DispatchReplies.oneOf()
      dispatch(durable, reply) }},
    all {s.phase == "recovery", { nondet reply = RecoveryReplies.oneOf()
      readback(reply) }},
    s' = s,
  }

  action ready = begin(true, 1, 1, "archive").then(lookup("canonical")).then(readMessage(1))
    .then(prepare("exact")).then(accounts("matching"))
  run lostDispatchReadsOnceAndRetainsTerminalReceiptTest = startState(1, "none", "archive", 1).then(ready)
    .then(dispatch("succeeded", "lost")).then(readback("canonical")).expect(s.result == "ok" and safety)
    .then(begin(true, 1, 1, "archive")).then(lookup("canonical"))
    .expect(s.result == "ok" and s.totalDispatches == 1 and not(s.dispatched) and safety)
  run priorUnknownNeverReadsMessageOrDispatchesTest = startState(1, "outcome-unknown", "trash", 1)
    .then(begin(true, 1, 1, "trash")).then(lookup("canonical"))
    .expect(s.result == "unconfirmed" and s.calls == ["lookup"] and safety)
  run changedHistoryReviewStopsBeforeAccountRecheckTest = startState(1, "none", "archive", 1).then(begin(true, 1, 1, "mark-read"))
    .then(lookup("canonical")).then(readMessage(2)).then(prepare("history"))
    .expect(s.result == "review-changed" and not(s.dispatched) and safety)
  run permissionWithdrawalStopsBeforeDispatchTest = startState(1, "none", "archive", 1).then(begin(true, 1, 1, "trash"))
    .then(lookup("canonical")).then(readMessage(1)).then(prepare("exact")).then(accounts("foreign"))
    .expect(s.result == "permission-changed" and not(s.dispatched) and safety)
  run abortSuppressesReadbackTest = startState(1, "none", "archive", 1).then(ready).then(dispatch("succeeded", "abort"))
    .expect(s.result == "aborted" and s.recoveryReads == 0 and safety)
  run abortDuringReadbackPreservesFirstErrorTest = startState(1, "none", "archive", 1).then(ready)
    .then(dispatch("outcome-unknown", "lost")).then(readback("abort"))
    .expect(s.result == "dispatch-error" and s.recoveryReads == 1 and safety)
}
