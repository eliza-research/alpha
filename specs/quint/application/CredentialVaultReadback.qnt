// Complementary audit scope; the canonical model and its source correspondence remain registered separately.
/// Product vault UI lifetime, listing-read fencing, native-origin admission and secret clearing.
module CredentialVaultReadback {
  // Bound on the listing-read counter. A value is never reused for a later read.
  pure val GenMax = 12
  type State = { locked: bool, active: bool, foreground: bool, secret: bool,
    entries: bool, generation: int, captured: int, loading: bool, sawOpen: bool, vaultOpen: bool, damaged: bool,
    reviewedOrigin: int, fieldOrigin: int, filled: bool, mocks: bool, transferred: bool, resetReviewed: bool, resetAuthorized: bool, resetGeneration: int, resets: int,
    operation: str, operationGeneration: int, notice: bool }
  var s: State
  pure val start: State = { locked: true, active: false, foreground: true, secret: false,
    entries: false, generation: 0, captured: 0, loading: false, sawOpen: false, vaultOpen: false, damaged: false,
    reviewedOrigin: 0, fieldOrigin: 1, filled: false, mocks: false, transferred: false, resetReviewed: false, resetAuthorized: false, resetGeneration: 0, resets: 0,
    operation: "", operationGeneration: 0, notice: false }
  // Every lock of the page retires a listing read still in flight and forgets metadata and the typed secret.
  pure def lockedView(t: State): State = { ...t, generation: t.generation + 1, locked: true,
    entries: false, secret: false, reviewedOrigin: 0, filled: false }
  // Leaving the password pages retires reads, locks the native vault and forgets everything held for them.
  pure def left(t: State): State = { ...lockedView({ ...t, generation: t.generation + 1 }), active: false,
    vaultOpen: false, damaged: false, resetReviewed: false, resetAuthorized: false, notice: false }
  action init = s' = start
  // Rendering the password pages opens them only while the app is shown; a render while it is
  // hidden leaves them closed.
  action open = all { s.foreground, s' = { ...s, active: true } }
  action unlock = all { s.active, s.foreground, not(s.damaged),
    s' = { ...s, locked: false, entries: true, vaultOpen: true } }
  action typeSecret = all { not(s.locked), s.active, s.foreground,
    s' = { ...s, secret: true } }
  // A listing read records what the vault holds when it starts and disarms a pending reset confirmation.
  action refresh = all { s.active, s.foreground, s.generation < GenMax,
    s' = { ...s, loading: true, generation: s.generation + 1, captured: s.generation + 1,
      sawOpen: s.vaultOpen and not(s.damaged), resetReviewed: false, resetAuthorized: false } }
  // Only the newest read of an open page is applied. A read that found the vault locked locks the page.
  action refreshResult = all { s.loading, s.captured == s.generation, s.active,
    s.sawOpen or s.generation < GenMax,
    s' = if (s.sawOpen) { ...s, loading: false, entries: true, locked: false }
      else lockedView({ ...s, loading: false }) }
  // A read overtaken by a lock, by leaving or by a newer read changes nothing.
  action staleRefreshResult = all { s.loading, s.captured != s.generation or not(s.active),
    s' = { ...s, loading: false } }
  action reviewOrigin = all { not(s.locked), s.active, s.foreground,
    s' = { ...s, reviewedOrigin: s.fieldOrigin } }
  action moveOrigin = s' = { ...s, fieldOrigin: if (s.fieldOrigin == 1) 2 else 1, reviewedOrigin: 0, filled: false }
  action fill = all { not(s.locked), s.active, s.foreground, s.reviewedOrigin == s.fieldOrigin,
    s.reviewedOrigin != 0, s' = { ...s, filled: true, secret: false } }
  // Explicit Lock and the end of the unlock window.
  action lock = all { s.generation < GenMax, s' = lockedView({ ...s, vaultOpen: false }) }
  action leave = if (s.active and s.generation + 2 <= GenMax) s' = left(s) else s' = s
  action background = all { not(s.active) or s.generation + 2 <= GenMax,
    s' = if (s.active) { ...left(s), foreground: false } else s.with("foreground", false) }
  action foreground = s' = { ...s, foreground: true }
  action keyInvalidated = all { s.generation < GenMax,
    s' = { ...lockedView(s), damaged: true, loading: false, vaultOpen: false, notice: true } }
  action testMocksInit = s' = { ...start, mocks: true }
  action reviewReset = all { s.active, s.foreground, s.damaged,
    s' = { ...s, resetReviewed: true, resetAuthorized: false, resetGeneration: s.generation } }
  action authenticateReset = all { s.resetReviewed, s.active, s.foreground, s.damaged,
    s.resetGeneration == s.generation, s' = { ...s, resetAuthorized: true } }
  action beginResetAuthentication = all { s.resetReviewed, s.active, s.foreground, s.damaged,
    s.operation == "", s' = { ...s, operation: "reset", operationGeneration: s.generation, notice: false } }
  /// Native lock retires a pending credential challenge. Its rejected result disarms the
  /// confirmation and is reported only while the password pages are still open.
  action authenticationRefused = all { s.operation == "reset",
    s' = { ...s, operation: "", resetReviewed: false, resetAuthorized: false, notice: s.active } }
  action resetDamagedVault = all { s.resetReviewed, s.resetAuthorized, s.resetGeneration == s.generation,
    s.active, s.foreground, s.damaged, s.resets < 1,
    s' = { ...s, damaged: false, locked: true, entries: false, secret: false, vaultOpen: true,
      resetReviewed: false, resetAuthorized: false, resets: s.resets + 1 } }
  action transfer = all { s.mocks, not(s.locked), s' = { ...s, transferred: true } }
  action step = any { open, unlock, typeSecret, refresh, refreshResult, staleRefreshResult, reviewOrigin,
    moveOrigin, fill, lock, leave, background, foreground, keyInvalidated, reviewReset,
    beginResetAuthentication, authenticationRefused, authenticateReset, resetDamagedVault, transfer, s' = s }
  val SecretLifetime = s.secret implies (s.active and s.foreground and not(s.locked))
  val LockedMetadata = s.locked implies not(s.entries)
  val EntriesImplyActiveForeground = s.entries implies (s.active and s.foreground)
  val LockFencesRefresh = s.entries implies s.vaultOpen
  val ExactOrigin = s.filled implies (s.reviewedOrigin == s.fieldOrigin and not(s.locked))
  val TransferGate = s.transferred implies s.mocks
  val ReviewNeedsShownPage = (s.resetReviewed or s.resetAuthorized) implies (s.active and s.foreground and s.damaged)
  val ResetNeedsReview = s.resetAuthorized implies (s.resetReviewed and s.resetGeneration <= s.generation)
  val HiddenPageIsClosed = s.active implies s.foreground
  val TypeOK = s.operation.in(Set("", "reset")) and s.generation.in(0.to(GenMax)) and
    s.captured <= s.generation and s.resets.in(0.to(1))
  val safety = TypeOK and SecretLifetime and LockedMetadata and EntriesImplyActiveForeground and
    LockFencesRefresh and ExactOrigin and TransferGate and ReviewNeedsShownPage and ResetNeedsReview and
    HiddenPageIsClosed
  val RetiredReadWitness = s.loading and s.sawOpen and s.captured != s.generation and s.locked and s.active
  val ResetPendingAfterLeaveWitness = s.operation == "reset" and not(s.active)
  val RefusedResetReportedWitness = s.notice and s.damaged and s.operation == "" and s.operationGeneration > 0 and not(s.resetReviewed)
  val ResetAuthorizedWitness = s.resetAuthorized
  // A render while hidden does not reopen the pages; the next one after returning does, and its
  // read finds the vault locked.
  run hiddenRenderStaysClosedTest = init.then(open).then(unlock).then(background).then(open).fail()
  run returnReopensLockedTest = init.then(open).then(unlock).then(background).then(foreground).then(open)
    .then(refresh).then(refreshResult)
    .expect(s.active and s.locked and not(s.entries) and not(s.loading) and safety)
  run backgroundClearsTest = init.then(open).then(unlock).then(typeSecret).then(background)
    .expect(not(s.secret) and s.locked and not(s.entries) and not(s.active) and safety)
  run originChangeTest = init.then(open).then(unlock).then(reviewOrigin).then(moveOrigin)
    .expect(s.reviewedOrigin == 0 and not(s.filled) and safety)
  run exactFillTest = init.then(open).then(unlock).then(reviewOrigin).then(fill).expect(s.filled and safety)
  run invalidKeyTest = init.then(open).then(unlock).then(keyInvalidated)
    .expect(s.damaged and s.locked and not(s.entries) and safety)
  run confirmedDamageResetTest = init.then(open).then(keyInvalidated).then(reviewReset)
    .then(authenticateReset).then(resetDamagedVault).expect(s.resets == 1 and not(s.damaged) and safety)
  run backgroundPreventsResetTest = init.then(open).then(keyInvalidated).then(reviewReset)
    .then(authenticateReset).then(background).expect(not(s.foreground) and s.resets == 0 and safety)
    .then(foreground).then(open).then(resetDamagedVault).fail()
  run explicitTestBuildTransferTest = testMocksInit.then(open).then(unlock).then(transfer)
    .expect(s.transferred and safety)
  run leaveRetiresResetReviewTest = init.then(open).then(refresh).then(keyInvalidated)
    .then(reviewReset).then(leave).then(open)
    .expect(not(s.resetReviewed or s.resetAuthorized or s.damaged) and safety)
  run nativeLockRefusesPendingResetTest = init.then(open).then(refresh).then(keyInvalidated)
    .then(reviewReset).then(beginResetAuthentication).then(leave).then(authenticationRefused)
    .expect(s.resets == 0 and not(s.resetReviewed or s.resetAuthorized) and not(s.notice) and safety)
  // A listing read that a lock overtakes is retired instead of repopulating the locked page.
  run lockFencesRefreshTest = init.then(open).then(unlock).then(refresh)
    .expect(s.loading and s.sawOpen).then(lock).expect(s.loading and s.captured != s.generation)
    .then(refreshResult).fail()
  run retiredReadChangesNothingTest = init.then(open).then(unlock).then(refresh).then(lock)
    .then(staleRefreshResult).expect(s.locked and not(s.entries) and not(s.loading) and safety)
  run leaveRetiresReadTest = init.then(open).then(unlock).then(refresh).then(leave).then(open)
    .expect(s.loading and s.captured != s.generation).then(staleRefreshResult)
    .expect(s.locked and not(s.entries) and safety)
  run refreshDisarmsResetTest = init.then(open).then(keyInvalidated).then(reviewReset).then(refresh)
    .expect(not(s.resetReviewed) and s.resets == 0 and safety)
  run refusedResetWhileOpenIsReportedTest = init.then(open).then(keyInvalidated).then(reviewReset)
    .then(beginResetAuthentication).then(authenticationRefused)
    .expect(s.notice and not(s.resetReviewed) and s.resets == 0 and safety)
}
