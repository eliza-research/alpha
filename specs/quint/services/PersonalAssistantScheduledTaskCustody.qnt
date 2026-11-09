// Selected Personal Assistant policies and the scheduling SQL store at the b181 pin.
module PersonalAssistantScheduledTaskCustody {
  type Slot = {phase: str, at: int, completed: int}
  type Dossier = {enabled: bool, generation: int, admittedAt: int, consumedDay: str}
  type Claim = {actor: int, result: str, at: int, guarded: bool, proposedDay: str, committedDay: str}
  type Write = {actor: int, accepted: bool, status: str, at: int, beforeAt: int,
    expectedStatus: str, expectedAt: int, guarded: bool}
  type Guard = {actor: int, at: int, currentAt: int, allowed: bool}
  type Egress = {actor: int, at: int}
  type Reply = {http: int, kind: str, state: str, at: int, selected: bool}
  type State = {
    managed: bool, clock: int, state: str, at: int, completed: int, dossier: Dossier,
    lastActivity: str, lastDispatch: str, metadataRevised: bool, definitionRevised: bool, slots: int -> Slot,
    claims: List[Claim], writes: List[Write], guards: List[Guard], egress: List[Egress],
    fireReplies: int -> Reply
  }
  var s: State
  val Actors = Set(1, 2)
  val Day = "2026-09-22"
  val Idle = {phase: "idle", at: 0, completed: 0}
  val Done = {...Idle, phase: "done"}
  val NoReply = {http: 0, kind: "", state: "", at: 0, selected: false}

  pure def initial(managed: bool): State = {
    managed: managed, clock: 1, state: "scheduled", at: 0, completed: 0,
    dossier: {enabled: managed, generation: if (managed) 1 else 0, admittedAt: 0, consumedDay: ""},
    lastActivity: "", lastDispatch: "", metadataRevised: false, definitionRevised: false,
    slots: Actors.mapBy(_ => Idle),
    claims: List(), writes: List(), guards: List(), egress: List(), fireReplies: Actors.mapBy(_ => NoReply)
  }
  action initManual = s' = initial(false)
  action initManaged = s' = initial(true)
  action init = any {initManual, initManaged}

  pure def settled(state: State, actor: int, kind: str): State = {
    val http = if (state.managed) 0 else 200
    val receipt = if (kind == "raced") {...NoReply, http: http, kind: kind}
      else {http: http, kind: kind, state: state.state, at: state.at, selected: true}
    {...state, slots: state.slots.set(actor, Done), fireReplies: state.fireReplies.set(actor, receipt)}
  }
  pure def matches(state: State, slot: Slot): bool =
    state.state == "fired" and state.at == slot.at and state.completed == slot.completed
      and not(state.metadataRevised or state.definitionRevised)
  pure def write(state: State, actor: int, slot: Slot, status: str): State =
    {...state, writes: state.writes.append({actor: actor, accepted: matches(state, slot), status: status,
      at: slot.at, beforeAt: state.at, expectedStatus: "fired", expectedAt: slot.at, guarded: true})}

  action activity(trusted: bool): bool = all {
    s.managed,
    s' = if (not(trusted)) {...s, lastActivity: "untrusted_activity"}
      else if (s.dossier.admittedAt != 0 or s.dossier.consumedDay != "")
        {...s, lastActivity: "ineligible_activity"}
      else {...s, lastActivity: "admitted", dossier: {...s.dossier, admittedAt: s.clock}},
  }
  action fire(actor: int): bool = all {
    Actors.contains(actor), s.slots.get(actor).phase == "idle", s.state == "scheduled",
    s.at < s.clock, not(s.managed) or s.dossier.admittedAt != 0,
    not(s.metadataRevised or s.definitionRevised),
    s' = {...s, slots: s.slots.set(actor, {phase: "claim", at: s.clock, completed: s.completed})},
  }
  action claim(actor: int): bool = all {
    Actors.contains(actor), s.slots.get(actor).phase == "claim",
    val slot = s.slots.get(actor)
    val won = s.state == "scheduled" and s.at < slot.at and s.completed == slot.completed
      and (not(s.managed) or s.dossier.admittedAt != 0)
    val day = if (s.managed) Day else ""
    val observed = {...s, claims: s.claims.append({actor: actor, at: slot.at, guarded: true,
      result: if (won) "fired" else "raced", proposedDay: day, committedDay: if (won) day else ""})}
    val claimed = {...observed, state: "fired", at: slot.at,
      slots: s.slots.set(actor, {...slot, phase: "prepare"}),
      dossier: {...s.dossier, admittedAt: 0, consumedDay: day}}
    s' = if (won) write(claimed, actor, slot, "fired") else settled(observed, actor, "raced"),
  }
  action complete = all {
    not(s.managed), s.state == "fired", s.completed == 0,
    s' = {...s, state: "completed", completed: s.clock},
  }
  action reopen = all {
    not(s.managed), s.state == "completed", s.lastDispatch == "",
    s' = {...s, state: "scheduled"},
  }
  action advance = all {not(s.managed), s.clock == 1, s' = {...s, clock: 2}}
  action enterEgress(actor: int): bool = all {
    Actors.contains(actor), s.slots.get(actor).phase == "prepare",
    val slot = s.slots.get(actor)
    val allowed = s.state == "fired"
    val observed = {...s, guards: s.guards.append({actor: actor, at: slot.at, currentAt: s.at, allowed: allowed})}
    s' = if (allowed) {...observed, slots: s.slots.set(actor, {...slot, phase: "egress"}),
        egress: s.egress.append({actor: actor, at: slot.at})}
      else settled(write(observed, actor, slot, "failed"), actor, "raced"),
  }
  action finish(actor: int): bool = all {
    Actors.contains(actor), s.slots.get(actor).phase == "egress",
    val slot = s.slots.get(actor)
    val observed = write(s, actor, slot, "fired")
    val receipt = if (actor == 1) "closed-1" else "closed-2"
    s' = settled(if (matches(s, slot)) {...observed, lastDispatch: receipt} else observed, actor, "fired"),
  }
  action supersede(change: str): bool = all {
    not(s.managed), s.state == "fired", not(s.metadataRevised or s.definitionRevised),
    Actors.exists(actor => s.slots.get(actor).phase == "egress" and s.slots.get(actor).at == s.at),
    Set("metadata", "definition").contains(change),
    s' = {...s, metadataRevised: change == "metadata", definitionRevised: change == "definition"},
  }
  action step = any {
    activity(true), activity(false), complete, reopen, advance, supersede("metadata"), supersede("definition"),
    {nondet actor = Actors.oneOf(); fire(actor)},
    {nondet actor = Actors.oneOf(); claim(actor)},
    {nondet actor = Actors.oneOf(); enterEgress(actor)},
    {nondet actor = Actors.oneOf(); finish(actor)},
    s' = s,
  }

  val ClaimConsumesProposedDay = s.dossier.consumedDay != "" implies
    (s.dossier.admittedAt == 0 and s.claims.indices().exists(i => {
      val observation = s.claims.nth(i)
      observation.result == "fired" and observation.proposedDay == s.dossier.consumedDay and observation.committedDay == observation.proposedDay
    }))
  val ConditionalWritesUseClaimSnapshot = s.writes.indices().forall(i => {
    val observation = s.writes.nth(i)
    observation.guarded and observation.expectedAt == observation.at and (observation.accepted implies observation.at == observation.beforeAt)
  })
  val ExactOccurrenceEgress = s.guards.indices().forall(i => {
    val observation = s.guards.nth(i)
    observation.allowed implies observation.at == observation.currentAt
  })
  val safety = ClaimConsumesProposedDay and ConditionalWritesUseClaimSnapshot

  run managedClaimConsumesDayTest = initManaged.then(activity(false)).expect(s.dossier.admittedAt == 0)
    .then(activity(true)).then(fire(1)).expect(s.dossier.admittedAt == 1 and s.dossier.consumedDay == "")
    .then(claim(1)).expect(s.dossier.consumedDay == Day and s.dossier.admittedAt == 0)
    .then(enterEgress(1)).then(finish(1)).then(activity(true))
    .expect(s.lastActivity == "ineligible_activity" and s.lastDispatch == "closed-1" and safety)
  run oneManagedClaimWinsTest = initManaged.then(activity(true)).then(fire(1)).then(fire(2))
    .then(claim(2)).then(claim(1)).then(enterEgress(2)).then(finish(2))
    .expect(s.fireReplies.get(1).kind == "raced" and s.egress.length() == 1 and safety)
  run terminalBeforeEgressTest = initManual.then(fire(1)).then(claim(1)).then(complete).then(enterEgress(1))
    .expect(s.state == "completed" and s.fireReplies.get(1).kind == "raced" and s.egress.length() == 0 and safety)
  run terminalAfterEgressTest = initManual.then(fire(1)).then(claim(1)).then(enterEgress(1)).then(complete).then(finish(1))
    .expect(s.state == "completed" and s.fireReplies.get(1).state == "completed" and s.lastDispatch == "" and safety)
  run occurrenceEgressGapWithSqlWriteFenceTest = initManual.then(fire(1)).then(claim(1)).then(complete)
    .then(reopen).then(advance).then(fire(2)).then(claim(2)).then(enterEgress(1)).then(finish(1))
    .expect(not(ExactOccurrenceEgress) and s.at == 2 and s.fireReplies.get(1).at == 2 and s.lastDispatch == "" and safety)
    .then(enterEgress(2)).then(finish(2)).expect(s.lastDispatch == "closed-2" and safety)
  run sameStateMetadataFenceTest = initManual.then(fire(1)).then(claim(1)).then(enterEgress(1))
    .then(supersede("metadata")).then(finish(1))
    .expect(s.at == 1 and s.metadataRevised and s.lastDispatch == "" and not(s.writes.nth(1).accepted) and safety)
  run sameStateDefinitionFenceTest = initManual.then(fire(1)).then(claim(1)).then(enterEgress(1))
    .then(supersede("definition")).then(finish(1))
    .expect(s.at == 1 and s.definitionRevised and s.lastDispatch == "" and not(s.writes.nth(1).accepted) and safety)
}
