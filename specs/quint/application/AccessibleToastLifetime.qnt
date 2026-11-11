module AccessibleToastLifetime {
  pure val Requests = Set(1, 2, 3)
  pure val Messages = Set(1, 2, 3)
  pure val Replies = Set(0, 100, 150, 200, 300, 600)
  type State = {scale: int, latest: int, started: Set[int], pending: Set[int],
    message: int, undo: bool, duration: int, held: bool, timerDelay: int, queued: int}
  var state: State

  action init = state' = {scale: 100, latest: 0, started: Set(), pending: Set(),
    message: 0, undo: false, duration: 0, held: false, timerDelay: 0, queued: 0}
  // Message 3 is the controlled 191-character passage; 1 and 2 are short.
  pure def duration(message: int, undo: bool, scale: int): int =
    (if (message == 3) 10050 else if (undo) 5000 else 1900) * scale / 100

  action request(id: int): bool = all {
    id.in(Requests), not(id.in(state.started)),
    state' = {...state, latest: id, started: state.started.union(Set(id)),
      pending: state.pending.union(Set(id))}
  }

  action reply(id: int, scale: int): bool = all {
    id.in(state.pending), scale.in(Replies),
    state' = {...state, pending: state.pending.exclude(Set(id)),
      scale: if (id == state.latest and scale > 0) scale else state.scale}
  }

  action reset = state' = {...state, scale: 100, latest: 0}

  // A message without Undo waits behind a visible Undo offer (newest wins) and leaves its timer alone.
  action show(message: int, undo: bool): bool = all {
    message.in(Messages),
    if (state.undo and not(undo)) state' = {...state, queued: message}
    else all {
      not(state.held),
      state' = {...state, message: message, undo: undo,
        duration: duration(message, undo, state.scale), timerDelay: duration(message, undo, state.scale)}
    }
  }

  action hold = all {state.message != 0, not(state.held), state' = {...state, held: true, timerDelay: 0}}
  action resume = all {state.held, state' = {...state, held: false, timerDelay: state.duration}}

  action expire = all {
    state.message != 0, not(state.held),
    state' = if (state.queued == 0) {...state, message: 0, undo: false, duration: 0, timerDelay: 0}
      else {...state, message: state.queued, undo: false, queued: 0,
        duration: duration(state.queued, false, state.scale), timerDelay: duration(state.queued, false, state.scale)}
  }

  action step = any {
    nondet id = Requests.oneOf()
    request(id),
    nondet id = Requests.oneOf()
    nondet scale = Replies.oneOf()
    reply(id, scale),
    reset,
    nondet message = Messages.oneOf()
    nondet undo = Set(true, false).oneOf()
    show(message, undo),
    expire, hold, resume,
    state' = state
  }

  val requestOwnership = (state.latest == 0 or state.latest.in(state.started))
    and state.pending.subseteq(state.started) and state.started.subseteq(Requests)
  // A waiting message exists only behind a visible Undo offer, so no message without Undo ever replaced one.
  val undoOfferOwnership = state.queued == 0 or (state.queued.in(Messages) and state.undo and state.message != 0)
  val toastOwnership = if (state.message == 0) state.duration == 0 and state.timerDelay == 0 and not(state.undo or state.held)
    else state.message.in(Messages) and
      Replies.exists(scale => scale >= 100 and
        state.duration == duration(state.message, state.undo, scale)) and
      state.timerDelay == (if (state.held) 0 else state.duration)
  val safety = requestOwnership and toastOwnership and undoOfferOwnership and state.scale.in(Replies) and state.scale >= 100

  val QueuedBehindUndoWitness = state.queued != 0 and state.undo and not(state.held)
  val QueuedWhileHeldWitness = state.queued != 0 and state.held
  val ScaledQueuedBehindUndoWitness = state.queued == 3 and state.scale == 600 and state.duration == 5000

  run staleBootCannotReplaceResumeTest = init.then(request(1)).then(request(2))
    .then(reply(2, 600)).then(reply(1, 100)).then(show(1, true))
    .expect(safety and state.scale == 600 and state.duration == 30000)
  run resetInvalidatesPendingNativeReadTest = init.then(request(1)).then(reset)
    .then(reply(1, 600)).then(show(1, false))
    .expect(safety and state.scale == 100 and state.duration == 1900)
  run failedReadKeepsLastGoodScaleTest = init.then(request(1)).then(reply(1, 150))
    .then(request(2)).then(reply(2, 0)).then(show(1, false))
    .expect(safety and state.scale == 150 and state.duration == 2850)
  run refreshAffectsOnlyNewToastsTest = init.then(show(1, true)).then(request(1)).then(reply(1, 300))
    .expect(safety and state.duration == 5000).then(show(2, false))
    .expect(safety and state.message == 1 and state.undo and state.queued == 2
      and state.duration == 5000 and state.timerDelay == 5000).then(expire)
    .expect(safety and state.message == 2 and not(state.undo) and state.queued == 0 and state.duration == 5700)
    .then(expire).expect(safety and state.message == 0)
  run plainToastWaitsBehindUndoOfferTest = init.then(show(1, true)).then(show(2, false)).then(show(3, false))
    .expect(safety and state.message == 1 and state.undo and state.queued == 3)
    .then(show(2, true)).expect(safety and state.message == 2 and state.undo and state.queued == 3)
    .then(expire).expect(safety and state.message == 3 and not(state.undo) and state.duration == 10050)
    .then(show(1, false)).expect(safety and state.message == 1 and state.queued == 0)
  run heldUndoOfferStillQueuesTest = init.then(show(1, true)).then(hold).then(show(2, false))
    .expect(safety and state.held and state.undo and state.queued == 2 and state.timerDelay == 0)
    .then(resume).then(expire)
    .expect(safety and state.message == 2 and not(state.undo))
  run heldToastRefusesReplacementTest = init.then(show(1, true)).then(hold).then(show(2, true).fail())
  run longMessageAndFocusHoldKeepCapturedDurationTest = init.then(show(3, false))
    .expect(safety and state.duration == 10050).then(hold)
    .then(request(1)).then(reply(1, 600)).expect(safety and state.timerDelay == 0)
    .then(resume).expect(safety and state.timerDelay == 10050).then(expire)
    .expect(safety and state.message == 0)
}
