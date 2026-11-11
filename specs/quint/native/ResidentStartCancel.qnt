// AlphaLocalAgentPlugin start, attach, cancelStart, stop, status, credential mutation and shutdown retry.
module ResidentStartCancel {
  // shutdown: "none" is no credential stop request, "unconfirmed" one the service has not
  // acknowledged, "confirmed" an acknowledged one. native is the resident service process.
  type State = {
    epoch: int, accepting: bool, stopping: bool, mutationEpoch: int, retryEpoch: int, shutdown: str,
    startRequest: int, startRequestEpoch: int, startOwnsLaunch: bool,
    cancelledStarts: Set[int], attachedStarts: Set[int],
    native: str, launchedBy: int, launches: int, commits: int, outcome: str,
    foreignStop: bool, launchDuringShutdown: bool, commitWhileRunning: bool, cancelledStartLaunched: bool
  }
  var s: State
  action check(condition: bool): bool = all {assert(condition), s' = s}
  action init = s' = {
    epoch: 0, accepting: true, stopping: false, mutationEpoch: -1, retryEpoch: -1, shutdown: "none",
    startRequest: 0, startRequestEpoch: 0, startOwnsLaunch: false,
    cancelledStarts: Set(), attachedStarts: Set(),
    native: "stopped", launchedBy: 0, launches: 0, commits: 0, outcome: "none",
    foreignStop: false, launchDuringShutdown: false, commitWhileRunning: false, cancelledStartLaunched: false
  }
  pure def rearmAdmitted(state: State): bool =
    state.accepting and not(state.stopping) and state.mutationEpoch < 0 and state.shutdown == "none"
  // A start request enters the strict shutdown recheck instead of starting: a credential stop is
  // unacknowledged, or a stop is latched that no status read has yet seen finished.
  pure def retryRequired(state: State): bool =
    state.shutdown == "unconfirmed" or (state.shutdown == "none" and state.stopping)
  // A new lifecycle generation that launches (or relaunches into) the resident for this request.
  pure def launched(state: State, request: int): State = {
    epoch: state.epoch + 1, shutdown: "none", accepting: true, stopping: false,
    startRequest: request, startRequestEpoch: state.epoch + 1, startOwnsLaunch: state.native == "stopped",
    native: "running", launchedBy: if (state.native == "stopped") request else state.launchedBy,
    launches: if (state.native == "stopped") state.launches + 1 else state.launches,
    launchDuringShutdown: state.launchDuringShutdown or state.mutationEpoch >= 0 or state.shutdown == "unconfirmed",
    cancelledStartLaunched: state.cancelledStartLaunched or state.cancelledStarts.contains(request),
    outcome: "started", ...state
  }
  // start() with nothing to recheck: attach to an admitted running resident or launch.
  action start(request: int, attachable: bool): bool = all {
    request.in(Set(1, 2)), s.epoch < 6, s.launches < 3, not(retryRequired(s)), s.retryEpoch < 0,
    if (s.cancelledStarts.contains(request))
      s' = {cancelledStarts: s.cancelledStarts.exclude(Set(request)), outcome: "cancelled", ...s}
    else if (s.mutationEpoch >= 0) s' = s.with("outcome", "provider-changing")
    else if (s.stopping and s.native != "stopped") s' = s.with("outcome", "stopping")
    else if (attachable and s.native == "running" and s.accepting and not(s.stopping) and s.shutdown == "none")
      s' = {attachedStarts: s.attachedStarts.union(Set(request)), outcome: "attached", ...s}
    else s' = launched(s, request)
  }
  // Only the request that owns the current launch retires it. An attached start retires nothing;
  // an unknown request is remembered so its start is refused when it arrives.
  action cancelStart(request: int): bool = all {
    request.in(Set(1, 2)), s.epoch < 6,
    if (s.attachedStarts.contains(request))
      s' = {attachedStarts: s.attachedStarts.exclude(Set(request)), outcome: "cancel-attached", ...s}
    else if (request == s.startRequest and s.startRequestEpoch == s.epoch)
      s' = {startRequest: 0, startOwnsLaunch: false, epoch: s.epoch + 1,
        accepting: if (s.startOwnsLaunch) false else s.accepting,
        stopping: s.startOwnsLaunch or s.stopping,
        native: if (s.startOwnsLaunch and s.native == "running") "stopping" else s.native,
        foreignStop: s.foreignStop or (s.startOwnsLaunch and s.launchedBy != request),
        outcome: if (s.startOwnsLaunch) "cancel-stopped-launch" else "cancel-retired-request", ...s}
    else s' = {cancelledStarts: s.cancelledStarts.union(Set(request)), outcome: "cancel-remembered", ...s}
  }
  action stop = all {
    s.epoch < 6,
    s' = {startRequest: 0, startOwnsLaunch: false, epoch: s.epoch + 1, accepting: false, stopping: true,
      native: if (s.native == "running") "stopping" else s.native, outcome: "stop", ...s}
  }
  // getStatus: a latched stop is released once the service is seen stopped and no credential stop
  // is unacknowledged. Admission stays closed until the next start.
  action statusPolled = s' = s.with("stopping",
    s.stopping and not(s.native == "stopped" and s.shutdown != "unconfirmed"))
  action nativeStopped = all {
    s.native == "stopping", s' = {native: "stopped", launchedBy: 0, ...s}
  }
  // A credential change that needs the resident down: strict teardown, then commit only after the
  // exact stop request is acknowledged within the deadline.
  action beginMutation = all {
    s.epoch < 6, s.mutationEpoch < 0,
    s' = {startRequest: 0, startOwnsLaunch: false, epoch: s.epoch + 1, mutationEpoch: s.epoch + 1,
      accepting: false, stopping: true, shutdown: "unconfirmed",
      native: if (s.native == "running") "stopping" else s.native, outcome: "mutation-began", ...s}
  }
  action acknowledgeShutdown = all {
    s.shutdown == "unconfirmed", s.native == "stopped", s' = s.with("shutdown", "confirmed")
  }
  action finishMutation(deadlinePassed: bool): bool = all {
    s.mutationEpoch >= 0,
    if (s.mutationEpoch != s.epoch) s' = {mutationEpoch: -1, outcome: "mutation-superseded", ...s}
    else if (s.shutdown == "confirmed")
      s' = {mutationEpoch: -1, commits: s.commits + 1,
        commitWhileRunning: s.commitWhileRunning or s.native != "stopped", outcome: "committed", ...s}
    else all {deadlinePassed, s' = {mutationEpoch: -1, outcome: "shutdown-unconfirmed", ...s}}
  }
  // A start request while a shutdown needs rechecking reissues a strict stop before any start.
  action retryShutdown(request: int, focused: bool): bool = all {
    request.in(Set(1, 2)), s.epoch < 6, retryRequired(s),
    if (s.retryEpoch >= 0 or s.mutationEpoch >= 0) s' = s.with("outcome", "retry-busy")
    else if (not(focused)) s' = s.with("outcome", "retry-needs-focus")
    else if (s.cancelledStarts.contains(request))
      s' = {cancelledStarts: s.cancelledStarts.exclude(Set(request)), outcome: "cancelled", ...s}
    else s' = {epoch: s.epoch + 1, retryEpoch: s.epoch + 1, accepting: false, stopping: true,
      shutdown: "unconfirmed", startRequest: request, startRequestEpoch: s.epoch + 1, startOwnsLaunch: false,
      native: if (s.native == "running") "stopping" else s.native, outcome: "retrying", ...s}
  }
  // The retry's wait ends. It continues into start only at its own epoch, with focus, the
  // reissued stop acknowledged and the service gone.
  action finishRetry(focused: bool): bool = all {
    s.retryEpoch >= 0, s.epoch < 6, s.launches < 3,
    if (s.retryEpoch != s.epoch or s.mutationEpoch >= 0 or not(focused) or s.native != "stopped" or
        s.shutdown != "confirmed")
      s' = {retryEpoch: -1, outcome: "retry-unconfirmed", ...s}
    else s' = launched({retryEpoch: -1, shutdown: "none", stopping: false, accepting: true, ...s}, s.startRequest)
  }
  // Boot, update and time broadcasts start the resident only while no surface is stopping or changing it.
  action rearm = all {
    rearmAdmitted(s), s.launches < 3,
    s' = {native: "running", launches: if (s.native == "stopped") s.launches + 1 else s.launches,
      launchedBy: if (s.native == "stopped") 0 else s.launchedBy, outcome: "rearmed", ...s}
  }
  action step = {
    nondet request = Set(1, 2).oneOf()
    nondet flag = Set(false, true).oneOf()
    any {start(request, flag), cancelStart(request), stop, statusPolled, nativeStopped, beginMutation,
      acknowledgeShutdown, finishMutation(flag), retryShutdown(request, flag), finishRetry(flag),
      rearm, s' = s}
  }
  // The same machine without a credential mutation.
  action lifecycleStep = {
    nondet request = Set(1, 2).oneOf()
    nondet flag = Set(false, true).oneOf()
    any {start(request, flag), cancelStart(request), stop, statusPolled, nativeStopped,
      acknowledgeShutdown, retryShutdown(request, flag), finishRetry(flag), rearm, s' = s}
  }
  val TypeOK = s.epoch.in(0.to(6)) and s.launches.in(0.to(3)) and
    s.native.in(Set("stopped", "running", "stopping")) and s.shutdown.in(Set("none", "unconfirmed", "confirmed"))
  val CancelRetiresOnlyItsOwnLaunch = not(s.foreignStop)
  val NoLaunchDuringCredentialShutdown = not(s.launchDuringShutdown)
  val CommitNeedsConfirmedStop = not(s.commitWhileRunning)
  val CancelledStartNeverLaunches = not(s.cancelledStartLaunched)
  val MutationClosesAdmission = s.mutationEpoch >= 0 implies not(s.accepting) and s.shutdown != "none"
  // A current recheck keeps admission closed. Its stop latch is released only by a status read
  // that saw the service gone with the reissued stop acknowledged.
  val RetryHoldsLifecycle = s.retryEpoch >= 0 and s.retryEpoch == s.epoch implies
    not(s.accepting) and (s.stopping or (s.native == "stopped" and s.shutdown == "confirmed"))
  val OwnedLaunchIsCurrent = s.startOwnsLaunch implies s.startRequest != 0 and s.launchedBy == s.startRequest
  val safety = TypeOK and CancelRetiresOnlyItsOwnLaunch and NoLaunchDuringCredentialShutdown and
    CommitNeedsConfirmedStop and CancelledStartNeverLaunches and MutationClosesAdmission and
    RetryHoldsLifecycle and OwnedLaunchIsCurrent

  val AttachedWitness = s.outcome == "attached"
  val RememberedCancellationWitness = s.cancelledStarts.size() > 0 and s.native == "stopped"
  val OwnedLaunchStoppedWitness = s.outcome == "cancel-stopped-launch"
  val RetryInProgressWitness = s.retryEpoch >= 0 and s.retryEpoch == s.epoch
  val CommittedWitness = s.commits > 0
  // A start right after an ordinary stop is in the strict recheck, with no credential change.
  val RecheckAfterOrdinaryStopWitness = s.retryEpoch == s.epoch and s.commits == 0 and
    s.outcome == "retrying" and s.launches > 0
  val StatusReleasedStopWitness = not(s.stopping) and not(s.accepting) and s.native == "stopped" and s.launches > 0

  // The cancellation overtakes its start on the bridge: the start is refused when it arrives.
  run cancelBeforeStartRefusesItTest = init.then(cancelStart(1))
    .then(check(s.cancelledStarts == Set(1) and s.native == "stopped"))
    .then(start(1, false)).then(check(safety and s.outcome == "cancelled" and s.launches == 0))
    .then(start(1, false)).then(check(safety and s.native == "running" and s.launches == 1))
  run cancelStopsOnlyTheLaunchItOwnsTest = init.then(start(1, false))
    .then(check(s.startOwnsLaunch)).then(cancelStart(1))
    .then(check(safety and s.native == "stopping" and s.stopping and not(s.accepting)))
    .then(nativeStopped).then(statusPolled).then(check(not(s.stopping) and not(s.accepting)))
    .then(start(2, false)).then(check(safety and s.launches == 2))
  // A second surface attached to the running resident: cancelling its start stops nothing.
  run cancelOfAttachedStartKeepsResidentTest = init.then(start(1, false)).then(start(2, true))
    .then(check(s.outcome == "attached" and s.epoch == 1)).then(cancelStart(2))
    .then(check(safety and s.native == "running" and s.epoch == 1 and s.startRequest == 1))
  run restartOfRunningResidentOwnsNoLaunchTest = init.then(rearm).then(start(1, false))
    .then(check(not(s.startOwnsLaunch) and s.launches == 1)).then(cancelStart(1))
    .then(check(safety and s.native == "running" and s.outcome == "cancel-retired-request"))
  run credentialChangeCommitsAfterConfirmedStopTest = init.then(start(1, false)).then(beginMutation)
    .then(retryShutdown(2, true)).then(check(s.outcome == "retry-busy" and s.native == "stopping"))
    .then(finishMutation(true)).then(check(safety and s.commits == 0 and s.outcome == "shutdown-unconfirmed"))
    .then(beginMutation).then(nativeStopped).then(acknowledgeShutdown).then(finishMutation(false))
    .then(check(safety and s.commits == 1)).then(start(2, false))
    .then(check(safety and s.native == "running" and s.shutdown == "none"))
  run unconfirmedShutdownNeedsRetryTest = init.then(start(1, false)).then(beginMutation)
    .then(finishMutation(true)).then(retryShutdown(2, false))
    .then(check(s.outcome == "retry-needs-focus" and s.retryEpoch < 0)).then(retryShutdown(2, true))
    .then(check(safety and s.retryEpoch == s.epoch)).then(nativeStopped).then(acknowledgeShutdown)
    .then(finishRetry(true))
    .then(check(safety and s.native == "running" and s.launchedBy == 2 and s.shutdown == "none"))
  // Cancellation between the acknowledged stop and the continued start retires the continuation.
  run cancelDuringShutdownRetryPreventsStartTest = init.then(start(1, false)).then(beginMutation)
    .then(finishMutation(true)).then(retryShutdown(2, true)).then(nativeStopped).then(cancelStart(2))
    .then(finishRetry(true))
    .then(check(safety and s.native == "stopped" and s.outcome == "retry-unconfirmed" and s.launches == 1))
  run rearmWaitsForExplicitStartAfterStopTest = init.then(rearm).then(stop).then(nativeStopped)
    .then(check(safety and not(rearmAdmitted(s)))).then(statusPolled)
    .then(check(safety and not(rearmAdmitted(s)))).then(start(1, false))
    .then(check(safety and rearmAdmitted(s) and s.launches == 2))
  // A start that arrives before any status read has seen the stop finish takes the strict recheck:
  // it needs focus, reissues the stop and launches only after that stop is acknowledged.
  run startBeforeStatusRechecksShutdownTest = init.then(start(1, false)).then(stop)
    .then(retryShutdown(2, false)).then(check(s.outcome == "retry-needs-focus" and s.shutdown == "none"))
    .then(retryShutdown(2, true))
    .then(check(safety and RecheckAfterOrdinaryStopWitness and s.shutdown == "unconfirmed"))
    .then(nativeStopped).then(finishRetry(true))
    .then(check(safety and s.outcome == "retry-unconfirmed" and s.native == "stopped"))
    .then(acknowledgeShutdown).then(start(2, false))
    .then(check(safety and s.native == "running" and s.launchedBy == 2 and s.shutdown == "none"))
}
