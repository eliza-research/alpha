module UpdateActivationComponent {
  const instance: int
  import NativeUpdateActivation.* from "./NativeUpdateActivation"
  export NativeUpdateActivation.s
  export NativeUpdateActivation.init
  export NativeUpdateActivation.safety
  export NativeUpdateActivation.register
  export NativeUpdateActivation.retire
  export NativeUpdateActivation.begin
  export NativeUpdateActivation.acknowledge
  export NativeUpdateActivation.seal
  export NativeUpdateActivation.requestStop
  export NativeUpdateActivation.handOff
  export NativeUpdateActivation.failPreparation
  export NativeUpdateActivation.settle
  export NativeUpdateActivation.continueConfirmation
}

module UpdatePauseComponent {
  const instance: int
  import RuntimeUpdatePause.* from "./RuntimeUpdatePause"
  export RuntimeUpdatePause.s
  export RuntimeUpdatePause.init
  export RuntimeUpdatePause.safety
  export RuntimeUpdatePause.defaults
  export RuntimeUpdatePause.StartAllowed
  export RuntimeUpdatePause.LeaseRetained
  export RuntimeUpdatePause.observe
  export RuntimeUpdatePause.acquire
  export RuntimeUpdatePause.requestStop
  export RuntimeUpdatePause.committing
  export RuntimeUpdatePause.retireOwner
  export RuntimeUpdatePause.denySync
  export RuntimeUpdatePause.settle
  export RuntimeUpdatePause.reconcile
}

// The real updater joins an in-memory participant barrier to a durable
// journal and the retained resident shutdown lease. One attempt per process
// is sufficient to expose the handoff and a visible unconfirmed tombstone.
module NativeUpdateComposition {
  import UpdateActivationComponent(instance = 1) as Activation
  import UpdatePauseComponent(instance = 2) as Pause

  val state = {activation: Activation::s, pause: Pause::s}
  val startupAdmitted = Activation::s.active == 0 and Pause::StartAllowed
  val residentStartAdmitted = startupAdmitted and not(Pause::LeaseRetained)
  val resumeAudience = if (startupAdmitted) Activation::s.resumeBridge else 0

  action init = all {Activation::init, Pause::init}
  action keepActivation = Activation::s' = Activation::s
  action keepPause = Pause::s' = Pause::s
  action register(bridge: int): bool = all {Activation::register(bridge), keepPause}
  action retire(bridge: int): bool = all {Activation::retire(bridge), keepPause}
  action begin(owner: int): bool = all {
    Activation::s.serial == 0,
    Pause::StartAllowed,
    Activation::begin(owner),
    Pause::observe({...Pause::defaults, session: "bound"})
  }
  action acknowledge(bridge: int, activation: int, receipt: int, vote: str, eligibility: str): bool = all {
    Activation::acknowledge(bridge, activation, receipt, vote, eligibility), keepPause
  }
  action observeAbandonedStage = all {
    Activation::s.active != 0,
    Activation::s.invalid,
    not(Activation::s.sealed),
    Pause::observe(Pause::defaults), keepActivation
  }
  action refuse = all {
    not(Activation::s.sealed), Activation::failPreparation, Pause::observe(Pause::defaults)
  }
  action sealAcquire = all {
    Activation::seal,
    Pause::acquire(Activation::s.active)
  }
  // The controlled port has a confirmed stop when this checkpoint is observed.
  action requestConfirmedStop = all {
    Pause::s.liveOwner == Activation::s.active,
    Pause::s.evidence.confirmed,
    Activation::requestStop, Pause::requestStop
  }
  action markCommitting = all {
    Activation::s.stopRequested,
    not(Pause::s.record.committing),
    Pause::committing(Activation::s.active), keepActivation
  }
  action handOff = all {
    Pause::s.record.committing,
    Pause::s.liveOwner == Activation::s.active,
    Activation::handOff, Pause::retireOwner
  }
  action observeSession(session: str, zero: bool): bool = all {
    Activation::s.pendingSession != 0,
    Set("sealed", "absent").contains(session),
    Pause::s.evidence.session != "absent" or session == "absent",
    Pause::observe({...Pause::defaults, session: session, zero: zero}), keepActivation
  }
  action continueConfirmation(bridge: int): bool = all {
    Pause::s.file == "record",
    Pause::s.evidence.session == "sealed",
    Activation::continueConfirmation(bridge), keepPause
  }
  action denySync(denied: bool): bool = all {
    Activation::s.pendingSession != 0,
    Pause::denySync(denied), keepActivation
  }
  action reconcileHeld = all {
    Activation::s.pendingSession != 0,
    Pause::settle(Pause::s).outcome != "released",
    Pause::reconcile, keepActivation
  }
  action publishCancellation(caller: int): bool = all {
    Pause::s.record.id != 0,
    Pause::s.record.id == Activation::s.pendingSession,
    Pause::settle(Pause::s).outcome == "released",
    Pause::reconcile, Activation::settle(caller, "canceled")
  }

  val DurablePauseHasExactBarrier = Pause::s.file != "record" or
    (Pause::s.record.id == Activation::s.prepared and
      ((Activation::s.sealed and Pause::s.record.id == Activation::s.active) or
        Pause::s.record.id == Activation::s.pendingSession))
  val StopRequiresOwnedPause = Pause::s.stops == Activation::s.stopCalls and
    (not(Activation::s.stopRequested) or (Pause::s.shutdown and Pause::s.record.id == Activation::s.active))
  val CommitRequiresConfirmedStop = not(Pause::s.record.committing) or Pause::s.shutdown
  val ResumeRequiresReleasedLease = resumeAudience == 0 or residentStartAdmitted
  val safety = Activation::safety and Pause::safety and DurablePauseHasExactBarrier
    and StopRequiresOwnedPause and CommitRequiresConfirmedStop and ResumeRequiresReleasedLease

  action step = any {
    nondet bridge = Set(1, 2, 3).oneOf()
    any {register(bridge), retire(bridge), begin(bridge), continueConfirmation(bridge), publishCancellation(bridge)},
    nondet bridge = Set(1, 2, 3).oneOf()
    nondet vote = Set("yes", "no").oneOf()
    nondet eligibility = Set("absent", "eligible").oneOf()
    acknowledge(bridge, Activation::s.active, bridge, vote, eligibility),
    observeAbandonedStage, refuse, sealAcquire, requestConfirmedStop, markCommitting, handOff,
    observeSession("sealed", false), observeSession("absent", false),
    denySync(true), denySync(false), reconcileHeld,
    all {keepActivation, keepPause}
  }

  action prepared = init.then(register(1)).then(register(2)).then(begin(1))
    .then(acknowledge(1, 1, 1, "yes", "eligible"))
    .then(acknowledge(2, 1, 2, "yes", "absent"))
    .then(sealAcquire).then(requestConfirmedStop).then(markCommitting).then(handOff)
    .then(observeSession("sealed", false))

  run exactBarrierAndLeasePrecedeReconnectTest = prepared
    .expect(safety and not(startupAdmitted) and not(residentStartAdmitted))
    .then(continueConfirmation(2)).then(observeSession("absent", false))
    .then(publishCancellation(2))
    .expect(safety and startupAdmitted and residentStartAdmitted and resumeAudience == 1)

  run refusedPreparationLeavesNoPauseTest = init.then(register(1)).then(begin(1))
    .then(acknowledge(1, 1, 1, "no", "absent")).then(refuse)
    .expect(safety and startupAdmitted and Pause::s.record.id == 0 and Activation::s.stopCalls == 0)

  run unconfirmedTombstoneDoesNotAuthorizeReconnectTest = prepared
    .then(observeSession("absent", false)).then(denySync(true)).then(reconcileHeld)
    .expect(safety and startupAdmitted and not(residentStartAdmitted) and resumeAudience == 0)
    .then(denySync(false)).then(reconcileHeld)
    .expect(safety and Pause::s.shutdown and Pause::s.releases == 0 and Activation::s.terminal == 0)
}
