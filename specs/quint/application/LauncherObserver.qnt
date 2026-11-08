// Package, visibility and resume notifications for the shared launcher.
module LauncherObserver {
  type State = {active: bool, hidden: bool, scheduled: bool, subscription: str,
    removal: str, removals: int, refreshes: int}
  var s: State
  action initWith(subscription: str): bool = all {Set("none", "pending", "failed").contains(subscription),
    s' = {active: true, hidden: false, scheduled: false, subscription: subscription,
      removal: "none", removals: 0, refreshes: 0}}
  action init = initWith("pending")
  pure def remove(value: State): State = {...value, removal: "pending", removals: value.removals + 1}
  action subscriptionReply(ok: bool): bool = all {s.subscription == "pending",
    val settled = {...s, subscription: if (ok) "installed" else "failed"}
    s' = if (ok and not(s.active)) remove(settled) else settled}
  action packageChanged = all {Set("pending", "installed").contains(s.subscription),
    s' = {...s, scheduled: s.scheduled or s.active}}
  action resume = s' = {...s, scheduled: s.scheduled or s.active}
  action visibility(hidden: bool): bool = s' = {...s, hidden: hidden, scheduled: s.scheduled or (s.active and not(hidden))}
  action timer = all {s.active, s.scheduled, s.refreshes < 4,
    s' = {...s, scheduled: false, refreshes: s.refreshes + 1}}
  action stop = {
    val retired = {...s, active: false, scheduled: false}
    s' = if (s.active and s.subscription == "installed") remove(retired) else retired
  }
  action removalReply(ok: bool): bool = all {s.removal == "pending",
    s' = {...s, removal: if (ok) "done" else "failed"}}
  action step = any {
    {nondet ok = Bool.oneOf(); subscriptionReply(ok)},
    {nondet hidden = Bool.oneOf(); visibility(hidden)},
    {nondet ok = Bool.oneOf(); removalReply(ok)},
    packageChanged, resume, timer, stop, s' = s,
  }
  val TypeOK = s.subscription.in(Set("none", "pending", "installed", "failed"))
    and s.removal.in(Set("none", "pending", "done", "failed")) and s.refreshes.in(0.to(4))
  val OwnsDebounce = s.scheduled implies s.active
  val RemovesOnce = s.removals.in(0.to(1)) and (s.removal != "none" implies not(s.active) and s.subscription == "installed")
  val safety = TypeOK and OwnsDebounce and RemovesOnce
  run repeatedSignalsShareTimerTest = init.then(subscriptionReply(true)).then(packageChanged)
    .then(resume).then(visibility(false)).then(timer).expect(s.refreshes == 1 and not(s.scheduled) and safety)
  run stopBeforeSubscriptionReplyRemovesOnceTest = init.then(stop).then(stop).then(subscriptionReply(true))
    .then(removalReply(true)).expect(s.removals == 1 and s.removal == "done" and safety)
  run stopDisarmsTimerTest = init.then(subscriptionReply(true)).then(packageChanged).then(stop)
    .then(packageChanged).then(resume).expect(not(s.scheduled) and s.refreshes == 0 and safety)
  run failedRemovalRetiresObserverTest = init.then(subscriptionReply(true)).then(stop).then(removalReply(false))
    .then(stop).then(packageChanged).expect(s.removals == 1 and s.removal == "failed" and not(s.scheduled) and safety)
}
