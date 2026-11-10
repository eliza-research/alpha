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
  export RuntimeUpdatePause.reopen
}

// The real updater joins an in-memory participant barrier to a durable
// journal and the retained resident shutdown lease. One attempt per process
// is sufficient to expose the handoff and a visible unconfirmed tombstone.
module NativeUpdateComposition {
  import UpdateActivationComponent(instance = 1) as Activation
  import UpdatePauseComponent(instance = 2) as Pause
  import UpdateBootAdmissionPolicy as Boot from "./NativeUpdateStaging"
  var admission: {platform: Boot::Boot, automatic: bool, captured: Boot::Boot}

  val state = {activation: Activation::s, pause: Pause::s, admission: admission}
  val automaticCapability = Boot::capability(admission.platform)
  val startupAdmitted = Activation::s.active == 0 and Pause::StartAllowed
  val residentStartAdmitted = startupAdmitted and not(Pause::LeaseRetained)
  val resumeAudience = if (startupAdmitted) Activation::s.resumeBridge else 0

  action init = all {Activation::init, Pause::init,
    admission' = {platform: Boot::initial, automatic: false, captured: Boot::initial}}
  action keepActivation = Activation::s' = Activation::s
  action keepPause = Pause::s' = Pause::s
  action keepAdmission = admission' = admission
  action register(bridge: int): bool = all {Activation::register(bridge), keepPause, keepAdmission}
  action retire(bridge: int): bool = all {Activation::retire(bridge), keepPause, keepAdmission}
  action begin(owner: int): bool = all {
    Activation::s.serial == 0,
    Pause::StartAllowed,
    Activation::begin(owner),
    Pause::observe({...Pause::defaults, boot: admission.platform.boot, sdk: if (admission.platform.sdk == 30) 30 else 37, session: "bound"}),
    admission' = {...admission, automatic: false}
  }
  // A refused automatic call cannot cross the staging/activation boundary or
  // acquire journal/lease authority. Manual begin intentionally has no boot gate.
  action beginAutomatic(owner: int): bool =
    if (automaticCapability != "supported") all {keepActivation, keepPause, keepAdmission}
    else all {
      Activation::s.serial == 0, Pause::StartAllowed,
      Activation::begin(owner),
      Pause::observe({...Pause::defaults, boot: admission.platform.boot, sdk: if (admission.platform.sdk == 30) 30 else 37, session: "bound"}),
      admission' = {...admission, automatic: true, captured: admission.platform}
    }
  action bootClockAt(uptime: int): bool = all {
    uptime.in(Boot::uptimes), uptime >= admission.platform.uptime,
    admission' = {...admission, platform: Boot::advanced(admission.platform, uptime)},
    keepActivation, keepPause
  }
  action consent(value: bool): bool = all {
    admission' = {...admission, platform: {...admission.platform, consent: value}},
    keepActivation, keepPause
  }
  // Before an attempt, observe either a same-boot process replacement or reboot.
  // In-flight durable recovery remains the imported journal model's contract.
  action processRestart = all {
    Activation::s.serial == 0, Activation::s.registered == Set(),
    Pause::s.generation == 1, Pause::s.file == "missing", admission.platform.process < 2,
    Activation::init, Pause::reopen(7, "base", Pause::s.evidence),
    admission' = {...admission, platform: Boot::restarted(admission.platform)}
  }
  action reboot(sdk: int, permitted: bool): bool = all {
    Activation::s.serial == 0, Activation::s.registered == Set(),
    Pause::s.generation == 1, Pause::s.file == "missing", admission.platform.boot < 2,
    sdk.in(Set(30, 31)),
    Activation::init,
    Pause::reopen(7, "base", {...Pause::defaults, boot: admission.platform.boot + 1,
      sdk: if (sdk == 30) 30 else 37}),
    admission' = {...admission, platform: Boot::rebooted(admission.platform, sdk, permitted)}
  }
  action acknowledge(bridge: int, activation: int, receipt: int, vote: str, eligibility: str): bool = all {
    Activation::acknowledge(bridge, activation, receipt, vote, eligibility), keepPause, keepAdmission
  }
  action observeAbandonedStage = all {
    Activation::s.active != 0,
    Activation::s.invalid,
    not(Activation::s.sealed),
    Pause::observe({...Pause::defaults, boot: admission.platform.boot, sdk: if (admission.platform.sdk == 30) 30 else 37}), keepActivation, keepAdmission
  }
  action refuse = all {
    not(Activation::s.sealed), Activation::failPreparation,
    Pause::observe({...Pause::defaults, boot: admission.platform.boot, sdk: if (admission.platform.sdk == 30) 30 else 37}), keepAdmission
  }
  action sealAcquire = all {
    Activation::seal,
    Pause::acquire(Activation::s.active), keepAdmission
  }
  // The controlled port has a confirmed stop when this checkpoint is observed.
  action requestConfirmedStop = all {
    Pause::s.liveOwner == Activation::s.active,
    Pause::s.evidence.confirmed,
    Activation::requestStop, Pause::requestStop, keepAdmission
  }
  action markCommitting = all {
    Activation::s.stopRequested,
    not(Pause::s.record.committing),
    Pause::committing(Activation::s.active), keepActivation, keepAdmission
  }
  action handOff = all {
    Pause::s.record.committing,
    Pause::s.liveOwner == Activation::s.active,
    Activation::handOff, Pause::retireOwner, keepAdmission
  }
  action observeSession(session: str, zero: bool): bool = all {
    Activation::s.pendingSession != 0,
    Set("sealed", "absent").contains(session),
    Pause::s.evidence.session != "absent" or session == "absent",
    Pause::observe({...Pause::defaults, boot: admission.platform.boot, sdk: if (admission.platform.sdk == 30) 30 else 37, session: session, zero: zero}),
    keepActivation, keepAdmission
  }
  action continueConfirmation(bridge: int): bool = all {
    Pause::s.file == "record",
    Pause::s.evidence.session == "sealed",
    Activation::continueConfirmation(bridge), keepPause, keepAdmission
  }
  action denySync(denied: bool): bool = all {
    Activation::s.pendingSession != 0,
    Pause::denySync(denied), keepActivation, keepAdmission
  }
  action reconcileHeld = all {
    Activation::s.pendingSession != 0,
    Pause::settle(Pause::s).outcome != "released",
    Pause::reconcile, keepActivation, keepAdmission
  }
  action publishCancellation(caller: int): bool = all {
    Pause::s.record.id != 0,
    Pause::s.record.id == Activation::s.pendingSession,
    Pause::settle(Pause::s).outcome == "released",
    Pause::reconcile, Activation::settle(caller, "canceled"), keepAdmission
  }

  val DurablePauseHasExactBarrier = Pause::s.file != "record" or
    (Pause::s.record.id == Activation::s.prepared and
      ((Activation::s.sealed and Pause::s.record.id == Activation::s.active) or
        Pause::s.record.id == Activation::s.pendingSession))
  val StopRequiresOwnedPause = Pause::s.stops == Activation::s.stopCalls and
    (not(Activation::s.stopRequested) or (Pause::s.shutdown and Pause::s.record.id == Activation::s.active))
  val CommitRequiresConfirmedStop = not(Pause::s.record.committing) or Pause::s.shutdown
  val ResumeRequiresReleasedLease = resumeAudience == 0 or residentStartAdmitted
  val AutomaticAuthorityHadReadyBoot = not(admission.automatic) or
    (Boot::capability(admission.captured) == "supported"
      and admission.captured.boot == admission.platform.boot
      and admission.captured.uptime <= admission.platform.uptime)
  val safety = Activation::safety and Pause::safety and DurablePauseHasExactBarrier
    and StopRequiresOwnedPause and CommitRequiresConfirmedStop and ResumeRequiresReleasedLease
    and Boot::valid(admission.platform) and AutomaticAuthorityHadReadyBoot

  action step = any {
    nondet bridge = Set(1, 2, 3).oneOf()
    any {register(bridge), retire(bridge), begin(bridge), beginAutomatic(bridge), continueConfirmation(bridge), publishCancellation(bridge)},
    nondet uptime = Boot::uptimes.oneOf()
    bootClockAt(uptime),
    nondet value = Bool.oneOf()
    consent(value),
    nondet sdk = Set(30, 31).oneOf()
    nondet permitted = Bool.oneOf()
    reboot(sdk, permitted),
    processRestart,
    nondet bridge = Set(1, 2, 3).oneOf()
    nondet vote = Set("yes", "no").oneOf()
    nondet eligibility = Set("absent", "eligible").oneOf()
    acknowledge(bridge, Activation::s.active, bridge, vote, eligibility),
    observeAbandonedStage, refuse, sealAcquire, requestConfirmedStop, markCommitting, handOff,
    observeSession("sealed", false), observeSession("absent", false),
    denySync(true), denySync(false), reconcileHeld,
    all {keepActivation, keepPause, keepAdmission}
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

  run coldAutomaticCannotAcquireBarrierPauseOrStopTest = init.then(reboot(31, true)).then(register(1))
    .then(beginAutomatic(1)).expect(safety and automaticCapability == "starting"
      and Activation::s.active == 0 and Pause::s.file == "missing" and not(Pause::LeaseRetained)
      and Activation::s.stopCalls == 0 and Activation::s.commits == 0)
    .then(bootClockAt(30000)).then(beginAutomatic(1)).expect(Activation::s.serial == 0)
    .then(bootClockAt(30001)).then(beginAutomatic(1))
    .then(acknowledge(1, 1, 1, "yes", "eligible")).then(sealAcquire)
    .expect(safety and admission.automatic and Pause::s.record.boot == 2)
    .then(requestConfirmedStop).then(markCommitting).then(handOff).expect(safety)
  run manualColdBootStillUsesExactBarrierTest = init.then(reboot(31, true)).then(register(1)).then(begin(1))
    .then(acknowledge(1, 1, 1, "yes", "absent")).then(sealAcquire)
    .expect(safety and not(admission.automatic) and automaticCapability == "starting")
  run processReplacementPreservesWarmBootTest = init.then(processRestart).then(register(1)).then(beginAutomatic(1))
    .expect(safety and admission.platform.process == 2 and admission.platform.uptime == 35000
      and admission.automatic and Activation::s.active == 1)
}
