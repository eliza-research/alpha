// One invocation of scripts/start-combined-agent.mjs and its returned child.
module CombinedAgentLauncher {
  type Launcher = {
    checks: int, port: str, profile: bool, marker: bool, config: bool, identity: bool,
    token: bool, logOpen: bool, core: str, spawnRequested: bool, pid: int,
    metadata: bool, metadataPid: int, supervised: bool, booted: bool,
    childExited: bool, childFailed: bool, childClosed: bool, receiptFailed: bool,
    cleanupSignal: str, forwarded: str, outcome: str, exitCode: int
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
      childExited: false, childFailed: false, childClosed: false, receiptFailed: false,
      cleanupSignal: "none", forwarded: "none", outcome: "running", exitCode: -1 }
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
    s' = { ...s, logOpen: false, outcome: reason, exitCode: 1 }
  }
  action selectCore(mode: str): bool = all {
    s.outcome == "running", s.logOpen, s.core == "unselected", CoreModes.contains(mode),
    s' = { ...s, core: mode }
  }
  action spawnChild(withPid: bool): bool = all {
    s.outcome == "running", s.logOpen, CoreModes.contains(s.core), not(s.spawnRequested),
    s' = { ...s, spawnRequested: true, pid: if (withPid) 1 else 0 }
  }
  action supervise = all {
    s.outcome == "running", s.spawnRequested, not(s.supervised), not(s.childClosed),
    s' = { ...s, supervised: true }
  }
  action publishMetadata = all {
    s.outcome == "running", s.supervised, not(s.metadata), not(s.receiptFailed),
    s' = { ...s, metadata: true, metadataPid: s.pid }
  }
  action metadataFailure = all {
    s.outcome == "running", s.supervised, not(s.metadata), not(s.receiptFailed),
    s' = { ...s, receiptFailed: true }
  }
  action cleanupSignal(sig: str): bool = all {
    s.outcome == "running", s.receiptFailed, s.supervised, s.pid == 1, not(s.childExited),
    (sig == "SIGTERM" and s.cleanupSignal == "none") or (sig == "SIGKILL" and s.cleanupSignal == "SIGTERM"),
    s' = { ...s, cleanupSignal: sig }
  }
  // Boot is the external fixture acknowledgment after successful handoff.
  action childBoot = all {
    s.outcome == "running", s.supervised, s.metadata, s.pid == 1, not(s.booted), not(s.childExited),
    s' = { ...s, booted: true }
  }
  action forward(sig: str): bool = all {
    s.outcome == "running", s.supervised, s.metadata, s.pid == 1, s.forwarded == "none",
    Signals.contains(sig),
    s' = { ...s, forwarded: sig }
  }
  action childError = all {
    s.outcome == "running", s.supervised, s.pid == 0, not(s.childFailed),
    s.metadata or s.receiptFailed,
    s' = { ...s, childFailed: true, outcome: if (s.receiptFailed) "running" else "child-error", exitCode: 1 }
  }
  action childExit(code: int): bool = all {
    s.outcome == "running", s.supervised, s.pid == 1, not(s.childExited), ChildCodes.contains(code),
    s.metadata or s.receiptFailed,
    s' = { ...s, childExited: true, outcome: if (s.receiptFailed) "running" else "child-exit",
      exitCode: if (code == -1) 1 else code }
  }
  action closeChild = all {
    s.supervised, s.childExited or s.childFailed,
    s' = { ...s, childClosed: true, supervised: false, logOpen: false }
  }
  action rejectMetadata = all {
    s.outcome == "running", s.receiptFailed, s.childClosed,
    s' = { ...s, outcome: "metadata-write", exitCode: 1 }
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
    supervise, publishMetadata, metadataFailure, childBoot, closeChild, rejectMetadata,
    { nondet sig = Set("SIGTERM", "SIGKILL").oneOf()
      cleanupSignal(sig) },
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
  val SupervisionPrecedesPublication = s.metadata implies s.supervised or s.childClosed
  val ForwardingRequiresOwnedChild = s.forwarded != "none" implies s.pid == 1 and (s.supervised or s.childClosed)
  val ClosedChildReleasesOwnership = s.childClosed implies
    not(s.logOpen) and not(s.supervised) and (s.childExited or s.childFailed) and s.exitCode >= 0
  val ChildCustodyAfterLaunch = s.receiptFailed implies
    (if (s.outcome == "running") s.supervised or s.childClosed else s.childClosed)
  val safety = SpawnRequiresPreparedProfile and MetadataDescribesSpawn and ValidateDoesNotLaunch and
    SupervisionPrecedesPublication and ForwardingRequiresOwnedChild and ClosedChildReleasesOwnership and
    ChildCustodyAfterLaunch

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
    .expect(s.identity and s.token and not(s.logOpen) and not(s.spawnRequested) and s.exitCode == 1 and safety)
  run launchReceiptBeforeChildBootTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(true)).then(supervise).then(publishMetadata)
    .expect(s.metadataPid == 1 and not(s.booted) and s.supervised and safety)
    .then(childBoot).then(childExit(7)).then(closeChild)
    .expect(s.exitCode == 7 and not(s.logOpen) and safety)
  run launchErrorReceiptHasNoPidTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(false)).then(supervise).then(publishMetadata).then(childError).then(closeChild)
    .expect(s.metadata and s.metadataPid == 0 and s.exitCode == 1 and not(s.logOpen) and safety)
  run receiptFailureReapsBeforeRejectionTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(true)).then(supervise).then(metadataFailure).then(cleanupSignal("SIGTERM"))
    .then(childExit(-1)).then(closeChild).then(rejectMetadata)
    .expect(s.childClosed and not(s.metadata) and s.outcome == "metadata-write" and safety)
  run forcedCleanupReapsStubbornChildTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(true)).then(supervise).then(metadataFailure).then(cleanupSignal("SIGTERM"))
    .then(cleanupSignal("SIGKILL")).then(childExit(-1)).then(closeChild).then(rejectMetadata)
    .expect(s.cleanupSignal == "SIGKILL" and s.childClosed and not(s.logOpen) and safety)
  run signalExitPropagatesFailureTest = startState(false, false, false).then(readyForSpawn)
    .then(spawnChild(true)).then(supervise).then(publishMetadata).then(childBoot)
    .then(forward("SIGTERM")).then(childExit(-1)).then(closeChild)
    .expect(s.forwarded == "SIGTERM" and s.exitCode == 1 and safety)
}
