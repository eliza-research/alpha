// Browser hosted-result ledger and the renderer's verified tap readback.
module BrowserHostedResultNotice {
  type Row = {phase: str, digest: int, revision: int}
  type Publication = {id: int, digest: int, binding: int}
  type Settlement = {token: int, binding: int}
  type State = {owner: str, binding: int, enabled: bool, polling: bool, session: int, locked: bool,
    rows: int -> Row, pending: int, token: int, minted: int, publication: Publication,
    settlement: Settlement, notifications: int, observation: str}
  var s: State
  pure val IDs = Set(1, 2, 3)
  pure val Owners = Set("", "A", "B")
  pure val Digests = Set(1, 2)
  pure val Empty: Row = {phase: "", digest: 0, revision: 0}
  pure val Idle: Publication = {id: 0, digest: 0, binding: 0}
  pure val NoSettlement: Settlement = {token: 0, binding: 0}
  pure def ownerOf(id: int): str = if (id == 3) "B" else "A"
  pure def cards(x: State): Set[int] =
    if (x.enabled) IDs.filter(id => x.rows.get(id).phase == "posted") else Set()
  pure def redacted(x: State): bool = x.locked
  pure def background(x: State): bool = x.polling and x.owner != ""

  action init = s' = {owner: "", binding: 0, enabled: true, polling: true, session: 0, locked: false,
    rows: IDs.mapBy(_ => Empty), pending: 0, token: 0, minted: 0, publication: Idle,
    settlement: NoSettlement, notifications: 0, observation: ""}
  action bind(owner: str): bool = all {
    Owners.contains(owner), s' = {...s, owner: owner, binding: s.binding + 1},
  }
  action privacy(locked: bool): bool = s' = {...s, locked: locked, session: s.session + 1}
  action enable(value: bool): bool = s' = {...s, enabled: value,
    rows: IDs.mapBy(id => {
      val row = s.rows.get(id)
      if (row == Empty) row else {...row, revision: row.revision + 1}
    })}
  action poll(value: bool): bool = s' = {...s, polling: value}
  action startPublish(id: int, digest: int): bool = all {
    IDs.contains(id), Digests.contains(digest), s.publication == Idle,
    s' = if (s.owner == ownerOf(id))
      {...s, publication: {id: id, digest: digest, binding: s.binding}}
      else {...s, observation: "owner"},
  }
  action finishPublish(retained: bool): bool = all {
    s.publication != Idle,
    val p = s.publication
    val row = s.rows.get(p.id)
    val settled = {...s, publication: Idle}
    val phase = if (s.enabled) "posted" else "denied"
    s' =
      if (s.binding != p.binding or not(retained)) {...settled, observation: "notRetained"}
      else if (row == Empty) {...settled, observation: phase,
        rows: s.rows.set(p.id, {phase: phase, digest: p.digest, revision: 1})}
      else if (row.digest != p.digest) {...settled, observation: "changed"}
      else {...settled, observation: if (row.phase == "dismissed") "opened" else row.phase},
  }
  action act(id: int, exact: bool, open: bool): bool = all {
    IDs.contains(id),
    s' =
      if (s.locked or not(exact) or not(cards(s).contains(id))) {...s, observation: "stale"}
      else if (not(open)) {...s, rows: s.rows.set(id, {...s.rows.get(id), phase: "dismissed"}),
        observation: "acted"}
      else if (s.pending == id) {...s, notifications: s.notifications + 1, observation: "acted"}
      else {...s, pending: id, token: s.minted + 1, minted: s.minted + 1,
        notifications: s.notifications + 1, observation: "acted"},
  }
  action inspect(history: str, allowed: bool): bool = all {
    Set("exact", "changed", "missing").contains(history),
    s' = {...s, observation:
      if (s.pending == 0) "none"
      else if (s.owner != ownerOf(s.pending)) "otherAccount"
      else if (not(allowed) or history != "exact") "unavailable" else "ready"},
  }
  pure def settleTap(x: State, exact: bool, sameBinding: bool): State =
    if (x.pending == 0 or not(exact)) {...x, observation: "stale"}
    else if (not(sameBinding) or x.owner != ownerOf(x.pending)) {...x, observation: "owner"}
    else {...x, rows: x.rows.set(x.pending, {...x.rows.get(x.pending), phase: "opened"}),
        pending: 0, token: 0, observation: "consumed"}
  action consume(exact: bool): bool = s' = settleTap(s, exact, true)
  action startConsume = all {
    s.settlement == NoSettlement, s.pending != 0,
    s' = {...s, settlement: {token: s.token, binding: s.binding}},
  }
  action finishConsume = all {
    s.settlement != NoSettlement,
    s' = settleTap({...s, settlement: NoSettlement}, s.settlement.token == s.token,
      s.settlement.binding == s.binding),
  }

  action step = any {
    { nondet owner = Owners.oneOf(); bind(owner) },
    privacy(true), privacy(false), enable(true), enable(false), poll(true), poll(false),
    { nondet id = IDs.oneOf(); nondet digest = Digests.oneOf(); startPublish(id, digest) },
    finishPublish(true), finishPublish(false),
    { nondet id = IDs.oneOf(); nondet exact = Bool.oneOf(); nondet open = Bool.oneOf(); act(id, exact, open) },
    { nondet history = Set("exact", "changed", "missing").oneOf(); nondet allowed = Bool.oneOf(); inspect(history, allowed) },
    consume(true), consume(false), startConsume, finishConsume,
  }
  val safety = all {
    (s.pending == 0) == (s.token == 0),
    s.token <= s.minted,
    s.settlement.token <= s.minted,
    s.pending == 0 or s.rows.get(s.pending).digest > 0,
    IDs.forall(id => s.rows.get(id) == Empty or Digests.contains(s.rows.get(id).digest)),
    not(s.enabled) implies cards(s).size() == 0,
  }
  run exactReplayAndDigestChangeTest = init.then(bind("A"))
    .then(startPublish(1, 1)).then(finishPublish(true))
    .then(startPublish(1, 1)).then(finishPublish(true))
    .then(startPublish(1, 2)).then(finishPublish(true))
    .expect(s.rows.get(1).revision == 1 and s.observation == "changed" and safety)
  run latestExactTokenControlsSettlementTest = init.then(bind("A"))
    .then(startPublish(1, 1)).then(finishPublish(true)).then(startPublish(2, 1)).then(finishPublish(true))
    .then(act(1, true, true)).then(act(1, true, true)).expect(s.minted == 1 and s.notifications == 2)
    .then(act(2, true, true)).then(consume(false)).expect(s.pending == 2 and s.token == 2)
    .then(inspect("exact", true)).expect(s.observation == "ready")
    .then(consume(true)).expect(s.rows.get(2).phase == "opened" and safety)
  run retiredOwnerCannotSettleBrowserTokenTest = init.then(bind("A"))
    .then(startPublish(1, 1)).then(finishPublish(true)).then(act(1, true, true))
    .then(bind("B")).then(inspect("exact", true)).expect(s.observation == "otherAccount")
    .then(consume(true)).expect(s.observation == "owner" and s.pending == 1)
    .then(bind("A")).then(consume(true)).expect(s.rows.get(1).phase == "opened" and safety)
  run queuedSettlementCannotTransferToSameScopeReplacementTest = init.then(bind("A"))
    .then(startPublish(1, 1)).then(finishPublish(true)).then(act(1, true, true))
    .then(startConsume).then(bind("A")).then(finishConsume)
    .expect(s.observation == "owner" and s.pending == 1 and safety)
}
