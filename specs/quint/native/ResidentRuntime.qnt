// Alpha resident process and Cloud provider admission. See README.md for source mapping.
module ResidentRuntime {
  type State = {
    phase: str, epoch: int, profile: str, packaged: bool, sourceValid: bool,
    localProcess: bool, credential: bool, provider: str, bindingEpoch: int,
    pendingEpoch: int, pending: bool, history: int, retained: bool,
    resetPending: bool, inferenceAccepted: bool, ownedStart: bool, attachedStart: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }

  action init = s' = {
    phase: "stopped", epoch: 0, profile: "native", packaged: true,
    sourceValid: true, localProcess: false, credential: true, provider: "none",
    bindingEpoch: -1, pendingEpoch: -1, pending: false, history: 1,
    retained: false, resetPending: false, inferenceAccepted: false, ownedStart: false, attachedStart: false
  }
  action chooseProfile(profile: str): bool = all {
    s.phase == "stopped", profile.in(Set("native", "cloud")),
    s' = s.with("profile", profile)
  }
  action invalidatePackage = all {
    s.phase == "stopped", s' = s.with("sourceValid", false)
  }
  action start = all {
    s.phase == "stopped", s.packaged, s.sourceValid, not(s.resetPending),
    s' = {phase: "starting", localProcess: true, inferenceAccepted: false, ownedStart: true, ...s}
  }
  // Native bridge admission advances its epoch, including reenrollment of a live service.
  action admitStart(ownsLaunch: bool): bool = all {
    s.phase.in(Set("stopped", "ready", "starting")), s.epoch < 3,
    s.packaged, s.sourceValid, not(s.resetPending),
    s' = { ...s, phase: "starting", epoch: s.epoch + 1, localProcess: true,
      pending: false, bindingEpoch: -1, inferenceAccepted: false,
      ownedStart: ownsLaunch, attachedStart: false }
  }
  // Startup can fail after the service launched. Retire that call's launch ownership
  // without asserting shutdown or admitting an enrolled inference session.
  action failedStart(running: bool): bool = all { s.phase == "starting",
    s' = { ...s, phase: if (running) "ready" else "stopped", localProcess: running,
      ownedStart: false, attachedStart: false, pending: false,
      bindingEpoch: -1, inferenceAccepted: false }
  }
  action observeResident = all {
    s.phase == "stopped", not(s.resetPending),
    s' = { ...s, phase: "ready", localProcess: true, ownedStart: false }
  }
  action cancelUnownedStart = all {
    s.phase == "starting", not(s.ownedStart), s.epoch < 3,
    s' = { ...s, phase: "ready", epoch: s.epoch + 1, pending: false,
      bindingEpoch: -1, inferenceAccepted: false, attachedStart: false }
  }
  action retireLastSurface = all {
    s.epoch < 3,
    s' = { ...s, epoch: s.epoch + 1, pending: false,
      bindingEpoch: -1, inferenceAccepted: false, attachedStart: false }
  }
  action attachStart = all { s.localProcess, s.phase.in(Set("starting", "ready")),
    s' = { ...s, attachedStart: true } }
  action cancelAttachedStart = all { s.attachedStart, s' = { ...s, attachedStart: false } }
  action requestStop = all { s.phase.in(Set("stopped", "starting", "ready", "stopping")), s.epoch < 3,
    s' = { ...s, phase: "stopping", epoch: s.epoch + 1, pending: false,
      bindingEpoch: -1, inferenceAccepted: false, ownedStart: false, attachedStart: false } }
  action cancelOwnedStart = all { s.ownedStart, requestStop }
  action shutdownConfirmed = all { s.phase == "stopping",
    s' = { ...s, phase: "stopped", localProcess: false } }
  action shutdownUnconfirmed = all { s.phase == "stopping", s' = s }
  action started(ticket: int): bool =
    if (s.phase == "starting" and ticket == s.epoch)
      s' = s.with("phase", "ready")
    else s' = s
  action beginBinding = all {
    s.phase == "ready", s.credential, not(s.pending),
    s' = {pending: true, pendingEpoch: s.epoch, inferenceAccepted: false, ...s}
  }
  action bindingResult(ticket: int, valid: bool): bool =
    if (s.pending and ticket == s.epoch and ticket == s.pendingEpoch and s.credential and valid)
      s' = {provider: "cloud", bindingEpoch: ticket, pending: false, ...s}
    else if (s.pending and ticket == s.pendingEpoch)
      s' = s.with("pending", false)
    else s' = s
  action inference = all {
    s.phase == "ready", s.provider == "cloud", s.credential,
    s.bindingEpoch == s.epoch, not(s.resetPending),
    s' = s.with("inferenceAccepted", true)
  }
  // Uncertain removal does not prove the provider is unbound or stop the resident.
  action clearBinding(confirmed: bool): bool = all {
    s.phase.in(Set("ready", "stopped")), s.provider != "none",
    s' = {provider: if (confirmed) "none" else "unconfirmed",
      bindingEpoch: -1, inferenceAccepted: false, ...s}
  }
  // A newly admitted credential retires the previous provider generation before binding.
  action replaceCredential = all {
    s.epoch < 3,
    s' = {credential: true, epoch: s.epoch + 1, pending: false,
      provider: "none", bindingEpoch: -1, inferenceAccepted: false, ownedStart: false, attachedStart: false, ...s}
  }
  action revokeCredential = all {
    s.epoch < 3,
    s' = {credential: false, epoch: s.epoch + 1, pending: false,
      provider: "unconfirmed", bindingEpoch: -1, inferenceAccepted: false, ownedStart: false, attachedStart: false, ...s}
  }
  action crash(needsReview: bool): bool = all {
    s.phase.in(Set("ready", "starting")), s.epoch < 3,
    s' = {phase: if (needsReview) "recovery" else "stopped", localProcess: false,
      retained: needsReview, epoch: s.epoch + 1, pending: false,
      provider: "none", bindingEpoch: -1, inferenceAccepted: false, ownedStart: false, attachedStart: false, ...s}
  }
  action archiveReview(accepted: bool): bool = all {
    s.phase == "recovery",
    s' = if (accepted) {phase: "stopped", retained: false, ...s} else s
  }
  action requestReset = all {
    s.epoch < 3,
    s' = {resetPending: true, phase: "stopped", localProcess: false,
      epoch: s.epoch + 1, pending: false, provider: "none", bindingEpoch: -1,
      inferenceAccepted: false, ownedStart: false, attachedStart: false, ...s}
  }
  action step = {
    nondet ticket = Set(-1, 0, 1, 2, 3).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet profile = Set("native", "cloud").oneOf()
    any { chooseProfile(profile), invalidatePackage, start, admitStart(flag), observeResident,
      failedStart(flag), cancelUnownedStart, retireLastSurface, attachStart, cancelAttachedStart,
      requestStop, cancelOwnedStart, shutdownConfirmed, shutdownUnconfirmed, started(ticket),
      beginBinding, bindingResult(ticket, flag), inference, clearBinding(flag),
      replaceCredential, revokeCredential, crash(flag), archiveReview(flag), requestReset, s' = s }
  }
  val TypeOK = s.epoch.in(0.to(3)) and s.history == 1 and
    s.phase.in(Set("stopped", "starting", "ready", "stopping", "recovery")) and
    s.provider.in(Set("none", "cloud", "unconfirmed"))
  val LocalOnly = s.localProcess implies s.phase.in(Set("starting", "ready", "stopping"))
  val ResetStopsRuntime = s.resetPending implies not(s.localProcess)
  val RecoveryPreservesRecords = s.phase == "recovery" implies s.retained
  val CurrentCredentialAtUse = s.inferenceAccepted implies
    (s.credential and s.provider == "cloud" and s.bindingEpoch == s.epoch and s.phase == "ready")
  val StoppingRetiresEnrollment = s.phase == "stopping" implies not(s.pending or s.inferenceAccepted) and s.bindingEpoch == -1
  val safety = TypeOK and LocalOnly and ResetStopsRuntime and RecoveryPreservesRecords and CurrentCredentialAtUse and StoppingRetiresEnrollment

  run startAndBindTest = init.then(start).then(started(0)).then(beginBinding)
    .then(bindingResult(0, true)).then(inference).then(check(safety and s.inferenceAccepted))
  run staleBindingTest = init.then(start).then(started(0)).then(beginBinding)
    .then(revokeCredential).then(bindingResult(0, true))
    .then(check(safety and s.provider == "unconfirmed" and not(s.pending)))
  run failedUnbindKeepsAgentTest = init.then(start).then(started(0)).then(beginBinding)
    .then(bindingResult(0, true)).then(clearBinding(false))
    .then(check(safety and s.phase == "ready" and s.provider == "unconfirmed"))
  run recoveryAndRestartTest = init.then(start).then(started(0)).then(crash(true))
    .then(archiveReview(false)).then(check(s.phase == "recovery" and s.history == 1))
    .then(archiveReview(true)).then(start).then(started(0))
    .then(check(s.phase == "starting")).then(started(1)).then(check(safety and s.phase == "ready"))
  run replacementRetiresPendingBindingTest = init.then(start).then(started(0)).then(beginBinding)
    .then(replaceCredential).then(bindingResult(0, true))
    .then(check(safety and s.provider == "none" and not(s.pending)))
  run resetFencesCallbackTest = init.then(start).then(requestReset).then(started(0))
    .then(check(safety and s.phase == "stopped"))
  run stopRetainsProviderConfigurationTest = init.then(start).then(started(0)).then(beginBinding)
    .then(bindingResult(0, true)).then(requestStop).then(shutdownConfirmed)
    .then(check(safety and s.provider == "cloud" and not(s.localProcess)))
    .then(start).then(started(1)).then(beginBinding).then(bindingResult(1, true)).then(inference)
    .then(check(safety and s.inferenceAccepted))
  run unconfirmedStopKeepsProcessUnknownTest = init.then(start).then(started(0)).then(requestStop)
    .then(shutdownUnconfirmed).then(check(safety and s.localProcess and s.phase == "stopping"))
  run ownedCancellationRetiresLateStartupTest = init.then(start).then(cancelOwnedStart)
    .then(started(0)).then(check(safety and s.phase == "stopping"))
    .then(shutdownConfirmed).then(check(not(s.localProcess)))
  run attachedCancellationPreservesServiceTest = init.then(start).then(started(0)).then(attachStart)
    .then(cancelAttachedStart).then(check(safety and s.phase == "ready" and s.localProcess and s.ownedStart))
  run nativeAdmissionAdvancesEpochTest = init.then(admitStart(true)).then(started(0))
    .then(check(s.phase == "starting")).then(started(1)).then(check(safety and s.phase == "ready"))
  run unownedReenrollmentCancellationTest = init.then(observeResident).then(admitStart(false))
    .then(cancelUnownedStart).then(started(1)).then(check(safety and s.phase == "ready" and s.localProcess and s.epoch == 2))
  run lastSurfaceRetiresEnrollmentTest = init.then(admitStart(true)).then(started(1)).then(beginBinding)
    .then(retireLastSurface).then(bindingResult(1, true)).then(check(safety and not(s.pending) and s.localProcess))
  run lostEnrollmentReplyRetiresOwnershipTest = init.then(admitStart(true)).then(failedStart(true))
    .expect(s.localProcess and not(s.ownedStart) and not(s.inferenceAccepted) and safety)
}
