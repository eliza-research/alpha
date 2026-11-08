/// Product vault UI lifetime, native-origin admission and secret clearing.
module CredentialVault {
  type State = { locked: bool, active: bool, foreground: bool, secret: bool,
    entries: bool, generation: int, captured: int, loading: bool, damaged: bool,
    reviewedOrigin: int, fieldOrigin: int, filled: bool, mocks: bool, transferred: bool, resetReviewed: bool, resetAuthorized: bool, resetGeneration: int, resets: int }
  var s: State
  action init = s' = { locked: true, active: false, foreground: true, secret: false,
    entries: false, generation: 0, captured: 0, loading: false, damaged: false,
    reviewedOrigin: 0, fieldOrigin: 1, filled: false, mocks: false, transferred: false, resetReviewed: false, resetAuthorized: false, resetGeneration: 0, resets: 0 }
  action open = s' = { ...s, active: true }
  action unlock = all { s.active, s.foreground, not(s.damaged),
    s' = { ...s, locked: false, entries: true } }
  action typeSecret = all { not(s.locked), s.active, s.foreground,
    s' = { ...s, secret: true } }
  action refresh = all { s.active, s.generation < 2,
    s' = { ...s, loading: true, generation: s.generation + 1, captured: s.generation + 1 } }
  action refreshResult = all { s.loading, s.captured == s.generation,
    s' = { ...s, loading: false, entries: not(s.locked) } }
  action reviewOrigin = all { not(s.locked), s.active, s.foreground,
    s' = { ...s, reviewedOrigin: s.fieldOrigin } }
  action moveOrigin = s' = { ...s, fieldOrigin: if (s.fieldOrigin == 1) 2 else 1, reviewedOrigin: 0, filled: false }
  action fill = all { not(s.locked), s.active, s.foreground, s.reviewedOrigin == s.fieldOrigin,
    s.reviewedOrigin != 0, s' = { ...s, filled: true, secret: false } }
  action lock = s' = { ...s, locked: true, entries: false, secret: false,
    reviewedOrigin: 0, filled: false, loading: false }
  action leave = s' = { ...s, active: false, locked: true, entries: false,
    secret: false, loading: false, reviewedOrigin: 0, filled: false }
  action background = s' = { ...s, foreground: false, locked: true, secret: false,
    entries: false, reviewedOrigin: 0, filled: false, loading: false }
  action foreground = s' = { ...s, foreground: true }
  action keyInvalidated = s' = { ...s, damaged: true, locked: true, entries: false,
    secret: false, loading: false, reviewedOrigin: 0, filled: false }
  action testMocksInit = s' = { locked: true, active: false, foreground: true, secret: false,
    entries: false, generation: 0, captured: 0, loading: false, damaged: false,
    reviewedOrigin: 0, fieldOrigin: 1, filled: false, mocks: true, transferred: false, resetReviewed: false, resetAuthorized: false, resetGeneration: 0, resets: 0 }
  action reviewReset = all { s.active, s.foreground, s.damaged,
    s' = { ...s, resetReviewed: true, resetAuthorized: false, resetGeneration: s.generation } }
  action authenticateReset = all { s.resetReviewed, s.active, s.foreground, s.damaged,
    s.resetGeneration == s.generation, s' = { ...s, resetAuthorized: true } }
  action resetDamagedVault = all { s.resetReviewed, s.resetAuthorized, s.resetGeneration == s.generation,
    s.active, s.foreground, s.damaged, s.resets < 1,
    s' = { ...s, damaged: false, locked: true, entries: false, secret: false,
      resetReviewed: false, resetAuthorized: false, resets: s.resets + 1 } }
  action transfer = all { s.mocks, not(s.locked), s' = { ...s, transferred: true } }
  action step = any { open, unlock, typeSecret, refresh, refreshResult, reviewOrigin,
    moveOrigin, fill, lock, leave, background, foreground, keyInvalidated, reviewReset, authenticateReset, resetDamagedVault, transfer, s' = s }
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
}
