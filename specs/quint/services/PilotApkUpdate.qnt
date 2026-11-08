/// One admitted pilot update with explicit device lock, readback and rotation evidence.
module PilotApkUpdate {
  type State = {phase: str, rotation: bool, originalHome: str, home: str, moved: bool,
    restoration: str, locked: bool, journal: str, before: str, installer: str,
    installVerified: bool, finalStopped: bool, agent: str, passed: bool}
  var s: State

  action initFor(alphaHome: bool, rotation: bool): bool = {
    val home = if (alphaHome) "alpha" else "stock"
    s' = {phase: "ready", rotation: rotation, originalHome: home, home: home, moved: false,
      restoration: "unneeded", locked: false, journal: "none", before: "none", installer: "not-dispatched",
      installVerified: false, finalStopped: false, agent: "unstarted", passed: false}
  }
  action init = any {initFor(true, true), initFor(true, false), initFor(false, true), initFor(false, false)}
  action claimDevice = all {
    s.phase == "ready", not(s.locked),
    s' = {...s, phase: "pre-read", locked: true}
  }
  action handoff(stockConfirmed: bool): bool = all {
    s.phase == "pre-read", s.originalHome == "alpha", s.home == "alpha", not(s.moved),
    s' = {...s, moved: true, home: if (stockConfirmed) "stock" else "split", restoration: "pending"}
  }
  action observeHome(home: str): bool = all {
    s.phase.in(Set("pre-read", "pre-dispatch", "post-read")),
    home.in(Set("alpha", "stock", "split")), s' = {...s, home: home}
  }
  action readBefore(evidence: str): bool = all {
    s.phase == "pre-read", s.home == "stock", evidence.in(Set("package-only", "inventory")),
    s.originalHome == "stock" or s.moved,
    s' = {...s, phase: "pre-dispatch", before: evidence}
  }
  action stopBeforeDispatch = all {
    s.phase.in(Set("pre-read", "pre-dispatch")), s.journal == "none",
    s' = {...s, phase: "cleanup"}
  }
  action recordRotationIntent = all {
    s.phase == "pre-dispatch", s.rotation, s.before == "inventory", s.journal == "none", s.home == "stock",
    s' = {...s, phase: "intent-written", journal: "unknown"}
  }
  action dispatch = all {
    if (s.rotation) s.phase == "intent-written" else s.phase == "pre-dispatch" and s.home == "stock",
    s' = {...s, phase: "installer", installer: "unknown"}
  }
  action installerReturned(returned: bool): bool = all {
    s.phase == "installer",
    s' = if (returned) {...s, phase: "post-read", installer: "returned"} else {...s, phase: "cleanup"}
  }
  action verifyReadback(verified: bool): bool = all {
    s.phase == "post-read", verified implies s.home == "stock",
    s' = {...s, phase: "cleanup", installVerified: verified}
  }
  action finishStop(stopped: bool): bool = all {
    s.phase == "cleanup",
    s' = {...s, phase: "restore-home", finalStopped: stopped}
  }
  action finishHome(restoration: str, observedHome: str): bool = all {
    s.phase == "restore-home",
    if (s.moved) restoration.in(Set("restored", "unproven")) else restoration == "unneeded",
    observedHome.in(Set("alpha", "stock", "split")), restoration == "restored" implies observedHome == "alpha",
    s' = {...s, phase: "start", restoration: restoration, home: observedHome}
  }
  val CanStart = s.installVerified and s.finalStopped and s.restoration.in(Set("restored", "unneeded"))
  action startAgent(result: str): bool = all {
    s.phase == "start", CanStart,
    result.in(Set("running", "not-verified", "refused", "not-running")),
    s' = {...s, phase: "record", agent: result, passed: result.in(Set("running", "not-verified"))}
  }
  action skipStart = all {
    s.phase == "start", not(CanStart), s' = {...s, phase: "record"}
  }
  action finishRecord = all {
    s.phase == "record", s' = {...s, phase: "recorded"}
  }
  action verifyRotationJournal = all {
    s.phase == "recorded", s.journal == "unknown", s.installVerified,
    s' = {...s, journal: "verified-applied"}
  }
  action releaseDevice = all {
    s.phase == "recorded", s.locked,
    s' = {...s, phase: "done", locked: false}
  }

  val LockOwnsUpdate = s.locked == not(s.phase.in(Set("ready", "done")))
  val DispatchHasReadback = s.installer != "not-dispatched" implies s.before != "none"
  val RotationHasDurableInventory = (s.rotation and s.installer != "not-dispatched" implies s.journal != "none") and
    (s.journal != "none" implies s.rotation and s.before == "inventory")
  val VerificationHasReturnedInstall = s.installVerified implies s.installer == "returned"
  val CompletedJournalHasEvidence = s.journal == "verified-applied" implies s.installVerified and s.phase.in(Set("recorded", "done"))
  val RestoreOnlyOwnedHome = (s.moved implies s.originalHome == "alpha") and
    (s.restoration == "unneeded" iff not(s.moved)) and (s.restoration == "restored" implies s.home == "alpha")
  val RestartHasCleanBoundary = s.agent != "unstarted" implies CanStart
  val PassedHasStartupEvidence = s.passed == s.agent.in(Set("running", "not-verified"))
  val safety = LockOwnsUpdate and DispatchHasReadback and RotationHasDurableInventory and VerificationHasReturnedInstall and
    CompletedJournalHasEvidence and RestoreOnlyOwnedHome and RestartHasCleanBoundary and PassedHasStartupEvidence

  action step = any {
    claimDevice, handoff(true), handoff(false), observeHome("alpha"), observeHome("split"),
    readBefore("inventory"), readBefore("package-only"), stopBeforeDispatch, recordRotationIntent,
    dispatch, installerReturned(true), installerReturned(false), verifyReadback(true), verifyReadback(false),
    finishStop(true), finishStop(false), finishHome("restored", "alpha"),
    {nondet home = Set("alpha", "stock", "split").oneOf(); any {finishHome("unproven", home), finishHome("unneeded", home)}},
    startAgent("running"), startAgent("not-verified"), startAgent("refused"), startAgent("not-running"), skipStart,
    finishRecord, verifyRotationJournal, releaseDevice, s' = s
  }
  run normalUpdateRestoresHomeBeforeStartTest = initFor(true, false).then(claimDevice).then(handoff(true))
    .then(readBefore("inventory")).then(dispatch).then(installerReturned(true)).then(verifyReadback(true))
    .then(finishStop(true)).then(finishHome("restored", "alpha")).then(startAgent("running"))
    .then(finishRecord).then(releaseDevice).expect(s.passed and s.home == "alpha" and not(s.locked) and safety)
  run partialHandoffNeverDispatchesTest = initFor(true, true).then(claimDevice).then(handoff(false))
    .then(stopBeforeDispatch).then(finishStop(true)).then(finishHome("restored", "alpha")).then(skipStart)
    .then(finishRecord).then(releaseDevice).expect(s.installer == "not-dispatched" and s.journal == "none" and safety)
  run homeTakeoverBlocksDispatchTest = initFor(false, false).then(claimDevice).then(readBefore("inventory"))
    .then(observeHome("alpha")).then(stopBeforeDispatch).then(finishStop(true)).then(finishHome("unneeded", "alpha"))
    .then(skipStart).then(finishRecord).then(releaseDevice).expect(not(s.moved) and s.home == "alpha" and safety)
  run ambiguousRotationRetainsIntentTest = initFor(true, true).then(claimDevice).then(handoff(true))
    .then(readBefore("inventory")).then(recordRotationIntent).then(dispatch).then(installerReturned(false))
    .then(finishStop(true)).then(finishHome("restored", "alpha")).then(skipStart).then(finishRecord).then(releaseDevice)
    .expect(s.journal == "unknown" and s.installer == "unknown" and s.agent == "unstarted" and safety)
  run verifiedRotationSurvivesRestartRefusalTest = initFor(false, true).then(claimDevice).then(readBefore("inventory"))
    .then(recordRotationIntent).then(dispatch).then(installerReturned(true)).then(verifyReadback(true))
    .then(finishStop(true)).then(finishHome("unneeded", "stock")).then(startAgent("refused")).then(finishRecord)
    .then(verifyRotationJournal).then(releaseDevice).expect(s.journal == "verified-applied" and not(s.passed) and safety)
  run runningIntegrityOrUnprovenHomePreventsStartTest = initFor(true, false).then(claimDevice).then(handoff(true))
    .then(readBefore("inventory")).then(dispatch).then(installerReturned(true)).then(verifyReadback(true))
    .then(finishStop(false)).then(finishHome("unproven", "split")).then(skipStart).then(finishRecord).then(releaseDevice)
    .expect(s.installVerified and s.agent == "unstarted" and not(s.passed) and safety)
  run packageOnlyReadbackCanVerifyOrdinaryUpdateTest = initFor(false, false).then(claimDevice).then(readBefore("package-only"))
    .then(dispatch).then(installerReturned(true)).then(verifyReadback(true)).then(finishStop(true))
    .then(finishHome("unneeded", "stock")).then(startAgent("not-verified")).then(finishRecord).then(releaseDevice)
    .expect(s.passed and s.before == "package-only" and s.journal == "none" and safety)
}
