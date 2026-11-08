// RendererRecoveryBudget and the MainActivity callback/recreation boundary.
module RendererRecovery {
  type Recovery = {
    started: bool, windowStart: int, losses: int, home: bool,
    decision: str, delay: int, recovering: bool, rendererAlive: bool,
    escape: bool, finishing: bool, destroyed: bool, activity: int,
    pendingActivity: int, pending: bool, remaining: int, handled: bool,
    availableSettings: Set[str], externalTarget: str, operation: str, lossTime: int,
    bridgeAvailable: bool, recreateRequested: bool,
    unackedFrontStarts: int, handoffUnreliable: bool, task: int, taskHomes: int -> bool
  }
  var s: Recovery
  action check(condition: bool): bool = all {assert(condition), s' = s}
  pure def choice(available: Set[str]): str =
    if (available.contains("home-settings")) "home-settings"
    else if (available.contains("default-apps")) "default-apps"
    else if (available.contains("settings")) "settings" else "none"
  pure val initial: Recovery = {
    started: false, windowStart: 0, losses: 0, home: false,
    decision: "none", delay: 0, recovering: false, rendererAlive: true,
    escape: false, finishing: false, destroyed: false, activity: 0,
    pendingActivity: -1, pending: false, remaining: 0, handled: false,
    availableSettings: Set("home-settings", "default-apps", "settings"),
    externalTarget: "none", operation: "init", lossTime: 0,
    bridgeAvailable: true, recreateRequested: false,
    unackedFrontStarts: 0, handoffUnreliable: false, task: 0, taskHomes: Map()
  }
  action init = s' = initial
  // Stronger finite proof entry. Every saturated budget count is reachable by prior losses.
  action budgetInit = {
    nondet losses = 0.to(4).oneOf()
    nondet window = Set(0, 1, 60000).oneOf()
    nondet home = Set(false, true).oneOf()
    s' = {started: losses > 0, losses: losses, windowStart: window, home: home,
      decision: if (losses == 0) "none" else if (losses <= 3) "RECREATE_NOW"
        else if (home) "SHOW_ESCAPE" else "RECREATE_AFTER_BACKOFF",
      delay: if (losses == 4 and not(home)) 5000 else 0, ...initial}
  }
  action setHome(home: bool): bool = s' = {home: home, operation: "context", ...s}
  /// Android/Capacitor has constructed this instance and reported whether its bridge exists.
  action activityReady(home: bool, bridge: bool): bool = all {
    s.operation == "init",
    s' = {home: home, bridgeAvailable: bridge, rendererAlive: bridge,
      taskHomes: s.taskHomes.put(0, home), operation: "created", ...s}
  }
  action untrackedActivityReady(bridge: bool): bool = all {
    s.operation == "init",
    s' = {home: false, bridgeAvailable: bridge, rendererAlive: bridge, operation: "created", ...s}
  }
  action rendererGone(time: int, matchingWebView: bool): bool = all {
    time >= 0,
    if (not(matchingWebView) or not(s.bridgeAvailable)) s' = {handled: false, operation: "ignored", ...s}
    else if (s.recovering) s' = {handled: true, operation: "duplicate", ...s}
    else {
      val resetWindow = not(s.started) or time - s.windowStart > 60000 or time < s.windowStart
      val losses = if (resetWindow) 1 else if (s.losses < 4) s.losses + 1 else 4
      val decision = if (losses <= 3) "RECREATE_NOW"
        else if (s.home) "SHOW_ESCAPE" else "RECREATE_AFTER_BACKOFF"
      s' = {started: true, windowStart: if (resetWindow) time else s.windowStart,
        losses: losses, decision: decision, delay: if (decision == "RECREATE_AFTER_BACKOFF") 5000 else 0,
        recovering: true, rendererAlive: false, escape: decision == "SHOW_ESCAPE",
        pending: decision != "SHOW_ESCAPE", pendingActivity: s.activity,
        remaining: if (decision == "RECREATE_AFTER_BACKOFF") 5000 else 0,
        handled: true, operation: "loss", lossTime: time, ...s}
    }
  }
  action delayElapsed = all {
    s.pending, s' = {remaining: 0, operation: "delay", ...s}
  }
  /// The posted Runnable requests recreation; Android destruction and creation occur later.
  action dispatchRecreation(activity: int): bool =
    if (s.pending and s.pendingActivity == activity and activity == s.activity and s.remaining == 0)
      s' = {pending: false, recreateRequested: not(s.finishing or s.destroyed),
        operation: "recreate-request", ...s}
    else s' = {operation: "stale-callback", ...s}
  action destroyActivity(finishing: bool): bool = s' = {
    finishing: finishing, destroyed: true, rendererAlive: false,
    taskHomes: if (finishing) s.taskHomes.keys().exclude(Set(s.task)).mapBy(key => s.taskHomes.get(key))
      else s.taskHomes, operation: "destroyed", ...s
  }
  action recreationCompleted(bridge: bool): bool = all {
    s.destroyed, s.activity < 6,
    s' = {activity: s.activity + 1, recovering: false, rendererAlive: bridge,
      bridgeAvailable: bridge, escape: false, pending: false, remaining: 0,
      recreateRequested: false, finishing: false, destroyed: false, operation: "created", ...s}
  }
  action requestReload = all {
    s.escape, not(s.finishing or s.destroyed),
    s' = {recreateRequested: true, operation: "reload-request", ...s}
  }
  action recreateCallback(activity: int): bool =
    if (s.pending and s.pendingActivity == activity and activity == s.activity and s.remaining == 0)
      if (s.finishing or s.destroyed)
        s' = {pending: false, operation: "retired-callback", ...s}
      else all {
        s.activity < 6,
        s' = {activity: s.activity + 1, recovering: false, rendererAlive: true,
          bridgeAvailable: true, recreateRequested: false,
          escape: false, pending: false, operation: "recreate", ...s}
      }
    else s' = {operation: "stale-callback", ...s}
  action closeActivity = s' = {finishing: true, destroyed: true, operation: "close", ...s}
  action reload = all {
    s.escape, not(s.finishing or s.destroyed), s.activity < 6,
    s' = {activity: s.activity + 1, recovering: false, rendererAlive: true,
      bridgeAvailable: true, recreateRequested: false,
      escape: false, pending: false, operation: "reload", ...s}
  }
  action configureSettings(available: Set[str]): bool = all {
    available.subseteq(Set("home-settings", "default-apps", "settings")),
    s' = {availableSettings: available, operation: "resolve", ...s}
  }
  /// A secondary launcher instance never loads a bridge while it can hand off to the page owner.
  action handoff(frontMarker: bool, sameTask: bool, started: bool): bool = all {
    not(s.handoffUnreliable) or frontMarker,
    val count = if (frontMarker or sameTask or not(started)) s.unackedFrontStarts
      else s.unackedFrontStarts + 1
    s' = {unackedFrontStarts: count,
      handoffUnreliable: s.handoffUnreliable or frontMarker or
        (not(sameTask) and (not(started) or count >= 3)), operation: "handoff", ...s}
  }
  action resumeOwner = s' = {unackedFrontStarts: 0, operation: "resume", ...s}
  action acknowledgeFront = s' = {unackedFrontStarts: 0, operation: "front-ack", ...s}
  action independentPageCreated(home: bool, bridge: bool): bool = all {
    s.handoffUnreliable, s.activity < 6, not(s.taskHomes.keys().contains(1)),
    s' = {activity: s.activity + 1, home: home, recovering: false, rendererAlive: bridge,
      bridgeAvailable: bridge, escape: false, pending: false, remaining: 0,
      task: 1, taskHomes: s.taskHomes.put(1, home),
      recreateRequested: false, finishing: false, destroyed: false, operation: "new-page", ...s}
  }
  action restoreKnownTask(task: int, bridge: bool): bool = all {
    s.taskHomes.keys().contains(task), s.activity < 6,
    s' = {activity: s.activity + 1, home: s.taskHomes.get(task), task: task,
      recovering: false, rendererAlive: bridge, bridgeAvailable: bridge, escape: false,
      pending: false, remaining: 0, recreateRequested: false, finishing: false, destroyed: false,
      operation: "task-restored", ...s}
  }
  action newTaskActivity(task: int, home: bool, bridge: bool): bool = all {
    task.in(Set(0, 1)), not(s.taskHomes.keys().contains(task)), s.activity < 6,
    s' = {activity: s.activity + 1, home: home, task: task, taskHomes: s.taskHomes.put(task, home),
      recovering: false, rendererAlive: bridge, bridgeAvailable: bridge, escape: false,
      pending: false, remaining: 0, recreateRequested: false, finishing: false, destroyed: false,
      operation: "new-task", ...s}
  }
  action chooseHomeSettings(success: bool): bool = all {
    s.escape, choice(s.availableSettings) != "none",
    s' = {externalTarget: if (success) choice(s.availableSettings) else "none", operation: "external", ...s}
  }
  action chooseSettings(success: bool): bool = all {
    s.escape, s.availableSettings.contains("settings"),
    s' = {externalTarget: if (success) "settings" else "none", operation: "external", ...s}
  }
  action step = {
    nondet time = Set(0, 1, 59999, 60000, 60001, 120002).oneOf()
    nondet flag = Set(false, true).oneOf()
    nondet activity = 0.to(6).oneOf()
    nondet task = Set(0, 1).oneOf()
    nondet available = Set("home-settings", "default-apps", "settings").powerset().oneOf()
    any {activityReady(flag, flag), untrackedActivityReady(flag), setHome(flag), rendererGone(time, flag), delayElapsed, recreateCallback(activity),
      dispatchRecreation(activity), destroyActivity(flag), recreationCompleted(flag), requestReload,
      handoff(flag, flag, flag), resumeOwner, acknowledgeFront, independentPageCreated(flag, flag),
      restoreKnownTask(task, flag), newTaskActivity(task, flag, flag),
      closeActivity, reload, configureSettings(available), chooseHomeSettings(flag),
      chooseSettings(flag), s' = s}
  }
  val TypeOK = s.losses.in(0.to(4)) and s.activity.in(0.to(6)) and s.remaining.in(Set(0, 5000))
  val BudgetDecision = s.decision == "none" or
    (s.losses <= 3 and s.decision == "RECREATE_NOW") or
    (s.losses == 4 and s.decision.in(Set("SHOW_ESCAPE", "RECREATE_AFTER_BACKOFF")))
  val DelayMatchesDecision = s.delay == (if (s.decision == "RECREATE_AFTER_BACKOFF") 5000 else 0)
  val EscapeRequiresBudget = s.escape implies s.recovering and not(s.rendererAlive or s.pending) and s.losses == 4 and s.decision == "SHOW_ESCAPE"
  val PendingOwnedByActivity = s.pending implies s.recovering and not(s.rendererAlive) and s.pendingActivity == s.activity
  val StockSettingsOnly = s.externalTarget.in(Set("none", "home-settings", "default-apps", "settings"))
  val HandoffBounded = s.unackedFrontStarts.in(0.to(3))
  val NoLiveViewWithoutBridge = s.rendererAlive implies s.bridgeAvailable
  val TaskKindsBounded = s.task.in(Set(0, 1)) and s.taskHomes.keys().subseteq(Set(0, 1))
  val safety = TypeOK and BudgetDecision and DelayMatchesDecision and EscapeRequiresBudget and PendingOwnedByActivity and StockSettingsOnly and HandoffBounded and NoLiveViewWithoutBridge and TaskKindsBounded

  run threeImmediateThenBackoffTest = init.then(rendererGone(0, true)).then(recreateCallback(0))
    .then(rendererGone(1, true)).then(recreateCallback(1)).then(rendererGone(1, true)).then(recreateCallback(2))
    .then(rendererGone(1, true)).then(check(safety and s.losses == 4 and s.remaining == 5000))
    .then(recreateCallback(3)).then(check(not(s.rendererAlive)))
    .then(delayElapsed).then(recreateCallback(3)).then(check(safety and s.rendererAlive))
  run homeEscapeAndExplicitReloadTest = init.then(setHome(true)).then(rendererGone(0, true)).then(recreateCallback(0))
    .then(rendererGone(1, true)).then(recreateCallback(1)).then(rendererGone(1, true)).then(recreateCallback(2))
    .then(rendererGone(1, true)).then(check(safety and s.escape and not(s.pending)))
    .then(reload).then(rendererGone(1, true)).then(check(safety and s.escape))
  run exactWindowBoundaryTest = init.then(rendererGone(0, true)).then(recreateCallback(0))
    .then(rendererGone(60000, true)).then(check(s.losses == 2 and s.windowStart == 0))
    .then(recreateCallback(1)).then(rendererGone(60001, true)).then(check(safety and s.losses == 1 and s.windowStart == 60001))
  run backwardsClockStartsNewWindowTest = init.then(rendererGone(60000, true)).then(recreateCallback(0))
    .then(rendererGone(0, true)).then(check(safety and s.losses == 1 and s.windowStart == 0))
  run duplicateAndForeignCallbacksDoNotSpendBudgetTest = init.then(rendererGone(0, false))
    .then(check(not(s.handled) and s.losses == 0)).then(rendererGone(0, true))
    .then(rendererGone(0, true)).then(check(safety and s.losses == 1))
  run delayedCallbackCannotReviveClosedActivityTest = init.then(rendererGone(0, true)).then(closeActivity)
    .then(recreateCallback(0)).then(check(safety and not(s.rendererAlive) and not(s.pending)))
  run oldCallbackCannotRecreateSuccessorTest = init.then(rendererGone(0, true)).then(recreateCallback(0))
    .then(rendererGone(1, true)).then(recreateCallback(0)).then(check(s.activity == 1 and s.pending))
    .then(recreateCallback(1)).then(check(safety and s.activity == 2))
  run settingsFallbacksTest = init.then(setHome(true)).then(rendererGone(0, true)).then(recreateCallback(0))
    .then(rendererGone(1, true)).then(recreateCallback(1)).then(rendererGone(1, true)).then(recreateCallback(2))
    .then(rendererGone(1, true)).then(configureSettings(Set("default-apps", "settings")))
    .then(chooseHomeSettings(true)).then(check(s.externalTarget == "default-apps"))
    .then(configureSettings(Set("settings"))).then(chooseHomeSettings(false))
    .then(check(safety and s.externalTarget == "none" and s.escape))
  run asynchronousRecreationTest = init.then(activityReady(true, true)).then(rendererGone(0, true))
    .then(dispatchRecreation(0)).then(check(s.recreateRequested and not(s.rendererAlive)))
    .then(destroyActivity(false)).then(recreationCompleted(true))
    .then(check(safety and s.home and s.activity == 1 and s.losses == 1 and s.rendererAlive))
  run noWebViewFallbackTest = init.then(activityReady(true, false))
    .then(resumeOwner).then(check(safety and not(s.bridgeAvailable or s.rendererAlive)))
  run configurationRecreationRetainsBudgetTest = init.then(activityReady(true, true))
    .then(rendererGone(1, true)).then(destroyActivity(false)).then(recreationCompleted(true))
    .then(dispatchRecreation(0)).then(check(safety and s.activity == 1 and s.losses == 1 and s.rendererAlive))
  run unansweredFrontingStopsHandoffTest = init.then(handoff(false, false, true))
    .then(handoff(false, false, true)).then(handoff(false, false, true))
    .then(check(s.handoffUnreliable and s.unackedFrontStarts == 3))
    .then(independentPageCreated(false, true)).then(check(safety and s.activity == 1 and s.rendererAlive))
  run failedFrontStartStopsHandoffTest = init.then(handoff(false, false, false))
    .then(check(safety and s.handoffUnreliable and s.unackedFrontStarts == 0))
  run resumedOwnerAcknowledgesHandoffTest = init.then(handoff(false, false, true)).then(resumeOwner)
    .then(check(safety and not(s.handoffUnreliable) and s.unackedFrontStarts == 0))
  run homeTaskSurvivesIndependentPageTest = init.then(activityReady(true, true)).then(handoff(true, false, true))
    .then(independentPageCreated(false, true)).then(restoreKnownTask(0, true))
    .then(check(safety and s.home and s.taskHomes.get(0) and not(s.taskHomes.get(1))))
  run finishedTaskIdReuseStartsFreshTest = init.then(activityReady(true, true)).then(destroyActivity(true))
    .then(newTaskActivity(0, false, true)).then(check(safety and not(s.home or s.taskHomes.get(0))))
}
