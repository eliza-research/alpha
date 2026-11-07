// AOSP role and permission admission, durable SMS evidence, reminders and Clock handoff.
module DeviceActions {
  type State = {
    image: bool, foreground: bool, unlocked: bool, permission: bool, sim: int,
    phase: str, reviewSim: int, reviewText: int, text: int, journaled: bool,
    dispatches: int, parts: int, sentParts: Set[int], deliveryReport: bool,
    providerComplete: bool, retiredId: bool, handoff: str,
    reminder: str, reminderRevision: int, deliveredRevision: int,
    reminderCreation: str, reminderAttempts: int, accessEpoch: int, contacts: str, contactsEpoch: int
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    image: false, foreground: true, unlocked: true, permission: false, sim: 0,
    phase: "new", reviewSim: -1, reviewText: -1, text: 0, journaled: false,
    dispatches: 0, parts: 1, sentParts: Set(), deliveryReport: false,
    providerComplete: false, retiredId: false, handoff: "none",
    reminder: "none", reminderRevision: 0, deliveredRevision: -1,
    reminderCreation: "none", reminderAttempts: 0, accessEpoch: 0, contacts: "none", contactsEpoch: -1
  }
  action admitImage = all {
    s.phase == "new", s' = {image: true, permission: true, ...s}
  }
  action review(parts: int): bool = all {
    s.image, s.permission, s.foreground, s.unlocked, s.phase == "new",
    parts.in(Set(1, 2)), not(s.retiredId),
    s' = {phase: "reviewed", reviewSim: s.sim, reviewText: s.text, parts: parts, ...s}
  }
  action editText = all {
    s.phase.in(Set("new", "reviewed")), s' = {text: 1 - s.text, phase: "new", ...s}
  }
  action simChanges = all {
    s.phase.in(Set("new", "reviewed")), s' = {sim: 1 - s.sim, phase: "new", ...s}
  }
  action permissionLost = all {
    s.accessEpoch < 3,
    s' = {permission: false, contacts: "none", accessEpoch: s.accessEpoch + 1, ...s}
  }
  action pause = all {
    s.accessEpoch < 3,
    s' = {foreground: false, unlocked: false, contacts: "none", accessEpoch: s.accessEpoch + 1, ...s}
  }
  action resumeDevice = s' = {foreground: true, unlocked: true, ...s}
  action beginContactsRead = all {
    s.image, s.permission, s.foreground, s.unlocked,
    s' = {contacts: "reading", contactsEpoch: s.accessEpoch, ...s}
  }
  action contactsReply(ticket: int): bool =
    if (s.contacts == "reading" and ticket == s.contactsEpoch and ticket == s.accessEpoch and
        s.image and s.permission and s.foreground and s.unlocked)
      s' = s.with("contacts", "loaded")
    else s' = s
  action dispatch(storageWorks: bool): bool = all {
    s.phase == "reviewed", s.image, s.permission, s.foreground, s.unlocked,
    s.reviewSim == s.sim, s.reviewText == s.text, not(s.journaled), not(s.retiredId),
    s' = if (storageWorks)
      {phase: "dispatching", journaled: true, dispatches: s.dispatches + 1, ...s}
      else s
  }
  action dispatchReturns(allReturned: bool): bool = all {
    s.phase == "dispatching",
    s' = s.with("phase", if (allReturned) "submitted" else "unknown")
  }
  action sentCallback(part: int, success: bool): bool = all {
    s.journaled, s.phase.in(Set("dispatching", "submitted", "unknown", "sent")),
    part >= 0, part < s.parts, not(s.sentParts.contains(part)),
    s' = if (success)
      {sentParts: s.sentParts.union(Set(part)),
        phase: if (s.sentParts.size() + 1 == s.parts) "sent" else s.phase, ...s}
      else s.with("phase", "failed")
  }
  action reportDelivery(providerComplete: bool): bool = all {
    s.phase == "sent", s.parts == 1,
    s' = {deliveryReport: true, providerComplete: providerComplete,
      phase: if (providerComplete) "delivered" else "sent", ...s}
  }
  action reboot =
    s' = s.with("phase", if (s.phase.in(Set("dispatching", "submitted"))) "unknown" else s.phase)
  action retire = all {
    s.journaled, s.phase != "dispatching",
    s' = {retiredId: true, phase: "retired", ...s}
  }
  action repeatOperation = s' = s
  action handoffClock = s' = s.with("handoff", "handed-off")
  // Collapsed successful local creation, plus granular durable-intent/recovery actions below.
  action scheduleReminder = all {
    s.reminder == "none", s.reminderCreation == "none", s.reminderAttempts == 0,
    s' = {reminder: "scheduled", reminderCreation: "found", reminderAttempts: 1, ...s}
  }
  action stageReminder = all {
    s.reminder == "none", s.reminderCreation == "none", s.reminderAttempts == 0,
    s' = s.with("reminderCreation", "pending")
  }
  action reminderResult(status: str): bool = all {
    s.reminderCreation == "pending", s.reminderAttempts == 0,
    status.in(Set("none", "pending", "todo", "scheduled", "permission-denied", "scheduling-failed")),
    s' = {reminder: status, reminderAttempts: 1,
      reminderCreation: if (status == "none") "pending" else "found", ...s}
  }
  // Readback confirms the same creation; it never calls the scheduling port again.
  action reconcileReminder(found: bool): bool = all {
    s.reminderCreation == "pending", s.reminderAttempts == 1,
    s' = if (found) {reminder: "scheduled", reminderCreation: "found", ...s} else s
  }
  action completeReminder = all {
    s.reminder.in(Set("pending", "todo", "posted", "permission-denied", "scheduling-failed")),
    s.reminderRevision < 2,
    s' = {reminder: "completed", reminderRevision: s.reminderRevision + 1, ...s}
  }
  action reminderFires(revision: int): bool =
    if (s.reminder == "scheduled" and revision == s.reminderRevision)
      s' = {reminder: "posted", deliveredRevision: revision, ...s}
    else s' = s
  action snooze = all {
    s.reminder == "posted", s.reminderRevision < 2,
    s' = {reminder: "scheduled", reminderRevision: s.reminderRevision + 1, ...s}
  }
  action stopReminder = all {
    s.reminder != "none", s.reminderRevision < 2,
    s' = {reminder: "cancelled", reminderRevision: s.reminderRevision + 1, ...s}
  }
  action step = {
    nondet flag = Set(false, true).oneOf()
    nondet part = Set(0, 1).oneOf()
    nondet parts = Set(1, 2).oneOf()
    nondet revision = Set(-1, 0, 1, 2, 3).oneOf()
    nondet status = Set("none", "pending", "todo", "scheduled", "permission-denied", "scheduling-failed").oneOf()
    any { admitImage, review(parts), editText, simChanges, permissionLost, pause, resumeDevice, beginContactsRead, contactsReply(revision),
      dispatch(flag), dispatchReturns(flag), sentCallback(part, flag), reportDelivery(flag),
      reboot, retire, repeatOperation, handoffClock, scheduleReminder, stageReminder, reminderResult(status),
      reconcileReminder(flag), completeReminder, reminderFires(revision), snooze, stopReminder, s' = s }
  }
  val SingleSmsDispatch = s.dispatches.in(Set(0, 1))
  val SmsNeedsReviewAndJournal = s.dispatches > 0 implies
    s.image and s.journaled and s.reviewSim == s.sim and s.reviewText == s.text
  val SentRequiresAllCallbacks = s.phase.in(Set("sent", "delivered")) implies s.sentParts.size() == s.parts
  val DeliveryNeedsProviderEvidence = s.phase == "delivered" implies
    s.parts == 1 and s.deliveryReport and s.providerComplete
  val RetiredIdNeverForgotten = s.retiredId implies s.phase == "retired" and s.dispatches == 1
  val HandoffIsHonest = s.handoff.in(Set("none", "handed-off"))
  val ReminderCurrent = s.reminder == "posted" implies s.deliveredRevision == s.reminderRevision
  val ContactReadCurrent = s.contacts == "loaded" implies
    s.contactsEpoch == s.accessEpoch and s.permission and s.image and s.foreground and s.unlocked
  val ReminderCreationDoesNotReplay = s.reminderAttempts.in(Set(0, 1))
  val safety = ContactReadCurrent and ReminderCreationDoesNotReplay and SingleSmsDispatch and SmsNeedsReviewAndJournal and SentRequiresAllCallbacks and
    DeliveryNeedsProviderEvidence and RetiredIdNeverForgotten and HandoffIsHonest and ReminderCurrent

  run smsDeliveryEvidenceTest = init.then(admitImage).then(review(1)).then(dispatch(true))
    .then(dispatchReturns(true)).then(sentCallback(0, true)).then(reportDelivery(false))
    .then(check(s.phase == "sent")).then(reportDelivery(true)).then(check(safety and s.phase == "delivered"))
  run interruptedDispatchNeverResendsTest = init.then(admitImage).then(review(2)).then(dispatch(true))
    .then(reboot).then(repeatOperation).then(retire).then(repeatOperation)
    .then(check(safety and s.dispatches == 1 and s.retiredId))
  run multipartRemainsSentTest = init.then(admitImage).then(review(2)).then(dispatch(true))
    .then(dispatchReturns(true)).then(sentCallback(1, true)).then(sentCallback(0, true))
    .then(check(safety and s.phase == "sent" and not(s.deliveryReport)))
  run failedJournalDoesNotSendTest = init.then(admitImage).then(review(1)).then(dispatch(false))
    .then(check(safety and s.dispatches == 0 and not(s.journaled)))
  run staleReminderTicketTest = init.then(scheduleReminder).then(reminderFires(0)).then(snooze)
    .then(reminderFires(0)).then(check(s.reminder == "scheduled"))
    .then(reminderFires(1)).then(stopReminder).then(reminderFires(1)).then(check(safety and s.reminder == "cancelled"))
  run staleContactsReplyAfterPauseTest = init.then(admitImage).then(beginContactsRead)
    .then(pause).then(resumeDevice).then(contactsReply(0))
    .then(check(safety and s.contacts == "none"))
  run unknownReminderCreationDoesNotRepeatTest = init.then(stageReminder)
    .then(reminderResult("none")).then(reconcileReminder(false)).then(reconcileReminder(false))
    .then(check(safety and s.reminderAttempts == 1 and s.reminderCreation == "pending"))
    .then(reconcileReminder(true)).then(check(safety and s.reminder == "scheduled"))
  run silentTodoCompletesWithoutAlertTest = init.then(stageReminder).then(reminderResult("todo"))
    .then(completeReminder).then(reminderFires(0))
    .then(check(safety and s.reminder == "completed" and s.deliveredRevision == -1))
  run clockHandoffDoesNotClaimRingTest = init.then(handoffClock)
    .then(check(safety and s.handoff == "handed-off" and s.reminder == "none"))
}
