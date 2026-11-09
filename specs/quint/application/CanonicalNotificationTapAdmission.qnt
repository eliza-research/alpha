module CanonicalNotificationTapAdmission {
  pure val Tokens = Set(1, 2)
  pure val Accounts = Set(1, 2)
  pure val Views = Set("home", "notes", "calendar")
  pure val Routes = Set("notes", "calendar", "chat", "exact")
  type Tap = {token: int, account: int, route: str}
  type State = {generation: int, live: bool, busy: bool, protected: bool,
    session: int, context: int, view: str, chat: bool, exactHistory: bool,
    phase: str, drain: bool, pending: Tap, captured: Tap, published: Set[int],
    originSession: int, originContext: int, originView: str,
    reads: int, opens: List[int], attempts: List[int], acknowledged: Set[int]}
  pure val none: Tap = {token: 0, account: 0, route: "none"}
  var state: State

  pure def eligible(s: State): bool = s.live and not(s.protected) and s.session != 0
  pure def canNavigate(s: State): bool = eligible(s) and not(s.busy)
  pure def originCurrent(s: State): bool = eligible(s) and s.session == s.originSession
    and s.context == s.originContext and s.view == s.originView
  pure def begin(s: State): State =
    if (canNavigate(s) and s.phase == "idle")
      {...s, phase: "read", drain: false, captured: s.pending, originSession: s.session,
        originContext: s.context, originView: s.view, reads: s.reads + 1}
    else s
  pure def complete(s: State): State = {
    val idle = {...s, phase: "idle", captured: none, originSession: 0, originContext: 0, originView: "home"}
    if (idle.drain) begin(idle) else idle
  }
  pure def opened(s: State): State =
    if (s.captured.route == "notes" or s.captured.route == "calendar")
      {...s, phase: "commit", view: s.captured.route, opens: s.opens.append(s.captured.token)}
    else {...s, phase: "commit", chat: true, opens: s.opens.append(s.captured.token)}

  action init = state' = {generation: 0, live: false, busy: false, protected: false,
    session: 1, context: 0, view: "home", chat: false, exactHistory: false,
    phase: "idle", drain: false, pending: none, captured: none, published: Set(),
    originSession: 0, originContext: 0, originView: "home",
    reads: 0, opens: [], attempts: [], acknowledged: Set()}

  action mount = all {
    not(state.live), state.generation < 2,
    state' = begin({...state, generation: state.generation + 1, live: true})
  }

  action retire = all {
    state.live,
    state' = complete({...state, live: false, drain: false})
  }

  action publish(token: int, account: int, route: str): bool = all {
    token.in(Tokens), account.in(Accounts), route.in(Routes), not(token.in(state.published)),
    state' = {...state, pending: {token: token, account: account, route: route},
      published: state.published.union(Set(token))}
  }

  action wake = if (state.live) state' = begin({...state, drain: true}) else state' = state
  action probe = state' = begin(state)
  action setBusy(value: bool): bool = state' = {...state, busy: value}
  action protect(value: bool): bool = state' = {...state, protected: value}
  action switchSession(session: int): bool = all {
    session.in(0.to(2)),
    state' = {...state, session: session, exactHistory: false}
  }
  action navigate(view: str): bool = all {
    view.in(Views),
    state' = {...state, view: view, chat: false, context: state.context + 1, exactHistory: false}
  }

  action readReply(ok: bool): bool = all {
    state.phase == "read",
    if (not(ok) or not(canNavigate(state)) or not(originCurrent(state)) or
        state.captured.token == 0 or state.captured.account != state.session)
      state' = complete(state)
    else if (state.captured.route == "exact") state' = {...state, phase: "restore", busy: true}
    else state' = opened(state)
  }

  action restored(found: bool): bool = all {
    state.phase == "restore",
    val updated = {...state, busy: false,
      exactHistory: if (originCurrent(state)) found else state.exactHistory}
    if (found and originCurrent(state) and canNavigate(updated)) state' = opened(updated)
    else state' = complete(updated)
  }

  action committed = all {
    state.phase == "commit",
    val route = state.captured.route
    val arrived = if (route == "exact") state.chat and state.exactHistory and originCurrent(state)
      else if (route == "chat") state.chat else state.view == route
    val permitted = canNavigate(state) and state.session == state.originSession and arrived
    val token = state.captured.token
    val consumed = permitted and state.pending.token == token
    val updated = {...state, pending: if (consumed) none else state.pending,
      attempts: if (permitted) state.attempts.append(token) else state.attempts,
      acknowledged: if (consumed) state.acknowledged.union(Set(token)) else state.acknowledged}
    state' = complete(updated)
  }

  action staleCompletion = state' = state

  action step = any {
    mount, retire, wake, probe, committed, staleCompletion,
    nondet token = Tokens.oneOf()
    nondet account = Accounts.oneOf()
    nondet route = Routes.oneOf()
    publish(token, account, route),
    nondet flag = Set(true, false).oneOf()
    any {setBusy(flag), protect(flag), readReply(flag), restored(flag)},
    nondet session = 0.to(2).oneOf()
    switchSession(session),
    nondet view = Views.oneOf()
    navigate(view),
    state' = state
  }

  val exactLifetime = state.phase == "idle" or (state.live and state.originSession.in(Accounts))
  val nativeOwnership = state.acknowledged.subseteq(state.published) and
    (state.pending.token == 0 or (state.pending.token.in(state.published) and not(state.pending.token.in(state.acknowledged))))
  val heldCommit = state.phase != "commit" or state.captured.token.in(Tokens)
  val safety = exactLifetime and nativeOwnership and heldCommit and
    state.phase.in(Set("idle", "read", "restore", "commit"))

  run pendingRenderCoalescesRepeatedWakeTest = init.then(publish(1, 1, "notes")).then(mount)
    .then(readReply(true)).then(wake)
    .expect(safety and state.opens == [1] and state.reads == 1)
    .then(committed).then(readReply(true))
    .expect(safety and state.acknowledged == Set(1) and state.opens == [1])
  run busyAfterReadLeavesTapInNativeCustodyTest = init.then(publish(1, 1, "notes")).then(mount)
    .then(setBusy(true)).then(readReply(true))
    .expect(safety and state.pending.token == 1 and state.opens.length() == 0)
  run retiredReadCannotActInNewMountTest = init.then(publish(1, 1, "notes")).then(mount).then(retire)
    .then(publish(2, 1, "calendar")).then(mount).then(readReply(true)).then(committed)
    .then(staleCompletion).expect(safety and state.opens == [2] and state.acknowledged == Set(2))
  run exactRestoreAllowsItsOwnBusyButRespectsUserNavigationTest = init.then(publish(1, 1, "exact")).then(mount)
    .then(readReply(true)).then(navigate("calendar")).then(restored(true))
    .expect(safety and not(state.exactHistory) and state.attempts.length() == 0)
  run replacedNativeTokenCannotBeConsumedByOldCommitTest = init.then(publish(1, 1, "chat")).then(mount)
    .then(readReply(true)).then(publish(2, 1, "notes")).then(wake).then(committed)
    .expect(safety and state.attempts == [1] and state.pending.token == 2)
    .then(readReply(true)).then(committed).expect(safety and state.acknowledged == Set(2))
}
