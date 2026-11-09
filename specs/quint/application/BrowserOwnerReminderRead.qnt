// Passive owner-reminder transport as implemented by the browser port.
module BrowserOwnerReminderRead {
  type State = {owner: str, mode: str, epoch: int, privacy: bool, shade: bool,
    rows: str, status: str, blocked: bool, reads: int, now: int, lastRead: int,
    flightOwner: str, cancelled: bool, waiters: int, dispatched: int, lastReturn: str}
  var s: State
  pure val Owners = Set("", "A", "B")
  pure val Modes = Set("ready", "busy", "blocked")
  pure val Outcomes = Set("exact", "filtered", "invalid", "refused")
  pure def visible(x: State): bool = x.privacy and x.shade
  pure def initialStatus(x: State): str = if (x.owner == "") "unconfigured" else "ready"
  pure def cancel(x: State): State = {...x, rows: "", lastRead: -1,
    cancelled: x.flightOwner != ""}
  pure def change(x: State): State =
    if (x.owner == "" or x.mode == "ready") x
    else if (x.mode == "blocked") cancel({...x, epoch: x.epoch + 1})
    else cancel(x)

  action init = s' = {owner: "", mode: "ready", epoch: 0, privacy: false, shade: false,
    rows: "", status: "unconfigured", blocked: false, reads: 0, now: 0, lastRead: -1,
    flightOwner: "", cancelled: false, waiters: 0, dispatched: 0, lastReturn: ""}
  action owner(newOwner: str): bool = all {
    Owners.contains(newOwner), newOwner != s.owner,
    val replaced = cancel({...s, owner: newOwner, mode: "ready", epoch: s.epoch + 1,
      reads: 0, blocked: false})
    s' = {...replaced, status: initialStatus(replaced)},
  }
  action mode(newMode: str): bool = all {
    s.owner != "", Modes.contains(newMode), s' = change({...s, mode: newMode}),
  }
  action visibility(privacy: bool, shade: bool): bool = {
    val before = visible(s)
    val after = privacy and shade
    val gates = {...s, privacy: privacy, shade: shade}
    val retired = if (s.privacy and not(privacy)) cancel({...gates, epoch: s.epoch + 1})
      else if (before and not(after)) cancel(gates) else gates
    s' = if (not(before) and after)
      {...retired, reads: 0, blocked: false, status: initialStatus(retired)} else retired
  }
  action refresh = s' = if (visible(s))
    {...s, reads: 0, blocked: false, lastRead: -1, status: initialStatus(s)} else s
  action advance(ms: int): bool = all {
    Set(1, 4999, 5000).contains(ms), s.now + ms <= 160000, s' = {...s, now: s.now + ms},
  }
  action read = {
    val x = change(s)
    s' =
      if (x.owner == "" or not(visible(x)) or x.mode != "ready" or x.blocked)
        {...x, lastReturn: ""}
      else if (x.flightOwner != "") {...x, waiters: x.waiters + 1}
      else if (x.lastRead >= 0 and x.now - x.lastRead < 5000) {...x, lastReturn: x.rows}
      else if (x.reads >= 24) {...x, status: "paused", lastReturn: x.rows}
      else {...x, flightOwner: x.owner, waiters: 1, cancelled: false,
        reads: x.reads + 1, dispatched: x.dispatched + 1}
  }
  action settle(outcome: str): bool = all {
    Outcomes.contains(outcome), s.flightOwner != "",
    val admitted = not(s.cancelled) and visible(s) and s.owner == s.flightOwner and s.mode == "ready"
    val done = {...s, flightOwner: "", cancelled: false, waiters: 0}
    val settled =
      if (not(admitted)) done
      else if (Set("invalid", "refused").contains(outcome))
        {...done, rows: "", blocked: true, status: "unavailable"}
      else {...done, rows: if (outcome == "exact") s.owner else "",
        lastRead: s.now, status: "ready", blocked: false}
    s' = {...settled, lastReturn: if (visible(settled)) settled.rows else ""},
  }

  action step = any {
    { nondet who = Owners.exclude(Set(s.owner)).oneOf(); owner(who) },
    { nondet choice = Modes.oneOf(); mode(choice) },
    { nondet privacy = Bool.oneOf(); nondet shade = Bool.oneOf(); visibility(privacy, shade) },
    refresh, read, advance(1), advance(4999), advance(5000),
    { nondet outcome = Outcomes.oneOf(); settle(outcome) },
  }
  val safety = all {
    s.rows == "" or (visible(s) and s.rows == s.owner and s.mode == "ready"),
    (s.flightOwner == "") == (s.waiters == 0),
    s.cancelled implies s.flightOwner != "",
    s.flightOwner != "" and not(s.cancelled) implies s.flightOwner == s.owner,
    s.reads >= 0 and s.reads <= 24,
    s.lastRead <= s.now,
    s.blocked implies s.status == "unavailable",
  }
  run ownerReplacementWaitsForRetiredTransportTest = init
    .then(owner("A")).then(visibility(true, true)).then(read).then(owner("B"))
    .then(read).expect(s.cancelled and s.flightOwner == "A" and s.waiters == 2 and s.dispatched == 1)
    .then(settle("exact")).expect(s.rows == "" and s.lastReturn == "")
    .then(read).then(settle("exact")).expect(s.rows == "B" and safety)
  run cacheBoundaryAndRefreshTest = init
    .then(owner("A")).then(visibility(true, true)).then(read).then(settle("exact"))
    .then(advance(4999)).then(read).expect(s.dispatched == 1 and s.lastReturn == "A")
    .then(advance(1)).then(read).then(settle("invalid")).expect(s.blocked and s.rows == "")
    .then(refresh).then(read).then(settle("filtered")).expect(s.status == "ready" and safety)
  run closeAndReopenShadeDiscardsLateReplyTest = init
    .then(owner("A")).then(visibility(true, true)).then(read)
    .then(visibility(true, false)).then(visibility(true, true)).then(read)
    .then(settle("exact")).expect(s.rows == "" and s.lastRead == -1 and safety)
  run busyAndPrivacyRetirePublicationTest = init
    .then(owner("A")).then(visibility(true, true)).then(read).then(mode("busy"))
    .then(settle("refused")).expect(s.status == "ready" and s.rows == "")
    .then(mode("ready")).then(read).then(visibility(false, true))
    .then(settle("exact")).expect(s.rows == "" and s.lastReturn == "" and safety)
}
