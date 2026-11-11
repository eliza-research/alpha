/// The renderer's Cloud sign-in screen: the method choice, the Google wait, the code and second
/// verification steps, a code that can no longer be verified, and Back during each of them.
module SignInChooser {
  type State = {
    step: str, error: str,
    // The connection step in flight: none, google, send, resend or verify.
    operation: str,
    // The attempt the code or verification step names (0: none), the IDs issued, and whether the
    // code step's code expired or ran out of tries.
    attempt: int, attempts: int, stale: bool, prefill: bool,
    // The host can report whether a cancelled Google attempt had already stored its key.
    commitBoundary: bool,
    // The key in storage, the key the screen has adopted, and the key read beside the Google hand-off.
    storedKey: int, adoptedKey: int, priorKey: int, hostCommitted: bool, adoptedByBack: bool
  }
  var s: State
  action init = {
    nondet boundary = Set(true, false).oneOf()
    s' = { step: "closed", error: "none", operation: "none", attempt: 0, attempts: 0, stale: false,
      prefill: false, commitBoundary: boundary, storedKey: 0, adoptedKey: 0, priorKey: 0,
      hostCommitted: false, adoptedByBack: false }
  }
  action androidInit = init.then(s' = { ...s, commitBoundary: false })
  action browserInit = init.then(s' = { ...s, commitBoundary: true })
  action openChooser = all {
    s.step == "closed", s.operation == "none",
    s' = { ...s, step: "choose", error: "none", prefill: false }
  }
  /// Google opens in the browser. The key held before the attempt is read beside the hand-off.
  action tapGoogle = all {
    s.step == "choose", s.operation == "none", s.storedKey < 3,
    s' = { ...s, operation: "google", step: "google", error: "none", prefill: false, priorKey: s.storedKey, hostCommitted: false }
  }
  /// The host stores the new key before the waiting call answers.
  action hostCommitsKey = all {
    s.operation == "google", not(s.hostCommitted),
    s' = { ...s, storedKey: s.storedKey + 1, hostCommitted: true }
  }
  /// The waiting Google call answers: signed in (the key is stored), a second verification, or a failure.
  action googleEnds(outcome: str): bool = all {
    s.operation == "google", outcome.in(Set("signed-in", "mfa", "failed")),
    outcome == "signed-in" implies s.hostCommitted,
    outcome != "signed-in" implies not(s.hostCommitted),
    outcome == "mfa" implies s.attempts < 4,
    s' = if (outcome == "signed-in")
        { ...s, operation: "none", step: "closed", error: "none", adoptedKey: s.storedKey, hostCommitted: false }
      else if (outcome == "mfa")
        { ...s, operation: "none", step: "mfa", error: "none", attempts: s.attempts + 1, attempt: s.attempts + 1, stale: false }
      else { ...s, operation: "none", step: "choose", error: "failed", prefill: false }
  }
  /// Back while Google waits. With a commit boundary the host says whether the key was already
  /// stored, and a stored key keeps the attempt running. Without one the attempt is cancelled and a
  /// key other than the one held before it is adopted instead of being hidden behind the chooser.
  action backDuringGoogle = all {
    s.operation == "google",
    s' = if (s.commitBoundary and s.hostCommitted) s
      else if (not(s.commitBoundary) and s.storedKey != s.priorKey)
        { ...s, operation: "none", step: "closed", error: "none", adoptedKey: s.storedKey, hostCommitted: false, adoptedByBack: true }
      else { ...s, operation: "none", step: "choose", error: "none", prefill: false }
  }
  /// An address or number is submitted from the method choice.
  action submitAddress = all {
    s.step == "choose", s.operation == "none", s.attempts < 4,
    s' = { ...s, operation: "send", error: "none" }
  }
  /// An accepted send opens the code step under the new attempt; a failed one returns to the
  /// method choice with the address filled in.
  action sendEnds(accepted: bool): bool = all {
    s.operation == "send",
    s' = if (accepted)
        { ...s, operation: "none", step: "code", error: "none", prefill: false,
          attempts: s.attempts + 1, attempt: s.attempts + 1, stale: false }
      else { ...s, operation: "none", step: "choose", error: "send-failed", prefill: true }
  }
  action resend = all {
    s.step == "code", s.operation == "none", s.attempts < 4,
    s' = { ...s, operation: "resend", error: "none" }
  }
  /// A failed resend keeps the code step exactly as it was, still naming the earlier attempt.
  action resendEnds(accepted: bool): bool = all {
    s.operation == "resend",
    s' = if (accepted)
        { ...s, operation: "none", error: "none", attempts: s.attempts + 1, attempt: s.attempts + 1, stale: false }
      else { ...s, operation: "none", error: "resend-failed" }
  }
  /// The form does not submit a code that can no longer be verified.
  action verify = all {
    s.step.in(Set("code", "mfa")), s.operation == "none", not(s.stale),
    s' = { ...s, operation: "verify", error: "none" }
  }
  /// A wrong code keeps the step. An expired or exhausted emailed code keeps the address with only
  /// Resend left. A second verification continues under the same attempt. Every other failure,
  /// an unreachable Cloud included, returns to the method choice.
  action verifyEnds(outcome: str): bool = all {
    s.operation == "verify", outcome.in(Set("signed-in", "mfa", "wrong", "spent", "failed")),
    outcome == "mfa" implies s.step == "code",
    outcome == "signed-in" implies s.storedKey < 3,
    s' = if (outcome == "signed-in")
        { ...s, operation: "none", step: "closed", error: "none", attempt: 0, stale: false,
          storedKey: s.storedKey + 1, adoptedKey: s.storedKey + 1 }
      else if (outcome == "mfa") { ...s, operation: "none", step: "mfa" }
      else if (outcome == "wrong") { ...s, operation: "none", error: "wrong-code" }
      else if (outcome == "spent" and s.step == "code") { ...s, operation: "none", stale: true, error: "spent" }
      else { ...s, operation: "none", step: "choose", error: "failed", attempt: 0, stale: false, prefill: true }
  }
  /// Back with no Google wait: a step in flight is cancelled, the code and verification steps
  /// return to the method choice, and the method choice closes.
  action back = all {
    s.step != "closed", s.operation != "google",
    val toChooser = s.operation != "none" or s.step != "choose"
    s' = { ...s, operation: "none", error: "none", attempt: 0, stale: false,
      step: if (toChooser) "choose" else "closed", prefill: toChooser and (s.step == "code" or s.prefill) }
  }
  action step = any {
    openChooser, tapGoogle, hostCommitsKey, googleEnds("signed-in"), googleEnds("mfa"), googleEnds("failed"),
    backDuringGoogle, submitAddress, sendEnds(true), sendEnds(false), resend, resendEnds(true), resendEnds(false),
    verify, verifyEnds("signed-in"), verifyEnds("mfa"), verifyEnds("wrong"), verifyEnds("spent"),
    verifyEnds("failed"), back, s' = s
  }
  val StaleOnlyOnCodeStep = s.stale implies s.step == "code"
  val AttemptOnlyOnCodeSteps = (s.attempt != 0) == s.step.in(Set("code", "mfa"))
  val SpentCodeNeverVerified = s.operation == "verify" implies not(s.stale)
  val StepMatchesWork = (s.operation == "google") == (s.step == "google")
    and (s.operation == "send" implies s.step == "choose")
    and (s.operation == "resend" implies s.step == "code")
    and (s.operation == "verify" implies s.step.in(Set("code", "mfa")))
  /// A key the host stored is adopted, or its Google attempt is still running.
  val StoredKeyNeverHidden = s.storedKey != s.adoptedKey implies s.operation == "google" and s.hostCommitted
  val PrefillOnlyOnChooser = s.prefill implies s.step == "choose"
  val TypeOK = s.step.in(Set("closed", "choose", "google", "code", "mfa"))
    and s.operation.in(Set("none", "google", "send", "resend", "verify"))
    and s.error.in(Set("none", "failed", "send-failed", "resend-failed", "wrong-code", "spent"))
    and s.attempts.in(0.to(4)) and s.attempt.in(0.to(4)) and s.storedKey.in(0.to(3)) and s.adoptedKey.in(0.to(3))
  val safety = TypeOK and StaleOnlyOnCodeStep and AttemptOnlyOnCodeSteps and SpentCodeNeverVerified and
    StepMatchesWork and StoredKeyNeverHidden and PrefillOnlyOnChooser

  val SpentCodeWitness = s.stale and s.operation == "none"
  val FailedResendKeepsAttemptWitness = s.error == "resend-failed" and s.step == "code" and s.attempt != 0
  val AdoptedByBackWitness = s.adoptedByBack and s.step == "closed" and s.adoptedKey == s.storedKey
  val CommittedAttemptSurvivesBackWitness = s.commitBoundary and s.operation == "google" and s.hostCommitted
  val GoogleSecondVerificationWitness = s.step == "mfa" and s.priorKey == s.storedKey and s.attempts == 1

  /// An expired code keeps the address on screen, cannot be verified again, and a resend replaces it.
  run spentCodeNeedsResendTest = browserInit.then(openChooser).then(submitAddress).then(sendEnds(true)).then(verify)
    .then(verifyEnds("spent")).expect(SpentCodeWitness and s.step == "code" and s.attempt == 1 and safety)
    .then(resend).then(resendEnds(true)).expect(not(s.stale) and s.attempt == 2 and safety)
    .then(verify).then(verifyEnds("signed-in")).expect(s.step == "closed" and s.adoptedKey == 1 and safety)
  run spentCodeCannotBeSubmittedTest = browserInit.then(openChooser).then(submitAddress).then(sendEnds(true)).then(verify)
    .then(verifyEnds("spent")).then(verify.fail())
  run failedResendKeepsCodeTest = browserInit.then(openChooser).then(submitAddress).then(sendEnds(true))
    .then(resend).then(resendEnds(false)).expect(FailedResendKeepsAttemptWitness and s.attempt == 1 and safety)
    .then(verify).then(verifyEnds("wrong")).expect(s.step == "code" and s.error == "wrong-code" and safety)
  /// A check that never reached Cloud ends the code step: the address is refilled for a new code.
  run failedVerifyReturnsToChooserTest = browserInit.then(openChooser).then(submitAddress).then(sendEnds(true))
    .then(verify).then(verifyEnds("failed"))
    .expect(s.step == "choose" and s.prefill and s.attempt == 0 and safety)
  /// Without a commit boundary, Back after the host stored the key signs in instead of showing
  /// the method choice over a stored key.
  run backAfterCommitAdoptsKeyTest = androidInit.then(openChooser).then(tapGoogle).then(hostCommitsKey)
    .then(backDuringGoogle).expect(AdoptedByBackWitness and s.operation == "none" and safety)
  run backBeforeCommitReturnsToChooserTest = androidInit.then(openChooser).then(tapGoogle).then(backDuringGoogle)
    .expect(s.step == "choose" and s.adoptedKey == 0 and not(s.adoptedByBack) and safety)
  /// With a commit boundary, Back after the key was stored leaves the attempt to finish.
  run committedAttemptSurvivesBackTest = browserInit.then(openChooser).then(tapGoogle).then(hostCommitsKey)
    .then(backDuringGoogle).expect(CommittedAttemptSurvivesBackWitness and s.step == "google" and safety)
    .then(googleEnds("signed-in")).expect(s.step == "closed" and s.adoptedKey == 1 and safety)
  run googleSecondVerificationTest = browserInit.then(openChooser).then(tapGoogle).then(googleEnds("mfa"))
    .expect(GoogleSecondVerificationWitness and safety).then(verify).then(verifyEnds("spent"))
    .expect(s.step == "choose" and not(s.stale) and safety)
  run backFromCodeRefillsAddressTest = browserInit.then(openChooser).then(submitAddress).then(sendEnds(true)).then(back)
    .expect(s.step == "choose" and s.prefill and s.attempt == 0 and safety).then(back)
    .expect(s.step == "closed" and safety)
}
