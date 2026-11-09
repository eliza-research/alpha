// Browser-mounted digest history, poll ownership and single-flight refresh.
module HostedDigestRefresh {
  type State = {session: int, hidden: bool, open: bool, available: bool,
    histories: Set[int], visited: Set[int], statusOwner: int, statusFull: bool,
    flightOwner: int, flightMode: str, retired: bool, waitFull: int,
    resultOwner: int, briefAgent: int, fullReads: int -> int}
  var s: State
  pure val Owners = Set(1, 2)
  pure val Modes = Set("", "results", "full")

  pure def publish(x: State, owner: int, hasResult: bool): State =
    {...x, resultOwner: if (hasResult) owner else 0, briefAgent: if (hasResult) owner else 0}
  pure def start(x: State, full: bool): State = {
    val mode = if (full) "full" else "results"
    {...x, flightOwner: x.session, flightMode: mode, retired: false,
      available: x.available or full,
      fullReads: if (full) x.fullReads.set(x.session, x.fullReads.get(x.session) + 1) else x.fullReads}
  }
  pure def refresh(x: State, full: bool): State =
    if (x.session == 0 or x.hidden) x
    else if (x.flightOwner == 0) start(x, full)
    else if (full and x.flightMode == "results") {...x, waitFull: x.session}
    else x
  pure def afterFlight(x: State): State =
    if (x.session == 0 or x.hidden) x
    else if (x.flightOwner == 0) start(x, true)
    else {...x, waitFull: x.session}

  action init = s' = {session: 0, hidden: false, open: false, available: false,
    histories: Set(), visited: Set(), statusOwner: 0, statusFull: false, flightOwner: 0, flightMode: "",
    retired: false, waitFull: 0, resultOwner: 0, briefAgent: 0, fullReads: Owners.mapBy(_ => 0)}
  action selectSession(owner: int): bool = all {
    Owners.union(Set(0)).contains(owner), owner != s.session, not(s.visited.contains(owner)),
    s' = {...s, session: owner, available: false, resultOwner: 0, briefAgent: 0, waitFull: 0,
      histories: if (owner == 0) s.histories else s.histories.union(Set(owner)),
      visited: if (owner == 0) s.visited else s.visited.union(Set(owner)),
      retired: s.flightOwner != 0},
  }
  action historyReply(owner: int, hasResult: bool, ok: bool): bool = all {
    s.histories.contains(owner),
    val current = {...s, histories: s.histories.exclude(Set(owner))}
    s' = if (owner != s.session) current
      else afterFlight(if (ok) publish(current, owner, hasResult) else current),
  }
  action open = all { not(s.open), s' = refresh({...s, open: true}, true) }
  action close = all { s.open, s' = {...s, open: false} }
  action visibility(hidden: bool): bool = all {
    s.hidden != hidden,
    val visible = {...s, hidden: hidden}
    s' = if (hidden) {...visible, retired: s.flightOwner != 0} else afterFlight(visible),
  }
  action poll(held: bool): bool = all {
    s.statusOwner == 0,
    not(held) or (s.flightOwner == 0 and not(s.hidden) and s.session != 0),
    s' = if (s.hidden or s.session == 0) s
      else if (held) {...s, statusOwner: s.session, statusFull: s.open}
      else refresh(s, s.open),
  }
  action statusReply(owner: int, allow: bool): bool = all {
    owner != 0, owner == s.statusOwner,
    val current = {...s, statusOwner: 0, statusFull: false}
    s' = if (allow and owner == s.session) refresh(current, s.statusFull) else current,
  }
  action syncReply(owner: int, hasResult: bool, ok: bool): bool = all {
    owner != 0, owner == s.flightOwner,
    val settled = {...s, flightOwner: 0, flightMode: "", retired: false, waitFull: 0}
    val current = if (owner == s.session and not(s.retired) and not(s.hidden) and ok)
      publish(settled, owner, hasResult) else settled
    s' = if (s.waitFull != 0 and s.waitFull == s.session) refresh(current, true) else current,
  }
  action step = any {
    { nondet owner = Owners.union(Set(0)).oneOf(); selectSession(owner) },
    { nondet owner = Owners.oneOf(); nondet row = Bool.oneOf(); nondet ok = Bool.oneOf(); historyReply(owner, row, ok) },
    open, close,
    { nondet hidden = Bool.oneOf(); visibility(hidden) },
    { nondet held = Bool.oneOf(); poll(held) },
    { nondet owner = Owners.oneOf(); nondet allow = Bool.oneOf(); statusReply(owner, allow) },
    { nondet owner = Owners.oneOf(); nondet row = Bool.oneOf(); nondet ok = Bool.oneOf(); syncReply(owner, row, ok) },
  }
  val safety = all {
    Modes.contains(s.flightMode),
    (s.flightOwner == 0) == (s.flightMode == ""),
    s.flightOwner != 0 and s.flightOwner != s.session implies s.retired,
    s.hidden and s.flightOwner != 0 implies s.retired,
    s.waitFull != 0 implies s.waitFull == s.session and s.flightOwner != 0,
    s.resultOwner != 0 implies s.resultOwner == s.session,
    s.briefAgent == s.resultOwner,
    if (s.available) s.session != 0 and s.fullReads.get(s.session) > 0 else true,
  }
  run retiredPromotionCannotLabelReplacementTest = init.then(selectSession(1)).then(historyReply(1, false, true))
    .then(syncReply(1, true, true)).then(poll(false)).then(open).then(selectSession(2))
    .then(historyReply(2, false, true)).then(syncReply(1, true, true)).then(syncReply(2, true, true))
    .expect(s.briefAgent == 2 and s.fullReads.get(2) == 1 and safety)
  run retiredPollStatusCannotDispatchReplacementReadTest = init.then(selectSession(1)).then(historyReply(1, false, true))
    .then(syncReply(1, true, true)).then(poll(true)).then(selectSession(2)).then(statusReply(1, true))
    .expect(s.flightOwner == 0 and s.histories.contains(2) and safety)
  run sameSessionPromotionKeepsFullFollowUpTest = init.then(selectSession(1)).then(historyReply(1, false, true))
    .then(syncReply(1, true, true)).then(poll(false)).then(open).then(syncReply(1, true, true))
    .expect(s.flightMode == "full" and s.fullReads.get(1) == 2 and safety)
  run visibilityRetiresHeldResultAndResumesTest = init.then(selectSession(1)).then(historyReply(1, false, true))
    .then(visibility(true)).then(visibility(false)).then(syncReply(1, true, true))
    .expect(s.resultOwner == 0 and s.flightMode == "full" and safety)
  run lateHistoryCannotPublishForReplacementTest = init.then(selectSession(1)).then(selectSession(2))
    .then(historyReply(1, true, true)).expect(s.resultOwner == 0 and s.flightOwner == 0 and safety)
}
