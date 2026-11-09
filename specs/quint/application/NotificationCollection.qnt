// Optional external-notification collection, privacy, policy epochs and metadata history.
// Native NotificationMirror and browser Notifications retain distinct locked-row behavior.
module NotificationCollection {
  type State = {
    native: bool, enabled: bool, paused: bool, access: bool, connected: bool,
    selected: bool, preview: bool, historyEnabled: bool, policyRevision: int, epoch: int,
    signature: int, selectedSignature: int, sameUser: bool, ownPackage: bool, uidMatches: bool,
    locked: bool, eventPresent: bool, eventRevision: int, secret: bool,
    clearable: bool, autoCancel: bool, intentOwned: bool,
    policyPending: bool, reviewedPolicyRevision: int,
    desiredEnabled: bool, desiredSelected: bool, desiredPreview: bool, desiredHistory: bool,
    readPending: bool, readEpoch: int, readRevision: int, rowPresent: bool, rowText: bool,
    rowEpoch: int, rowRevision: int, historyCount: int, historyAge: int, historySignature: int,
    historyFailure: bool, queuedEvent: bool, queuedEpoch: int,
    lastActionExpectedEpoch: int, lastActionActualEpoch: int, lastOpenOwned: bool,
    appEnabled: bool, channelEnabled: bool
  }
  var s: State
  pure def initialState(native: bool): State = { native: native, enabled: false, paused: false, access: false, connected: false,
      selected: false, preview: false, historyEnabled: false, policyRevision: 0, epoch: 0,
      signature: 0, selectedSignature: 0, sameUser: true, ownPackage: false, uidMatches: true,
      locked: false, eventPresent: false, eventRevision: 0, secret: false,
      clearable: true, autoCancel: true, intentOwned: true,
      policyPending: false, reviewedPolicyRevision: 0, desiredEnabled: false,
      desiredSelected: false, desiredPreview: false, desiredHistory: false,
      readPending: false, readEpoch: -1, readRevision: -1, rowPresent: false, rowText: false,
      rowEpoch: -1, rowRevision: -1, historyCount: 0, historyAge: 0, historySignature: 0,
      historyFailure: false, queuedEvent: false, queuedEpoch: -1,
      lastActionExpectedEpoch: -1, lastActionActualEpoch: -1, lastOpenOwned: true,
      appEnabled: true, channelEnabled: true }
  action initFor(native: bool): bool = s' = initialState(native)
  action init = { nondet native = Bool.oneOf(); s' = initialState(native) }
  val Active = s.enabled and not(s.paused) and s.access
  val PackageAdmitted = s.selected and s.signature == s.selectedSignature and s.sameUser
    and not(s.ownPackage) and s.uidMatches
  val CurrentRow = s.rowPresent and s.eventPresent and Active and PackageAdmitted
    and s.rowEpoch == s.epoch and s.rowRevision == s.eventRevision
    and (not(s.native) or s.connected) and (not(s.native) or not(s.locked))
  val TextVisible = s.rowPresent and s.rowText
  val HistoryVisible = s.historyCount > 0 and s.historyEnabled and Active and PackageAdmitted
    and s.historySignature == s.signature and s.historyAge < 2 and not(s.historyFailure)
  val OwnNotificationVisible = s.appEnabled and s.channelEnabled and not(s.locked)
  val CanOpen = CurrentRow and not(s.locked) and not(s.secret) and s.intentOwned
  val CanDismiss = CurrentRow and not(s.locked) and s.clearable
  val RepinAllowed = not(s.native and s.desiredSelected and s.selected and s.selectedSignature != s.signature)
  action grantAccess = s' = { ...s, access: true, connected: true }
  action reviewPolicy(enable: bool, selected: bool, preview: bool, history: bool): bool =
    s' = { ...s, policyPending: true, reviewedPolicyRevision: s.policyRevision,
      desiredEnabled: enable, desiredSelected: selected, desiredPreview: preview, desiredHistory: history }
  action commitPolicy(success: bool): bool = all {
    s.policyPending, s.reviewedPolicyRevision == s.policyRevision, s.epoch < 4, not(success) or RepinAllowed,
    if (success) s' = { ...s, enabled: s.desiredEnabled, selected: s.desiredSelected,
      preview: s.desiredPreview, historyEnabled: s.desiredHistory, selectedSignature: s.signature,
      policyRevision: s.policyRevision + 1, epoch: s.epoch + 1, policyPending: false,
      rowPresent: false, rowText: false, historyCount: 0 }
    else if (s.native) s' = { ...s, epoch: s.epoch + 1, rowPresent: false, rowText: false,
      historyCount: 0, policyPending: false }
    else s' = { ...s, policyPending: false }
  }
  action rejectChangedSelection = all { s.policyPending, not(RepinAllowed),
    s' = { ...s, policyPending: false } }
  action competingPolicyChange = all { s.epoch < 4,
    s' = { ...s, policyRevision: s.policyRevision + 1, epoch: s.epoch + 1,
      rowPresent: false, rowText: false, historyCount: 0 } }
  action pause = all { s.epoch < 4,
    s' = { ...s, paused: true, epoch: s.epoch + 1, rowPresent: false, rowText: false, historyCount: 0 } }
  action resume = all { s.epoch < 4,
    s' = { ...s, paused: false, epoch: s.epoch + 1, rowPresent: false } }
  action revokeAccess = all { s.epoch < 4,
    s' = { ...s, access: false, connected: false, epoch: s.epoch + 1, rowPresent: false, rowText: false, historyCount: 0 } }
  action disconnectListener = all { s.epoch < 4,
    s' = { ...s, connected: false, epoch: s.epoch + 1, rowPresent: false } }
  action replacePackage = all { s.signature < 2, s.epoch < 4,
    s' = { ...s, signature: s.signature + 1, epoch: s.epoch + 1, rowPresent: false } }
  action lock = all { s.epoch < 4,
    s' = { ...s, locked: true, epoch: s.epoch + 1, rowPresent: false } }
  action unlock = s' = { ...s, locked: false }
  action post(secret: bool): bool = all { s.eventRevision < 2,
    s' = { ...s, eventPresent: true, eventRevision: s.eventRevision + 1,
      secret: secret, rowPresent: false, rowText: false, queuedEvent: true, queuedEpoch: s.epoch } }
  action receiveQueuedEvent = all { s.queuedEvent,
    s' = { ...s, queuedEvent: false,
      historyCount: if (s.queuedEpoch == s.epoch and Active and PackageAdmitted
        and s.historyEnabled and not(s.historyFailure)) (if (s.historyCount < 2) s.historyCount + 1 else 2) else s.historyCount,
      historyAge: if (s.queuedEpoch == s.epoch and Active and PackageAdmitted and s.historyEnabled) 0 else s.historyAge,
      historySignature: if (s.queuedEpoch == s.epoch and Active and PackageAdmitted and s.historyEnabled) s.signature else s.historySignature }
  }
  action beginRead = all { not(s.readPending),
    s' = { ...s, readPending: true, readEpoch: s.epoch, readRevision: s.eventRevision } }
  action readComplete = all { s.readPending,
    s' = { ...s, readPending: false,
      rowPresent: s.readEpoch == s.epoch and s.readRevision == s.eventRevision and s.eventPresent
        and Active and PackageAdmitted and (not(s.native) or s.connected)
        and (not(s.native) or not(s.locked)),
      rowEpoch: s.readEpoch, rowRevision: s.readRevision,
      rowText: s.readEpoch == s.epoch and s.readRevision == s.eventRevision and s.eventPresent
        and Active and PackageAdmitted and (not(s.native) or s.connected)
        and s.preview and not(s.secret) and not(s.locked) } }
  action act(opening: bool): bool = all { CurrentRow, not(s.locked),
    if (opening) CanOpen else CanDismiss,
    s' = { ...s, lastActionExpectedEpoch: s.rowEpoch, lastActionActualEpoch: s.epoch,
      lastOpenOwned: if (opening) s.intentOwned and not(s.secret) else s.lastOpenOwned,
      eventPresent: if (not(opening) or s.autoCancel) false else s.eventPresent,
      rowPresent: if (not(opening) or s.autoCancel) false else s.rowPresent }
  }
  action makeOngoing = s' = { ...s, clearable: false, autoCancel: false }
  action foreignIntent = s' = { ...s, intentOwned: false }
  action otherUser = all { s.epoch < 4,
    s' = { ...s, sameUser: false, epoch: s.epoch + 1, rowPresent: false } }
  action mismatchUid = all { s.epoch < 4,
    s' = { ...s, uidMatches: false, epoch: s.epoch + 1, rowPresent: false } }
  action setOwnPackage = all { s.epoch < 4,
    s' = { ...s, ownPackage: true, epoch: s.epoch + 1, rowPresent: false } }
  action retentionTick = all { s.historyAge < 2, s' = { ...s, historyAge: s.historyAge + 1 } }
  action pruneHistory = s' = { ...s, historyCount: if (HistoryVisible) s.historyCount else 0 }
  action historyStorageFails = s' = { ...s, historyFailure: true, rowPresent: false }
  action clearHistory = all { s.epoch < 4,
    s' = { ...s, historyCount: 0, epoch: s.epoch + 1, rowPresent: false, rowText: false, historyFailure: false } }
  action disableOwnNotifications = s' = { ...s, appEnabled: false }
  action disableChannel = s' = { ...s, channelEnabled: false }
  action restart = all { s.epoch < 4,
    s' = { ...s, epoch: s.epoch + 1, rowPresent: false, rowText: false, readPending: false, connected: false,
      policyPending: false, queuedEvent: false } }
  action step = any {
    grantAccess, reviewPolicy(true, true, true, true), reviewPolicy(true, true, false, false),
    reviewPolicy(false, false, false, false), commitPolicy(true), commitPolicy(false),
    rejectChangedSelection, competingPolicyChange, pause, resume, revokeAccess, disconnectListener, replacePackage,
    lock, unlock, post(true), post(false), receiveQueuedEvent, beginRead, readComplete,
    act(true), act(false), makeOngoing, foreignIntent, otherUser, mismatchUid, setOwnPackage, retentionTick,
    pruneHistory, historyStorageFails, clearHistory, disableOwnNotifications, disableChannel,
    restart, s' = s
  }
  val PreviewNeedsConsent = TextVisible implies s.preview and not(s.secret) and not(s.locked)
  val CollectionNeedsAuthority = s.rowPresent implies Active and PackageAdmitted
    and s.rowEpoch == s.epoch and s.rowRevision == s.eventRevision
  val NativeRowsUnlocked = s.native and s.rowPresent implies not(s.locked) and s.connected
  val CurrentActionIdentity = s.lastActionExpectedEpoch == s.lastActionActualEpoch
  val OnlyPostingAppIntent = s.lastOpenOwned
  val RetainedHistoryBounded = s.historyCount.in(0.to(2)) and (HistoryVisible implies s.historyAge < 2)
  val ClearOnDisable = not(Active) implies s.historyCount == 0
  val TypeOK = s.epoch.in(0.to(4)) and s.signature.in(0.to(2)) and s.eventRevision.in(0.to(2))
  val safety = PreviewNeedsConsent and CollectionNeedsAuthority and NativeRowsUnlocked
    and CurrentActionIdentity and OnlyPostingAppIntent and RetainedHistoryBounded and ClearOnDisable and TypeOK
  run collectionOptInTest = init.then(grantAccess).then(post(false)).then(beginRead).then(readComplete)
    .expect(not(CurrentRow)).then(reviewPolicy(true, true, false, false)).then(commitPolicy(true))
    .then(beginRead).then(readComplete).expect(CurrentRow and not(TextVisible) and safety)
  run policyChangeFencesReadTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(false)).then(beginRead).then(competingPolicyChange)
    .then(readComplete).expect(not(CurrentRow) and safety)
  run policyChangeFencesHistoryTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(false)).then(clearHistory).then(receiveQueuedEvent)
    .expect(s.historyCount == 0 and safety)
  run lockRedactsTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(false)).then(beginRead).then(readComplete)
    .expect(TextVisible).then(lock).expect(not(TextVisible) and safety)
  run secretNeverOpensTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(true)).then(beginRead).then(readComplete)
    .expect(not(TextVisible) and s.secret and safety)
  run packageReplacementTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(false)).then(replacePackage).then(beginRead).then(readComplete)
    .expect(not(CurrentRow) and safety)
  run historyExpiresTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(false)).then(receiveQueuedEvent).expect(HistoryVisible)
    .then(retentionTick).then(retentionTick).then(pruneHistory).expect(s.historyCount == 0 and safety)
  run ownNotificationGateIndependentTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(false)).then(beginRead).then(readComplete)
    .then(disableOwnNotifications).expect(not(OwnNotificationVisible) and CurrentRow and safety)
  run nativeLockDropsRowsTest = initFor(true).then(grantAccess).then(reviewPolicy(true, true, true, false))
    .then(commitPolicy(true)).then(post(false)).then(lock).then(beginRead).then(readComplete)
    .expect(not(s.rowPresent) and not(TextVisible) and safety)
  run browserLockRedactsRowsTest = initFor(false).then(grantAccess).then(reviewPolicy(true, true, true, false))
    .then(commitPolicy(true)).then(post(false)).then(lock).then(beginRead).then(readComplete)
    .expect(s.rowPresent and not(TextVisible) and not(CanOpen) and safety)
  run changedPackageRequiresRemovalTest = initFor(true).then(grantAccess)
    .then(reviewPolicy(true, true, true, false)).then(commitPolicy(true)).then(replacePackage)
    .then(reviewPolicy(true, true, true, false)).expect(not(RepinAllowed))
    .then(rejectChangedSelection).then(reviewPolicy(true, false, false, false)).then(commitPolicy(true))
    .then(reviewPolicy(true, true, true, false)).then(commitPolicy(true)).expect(RepinAllowed and safety)
  run foreignIntentCannotOpenTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(false)).then(beginRead).then(readComplete)
    .then(foreignIntent).expect(not(CanOpen) and safety)
  run ongoingCannotDismissTest = init.then(grantAccess).then(reviewPolicy(true, true, true, true))
    .then(commitPolicy(true)).then(post(false)).then(beginRead).then(readComplete)
    .then(makeOngoing).expect(not(CanDismiss) and safety)
}

