// Exact producer receipt admission against selected private file identities.
module MobileBundleAdmission {
  type Fingerprint = {producer: int, adapter: int, stamp: int, bundle: int}
  type Receipt = {shape: str, fingerprint: Fingerprint, uuid: str, core: str, tamper: str}
  type Outcome = {operation: str, result: str}
  type State = {
    files: Fingerprint, fault: str, uuid: str, core: str,
    candidate: Receipt, stored: Receipt, outcome: Outcome
  }
  var s: State
  pure val Zero = {producer: 0, adapter: 0, stamp: 0, bundle: 0}
  pure val Absent = {shape: "missing", fingerprint: Zero, uuid: "exact", core: "exact", tamper: "none"}
  pure val Idle = {operation: "none", result: "none"}
  pure val Faults = Set("none", "policy", "stamp", "producer", "lock", "package", "inventory", "regular", "adapter", "core-auth")
  pure val UuidShapes = Set("exact", "missing", "duplicate", "wrong")
  pure val CoreShapes = Set("exact", "missing-connector", "duplicate-connector", "wrong-connector")
  pure val Tampering = Set("smoke", "core-input", "extra")

  action init = s' = {
    files: {...Zero, bundle: 1}, fault: "none", uuid: "exact", core: "exact",
    candidate: Absent, stored: Absent, outcome: Idle
  }
  pure def inputFailure(fault: str): str = if (fault == "core-auth") "none" else fault
  pure def receiptFailure(state: State, uuid: str, core: str): str = {
    val failedInput = inputFailure(state.fault)
    if (failedInput != "none") failedInput
    else if (uuid != "exact") "uuid-transform"
    else if (core != "exact" or state.fault == "core-auth") "core-transform"
    else if (state.files.bundle == 0) "bundle"
    else "none"
  }
  pure def exactStored(state: State): bool =
    state.stored.shape == "object" and state.stored.fingerprint == state.files
    and state.stored.uuid == "exact" and state.stored.core == "exact" and state.stored.tamper == "none"

  action setFault(fault: str): bool = all {
    Faults.contains(fault), s' = {...s, fault: fault, outcome: Idle},
  }
  action setRevision(name: str, version: int): bool = {
    val files = s.files
    all {
      s.fault == "none", name.in(Set("producer", "adapter", "stamp", "bundle")),
      (name == "bundle" and version.in(Set(0, 1, 2))) or (name != "bundle" and version.in(Set(0, 1))),
      s' = {...s, outcome: Idle, files:
        if (name == "producer") {...files, producer: version}
        else if (name == "adapter") {...files, adapter: version}
        else if (name == "stamp") {...files, stamp: version}
        else {...files, bundle: version}},
    }
  }
  action setUuid(shape: str): bool = all {
    UuidShapes.contains(shape), s' = {...s, uuid: shape, outcome: Idle},
  }
  action setCore(shape: str): bool = all {
    CoreShapes.contains(shape), s' = {...s, core: shape, outcome: Idle},
  }
  action checkInputs = {
    val failure = inputFailure(s.fault)
    s' = {...s, outcome: {operation: "inputs", result: if (failure == "none") "accepted" else failure}}
  }
  action buildReceipt = {
    val failure = receiptFailure(s, s.uuid, s.core)
    val created = {shape: "object", fingerprint: s.files, uuid: s.uuid, core: s.core, tamper: "none"}
    s' = {...s, candidate: if (failure == "none") created else Absent,
      outcome: {operation: "build", result: if (failure == "none") "accepted" else failure}}
  }
  action publishReceipt = all {
    s.candidate.shape == "object", s' = {...s, stored: s.candidate, outcome: Idle},
  }
  action damageStored(shape: str): bool = all {
    shape.in(Set("missing", "malformed")),
    s' = {...s, stored: {...Absent, shape: shape}, outcome: Idle},
  }
  action tamperStored(kind: str, value: str): bool = {
    val stored = s.stored
    all {
      stored.shape == "object",
      (kind == "uuid" and UuidShapes.contains(value)) or
      (kind == "core" and CoreShapes.contains(value)) or
      (kind == "binding" and stored.tamper == "none" and Tampering.contains(value)),
      s' = {...s, outcome: Idle, stored:
        if (kind == "uuid") {...stored, uuid: value}
        else if (kind == "core") {...stored, core: value}
        else {...stored, tamper: value}},
    }
  }
  action verify = {
    val failure = receiptFailure(s, s.stored.uuid, s.stored.core)
    val result = if (s.stored.shape == "missing") "missing-receipt"
      else if (s.stored.shape == "malformed") "receipt-json"
      else if (failure != "none") failure
      else if (exactStored(s)) "accepted"
      else "stale"
    s' = {...s, outcome: {operation: "verify", result: result}}
  }
  val AdmitRequiresCurrentExactReceipt =
    (s.outcome.operation == "verify" and s.outcome.result == "accepted") implies exactStored(s)
  val AdmitRequiresReviewedInputs =
    (s.outcome.result == "accepted") implies
      (inputFailure(s.fault) == "none" and (s.outcome.operation == "inputs" or s.fault == "none"))
  val AdmitRequiresExistingBundle =
    (s.outcome.result == "accepted" and s.outcome.operation.in(Set("build", "verify"))) implies s.files.bundle > 0
  val CandidateRecordsExactTransforms = s.candidate.shape == "object" implies
    (s.candidate.uuid == "exact" and s.candidate.core == "exact" and s.candidate.tamper == "none" and s.candidate.fingerprint.bundle > 0)
  val safety = AdmitRequiresCurrentExactReceipt and AdmitRequiresReviewedInputs and
    AdmitRequiresExistingBundle and CandidateRecordsExactTransforms

  action step = any {
    { nondet fault = Faults.oneOf()
      setFault(fault) },
    { nondet name = Set("producer", "adapter", "stamp", "bundle").oneOf()
      nondet version = Set(0, 1, 2).oneOf()
      setRevision(name, version) },
    { nondet shape = UuidShapes.oneOf()
      any {setUuid(shape), tamperStored("uuid", shape)} },
    { nondet shape = CoreShapes.oneOf()
      any {setCore(shape), tamperStored("core", shape)} },
    { nondet kind = Tampering.oneOf()
      tamperStored("binding", kind) },
    damageStored("missing"), damageStored("malformed"),
    checkInputs, buildReceipt, publishReceipt, verify, s' = s,
  }

  action issued = buildReceipt.then(publishReceipt)
  run freshReceiptAdmissionTest = init.then(checkInputs).then(issued).then(verify)
    .expect(s.outcome.result == "accepted" and safety)
  run bundleChangeRequiresFreshReceiptTest = init.then(issued).then(setRevision("bundle", 2)).then(verify)
    .expect(s.outcome.result == "stale").then(issued).then(verify)
    .expect(s.outcome.result == "accepted" and safety)
  run producerPolicyAndReceiptAreSeparateTest = init.then(issued).then(setFault("producer")).then(verify)
    .expect(s.outcome.result == "producer").then(setFault("none")).then(setRevision("producer", 1))
    .then(verify).expect(s.outcome.result == "stale").then(issued).then(verify)
    .expect(s.outcome.result == "accepted" and safety)
  run connectorTransformRequiredOnIssueAndVerifyTest = init.then(issued).then(setCore("missing-connector"))
    .then(buildReceipt).expect(s.outcome.result == "core-transform" and s.stored.shape == "object")
    .then(tamperStored("core", "missing-connector")).then(verify).expect(s.outcome.result == "core-transform" and safety)
  run malformedReceiptReadbackTest = init.then(damageStored("malformed")).then(verify)
    .expect(s.outcome.result == "receipt-json").then(issued).then(verify)
    .expect(s.outcome.result == "accepted" and safety)
  run candidateAndPersistedReceiptCanDivergeTest = init.then(buildReceipt).then(setRevision("adapter", 1))
    .then(publishReceipt).then(verify).expect(s.outcome.result == "stale" and safety)
}
