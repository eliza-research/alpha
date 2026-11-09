// Current host artifact publication and readback, including preserved baseline discrepancies.
module NativeGoogleHostArtifact {
  type Receipt = {bundle: int, source: int, connector: bool}
  type Attempt = {projection: bool, version: bool, compile: bool, moduleWritten: bool, metadata: bool, tempClean: bool}
  type Outcome = {operation: str, result: str}
  type State = {source: int, sdkCurrent: bool, host: int, receipt: Receipt, attempt: Attempt, outcome: Outcome}
  var s: State
  pure val None = {bundle: 0, source: 0, connector: false}
  pure val Idle = {operation: "none", result: "none"}
  pure val EmptyAttempt = {projection: false, version: false, compile: false, moduleWritten: false,
    metadata: false, tempClean: true}
  pure val Modes = Set("ok", "input-drift", "projection-refused", "wrong-bun", "compiler-refused", "no-output",
    "escape-resolver", "escape-graph", "missing-transform", "metadata-refused", "missing-input",
    "linked-input", "manifest-refused", "sdk-drift")
  pure val BeforeModule = Set("compiler-refused", "no-output", "escape-resolver")
  pure val BeforeMetadata = Set("escape-graph", "missing-transform", "metadata-refused")

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
    else if (mode == "escape-graph") "graph"
    else if (mode == "missing-transform") "transform"
    else if (mode == "metadata-refused") "metadata"
    else if (mode.in(Set("missing-input", "linked-input"))) "input"
    else if (mode == "manifest-refused") "manifest"
    else "accepted"
  action build(mode: str, connector: bool): bool = {
    val projection = mode != "projection-refused"
    val compile = projection and mode != "wrong-bun" and s.sdkCurrent
    val wroteModule = compile and not(BeforeModule.contains(mode))
    val attempt = {projection: projection, version: projection, compile: compile, moduleWritten: wroteModule,
      metadata: wroteModule and not(BeforeMetadata.contains(mode)), tempClean: true}
    val result = buildResult(attempt, s.sdkCurrent, mode)
    val source = if (compile and mode == "input-drift") 2 else s.source
    val emitted = if (wroteModule) s.source else s.host
    all {
      Modes.contains(mode), mode == "missing-transform" implies connector,
      s' = {source: source, sdkCurrent: s.sdkCurrent and not(compile and mode == "sdk-drift"),
        host: emitted, receipt: if (result == "accepted") {bundle: emitted, source: source, connector: connector} else s.receipt,
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
  val safety = AcceptedReadbackMatchesDeclared and AcceptedBuildRequiresMetadata and ProducerOrder and BuildScratchReleased

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
  run lateFailureCanSplitPreviouslyUsablePairTest = init.then(build("ok", false)).then(setSource(2))
    .then(build("missing-transform", true)).expect(s.outcome.result == "transform" and not(workerReady))
    .then(setSource(1)).then(verify).expect(s.outcome.result == "bytes" and safety)
  run compilerReceiptCanBindLaterProductBytesTest = init.then(build("input-drift", false)).then(verify)
    .expect(s.outcome.result == "accepted" and not(ReceiptBindsCompiledSource) and safety)
    .then(build("ok", false)).then(verify).expect(ReceiptBindsCompiledSource and safety)
  run sdkPostcheckRefusesAfterOutputTest = init.then(build("sdk-drift", false))
    .expect(s.outcome.result == "sdk" and s.attempt.metadata and not(workerReady) and safety)
  run preflightRefusalKeepsPriorPairTest = init.then(build("ok", false)).then(build("wrong-bun", false)).then(verify)
    .expect(s.outcome.result == "accepted" and workerReady and not(s.attempt.compile) and safety)
}
