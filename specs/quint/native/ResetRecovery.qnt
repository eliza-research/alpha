// Activity approval, durable attempt reservation and package-reset orchestration.
module ResetRecovery {
  type State = {
    review: bool, confirmed: bool, authGeneration: int, authReady: bool, marker: bool,
    processInitialized: bool, startupAdmitted: bool, listener: str, listenerRevoked: bool,
    failures: int, budgetReadable: bool, budgetPresent: bool, recoveryVisible: bool,
    dispatched: bool, clearAccepted: bool, erased: bool, authorizedRequest: bool, explicitRetry: bool,
    attemptStage: str, reserved: bool, reservationCount: int,
    reservationReadable: bool, reservationFresh: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    review: false, confirmed: false, authGeneration: 0, authReady: false, marker: false,
    processInitialized: true, startupAdmitted: true, listener: "installed", listenerRevoked: false,
    failures: 0, budgetReadable: true, budgetPresent: false, recoveryVisible: false,
    dispatched: false, clearAccepted: false, erased: false, authorizedRequest: false, explicitRetry: false,
    attemptStage: "idle", reserved: false, reservationCount: 0,
    reservationReadable: true, reservationFresh: false
  }
  action beginReview = all {
    not(s.review), not(s.marker), s.processInitialized, s.authGeneration < 4,
    s' = {review: true, confirmed: false, authReady: false, authGeneration: s.authGeneration + 1, ...s}
  }
  action confirm(ticket: int): bool =
    if (s.review and ticket == s.authGeneration) s' = s.with("confirmed", true) else s' = s
  action authenticationResult(ticket: int, accepted: bool): bool =
    if (s.review and ticket == s.authGeneration and s.authGeneration < 4)
      s' = {review: false, confirmed: false, authGeneration: s.authGeneration + 1,
        authReady: s.confirmed and accepted, ...s}
    else s' = s
  action prepareBudget(success: bool): bool = all {
    s.authReady, not(s.marker),
    s' = if (success) {failures: 0, budgetReadable: true, budgetPresent: true, ...s}
      else s.with("authReady", false)
  }
  action persistMarker(success: bool): bool = all {
    s.authReady, s.budgetPresent, not(s.marker),
    s' = {marker: success, authorizedRequest: success, authReady: false,
      startupAdmitted: not(success) and s.startupAdmitted, ...s}
  }
  // Compatibility macro for callers observing the whole approval/storage operation.
  action authenticate(ticket: int, accepted: bool, stored: bool): bool =
    if (s.review and ticket == s.authGeneration and s.authGeneration < 4)
      s' = {review: false, confirmed: false, authGeneration: s.authGeneration + 1, authReady: false,
        marker: s.confirmed and accepted and stored, budgetPresent: s.confirmed and accepted and stored,
        authorizedRequest: s.confirmed and accepted and stored,
        startupAdmitted: not(s.confirmed and accepted and stored) and s.startupAdmitted,
        failures: 0, dispatched: false, ...s}
    else s' = s
  action retireActivity = all {
    s.authGeneration < 4,
    s' = {review: false, confirmed: false, authReady: false, authGeneration: s.authGeneration + 1, ...s}
  }
  action listenerAvailability(present: bool): bool = all {
    not(s.dispatched), s' = s.with("listener", if (present) "installed" else "absent")
  }
  action corruptBudget = all {
    s.marker, s.attemptStage == "idle",
    s' = {budgetReadable: false, budgetPresent: true, failures: 3, ...s}
  }
  action loseBudget = all {
    s.marker, s.attemptStage == "idle",
    s' = {budgetReadable: false, budgetPresent: false, failures: 3, ...s}
  }
  // Restored v1 markers remain pending. Missing/corrupt budgets need explicit recovery.
  action loadLegacy(readable: bool, count: int): bool = all {
    not(s.marker), not(s.review), not(s.erased), s.authGeneration == 0, count.in(0.to(3)),
    s' = {marker: true, authorizedRequest: true, startupAdmitted: false,
      budgetReadable: readable, budgetPresent: readable,
      failures: if (readable) count else 3, ...s}
  }
  // One owner holds the process mutex and OS file lock through reservation and effects.
  action beginAttempt(explicit: bool): bool = all {
    s.marker, s.attemptStage == "idle",
    s' = {attemptStage: "reserving", explicitRetry: explicit, listenerRevoked: false, dispatched: false, ...s}
  }
  action reserveAttempt(stored: bool, freshWindow: bool): bool = all {
    s.attemptStage == "reserving",
    val admitted = s.explicitRetry or (s.budgetReadable and (s.failures < 3 or freshWindow))
    s' = if (stored and admitted)
      {attemptStage: "listener", reserved: true, budgetPresent: true, budgetReadable: true,
        failures: if (freshWindow or not(s.budgetReadable) or s.failures == 0) 1 else if (s.failures < 3) s.failures + 1 else 3,
        reservationCount: s.failures, reservationReadable: s.budgetReadable,
        reservationFresh: freshWindow, ...s}
      else {attemptStage: "idle", reserved: false, explicitRetry: false, ...s}
  }
  action listenerResult(acknowledged: bool): bool = all {
    s.attemptStage == "listener", s.reserved,
    val revoked = s.listener == "absent" or acknowledged
    s' = {listenerRevoked: revoked, attemptStage: if (revoked) "android" else "finished", ...s}
  }
  action androidResult(accepted: bool): bool = all {
    s.attemptStage == "android", s.reserved, s.listenerRevoked,
    s' = {dispatched: accepted, clearAccepted: s.clearAccepted or accepted, attemptStage: "finished", ...s}
  }
  action finishAttempt = all {
    s.attemptStage == "finished",
    s' = {attemptStage: "idle", reserved: false, explicitRetry: false, ...s}
  }
  action abandonReservation = all {
    s.attemptStage == "listener", s.reserved,
    s' = {attemptStage: "idle", reserved: false, explicitRetry: false, ...s}
  }
  // Existing composition entry point. The counter advances before either result.
  action attempt(acknowledged: bool, accepted: bool, visible: bool): bool = all {
    s.marker, s.attemptStage == "idle",
    s.explicitRetry or (s.budgetReadable and s.failures < 3),
    val revoked = s.listener == "absent" or acknowledged
    s' = {listenerRevoked: revoked, dispatched: revoked and accepted, clearAccepted: s.clearAccepted or (revoked and accepted),
      failures: if (not(s.budgetReadable) or s.failures == 0) 1 else if (s.failures < 3) s.failures + 1 else 3,
      budgetPresent: true, budgetReadable: true, explicitRetry: false,
      recoveryVisible: visible and not(revoked and accepted), ...s}
  }
  action showRecovery(visible: bool): bool = all {
    s.marker, s' = s.with("recoveryVisible", visible)
  }
  action exitProcess = s' = {processInitialized: false, startupAdmitted: false, ...s}
  action launch(visible: bool): bool = all {
    s.marker,
    s' = {processInitialized: false, startupAdmitted: false, dispatched: false, recoveryVisible: visible, ...s}
  }
  action userRetry = all {
    s.marker, s.attemptStage == "idle",
    s' = s.with("explicitRetry", true)
  }
  action newAutomaticWindow = all {
    s.marker, s.budgetReadable, s.attemptStage == "idle",
    s' = s.with("failures", 0)
  }
  action interrupted = s' = {attemptStage: "idle", reserved: false, explicitRetry: false,
    processInitialized: false, startupAdmitted: false, ...s}
  action observeErased = all {
    s.clearAccepted,
    s' = {marker: false, erased: true, failures: 0, budgetPresent: false,
      recoveryVisible: false, processInitialized: false, startupAdmitted: false,
      attemptStage: "idle", reserved: false, ...s}
  }
  // There is no post-effect counter write for a late callback to recreate.
  action lateFailure = s' = s
  action step = {
    nondet ticket = 0.to(4).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet result = Set(false, true).oneOf()
    nondet visible = Set(false, true).oneOf()
    any { beginReview, confirm(ticket), authenticationResult(ticket, flag), prepareBudget(flag), persistMarker(flag),
      authenticate(ticket, flag, result), retireActivity, listenerAvailability(flag), corruptBudget, loseBudget,
      loadLegacy(flag, ticket % 4), beginAttempt(flag), reserveAttempt(flag, result), listenerResult(flag),
      androidResult(flag), finishAttempt, abandonReservation, attempt(flag, result, visible), showRecovery(flag), exitProcess,
      launch(visible), userRetry, newAutomaticWindow, interrupted, observeErased, lateFailure, s' = s }
  }
  val FreshAuthentication = s.marker implies s.authorizedRequest
  val PendingBlocksInitialization = s.marker implies not(s.startupAdmitted)
  val ListenerBeforeAndroid = s.dispatched implies s.listenerRevoked
  val DispatchIsNotCompletion = s.erased implies s.clearAccepted and not(s.marker)
  val BoundedAutomaticAttempts = s.failures.in(0.to(3))
  val DurableReservationBeforeEffects = s.attemptStage.in(Set("listener", "android", "finished")) implies s.reserved and s.budgetPresent
  val AutomaticReservationAdmitted = s.reserved and not(s.explicitRetry) implies s.reservationReadable and (s.reservationCount < 3 or s.reservationFresh)
  val safety = FreshAuthentication and PendingBlocksInitialization and ListenerBeforeAndroid and
    DispatchIsNotCompletion and BoundedAutomaticAttempts and DurableReservationBeforeEffects and AutomaticReservationAdmitted

  run prepared = init.then(beginReview).then(confirm(1)).then(authenticationResult(1, true))
    .then(prepareBudget(true)).then(persistMarker(true))
  run successfulResetTest = prepared.then(attempt(true, true, true)).then(check(safety and s.marker and not(s.erased)))
    .then(observeErased).then(lateFailure).then(check(safety and s.erased and s.failures == 0))
  run failedListenerRetainsDataTest = prepared.then(attempt(false, true, true))
    .then(check(safety and s.marker and not(s.dispatched) and s.recoveryVisible))
  run staleDeviceCredentialRejectedTest = init.then(beginReview).then(confirm(1)).then(retireActivity)
    .then(authenticationResult(1, true)).then(check(safety and not(s.marker) and not(s.authReady)))
  run boundedLaunchRecoveryTest = prepared.then(attempt(false, false, true)).then(attempt(false, false, true))
    .then(attempt(false, false, true)).then(launch(false)).then(userRetry).then(attempt(true, false, true))
    .then(check(safety and s.failures == 3 and s.listenerRevoked and not(s.erased)))
  run failedPersistenceDoesNotAuthorizeTest = init.then(beginReview).then(confirm(1)).then(authenticationResult(1, true))
    .then(prepareBudget(false)).then(check(safety and not(s.marker)))
  run authorizationPrecedesMarkerTest = init.then(beginReview).then(confirm(1)).then(authenticationResult(1, true))
    .then(check(s.authReady and not(s.marker) and s.processInitialized))
    .then(prepareBudget(true)).then(persistMarker(true)).then(check(safety and s.processInitialized and not(s.startupAdmitted)))
  run failedReservationDispatchesNothingTest = prepared.then(beginAttempt(false)).then(reserveAttempt(false, false))
    .then(check(safety and s.failures == 0 and not(s.reserved or s.dispatched or s.listenerRevoked)))
  run writeAheadReservationSurvivesCrashTest = prepared.then(beginAttempt(false)).then(reserveAttempt(true, false))
    .then(interrupted).then(check(s.failures == 1)).then(beginAttempt(false)).then(reserveAttempt(true, false))
    .then(check(safety and s.failures == 2))
  run missingLegacyBudgetDefersTest = init.then(loadLegacy(false, 0)).then(beginAttempt(false))
    .then(reserveAttempt(true, false)).then(check(safety and not(s.reserved)))
    .then(beginAttempt(true)).then(reserveAttempt(true, false)).then(check(safety and s.reserved and s.failures == 1))
  run explicitRetryPreservesExhaustedBudgetTest = init.then(loadLegacy(true, 3)).then(beginAttempt(true))
    .then(reserveAttempt(true, false)).then(listenerResult(false)).then(finishAttempt)
    .then(check(safety and s.failures == 3)).then(beginAttempt(false)).then(reserveAttempt(true, false))
    .then(check(safety and not(s.reserved)))
  run oneReservationOwnerTest = prepared.then(beginAttempt(false)).then(reserveAttempt(true, false))
    .then(beginAttempt(true).fail())
  run windowResetOccursAtCommitTest = init.then(loadLegacy(true, 3)).then(beginAttempt(false))
    .then(check(s.failures == 3)).then(reserveAttempt(true, true)).then(check(safety and s.failures == 1))
  run erasedRequestCannotRestoreTest = init.then(loadLegacy(true, 0)).then(attempt(true, true, false))
    .then(observeErased).then(loadLegacy(true, 0).fail())
  run acceptedClearMayNeedRetryTest = prepared.then(attempt(true, true, false)).then(launch(false))
    .then(check(s.clearAccepted and not(s.dispatched) and s.marker)).then(attempt(true, false, true))
    .then(check(safety and s.failures == 2 and s.clearAccepted and not(s.erased)))
  run committedReservationFailureConsumesSlotTest = prepared.then(beginAttempt(false)).then(reserveAttempt(true, false))
    .then(abandonReservation).then(check(safety and s.failures == 1 and not(s.reserved or s.listenerRevoked)))
}
