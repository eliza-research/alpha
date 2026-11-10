// One invocation of scripts/start-reviewed-workflow-agent.ts.
module ReviewedWorkflowLauncher {
  type Launcher = {
    source: str, deps: bool, profile: bool, token: bool, entryChecked: bool, entry: bool,
    config: bool, identity: bool, text: str, embeddings: bool, features: str, logOpen: bool,
    child: bool, childPid: bool, metadata: bool, pid: bool, gitRevision: str, revision: str, supervised: bool,
    booted: bool, childClosed: bool, preloadEntry: bool, forwarded: str, receiptFailed: bool, cleanupSignal: str,
    outcome: str, exitCode: int
  }
  var s: Launcher
  pure val SourceKinds = Set("default", "explicit")
  pure val TextKinds = Set("direct", "invalid")
  pure val FeatureKinds = Set("enabled", "disabled")
  pure val Revisions = Set("pinned", "other")
  pure val PreflightRefusals = Set("relative-default", "invalid-port", "input-mode",
    "unreviewed-profile", "missing-entry", "routing", "embedding-path", "git-metadata")
  pure val ExitCodes = Set(0, 1, 7)
  val running = s.outcome == "running"

  action startState(profile: bool, config: bool, text: str, embeddings: bool, features: str): bool = all {
    if (config) profile and TextKinds.contains(text) and FeatureKinds.contains(features)
    else text == "none" and not(embeddings) and features == "none",
    s' = { source: "none", deps: false, profile: profile, token: false, entryChecked: false, entry: false,
      config: config, identity: false, text: text, embeddings: embeddings, features: features,
      logOpen: false, child: false, childPid: false, metadata: false, pid: false, gitRevision: "none", revision: "none",
      supervised: false, booted: false, childClosed: false, preloadEntry: false, forwarded: "none",
      receiptFailed: false, cleanupSignal: "none", outcome: "running", exitCode: -1 }
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
    running, s.identity, s.text == "direct", not(s.logOpen), not(s.child),
    s' = { ...s, logOpen: true }
  }
  action refuse(reason: str): bool = all {
    running, not(s.child), PreflightRefusals.contains(reason),
    if (reason == "relative-default") s.source == "none"
    else if (reason == "missing-entry") s.entryChecked and not(s.entry)
    else if (reason == "routing") s.identity and s.text == "invalid"
    else if (Set("embedding-path", "git-metadata").contains(reason)) s.logOpen and s.gitRevision == "none"
    else s.deps and not(s.token),
    s' = { ...s, logOpen: false, outcome: reason, exitCode: 1 }
  }
  action readRevision(revision: str): bool = all {
    running, s.logOpen, not(s.child), s.gitRevision == "none", Revisions.contains(revision),
    s' = { ...s, gitRevision: revision }
  }
  action spawnChild(pid: bool): bool = all {
    running, s.logOpen, Revisions.contains(s.gitRevision), not(s.child),
    s' = { ...s, child: true, childPid: pid }
  }
  action supervise = all { running, s.child, not(s.supervised), not(s.childClosed),
    s' = { ...s, supervised: true } }
  action publishMetadata(pid: bool, revision: str): bool = all {
    running, s.supervised, not(s.metadata), not(s.receiptFailed), pid == s.childPid, revision == s.gitRevision,
    s' = { ...s, metadata: true, pid: pid, revision: revision }
  }
  action receiptFailure = all {
    running, s.supervised, not(s.metadata), not(s.receiptFailed),
    s' = { ...s, receiptFailed: true }
  }
  action cleanupSignal(sig: str): bool = all {
    running, s.receiptFailed, s.supervised, s.childPid,
    (sig == "SIGTERM" and s.cleanupSignal == "none") or (sig == "SIGKILL" and s.cleanupSignal == "SIGTERM"),
    s' = { ...s, cleanupSignal: sig }
  }
  action childBoot = all {
    running, s.metadata, s.supervised, s.childPid, not(s.booted),
    s' = { ...s, booted: true }
  }
  action forward(sig: str): bool = all {
    running, s.metadata, s.supervised, s.childPid, s.forwarded == "none", Set("SIGINT", "SIGTERM").contains(sig),
    s' = { ...s, forwarded: sig }
  }
  action settleChild(outcome: str, code: int, preloadEntry: bool): bool = all {
    running, s.supervised, s.metadata or s.receiptFailed, ExitCodes.contains(code),
    if (s.childPid) outcome == "child-exit" else outcome == "spawn-error" and code == 1,
    preloadEntry implies s.gitRevision == "pinned" and s.childPid and code == 0,
    s' = { ...s, outcome: if (s.receiptFailed) "running" else outcome, exitCode: code, childClosed: true,
      preloadEntry: preloadEntry, logOpen: false, supervised: false }
  }
  action rejectReceipt = all {
    running, s.receiptFailed, s.childClosed,
    s' = { ...s, outcome: "write-metadata", exitCode: 1 }
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
    { nondet revision = Revisions.oneOf()
      readRevision(revision) },
    { nondet pid = Bool.oneOf()
      spawnChild(pid) },
    supervise, publishMetadata(s.childPid, s.gitRevision), receiptFailure,
    { nondet sig = Set("SIGTERM", "SIGKILL").oneOf()
      cleanupSignal(sig) },
    rejectReceipt, childBoot,
    { nondet sig = Set("SIGINT", "SIGTERM").oneOf()
      forward(sig) },
    { nondet code = ExitCodes.oneOf()
      nondet ranEntry = Bool.oneOf()
      settleChild(if (s.childPid) "child-exit" else "spawn-error", code, ranEntry) },
    s' = s
  }
  val EntryCheckFollowsToken = s.entryChecked implies s.token and s.profile
  val SpawnRequiresPrivateProfile = s.child implies
    s.deps and s.entry and s.identity and s.text == "direct" and Revisions.contains(s.gitRevision) and
    (s.logOpen or s.childClosed)
  val ReceiptDescribesRequestedChild = s.metadata implies
    s.child and s.pid == s.childPid and s.revision == s.gitRevision and (s.supervised or s.childClosed)
  val PatchedEntryRequiresAdmittedRevision = s.preloadEntry implies s.gitRevision == "pinned" and s.childClosed
  val ChildCustodyAfterReceiptFailure = s.receiptFailed implies
    (if (running) s.supervised or s.childClosed else s.childClosed)
  val ClosedChildReleasesLog = s.childClosed implies not(s.logOpen) and not(s.supervised)
  val safety = EntryCheckFollowsToken and SpawnRequiresPrivateProfile and ReceiptDescribesRequestedChild and
    PatchedEntryRequiresAdmittedRevision and ChildCustodyAfterReceiptFailure and ClosedChildReleasesLog

  action freshToLog = startState(false, false, "none", false, "none")
    .then(selectSource("explicit", true)).then(prepareToken).then(checkEntry(true))
    .then(readProfile("direct", true, "disabled")).then(openLog)

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
  run cleanPinnedEntryTest = freshToLog.then(readRevision("pinned")).then(spawnChild(true)).then(supervise)
    .then(publishMetadata(true, "pinned")).then(settleChild("child-exit", 0, true))
    .expect(s.preloadEntry and not(s.logOpen) and safety)
  run otherRevisionCanLeaveReceiptTest = freshToLog.then(readRevision("other")).then(spawnChild(true)).then(supervise)
    .then(publishMetadata(true, "other")).then(settleChild("child-exit", 1, false))
    .expect(s.metadata and not(s.preloadEntry) and safety)
  run gitReadFailurePreventsSpawnTest = freshToLog.then(refuse("git-metadata"))
    .expect(s.identity and not(s.child) and not(s.logOpen) and s.exitCode == 1 and safety)
  run receiptFailureClosesChildTest = freshToLog.then(readRevision("pinned")).then(spawnChild(true)).then(supervise)
    .then(receiptFailure).then(cleanupSignal("SIGTERM")).then(settleChild("child-exit", 1, false)).then(rejectReceipt)
    .expect(s.childClosed and not(s.metadata) and s.exitCode == 1 and safety)
}
