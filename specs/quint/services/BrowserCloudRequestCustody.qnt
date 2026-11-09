// The local browser bridge owns an active slot until its exact handler settles.
module BrowserCloudRequestCustody {
  type State = {
    owners: int -> int, slots: int -> int, status: int -> int,
    dispatched: Set[int], pending: Set[int], aborted: Set[int], closed: Set[int],
  }
  var s: State
  pure val Slots = Set(1, 2)
  pure val Generations = Set(1, 2, 3, 4)
  pure val EmptyGenerations = Map(1 -> 0, 2 -> 0, 3 -> 0, 4 -> 0)
  action init = s' = {owners: Map(1 -> 0, 2 -> 0), slots: EmptyGenerations, status: EmptyGenerations,
    dispatched: Set(), pending: Set(), aborted: Set(), closed: Set()}

  action start(generation: int, slot: int): bool = all {
    Generations.contains(generation), Slots.contains(slot), s.slots.get(generation) == 0,
    s' = if (s.owners.get(slot) == 0) {
      {...s, owners: s.owners.set(slot, generation), slots: s.slots.set(generation, slot),
        dispatched: s.dispatched.union(Set(generation)), pending: s.pending.union(Set(generation))}
    } else {
      {...s, slots: s.slots.set(generation, slot), status: s.status.set(generation, 400)}
    },
  }
  action cancel(slot: int): bool = all {
    Slots.contains(slot),
    { val generation = s.owners.get(slot)
      s' = if (generation == 0) s else {...s, aborted: s.aborted.union(Set(generation))} },
  }
  action close(generation: int): bool = all {
    Generations.contains(generation), s.slots.get(generation) != 0, not(s.closed.contains(generation)),
    s' = {...s, closed: s.closed.union(Set(generation)),
      aborted: if (s.pending.contains(generation)) s.aborted.union(Set(generation)) else s.aborted},
  }
  action finish(generation: int): bool = all {
    s.pending.contains(generation),
    { val slot = s.slots.get(generation)
      val code = if (s.closed.contains(generation)) 0 else if (s.aborted.contains(generation)) 409 else 200
      s' = {...s, owners: if (s.owners.get(slot) == generation) s.owners.set(slot, 0) else s.owners,
        pending: s.pending.exclude(Set(generation)), status: s.status.set(generation, code)} },
  }

  val PendingInvocationsOwnTheirExactSlots = s.pending.forall(g => s.owners.get(s.slots.get(g)) == g)
  val OccupiedSlotsHaveTheirPendingInvocation = Slots.forall(slot => {
    val generation = s.owners.get(slot)
    generation == 0 or (s.pending.contains(generation) and s.slots.get(generation) == slot)
  })
  val DuplicateNeverDispatches = Generations.forall(g => s.status.get(g) == 400 implies
    (not(s.dispatched.contains(g)) and not(s.pending.contains(g)) and not(s.aborted.contains(g))))
  val AbortedInvocationsCannotSucceed = s.aborted.forall(g => s.dispatched.contains(g) and s.status.get(g) != 200)
  val DisconnectedPendingInvocationsAreAborted = s.closed.intersect(s.pending).subseteq(s.aborted)
  val safety = PendingInvocationsOwnTheirExactSlots and OccupiedSlotsHaveTheirPendingInvocation
    and DuplicateNeverDispatches and AbortedInvocationsCannotSucceed and DisconnectedPendingInvocationsAreAborted

  action step = any {
    { nondet generation = Generations.oneOf()
      nondet slot = Slots.oneOf()
      start(generation, slot) },
    { nondet slot = Slots.oneOf()
      cancel(slot) },
    { nondet generation = Generations.oneOf()
      close(generation) },
    { nondet generation = s.pending.oneOf()
      finish(generation) },
    s' = s,
  }

  run rejectedDuplicateCannotRetireTheIncumbentTest = init.then(start(1, 1)).then(start(2, 1))
    .expect(s.owners.get(1) == 1 and s.status.get(2) == 400 and safety)
    .then(cancel(1)).then(finish(1)).expect(s.status.get(1) == 409 and safety)
  run cancelledSlotCannotBeReusedUntilSettlementTest = init.then(start(1, 1)).then(cancel(1))
    .then(start(2, 1)).expect(s.status.get(2) == 400 and s.owners.get(1) == 1 and safety)
    .then(finish(1)).then(start(3, 1)).then(finish(3)).expect(s.status.get(3) == 200 and safety)
  run disconnectedHandlerCannotRetireItsSuccessorTest = init.then(start(1, 1)).then(close(1)).then(start(2, 1))
    .then(finish(1)).then(start(3, 1)).then(close(2)).then(finish(3))
    .expect(s.status.get(1) == 0 and s.status.get(2) == 400 and s.status.get(3) == 200 and safety)
  run independentSlotRetainsItsOwnReplyTest = init.then(start(1, 1)).then(start(2, 2)).then(start(3, 1))
    .then(cancel(1)).then(finish(2)).then(finish(1))
    .expect(s.status.get(1) == 409 and s.status.get(2) == 200 and safety)
}
