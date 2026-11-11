// Current installed Files folder-read coordinator. Storage effects remain ports.
module FilesBrowserController {
  type Request = {generation: int, place: int, agent: bool}
  type State = {bound: bool, active: bool, place: int, generation: int, stateGeneration: int,
    access: str, volumes: List[int], entries: List[int], loaded: bool, busy: bool, error: bool,
    states: Set[int], lists: Set[int], requests: int -> Request, shares: int}
  var s: State
  pure val Ids = 1.to(6)
  pure val EmptyRequest: Request = {generation: 0, place: 0, agent: false}
  pure def start(value: State, place: int, navigate: bool): State = {
    val id = value.stateGeneration + 1
    val generation = value.generation + 1
    {...value, bound: true, active: true, place: place, generation: generation, stateGeneration: id,
      busy: true, entries: if (navigate) List() else value.entries,
      loaded: if (navigate) false else value.loaded, error: if (navigate) false else value.error,
      states: value.states.union(Set(id)), requests: value.requests.set(id, {generation: generation, place: place, agent: false})}
  }
  action init = s' = {bound: false, active: false, place: 1, generation: 0, stateGeneration: 0, access: "unknown",
    volumes: List(), entries: List(), loaded: false, busy: false, error: false,
    states: Set(), lists: Set(), requests: Ids.mapBy(_ => EmptyRequest), shares: 0}
  action enter = all {not(s.active), s.stateGeneration < 6, s' = start(s, s.place, false)}
  action refresh = all {s.active, s.stateGeneration < 6, s' = start(s, s.place, false)}
  action navigate(place: int): bool = all {s.active, place.in(1.to(2)), s.stateGeneration < 6,
    s' = start(s, place, true)}
  action agentRead = all {s.bound, s.active, s.stateGeneration < 6,
    {val id = s.stateGeneration + 1
      s' = {...s, stateGeneration: id, states: s.states.union(Set(id)),
        requests: s.requests.set(id, {generation: s.generation, place: s.place, agent: true})}}}
  action stateReply(id: int, access: str, volumes: List[int]): bool = all {s.states.contains(id),
    Set("granted", "denied", "unavailable").contains(access), volumes.length() <= 2,
    volumes.indices().forall(i => volumes.nth(i).in(1.to(2))),
    {
      val request = s.requests.get(id)
      val current = id == s.stateGeneration and s.active and request.generation == s.generation
      val admitted = current and access == "granted"
      val ownReload = not(request.agent) and request.generation == s.generation
      s' = {...s, states: s.states.exclude(Set(id)),
        access: if (current) access else s.access, volumes: if (current) volumes.select(v => v == 1).concat(volumes.select(v => v != 1)) else s.volumes,
        entries: if (current and not(request.agent) and not(admitted)) List() else s.entries,
        loaded: if (current and not(request.agent) and not(admitted)) true else s.loaded,
        busy: if (ownReload and not(admitted)) false else s.busy,
        lists: if (admitted and not(request.agent)) s.lists.union(Set(id)) else s.lists,
        shares: if (admitted and request.agent) s.shares + 1 else s.shares}
    }}
  action listReply(id: int, entries: List[int], success: bool): bool = all {s.lists.contains(id), entries.length() <= 3,
    entries.indices().forall(i => entries.nth(i).in(1.to(3))),
    {val own = s.requests.get(id).generation == s.generation
      val current = s.active and own
      s' = {...s, lists: s.lists.exclude(Set(id)),
        entries: if (current) (if (success) entries else List()) else s.entries,
        loaded: if (current and success) true else s.loaded,
        error: if (current) not(success) else s.error,
        busy: if (own) false else s.busy}}}
  action leave = s' = {...s, active: false}
  action step = any {enter, refresh, agentRead, leave,
    {nondet place = 1.to(2).oneOf(); navigate(place)},
    {nondet id = Ids.oneOf(); nondet access = Set("granted", "denied", "unavailable").oneOf();
      nondet volumes = Set(List(), List(1), List(1, 2)).oneOf(); stateReply(id, access, volumes)},
    {nondet id = Ids.oneOf(); nondet entries = Set(List(), List(1), List(1, 2), List(3)).oneOf();
      nondet success = Bool.oneOf(); listReply(id, entries, success)}, s' = s}
  val TypeOK = s.place.in(1.to(2)) and s.stateGeneration.in(0.to(6)) and s.generation.in(0.to(6))
    and s.states.subseteq(Ids) and s.lists.subseteq(Ids) and s.entries.length() <= 3
    and s.volumes.length() <= 2 and s.requests.keys() == Ids
  val PendingKindsDisjoint = s.states.intersect(s.lists) == Set()
  val safety = TypeOK and PendingKindsDisjoint
  run staleDenialKeepsCurrentListingTest = init.then(enter).then(stateReply(1, "granted", List(1))).then(listReply(1, List(1, 2), true))
    .then(refresh).then(navigate(2)).then(stateReply(3, "granted", List(1))).then(listReply(3, List(3), true))
    .then(stateReply(2, "denied", List())).expect(s.access == "granted" and s.entries == List(3) and safety)
  run staleGrantCannotReviveAccessTest = init.then(enter).then(refresh).then(stateReply(2, "denied", List()))
    .then(stateReply(1, "granted", List(1))).expect(s.access == "denied" and s.entries == List() and safety)
  run retiredListingCannotPublishTest = init.then(enter).then(stateReply(1, "granted", List(1))).then(leave)
    .then(listReply(1, List(1), true)).expect(s.entries == List() and not(s.loaded) and safety)
  run staleAgentReadDoesNotShareTest = init.then(enter).then(agentRead).then(agentRead)
    .then(stateReply(3, "granted", List(1))).then(stateReply(2, "granted", List(1)))
    .expect(s.shares == 1 and safety)
  run retiredAgentReadDoesNotShareTest = init.then(enter).then(agentRead).then(leave)
    .then(stateReply(2, "granted", List(1))).expect(s.shares == 0 and safety)
}
