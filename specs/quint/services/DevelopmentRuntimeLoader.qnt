// Two serial calls to backend/loader.ts using the same fixed generated module URL.
module DevelopmentRuntimeLoader {
  type Loader = {
    phase: str, attempts: int, enabled: bool, builds: int, resolved: int,
    transformed: bool, artifact: int, receipt: int, stateDir: bool, salt: bool,
    saltBound: bool, saltVersions: int, cache: str, evaluations: int, returned: int, outcome: str
  }
  var s: Loader
  pure val Versions = Set(1, 2)
  pure val AdmissionFailures = Set("disabled", "pin", "prebuild")
  pure val BuildFailures = Set("resolve", "build-throw", "build-false")
  pure val ReceiptFailures = Set("missing-transform", "receipt-write")
  pure def cacheOf(version: int): str = if (version == 1) "v1" else "v2"
  pure def versionOf(cache: str): int =
    if (cache == "v1") 1 else if (cache == "v2") 2 else 0

  action init = s' = {
    phase: "idle", attempts: 0, enabled: false, builds: 0, resolved: 0,
    transformed: false, artifact: 0, receipt: 0, stateDir: false, salt: false,
    saltBound: false, saltVersions: 0, cache: "empty", evaluations: 0, returned: 0, outcome: "idle"
  }
  action begin(flagOn: bool, preexistingDirectory: bool): bool = all {
    Set("idle", "terminal").contains(s.phase),
    s.attempts < 2,
    s' = { ...s, phase: "admitting", attempts: s.attempts + 1, enabled: flagOn,
      stateDir: s.stateDir or preexistingDirectory, returned: 0, outcome: "running" }
  }
  action failAdmission(reason: str): bool = all {
    s.phase == "admitting",
    AdmissionFailures.contains(reason),
    s.enabled == (reason != "disabled"),
    s' = { ...s, phase: "terminal", outcome: reason }
  }
  // Entry to the actual build port is after flag, Git pin, registry and patch checks.
  action buildEnter = all {
    s.phase == "admitting", s.enabled,
    s' = { ...s, phase: "building", builds: s.builds + 1, resolved: 0, transformed: false }
  }
  action resolveSource(version: int): bool = all {
    s.phase == "building", Versions.contains(version),
    s' = { ...s, phase: "resolved", resolved: version }
  }
  action failBeforeOutput(reason: str): bool = all {
    BuildFailures.contains(reason),
    s.phase == (if (reason == "build-false") "resolved" else "building"),
    s' = { ...s, phase: "terminal", outcome: reason }
  }
  action emitArtifact(version: int, transformed: bool): bool = all {
    s.phase == "resolved", version == s.resolved,
    s' = { ...s, phase: "emitted", artifact: version, transformed: transformed }
  }
  action failReceipt(reason: str): bool = all {
    s.phase == "emitted", ReceiptFailures.contains(reason),
    s.transformed == (reason == "receipt-write"),
    s' = { ...s, phase: "terminal", outcome: reason }
  }
  action publishReceipt = all {
    s.phase == "emitted", s.transformed,
    s' = { ...s, phase: "receipt", receipt: s.resolved }
  }
  action failState = all {
    s.phase == "receipt", not(s.stateDir),
    s' = { ...s, phase: "terminal", outcome: "state-dir" }
  }
  action openState = all {
    s.phase == "receipt",
    s' = { ...s, phase: "state", stateDir: true }
  }
  action failSalt = all {
    s.phase == "state", not(s.salt),
    s' = { ...s, phase: "terminal", outcome: "salt-read" }
  }
  action bindSalt = all {
    s.phase == "state",
    s' = { ...s, phase: "bound", salt: true, saltBound: true, saltVersions: 1 }
  }
  // The module cache belongs to the fixed generated URL and persists across builds.
  action importOutput(throwsOnEvaluation: bool): bool = all {
    s.phase == "bound",
    val cache = if (s.cache != "empty") s.cache
      else if (throwsOnEvaluation) "failed" else cacheOf(s.artifact)
    s' = { ...s, phase: "terminal", cache: cache,
      evaluations: if (s.cache == "empty") s.evaluations + 1 else s.evaluations,
      returned: versionOf(cache), outcome: if (cache == "failed") "import" else "loaded" }
  }
  action step = any {
    { nondet flagOn = Bool.oneOf()
      nondet preexisting = Bool.oneOf()
      begin(flagOn, preexisting) },
    { nondet reason = AdmissionFailures.oneOf()
      failAdmission(reason) },
    buildEnter,
    { nondet version = Versions.oneOf()
      resolveSource(version) },
    { nondet reason = BuildFailures.oneOf()
      failBeforeOutput(reason) },
    { nondet transformed = Bool.oneOf()
      emitArtifact(s.resolved, transformed) },
    { nondet reason = ReceiptFailures.oneOf()
      failReceipt(reason) },
    publishReceipt, failState, openState, failSalt, bindSalt,
    { nondet failure = Bool.oneOf()
      importOutput(failure) },
    s' = s
  }

  val BuildRequiresAdmission = s.builds <= s.attempts and
    (Set("building", "resolved", "emitted", "receipt", "state", "bound").contains(s.phase) implies s.enabled)
  val ReceiptFollowsTransform = Set("receipt", "state", "bound").contains(s.phase) implies
    s.transformed and s.receipt == s.artifact and s.artifact == s.resolved and Versions.contains(s.receipt)
  val SaltBelongsToPrivateState = s.saltVersions == (if (s.salt) 1 else 0) and
    (s.saltBound implies s.salt and s.stateDir and Versions.contains(s.receipt))
  val ImportRequiresReceiptAndSalt = s.cache != "empty" implies s.saltBound and Versions.contains(s.receipt)
  val StableModuleCache = s.evaluations == (if (s.cache == "empty") 0 else 1) and
    (s.outcome == "loaded" implies s.returned == versionOf(s.cache) and Versions.contains(s.returned))
  val safety = BuildRequiresAdmission and ReceiptFollowsTransform and SaltBelongsToPrivateState and
    ImportRequiresReceiptAndSalt and StableModuleCache

  // A candidate expectation, deliberately excluded from baseline safety.
  val ReturnedCurrentArtifact = s.outcome == "loaded" implies s.returned == s.artifact

  action compile(version: int): bool =
    begin(true, false).then(buildEnter).then(resolveSource(version)).then(emitArtifact(version, true))
  action stageRuntime(version: int): bool =
    compile(version).then(publishReceipt).then(openState).then(bindSalt)

  run flagAndPinRefusalsTest = init.then(begin(false, false)).then(failAdmission("disabled"))
    .then(begin(true, false)).then(failAdmission("pin"))
    .expect(s.builds == 0 and s.artifact == 0 and not(s.salt) and safety)

  run transformFailureLeavesOnlyArtifactTest = init.then(begin(true, false)).then(buildEnter)
    .then(resolveSource(1)).then(emitArtifact(1, false)).then(failReceipt("missing-transform"))
    .expect(s.artifact == 1 and s.receipt == 0 and not(s.stateDir) and safety)

  run receiptWriteFailureSkipsStateTest = init.then(compile(1)).then(failReceipt("receipt-write"))
    .expect(s.artifact == 1 and s.receipt == 0 and not(s.stateDir) and s.cache == "empty" and safety)

  run stateFailureSkipsImportTest = init.then(compile(1)).then(publishReceipt).then(failState)
    .expect(s.receipt == 1 and not(s.stateDir) and s.cache == "empty" and safety)

  run loadedArtifactUsesBoundSaltTest = init.then(stageRuntime(1)).then(importOutput(false))
    .expect(s.returned == 1 and s.receipt == 1 and s.saltBound and ReturnedCurrentArtifact and safety)

  run rebuildReusesLoadedModuleTest = init.then(stageRuntime(1)).then(importOutput(false))
    .then(stageRuntime(2)).then(importOutput(false))
    .expect(s.receipt == 2 and s.returned == 1 and not(ReturnedCurrentArtifact) and safety)

  run rejectedEvaluationSurvivesValidRebuildTest = init.then(stageRuntime(1)).then(importOutput(true))
    .then(stageRuntime(2)).then(importOutput(false))
    .expect(s.outcome == "import" and s.receipt == 2 and s.evaluations == 1 and safety)
}
