/// Product vault UI lifetime, native-origin admission and secret clearing.
module CredentialVault {
  type State = { locked: bool, active: bool, foreground: bool, secret: bool,
    entries: bool, generation: int, captured: int, loading: bool, damaged: bool,
    reviewedOrigin: int, fieldOrigin: int, filled: bool, mocks: bool, transferred: bool, resetReviewed: bool, resetAuthorized: bool, resetGeneration: int, resets: int,
    operation: str, operationGeneration: int, notice: bool }
  var s: State
  action init = s' = { locked: true, active: false, foreground: true, secret: false,
    entries: false, generation: 0, captured: 0, loading: false, damaged: false,
    reviewedOrigin: 0, fieldOrigin: 1, filled: false, mocks: false, transferred: false, resetReviewed: false, resetAuthorized: false, resetGeneration: 0, resets: 0,
    operation: "", operationGeneration: 0, notice: false }
  action open = s' = { ...s, active: true }
  action unlock = all { s.active, s.foreground, not(s.damaged),
    s' = { ...s, locked: false, entries: true } }
  action typeSecret = all { not(s.locked), s.active, s.foreground,
    s' = { ...s, secret: true } }
  action refresh = all { s.active, s.foreground, s.generation < 12,
    s' = { ...s, loading: true, generation: s.generation + 1, captured: s.generation + 1,
      resetReviewed: false, resetAuthorized: false } }
  action refreshResult = if (s.loading and s.captured == s.generation and s.active and s.foreground)
    s' = { ...s, loading: false, entries: not(s.locked),
      generation: s.generation + (if (s.locked) 1 else 0) }
    else s' = s
  action reviewOrigin = all { not(s.locked), s.active, s.foreground,
    s' = { ...s, reviewedOrigin: s.fieldOrigin } }
  action moveOrigin = s' = { ...s, fieldOrigin: if (s.fieldOrigin == 1) 2 else 1, reviewedOrigin: 0, filled: false }
  action fill = all { not(s.locked), s.active, s.foreground, s.reviewedOrigin == s.fieldOrigin,
    s.reviewedOrigin != 0, s' = { ...s, filled: true, secret: false } }
  action lock = all { s.generation < 12,
    s' = { ...s, locked: true, entries: false, secret: false, generation: s.generation + 1,
      reviewedOrigin: 0, filled: false, loading: false, resetReviewed: false, resetAuthorized: false } }
  action expiry = all { s.generation < 12,
    s' = { ...s, locked: true, entries: false, secret: false, generation: s.generation + 1,
      reviewedOrigin: 0, filled: false, loading: false, resetReviewed: false, resetAuthorized: false, notice: true } }
  action leave = if (s.active and s.generation < 12)
    s' = { ...s, active: false, locked: true, entries: false, generation: s.generation + 1,
      secret: false, loading: false, reviewedOrigin: 0, filled: false,
      damaged: false, resetReviewed: false, resetAuthorized: false, notice: false, operation: "" }
    else s' = s
  action background = all { not(s.active) or s.generation < 12,
    s' = if (s.active) { ...s, foreground: false, active: false, locked: true, secret: false,
      generation: s.generation + 1, entries: false, reviewedOrigin: 0, filled: false,
      loading: false, damaged: false, resetReviewed: false, resetAuthorized: false, notice: false, operation: "" }
      else s.with("foreground", false) }
  action foreground = s' = { ...s, foreground: true }
  action keyInvalidated = all { s.generation < 12,
    s' = { ...s, damaged: true, locked: true, entries: false, generation: s.generation + 1,
      secret: false, loading: false, reviewedOrigin: 0, filled: false, notice: true,
      resetReviewed: false, resetAuthorized: false } }
  action testMocksInit = s' = { locked: true, active: false, foreground: true, secret: false,
    entries: false, generation: 0, captured: 0, loading: false, damaged: false,
    reviewedOrigin: 0, fieldOrigin: 1, filled: false, mocks: true, transferred: false, resetReviewed: false, resetAuthorized: false, resetGeneration: 0, resets: 0,
    operation: "", operationGeneration: 0, notice: false }
  action reviewReset = all { s.active, s.foreground, s.damaged,
    s' = { ...s, resetReviewed: true, resetAuthorized: false, resetGeneration: s.generation } }
  action authenticateReset = all { s.resetReviewed, s.active, s.foreground, s.damaged,
    s.resetGeneration == s.generation, s' = { ...s, resetAuthorized: true } }
  action beginResetAuthentication = all { s.resetReviewed, s.active, s.foreground, s.damaged,
    s.operation == "", s' = { ...s, operation: "reset", operationGeneration: s.generation, notice: false } }
  /// Leave retires the task's page lifetime. Its late rejection cannot publish a notice.
  action authenticationRefused = s' = if (s.operation == "reset" and s.active and s.foreground)
    { ...s, operation: "", notice: true } else s
  action resetAuthenticationRetired = s' = { ...s, operation: "" }
  action resetDamagedVault = all { s.resetReviewed, s.resetAuthorized, s.resetGeneration == s.generation,
    s.active, s.foreground, s.damaged, s.resets < 1,
    s' = { ...s, damaged: false, locked: true, entries: false, secret: false,
      resetReviewed: false, resetAuthorized: false, resets: s.resets + 1 } }
  action transfer = all { s.mocks, not(s.locked), s' = { ...s, transferred: true } }
  action step = any { open, unlock, typeSecret, refresh, refreshResult, reviewOrigin,
    moveOrigin, fill, lock, expiry, leave, background, foreground, keyInvalidated, reviewReset,
    beginResetAuthentication, authenticationRefused, resetAuthenticationRetired, authenticateReset, resetDamagedVault, transfer, s' = s }
  val SecretLifetime = s.secret implies (s.active and s.foreground and not(s.locked))
  val LockedMetadata = s.locked implies not(s.entries)
  val ExactOrigin = s.filled implies (s.reviewedOrigin == s.fieldOrigin and not(s.locked))
  val TransferGate = s.transferred implies s.mocks
  val safety = SecretLifetime and LockedMetadata and ExactOrigin and TransferGate
  run backgroundClearsTest = init.then(open).then(unlock).then(typeSecret).then(background)
    .expect(not(s.secret) and s.locked and safety)
  run originChangeTest = init.then(open).then(unlock).then(reviewOrigin).then(moveOrigin)
    .expect(s.reviewedOrigin == 0 and not(s.filled) and safety)
  run exactFillTest = init.then(open).then(unlock).then(reviewOrigin).then(fill).expect(s.filled and safety)
  run invalidKeyTest = init.then(open).then(unlock).then(keyInvalidated).expect(s.damaged and safety)
  run confirmedDamageResetTest = init.then(open).then(keyInvalidated).then(reviewReset)
    .then(authenticateReset).then(resetDamagedVault).expect(s.resets == 1 and not(s.damaged) and safety)
  run backgroundPreventsResetTest = init.then(open).then(keyInvalidated).then(reviewReset)
    .then(authenticateReset).then(background).expect(not(s.foreground) and s.resets == 0 and safety)
  run explicitTestBuildTransferTest = testMocksInit.then(open).then(unlock).then(transfer)
    .expect(s.transferred and safety)
  run leaveRetiresResetReviewTest = init.then(open).then(refresh).then(keyInvalidated)
    .then(reviewReset).then(leave).then(open)
    .expect(not(s.resetReviewed or s.resetAuthorized or s.damaged) and safety)
  run nativeLockRefusesPendingResetTest = init.then(open).then(refresh).then(keyInvalidated)
    .then(reviewReset).then(beginResetAuthentication).then(leave).then(authenticationRefused)
    .expect(s.resets == 0 and not(s.resetReviewed or s.resetAuthorized or s.notice) and safety)
  run lockRetiresPendingMetadataTest = init.then(open).then(unlock).then(refresh)
    .then(lock).then(refreshResult).expect(not(s.entries or s.loading) and s.locked and safety)
  run refreshRetiresResetReviewTest = init.then(open).then(keyInvalidated).then(reviewReset)
    .then(refresh).then(keyInvalidated).expect(not(s.resetReviewed or s.resetAuthorized) and s.resets == 0 and safety)
}
