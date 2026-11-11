// Native Android input report and the two separate prerequisite gates.
module AndroidBuildInputReadiness {
  type Inputs = {pin: str, voice: str, host: str, prepared: bool,
    payload: str, worker: str, profile: str, mobilePolicy: bool, google: bool, support: bool, signer: str}
  type State = {input: Inputs, ready: Set[str], attention: Set[str], before: Set[str],
    full: Set[str], notices: Set[str], googleChecked: bool}
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
    val before = rowIf(not(pinReady), "pin").union(rowIf(not(voiceReady), "voice"))
    val stageBlock = if (i.payload == "absent" or not(stagedWorker)) Set("payload")
      else if (i.payload == "stale") Set("stamp")
      else if (i.profile != "native") Set("profile")
      else if (i.mobilePolicy) Set("mobileReceipt")
      else rowIf(not(i.google), "googleHost")
    val full = if (before.size() != 0) before
      else if (not(i.prepared)) Set("prepared")
      else rowIf(not(hostReady), "embedding").union(stageBlock)
    val notices = rowIf(ready.size() == 9, "allInputs").union(rowIf(not(voiceReady), "voiceBlocker"))
      .union(rowIf(not(signerReady), "unsigned"))
    val googleChecked = before.size() == 0 and payloadReady and i.profile == "native" and not(i.mobilePolicy)
    {input: i, ready: ready, attention: attention, before: before, full: full, notices: notices,
      googleChecked: googleChecked}
  }
  action init = s' = observe({pin: "equal", voice: "missing", host: "missing",
    prepared: false, payload: "absent", worker: "none", profile: "absent", mobilePolicy: false,
    google: true, support: false, signer: "unset"})

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
  action setProfile(value: str): bool = all {
    value.in(Set("native", "cloud")), s' = observe({...s.input, profile: value}),
  }
  action demandMobileReceipt = s' = observe({...s.input, mobilePolicy: true})
  action setGoogleHost(value: bool): bool = s' = observe({...s.input, google: value})
  action stageSupport = s' = observe({...s.input, support: true})
  action setSigner(value: str): bool = all {
    value.in(Set("unset", "envOnly", "identityOnly", "ready")), s' = observe({...s.input, signer: value}),
  }

  action step = any {
    { nondet v = Set("equal", "descendant", "older", "unknown", "mismatch").oneOf(); selectPin(v) },
    { nondet v = Set("missing", "staged").oneOf(); setVoice(v) },
    { nondet v = Set("missing", "ready", "different").oneOf(); setHost(v) },
    prepare, setPayload("exact"), setPayload("stale"),
    setWorker("artifact"), setWorker("staged"), setWorker("both"), setProfile("native"), setProfile("cloud"),
    demandMobileReceipt, setGoogleHost(true), setGoogleHost(false), stageSupport,
    { nondet v = Set("unset", "envOnly", "identityOnly", "ready").oneOf(); setSigner(v) },
  }

  val FullAdmissionRequiresEarlyAdmission = s.full.size() == 0 implies s.before.size() == 0
  val ReportedPayloadRequiresExactStamp = s.ready.contains("payload") implies
    (s.input.prepared and s.input.payload == "exact" and s.input.worker.in(Set("staged", "both")))
  val GoogleCheckFollowsPayloadAdmission = s.googleChecked implies
    (s.ready.contains("payload") and s.before.size() == 0 and s.input.profile == "native" and not(s.input.mobilePolicy))
  val HumanAttentionNeverReady = s.attention.intersect(s.ready).size() == 0
  val safety = FullAdmissionRequiresEarlyAdmission and ReportedPayloadRequiresExactStamp and
    GoogleCheckFollowsPayloadAdmission and HumanAttentionNeverReady

  run earlyAdmissionDoesNotAdmitFullBuildTest = init.then(setVoice("staged"))
    .expect(s.before.size() == 0 and s.full == Set("prepared") and s.attention.contains("signer") and safety)
  run onlyCurrentOrDescendantPinAdmitsTest = init.then(setVoice("staged")).then(selectPin("older"))
    .expect(s.before == Set("pin")).then(selectPin("unknown")).expect(s.before == Set("pin"))
    .then(selectPin("mismatch")).expect(s.before == Set("pin")).then(selectPin("descendant"))
    .expect(s.before.size() == 0 and s.full == Set("prepared") and safety)
  run missingWorkerAndStalePayloadRefuseTest = init.then(setVoice("staged")).then(setHost("ready")).then(prepare)
    .then(setPayload("stale")).then(setWorker("artifact")).expect(s.full == Set("payload"))
    .then(setWorker("both")).expect(s.full == Set("stamp") and not(s.ready.contains("payload")) and safety)
  run payloadReportDoesNotAdmitCloudProfileTest = init.then(setVoice("staged")).then(setHost("ready")).then(prepare)
    .then(setPayload("exact")).then(setWorker("staged")).then(setProfile("cloud"))
    .expect(s.ready.contains("payload") and not(s.ready.contains("worker")) and s.full == Set("profile"))
    .then(setProfile("native")).expect(s.full.size() == 0 and s.googleChecked and safety)
  run missingMobileReceiptPrecedesGoogleHostTest = init.then(setVoice("staged")).then(setHost("ready")).then(prepare)
    .then(setPayload("exact")).then(setWorker("both")).then(setProfile("native"))
    .then(setGoogleHost(false)).expect(s.full == Set("googleHost") and s.googleChecked)
    .then(demandMobileReceipt).expect(s.full == Set("mobileReceipt") and not(s.googleChecked) and safety)
  run embeddingBytesMustBePresentAndUnchangedTest = init.then(setVoice("staged")).then(prepare)
    .then(setPayload("exact")).then(setWorker("both")).then(setProfile("native"))
    .expect(s.full == Set("embedding") and not(s.attention.contains("embedding")))
    .then(setHost("ready")).expect(s.full.size() == 0 and s.ready.contains("embedding"))
    .then(setHost("different")).expect(s.full == Set("embedding") and not(s.ready.contains("embedding")))
    .then(setHost("missing")).expect(s.full == Set("embedding") and safety)
  run signerNeedsIdentityAndEnvironmentTest = init.then(setSigner("envOnly")).expect(not(s.ready.contains("signer")))
    .then(setSigner("identityOnly")).expect(not(s.ready.contains("signer")))
    .then(setSigner("ready")).expect(s.ready.contains("signer") and not(s.notices.contains("unsigned")) and safety)
  run completeInputReportDoesNotRunBuildTest = init.then(setVoice("staged")).then(setHost("ready"))
    .then(prepare).then(setPayload("exact")).then(setWorker("both")).then(setProfile("native")).then(stageSupport)
    .then(setSigner("ready")).expect(s.notices.contains("allInputs") and s.full.size() == 0 and safety)
}
