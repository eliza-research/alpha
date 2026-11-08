// One invocation of scripts/start-combined-agent.mjs and its returned child.
module CombinedAgentLauncher {
  type Launcher = {
    checks: int, port: str, profile: bool, marker: bool, config: bool, identity: bool,
    token: bool, logOpen: bool, core: str, spawnRequested: bool, pid: int,
    metadata: bool, metadataPid: int, supervised: bool, booted: bool,
    childExited: bool, childFailed: bool, forwarded: str, outcome: str, exitCode: int
  }
  var s: Launcher

  pure val PreflightRefusals = Set("node-version", "source-mismatch", "port-busy",
    "profile-source", "key-mode", "speech", "unmarked", "bad-marker", "bad-routing")
  pure val PreparedRefusals = Set("empty-input", "core-refused")
  pure val CoreModes = Set("pinned", "independent")
  pure val Signals = Set("SIGINT", "SIGTERM")
  pure val ChildCodes = Set(-1, 0, 7)
  def preflightReleased = s.outcome == "running" and s.port == "released" and not(s.logOpen)
    and not(s.spawnRequested)
  def prepared = s.profile and s.marker and s.config and s.identity and s.token

  action startState(profile: bool, marker: bool, config: bool): bool = all {
    (marker or config) implies profile,
    s' = { checks: 0, port: "unprobed", profile: profile, marker: marker, config: config,
      identity: false, token: false, logOpen: false, core: "unselected", spawnRequested: false,
      pid: 0, metadata: false, metadataPid: 0, supervised: false, booted: false,
      childExited: false, childFailed: false, forwarded: "none", outcome: "running", exitCode: -1 }
  }
  action init = any { startState(false, false, false), startState(true, false, false),
    startState(true, true, true) }

  action checkVersion = all {
    s.outcome == "running", s.port == "unprobed", s.checks < 2,
    s' = { ...s, checks: s.checks + 1 }
  }
  action probePort = all {
    s.outcome == "running", s.port == "unprobed", s.checks == 2,
    s' = { ...s, port: "probing" }
  }
  action releasePort = all { s.port == "probing", s' = { ...s, port: "released" } }
  action portBusy = all { s.port == "probing", s' = { ...s, port: "busy" } }
  action refuse(reason: str): bool = all {
    s.outcome == "running", not(s.logOpen), not(s.spawnRequested), not(s.token),
    PreflightRefusals.contains(reason),
    if (reason == "node-version") s.checks == 1 and s.port == "unprobed"
    else if (reason == "source-mismatch") s.checks == 2 and s.port == "unprobed"
    else if (reason == "port-busy") s.port == "busy"
    else if (reason == "unmarked") s.port == "released" and s.profile and not(s.marker)
    else if (Set("bad-marker", "bad-routing").contains(reason)) s.port == "released" and s.marker and s.config
    else s.port == "released",
    s' = { ...s, outcome: reason, exitCode: 1 }
  }
  action validateOnly = all {
    preflightReleased, not(s.token), s.profile implies s.marker,
    s' = { ...s, outcome: "validated", exitCode: 0 }
  }
  action prepareFiles = all {
    preflightReleased, not(s.token), s.profile implies s.marker,
    s' = { ...s, profile: true, marker: true, config: true, identity: true, token: true }
  }
  action openLog = all { preflightReleased, prepared, s' = { ...s, logOpen: true } }
  action failBeforeSpawn(reason: str): bool = all {
    s.outcome == "running", prepared, not(s.spawnRequested), s.core == "unselected",
    PreparedRefusals.contains(reason), s.logOpen == (reason == "core-refused"),
    s' = { ...s, outcome: reason, exitCode: 1 }
  }
  action selectCore(mode: str): bool = all {
    s.outcome == "running", s.logOpen, s.core == "unselected", CoreModes.contains(mode),
    s' = { ...s, core: mode }
  }
  action spawnChild(withPid: bool): bool = all {
    s.outcome == "running", s.logOpen, CoreModes.contains(s.core), not(s.spawnRequested),
    s' = { ...s, spawnRequested: true, pid: if (withPid) 1 else 0 }
  }
  action publishMetadata = all {
    s.outcome == "running", s.spawnRequested, not(s.metadata),
    s' = { ...s, metadata: true, metadataPid: s.pid }
  }
  action metadataFailure = all {
    s.outcome == "running", s.spawnRequested, not(s.metadata),
    s' = { ...s, outcome: "metadata-write", exitCode: 1 }
  }
  action supervise = all {
    s.outcome == "running", s.metadata, not(s.supervised),
    s' = { ...s, supervised: true }
  }
  // Boot is an external observation from the synthetic child. The launcher
  // publishes before it, and its receipt says nothing about endpoint readiness.
  action childBoot = all {
    s.pid == 1, not(s.booted), not(s.childExited),
    s.supervised or s.outcome == "metadata-write",
    s' = { ...s, booted: true }
  }
  action forward(sig: str): bool = all {
    s.outcome == "running", s.supervised, s.pid == 1, s.forwarded == "none",
    Signals.contains(sig),
    s' = { ...s, forwarded: sig }
  }
  action childError = all {
    s.outcome == "running", s.supervised, s.pid == 0,
    s' = { ...s, childFailed: true, outcome: "child-error", exitCode: 1 }
  }
  action childExit(code: int): bool = all {
    s.outcome == "running", s.supervised, s.pid == 1, ChildCodes.contains(code),
    s' = { ...s, childExited: true, logOpen: false, outcome: "child-exit", exitCode: if (code == -1) 1 else code }
  }
  action step = any {
    checkVersion, probePort, releasePort, portBusy,
    { nondet reason = PreflightRefusals.oneOf()
      refuse(reason) },
    validateOnly, prepareFiles, openLog,
    { nondet reason = PreparedRefusals.oneOf()
      failBeforeSpawn(reason) },
    { nondet mode = CoreModes.oneOf()
      selectCore(mode) },
    { nondet withPid = Bool.oneOf()
      spawnChild(withPid) },
    publishMetadata, metadataFailure, supervise, childBoot,
    { nondet sig = Signals.oneOf()
      forward(sig) },
    childError,
    { nondet code = ChildCodes.oneOf()
      childExit(code) },
    s' = s
  }
  val SpawnRequiresPreparedProfile = s.spawnRequested implies prepared and s.port == "released" and CoreModes.contains(s.core)
  val MetadataDescribesSpawn = s.metadata implies s.spawnRequested and s.metadataPid == s.pid
  val ValidateDoesNotLaunch = s.outcome == "validated" implies not(s.spawnRequested) and not(s.metadata) and not(s.logOpen)
  val ForwardingRequiresOwnedChild = s.forwarded != "none" implies s.supervised and s.pid == 1
  val ChildExitClosesLog = s.childExited implies not(s.logOpen) and s.supervised and s.exitCode >= 0
  val safety = SpawnRequiresPreparedProfile and MetadataDescribesSpawn and ValidateDoesNotLaunch and
    ForwardingRequiresOwnedChild and ChildExitClosesLog
  // A source-refuted candidate expectation, separate from baseline safety.
  val ChildCustodyAfterLaunch = s.outcome == "metadata-write" implies s.supervised or s.childExited or s.pid == 0

  action readyForSpawn = checkVersion.then(checkVersion).then(probePort).then(releasePort)
    .then(prepareFiles).then(openLog).then(selectCore("independent"))

  run busyPortDoesNotSpawnTest = startState(false, false, false).then(checkVersion).then(checkVersion)
    .then(probePort).then(portBusy).then(refuse("port-busy"))
    .expect(s.exitCode == 1 and not(s.profile) and not(s.spawnRequested) and safety)
  run validateOnlyExistingMarkerTest = startState(true, true, true).then(checkVersion).then(checkVersion)
    .then(probePort).then(releasePort).then(validateOnly)
    .expect(s.exitCode == 0 and s.marker and not(s.identity) and not(s.token) and safety)
  run coreRefusalFollowsPrivateLogTest = startState(false, false, false).then(checkVersion).then(checkVersion)
    .then(probePort).then(releasePort).then(prepareFiles).then(openLog).then(failBeforeSpawn("core-refused"))
    .expect(s.identity and s.token and s.logOpen and not(s.spawnRequested) and s.exitCode == 1 and safety)
  run launchReceiptBeforeChildBootTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(true)).then(publishMetadata)
    .expect(s.metadataPid == 1 and not(s.booted) and not(s.supervised) and safety)
    .then(supervise).then(childBoot).then(childExit(7)).expect(s.exitCode == 7 and not(s.logOpen) and safety)
  run launchErrorReceiptHasNoPidTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(false)).then(publishMetadata).then(supervise).then(childError)
    .expect(s.metadata and s.metadataPid == 0 and s.exitCode == 1 and s.logOpen and safety)
  run metadataFailureLeavesChildUnsupervisedTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(true)).then(metadataFailure).then(childBoot)
    .expect(s.booted and not(s.metadata) and not(ChildCustodyAfterLaunch) and safety)
  run signalExitPropagatesFailureTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(true)).then(publishMetadata).then(supervise).then(childBoot)
    .then(forward("SIGTERM")).then(childExit(-1)).expect(s.forwarded == "SIGTERM" and s.exitCode == 1 and safety)
}
