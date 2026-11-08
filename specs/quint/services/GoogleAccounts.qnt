/// One captured Cloud session owns a Google request and its readback.
module GoogleAccounts {
  type Accounts = {
    owner: int, epoch: int, pendingEpoch: int, attempt: int, phase: str,
    account: int, readGrant: bool, modifyGrant: bool, calendarGrant: bool,
    cacheVisible: bool, review: bool, refreshNeeded: bool, returnMatched: bool,
    disconnectSent: bool, revoked: bool
  }
  var s: Accounts
  action init = s' = { owner: 1, epoch: 0, pendingEpoch: 0, attempt: 0, phase: "idle",
    account: 0, readGrant: false, modifyGrant: false, calendarGrant: false,
    cacheVisible: false, review: false, refreshNeeded: false, returnMatched: false,
    disconnectSent: false, revoked: false }
  action connect = all {
    s.phase.in(Set("idle", "denied", "failed")), s.attempt < 2,
    s' = { ...s, phase: "waiting", attempt: s.attempt + 1,
      pendingEpoch: s.epoch, returnMatched: false }
  }
  action appReturn(token: int, granted: bool): bool = all {
    s.phase == "waiting", s.pendingEpoch == s.epoch,
    if (token == s.attempt)
      s' = { ...s, returnMatched: true, refreshNeeded: true,
        phase: if (granted) "refreshing" else "denied" }
    else s' = s
  }
  /// Returning without a verified App Link still prompts an account-list read.
  action browserResume = all {
    s.phase == "waiting", s.pendingEpoch == s.epoch,
    s' = { ...s, phase: "refreshing", refreshNeeded: true }
  }
  action readback(account: int, read: bool, modify: bool, calendar: bool): bool = all {
    s.phase.in(Set("refreshing", "denied")), s.pendingEpoch == s.epoch,
    account.in(Set(0, 1, 2)), modify implies read,
    s' = { ...s, phase: "idle", account: account,
      readGrant: read and account != 0, modifyGrant: modify and account != 0,
      calendarGrant: calendar and account != 0, cacheVisible: false,
      review: false, refreshNeeded: false, revoked: false }
  }
  action cacheRead = all { s.readGrant, s.account != 0, s' = { ...s, cacheVisible: true } }
  action prepareReview = all { s.modifyGrant, s' = { ...s, review: true } }
  action withdrawModify = all { s.modifyGrant, s' = { ...s, modifyGrant: false, review: false } }
  action withdrawRead = all {
    s.readGrant, s' = { ...s, readGrant: false, modifyGrant: false, review: false, cacheVisible: false }
  }
  action disconnect = all {
    s.account != 0, not(s.disconnectSent),
    s' = { ...s, disconnectSent: true, phase: "disconnecting", review: false, cacheVisible: false }
  }
  action disconnectReadback(gone: bool): bool = all {
    s.phase == "disconnecting",
    s' = { ...s, phase: if (gone) "idle" else "failed", revoked: gone, disconnectSent: false,
      account: if (gone) 0 else s.account,
      readGrant: s.readGrant and not(gone), modifyGrant: s.modifyGrant and not(gone),
      calendarGrant: s.calendarGrant and not(gone), cacheVisible: false, review: false }
  }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1,
      phase: "idle", account: 0, readGrant: false, modifyGrant: false,
      calendarGrant: false, cacheVisible: false, review: false,
      refreshNeeded: false, disconnectSent: false, revoked: false }
  }
  action cancel = all { s.phase == "waiting", s' = { ...s, phase: "idle" } }
  action step = any {
    connect, appReturn(0, true), appReturn(s.attempt, true), appReturn(s.attempt, false),
    browserResume, readback(1, true, true, true), readback(2, true, false, true),
    readback(0, false, false, false), cacheRead, prepareReview, withdrawModify,
    withdrawRead, disconnect, disconnectReadback(false), disconnectReadback(true),
    switchOwner, cancel, s' = s
  }
  val ReviewNeedsCurrentModify = s.review implies s.modifyGrant and s.account != 0
  val CacheNeedsRead = s.cacheVisible implies s.readGrant and s.account != 0
  val ModifyIncludesRead = s.modifyGrant implies s.readGrant
  val RevokedAccountEmpty = s.revoked implies s.account == 0
  val TypeOK = s.phase.in(Set("idle", "waiting", "refreshing", "denied", "failed", "disconnecting")) and s.account.in(0.to(2)) and s.epoch.in(0.to(2)) and s.attempt.in(0.to(2))
  val safety = TypeOK and ReviewNeedsCurrentModify and CacheNeedsRead and ModifyIncludesRead and RevokedAccountEmpty
  run connectAndReadTest = init.then(connect).then(appReturn(0, true))
    .expect(s.phase == "waiting").then(appReturn(1, true))
    .then(readback(1, true, true, true)).then(cacheRead).then(prepareReview).expect(safety)
  run grantWithdrawalTest = init.then(connect).then(browserResume)
    .then(readback(1, true, true, true)).then(cacheRead).then(prepareReview)
    .then(withdrawModify).expect(not(s.review) and s.cacheVisible)
    .then(withdrawRead).expect(not(s.cacheVisible) and safety)
  run disconnectUncertainTest = init.then(connect).then(browserResume)
    .then(readback(1, true, true, true)).then(disconnect).then(disconnectReadback(false))
    .expect(not(s.revoked) and s.account == 1 and safety)
  run explicitDisconnectRetryTest = init.then(connect).then(browserResume)
    .then(readback(1, true, true, true)).then(disconnect).then(disconnectReadback(false))
    .then(disconnect).then(disconnectReadback(true)).expect(s.revoked and safety)
  run retiredAttemptTest = init.then(connect).then(switchOwner)
    .expect(s.phase == "idle" and s.account == 0 and safety)
}
