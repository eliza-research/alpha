/// Selected-account Inbox operations persist intent before a single provider dispatch.
module InboxDelivery {
  type Inbox = {
    owner: int, grant: int, epoch: int, opOwner: int, opGrant: int, requestEpoch: int,
    phase: str, read: bool, modify: bool, draftRevision: int, reviewedRevision: int,
    attachments: int, reviewedAttachments: int, exactReview: bool, durable: bool,
    dispatches: int, outcome: str, providerConfirmed: bool, draftExists: bool,
    cacheOwner: int, cacheGrant: int, cacheVisible: bool
  }
  var s: Inbox
  action init = s' = {
    owner: 1, grant: 1, epoch: 0, opOwner: 0, opGrant: 0, requestEpoch: 0,
    phase: "empty", read: true, modify: true, draftRevision: 0, reviewedRevision: 0,
    attachments: 0, reviewedAttachments: 0, exactReview: false, durable: false,
    dispatches: 0, outcome: "none", providerConfirmed: false, draftExists: true,
    cacheOwner: 0, cacheGrant: 0, cacheVisible: false }
  action cacheRead = all {
    s.read, s' = { ...s, cacheOwner: s.owner, cacheGrant: s.grant, cacheVisible: true }
  }
  action editDraft = all {
    s.draftExists, s.draftRevision < 2,
    s' = { ...s, draftRevision: s.draftRevision + 1 }
  }
  action attach = all {
    s.draftExists, s.attachments < 2,
    s' = { ...s, attachments: s.attachments + 1, draftRevision: if (s.draftRevision < 2) s.draftRevision + 1 else 2 }
  }
  action prepare = all {
    s.phase == "empty", s.modify, s.draftExists, s.dispatches == 0,
    s' = { ...s, phase: "preparing", opOwner: s.owner, opGrant: s.grant,
      requestEpoch: s.epoch, durable: true }
  }
  action review(exact: bool): bool = all {
    s.phase == "preparing", s.opOwner == s.owner, s.opGrant == s.grant,
    s.requestEpoch == s.epoch,
    s' = { ...s, phase: if (exact) "review" else "preparing",
      exactReview: exact, reviewedRevision: s.draftRevision, reviewedAttachments: s.attachments }
  }
  action confirm = all {
    s.phase == "review", s.modify, s.read, s.exactReview,
    s.opOwner == s.owner, s.opGrant == s.grant, s.requestEpoch == s.epoch,
    s.reviewedRevision == s.draftRevision, s.reviewedAttachments == s.attachments,
    s.dispatches == 0,
    s' = { ...s, phase: "dispatching", dispatches: 1, durable: true, outcome: "unknown" }
  }
  action providerReply(outcome: str): bool = all {
    s.phase == "dispatching", s.opOwner == s.owner, s.opGrant == s.grant,
    s.requestEpoch == s.epoch, outcome.in(Set("succeeded", "rejected", "unknown", "prepared")),
    s' = { ...s, phase: if (outcome == "prepared") "dispatching" else "observed",
      outcome: if (outcome == "prepared") "unknown" else outcome,
      providerConfirmed: outcome == "succeeded" }
  }
  /// Recovery reads the retained operation ID. It never redispatches it.
  action restart = s' = { ...s, providerConfirmed: false }
  action readReceipt(agrees: bool): bool = all {
    s.phase.in(Set("dispatching", "observed")), s.opOwner == s.owner, s.opGrant == s.grant,
    s' = { ...s, phase: if (agrees) "observed" else s.phase,
      outcome: if (agrees) "succeeded" else s.outcome, providerConfirmed: agrees }
  }
  action cleanupDraft = all {
    s.phase == "observed", s.outcome == "succeeded", s.providerConfirmed,
    s.opOwner == s.owner, s.opGrant == s.grant,
    s' = { ...s, draftExists: false }
  }
  action cancelReview = all {
    s.phase.in(Set("preparing", "review")),
    s' = { ...s, phase: "empty", durable: false, exactReview: false }
  }
  action withdrawModify = s' = { ...s, modify: false,
    phase: if (s.phase.in(Set("preparing", "review"))) "empty" else s.phase,
    exactReview: false }
  action withdrawRead = s' = { ...s, read: false, modify: false, cacheVisible: false,
    phase: if (s.phase.in(Set("preparing", "review"))) "empty" else s.phase,
    exactReview: false }
  /// A fresh grant read enables new review; discarded reviews and caches remain discarded.
  action restoreGrants = s' = { ...s, read: true, modify: true }
  action switchOwner = all {
    s.epoch < 2,
    s' = { ...s, owner: if (s.owner == 1) 2 else 1, grant: if (s.grant == 1) 2 else 1,
      epoch: s.epoch + 1, cacheVisible: false, providerConfirmed: false,
      phase: if (s.phase.in(Set("preparing", "review"))) "empty" else s.phase,
      exactReview: false }
  }
  action step = any {
    cacheRead, editDraft, attach, prepare, review(true), review(false), confirm,
    providerReply("succeeded"), providerReply("rejected"), providerReply("unknown"),
    providerReply("prepared"), restart, readReceipt(false), readReceipt(true),
    cleanupDraft, cancelReview, withdrawModify, withdrawRead, restoreGrants, switchOwner, s' = s
  }
  val AtMostOneDispatch = s.dispatches <= 1
  val PersistBeforeDispatch = s.phase == "dispatching" implies s.durable and s.dispatches == 1
  val CacheBound = s.cacheVisible implies s.read and s.cacheOwner == s.owner and s.cacheGrant == s.grant
  val SuccessfulCleanup = not(s.draftExists) implies s.outcome == "succeeded"
  val UnknownCannotRearm = s.outcome == "unknown" implies s.phase.in(Set("dispatching", "observed"))
  val TypeOK = s.phase.in(Set("empty", "preparing", "review", "dispatching", "observed")) and s.outcome.in(Set("none", "unknown", "succeeded", "rejected")) and s.epoch.in(0.to(2)) and s.attachments.in(0.to(2)) and s.draftRevision.in(0.to(2))
  val safety = TypeOK and AtMostOneDispatch and PersistBeforeDispatch and CacheBound and SuccessfulCleanup and UnknownCannotRearm
  run exactReviewTest = init.then(attach).then(prepare).then(review(false))
    .expect(s.phase == "preparing").then(review(true)).then(confirm)
    .then(providerReply("succeeded")).then(cleanupDraft).expect(safety and not(s.draftExists))
  run changedDraftTest = init.then(prepare).then(review(true)).then(editDraft)
    .expect(s.reviewedRevision != s.draftRevision and s.dispatches == 0 and safety)
  run uncertainRecoveryTest = init.then(prepare).then(review(true)).then(confirm)
    .then(restart).then(readReceipt(false)).expect(s.draftExists and s.dispatches == 1)
    .then(readReceipt(true)).then(cleanupDraft).expect(safety)
  run restoredGrantNeedsFreshReviewTest = init.then(cacheRead).then(prepare).then(review(true))
    .then(withdrawRead).then(restoreGrants)
    .expect(s.phase == "empty" and not(s.exactReview or s.cacheVisible) and s.dispatches == 0)
    .then(prepare).then(review(true)).then(confirm).then(providerReply("succeeded"))
    .expect(s.dispatches == 1 and s.providerConfirmed and safety)
  run restoredGrantKeepsUnknownTest = init.then(prepare).then(review(true)).then(confirm)
    .then(withdrawRead).then(restoreGrants)
    .expect(s.phase == "dispatching" and s.outcome == "unknown" and s.dispatches == 1)
    .then(readReceipt(true)).then(cleanupDraft).expect(not(s.draftExists) and s.dispatches == 1 and safety)
  run restoredGrantKeepsOwnerFenceTest = init.then(prepare).then(review(true)).then(confirm)
    .then(withdrawRead).then(switchOwner).then(restoreGrants)
    .expect(s.opOwner != s.owner and s.opGrant != s.grant and s.requestEpoch != s.epoch
      and s.phase == "dispatching" and s.dispatches == 1 and not(s.providerConfirmed or s.cacheVisible) and safety)
  run grantRevocationTest = init.then(cacheRead).then(prepare).then(review(true))
    .then(withdrawRead).expect(s.phase == "empty" and not(s.cacheVisible) and safety)
}
