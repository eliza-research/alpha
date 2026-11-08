// Literal upstream InteractionSession at 4787d51a142c. Claim IDs are client/run pairs.
module CoreInteractionSessionTemplate {
  const Clients: Set[int]
  const Mismatched: Set[int]
  const MaxRuns: int
  const MaxTime: int
  const Expiry: int
  const Ttl: int
  // The same abstract None value has typed sentinels in the disjoint claim and digest domains.
  const None: (int, int)
  pure val NoDigest = "none"
  type ClaimId = (int, int)
  type State = {exists: bool, cstate: str, owner: ClaimId, digest: str, lease: int,
    committedAt: int, completedAt: int, auth: str, now: int, pc: int -> str,
    runs: int -> int, mine: int -> ClaimId, last: int -> str, effects: int, reached: str, late: bool}
  var s: State
  var effectOnlyByCommitter: bool
  val vars = s
  val Store = (s.exists, s.cstate, s.owner, s.digest, s.lease, s.committedAt, s.completedAt, s.auth)
  pure val Assumptions = Mismatched.subseteq(Clients) and Expiry > 0 and Expiry <= MaxTime and Ttl > 0
  pure val Time = 0.to(MaxTime)
  pure val ClaimIds = tuples(Clients, 1.to(MaxRuns))
  pure def Response(client: int): str = if (Mismatched.contains(client)) "B" else "A"
  pure val Outcomes = Set("none", "acquired", "resumed", "in_progress", "replay", "error", "completed", "lost", "crashed")
  pure val InitialState: State = {exists: true, cstate: "pending", owner: None, digest: NoDigest,
    lease: 0, committedAt: 0, completedAt: 0, auth: "active", now: 0,
    pc: Clients.mapBy(_ => "idle"), runs: Clients.mapBy(_ => 0), mine: Clients.mapBy(_ => None),
    last: Clients.mapBy(_ => "none"), effects: 0, reached: "open", late: false}
  val Initial = Assumptions and s == InitialState and effectOnlyByCommitter
  action Init = all {Assumptions, s' = InitialState, effectOnlyByCommitter' = true}
  action Move(after: State): bool = all {s' = after,
    effectOnlyByCommitter' = (effectOnlyByCommitter and (after.effects == s.effects or
      Clients.exists(c => s.pc.get(c) == "committed" and after.pc.get(c) == "executed")))}
  pure def Return(before: State, client: int, outcome: str): State =
    {...before, pc: before.pc.set(client, "idle"), last: before.last.set(client, outcome)}
  pure def Take(before: State, client: int, id: ClaimId, outcome: str): State =
    {...before, cstate: "claimed", owner: id, digest: Response(client), lease: before.now + Ttl,
      pc: before.pc.set(client, "claimed"), mine: before.mine.set(client, id), last: before.last.set(client, outcome)}
  action Claim(client: int): bool = all {Clients.contains(client), s.pc.get(client) == "idle", s.runs.get(client) < MaxRuns,
    {
      val number = s.runs.get(client) + 1
      val id = (client, number)
      val same = s.digest == Response(client)
      val called = {...s, runs: s.runs.set(client, number)}
      Move(if (not(s.exists) or Set("pending", "claimed").contains(s.cstate) and (s.auth != "active" or s.now >= Expiry))
        Return(called, client, "error")
      else if (s.cstate == "completed") Return(called, client, if (same) "replay" else "error")
      else if (s.cstate == "committed") Return(called, client, if (same) "in_progress" else "error")
      else if (s.cstate == "claimed")
        if (not(same)) Return(called, client, "error")
        else if (s.lease > s.now) Return(called, client, "in_progress")
        else Take(called, client, id, "resumed")
      else Take(called, client, id, "acquired"))}}
  val CommitInTime = s.now < s.lease and s.now < Expiry
  action Commit(client: int): bool = all {Clients.contains(client), s.pc.get(client) == "claimed",
    if (s.exists and s.cstate == "claimed" and s.owner == s.mine.get(client) and s.auth == "active" and CommitInTime)
      Move({...s, cstate: "committed", committedAt: s.now, pc: s.pc.set(client, "committed"), reached: "committed",
        late: s.late or s.now >= s.lease or s.now >= Expiry})
    else Move(Return(s, client, "error"))}
  action Execute(client: int): bool = all {Clients.contains(client), s.pc.get(client) == "committed",
    Move({...s, effects: s.effects + 1, pc: s.pc.set(client, "executed")})}
  action Complete(client: int): bool = all {Clients.contains(client), s.pc.get(client) == "executed",
    if (not(s.exists)) Move(Return(s, client, "lost"))
    else if (s.cstate == "completed" and s.digest == Response(client)) Move(Return(s, client, "completed"))
    else if (s.cstate == "committed" and s.owner == s.mine.get(client))
      Move(Return({...s, cstate: "completed", completedAt: s.now, reached: "completed"}, client, "completed"))
    else Move(Return(s, client, "error"))}
  action Crash(client: int): bool = all {Clients.contains(client), Set("claimed", "committed", "executed").contains(s.pc.get(client)),
    Move(Return(s, client, "crashed"))}
  action Reconcile = all {s.exists, s.cstate == "committed", s.committedAt <= s.now, s.effects == 1,
    Move({...s, cstate: "completed", completedAt: s.now, reached: "completed"})}
  action Revoke = all {s.exists, s.auth == "active", s.cstate != "committed", Move({...s, auth: "revoked"})}
  val Sweepable = s.cstate == "completed" and s.completedAt <= s.now
    or Set("pending", "claimed").contains(s.cstate) and Expiry <= s.now
  action DeleteExpired = all {s.exists, Sweepable, Move({...s, exists: false})}
  action Tick = all {s.now < MaxTime, Move({...s, now: s.now + 1})}
  val Finished = s.now == MaxTime and Clients.forall(c => s.pc.get(c) == "idle" and s.runs.get(c) == MaxRuns)
  action Next = any {
    {nondet c = Clients.oneOf(); any {Claim(c), Commit(c), Execute(c), Complete(c), Crash(c)}},
    Reconcile, Revoke, DeleteExpired, Tick, all {Finished, Move(s)}}
  action Stutter = all {s' = s, effectOnlyByCommitter' = effectOnlyByCommitter}
  action Step = any {Next, Stutter}
  temporal Fairness = Reconcile.weakFair(vars) and Clients.forall(c =>
    Commit(c).weakFair(vars) and Execute(c).weakFair(vars) and Complete(c).weakFair(vars))
  temporal Spec = Initial and always(Next.orKeep((s, effectOnlyByCommitter))) and Fairness
  val TypeOK = Set("pending", "claimed", "committed", "completed").contains(s.cstate)
    and ClaimIds.union(Set(None)).contains(s.owner) and Set("A", "B", NoDigest).contains(s.digest)
    and s.lease >= 0 and Time.contains(s.committedAt) and Time.contains(s.completedAt)
    and Set("active", "revoked").contains(s.auth) and Time.contains(s.now)
    and s.pc.keys() == Clients and s.runs.keys() == Clients and s.mine.keys() == Clients and s.last.keys() == Clients
    and Clients.forall(c => Set("idle", "claimed", "committed", "executed").contains(s.pc.get(c))
      and s.runs.get(c).in(0.to(MaxRuns)) and ClaimIds.union(Set(None)).contains(s.mine.get(c)) and Outcomes.contains(s.last.get(c)))
    and s.effects >= 0 and Set("open", "committed", "completed").contains(s.reached)
  val ExactlyOnceAuthority = s.effects + Clients.filter(c => s.pc.get(c) == "committed").size() <= 1
  val AtMostOnce = s.effects <= 1
  val CompletedHasEffect = (s.exists and s.cstate == "completed" implies s.effects == 1)
    and Clients.forall(c => Set("replay", "completed").contains(s.last.get(c)) implies s.effects == 1)
  val NoCommitWhileRevoked = s.exists and s.cstate == "committed" implies s.auth == "active"
  val NoLateCommit = not(s.late)
  val AmbiguousRetained = s.reached == "committed" implies s.exists and s.cstate == "committed"
  val ExecutorHasRecord = Clients.forall(c => Set("committed", "executed").contains(s.pc.get(c)) and s.reached != "completed"
    implies s.exists and s.cstate == "committed" and s.owner == s.mine.get(c))
  temporal EffectOnlyByCommitter = always(effectOnlyByCommitter)
  temporal EffectRecorded = leadsTo(s.effects == 1, s.reached == "completed")
}
module CoreInteractionSession {
  import CoreInteractionSessionTemplate(Clients = Set(1, 2, 3), Mismatched = Set(3), MaxRuns = 2,
    MaxTime = 4, Expiry = 3, Ttl = 1, None = (0, 0)) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::AtMostOnce and Model::ExactlyOnceAuthority and Model::CompletedHasEffect
    and Model::NoCommitWhileRevoked and Model::NoLateCommit and Model::AmbiguousRetained and Model::ExecutorHasRecord
  temporal CheckedTemporal = Model::Fairness implies Model::EffectOnlyByCommitter and Model::EffectRecorded
  // Source driver exposes the exact configured actions and normalizes tuple observations to lists.
  val state = Model::s
  val stateOwner = List(Model::s.owner._1, Model::s.owner._2)
  val stateMine = Model::s.mine.keys().mapBy(client => {
    val id = Model::s.mine.get(client)
    List(id._1, id._2)
  })
  val authorizedEffects = Model::effectOnlyByCommitter
  action claim(client: int): bool = Model::Claim(client)
  action commit(client: int): bool = Model::Commit(client)
  action execute(client: int): bool = Model::Execute(client)
  action complete(client: int): bool = Model::Complete(client)
  action crash(client: int): bool = Model::Crash(client)
  action reconcile = Model::Reconcile
  action revoke = Model::Revoke
  action sweep = Model::DeleteExpired
  action tick = Model::Tick
  run expiredClaimCannotCommitTest = init.then(Model::Claim(1)).then(Model::Tick).then(Model::Commit(1))
    .expect(Model::s.last.get(1) == "error" and Model::s.effects == 0 and safety)
  run mismatchedClaimCannotTakeOverTest = init.then(Model::Claim(1)).then(Model::Tick).then(Model::Claim(3))
    .expect(Model::s.last.get(3) == "error" and Model::s.owner == (1, 1) and safety)
  run reconciledCrashIsReplayableTest = init.then(Model::Claim(1)).then(Model::Commit(1)).then(Model::Execute(1))
    .then(Model::Crash(1)).then(Model::Reconcile).then(Model::Claim(2))
    .expect(Model::s.last.get(2) == "replay" and Model::s.effects == 1 and Model::effectOnlyByCommitter and safety)
}
module CoreInteractionSessionRetries {
  import CoreInteractionSessionTemplate(Clients = Set(1, 2), Mismatched = Set(), MaxRuns = 3,
    MaxTime = 5, Expiry = 4, Ttl = 2, None = (0, 0)) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val safety = Model::TypeOK and Model::AtMostOnce and Model::ExactlyOnceAuthority and Model::CompletedHasEffect
    and Model::NoCommitWhileRevoked and Model::NoLateCommit and Model::AmbiguousRetained and Model::ExecutorHasRecord
  temporal CheckedTemporal = Model::Fairness implies Model::EffectOnlyByCommitter and Model::EffectRecorded
  // Source driver exposes the exact configured actions and normalizes tuple observations to lists.
  val state = Model::s
  val stateOwner = List(Model::s.owner._1, Model::s.owner._2)
  val stateMine = Model::s.mine.keys().mapBy(client => {
    val id = Model::s.mine.get(client)
    List(id._1, id._2)
  })
  val authorizedEffects = Model::effectOnlyByCommitter
  action claim(client: int): bool = Model::Claim(client)
  action commit(client: int): bool = Model::Commit(client)
  action execute(client: int): bool = Model::Execute(client)
  action complete(client: int): bool = Model::Complete(client)
  action crash(client: int): bool = Model::Crash(client)
  action reconcile = Model::Reconcile
  action revoke = Model::Revoke
  action sweep = Model::DeleteExpired
  action tick = Model::Tick
  run resumedLeaseFencesOldOwnerTest = init.then(Model::Claim(1)).then(Model::Tick).then(Model::Tick)
    .then(Model::Claim(2)).then(Model::Commit(1)).then(Model::Commit(2))
    .expect(Model::s.last.get(1) == "error" and Model::s.last.get(2) == "resumed" and Model::s.owner == (2, 1) and safety)
  run expiredCommittedSessionStaysForReviewTest = init.then(Model::Claim(1)).then(Model::Commit(1)).then(Model::Crash(1))
    .then(Model::Tick).then(Model::Tick).then(Model::Tick).then(Model::Tick).then(Model::Claim(2))
    .expect(Model::s.exists and Model::s.cstate == "committed" and not(Model::Sweepable) and Model::s.last.get(2) == "in_progress" and safety)
}
