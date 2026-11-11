/// One captured Cloud session owns a Google request and its readback.
module GoogleAccounts {
  type Accounts = {
    owner: int, epoch: int, pendingEpoch: int, attempt: int, phase: str,
    account: int, readGrant: bool, modifyGrant: bool, calendarGrant: bool,
    cacheVisible: bool, review: bool, refreshNeeded: bool, returnMatched: bool,
    disconnectSent: bool, revoked: bool, disconnectOutcome: str, disconnectRowsKnown: bool,
    backgrounded: bool, nativeReturn: bool, drainBusy: bool, drainQueued: bool, drainEpoch: int, published: int,
    calendarMapped: bool, calendarCurrent: bool, calendarPause: str, callbackRetirement: str, revokeCalls: int
  }
  var s: Accounts
  action init = s' = { owner: 1, epoch: 0, pendingEpoch: 0, attempt: 0, phase: "idle",
    account: 0, readGrant: false, modifyGrant: false, calendarGrant: false,
    cacheVisible: false, review: false, refreshNeeded: false, returnMatched: false,
    disconnectSent: false, revoked: false, disconnectOutcome: "none", disconnectRowsKnown: false,
    backgrounded: false, nativeReturn: false, drainBusy: false, drainQueued: false, drainEpoch: 0, published: 0,
    calendarMapped: false, calendarCurrent: true, calendarPause: "unavailable", callbackRetirement: "unavailable", revokeCalls: 0 }
  action connect = all {
    s.phase.in(Set("idle", "denied", "failed")), s.attempt < 2,
    s' = { ...s, phase: "waiting", attempt: s.attempt + 1,
      pendingEpoch: s.epoch, returnMatched: false, backgrounded: false }
  }
  action appReturn(token: int, granted: bool): bool = all {
    s.phase == "waiting", s.pendingEpoch == s.epoch,
    if (token == s.attempt)
      s' = { ...s, returnMatched: true, refreshNeeded: true,
        phase: if (granted) "refreshing" else "denied" }
    else s' = s
  }
  /// Returning without a verified App Link still prompts an account-list read.
  action background = all { s.phase == "waiting", s' = {...s, backgrounded: true} }
  action refreshAccounts = s' = {...s, phase: "refreshing", refreshNeeded: true, pendingEpoch: s.epoch}
  action browserResume = all {
    s.phase == "waiting", s.backgrounded, s.pendingEpoch == s.epoch,
    s' = { ...s, phase: "refreshing", refreshNeeded: true, backgrounded: false }
  }
  action readback(account: int, read: bool, modify: bool, calendar: bool): bool = all {
    s.phase.in(Set("refreshing", "denied")), s.pendingEpoch == s.epoch,
    account.in(Set(0, 1, 2)), modify implies read,
    s' = { ...s, phase: "idle", account: account,
      readGrant: read and account != 0, modifyGrant: modify and account != 0,
      calendarGrant: calendar and account != 0, cacheVisible: false,
      review: false, refreshNeeded: false, revoked: false, disconnectOutcome: "none", disconnectRowsKnown: false }
  }
  /// AppReturn offers and native one-use consume callbacks never grant account capabilities.
  action returnOffer(supported: bool): bool = all { s.phase == "waiting", s' = { ...s, nativeReturn: supported } }
  action startDrain = all { not(s.drainBusy), s' = { ...s, drainBusy: true, drainQueued: false, drainEpoch: s.epoch } }
  action queueDrain = all { s.drainBusy, s' = { ...s, drainQueued: true } }
  action finishDrain(result: str): bool = all {
    s.drainBusy, result.in(Set("none", "connected", "denied", "failed", "invalid")), s.published < 2,
    { val accepted = s.drainEpoch == s.epoch and result.in(Set("connected", "denied", "failed"))
      s' = { ...s, drainBusy: false, published: s.published + (if(accepted) 1 else 0),
        phase: if(accepted) "refreshing" else s.phase, pendingEpoch: if(accepted)s.epoch else s.pendingEpoch, refreshNeeded: s.refreshNeeded or accepted }
    }
  }
  action calendarReview(mapped: bool): bool = all { not(s.disconnectSent), s' = { ...s, calendarMapped: mapped, calendarCurrent: true, calendarPause: "unavailable", callbackRetirement: "unavailable" } }
  action calendarChanged = s' = { ...s, calendarCurrent: false,
    calendarPause: if(s.calendarPause == "confirmed") "unknown" else s.calendarPause }
  action cleanupReply(pauseConfirmed: bool, retired: bool): bool = all {
    s.disconnectSent,
    s' = { ...s, calendarPause: if(not(s.calendarMapped)) "unavailable"
      else if(pauseConfirmed and s.calendarCurrent) "confirmed" else "unknown",
      callbackRetirement: if(retired) "confirmed" else "unknown" }
  }
  action cacheRead = all { s.readGrant, s.account != 0, s' = { ...s, cacheVisible: true } }
  action prepareReview = all { s.modifyGrant, s' = { ...s, review: true } }
  action withdrawModify = all { s.modifyGrant, s' = { ...s, modifyGrant: false, review: false } }
  action withdrawRead = all {
    s.readGrant, s' = { ...s, readGrant: false, modifyGrant: false, review: false, cacheVisible: false }
  }
  action disconnect = all {
    s.account != 0, not(s.disconnectSent), s.revokeCalls < 2,
    s' = { ...s, disconnectSent: true, phase: "disconnecting", review: false, cacheVisible: false, revokeCalls: s.revokeCalls + 1,
      disconnectOutcome: "none", disconnectRowsKnown: false,
      calendarPause: if(s.calendarMapped and s.calendarCurrent) "pending" else "unavailable", callbackRetirement: "pending" }
  }
  action disconnectReadback(outcome: str, rowsKnown: bool): bool = all {
    s.phase == "disconnecting",
    outcome.in(Set("disconnected", "still-connected", "unconfirmed")),
    not(rowsKnown) implies outcome == "unconfirmed",
    val gone = outcome == "disconnected"
    s' = { ...s, phase: if (gone) "idle" else "failed", revoked: gone, disconnectSent: false,
      disconnectOutcome: outcome, disconnectRowsKnown: rowsKnown,
      account: if (gone) 0 else s.account,
      readGrant: s.readGrant and not(gone), modifyGrant: s.modifyGrant and not(gone),
      calendarGrant: s.calendarGrant and not(gone), cacheVisible: false, review: false }
  }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1,
      phase: "idle", account: 0, readGrant: false, modifyGrant: false,
      calendarGrant: false, cacheVisible: false, review: false,
      refreshNeeded: false, disconnectSent: false, revoked: false, backgrounded: false, nativeReturn: false,
      disconnectOutcome: "none", disconnectRowsKnown: false,
      calendarMapped: false, calendarCurrent: false, calendarPause: "unavailable", callbackRetirement: "unavailable" }
  }
  action cancel = all { s.phase == "waiting", s' = { ...s, phase: "idle" } }
  action step = any {
    connect, appReturn(0, true), appReturn(s.attempt, true), appReturn(s.attempt, false),
    background, refreshAccounts, browserResume, readback(1, true, true, true), readback(2, true, false, true),
    readback(0, false, false, false), cacheRead, prepareReview, withdrawModify,
    withdrawRead, disconnect, disconnectReadback("disconnected", true), disconnectReadback("still-connected", true),
    disconnectReadback("unconfirmed", false), disconnectReadback("unconfirmed", true),
    returnOffer(true), returnOffer(false), startDrain, queueDrain, finishDrain("none"), finishDrain("connected"),
    finishDrain("denied"), finishDrain("failed"), finishDrain("invalid"), calendarReview(true), calendarReview(false),
    calendarChanged, cleanupReply(true,true), cleanupReply(false,false), switchOwner, cancel, s' = s
  }
  val ReviewNeedsCurrentModify = s.review implies s.modifyGrant and s.account != 0
  val CacheNeedsRead = s.cacheVisible implies s.readGrant and s.account != 0
  val ModifyIncludesRead = s.modifyGrant implies s.readGrant
  val RevokedAccountEmpty = s.revoked implies s.account == 0
  val DisconnectOutcomeNeedsReadback = (s.revoked == (s.disconnectOutcome == "disconnected")) and
    (s.disconnectOutcome.in(Set("disconnected", "still-connected")) implies s.disconnectRowsKnown)
  val TypeOK = s.phase.in(Set("idle", "waiting", "refreshing", "denied", "failed", "disconnecting")) and s.account.in(0.to(2)) and s.epoch.in(0.to(2)) and s.attempt.in(0.to(2))
    and s.disconnectOutcome.in(Set("none", "disconnected", "still-connected", "unconfirmed"))
  val CleanupIsCurrent = s.calendarPause == "confirmed" implies s.calendarMapped and s.calendarCurrent
  val BoundedCallbackPublication = s.published.in(0.to(2)) and s.revokeCalls.in(0.to(2))
  val safety = CleanupIsCurrent and BoundedCallbackPublication and TypeOK and ReviewNeedsCurrentModify and CacheNeedsRead and
    ModifyIncludesRead and RevokedAccountEmpty and DisconnectOutcomeNeedsReadback
  run connectAndReadTest = init.then(connect).then(appReturn(0, true))
    .expect(s.phase == "waiting").then(appReturn(1, true))
    .then(readback(1, true, true, true)).then(cacheRead).then(prepareReview).expect(safety)
  run grantWithdrawalTest = init.then(connect).then(background).then(browserResume)
    .then(readback(1, true, true, true)).then(cacheRead).then(prepareReview)
    .then(withdrawModify).expect(not(s.review) and s.cacheVisible)
    .then(withdrawRead).expect(not(s.cacheVisible) and safety)
  run disconnectUncertainTest = init.then(connect).then(background).then(browserResume)
    .then(readback(1, true, true, true)).then(disconnect).then(disconnectReadback("unconfirmed", false))
    .expect(s.disconnectOutcome == "unconfirmed" and not(s.disconnectRowsKnown) and not(s.revoked) and s.account == 1 and safety)
  run disconnectUncertainWithRowsTest = init.then(connect).then(background).then(browserResume)
    .then(readback(1, true, true, true)).then(disconnect).then(disconnectReadback("unconfirmed", true))
    .expect(s.disconnectOutcome == "unconfirmed" and s.disconnectRowsKnown and not(s.revoked) and s.account == 1 and safety)
  run explicitDisconnectRetryTest = init.then(connect).then(background).then(browserResume)
    .then(readback(1, true, true, true)).then(disconnect).then(disconnectReadback("still-connected", true))
    .expect(s.disconnectOutcome == "still-connected" and s.disconnectRowsKnown and not(s.revoked) and safety)
    .then(disconnect).then(disconnectReadback("disconnected", true)).expect(s.revoked and safety)
  run retiredAttemptTest = init.then(connect).then(switchOwner)
    .expect(s.phase == "idle" and s.account == 0 and safety)
  run coldReturnReadbackTest = init.then(startDrain).then(finishDrain("connected"))
    .expect(not(s.readGrant) and s.refreshNeeded and s.published == 1)
    .then(readback(1,true,true,true)).expect(safety)
  run queuedReturnDrainTest = init.then(startDrain).then(queueDrain).then(queueDrain)
    .then(finishDrain("none")).then(startDrain).then(finishDrain("connected"))
    .expect(s.published == 1 and safety)
  run staleNativeReturnTest = init.then(startDrain).then(switchOwner).then(finishDrain("connected"))
    .expect(s.published == 0 and not(s.refreshNeeded) and safety)
  run replacementReviewRetiresOldCleanupTest = init.then(connect).then(background).then(browserResume).then(readback(1,true,true,true))
    .then(calendarReview(true)).then(disconnect).then(cleanupReply(true,true)).then(disconnectReadback("disconnected", true))
    .then(calendarReview(false)).expect(s.calendarPause == "unavailable" and safety)
  run newOwnerNativeReturnReadbackTest = init.then(switchOwner).then(startDrain).then(finishDrain("connected"))
    .then(readback(1,true,true,true)).expect(s.account == 1 and safety)
  run foregroundSignalNeedsBackgroundTest = init.then(connect).expect(not(s.backgrounded))
    .then(background).then(browserResume).expect(s.refreshNeeded and not(s.backgrounded) and safety)
  run optionalCleanupCannotBlockPrivacyTest = init.then(connect).then(background).then(browserResume)
    .then(readback(1,true,true,true)).then(calendarReview(true)).then(disconnect)
    .then(calendarChanged).then(cleanupReply(true,false)).then(disconnectReadback("disconnected", true))
    .expect(s.revoked and s.calendarPause == "unknown" and safety)

}
