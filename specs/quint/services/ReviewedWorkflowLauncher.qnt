// One invocation of scripts/start-reviewed-workflow-agent.mjs.
module ReviewedWorkflowLauncher {
  type Launcher = {
    source: str, deps: bool, profile: bool, token: bool, entryChecked: bool, entry: bool,
    config: bool, identity: bool, text: str, embeddings: bool, features: str, logOpen: bool,
    child: bool, childPid: bool, metadata: bool, pid: bool, revision: str, supervised: bool,
    booted: bool, childClosed: bool, preloadEntry: bool, forwarded: str, outcome: str, exitCode: int
  }
  var s: Launcher
  pure val SourceKinds = Set("default", "explicit")
  pure val TextKinds = Set("direct", "invalid")
  pure val FeatureKinds = Set("enabled", "disabled")
  pure val ReceiptFailures = Set("git-metadata", "write-metadata")
  pure val PreflightRefusals = Set("relative-default", "invalid-port", "input-mode",
    "unreviewed-profile", "missing-entry", "routing", "embedding-path")
  pure val ExitCodes = Set(0, 1, 7)
  val running = s.outcome == "running"

  action startState(profile: bool, config: bool, text: str, embeddings: bool, features: str): bool = all {
    if (config) profile and TextKinds.contains(text) and FeatureKinds.contains(features)
    else text == "none" and not(embeddings) and features == "none",
    s' = { source: "none", deps: false, profile: profile, token: false, entryChecked: false, entry: false,
      config: config, identity: false, text: text, embeddings: embeddings, features: features,
      logOpen: false, child: false, childPid: false, metadata: false, pid: false, revision: "none",
      supervised: false, booted: false, childClosed: false, preloadEntry: false, forwarded: "none",
      outcome: "running", exitCode: -1 }
  }
  action init = any {
    startState(false, false, "none", false, "none"),
    startState(true, false, "none", false, "none"),
    startState(true, true, "direct", false, "enabled"),
    startState(true, true, "invalid", false, "enabled")
  }
  action selectSource(source: str, installed: bool): bool = all {
    running, s.source == "none", SourceKinds.contains(source),
    s' = { ...s, source: source, deps: installed }
  }
  action missingDependencies = all {
    running, SourceKinds.contains(s.source), not(s.deps),
    s' = { ...s, outcome: "missing-deps", exitCode: 2 }
  }
  action prepareToken = all {
    running, s.deps, not(s.token),
    s' = { ...s, profile: true, token: true }
  }
  action checkEntry(found: bool): bool = all {
    running, s.token, not(s.entryChecked),
    s' = { ...s, entryChecked: true, entry: found }
  }
  action readProfile(text: str, embeddings: bool, features: str): bool = all {
    running, s.entry, not(s.identity),
    if (s.config) text == s.text and embeddings == s.embeddings and features == s.features
    else text == "direct" and embeddings and features == "disabled",
    s' = { ...s, config: true, identity: true, text: text, embeddings: embeddings, features: features }
  }
  action openLog = all {
    running, s.identity, s.text == "direct", not(s.logOpen),
    s' = { ...s, logOpen: true }
  }
  action refuse(reason: str): bool = all {
    running, not(s.child), PreflightRefusals.contains(reason),
    if (reason == "relative-default") s.source == "none"
    else if (reason == "missing-entry") s.entryChecked and not(s.entry)
    else if (reason == "routing") s.identity and s.text == "invalid"
    else if (reason == "embedding-path") s.logOpen
    else s.deps and not(s.token),
    s' = { ...s, outcome: reason, exitCode: 1 }
  }
  action spawnChild(pid: bool): bool = all {
    running, s.logOpen, not(s.child),
    s' = { ...s, child: true, childPid: pid }
  }
  action publishMetadata(pid: bool, revision: str): bool = all {
    running, s.child, not(s.metadata), pid == s.childPid, Set("pinned", "other").contains(revision),
    s' = { ...s, metadata: true, pid: pid, revision: revision }
  }
  action receiptFailure(reason: str): bool = all {
    running, s.childPid, not(s.metadata), ReceiptFailures.contains(reason),
    s' = { ...s, outcome: reason, booted: true, exitCode: 1 }
  }
  action supervise = all { running, s.metadata, not(s.supervised), s' = { ...s, supervised: true } }
  action childBoot = all {
    running, s.supervised, s.childPid, not(s.booted),
    s' = { ...s, booted: true }
  }
  action forward(sig: str): bool = all {
    running, s.supervised, s.childPid, s.forwarded == "none", Set("SIGINT", "SIGTERM").contains(sig),
    s' = { ...s, forwarded: sig }
  }
  action settleChild(outcome: str, code: int, preloadEntry: bool): bool = all {
    running, s.supervised, ExitCodes.contains(code),
    if (s.childPid) outcome == "child-exit" else outcome == "spawn-error" and code == 1,
    preloadEntry implies s.revision == "pinned" and s.childPid and code == 0,
    s' = { ...s, outcome: outcome, exitCode: code, childClosed: true, preloadEntry: preloadEntry }
  }
  action step = any {
    { nondet source = SourceKinds.oneOf()
      nondet installed = Bool.oneOf()
      selectSource(source, installed) },
    missingDependencies, prepareToken,
    { nondet found = Bool.oneOf()
      checkEntry(found) },
    readProfile("direct", true, "disabled"), readProfile(s.text, s.embeddings, s.features),
    openLog,
    { nondet reason = PreflightRefusals.oneOf()
      refuse(reason) },
    { nondet pid = Bool.oneOf()
      spawnChild(pid) },
    { nondet revision = Set("pinned", "other").oneOf()
      publishMetadata(s.childPid, revision) },
    { nondet reason = ReceiptFailures.oneOf()
      receiptFailure(reason) },
    supervise, childBoot,
    { nondet sig = Set("SIGINT", "SIGTERM").oneOf()
      forward(sig) },
    { nondet code = ExitCodes.oneOf()
      nondet ranEntry = Bool.oneOf()
      settleChild(if (s.childPid) "child-exit" else "spawn-error", code, ranEntry) },
    s' = s
  }
  val EntryCheckFollowsToken = s.entryChecked implies s.token and s.profile
  val SpawnRequiresPrivateProfile = s.child implies s.deps and s.entry and s.identity and s.text == "direct" and s.logOpen
  val ReceiptDescribesRequestedChild = s.metadata implies s.child and s.pid == s.childPid
  val PatchedEntryRequiresPinnedReceipt = s.preloadEntry implies s.revision == "pinned" and s.childClosed
  val safety = EntryCheckFollowsToken and SpawnRequiresPrivateProfile and ReceiptDescribesRequestedChild and
    PatchedEntryRequiresPinnedReceipt
  // Observed false after an error in either metadata operation.
  val ChildCustodyAfterReceiptFailure = ReceiptFailures.contains(s.outcome) implies
    not(s.child) or s.supervised or s.childClosed

  action freshToSpawn = startState(false, false, "none", false, "none")
    .then(selectSource("explicit", true)).then(prepareToken).then(checkEntry(true))
    .then(readProfile("direct", true, "disabled")).then(openLog).then(spawnChild(true))

  run dependencyRefusalTest = startState(false, false, "none", false, "none")
    .then(selectSource("default", false)).then(missingDependencies)
    .expect(s.exitCode == 2 and not(s.profile) and safety)
  run missingEntryRetainsTokenTest = startState(false, false, "none", false, "none")
    .then(selectSource("explicit", true)).then(prepareToken).then(checkEntry(false)).then(refuse("missing-entry"))
    .expect(s.token and not(s.config) and safety)
  run invalidRoutingKeepsMigratedIdentityTest = startState(true, true, "invalid", false, "enabled")
    .then(selectSource("explicit", true)).then(prepareToken).then(checkEntry(true))
    .then(readProfile("invalid", false, "enabled")).then(refuse("routing"))
    .expect(s.identity and not(s.logOpen) and not(s.embeddings) and s.features == "enabled" and safety)
  run cleanPinnedEntryTest = freshToSpawn.then(publishMetadata(true, "pinned")).then(supervise)
    .then(settleChild("child-exit", 0, true)).expect(s.preloadEntry and safety)
  run otherRevisionCanLeaveReceiptTest = freshToSpawn.then(publishMetadata(true, "other")).then(supervise)
    .then(settleChild("child-exit", 1, false)).expect(s.metadata and not(s.preloadEntry) and safety)
  run postSpawnGitFailureLeavesChildTest = freshToSpawn.then(receiptFailure("git-metadata"))
    .expect(s.booted and not(s.metadata) and not(ChildCustodyAfterReceiptFailure) and safety)
  run postSpawnWriteFailureLeavesChildTest = freshToSpawn.then(receiptFailure("write-metadata"))
    .expect(s.booted and not(s.supervised) and not(ChildCustodyAfterReceiptFailure) and safety)
}
