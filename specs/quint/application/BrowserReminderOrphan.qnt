module BrowserReminderOrphan {
  type Row = {kind: str, marker: bool, status: str, at: int, due: int, revision: int,
    occurrence: int, title: str, snoozed: bool, history: int}
  type Peer = {status: str, at: int}
  type Clock = {listed: bool, pendingLock: bool, owned: bool, sounds: int}
  type State = {row: Row, peer: Peer, journal: str, claim: bool, legacy: bool,
    canonical: bool, now: int, notifications: bool, receipts: Set[int], clock: Clock}

  pure val initialStatuses = Set("scheduled", "posted", "permission-denied")
  pure val kinds = Set("reminder", "alarm")
  pure val receiptIds = 1.to(3)
  pure val emptyClock: Clock = {listed: false, pendingLock: false, owned: false, sounds: 0}
  var s: State

  pure def startRow(kind: str, status: str, marker: bool): Row = {
    val at = if (status == "permission-denied") 2 else -1
    {kind: kind, marker: marker, status: status, at: at, due: at, revision: 1,
      occurrence: 1, title: "original", snoozed: false, history: 0}
  }
  action initFor(kind: str, status: str, marker: bool, legacy: bool): bool = all {
    kind.in(kinds), status.in(initialStatuses),
    s' = {row: startRow(kind, status, marker), peer: {status: "none", at: 0}, journal: "none",
      claim: false, legacy: legacy, canonical: not(legacy), now: 0, notifications: true,
      receipts: Set(), clock: emptyClock}
  }
  action init = {
    nondet kind = kinds.oneOf()
    nondet status = initialStatuses.oneOf()
    nondet marker = Set(true, false).oneOf()
    nondet legacy = Set(true, false).oneOf()
    initFor(kind, status, marker, legacy)
  }

  val guarded = s.journal == "queued"
  val active = not(s.row.status.in(Set("completed", "cancelled")))
  val canChange = s.canonical and not(guarded) and s.row.revision < 12
  val PendingReview = guarded
  val ReceiptHasEntry = s.journal != "none"
  val ReceiptHasRow = s.row.marker or ReceiptHasEntry
  val InReminderList = s.row.status != "cancelled"
  pure def alertStatus(on: bool): str = if (on) "scheduled" else "permission-denied"
  pure def dueStatus(status: str, at: int, now: int, on: bool): str =
    if (status == "scheduled" and at <= now) (if (on) "posted" else "permission-denied")
    else if (status == "permission-denied" and on and at > now) "scheduled"
    else status
  pure def afterList(state: State): State = {
    val row = state.row
    val status = if (row.marker) row.status else dueStatus(row.status, row.at, state.now, state.notifications)
    val peer = state.peer
    {...state, canonical: true, row: if (status == row.status) row else
      {...row, status: status, revision: row.revision + 1},
      peer: {...peer, status: dueStatus(peer.status, peer.at, state.now, state.notifications)}}
  }
  pure def canRing(row: Row): bool = row.kind == "alarm" and row.status == "posted" and not(row.marker)

  action load = all {not(s.canonical), s' = {...s, canonical: true}}
  action inspect = all {s.canonical, s' = s}
  action readSelected(expected: int): bool = all {s.canonical, s.row.revision == expected, s' = s}
  action settle = all {s.canonical, s' = s} // No proved expiry in this campaign.
  action advance = all {s.now < 3, s' = {...s, now: s.now + 1}}
  action setNotifications(on: bool): bool = s' = {...s, notifications: on}
  action list = all {s.row.revision < 12, s' = afterList(s)}

  action stage = all {
    s.canonical, not(s.row.marker), s.row.status != "cancelled", not(ReceiptHasEntry),
    s' = {...s, row: {...s.row, marker: true}, journal: "queued", claim: true}
  }
  action undo = all {
    s.canonical, guarded, s.row.marker,
    s' = {...s, row: {...s.row, marker: false}, journal: "undone"}
  }
  action dismiss = all {false, s' = s} // No unknown or dispatching entry in these states.
  action directCancel = all {false, s' = s} // The normal operation must use reviewed staging.
  action createSame = all {false, s' = s} // The selected identity already exists.

  action edit(id: int, expected: int, reschedule: bool): bool = all {
    canChange, s.row.status != "cancelled", s.row.revision == expected, id.in(receiptIds), not(id.in(s.receipts)),
    val revised = {...s.row, title: "edited", revision: s.row.revision + 1}
    s' = {...s, receipts: s.receipts.union(Set(id)), row: if (reschedule)
      {...revised, at: s.now + 2, due: s.now + 2, occurrence: s.row.occurrence + 1,
        status: alertStatus(s.notifications), snoozed: false} else revised}
  }
  action replay(id: int): bool = all {id.in(s.receipts), s' = s}
  action scheduleReplacement = all {
    canChange,
    s' = {...s, row: {...s.row, marker: false, status: alertStatus(s.notifications),
      at: s.now + 2, due: s.now + 2, revision: s.row.revision + 1,
      occurrence: s.row.occurrence + 1, title: "replacement", snoozed: false}}
  }
  action createPeer(reviewed: bool): bool = all {
    s.canonical, s.peer.status == "none", not(reviewed) or not(3.in(s.receipts)),
    s' = {...s, peer: {status: alertStatus(s.notifications), at: s.now + 1},
      receipts: if (reviewed) s.receipts.union(Set(3)) else s.receipts}
  }

  // One-off Done retains the occurrence's snooze metadata, as the shared native
  // engine does. The completed status prevents further occurrence decisions.
  pure def completed(row: Row): Row =
    {...row, status: "completed", revision: row.revision + 1, history: row.history + 1}
  pure def snoozed(row: Row, at: int, on: bool): Row =
    {...row, status: alertStatus(on), at: at, revision: row.revision + 1, snoozed: true}
  def applyDecision(kind: str): Row = if (kind == "done") completed(s.row)
    else if (s.row.status == "scheduled" and s.row.snoozed) s.row
    else snoozed(s.row, s.now + 10, s.notifications)
  action decision(kind: str, occurrence: int): bool = all {
    canChange, active, s.row.occurrence == occurrence, kind.in(Set("done", "snooze")),
    s' = {...s, row: applyDecision(kind)}
  }
  action reviewedDecision(id: int, expected: int, kind: str): bool = all {
    canChange, active, s.row.revision == expected, id.in(receiptIds), not(id.in(s.receipts)),
    kind.in(Set("done", "snooze")),
    s' = {...s, row: applyDecision(kind), receipts: s.receipts.union(Set(id))}
  }
  action alarmDecision(kind: str, expected: int, bulk: bool): bool = all {
    canChange, s.row.kind == "alarm", kind.in(Set("cancel", "dismiss", "snooze")),
    if (bulk) kind != "cancel" and s.row.status == "posted" else
      expected == s.row.revision and (kind == "cancel" or s.row.status == "posted"),
    s' = {...s, row: if (kind == "cancel") {...s.row, status: "cancelled", revision: s.row.revision + 1}
      else if (kind == "dismiss") completed(s.row)
      else snoozed(s.row, s.now + 5, s.notifications)}
  }

  action pollClock = {
    val observed = afterList(s)
    val ringing = canRing(observed.row)
    all {
      s.row.revision < 12, not(s.clock.pendingLock), not(s.clock.owned) or not(ringing),
      s' = {...observed, clock: {...s.clock,
        listed: observed.row.kind == "alarm" and observed.row.status.in(initialStatuses),
        pendingLock: ringing, owned: false}}
    }
  }
  action grantClock = all {
    s.clock.pendingLock, s.row.revision < 12, s.clock.sounds < 2,
    val observed = afterList(s)
    val ringing = canRing(observed.row)
    s' = {...observed, clock: {...s.clock, pendingLock: false, owned: ringing,
      sounds: s.clock.sounds + (if (ringing) 1 else 0)}}
  }

  val PairedAuthorityOwnsMarker = guarded implies (s.row.marker and s.claim)
  val AClaimRequiresAnOwnJournalEntry = s.claim implies ReceiptHasEntry
  val ClockLockAndAudioOwnershipAreSeparate = s.clock.owned implies not(s.clock.pendingLock)
  val safety = PairedAuthorityOwnsMarker and AClaimRequiresAnOwnJournalEntry
    and ClockLockAndAudioOwnershipAreSeparate and (not(s.canonical) implies s.legacy)
    and s.row.revision.in(1.to(12)) and s.row.occurrence.in(1.to(s.row.revision))
    and s.receipts.subseteq(receiptIds) and s.clock.sounds.in(0.to(2))

  action step = any {
    load, inspect, settle, advance, list, stage, undo, scheduleReplacement, pollClock, grantClock,
    nondet reviewed = Set(true, false).oneOf()
    createPeer(reviewed),
    nondet on = Set(true, false).oneOf()
    setNotifications(on),
    nondet id = receiptIds.oneOf()
    nondet reschedule = Set(true, false).oneOf()
    edit(id, s.row.revision, reschedule),
    nondet id = receiptIds.oneOf()
    replay(id),
    nondet kind = Set("done", "snooze").oneOf()
    decision(kind, s.row.occurrence),
    nondet id = receiptIds.oneOf()
    nondet kind = Set("done", "snooze").oneOf()
    reviewedDecision(id, s.row.revision, kind),
    nondet kind = Set("cancel", "dismiss", "snooze").oneOf()
    nondet bulk = Set(true, false).oneOf()
    alarmDecision(kind, s.row.revision, bulk),
    s' = s
  }

  run orphanImportsWithoutCreatingDeletionAuthorityTest = initFor("reminder", "scheduled", true, true)
    .then(load).then(list).then(settle).then(inspect)
    .expect(safety and s.row.status == "scheduled" and s.row.marker and not(PendingReview) and not(ReceiptHasEntry))
  run orphanCannotBeRestagedTest = initFor("reminder", "scheduled", true, false).then(stage.fail())
  run orphanCannotBeUndoneTest = initFor("reminder", "scheduled", true, false).then(undo.fail())
  run ordinaryChangesKeepOrphanUntilExplicitReplacementTest = initFor("reminder", "scheduled", true, false)
    .then(edit(1, 1, false)).then(decision("snooze", 1)).then(decision("done", 1))
    .expect(safety and s.row.status == "completed" and s.row.snoozed and s.row.marker and s.row.history == 1)
    .then(scheduleReplacement).expect(safety and not(s.row.marker) and not(s.row.snoozed)
      and s.row.status == "scheduled" and s.row.occurrence == 2 and not(ReceiptHasEntry))
  run completedOneOffCannotSnoozeTest = initFor("reminder", "scheduled", true, false)
    .then(decision("snooze", 1)).then(decision("done", 1))
    .expect(safety and s.row.status == "completed" and s.row.snoozed and s.row.marker)
    .then(decision("snooze", 1).fail())
  run aGenuinePairBlocksReplacementTest = initFor("reminder", "scheduled", false, false).then(stage).then(scheduleReplacement.fail())
  run explicitClockCancelLeavesOrphanWithoutReceiptTest = initFor("alarm", "posted", true, false)
    .then(alarmDecision("cancel", 1, false)).expect(safety and s.row.marker and not(ReceiptHasEntry) and not(InReminderList))
  run aPendingAlarmCannotAcquireSoundOnLockGrantTest = initFor("alarm", "posted", false, false)
    .then(pollClock).then(stage).then(grantClock)
    .expect(safety and s.clock.listed and s.clock.sounds == 0 and not(s.clock.owned))
    .then(undo).then(pollClock).then(grantClock)
    .expect(safety and s.clock.owned and s.clock.sounds == 1)
}
