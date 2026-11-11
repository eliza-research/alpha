/// Restore saved sign-in: the owner's explicit recovery of a retained legacy Cloud credential,
/// single-flight and fenced by a recovery epoch that every newer sign-in step advances.
module SavedSignInRecovery {
  type State = {
    epoch: int, recovering: bool, owner: int, closed: bool,
    // The restore's stage: none, reserved (accepted, nothing read), read (snapshot taken, Cloud
    // identity being checked outside every lock).
    stage: str,
    // The resident's credential intent reserved for this restore is still the newest.
    intentCurrent: bool,
    // The retained legacy credential (saved, expired, rejected or none) and what it was when the
    // running or last restore was accepted.
    legacy: str, legacyAtRequest: str,
    // What last wrote the Cloud slot, and the sign-in commits since the restore was requested.
    slot: str, commitsSinceRequest: int,
    answer: str, refusals: int
  }
  var s: State
  action init = {
    nondet legacy = Set("saved", "expired", "none").oneOf()
    s' = { epoch: 0, recovering: false, owner: 0, closed: false, stage: "none", intentCurrent: false,
      legacy: legacy, legacyAtRequest: legacy, slot: "empty", commitsSinceRequest: 0, answer: "none", refusals: 0 }
  }
  action savedInit = init.then(s' = { ...s, legacy: "saved", legacyAtRequest: "saved" })
  action expiredInit = init.then(s' = { ...s, legacy: "expired", legacyAtRequest: "expired" })
  pure def owned(v: State): bool = not(v.closed) and v.owner == v.epoch and v.intentCurrent
  pure def ended(v: State, answer: str): State = { ...v, recovering: false, owner: 0, stage: "none", answer: answer }
  /// One restore at a time: a second request, or one after teardown, is refused as login-active
  /// and changes nothing. An accepted one takes a new epoch and reserves the credential intent.
  action restoreRequested = all {
    s.epoch < 6,
    s' = if (s.closed or s.recovering) { ...s, refusals: if (s.refusals < 3) s.refusals + 1 else s.refusals }
      else { ...s, recovering: true, epoch: s.epoch + 1, owner: s.epoch + 1, stage: "reserved",
        intentCurrent: true, commitsSinceRequest: 0, answer: "none", legacyAtRequest: s.legacy }
  }
  /// Starting Google, an email or a text-message code, Cancel, or a matching browser return.
  action signInStep = all { s.epoch < 6, not(s.closed), s' = { ...s, epoch: s.epoch + 1 } }
  /// A shared sign-in commit advances the epoch, takes the credential intent and stores its key.
  action signInCommits = all {
    s.epoch < 6, not(s.closed),
    s' = { ...s, epoch: s.epoch + 1, intentCurrent: false, slot: "sign-in",
      commitsSinceRequest: if (s.commitsSinceRequest < 3) s.commitsSinceRequest + 1 else s.commitsSinceRequest }
  }
  /// Another credential mutation reserves the resident's credential intent.
  action intentSuperseded = all { s.intentCurrent, s' = { ...s, intentCurrent: false } }
  /// The guarded snapshot of the saved credential. Only a usable credential is offered: nothing
  /// saved, a rejected one and one already expired all answer that nothing was restored. A key
  /// whose expiry passes between the snapshot and its token check is refused as expired; the
  /// stored bytes are unchanged, so the request's own view of them moves with the clock.
  action restoreReads(expires: bool): bool = all {
    s.recovering, s.stage == "reserved",
    s' = if (not(owned(s))) ended(s, "unavailable")
      else if (s.legacy != "saved") ended(s, "not-restored")
      else if (expires) ended({ ...s, legacy: "expired", legacyAtRequest: "expired" }, "expired")
      else { ...s, stage: "read" }
  }
  /// Cloud's identity read answers and the guarded commit runs. A key Cloud refuses is marked
  /// rejected; any other failure, or a restore that lost its epoch or intent, keeps the saved data.
  action restoreEnds(cloud: str): bool = all {
    s.recovering, s.stage == "read", cloud.in(Set("accepted", "refused", "unreachable")),
    s' = if (cloud == "unreachable") ended(s, "unavailable")
      else if (not(owned(s))) ended(s, "unavailable")
      else if (cloud == "refused") ended({ ...s, legacy: "rejected" }, "rejected")
      else ended({ ...s, legacy: "none", slot: "restored" }, "restored")
  }
  action destroy = all { not(s.closed), s.epoch < 6, s' = { ...s, closed: true, epoch: s.epoch + 1 } }
  action step = {
    nondet expires = Set(false, true).oneOf()
    nondet cloud = Set("accepted", "refused", "unreachable").oneOf()
    any {
      restoreRequested, signInStep, signInCommits, intentSuperseded, restoreReads(expires),
      restoreEnds(cloud), destroy, s' = s
    }
  }
  /// A restore never replaces a key a sign-in stored after the restore was requested.
  val NewerSignInWins = s.slot == "restored" implies s.commitsSinceRequest == 0
  val SingleFlight = s.recovering == (s.owner != 0) and s.recovering == (s.stage != "none")
  val OwnerNeverAhead = s.owner <= s.epoch
  /// Only a completed restore or Cloud's refusal changes the saved credential.
  val SavedDataKept = s.answer.in(Set("none", "unavailable", "not-restored", "expired")) implies
    s.legacy == s.legacyAtRequest
  val RestoredConsumesSaved = s.answer == "restored" implies s.legacy == "none"
  val RejectedIsMarked = s.answer == "rejected" implies s.legacy == "rejected"
  val TypeOK = s.epoch.in(0.to(6)) and s.stage.in(Set("none", "reserved", "read"))
    and s.legacy.in(Set("saved", "expired", "rejected", "none")) and s.slot.in(Set("empty", "sign-in", "restored"))
    and s.answer.in(Set("none", "unavailable", "not-restored", "expired", "rejected", "restored"))
    and s.refusals.in(0.to(3)) and s.commitsSinceRequest.in(0.to(3))
  val safety = TypeOK and NewerSignInWins and SingleFlight and OwnerNeverAhead and SavedDataKept and
    RestoredConsumesSaved and RejectedIsMarked

  val RestoredWitness = s.slot == "restored" and s.answer == "restored"
  val SupersededKeepsSavedWitness = s.answer == "unavailable" and s.legacy == "saved" and s.slot == "sign-in"
  val BusyRefusalWitness = s.recovering and s.refusals > 0
  val RejectedWitness = s.legacy == "rejected"
  val ExpiredDuringRestoreWitness = s.answer == "expired"

  run restoreTest = savedInit.then(restoreRequested).then(restoreReads(false)).then(restoreEnds("accepted"))
    .expect(RestoredWitness and not(s.recovering) and safety)
  /// A sign-in that commits while the restore checks Cloud wins: the restore writes nothing and
  /// the saved credential stays for a later attempt.
  run newerSignInWinsTest = savedInit.then(restoreRequested).then(restoreReads(false)).then(signInCommits)
    .then(restoreEnds("accepted")).expect(SupersededKeepsSavedWitness and not(s.recovering) and safety)
  run cancelSupersedesUnreadRestoreTest = savedInit.then(restoreRequested).then(signInStep).then(restoreReads(false))
    .expect(s.answer == "unavailable" and s.legacy == "saved" and s.slot == "empty" and safety)
  /// The guard is released before the answer settles, so a retry right after it is accepted.
  run singleFlightTest = savedInit.then(restoreRequested).then(restoreRequested)
    .expect(BusyRefusalWitness and s.refusals == 1 and s.owner == 1 and safety)
    .then(restoreReads(false)).then(restoreEnds("unreachable")).expect(s.answer == "unavailable" and s.legacy == "saved")
    .then(restoreRequested).expect(s.recovering and s.owner == 2 and safety)
  run destroyedActivityRestoresNothingTest = savedInit.then(restoreRequested).then(restoreReads(false)).then(destroy)
    .then(restoreEnds("accepted")).expect(s.slot == "empty" and s.legacy == "saved" and safety)
    .then(restoreRequested).expect(s.refusals == 1 and not(s.recovering) and safety)
  /// An already expired saved sign-in is not offered: the restore reports nothing restored.
  run expiredSavedSignInTest = expiredInit.then(restoreRequested).then(restoreReads(false))
    .expect(s.answer == "not-restored" and s.legacy == "expired" and s.slot == "empty" and safety)
  run expiresDuringRestoreTest = savedInit.then(restoreRequested).then(restoreReads(true))
    .expect(s.answer == "expired" and s.legacy == "expired" and s.slot == "empty" and not(s.recovering) and safety)
  run refusedKeyIsMarkedTest = savedInit.then(restoreRequested).then(restoreReads(false)).then(restoreEnds("refused"))
    .expect(RejectedWitness and s.answer == "rejected" and s.slot == "empty" and safety)
}
