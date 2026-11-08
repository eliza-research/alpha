module ResidentLiveness {
  type State = {epoch: int, active: bool, busy: bool, clock: int, last: int,
    reading: int, reads: int, starting: int, starts: int, queued: int, notice: bool}
  var state: State
  action init = state' = {epoch: 1, active: true, busy: false, clock: 0, last: -2,
    reading: 0, reads: 0, starting: 0, starts: 0, queued: 0, notice: false}

  action tick = all {state.clock < 5, state' = {...state, clock: state.clock + 1}}
  action setBusy(busy: bool): bool = state' = {...state, busy: busy}
  action checkStatus(epoch: int): bool = {
    val admit = state.active and epoch == state.epoch and state.reading == 0 and state.clock - state.last >= 2
    state' = if (admit) {...state, reading: epoch, last: state.clock, reads: state.reads + 1} else state
  }
  action replaceOwner(active: bool): bool = all {
    state.epoch < 5,
    state' = {...state, epoch: state.epoch + 1, active: active, notice: false}
  }
  action statusReply(lost: bool): bool = all {
    state.reading != 0,
    val retire = lost and state.active and state.reading == state.epoch
    all {
      retire implies state.epoch < 5,
      (retire and not(state.busy)) implies state.starting == 0,
      val start = retire and not(state.busy)
      state' = {...state, reading: 0,
        epoch: state.epoch + (if (retire) 1 else 0), active: state.active and not(retire),
        starting: if (start) state.epoch + 1 else state.starting,
        starts: state.starts + (if (start) 1 else 0),
        queued: state.queued + (if (retire and state.busy) 1 else 0)}
    }
  }
  action restartReply(connected: bool, refused: bool): bool = all {
    state.starting != 0,
    val current = state.starting == state.epoch
    state' = {...state, starting: 0,
      active: if (current) connected else state.active,
      notice: if (current) not(connected or refused) else state.notice}
  }

  action step = any {
    tick,
    nondet choice = Set(false, true).oneOf()
    any {setBusy(choice), replaceOwner(choice), statusReply(choice)},
    nondet choice = Set(false, true).oneOf()
    nondet refused = Set(false, true).oneOf()
    restartReply(choice, refused),
    nondet owner = Set(state.epoch, state.epoch - 1).oneOf()
    checkStatus(owner),
    state' = state
  }
  val ownedReads = state.reading.in(0.to(state.epoch)) and state.starting.in(0.to(state.epoch))
  val boundedRestart = state.starts + state.queued <= state.reads
  val boundedRate = state.reads <= state.clock / 2 + 1 and state.last <= state.clock
  val safety = state.epoch.in(1.to(5)) and state.clock.in(0.to(5))
    and ownedReads and boundedRestart and boundedRate

  run rateLimitedNativeReadsTest = init.then(checkStatus(1)).then(checkStatus(1)).then(statusReply(false))
    .then(tick).then(checkStatus(1)).then(tick).then(checkStatus(1))
    .expect(safety and state.reads == 2 and state.reading == 1)
  run retiredReadCannotRestartSuccessorTest = init.then(checkStatus(1)).then(replaceOwner(true))
    .then(statusReply(true)).expect(safety and state.active and state.starts == 0)
  run restartCompletionOwnedByEpochTest = init.then(checkStatus(1)).then(statusReply(true))
    .then(replaceOwner(false)).then(restartReply(false, false)).expect(safety and not(state.notice))
  run busyRecoveryQueuesRebindTest = init.then(setBusy(true)).then(checkStatus(1)).then(statusReply(true))
    .expect(safety and state.queued == 1 and state.starts == 0)
}
