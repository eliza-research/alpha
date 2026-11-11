// Source-only reuse of a prepared runtime: the stamp must match the lock and the tracked bytes must verify.
module PreparedSourceStamp {
  type State = { source: str, current: bool, result: str }
  var s: State

  pure val SourceStates = Set("verified", "dirty", "wrongCommit")
  pure val LockStates = Set("pinned", "moved")

  action init = s' = {source: "verified", current: true, result: "none"}

  action sourceStatus(status: str): bool = all {
    status.in(SourceStates),
    s' = {...s, source: status, result: "none"},
  }

  action lockStatus(status: str): bool = all {
    status.in(LockStates),
    s' = {...s, current: status == "pinned", result: "none"},
  }

  action prepare = s' = {...s, result: if (s.current and s.source == "verified") "prepared" else "refused"}

  action step = any {
    { nondet status = SourceStates.oneOf(); sourceStatus(status) },
    { nondet status = LockStates.oneOf(); lockStatus(status) },
    prepare,
    s' = s,
  }

  val SuccessRequiresCurrentVerifiedSource = s.result == "prepared" implies (s.current and s.source == "verified")
  val safety = SuccessRequiresCurrentVerifiedSource

  run currentStampReuseTest = init.then(prepare).then(prepare)
    .expect(s.result == "prepared" and safety)
  run movedLockRefusesStaleStampTest = init.then(lockStatus("moved")).then(prepare)
    .expect(s.result == "refused" and safety).then(lockStatus("pinned")).then(prepare)
    .expect(s.result == "prepared" and safety)
  run dirtyOrWrongCommitRefusesTest = init.then(sourceStatus("dirty")).then(prepare)
    .expect(s.result == "refused" and safety)
    .then(sourceStatus("wrongCommit")).then(prepare)
    .expect(s.result == "refused" and safety)
}
