// Pinned LifeOps route and in-memory runner behavior with two closed callers.
module LifeOpsScheduledTaskRoute {
  type Slot = {phase: str, at: int, completed: int}
  type Claim = {actor: int, result: str, at: int}
  type Write = {actor: int, accepted: bool, status: str, at: int, beforeAt: int, expectedStatus: str, expectedAt: int}
  type Guard = {actor: int, at: int, currentAt: int, allowed: bool}
  type Egress = {actor: int, at: int}
  type FireReply = {http: int, kind: str, task: str, state: str, at: int}
  type Reply = {http: int, ids: List[str], task: str, state: str, at: int, completed: int, text: str, cron: str, zone: str}
  type State = {
    clock: int, paused: bool, state: str, at: int, completed: int, text: str, cron: str, zone: str,
    claims: List[Claim], writes: List[Write], guards: List[Guard], egress: List[Egress],
    slots: int -> Slot, fireReplies: int -> FireReply, logs: str -> int, reply: Reply
  }
  var s: State
  val Actors = Set(1, 2)
  val Idle = {phase: "idle", at: 0, completed: 0}
  val Done = {...Idle, phase: "done"}
  val NoFireReply = {http: 0, kind: "", task: "", state: "", at: 0}
  val NoReply = {http: 0, ids: List(), task: "", state: "", at: 0, completed: 0, text: "", cron: "", zone: ""}
  val LogKeys = Set("completed", "edited", "failed", "fire_attempt", "fired", "reopened", "skipped", "snoozed")
  val ReadOrReject = Set("owner-list", "all-list", "duplicate-filter", "malformed-id",
    "history", "empty-edit", "bodyless-edit", "readonly-edit", "invalid-snooze")
  val Controls = ReadOrReject.union(Set("edit", "snooze", "complete", "reopen"))
  val Terminal = Set("completed", "failed", "skipped")
  action init = s' = {clock: 1, paused: false, state: "scheduled", at: 0, completed: 0,
    text: "Review the week.", cron: "", zone: "", claims: List(), writes: List(), guards: List(), egress: List(),
    slots: Actors.mapBy(_ => Idle), fireReplies: Actors.mapBy(_ => NoFireReply),
    logs: LogKeys.mapBy(_ => 0), reply: NoReply}

  pure def log(state: State, key: str): State = {...state, logs: state.logs.set(key, state.logs.get(key) + 1)}
  pure def controlReply(state: State): State = {...state, reply: {...NoReply, http: 200, task: "weekly",
    state: state.state, at: state.at, completed: state.completed, text: state.text, cron: state.cron, zone: state.zone}}
  pure def settled(state: State, actor: int, kind: str): State = {
    val result = if (kind == "raced") {...NoFireReply, http: 200, kind: "raced"}
      else {...NoFireReply, http: 200, kind: kind, task: "weekly", state: state.state, at: state.at}
    {...state, slots: state.slots.set(actor, Done), fireReplies: state.fireReplies.set(actor, result)}
  }
  pure def write(state: State, actor: int, slot: Slot, proposed: str): State =
    {...state, writes: state.writes.append({actor: actor, accepted: state.state == "fired",
      status: proposed, at: slot.at, beforeAt: state.at, expectedStatus: "fired", expectedAt: 0})}
  val idleOrSettled = Actors.forall(actor => Set("idle", "done").contains(s.slots.get(actor).phase))
  action control(name: str): bool = all {
    Controls.contains(name),
    name != "edit" or (idleOrSettled and s.state == "scheduled"),
    name != "snooze" or (idleOrSettled and s.state == "scheduled" and s.cron == ""),
    name != "reopen" or Terminal.contains(s.state),
    name != "complete" or not(Terminal.contains(s.state)),
    s' = if (name == "owner-list") {...s, reply: {...NoReply, http: 200, ids: List("weekly")}}
      else if (name == "all-list") {...s, reply: {...NoReply, http: 200, ids: List("hidden", "weekly")}}
      else if (name == "history") {...s, reply: {...NoReply, http: 200, task: "weekly",
        state: s.state, at: s.at, completed: s.completed}}
      else if (name == "readonly-edit") {...s, reply: {...NoReply, http: 409}}
      else if (ReadOrReject.contains(name)) {...s, reply: {...NoReply, http: 400}}
      else if (name == "edit") controlReply(log({...s, text: "New instructions.", cron: "30 9 * * 1", zone: "UTC"}, "edited"))
      else if (name == "snooze") controlReply(log({...s, state: "scheduled", at: s.clock + 60}, "snoozed"))
      else if (name == "complete") controlReply(log({...s, state: "completed", completed: s.clock}, "completed"))
      else controlReply(log({...s, state: "scheduled"}, "reopened")),
  }
  action advance = all {s.clock < 3, s' = {...s, clock: s.clock + 1}}
  action pause = all {not(s.paused), idleOrSettled, s.state == "scheduled", s' = {...s, paused: true}}
  action fire(actor: int): bool = all {
    Actors.contains(actor), s.slots.get(actor).phase == "idle", s.cron == "",
    s' = if (Terminal.contains(s.state)) settled(s, actor, "skipped")
      else if (s.paused) settled(log(log({...s, state: "skipped"}, "fire_attempt"), "skipped"), actor, "skipped")
      else log({...s, slots: s.slots.set(actor, {phase: "claim", at: s.clock, completed: 0})}, "fire_attempt"),
  }
  action claim(actor: int): bool = all {
    Actors.contains(actor), s.slots.get(actor).phase == "claim",
    val attempt = s.slots.get(actor)
    val won = s.state == "scheduled"
    val observed = {...s, claims: s.claims.append({actor: actor, at: attempt.at, result: if (won) "fired" else "raced"})}
    val snapshot = {...attempt, phase: "prepare", completed: s.completed}
    val claimed = {...observed, state: "fired", at: attempt.at, slots: s.slots.set(actor, snapshot)}
    s' = if (won) log(write(claimed, actor, snapshot, "fired"), "fired")
      else settled(observed, actor, "raced"),
  }
  action enterEgress(actor: int): bool = all {
    Actors.contains(actor), s.slots.get(actor).phase == "prepare",
    val slot = s.slots.get(actor)
    val allowed = s.state == "fired"
    val observed = {...s, guards: s.guards.append({actor: actor, at: slot.at, currentAt: s.at, allowed: allowed})}
    s' = if (allowed) {...observed, slots: s.slots.set(actor, {...slot, phase: "egress"}),
        egress: s.egress.append({actor: actor, at: slot.at})}
      else settled(write(observed, actor, slot, "failed"), actor, "raced"),
  }
  action finish(actor: int, outcome: str): bool = all {
    Actors.contains(actor), s.slots.get(actor).phase == "egress", Set("ok", "throw").contains(outcome),
    val slot = s.slots.get(actor)
    val proposed = if (outcome == "ok") "fired" else "failed"
    val observed = write(s, actor, slot, proposed)
    val persisted = {...observed, state: proposed, at: slot.at, completed: slot.completed}
    s' = if (s.state != "fired") settled(observed, actor, if (outcome == "ok") "fired" else "raced")
      else if (outcome == "ok") settled(persisted, actor, "fired")
      else settled(log(persisted, "failed"), actor, "dispatch_failed"),
  }
  action step = any {
    advance, pause,
    {nondet name = Controls.oneOf(); control(name)},
    {nondet actor = Actors.oneOf(); fire(actor)},
    {nondet actor = Actors.oneOf(); claim(actor)},
    {nondet actor = Actors.oneOf(); enterEgress(actor)},
    {nondet actor = Actors.oneOf(); nondet result = Set("ok", "throw").oneOf(); finish(actor, result)},
    s' = s,
  }

  val EgressHasClaimAndGuard = s.egress.indices().forall(i => {
    val entry = s.egress.nth(i)
    s.claims.indices().exists(j => s.claims.nth(j) == {actor: entry.actor, at: entry.at, result: "fired"})
      and s.guards.indices().exists(j => s.guards.nth(j).actor == entry.actor and s.guards.nth(j).allowed)
  })
  val FireReplyIdentity = Actors.forall(actor => {
    val reply = s.fireReplies.get(actor)
    reply.http == 0 or (reply.http == 200 and reply.task == (if (reply.kind == "raced") "" else "weekly"))
  })
  val safety = EgressHasClaimAndGuard and FireReplyIdentity
  // The current generic runner violates these stronger occurrence properties.
  val ExactOccurrenceEgress = s.guards.indices().forall(i => {
    val guard = s.guards.nth(i)
    guard.allowed implies guard.at == guard.currentAt
  })
  val NoOlderOccurrenceRestore = s.writes.indices().forall(i => {
    val write = s.writes.nth(i)
    write.accepted implies write.at == write.beforeAt
  })

  run ownerListAndInvalidFilterTest = init.then(control("owner-list"))
    .expect(s.reply.ids == List("weekly")).then(control("duplicate-filter")).expect(s.reply.http == 400 and safety)
  run exactEditAndRejectionTest = init.then(control("empty-edit")).expect(s.reply.http == 400)
    .then(control("readonly-edit")).expect(s.reply.http == 409 and s.logs.get("edited") == 0)
    .then(control("edit")).expect(s.reply.cron == "30 9 * * 1" and s.logs.get("edited") == 1 and safety)
  run snoozeCompleteReopenTest = init.then(control("snooze")).expect(s.at == 61)
    .then(control("complete")).then(control("reopen")).then(control("history"))
    .expect(s.state == "scheduled" and s.reply.completed == 1 and s.reply.at == 61 and safety)
  run oneClaimWinsTest = init.then(fire(1)).then(fire(2)).then(claim(1)).then(claim(2))
    .then(enterEgress(1)).then(finish(1, "ok"))
    .expect(s.fireReplies.get(2).kind == "raced" and s.egress.length() == 1 and safety)
  run completionBeforeEgressTest = init.then(fire(1)).then(claim(1)).then(control("complete"))
    .then(enterEgress(1)).expect(s.state == "completed" and s.egress.length() == 0
      and s.fireReplies.get(1).kind == "raced" and safety)
  run completionAfterEgressTest = init.then(fire(1)).then(claim(1)).then(enterEgress(1))
    .then(control("complete")).then(finish(1, "ok"))
    .expect(s.state == "completed" and s.fireReplies.get(1).state == "completed" and safety)
  run occurrenceFenceGapTest = init.then(fire(1)).then(claim(1)).then(control("complete")).then(control("reopen"))
    .then(advance).then(fire(2)).then(claim(2)).then(enterEgress(1)).then(finish(1, "ok"))
    .expect(not(ExactOccurrenceEgress) and not(NoOlderOccurrenceRestore) and s.at == 1 and safety)
}
