// ResidentScheduleRearm admission and lifecycle-lock serialization.
module ResidentScheduling {
  type State = {
    unlocked: bool, packaged: bool, enabled: bool, lifecycle: str,
    running: bool, epoch: int, starts: int, lastDecision: str,
    lastStartAdmitted: bool, replayedOccurrences: int
  }
  var s: State
  action check(condition: bool): bool = all {assert(condition), s' = s}
  pure def decision(event: str, state: State): str =
    if (not(event.in(Set("boot", "update", "time", "zone")))) "IGNORE"
    else if (not(state.unlocked)) "LOCKED"
    else if (not(state.packaged)) "NOT_PACKAGED"
    else if (not(state.enabled)) "NOT_ENABLED"
    else if (state.lifecycle != "idle") "LIFECYCLE_BUSY"
    else "START"
  action init = s' = {
    unlocked: true, packaged: true, enabled: true, lifecycle: "idle",
    running: false, epoch: 0, starts: 0, lastDecision: "IGNORE",
    lastStartAdmitted: false, replayedOccurrences: 0
  }
  // The decision and start share one critical section. No delayed start token exists.
  action broadcast(event: str): bool = all {
    event.in(Set("boot", "update", "time", "zone", "other")),
    s.starts < 3 or s.running or decision(event, s) != "START",
    s' = {lastDecision: decision(event, s),
      running: s.running or decision(event, s) == "START",
      starts: if (decision(event, s) == "START" and not(s.running)) s.starts + 1 else s.starts,
      lastStartAdmitted: if (decision(event, s) == "START")
        s.unlocked and s.packaged and s.enabled and s.lifecycle == "idle"
        else s.lastStartAdmitted, ...s}
  }
  action beginLifecycle(operation: str): bool = all {
    s.lifecycle == "idle", operation.in(Set("stopping", "provider-change")), s.epoch < 3,
    s' = {lifecycle: operation, epoch: s.epoch + 1, running: false, ...s}
  }
  action finishLifecycle = all {
    s.lifecycle != "idle", s' = s.with("lifecycle", "idle")
  }
  action ownerEnabled(value: bool): bool =
    s' = {enabled: value, running: s.running and value, ...s}
  action packagePresent(value: bool): bool =
    s' = {packaged: value, running: s.running and value, ...s}
  action boot = s' = {unlocked: false, running: false, lifecycle: "idle", ...s}
  action unlock = s' = s.with("unlocked", true)
  // Process-local Stop is not a permanent opt-out. A later broadcast may rearm.
  action processDeath = s' = {running: false, lifecycle: "idle", ...s}
  action step = {
    nondet event = Set("boot", "update", "time", "zone", "other").oneOf()
    nondet operation = Set("stopping", "provider-change").oneOf()
    nondet flag = Set(false, true).oneOf()
    any {broadcast(event), beginLifecycle(operation), finishLifecycle,
      ownerEnabled(flag), packagePresent(flag), boot, unlock, processDeath, s' = s}
  }
  val NoStartDuringLifecycle = s.running implies s.lifecycle == "idle"
  val ActiveResidentAdmitted = s.running implies s.unlocked and s.enabled and s.packaged and s.lastStartAdmitted
  val NoOccurrenceReplay = s.replayedOccurrences == 0
  val BoundedStarts = s.starts.in(0.to(3)) and s.epoch.in(0.to(3))
  val safety = NoStartDuringLifecycle and ActiveResidentAdmitted and NoOccurrenceReplay and BoundedStarts

  run allRearmBroadcastsTest = init.then(broadcast("boot")).then(broadcast("update"))
    .then(broadcast("time")).then(broadcast("zone"))
    .then(check(safety and s.running and s.starts == 1))
  run lockedBootWaitsForUnlockTest = init.then(boot).then(broadcast("boot"))
    .then(check(s.lastDecision == "LOCKED" and not(s.running)))
    .then(unlock).then(broadcast("time")).then(check(safety and s.starts == 1))
  run providerMutationWinsBeforeBroadcastTest = init.then(beginLifecycle("provider-change"))
    .then(broadcast("zone")).then(check(safety and s.lastDecision == "LIFECYCLE_BUSY" and s.starts == 0))
    .then(finishLifecycle).then(broadcast("zone")).then(check(safety and s.starts == 1))
  run broadcastBeforeStopIsRetiredTest = init.then(broadcast("time"))
    .then(beginLifecycle("stopping")).then(broadcast("time"))
    .then(check(safety and not(s.running) and s.starts == 1))
  run processDeathCanRearmTest = init.then(broadcast("time")).then(processDeath)
    .then(broadcast("update")).then(check(safety and s.running and s.starts == 2))
  run unavailableBuildAndOwnerTest = init.then(packagePresent(false)).then(broadcast("time"))
    .then(check(s.lastDecision == "NOT_PACKAGED" and s.starts == 0))
    .then(packagePresent(true)).then(ownerEnabled(false)).then(broadcast("time"))
    .then(check(safety and s.lastDecision == "NOT_ENABLED" and s.starts == 0))
  run unrelatedBroadcastDoesNotStartTest = init.then(broadcast("other"))
    .then(check(safety and s.lastDecision == "IGNORE" and s.starts == 0))
  run splitAdmissionCanaryTest = init.then(beginLifecycle("provider-change"))
    .then(s' = s.with("running", true)).then(check(not(NoStartDuringLifecycle)))
}
