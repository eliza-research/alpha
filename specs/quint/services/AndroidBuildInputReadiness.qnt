// Native Android input report and the one preflight gate (pinned checkout and voice outputs).
module AndroidBuildInputReadiness {
  type Inputs = {pin: str, voice: str, host: str, prepared: bool,
    payload: str, worker: str, support: bool, signer: str}
  type State = {input: Inputs, ready: Set[str], attention: Set[str], preflight: Set[str],
    notices: Set[str]}
  var s: State

  pure def rowIf(present: bool, label: str): Set[str] = if (present) Set(label) else Set()
  pure def observe(i: Inputs): State = {
    val pinReady = i.pin == "equal" or i.pin == "descendant"
    val voiceReady = i.voice != "missing"
    val hostReady = i.host == "ready"
    val artifactReady = i.worker == "artifact" or i.worker == "both"
    val stagedWorker = i.worker == "staged" or i.worker == "both"
    val payloadReady = i.prepared and i.payload == "exact" and stagedWorker
    val signerReady = i.signer == "ready"
    val ready = rowIf(pinReady, "pin").union(rowIf(voiceReady, "voice"))
      .union(rowIf(hostReady, "embedding"))
      .union(rowIf(i.prepared, "prepared")).union(rowIf(artifactReady, "worker"))
      .union(rowIf(payloadReady, "payload")).union(rowIf(i.support, "model")).union(rowIf(i.support, "gradle"))
      .union(rowIf(signerReady, "signer"))
    val attention = rowIf(not(voiceReady), "voice").union(rowIf(not(signerReady), "signer"))
    val preflight = rowIf(not(pinReady), "pin").union(rowIf(not(voiceReady), "voice"))
    val notices = rowIf(ready.size() == 9, "allInputs").union(rowIf(not(voiceReady), "voiceBlocker"))
      .union(rowIf(not(signerReady), "unsigned"))
    {input: i, ready: ready, attention: attention, preflight: preflight, notices: notices}
  }
  action init = s' = observe({pin: "equal", voice: "missing", host: "missing",
    prepared: false, payload: "absent", worker: "none", support: false, signer: "unset"})

  action selectPin(value: str): bool = all {
    value.in(Set("equal", "descendant", "older", "unknown", "mismatch")),
    s' = observe({...s.input, pin: value}),
  }
  action setVoice(value: str): bool = all {
    value.in(Set("missing", "staged")), s' = observe({...s.input, voice: value}),
  }
  action setHost(value: str): bool = all {
    value.in(Set("missing", "ready", "different")), s' = observe({...s.input, host: value}),
  }
  action prepare = s' = observe({...s.input, prepared: true})
  action setPayload(value: str): bool = all {
    value.in(Set("exact", "stale")), s' = observe({...s.input, payload: value}),
  }
  action setWorker(value: str): bool = all {
    value.in(Set("artifact", "staged", "both")), s' = observe({...s.input, worker: value}),
  }
  action stageSupport = s' = observe({...s.input, support: true})
  action setSigner(value: str): bool = all {
    value.in(Set("unset", "envOnly", "identityOnly", "ready")), s' = observe({...s.input, signer: value}),
  }

  action step = any {
    { nondet v = Set("equal", "descendant", "older", "unknown", "mismatch").oneOf(); selectPin(v) },
    { nondet v = Set("missing", "staged").oneOf(); setVoice(v) },
    { nondet v = Set("missing", "ready", "different").oneOf(); setHost(v) },
    prepare, setPayload("exact"), setPayload("stale"),
    setWorker("artifact"), setWorker("staged"), setWorker("both"), stageSupport,
    { nondet v = Set("unset", "envOnly", "identityOnly", "ready").oneOf(); setSigner(v) },
  }

  // The preflight refuses exactly the pin and voice inputs the report shows missing, and nothing
  // the build chain produces.
  val PreflightIsPinAndVoiceOnly = s.preflight == Set("pin", "voice").filter(row => not(s.ready.contains(row)))
  val ReportedPayloadRequiresExactStamp = s.ready.contains("payload") implies
    (s.input.prepared and s.input.payload == "exact" and s.input.worker.in(Set("staged", "both")))
  val HumanAttentionNeverReady = s.attention.intersect(s.ready).size() == 0
  val safety = PreflightIsPinAndVoiceOnly and ReportedPayloadRequiresExactStamp and HumanAttentionNeverReady

  run preflightIgnoresProducedInputsTest = init.then(setVoice("staged"))
    .expect(s.preflight.size() == 0 and not(s.ready.contains("prepared")) and s.attention.contains("signer") and safety)
  run onlyCurrentOrDescendantPinAdmitsTest = init.then(setVoice("staged")).then(selectPin("older"))
    .expect(s.preflight == Set("pin")).then(selectPin("unknown")).expect(s.preflight == Set("pin"))
    .then(selectPin("mismatch")).expect(s.preflight == Set("pin")).then(selectPin("descendant"))
    .expect(s.preflight.size() == 0 and safety)
  run missingWorkerAndStalePayloadAreReportedTest = init.then(setVoice("staged")).then(setHost("ready")).then(prepare)
    .then(setPayload("stale")).then(setWorker("artifact"))
    .expect(s.ready.contains("worker") and not(s.ready.contains("payload")) and s.preflight.size() == 0)
    .then(setWorker("both")).expect(not(s.ready.contains("payload")))
    .then(setPayload("exact")).expect(s.ready.contains("payload") and safety)
  run embeddingBytesMustBePresentAndUnchangedTest = init.then(setVoice("staged")).then(prepare)
    .then(setPayload("exact")).then(setWorker("both"))
    .expect(not(s.ready.contains("embedding")) and not(s.attention.contains("embedding")) and s.preflight.size() == 0)
    .then(setHost("ready")).expect(s.ready.contains("embedding"))
    .then(setHost("different")).expect(not(s.ready.contains("embedding")))
    .then(setHost("missing")).expect(not(s.ready.contains("embedding")) and safety)
  run signerNeedsIdentityAndEnvironmentTest = init.then(setSigner("envOnly")).expect(not(s.ready.contains("signer")))
    .then(setSigner("identityOnly")).expect(not(s.ready.contains("signer")))
    .then(setSigner("ready")).expect(s.ready.contains("signer") and not(s.notices.contains("unsigned")) and safety)
  run completeInputReportDoesNotRunBuildTest = init.then(setVoice("staged")).then(setHost("ready"))
    .then(prepare).then(setPayload("exact")).then(setWorker("both")).then(stageSupport)
    .then(setSigner("ready")).expect(s.notices.contains("allInputs") and s.preflight.size() == 0 and safety)
}
