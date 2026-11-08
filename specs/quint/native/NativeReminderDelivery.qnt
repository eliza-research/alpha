// The product ReminderReceiver and pinned ReminderStore, with one tracked row,
// actual UTC-day/snooze units and synthetic inexact alarm/notification effects.
module NativeReminderDelivery {
  type State = {
    now: int, permission: bool, boot: int, restoredBoot: int, markerView: int, process: int, quarantined: bool,
    status: str, occurrence: int, issued: int, repeat: bool, silent: bool, legacy: bool,
    at: int, due: int, postedAt: int, snoozed: bool, history: int, skipped: int,
    alarm: int, alarmAt: int, arms: int,
    visible: int, visibleAt: int, noticeDeadline: int, posts: int,
    receipt: str, outcome: str
  }
  var s: State

  val day = 86400
  val times = Set(0, 59, 60, 61, 62, 120, 121, 600, 660, 661, 720, 172920, 259260)
  action init = s' = {
    now: 0, permission: true, boot: 1, restoredBoot: 0, markerView: 0, process: 1, quarantined: false,
    status: "none", occurrence: 0, issued: 0, repeat: false, silent: false, legacy: false,
    at: -1, due: -1, postedAt: -1, snoozed: false, history: 0, skipped: 0,
    alarm: 0, alarmAt: -1, arms: 0,
    visible: 0, visibleAt: -1, noticeDeadline: -1, posts: 0,
    receipt: "none", outcome: "none"
  }

  action clockAt(now: int): bool = all { times.contains(now), s' = { ...s, now: now } }
  action permission(granted: bool): bool = s' = { ...s, permission: granted }

  pure def clearNotice(state: State): State =
    { ...state, visible: 0, visibleAt: -1, noticeDeadline: -1 }
  pure def clearAlarm(state: State): State = { ...state, alarm: 0, alarmAt: -1 }
  pure def armed(state: State, refuse: bool): State =
    if (refuse) { ...state, arms: state.arms + 1 }
    else { ...state, alarm: state.occurrence, alarmAt: if (state.at > state.now) state.at else state.now + 1,
      arms: state.arms + 1 }
  pure def posted(state: State, at: int): State = {
    ...state, visible: state.occurrence, visibleAt: at, noticeDeadline: state.at, posts: state.posts + 1
  }
  pure def row(state: State, at: int, repeat: bool, silent: bool, status: str): State = {
    ...state, occurrence: state.issued + 1, issued: state.issued + 1, repeat: repeat, silent: silent, legacy: false,
    at: at, due: at, postedAt: -1, snoozed: false, status: status
  }

  action seedLegacy(at: int): bool = all {
    s.status == "none", s.issued == 0, at == 60,
    s' = { ...row(s, at, false, false, "scheduled"), legacy: true }
  }

  action schedule(at: int, repeat: bool, silent: bool, mode: str): bool = all {
    not(s.quarantined), s.issued < 4, s.arms < 8, Set(60,120,259260).contains(at), at > s.now,
    Set("complete", "arm-refused", "before-save", "after-save").contains(mode),
    val status = if (silent) "pending" else "scheduled"
    val written = row(s, at, repeat, silent, status)
    if (mode == "before-save") s' = { ...s, quarantined: true, outcome: "rejected" }
    else if (mode == "after-save") s' = { ...written, quarantined: true, outcome: "rejected" }
    else if (not(silent) and mode == "arm-refused")
      s' = { ...s, arms: s.arms + 1, outcome: "rejected" }
    else {
      val current = clearNotice(clearAlarm(written))
      s' = { ...(if (silent) current else armed(current,false)), outcome: status }
    }
  }

  // Direct schedule rolls back an arm failure. A reviewed operation instead
  // commits its row and effects-pending receipt before calling AlarmManager.
  action operate(at: int, silent: bool, mode: str): bool = all {
    not(s.quarantined), s.occurrence == 0, s.receipt == "none",
    Set(60,120).contains(at), at > s.now, s.arms < 8,
    Set("complete", "arm-refused", "receipt-before-save", "receipt-after-save").contains(mode),
    val shouldArm = not(silent) and s.permission
    val status = if (silent) "pending" else if (shouldArm) "scheduled" else "permission-denied"
    val written = row(s, at, false, silent, status)
    if (silent) s' = { ...written, receipt: "terminal", outcome: "succeeded" }
    else if (shouldArm and mode == "arm-refused")
      s' = { ...written, status: "scheduling-failed", arms: s.arms + 1, receipt: "effects-uncertain", outcome: "unknown" }
    else {
      val affected = if (shouldArm) armed(written,false) else written
      val receipt = if (mode == "receipt-before-save") "effects-pending" else "terminal"
      val failed = mode.in(Set("receipt-before-save", "receipt-after-save"))
      s' = { ...affected, receipt: receipt, quarantined: failed, outcome: if (failed) "unknown" else "succeeded" }
    }
  }

  action replayOperation(same: bool): bool = all {
    not(s.quarantined), s.receipt != "none",
    s' = { ...s, outcome: if (not(same)) "rejected" else if (s.receipt == "terminal") "succeeded" else "unknown" }
  }

  action deliver(occurrence: int, takeAlarm: bool, mode: str): bool = all {
    occurrence.in(0.to(4)), s.posts < 8, s.arms < 8,
    Set("complete", "route-refused", "notify-refused", "before-save", "after-save").contains(mode),
    not(takeAlarm) or (s.alarm != 0 and s.alarm == occurrence),
    val read = if (takeAlarm) clearAlarm(s) else s
    val exact = occurrence == s.occurrence or (occurrence == 0 and s.legacy)
    if (s.quarantined or s.status != "scheduled" or not(exact) or s.silent) s' = read
    else if (s.now < s.at) s' = armed(read,false)
    else {
      val permitted = s.permission
      val hasEffect = permitted and not(mode.in(Set("route-refused", "notify-refused")))
      val effect = if (hasEffect) posted(read,s.now) else read
      val nextStatus = if (permitted) "posted" else "permission-denied"
      val durable = if (mode == "before-save" or (permitted and not(hasEffect))) effect else
        { ...effect, status: nextStatus, postedAt: if (permitted) s.now else s.postedAt }
      s' = { ...durable, quarantined: mode.in(Set("before-save", "after-save")) }
    }
  }

  pure def decisionOutcome(state: State, value: str, broadcast: bool): State =
    if (broadcast) state else { ...state, outcome: value }

  action decide(occurrence: int, done: bool, broadcast: bool, mode: str): bool = all {
    occurrence.in(1.to(4)), s.arms < 8, s.history < 5,
    Set("complete", "arm-refused", "before-save", "after-save").contains(mode),
    val stale = occurrence != s.occurrence or s.status.in(Set("none", "cancelled", "completed"))
    if (s.quarantined) s' = decisionOutcome(s, "rejected", broadcast)
    else if (stale) s' = decisionOutcome(s, "stale", broadcast)
    else if (not(done) and s.silent) s' = decisionOutcome(s, "rejected", broadcast)
    else if (not(done) and s.snoozed and s.status == "scheduled") s' = decisionOutcome(s, "unchanged", broadcast)
    else all {
      not(done and s.repeat) or s.issued < 4,
      val skipped = if (s.now < s.due + day) 0 else (s.now - s.due) / day
      val nextDue = s.due + (skipped + 1) * day
      val status = if (s.silent) "pending" else if (s.permission) "scheduled" else "permission-denied"
      val written = if (done and not(s.repeat)) {
        ...s, status: "completed", legacy: false, history: s.history + 1, skipped: 0
      } else if (done) {
        ...s, status: status, occurrence: s.issued + 1, issued: s.issued + 1, at: nextDue, due: nextDue,
        legacy: false, postedAt: -1, snoozed: false, history: s.history + 1, skipped: skipped
      } else {
        ...s, status: status, at: s.now + 600, snoozed: true, legacy: false
      }
      if (mode == "before-save") s' = decisionOutcome({ ...s, quarantined: true }, "rejected", broadcast)
      else if (mode == "after-save") s' = decisionOutcome({ ...written, quarantined: true }, "rejected", broadcast)
      else {
        val cleared = clearNotice(clearAlarm(written))
        val affected = if (written.status != "scheduled") cleared
          else if (mode == "arm-refused") { ...armed(cleared, true), status: "scheduling-failed" }
          else armed(cleared,false)
        s' = decisionOutcome(affected, affected.status, broadcast)
      }
    }
  }

  action cancel: bool = all {
    s.occurrence != 0, not(s.quarantined),
    s' = { ...clearNotice(clearAlarm(s)), status: "cancelled", outcome: "cancelled" }
  }

  action dismiss: bool = s' = clearNotice(s)

  action restart: bool = all {
    s.process < 4,
    s' = { ...s, process: s.process + 1, markerView: s.restoredBoot, quarantined: false }
  }

  action reboot: bool = all {
    s.process < 4, s.boot < 3,
    s' = { ...clearNotice(clearAlarm(s)), process: s.process + 1, boot: s.boot + 1, markerView: s.restoredBoot, quarantined: false }
  }

  action restore(mode: str): bool = all {
    s.posts < 8, s.arms < 8,
    mode.in(Set("complete", "arm-refused", "notify-refused", "marker-refused")),
    if (s.quarantined) s' = s
    else {
      val changed = s.boot != s.markerView
      val isPosted = s.status == "posted" and not(s.silent)
      val canPost = isPosted and changed and s.permission and mode != "notify-refused"
      val restored = if (s.status == "scheduled" and not(s.silent)) armed(s, mode == "arm-refused")
        else if (canPost) posted(s,s.postedAt) else s
      s' = if (changed and (not(isPosted) or canPost))
        { ...restored, markerView: s.boot, restoredBoot: if (mode == "marker-refused") s.restoredBoot else s.boot }
        else restored
    }
  }

  val routeRetained = not(s.quarantined) and s.visible != 0 and s.visible == s.occurrence and
    s.status == "posted" and s.visibleAt == s.postedAt
  val NoEarlyPublication = if (s.visible == 0) s.visibleAt == -1 and s.noticeDeadline == -1
    else s.visibleAt >= s.noticeDeadline and s.noticeDeadline >= 0
  val IssuedIdentities = s.occurrence <= s.issued and s.alarm <= s.issued and s.visible <= s.issued
  val ReceiptNeedsDurableRow = s.receipt == "none" or s.occurrence != 0
  val BootMarkerIsObservedBoot = s.restoredBoot <= s.markerView and s.markerView <= s.boot
  val safety = NoEarlyPublication and IssuedIdentities and ReceiptNeedsDurableRow and BootMarkerIsObservedBoot

  action step = any {
    nondet now = times.oneOf()
    clockAt(now),
    nondet granted = Bool.oneOf()
    permission(granted),
    seedLegacy(60),
    nondet at = Set(60,120,259260).oneOf()
    nondet repeat = Bool.oneOf()
    nondet silent = Bool.oneOf()
    nondet mode = Set("complete", "arm-refused", "before-save", "after-save").oneOf()
    schedule(at, repeat, silent, mode),
    nondet silent = Bool.oneOf()
    nondet mode = Set("complete", "arm-refused", "receipt-before-save", "receipt-after-save").oneOf()
    operate(60,silent,mode),
    replayOperation(true), replayOperation(false),
    nondet occurrence = 0.to(4).oneOf()
    nondet take = Bool.oneOf()
    nondet mode = Set("complete", "route-refused", "notify-refused", "before-save", "after-save").oneOf()
    deliver(occurrence,take,mode),
    nondet occurrence = 1.to(4).oneOf()
    nondet done = Bool.oneOf()
    nondet broadcast = Bool.oneOf()
    nondet mode = Set("complete", "arm-refused", "before-save", "after-save").oneOf()
    decide(occurrence,done,broadcast,mode),
    cancel, dismiss, restart, reboot,
    nondet mode = Set("complete", "arm-refused", "notify-refused", "marker-refused").oneOf()
    restore(mode),
    s' = s
  }

  action scheduled = init.then(schedule(60,false,false,"complete"))
  action notified = scheduled.then(clockAt(60)).then(deliver(1,true,"complete"))

  run oldAndEarlyAlarmsDoNotPostTest = scheduled.then(schedule(120,false,false,"complete"))
    .then(clockAt(60)).then(deliver(1,false,"complete")).then(deliver(2,true,"complete"))
    .expect(s.posts == 0 and s.alarm == 2 and s.alarmAt == 120)

  run permissionGrantNeedsExplicitRescheduleTest = scheduled.then(permission(false))
    .then(clockAt(60)).then(deliver(1,true,"complete")).then(permission(true)).then(restore("complete"))
    .expect(s.status == "permission-denied" and s.alarm == 0 and s.posts == 0)

  run visibleBeforeDurableSaveIsUnretainedTest = scheduled.then(clockAt(60)).then(deliver(1,true,"before-save"))
    .expect(s.quarantined and s.status == "scheduled" and s.visible == 1 and not(routeRetained))
    .then(restart).then(restore("complete")).expect(s.alarmAt == 61 and not(routeRetained))

  run postedBytesSurviveAmbiguousSaveTest = scheduled.then(clockAt(60)).then(deliver(1,true,"after-save"))
    .expect(s.quarantined and s.status == "posted" and not(routeRetained))
    .then(restart).expect(routeRetained)

  run restoreMarkerWaitsForPostedPermissionTest = notified.then(reboot).then(permission(false)).then(restore("complete"))
    .expect(s.posts == 1 and s.restoredBoot == 0)
    .then(permission(true)).then(restore("complete")).then(dismiss).then(restore("complete"))
    .expect(s.posts == 2 and s.visible == 0 and s.restoredBoot == 2)

  run failedBootMarkerRetryWaitsForProcessRestartTest = notified.then(reboot).then(restore("marker-refused"))
    .expect(s.posts == 2 and s.markerView == 2 and s.restoredBoot == 0)
    .then(dismiss).then(restore("complete")).expect(s.posts == 2)
    .then(restart).then(restore("complete")).expect(s.posts == 3 and s.restoredBoot == 2)

  run snoozeRetainsOccurrenceAndDoneRetiresItTest = notified.then(decide(1,false,true,"complete"))
    .expect(s.occurrence == 1 and s.at == 660 and s.due == 60 and s.alarmAt == 660)
    .then(decide(1,false,false,"complete")).expect(s.outcome == "unchanged")
    .then(decide(1,true,true,"complete")).expect(s.status == "completed" and s.history == 1 and s.alarm == 0)

  run doneAloneAdvancesDailyCivilOccurrenceTest = init.then(schedule(60,true,false,"complete"))
    .then(clockAt(60)).then(deliver(1,true,"complete")).then(clockAt(172920))
    .then(decide(1,true,true,"complete"))
    .expect(s.occurrence == 2 and s.due == 259260 and s.skipped == 2 and s.history == 1)
    .then(decide(1,true,false,"complete")).expect(s.outcome == "stale" and s.history == 1)

  run uncertainOperationReplayDoesNotArmTest = init.then(operate(60,false,"receipt-before-save"))
    .expect(s.receipt == "effects-pending" and s.arms == 1 and s.quarantined)
    .then(restart).then(replayOperation(true)).then(replayOperation(false))
    .expect(s.outcome == "rejected" and s.arms == 1 and s.receipt == "effects-pending")
}
