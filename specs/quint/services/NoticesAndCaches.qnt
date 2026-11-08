/// Owner retirement, delivery claims, acknowledgements and bounded read-only snapshots.
module NoticesAndCaches {
  type Notices = {
    owner: int, epoch: int, transitionEpoch: int, phase: str, retry: bool,
    noticeOwner: int, notice: str, posted: bool, acknowledgements: int,
    claim: int, cacheOwner: int, cacheEpoch: int, cacheAge: int,
    cachePresent: bool, cacheVisible: bool, cacheWritePending: bool,
    callbackEpoch: int, consumed: bool
  }
  var s: Notices
  action init = s' = {
    owner: 1, epoch: 0, transitionEpoch: 0, phase: "ready", retry: false,
    noticeOwner: 0, notice: "empty", posted: false, acknowledgements: 0,
    claim: 0, cacheOwner: 0, cacheEpoch: 0, cacheAge: 0,
    cachePresent: false, cacheVisible: false, cacheWritePending: false,
    callbackEpoch: 0, consumed: false }
  action beginCacheWrite = all {
    not(s.cacheWritePending), s' = { ...s, cacheWritePending: true, callbackEpoch: s.epoch }
  }
  action cacheWriteReply = all {
    s.cacheWritePending,
    if (s.callbackEpoch == s.epoch)
      s' = { ...s, cacheWritePending: false, cachePresent: true,
        cacheOwner: s.owner, cacheEpoch: s.epoch, cacheAge: 0 }
    else s' = { ...s, cacheWritePending: false }
  }
  action readCache = all {
    s.cachePresent, s.cacheOwner == s.owner, s.cacheEpoch == s.epoch, s.cacheAge < 2,
    s' = { ...s, cacheVisible: true }
  }
  action expireCache = all {
    s.cachePresent, s.cacheAge < 2,
    s' = { ...s, cacheAge: s.cacheAge + 1, cacheVisible: s.cacheAge < 1 and s.cacheVisible }
  }
  action clearCache = all {
    s.epoch < 2,
    s' = { ...s, epoch: s.epoch + 1, cachePresent: false, cacheVisible: false }
  }
  action enqueueNotice = all {
    s.phase == "ready", s.notice == "empty",
    s' = { ...s, notice: "queued", noticeOwner: s.owner }
  }
  action claimNotice(holder: int): bool = all {
    s.notice == "queued", s.claim == 0, s.noticeOwner == s.owner, s.phase == "ready",
    s' = { ...s, notice: "claimed", claim: holder }
  }
  action postNotice = all {
    s.notice == "claimed", s.noticeOwner == s.owner, s.phase == "ready",
    s' = { ...s, notice: "posted", posted: true }
  }
  action tap = all {
    s.notice == "posted", s.noticeOwner == s.owner, not(s.consumed),
    s' = { ...s, notice: "consumed", consumed: true, posted: false }
  }
  action acknowledge = all {
    s.notice == "consumed", s.acknowledgements == 0,
    s' = { ...s, notice: "acknowledged", acknowledgements: 1 }
  }
  /// Retry retains the delivery identity. A restart does not enqueue a duplicate.
  action restart = s' = { ...s, notice: if (s.notice == "claimed") "queued" else s.notice,
    claim: if (s.notice == "claimed") 0 else s.claim }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, epoch: s.epoch + 1,
      transitionEpoch: s.epoch + 1, phase: "retiring", retry: false,
      posted: false, cacheVisible: false }
  }
  action transitionReply(success: bool): bool = all {
    s.phase == "retiring",
    s' = { ...s, phase: if (success) "ready" else "retiring", retry: not(success),
      notice: if (success) "empty" else s.notice, claim: if (success) 0 else s.claim,
      consumed: if (success) false else s.consumed,
      acknowledgements: if (success) 0 else s.acknowledgements }
  }
  action step = any {
    beginCacheWrite, cacheWriteReply, readCache, expireCache, clearCache, enqueueNotice,
    claimNotice(1), claimNotice(2), postNotice, tap, acknowledge, restart,
    switchOwner, transitionReply(true), transitionReply(false), s' = s
  }
  val CacheOwnerIsolation = s.cacheVisible implies s.cacheOwner == s.owner and s.cacheEpoch == s.epoch and s.cacheAge < 2
  val PostedOwnerIsolation = s.posted implies s.noticeOwner == s.owner and s.phase == "ready"
  val OneAcknowledgement = s.acknowledgements <= 1
  val ClaimExclusive = s.notice == "claimed" implies s.claim.in(Set(1, 2))
  val NoPostAfterConsume = s.consumed implies not(s.posted)
  val TypeOK = s.phase.in(Set("ready", "retiring")) and s.notice.in(Set("empty", "queued", "claimed", "posted", "consumed", "acknowledged")) and s.cacheAge.in(0.to(2)) and s.epoch.in(0.to(2)) and s.claim.in(0.to(2))
  val safety = TypeOK and CacheOwnerIsolation and PostedOwnerIsolation and OneAcknowledgement and ClaimExclusive and NoPostAfterConsume
  run deliveredOnceTest = init.then(enqueueNotice).then(claimNotice(1)).then(postNotice)
    .then(tap).then(acknowledge).then(restart).expect(s.acknowledgements == 1 and safety)
  run retirementRetryTest = init.then(enqueueNotice).then(claimNotice(1)).then(postNotice)
    .then(switchOwner).then(transitionReply(false)).expect(not(s.posted) and s.retry)
    .then(transitionReply(true)).expect(s.notice == "empty" and safety)
  run clearFencesWriteTest = init.then(beginCacheWrite).then(clearCache).then(cacheWriteReply)
    .expect(not(s.cachePresent) and safety)
  run expiredCacheTest = init.then(beginCacheWrite).then(cacheWriteReply).then(readCache)
    .then(expireCache).then(expireCache).expect(not(s.cacheVisible) and safety)
}
