// The process-local AlphaDevicePlugin barrier. The session and resident stop
// are observable port effects. Durable journal and Android install semantics
// are independent models and obligations.
module NativeUpdateActivation {
  type State = {
    registered: Set[int],
    seen: Set[int],
    serial: int,
    active: int,
    installerOwner: int,
    waiting: Set[int],
    acknowledged: Set[int],
    ready: str,
    invalid: bool,
    sealed: bool,
    stopRequested: bool,
    pendingSession: int,
    confirmationOwner: int,
    terminal: int,
    outcome: str,
    resumeBridge: int,
    stopCalls: int,
    commits: int
  }
  var s: State

  val bridges = Set(1, 2, 3)
  action init = s' = {
    registered: Set(), seen: Set(), serial: 0, active: 0, installerOwner: 0, waiting: Set(),
    acknowledged: Set(), ready: "none", invalid: false, sealed: false,
    stopRequested: false, pendingSession: 0, confirmationOwner: 0, terminal: 0,
    outcome: "none", resumeBridge: 0, stopCalls: 0, commits: 0
  }

  action register(bridge: int): bool = all {
    bridges.contains(bridge),
    not(s.seen.contains(bridge)),
    val registered = { ...s, registered: s.registered.union(Set(bridge)), seen: s.seen.union(Set(bridge)) }
    s' = if (s.active != 0 and not(s.sealed))
      if (s.ready == "pending")
        { ...registered, waiting: s.waiting.union(Set(bridge)) }
      else { ...registered, invalid: true }
    else registered
  }

  action retire(bridge: int): bool = all {
    s.registered.contains(bridge),
    val invalidates = s.active != 0 and not(s.sealed)
    s' = {
      ...s, registered: s.registered.exclude(Set(bridge)),
      invalid: s.invalid or invalidates,
      ready: if (invalidates and s.ready == "pending") "no" else s.ready,
      confirmationOwner: if (s.confirmationOwner == bridge) 0 else s.confirmationOwner
    }
  }

  action begin(owner: int): bool = all {
    s.active == 0,
    s.pendingSession == 0,
    s.registered.contains(owner),
    s.serial < 2,
    s' = { ...s, serial: s.serial + 1, active: s.serial + 1, installerOwner: owner,
      waiting: s.registered, ready: "pending" }
  }

  action acknowledge(bridge: int, activation: int, receipt: int, vote: str): bool = all {
    s.active != 0,
    activation == s.active,
    bridge == receipt,
    not(s.invalid),
    not(s.sealed),
    s.waiting.contains(bridge),
    Set("yes", "no").contains(vote),
    val remaining = s.waiting.exclude(Set(bridge))
    s' = if (vote == "no")
      { ...s, waiting: remaining, ready: "no", invalid: true }
    else
      { ...s, waiting: remaining, acknowledged: s.acknowledged.union(Set(bridge)),
        ready: if (remaining == Set()) "yes" else "pending" }
  }

  action seal = all {
    s.active != 0,
    not(s.sealed),
    not(s.invalid),
    s.ready == "yes",
    s.waiting == Set(),
    s.registered.subseteq(s.acknowledged),
    s' = { ...s, sealed: true }
  }

  action requestStop = all {
    s.active != 0,
    s.sealed,
    not(s.stopRequested),
    s.registered.contains(s.installerOwner),
    s' = { ...s, stopRequested: true, stopCalls: s.stopCalls + 1 }
  }

  pure def clearActive(state: State): State = {
    ...state, active: 0, installerOwner: 0, waiting: Set(), acknowledged: Set(),
    ready: "none", invalid: false, sealed: false, stopRequested: false
  }

  // The fixture executes a confirmed stop and a successful commit call.
  // The journal and unknown commit/reply cases are outside this macrostep.
  action handOff = all {
    s.active != 0,
    s.stopRequested,
    s' = { ...clearActive(s), pendingSession: s.active, commits: s.commits + 1,
      confirmationOwner: if (s.registered.contains(s.installerOwner)) s.installerOwner else 0 }
  }

  action continueConfirmation(bridge: int): bool = all {
    s.pendingSession != 0,
    s.registered.contains(bridge),
    s' = { ...s, confirmationOwner: bridge }
  }

  action failPreparation = all {
    s.active != 0,
    s' = { ...clearActive(s), terminal: s.active, outcome: "failed", resumeBridge: 0 }
  }

  action settle(caller: int, outcome: str): bool = all {
    s.pendingSession != 0,
    bridges.contains(caller),
    Set("canceled", "installed").contains(outcome),
    val resume = if (s.registered.contains(s.confirmationOwner)) s.confirmationOwner else caller
    s' = { ...s, terminal: s.pendingSession, pendingSession: 0, outcome: outcome,
      resumeBridge: if (outcome == "canceled") resume else 0 }
  }

  action repeatSettlement(activation: int): bool = all {
    activation != 0,
    activation == s.terminal,
    s' = s
  }

  action step = any {
    nondet bridge = bridges.oneOf()
    register(bridge),
    nondet bridge = bridges.oneOf()
    retire(bridge),
    nondet bridge = bridges.oneOf()
    begin(bridge),
    nondet bridge = bridges.oneOf()
    nondet vote = Set("yes", "no").oneOf()
    acknowledge(bridge, s.active, bridge, vote),
    seal,
    requestStop,
    handOff,
    nondet bridge = bridges.oneOf()
    continueConfirmation(bridge),
    failPreparation,
    nondet bridge = bridges.oneOf()
    nondet outcome = Set("canceled", "installed").oneOf()
    settle(bridge, outcome),
    repeatSettlement(s.terminal),
    s' = s
  }

  val ExactReadyBeforeSeal = not(s.sealed) or
    (s.active != 0 and s.ready == "yes" and not(s.invalid) and s.waiting == Set())
  val SeparateWaitingAndAcknowledged = s.waiting.intersect(s.acknowledged) == Set()
  val StopAfterSeal = not(s.stopRequested) or s.sealed
  val CommitHasStop = s.commits <= s.stopCalls
  val ResumeOnlyCanceled = s.resumeBridge == 0 or (s.terminal != 0 and s.outcome == "canceled")
  val safety = ExactReadyBeforeSeal and SeparateWaitingAndAcknowledged and StopAfterSeal
    and CommitHasStop and ResumeOnlyCanceled

  run participantJoinsBeforeReadinessTest = init
    .then(register(1)).then(register(2)).then(begin(1))
    .then(acknowledge(1, 1, 1, "yes")).then(register(3))
    .then(acknowledge(2, 1, 2, "yes"))
    .expect(s.ready == "pending" and s.waiting == Set(3))
    .then(acknowledge(3, 1, 3, "yes")).then(seal).then(requestStop)
    .expect(s.sealed and s.stopCalls == 1)

  run readyThenJoinInvalidatesTest = init
    .then(register(1)).then(begin(1)).then(acknowledge(1, 1, 1, "yes"))
    .then(register(2)).expect(s.invalid and s.ready == "yes")
    .then(failPreparation)
    .expect(s.outcome == "failed" and s.stopCalls == 0)

  run invalidBarrierCannotSealTest = init
    .then(register(1)).then(begin(1)).then(acknowledge(1, 1, 1, "yes"))
    .then(register(2)).then(seal.fail())

  run retiringBridgeCannotSatisfyBarrierTest = init
    .then(register(1)).then(register(2)).then(begin(1))
    .then(acknowledge(1, 1, 1, "yes")).then(retire(2))
    .expect(s.ready == "no" and s.invalid and s.waiting == Set(2))
    .then(failPreparation).expect(s.commits == 0)

  run duplicateAcknowledgmentTest = init
    .then(register(1)).then(register(2)).then(begin(1))
    .then(acknowledge(1, 1, 1, "yes"))
    .expect(s.waiting == Set(2) and not(s.invalid))
    .then(acknowledge(1, 1, 1, "no").fail())

  run foreignAcknowledgmentTest = init
    .then(register(1)).then(register(2)).then(begin(1))
    .then(acknowledge(2, 1, 1, "yes").fail())

  run postSealContinuationOwnsAsBuiltResumeTest = init
    .then(register(1)).then(begin(1)).then(acknowledge(1, 1, 1, "yes"))
    .then(seal).then(requestStop).then(register(2))
    .then(handOff)
    .then(continueConfirmation(2)).then(settle(1, "canceled"))
    .expect(s.terminal == 1 and s.resumeBridge == 2)
    .then(repeatSettlement(1)).then(retire(2))
    .expect(s.resumeBridge == 2 and not(s.registered.contains(2)))

  run canceledAfterRetirementUsesSettlerTest = init
    .then(register(1)).then(register(2)).then(begin(1))
    .then(acknowledge(1, 1, 1, "yes")).then(acknowledge(2, 1, 2, "yes"))
    .then(seal).then(requestStop).then(handOff).then(retire(1))
    .then(settle(2, "canceled"))
    .expect(s.resumeBridge == 2 and s.terminal == 1)

  run oldReceiptCannotAcknowledgeSuccessorTest = init
    .then(register(1)).then(begin(1)).then(acknowledge(1, 1, 1, "no"))
    .then(failPreparation).then(begin(1))
    .expect(s.active == 2 and s.waiting == Set(1))
    .then(acknowledge(1, 1, 1, "yes").fail())
}
