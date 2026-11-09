// Settled custody of a prepared runtime stamp across source-only qualification.
module PreparedSourceStamp {
  type State = {
    source: str, current: bool, backup: str, locked: bool, candidate: bool,
    result: str
  }
  var s: State

  pure val SourceStates = Set("verified", "dirty", "wrongCommit")
  pure val Requests = Set("ordinary", "exact", "stale", "candidateRefusal", "noSelection", "linkedBackup")
  pure val Sidecars = Set("backup", "lock", "candidate")

  action init = s' = {source: "verified", current: false, backup: "absent", locked: false,
    candidate: false, result: "none"}

  action sourceStatus(status: str): bool = all {
    status.in(SourceStates),
    s' = {...s, source: status, result: "none"},
  }

  action placeSidecar(slot: str): bool = all {
    slot.in(Sidecars),
    slot == "backup" implies s.backup == "absent",
    slot == "lock" implies not(s.locked),
    slot == "candidate" implies not(s.candidate),
    s' = {...s, backup: if (slot == "backup") "peer" else s.backup,
      locked: s.locked or slot == "lock", candidate: s.candidate or slot == "candidate", result: "none"},
  }

  action clearSidecar(slot: str): bool = all {
    slot.in(Sidecars),
    slot == "backup" implies s.backup == "peer",
    slot == "lock" implies s.locked,
    slot == "candidate" implies s.candidate,
    s' = {...s, backup: if (slot == "backup") "absent" else s.backup,
      locked: s.locked and slot != "lock", candidate: s.candidate and slot != "candidate", result: "none"},
  }

  action prepare(request: str): bool = all {
    request.in(Requests),
    val validRequest = request.in(Set("ordinary", "exact", "stale", "candidateRefusal"))
    val verified = s.source == "verified" and not(s.locked) and not(s.candidate)
    val preserve = verified and not(s.current) and request.in(Set("exact", "candidateRefusal")) and
      s.backup == "absent"
    val publish = preserve and request == "exact"
    val reuse = verified and s.current and validRequest
    s' = {...s, current: s.current or publish,
      backup: if (preserve) "prior" else s.backup,
      result: if (publish or reuse) "prepared" else "refused"},
  }

  action step = any {
    { nondet status = SourceStates.oneOf(); sourceStatus(status) },
    { nondet slot = Sidecars.oneOf(); placeSidecar(slot) },
    { nondet slot = Sidecars.oneOf(); clearSidecar(slot) },
    { nondet request = Requests.oneOf(); prepare(request) },
    s' = s,
  }

  val CurrentHasPriorStamp = s.current implies s.backup == "prior"
  val SuccessRequiresCurrentVerifiedSource = s.result == "prepared" implies (s.current and s.source == "verified")
  val safety = CurrentHasPriorStamp and SuccessRequiresCurrentVerifiedSource

  run exactThenOrdinaryReuseTest = init.then(prepare("exact")).then(prepare("ordinary"))
    .expect(s.result == "prepared" and s.backup == "prior" and safety)
  run staleAndDefaultRequireCurrentTest = init.then(prepare("stale"))
    .expect(s.result == "refused" and s.backup == "absent" and safety).then(prepare("ordinary"))
    .expect(s.result == "refused" and s.backup == "absent" and safety)
  run dirtyOrWrongCommitRefusesTest = init.then(sourceStatus("dirty")).then(prepare("exact"))
    .expect(s.result == "refused" and s.backup == "absent" and safety)
    .then(sourceStatus("wrongCommit")).then(prepare("exact"))
    .expect(s.result == "refused" and s.backup == "absent" and safety)
  run ownedLockAndOccupiedBackupAreKeptTest = init.then(placeSidecar("lock")).then(prepare("exact"))
    .expect(s.locked and s.backup == "absent" and s.result == "refused" and safety)
    .then(clearSidecar("lock")).then(placeSidecar("backup")).then(prepare("exact"))
    .expect(s.backup == "peer" and s.result == "refused" and safety)
  run occupiedCandidateFailsSourceAdmissionTest = init.then(placeSidecar("candidate")).then(prepare("exact"))
    .expect(s.candidate and not(s.current) and s.backup == "absent" and s.result == "refused" and safety)
  run refusedCandidateWriteLeavesPreservedPriorTest = init.then(prepare("candidateRefusal"))
    .expect(not(s.candidate) and not(s.current) and not(s.locked) and s.backup == "prior" and s.result == "refused" and safety)
  run invalidLocationsRefuseTest = init.then(prepare("noSelection"))
    .expect(s.result == "refused" and s.backup == "absent" and safety).then(prepare("linkedBackup"))
    .expect(s.result == "refused" and s.backup == "absent" and safety)
}
