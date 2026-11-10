// Shared observation classes for Android's monotonic, boot-relative uptime.
// A process restart preserves uptime. Only a new boot resets readiness.
module UpdateBootAdmissionPolicy {
  type Boot = {sdk: int, consent: bool, uptime: int, boot: int, process: int, readySeen: bool}
  pure val uptimes = Set(0, 26681, 29999, 30000, 30001, 35000)
  pure val initial: Boot = {sdk: 31, consent: true, uptime: 35000, boot: 1, process: 1, readySeen: true}
  pure def capability(p: Boot): str = if (p.sdk < 31) "unsupported"
    else if (not(p.consent)) "permission-required"
    else if (p.uptime <= 30000) "starting" else "supported"
  pure def advanced(p: Boot, uptime: int): Boot =
    {...p, uptime: uptime, readySeen: p.readySeen or uptime > 30000}
  pure def restarted(p: Boot): Boot = {...p, process: p.process + 1}
  pure def rebooted(p: Boot, sdk: int, consent: bool): Boot =
    {sdk: sdk, consent: consent, uptime: 0, boot: p.boot + 1, process: 1, readySeen: false}
  pure def valid(p: Boot): bool = p.sdk.in(Set(30, 31)) and p.uptime.in(uptimes)
    and p.boot.in(Set(1, 2)) and p.process.in(Set(1, 2))
    and (p.readySeen implies p.uptime > 30000)
}

// Bounded Settings offer and Android cache-file custody before activation.
// A target is one exact reviewed URL/digest/size/version tuple. Four bytes
// represent a synthetic APK. PackageInstaller.commit is beyond this model.
module NativeUpdateStaging {
  import UpdateBootAdmissionPolicy as Boot
  type State = {
    platform: Boot::Boot,
    automatic: bool,
    admitted: Boot::Boot,
    clock: int,
    checkedAt: int,
    cached: int,
    storedAt: int,
    stored: int,
    checking: bool,
    owner: int,
    target: int,
    phase: str,
    file: str,
    kept: int,
    reuses: int,
    bytes: int,
    session: str,
    stagedBytes: int,
    connected: bool,
    fetches: int,
    created: int,
    abandoned: int,
    outcome: str
  }
  var s: State

  val offers = Set(1, 2)
  val bridgeIds = Set(1, 2, 3)
  val validOffer = if (offers.contains(s.cached)) s.cached else 0
  val checkDue = not(s.clock >= s.checkedAt and s.checkedAt >= 0 and s.clock - s.checkedAt < 15)
  val automaticCapability = Boot::capability(s.platform)

  action init = s' = {
    platform: Boot::initial, automatic: false, admitted: Boot::initial,
    clock: 0, checkedAt: -1, cached: 0, storedAt: -1, stored: 0, checking: false,
    owner: 0, target: 0, phase: "idle", file: "absent", kept: 0, reuses: 0, bytes: 0, session: "none",
    stagedBytes: 0, connected: false, fetches: 0, created: 0, abandoned: 0, outcome: "none"
  }

  action bootClockAt(uptime: int): bool = all {
    uptime.in(Boot::uptimes), uptime >= s.platform.uptime,
    s' = {...s, platform: Boot::advanced(s.platform, uptime)}
  }
  action consent(value: bool): bool = s' = {...s, platform: {...s.platform, consent: value}}
  // These two actions cover admission between attempts. In-flight process death,
  // sealed sessions and durable pause recovery remain RuntimeUpdatePause's scope.
  action processRestart = all {
    s.owner == 0, s.platform.process < 2,
    s' = {...s, platform: Boot::restarted(s.platform), automatic: false, kept: 0,
      file: if (s.kept != 0) "orphan" else s.file}
  }
  action reboot(sdk: int, permitted: bool): bool = all {
    s.owner == 0, s.platform.boot < 2, sdk.in(Set(30, 31)),
    s' = {...s, platform: Boot::rebooted(s.platform, sdk, permitted), automatic: false, kept: 0,
      file: if (s.kept != 0) "orphan" else s.file}
  }

  action clockAt(minute: int): bool = all {
    Set(0, 14, 15, 30).contains(minute),
    s' = { ...s, clock: minute }
  }
  action requestCheck(force: bool): bool = all {
    not(s.checking),
    force or checkDue,
    s' = { ...s, checking: true }
  }
  action answerCheck(answer: str, saved: bool): bool = all {
    s.checking,
    Set("offer1", "offer2", "invalid", "withdrawn", "malformed", "transport").contains(answer),
    val result = if (answer == "offer1") 1 else if (answer == "offer2") 2
      else if (answer == "invalid") -1 else 0
    s' = if (Set("malformed", "transport").contains(answer)) { ...s, checking: false }
      else { ...s, checking: false, cached: result, checkedAt: s.clock,
        stored: if (saved) result else s.stored, storedAt: if (saved) s.clock else s.storedAt }
  }
  action reopenSettings = all {
    not(s.checking),
    s' = { ...s, cached: s.stored, checkedAt: s.storedAt }
  }

  action findOrphan(bytes: int): bool = all {
    s.phase == "idle",
    s.file == "absent",
    bytes.in(0.to(4)),
    s' = { ...s, file: "orphan", bytes: bytes }
  }
  action loadBridge(deleted: bool): bool =
    s' = if (s.phase == "idle" and s.kept == 0 and deleted) { ...s, file: "absent", bytes: 0 } else s

  // Only a same-process hint can avoid HTTP. It cannot admit changed bytes,
  // another current offer, Android metadata, or any pending session/pause.
  pure def cacheMatches(state: State): bool = state.kept == state.cached and
    state.kept != 0 and state.file != "absent"
  val attemptAvailable = if (cacheMatches(s)) s.reuses < 2 else s.fetches < 2

  pure def admittedCopy(state: State, bridge: int, automatic: bool): State =
    if (state.owner != 0) {...state, outcome: "quiet"}
    else {...state, owner: bridge, target: state.cached, phase: if (cacheMatches(state)) "rechecking" else "copying",
      file: if (cacheMatches(state)) state.file else "partial",
      kept: if (cacheMatches(state)) state.kept else 0,
      bytes: if (cacheMatches(state)) state.bytes else 0,
      connected: not(cacheMatches(state)), fetches: state.fetches + (if (cacheMatches(state)) 0 else 1), outcome: "none",
      automatic: automatic, admitted: state.platform}
  action tap(bridge: int, permitted: bool): bool = all {
    bridgeIds.contains(bridge),
    validOffer != 0,
    s.session != "left",
    if (not(permitted)) s' = { ...s, outcome: "settings" }
    else if (s.owner != 0) all {
      bridge != s.owner,
      s' = admittedCopy(s, bridge, false)
    }
    else all {
      attemptAvailable,
      s' = admittedCopy(s, bridge, false)
    }
  }
  // This branch precedes worker submission, download, session allocation and the
  // activation/pause composition. Refusal changes only the returned status.
  action automaticTap(bridge: int): bool = all {
    bridgeIds.contains(bridge),
    if (automaticCapability != "supported") s' = {...s, outcome: automaticCapability}
    else all {
      validOffer != 0, s.session != "left",
      if (s.owner != 0) bridge != s.owner else attemptAvailable,
      s' = admittedCopy(s, bridge, true)
    }
  }

  action chunk(count: int): bool = all {
    s.phase == "copying",
    count.in(1.to(4)),
    s.bytes + count <= 4,
    s' = { ...s, bytes: s.bytes + count }
  }
  // copyVerified checks the deadline after non-EOF reads only.
  action verify(digestMatches: bool, lateEof: bool): bool = all {
    s.phase.in(Set("copying", "rechecking")),
    s.bytes == 4,
    digestMatches,
    s.file != "corrupt",
    s' = { ...s, phase: "verified", file: "verified", connected: false,
      reuses: s.reuses + (if (s.phase == "rechecking") 1 else 0) }
  }
  action cacheChanged = all {
    s.owner == 0, s.kept != 0, s.file == "verified",
    s' = {...s, file: "corrupt"}
  }
  action cacheMismatch = all {
    s.phase == "rechecking", s.fetches < 2,
    s' = {...s, phase: "copying", file: "partial", kept: 0, bytes: 0,
      connected: true, fetches: s.fetches + 1}
  }
  action deferBeforeWork = all {
    s.owner == 0, s.kept == validOffer, s.kept != 0, s.session == "none",
    s' = {...s, outcome: "deferred"}
  }
  action stage(archiveMatches: bool): bool = all {
    s.phase == "verified",
    archiveMatches,
    s' = { ...s, phase: "staged", kept: s.target, session: "staged", stagedBytes: s.bytes, created: s.created + 1 }
  }
  action retireBridge(bridge: int): bool = all {
    bridgeIds.contains(bridge),
    s.owner != 0,
    s' = if (bridge == s.owner) { ...s, phase: "retiring", connected: false } else s
  }
  action settle(reason: str, deleted: bool, abandoned: bool): bool = all {
    s.owner != 0,
    if (reason == "download") s.phase == "copying"
    else if (reason == "archive") s.phase == "verified"
    else if (reason == "barrier") s.phase == "staged"
    else if (reason == "deferred") s.phase == "staged" and s.automatic and not(deleted)
    else reason == "retired" and s.phase == "retiring",
    val left = s.session == "staged" and not(abandoned)
    s' = { ...s, owner: 0, target: 0, phase: "idle", connected: false, automatic: false,
      file: if (reason == "deferred") "verified" else if (deleted) "absent" else "orphan",
      kept: if (reason == "deferred") s.target else 0, bytes: if (deleted) 0 else s.bytes,
      session: if (left) "left" else "none", stagedBytes: if (left) s.stagedBytes else 0,
      abandoned: s.abandoned + (if (s.session == "staged" and abandoned) 1 else 0),
      outcome: reason }
  }

  val CacheCustody = (s.owner == 0) == (s.phase == "idle") and
    (s.owner == 0 or (offers.contains(s.target) and s.file != "orphan" and s.file != "absent"))
  val NoUnverifiedStaging = s.session == "none" or
    (s.stagedBytes == 4 and (s.session == "left" or s.file == "verified"))
  val CleanupBound = s.abandoned <= s.created and s.created <= s.fetches + s.reuses
  val RetainedHintIsNotAdmission = s.kept.in(Set(0, 1, 2)) and s.reuses.in(0.to(2))
    and (s.phase == "rechecking" implies not(s.connected) and s.session == "none")
    and (s.file == "corrupt" implies s.phase.in(Set("idle", "rechecking", "retiring")))
  val ConnectionCustody = s.connected implies s.phase == "copying" and s.owner != 0
  val AutomaticAdmissionHadReadyBoot = not(s.automatic) or
    (Boot::capability(s.admitted) == "supported" and s.admitted.boot == s.platform.boot
      and s.admitted.uptime <= s.platform.uptime)
  val MonotonicBootReadiness = Boot::valid(s.platform)
  val safety = CacheCustody and NoUnverifiedStaging and CleanupBound and ConnectionCustody
    and AutomaticAdmissionHadReadyBoot and MonotonicBootReadiness and RetainedHintIsNotAdmission

  action step = any {
    nondet uptime = Boot::uptimes.oneOf()
    bootClockAt(uptime),
    nondet value = Bool.oneOf()
    consent(value),
    nondet sdk = Set(30, 31).oneOf()
    nondet permitted = Bool.oneOf()
    reboot(sdk, permitted),
    processRestart,
    nondet bridge = bridgeIds.oneOf()
    automaticTap(bridge),
    nondet minute = Set(0, 14, 15, 30).oneOf()
    clockAt(minute),
    requestCheck(false), requestCheck(true),
    nondet answer = Set("offer1", "offer2", "invalid", "withdrawn", "malformed", "transport").oneOf()
    nondet saved = Bool.oneOf()
    answerCheck(answer, saved),
    reopenSettings,
    findOrphan(4), loadBridge(true), loadBridge(false),
    nondet bridge = bridgeIds.oneOf()
    nondet permit = Bool.oneOf()
    tap(bridge, permit),
    nondet count = 1.to(4).oneOf()
    chunk(count),
    verify(true, false), verify(true, true), stage(true), cacheChanged, cacheMismatch, deferBeforeWork,
    nondet bridge = bridgeIds.oneOf()
    retireBridge(bridge),
    nondet reason = Set("download", "archive", "barrier", "retired", "deferred").oneOf()
    nondet deleted = Bool.oneOf()
    nondet abandoned = Bool.oneOf()
    settle(reason, deleted, abandoned),
    s' = s
  }

  action offered = init.then(requestCheck(false)).then(answerCheck("offer1", true))

  run failedRefreshRetainsOldOfferTest = offered.then(clockAt(15))
    .then(requestCheck(false)).then(answerCheck("transport", false))
    .expect(checkDue and validOffer == 1 and s.checkedAt == 0)
    .then(requestCheck(false)).then(answerCheck("withdrawn", true))
    .expect(not(checkDue) and validOffer == 0)

  run replacementDoesNotChangeCapturedTupleTest = offered.then(tap(1, true)).then(chunk(2))
    .then(requestCheck(true)).then(answerCheck("offer2", true))
    .expect(validOffer == 2 and s.target == 1 and s.bytes == 2)
    .then(chunk(2)).then(verify(true, false)).then(stage(true)).expect(safety)

  run lateEofCanVerifyExactBytesTest = offered.then(tap(1, true)).then(chunk(4))
    .then(verify(true, true)).expect(s.phase == "verified" and s.bytes == 4)

  run busyPeerCannotSweepOwnedFileTest = offered.then(tap(1, true)).then(chunk(2))
    .then(tap(2, true)).then(loadBridge(true)).then(retireBridge(2))
    .expect(s.owner == 1 and s.bytes == 2 and s.connected and s.fetches == 1)

  run retiredOwnerClosesAndCleansTest = offered.then(tap(1, true)).then(chunk(2))
    .then(retireBridge(1)).then(settle("retired", true, true))
    .expect(s.file == "absent" and s.session == "none" and s.owner == 0)

  run failedCacheDeleteLeavesUnownedFileTest = offered.then(tap(1, true)).then(chunk(4))
    .then(verify(true, false)).then(settle("archive", false, true))
    .expect(s.file == "orphan" and s.owner == 0)
    .then(loadBridge(false)).then(loadBridge(true)).expect(s.file == "absent")

  run failedAbandonKeepsUncommittedCopyTest = offered.then(tap(1, true)).then(chunk(4))
    .then(verify(true, false)).then(stage(true)).then(settle("barrier", true, false))
    .expect(s.session == "left" and s.stagedBytes == 4 and s.file == "absent")

  run coldAutomaticDefersThroughInclusiveBoundaryTest = offered.then(reboot(31, true))
    .then(automaticTap(1)).expect(s.outcome == "starting" and s.fetches == 0 and s.created == 0 and s.owner == 0)
    .then(bootClockAt(30000)).then(automaticTap(1))
    .expect(s.outcome == "starting" and s.file == "absent" and s.session == "none")
    .then(bootClockAt(30001)).then(automaticTap(1))
    .expect(safety and s.automatic and s.fetches == 1 and s.admitted.uptime == 30001)
  run unsupportedPrecedesConsentAndBootTest = offered.then(reboot(30, false)).then(automaticTap(1))
    .expect(s.outcome == "unsupported" and s.fetches == 0).then(consent(true)).then(bootClockAt(35000))
    .then(automaticTap(1)).expect(safety and s.outcome == "unsupported" and s.created == 0)
  run permissionPrecedesColdBootTest = offered.then(reboot(31, false)).then(automaticTap(1))
    .expect(s.outcome == "permission-required" and s.fetches == 0)
    .then(consent(true)).then(automaticTap(1)).expect(safety and s.outcome == "starting" and s.fetches == 0)
  run processRestartCannotFabricateBootReadinessTest = offered.then(reboot(31, true))
    .then(bootClockAt(29999)).then(processRestart).then(automaticTap(1))
    .expect(safety and s.platform.process == 2 and s.platform.uptime == 29999 and s.outcome == "starting")
    .then(bootClockAt(30001)).then(automaticTap(1)).expect(safety and s.fetches == 1)
  run downloadFailureAndRestartKeepWarmReadinessTest = offered.then(automaticTap(1))
    .then(settle("download", true, true)).then(processRestart)
    .expect(automaticCapability == "supported" and s.platform.uptime == 35000)
    .then(automaticTap(1)).expect(safety and s.fetches == 2)
  run newBootReturnsWarmProcessToStartingTest = offered.then(processRestart).then(reboot(31, true))
    .then(automaticTap(1)).expect(safety and s.platform.boot == 2 and s.platform.process == 1
      and s.platform.uptime == 0 and s.outcome == "starting" and s.fetches == 0)
  run manualColdAttemptKeepsItsExistingPathTest = offered.then(reboot(31, true)).then(tap(1, true))
    .then(chunk(4)).then(verify(true, false)).then(stage(true))
    .expect(safety and not(s.automatic) and automaticCapability == "starting" and s.created == 1)

  action retainedAutomatic = offered.then(automaticTap(1)).then(chunk(4)).then(verify(true, false))
    .then(stage(true)).then(settle("deferred", false, true))
  run sameProcessDeferredCacheRevalidatesWithoutRefetchTest = retainedAutomatic.then(loadBridge(true))
    .then(deferBeforeWork).expect(safety and s.kept == 1 and s.fetches == 1 and s.created == 1)
    .then(automaticTap(1)).expect(s.phase == "rechecking" and not(s.connected))
    .then(verify(true, false)).then(stage(true)).then(settle("barrier", true, true))
    .expect(safety and s.fetches == 1 and s.reuses == 1 and s.created == 2 and s.kept == 0)
  run corruptRetainedCacheMustRefetchTest = retainedAutomatic.then(cacheChanged).then(automaticTap(1))
    .then(cacheMismatch).then(chunk(4)).then(verify(true, false)).then(stage(true))
    .expect(safety and s.fetches == 2 and s.reuses == 0)
  run changedOfferCannotUseRetainedCacheTest = retainedAutomatic.then(requestCheck(true)).then(answerCheck("offer2", true))
    .then(automaticTap(1)).expect(safety and s.target == 2 and s.kept == 0 and s.fetches == 2)
  run processRestartSweepsMarkedCacheTest = retainedAutomatic.then(processRestart).then(loadBridge(true))
    .expect(safety and s.file == "absent" and s.kept == 0).then(automaticTap(1)).expect(s.fetches == 2)
}
