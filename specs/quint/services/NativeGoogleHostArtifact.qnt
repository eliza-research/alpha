// Input-bound candidate and serial publication of the fixed-name worker artifact.
module NativeGoogleHostArtifact {
  type Receipt = {bundle: int, source: int, connector: bool}
  type Attempt = {projection: bool, version: bool, compile: bool, moduleWritten: bool, metadata: bool,
    tempClean: bool, previousHost: int, previousReceipt: Receipt}
  type Outcome = {operation: str, result: str}
  type State = {source: int, sdkCurrent: bool, host: int, receipt: Receipt, attempt: Attempt, outcome: Outcome}
  var s: State
  pure val None = {bundle: 0, source: 0, connector: false}
  pure val Idle = {operation: "none", result: "none"}
  pure val EmptyAttempt = {projection: false, version: false, compile: false, moduleWritten: false,
    metadata: false, tempClean: true, previousHost: 0, previousReceipt: None}
  pure val Modes = Set("ok", "input-drift", "projection-refused", "wrong-bun", "compiler-refused", "no-output",
    "escape-resolver", "escape-graph", "missing-transform", "metadata-refused", "missing-input",
    "linked-input", "manifest-refused", "sdk-drift", "unbound-graph", "incomplete-graph", "fixed-drift",
    "module-refused", "worker-drift", "output-drift")
  pure val GraphRefusals = Set("escape-graph", "unbound-graph", "incomplete-graph")
  pure val BeforeModule = Set("compiler-refused", "no-output", "escape-resolver", "missing-transform").union(GraphRefusals)

  action init = s' = {source: 1, sdkCurrent: true, host: 0, receipt: None, attempt: EmptyAttempt, outcome: Idle}
  action setSource(version: int): bool = all {
    version.in(Set(1, 2)), s' = {...s, source: version, outcome: Idle},
  }
  action setSdk(current: bool): bool = s' = {...s, sdkCurrent: current, outcome: Idle}
  action setModule(version: int): bool = all {
    version.in(Set(0, 1, 2)), s' = {...s, host: version, outcome: Idle},
  }
  pure def buildResult(attempt: Attempt, sdk: bool, mode: str): str =
    if (not(attempt.projection)) "projection"
    else if (mode == "wrong-bun") "bun"
    else if (not(sdk) or mode == "sdk-drift") "sdk"
    else if (mode == "compiler-refused") "compiler"
    else if (mode == "no-output") "output"
    else if (mode == "escape-resolver") "resolver"
    else if (GraphRefusals.contains(mode)) "graph"
    else if (mode == "missing-transform") "transform"
    else if (mode == "metadata-refused") "metadata"
    else if (mode == "missing-input") "input"
    else if (mode.in(Set("linked-input", "input-drift"))) "source"
    else if (mode == "fixed-drift") "fixed"
    else if (mode == "output-drift") "candidate"
    else if (mode == "worker-drift") "worker"
    else if (mode == "manifest-refused") "manifest"
    else if (mode == "module-refused") "module"
    else "accepted"
  action build(mode: str, connector: bool): bool = {
    val projection = mode != "projection-refused"
    val compile = projection and mode != "wrong-bun" and s.sdkCurrent
    val wroteModule = compile and not(BeforeModule.contains(mode))
    val attempt = {projection: projection, version: projection, compile: compile, moduleWritten: wroteModule,
      metadata: wroteModule and mode != "metadata-refused", tempClean: true,
      previousHost: s.host, previousReceipt: s.receipt}
    val result = buildResult(attempt, s.sdkCurrent, mode)
    val source = if (compile and mode == "input-drift") 2 else s.source
    val host = if (result == "accepted") s.source else if (result == "worker") 2 else s.host
    all {
      Modes.contains(mode), mode == "missing-transform" implies connector,
      mode == "input-drift" implies s.source == 1,
      mode == "worker-drift" implies s.host != 2,
      s' = {source: source, sdkCurrent: s.sdkCurrent and not(compile and mode == "sdk-drift"),
        host: host, receipt: if (result == "accepted") {bundle: host, source: source, connector: connector} else s.receipt,
        attempt: attempt, outcome: {operation: "build", result: result}},
    }
  }
  action verify = {
    val result = if (s.receipt.bundle == 0) "missing"
      else if (s.receipt.source != s.source or not(s.sdkCurrent)) "source"
      else if (s.host != s.receipt.bundle) "bytes"
      else "accepted"
    s' = {...s, outcome: {operation: "verify", result: result}}
  }

  val workerReady = s.host == s.receipt.bundle
  val ReceiptBindsCompiledSource = s.receipt.bundle == 0 or s.receipt.bundle == s.receipt.source
  val AcceptedReadbackMatchesDeclared = s.outcome.result == "accepted" implies
    (s.sdkCurrent and s.host > 0 and s.host == s.receipt.bundle and s.source == s.receipt.source)
  val AcceptedBuildRequiresMetadata = (s.outcome.operation == "build" and s.outcome.result == "accepted") implies
    s.attempt.metadata
  val ProducerOrder = (s.attempt.metadata implies s.attempt.moduleWritten) and (s.attempt.moduleWritten implies s.attempt.compile)
    and (s.attempt.compile implies s.attempt.version) and (s.attempt.version implies s.attempt.projection)
  val BuildScratchReleased = s.attempt.tempClean
  val FailedBuildPreservesPriorPair =
    (s.outcome.operation == "build" and not(s.outcome.result.in(Set("accepted", "worker")))) implies
    (s.host == s.attempt.previousHost and s.receipt == s.attempt.previousReceipt)
  val PeerReplacementRetainsPriorReceipt = (s.outcome.operation == "build" and s.outcome.result == "worker") implies
    (s.host == 2 and s.receipt == s.attempt.previousReceipt)
  val safety = AcceptedReadbackMatchesDeclared and AcceptedBuildRequiresMetadata and ProducerOrder
    and BuildScratchReleased and ReceiptBindsCompiledSource and FailedBuildPreservesPriorPair
    and PeerReplacementRetainsPriorReceipt

  action step = any {
    { nondet mode = Modes.oneOf()
      nondet connector = Bool.oneOf()
      build(mode, connector) },
    { nondet version = Set(1, 2).oneOf()
      setSource(version) },
    { nondet current = Bool.oneOf()
      setSdk(current) },
    { nondet version = Set(0, 1, 2).oneOf()
      setModule(version) },
    verify, s' = s,
  }
  run completeBuildPublishesCurrentReceiptTest = init.then(build("ok", true)).then(verify)
    .expect(s.outcome.result == "accepted" and s.receipt.connector and ReceiptBindsCompiledSource and safety)
  run staleProductInputRefusesReadbackTest = init.then(build("ok", false)).then(setSource(2)).then(verify)
    .expect(s.outcome.result == "source" and workerReady).then(build("ok", false)).then(verify)
    .expect(s.outcome.result == "accepted" and safety)
  run refusedCandidateLeavesPriorPairTest = init.then(build("ok", false)).then(setSource(2))
    .then(build("missing-transform", true)).expect(s.outcome.result == "transform" and workerReady)
    .then(setSource(1)).then(verify).expect(s.outcome.result == "accepted" and safety)
  run coherentCompilerInputDriftRefusesPublicationTest = init.then(build("ok", false)).then(build("input-drift", false))
    .expect(s.outcome.result == "source" and workerReady and safety)
    .then(verify).expect(s.outcome.result == "source")
    .then(build("ok", false)).then(verify).expect(s.outcome.result == "accepted" and safety)
  run sdkPostcheckRefusesAfterPrivateOutputTest = init.then(build("sdk-drift", false))
    .expect(s.outcome.result == "sdk" and s.attempt.metadata and workerReady and safety)
  run preflightRefusalKeepsPriorPairTest = init.then(build("ok", false)).then(build("wrong-bun", false)).then(verify)
    .expect(s.outcome.result == "accepted" and workerReady and not(s.attempt.compile) and safety)
  run refusedManifestRenameRestoresPriorModuleTest = init.then(build("ok", false)).then(setSource(2))
    .then(build("manifest-refused", false)).expect(s.outcome.result == "manifest" and s.attempt.metadata and safety)
    .then(setSource(1)).then(verify).expect(s.outcome.result == "accepted" and workerReady)
  run refusedFirstManifestRenameRemovesCandidateTest = init.then(build("manifest-refused", false))
    .expect(s.outcome.result == "manifest" and s.attempt.metadata and safety)
    .then(verify).expect(s.outcome.result == "missing" and workerReady)
  run outputDigestDriftRefusesPublicationTest = init.then(build("ok", false)).then(setSource(2))
    .then(build("output-drift", false)).expect(s.outcome.result == "candidate" and s.attempt.metadata and safety)
    .then(setSource(1)).then(verify).expect(s.outcome.result == "accepted" and workerReady)
  run concurrentPeerChangeAbortsPublicationTest = init.then(build("ok", false)).then(build("worker-drift", false))
    .expect(s.outcome.result == "worker" and not(workerReady) and safety)
    .then(verify).expect(s.outcome.result == "bytes")
}
