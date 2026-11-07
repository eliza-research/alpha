// ResetAuthorization and AlphaDataReset fail-closed admission and recovery.
module ResetRecovery {
  type State = {
    review: bool, confirmed: bool, authGeneration: int, marker: bool,
    processInitialized: bool, listener: str, listenerRevoked: bool,
    failures: int, budgetReadable: bool, recoveryVisible: bool,
    dispatched: bool, erased: bool, authorizedRequest: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    review: false, confirmed: false, authGeneration: 0, marker: false,
    processInitialized: true, listener: "installed", listenerRevoked: false,
    failures: 0, budgetReadable: true, recoveryVisible: false,
    dispatched: false, erased: false, authorizedRequest: false
  }
  action beginReview = all {
    not(s.review), not(s.marker), s.processInitialized, s.authGeneration < 4,
    s' = {review: true, confirmed: false, authGeneration: s.authGeneration + 1, ...s}
  }
  action confirm(ticket: int): bool =
    if (s.review and ticket == s.authGeneration)
      s' = s.with("confirmed", true)
    else s' = s
  // Both review and fresh device credential approval must belong to this activity generation.
  action authenticate(ticket: int, accepted: bool, storageWorks: bool): bool =
    if (s.review and ticket == s.authGeneration and s.authGeneration < 4)
      s' = {review: false, confirmed: false, authGeneration: s.authGeneration + 1,
        marker: s.confirmed and accepted and storageWorks,
        processInitialized: not(s.confirmed and accepted and storageWorks),
        authorizedRequest: s.confirmed and accepted and storageWorks,
        failures: 0, dispatched: false, ...s}
    else s' = s
  action retireActivity = all {
    s.authGeneration < 4,
    s' = {review: false, confirmed: false, authGeneration: s.authGeneration + 1, ...s}
  }
  action listenerAvailability(present: bool): bool = all {
    not(s.dispatched), s' = s.with("listener", if (present) "installed" else "absent")
  }
  action corruptBudget = all {
    s.marker, s' = s.with("budgetReadable", false)
  }
  action attempt(listenerAcknowledged: bool, androidAccepted: bool, userVisible: bool): bool = all {
    s.marker, not(s.dispatched), s.budgetReadable, s.failures < 3,
    s' = {
      listenerRevoked: s.listener == "absent" or listenerAcknowledged,
      dispatched: (s.listener == "absent" or listenerAcknowledged) and androidAccepted,
      failures: if ((s.listener == "absent" or listenerAcknowledged) and androidAccepted) s.failures else s.failures + 1,
      processInitialized: false,
      recoveryVisible: userVisible and not((s.listener == "absent" or listenerAcknowledged) and androidAccepted), ...s
    }
  }
  action launch(userVisible: bool): bool = all {
    s.marker,
    s' = {processInitialized: false, recoveryVisible: userVisible, ...s}
  }
  action userRetry = all {
    s.marker, not(s.dispatched),
    s' = {failures: 0, budgetReadable: true, recoveryVisible: true, ...s}
  }
  action newAutomaticWindow = all {
    s.marker, s.budgetReadable, not(s.dispatched), s' = s.with("failures", 0)
  }
  // External observation of Android's package clear, not merely a returned dispatch call.
  action observeErased = all {
    s.dispatched, s.listenerRevoked,
    s' = {marker: false, erased: true, failures: 0, recoveryVisible: false,
      processInitialized: false, ...s}
  }
  action lateFailure =
    if (s.marker and s.failures < 3) s' = s.with("failures", s.failures + 1)
    else s' = s
  action step = {
    nondet ticket = Set(0, 1, 2, 3, 4).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet result = Set(false, true).oneOf()
    nondet visible = Set(false, true).oneOf()
    any { beginReview, confirm(ticket), authenticate(ticket, flag, result),
      retireActivity, listenerAvailability(flag), corruptBudget,
      attempt(flag, result, visible), launch(visible), userRetry,
      newAutomaticWindow, observeErased, lateFailure, s' = s }
  }
  val FreshAuthentication = s.marker implies s.authorizedRequest
  val PendingBlocksInitialization = s.marker implies not(s.processInitialized)
  val ListenerBeforeAndroid = s.dispatched implies s.listenerRevoked
  val DispatchIsNotCompletion = s.erased implies s.dispatched and not(s.marker)
  val BoundedAutomaticAttempts = s.failures.in(0.to(3))
  val safety = FreshAuthentication and PendingBlocksInitialization and ListenerBeforeAndroid and
    DispatchIsNotCompletion and BoundedAutomaticAttempts

  run successfulResetTest = init.then(beginReview).then(confirm(1))
    .then(authenticate(1, true, true)).then(attempt(true, true, true))
    .then(check(safety and s.marker and not(s.erased)))
    .then(observeErased).then(lateFailure).then(check(safety and s.erased and s.failures == 0))
  run failedListenerRetainsDataTest = init.then(beginReview).then(confirm(1))
    .then(authenticate(1, true, true)).then(attempt(false, true, true))
    .then(check(safety and s.marker and not(s.dispatched) and s.recoveryVisible))
  run staleDeviceCredentialRejectedTest = init.then(beginReview).then(confirm(1))
    .then(retireActivity).then(authenticate(1, true, true))
    .then(check(safety and not(s.marker)))
  run boundedLaunchRecoveryTest = init.then(beginReview).then(confirm(1))
    .then(authenticate(1, true, true)).then(attempt(false, false, true))
    .then(attempt(false, false, true)).then(attempt(false, false, true))
    .then(launch(false)).then(check(safety and s.failures == 3 and not(s.recoveryVisible)))
    .then(userRetry).then(attempt(true, false, true))
    .then(check(safety and s.failures == 1 and s.listenerRevoked and not(s.erased)))
  run failedPersistenceDoesNotAuthorizeTest = init.then(beginReview).then(confirm(1))
    .then(authenticate(1, true, false)).then(check(safety and not(s.marker)))
}
