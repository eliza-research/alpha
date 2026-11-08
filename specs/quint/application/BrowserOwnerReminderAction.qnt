// Explicit browser owner-reminder action and acknowledgement reconciliation.
module BrowserOwnerReminderAction {
  type State = {owner: str, capturedOwner: str, phase: str, active: bool,
    privacy: bool, shade: bool, row: str, status: str, uncertain: bool, blocked: bool,
    wantsOpen: bool, wantedRevision: str, markCalls: int, readbacks: int, openCalls: int, policyCalls: int,
    ui: int, beforeUi: int, openedUi: int, result: str}
  var s: State
  pure val Revisions = Set("v1", "v2")
  pure val Fresh = Set("v1", "v2", "missing", "refused")
  pure val Acks = Set("exact", "extra", "false", "refused")
  pure val Back = Set("read", "unread", "missing", "refused")
  pure def visible(x: State): bool = x.privacy and x.shade
  pure def current(x: State): bool = x.active and x.privacy and x.owner == x.capturedOwner
  pure def finish(x: State, result: str): State = {
    val same = x.uncertain and x.owner == x.capturedOwner
    {...x, phase: "idle", capturedOwner: "", active: false, wantsOpen: false, wantedRevision: "", result: result,
      status: if (same) "unconfirmed" else x.status, blocked: x.blocked or same}
  }
  pure def freshCheck(x: State): State = {...x, phase: "firstPolicy", policyCalls: x.policyCalls + 1}
  pure def finalCheck(x: State): State = {...x, phase: "lastPolicy", policyCalls: x.policyCalls + 1}

  action init = s' = {owner: "A", capturedOwner: "", phase: "idle", active: false,
    privacy: true, shade: true, row: "v1", status: "ready", uncertain: false, blocked: false,
    wantsOpen: false, wantedRevision: "", markCalls: 0, readbacks: 0, openCalls: 0, policyCalls: 0,
    ui: 1, beforeUi: 0, openedUi: 0, result: ""}
  action begin(open: bool, revision: str): bool = all {
    Revisions.contains(revision), s.phase == "idle" or s.active,
    s' =
      if (s.active) {...s, result: "busy"}
      else if (s.uncertain) {...s, result: "uncertain"}
      else if (not(visible(s))) {...s, result: "unavailable"}
      else if (s.row != revision or (open and s.ui == 0)) {...s, result: "gone"}
      else {...s, phase: "fresh", active: true, capturedOwner: s.owner, wantsOpen: open, wantedRevision: revision},
  }
  action fresh(outcome: str): bool = all {
    s.phase == "fresh", Fresh.contains(outcome),
    val row = if (Revisions.contains(outcome)) outcome else ""
    s' =
      if (outcome == "refused") finish(s, "refused")
      else if (not(current(s))) finish(s, "retired")
      else if (row != s.wantedRevision) finish({...s, row: row}, "changed")
      else freshCheck({...s, row: row}),
  }
  action policy(ok: bool): bool = all {
    Set("firstPolicy", "lastPolicy").contains(s.phase),
    s' =
      if (not(ok)) finish(s, "policy")
      else if (not(current(s))) finish(s, "retired")
      else if (s.phase == "lastPolicy") {...s, phase: "mark", uncertain: true, markCalls: s.markCalls + 1}
      else if (not(s.wantsOpen)) finalCheck(s)
      else if (s.ui == 0) finish(s, "voice")
      else {...s, phase: "open", beforeUi: s.ui, openCalls: s.openCalls + 1, shade: false, row: ""},
  }
  action opened(ok: bool): bool = all {
    s.phase == "open",
    s' =
      if (not(current(s))) finish(s, "retired")
      else if (not(ok)) finish(s, "notOpened")
      else if (s.ui == 0) finish(s, "uiDetached")
      else finalCheck({...s, openedUi: s.ui}),
  }
  action acknowledge(outcome: str): bool = all {
    s.phase == "mark", Acks.contains(outcome),
    s' =
      if (not(current(s))) finish(s, "retired")
      else if (outcome == "exact") finish({...s, row: "", uncertain: false}, "read")
      else {...s, phase: "readback", readbacks: s.readbacks + 1},
  }
  action readback(outcome: str): bool = all {
    s.phase == "readback", Back.contains(outcome),
    val observed = if (outcome == "refused") s else {...s, row: ""}
    s' =
      if (not(current(s))) finish(s, "retired")
      else if (outcome == "read") finish({...observed, uncertain: false}, "read")
      else finish(observed, "unknown"),
  }
  action recover(outcome: str): bool = all {
    s.phase == "idle", s.uncertain, visible(s), Back.contains(outcome),
    val known = outcome == "read"
    s' = {...s, row: "", uncertain: not(known), blocked: not(known),
      status: if (known) "ready" else "unconfirmed", readbacks: s.readbacks + 1},
  }
  action owner(newOwner: str): bool = all {
    Set("A", "B").contains(newOwner), newOwner != s.owner,
    s' = {...s, owner: newOwner, active: false, row: "", status: "ready", uncertain: false, blocked: false},
  }
  action visibility(privacy: bool, shade: bool): bool = {
    val x = {...s, privacy: privacy, shade: shade}
    val losing = s.privacy and not(privacy)
    val hidden = visible(s) and not(visible(x))
    val changed = {...x, active: s.active and not(losing), row: if (losing or hidden) "" else s.row}
    s' = if (not(visible(s)) and visible(x)) {...changed,
      blocked: s.uncertain, status: if (s.uncertain) "unconfirmed" else "ready"} else changed
  }
  action attachUi(ui: int): bool = all {
    0.to(2).contains(ui), s' = {...s, ui: ui},
  }
  action seed = all {
    s.phase == "idle", not(s.uncertain), visible(s), s.row == "",
    s' = {...s, row: "v1", status: "ready", blocked: false},
  }

  action step = any {
    { nondet open = Bool.oneOf(); nondet revision = Revisions.oneOf(); begin(open, revision) },
    { nondet outcome = Fresh.oneOf(); fresh(outcome) },
    policy(true), policy(false), opened(true), opened(false),
    { nondet ack = Acks.oneOf(); acknowledge(ack) },
    { nondet outcome = Back.oneOf(); readback(outcome) },
    { nondet outcome = Back.oneOf(); recover(outcome) },
    owner("A"), owner("B"),
    { nondet privacy = Bool.oneOf(); nondet shade = Bool.oneOf(); visibility(privacy, shade) },
    attachUi(0), attachUi(1), attachUi(2), seed,
  }
  val safety = all {
    s.active implies (s.phase != "idle" and s.owner == s.capturedOwner and s.privacy),
    (s.phase == "idle") == (s.capturedOwner == ""),
    s.active and Set("mark", "readback").contains(s.phase) implies s.uncertain,
    s.uncertain implies s.markCalls > 0,
    s.blocked implies s.status == "unconfirmed",
    s.openedUi != 0 implies s.openCalls > 0,
  }
  run lostAcknowledgementNeedsReadbackTest = init.then(begin(false, "v1")).then(fresh("v1"))
    .then(policy(true)).then(policy(true)).then(acknowledge("extra")).then(readback("unread"))
    .then(begin(false, "v1")).expect(s.result == "uncertain" and s.markCalls == 1)
    .then(recover("read")).expect(not(s.uncertain) and s.markCalls == 1 and safety)
  run deliberateShadeCloseDoesNotCancelAnOpenTest = init.then(begin(true, "v1")).then(fresh("v1"))
    .then(policy(true)).expect(not(s.shade) and s.active and s.beforeUi == 1)
    .then(opened(true)).then(policy(true)).then(acknowledge("exact"))
    .expect(s.result == "read" and s.openedUi == 1 and safety)
  run ownerReplacementRetiresLateMutationReplyTest = init.then(begin(false, "v1")).then(fresh("v1"))
    .then(policy(true)).then(policy(true)).then(owner("B")).then(acknowledge("exact"))
    .expect(s.result == "retired" and s.owner == "B" and s.readbacks == 0 and not(s.uncertain) and safety)
  run observedCallbackUsesCurrentUiTest = init.then(begin(true, "v1")).then(fresh("v1"))
    .then(policy(true)).then(attachUi(2)).then(opened(true)).expect(s.beforeUi == 1 and s.openedUi == 2)
    .then(policy(false)).expect(s.markCalls == 0 and safety)
}
