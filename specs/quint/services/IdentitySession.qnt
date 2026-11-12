/// Native Cloud sign-in. Source mappings and finite abstractions are in manifest.json.
module IdentitySession {
  type Activation = {
    owner: int, phase: str, receipt: bool, acknowledged: bool, ackTries: int,
    oldKey: bool, revoked: bool, steward: bool, running: bool
  }
  val noActivation = { owner: 0, phase: "idle", receipt: false, acknowledged: false,
    ackTries: 0, oldKey: false, revoked: false, steward: false, running: false }
  type Session = {
    phase: str, method: str, epoch: int, owner: int, ownerEpoch: int, attemptOwner: int,
    pending: bool, pendingOwner: int, liveIntent: bool, pendingWrite: bool, cleanupOwner: int, activation: Activation, consumed: Set[int], wrongCodes: int, cooldown: bool,
    receipt: bool, key: bool, acknowledged: bool, ackTries: int,
    oldKey: bool, revoked: bool, steward: bool, callbackAccepted: bool, cancelRequested: bool
  }
  var s: Session
  action init = s' = {
    phase: "idle", method: "none", epoch: 0, owner: 0, ownerEpoch: 0, attemptOwner: 0,
    pending: false, pendingOwner: 0, liveIntent: false, pendingWrite: false, cleanupOwner: 0, activation: noActivation, consumed: Set(), wrongCodes: 0, cooldown: false,
    receipt: false, key: false, acknowledged: false, ackTries: 0,
    oldKey: false, revoked: false, steward: false, callbackAccepted: false, cancelRequested: false
  }
  val workerBusy = s.activation.running or s.cleanupOwner != 0 or s.steward
  /// The current Attempt may be replaced while its old worker is still returning.
  action begin(method: str): bool = all {
    s.phase.in(Set("idle", "authenticated", "cancelled", "expired", "exhausted", "failed", "activation-pending"))
      or (s.key and s.cancelRequested),
    s.epoch < 2,
    method.in(Set("google", "email", "phone")),
    not(s.cooldown),
    s' = { ...s, phase: if (workerBusy) "starting" else if (method == "google") "browser" else "code",
      cleanupOwner: if (s.steward and not(s.activation.running)) s.attemptOwner else s.cleanupOwner,
      method: method, epoch: s.epoch + 1, attemptOwner: s.epoch + 1, liveIntent: true,
      pending: if (method == "google" and not(workerBusy)) true else s.pending,
      pendingOwner: if (method == "google" and not(workerBusy)) s.epoch + 1 else s.pendingOwner,
      pendingWrite: method == "google" and workerBusy,
      wrongCodes: 0, cooldown: method != "google",
      receipt: false, key: false, acknowledged: false, ackTries: 0,
      oldKey: s.owner != 0, revoked: false, steward: false, callbackAccepted: false, cancelRequested: false }
  }
  /// The serialized worker reaches the new attempt only after the previous activation returns.
  action beginWork = all {
    s.phase == "starting", not(s.activation.running), s.cleanupOwner == 0,
    s' = { ...s, phase: if (s.method == "google") "browser" else "code",
      pending: if (s.method == "google") true else s.pending,
      pendingOwner: if (s.method == "google") s.attemptOwner else s.pendingOwner, pendingWrite: false }
  }
  /// A replacement can retire the previous durable browser record after its own admission.
  action retireOrphanedPending = all { s.pending, s.pendingOwner != s.attemptOwner,
    s' = { ...s, pending: false, pendingOwner: 0, consumed: s.consumed.union(Set(s.pendingOwner)) } }
  action orphanedCallback = all {
    s.pending, not(s.liveIntent) or s.pendingOwner != s.attemptOwner, s' = s
  }
  /// Wrong-state callbacks do not burn the encrypted pending record.
  action callback(token: int): bool = all {
    s.phase == "browser", s.pending, s.pendingOwner == s.attemptOwner, not(s.activation.running), s.cleanupOwner == 0,
    if (s.liveIntent and token == s.epoch)
      s' = { ...s, phase: "exchange", pending: false, pendingOwner: 0,
        consumed: s.consumed.union(Set(token)), callbackAccepted: true }
    else s' = s
  }
  /// A failed durable burn retains the record and cannot enter exchange.
  action callbackBurnFailed = all {
    s.phase == "browser", s.pending, s.pendingOwner == s.attemptOwner, not(s.activation.running), s.cleanupOwner == 0,
    s' = { ...s, phase: "failed", callbackAccepted: false }
  }
  /// Failed cancellation cannot claim that the stored pending record was removed.
  action cancelBurnFailed = all {
    s.phase == "browser", s.pending,
    s' = { ...s, phase: "cancelled", liveIntent: false, cancelRequested: true, callbackAccepted: false }
  }
  /// Reloading an unretired record does not mint a new in-memory credential intent.
  action restorePending = all {
    s.pending, s.phase.in(Set("failed", "cancelled")),
    s' = { ...s, phase: "browser", liveIntent: false, cancelRequested: false }
  }
  /// Browser resume without a result leaves the pending record for a late return.
  action browserClosed = all { s.phase == "browser", s' = s }
  /// The browser-return grace deadline retires authority even if durable retirement fails.
  action browserGraceElapsed(retired: bool): bool = all {
    s.phase == "browser", s.pending, s.liveIntent,
    s' = { ...s, phase: "cancelled", liveIntent: false, cancelRequested: true,
      pending: not(retired), pendingOwner: if (retired) 0 else s.pendingOwner,
      consumed: if (retired) s.consumed.union(Set(s.pendingOwner)) else s.consumed }
  }
  action wrongCode = all {
    s.phase.in(Set("code", "mfa")), s.wrongCodes < 5,
    s' = { ...s, wrongCodes: s.wrongCodes + 1,
      phase: if (s.wrongCodes == 4) "exhausted" else s.phase }
  }
  action codeVerified(needsMfa: bool): bool = all {
    s.phase.in(Set("code", "mfa")), s.wrongCodes < 5,
    s' = { ...s, phase: if (needsMfa) "mfa" else "exchange", wrongCodes: if (needsMfa) 0 else s.wrongCodes }
  }
  action mfaVerified = all { s.phase == "mfa", s.wrongCodes < 5, s' = { ...s, phase: "exchange" } }
  action exchanged = all {
    s.phase == "exchange", not(s.activation.running), s.cleanupOwner == 0,
    s' = { ...s, phase: "minted", steward: true }
  }
  action writeReceipt = all {
    s.phase == "minted", s' = { ...s, receipt: true, phase: "receipt-saved",
      activation: if (s.activation.owner != s.attemptOwner)
        { ...s.activation, receipt: false } else s.activation }
  }
  /// A storage failure cannot proceed to acknowledging an unsaved key.
  action storageFailure = all {
    s.phase.in(Set("minted", "receipt-saved")), s' = { ...s, phase: "failed" }
  }
  action writeKey = all {
    s.phase == "receipt-saved", s.receipt, not(s.activation.running),
    s' = { ...s, key: true, owner: s.attemptOwner, ownerEpoch: s.epoch, phase: "acknowledging",
      activation: { owner: s.attemptOwner, phase: "acknowledging", receipt: true,
        acknowledged: false, ackTries: 0, oldKey: s.oldKey, revoked: false,
        steward: s.steward, running: true } }
  }
  action ackWithReceipt(success: bool, retained: bool): bool = all {
    s.activation.phase == "acknowledging", s.activation.receipt,
    s.owner == s.activation.owner, s.activation.ackTries < 3,
    val finished = success or s.activation.ackTries == 2
    val phase = if (finished and s.activation.oldKey) "revoking-previous"
      else if (success) "authenticated" else if (finished) "activation-pending" else "acknowledging"
    val current = s.key and s.attemptOwner == s.activation.owner
    val updated = { ...s.activation, phase: phase, acknowledged: success, receipt: not(success) or retained,
      ackTries: s.activation.ackTries + 1,
      running: s.activation.steward or phase == "acknowledging" or phase == "revoking-previous" }
    s' = { ...s, activation: updated,
      phase: if (current) phase else s.phase,
      acknowledged: if (current) updated.acknowledged else s.acknowledged,
      receipt: if (current) updated.receipt else s.receipt,
      ackTries: if (current) updated.ackTries else s.ackTries }
  }
  action ack(success: bool): bool = ackWithReceipt(success, false)
  /// Restart drops transient revocation authority and preserves any already-observed server revocation.
  action restart = if (s.owner == 0) {
    s' = { ...s, phase: if (s.pending) "browser" else "idle",
      attemptOwner: if (s.pending) s.attemptOwner else 0,
      pendingWrite: false, liveIntent: false, cleanupOwner: 0, key: false, receipt: false,
      acknowledged: false, ackTries: 0, oldKey: false, revoked: false,
      steward: false, callbackAccepted: false, cancelRequested: false, activation: noActivation }
  } else all {
    s.activation.owner == s.owner,
    val phase = if (s.activation.receipt) "acknowledging"
      else if (s.activation.acknowledged) "authenticated" else "activation-pending"
    val recovered = { ...s.activation, phase: phase, ackTries: 0, oldKey: false,
      steward: false, running: s.activation.receipt }
    s' = if (s.pending) { ...s, phase: "browser", activation: recovered,
      pendingWrite: false, liveIntent: false, cleanupOwner: 0, steward: false, callbackAccepted: false, cancelRequested: false }
    else { ...s, activation: recovered, phase: phase, attemptOwner: s.owner,
      pendingWrite: false, liveIntent: false, cleanupOwner: 0, key: true, receipt: recovered.receipt,
      acknowledged: recovered.acknowledged, ackTries: 0, oldKey: false, revoked: recovered.revoked,
      steward: false, callbackAccepted: false }
  }
  action revokePrevious(success: bool): bool = all {
    s.activation.phase == "revoking-previous", s.activation.oldKey,
    val phase = if (s.activation.acknowledged) "authenticated" else "activation-pending"
    val current = s.key and s.attemptOwner == s.activation.owner
    s' = { ...s,
      activation: { ...s.activation, phase: phase, oldKey: false, revoked: success,
        running: s.activation.steward },
      phase: if (current) phase else s.phase,
      oldKey: if (current) false else s.oldKey,
      revoked: if (current) success else s.revoked }
  }
  action cooldownElapsed = all { s.cooldown, s' = { ...s, cooldown: false } }
  /// Key persistence is the commit point. Cancelling the UI cannot stop activation.
  action cancel = all {
    not(s.phase.in(Set("idle", "authenticated"))),
    if (s.key) s' = { ...s, cancelRequested: true, liveIntent: false }
    else s' = { ...s, phase: "cancelled",
      pending: s.pending and s.pendingOwner != s.attemptOwner,
      pendingOwner: if (s.pendingOwner == s.attemptOwner) 0 else s.pendingOwner,
      liveIntent: false, pendingWrite: false, cancelRequested: true,
      consumed: if (s.method == "google") s.consumed.union(Set(s.epoch)) else s.consumed }
  }
  /// complete() publishes authentication before its finally block drops the transient session.
  action releaseSteward = all {
    val currentDone = s.steward and s.phase.in(Set("authenticated", "activation-pending", "cancelled", "failed"))
    val activationDone = s.activation.steward and s.activation.phase.in(Set("authenticated", "activation-pending"))
    all { currentDone or activationDone or s.cleanupOwner != 0,
      s' = { ...s, cleanupOwner: 0, steward: if (currentDone) false else s.steward,
        activation: if (activationDone) { ...s.activation, steward: false, running: false } else s.activation } }
  }
  action expire = all {
    s.pending,
    s' = { ...s, phase: "expired", pending: false, pendingOwner: 0, liveIntent: false,
      consumed: s.consumed.union(Set(s.pendingOwner)) }
  }
  action signOut = all {
    s.owner != 0,
    s' = { ...s, owner: 0, key: false, acknowledged: false, receipt: false,
      phase: "idle", pending: false, pendingOwner: 0, liveIntent: false, pendingWrite: false, cleanupOwner: 0, steward: false, activation: noActivation }
  }
  action step = any {
    begin("google"), begin("email"), begin("phone"), beginWork, retireOrphanedPending, orphanedCallback, callback(0), callback(s.epoch),
    browserClosed, browserGraceElapsed(true), browserGraceElapsed(false), callbackBurnFailed, cancelBurnFailed, restorePending, wrongCode, codeVerified(false), codeVerified(true), mfaVerified,
    exchanged, writeReceipt, storageFailure, writeKey, ack(false), ack(true),
    ackWithReceipt(true, true), restart, revokePrevious(false), revokePrevious(true), cooldownElapsed,
    cancel, releaseSteward, expire, signOut, s' = s
  }
  val KeyBeforeAck = s.acknowledged implies (s.key and s.owner == s.attemptOwner)
  val DurableReceiptBeforeKey = s.phase == "acknowledging" implies (s.receipt and s.key)
  val SingleUseGoogleReturn = s.pending implies not(s.pendingOwner.in(s.consumed))
  val MatchedReturnBurned = s.callbackAccepted implies s.epoch.in(s.consumed)
  val BoundedAttempts = s.wrongCodes <= 5 and s.ackTries <= 3 and s.activation.ackTries <= 3
  val NoExchangeWithPending = s.phase.in(Set("exchange", "minted", "receipt-saved", "acknowledging", "activation-pending", "revoking-previous", "authenticated")) implies not(s.pending and s.pendingOwner == s.attemptOwner)
  val AuthenticatedKey = s.phase == "authenticated" implies s.key and s.acknowledged
  val PendingWriteNotDurable = s.pendingWrite implies s.phase == "starting" and s.method == "google" and s.pendingOwner != s.attemptOwner
  val ActivationOwnsStoredKey = (s.activation.running or s.activation.acknowledged) implies s.activation.owner == s.owner and s.owner != 0
  val ActivationReceiptBeforeAck = s.activation.phase == "acknowledging" implies s.activation.receipt and s.activation.owner == s.owner
  val CurrentActivationProjection = (s.key and s.attemptOwner == s.activation.owner) implies
    (s.phase == s.activation.phase and s.receipt == s.activation.receipt and s.acknowledged == s.activation.acknowledged
      and s.ackTries == s.activation.ackTries and s.oldKey == s.activation.oldKey
      and s.revoked == s.activation.revoked and s.steward == s.activation.steward)
  val SerializedActivationWorker = s.phase.in(Set("exchange", "minted", "receipt-saved")) implies not(s.activation.running) and s.cleanupOwner == 0
  val TypeOK = s.pendingOwner.in(0.to(2)) and (s.pending == (s.pendingOwner != 0)) and s.phase.in(Set("idle", "starting", "browser", "code", "mfa", "exchange", "minted", "receipt-saved", "acknowledging", "activation-pending", "authenticated", "cancelled", "expired", "exhausted", "failed", "revoking-previous"))
    and s.activation.phase.in(Set("idle", "acknowledging", "activation-pending", "revoking-previous", "authenticated"))
    and s.cleanupOwner.in(0.to(2)) and s.epoch.in(0.to(2)) and s.owner.in(0.to(2)) and s.ownerEpoch.in(0.to(2)) and s.activation.owner.in(0.to(2))
    and s.wrongCodes.in(0.to(5)) and s.ackTries.in(0.to(3)) and s.activation.ackTries.in(0.to(3))
  val safety = TypeOK and KeyBeforeAck and DurableReceiptBeforeKey and SingleUseGoogleReturn and
    MatchedReturnBurned and BoundedAttempts and AuthenticatedKey and NoExchangeWithPending and
    PendingWriteNotDurable and ActivationOwnsStoredKey and ActivationReceiptBeforeAck and
    CurrentActivationProjection and SerializedActivationWorker

  run failedCallbackBurnTest = init.then(begin("google")).then(callbackBurnFailed)
    .expect(s.pending and not(s.callbackAccepted) and s.phase == "failed" and safety)
    .then(restorePending).then(callback(1)).expect(s.pending and not(s.liveIntent or s.callbackAccepted) and safety)
  run failedCancelBurnTest = init.then(begin("google")).then(cancelBurnFailed)
    .expect(s.pending and s.cancelRequested and safety).then(restorePending)
    .then(callback(1)).expect(s.pending and not(s.liveIntent or s.callbackAccepted) and safety)
  run pendingAckRevokesPreviousBeforeRestartTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(writeReceipt).then(writeKey).then(ack(true)).then(releaseSteward)
    .then(begin("google")).then(callback(2)).then(exchanged).then(writeReceipt).then(writeKey)
    .then(ack(false)).then(ack(false)).then(ack(false)).then(revokePrevious(true))
    .expect(s.phase == "activation-pending" and s.receipt and s.revoked and safety)
    .then(restart).then(ack(true))
    .expect(s.phase == "authenticated" and not(s.oldKey) and s.revoked and safety)
  run googleReturnTest = init.then(begin("google")).then(callback(0))
    .expect(s.pending).then(callback(1)).expect(not(s.pending))
    .then(exchanged).then(writeReceipt).then(writeKey).then(ack(true)).expect(safety)
  run ackRecoveryTest = init.then(begin("email")).then(codeVerified(false))
    .then(exchanged).then(writeReceipt).then(writeKey).then(ack(false)).then(ack(false))
    .then(ack(false)).then(restart).then(ack(true)).expect(s.acknowledged and safety)
  run exhaustedCodesTest = init.then(begin("phone")).then(wrongCode).then(wrongCode)
    .then(wrongCode).then(wrongCode).then(wrongCode)
    .expect(s.phase == "exhausted" and safety)
  run lateReturnTest = init.then(begin("google")).then(browserClosed)
    .then(callback(1)).expect(s.phase == "exchange" and safety)
  run postCommitCancelStillActivatesTest = init.then(begin("email")).then(codeVerified(false))
    .then(exchanged).then(writeReceipt).then(writeKey).then(cancel).then(ack(true))
    .expect(s.cancelRequested and s.phase == "authenticated" and s.steward and safety)
    .then(releaseSteward).expect(not(s.steward) and safety)
  run storageFailureBeforeCommitTest = init.then(begin("email")).then(codeVerified(false))
    .then(exchanged).then(writeReceipt).then(storageFailure).then(releaseSteward)
    .expect(s.phase == "failed" and not(s.key or s.acknowledged) and safety)

  run heldAckAllowsQueuedReplacementTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(writeReceipt).then(writeKey).then(cancel).then(begin("google"))
    .expect(s.phase == "starting" and s.pendingWrite and not(s.pending) and s.activation.owner == 1 and s.activation.receipt and safety)
    .then(ack(true)).expect(s.phase == "starting" and s.activation.acknowledged and not(s.activation.receipt) and safety)
    .then(releaseSteward).then(beginWork)
    .expect(s.phase == "browser" and s.pending and s.owner == 1 and not(s.key or s.receipt) and safety)
    .then(callback(2)).then(exchanged).then(writeReceipt).then(writeKey).then(ack(true))
    .then(revokePrevious(true)).then(releaseSteward).expect(s.owner == 2 and safety)
  run queuedReplacementCancellationPreservesActivationTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(writeReceipt).then(writeKey).then(cancel).then(begin("google")).then(cancel)
    .then(ack(true)).then(releaseSteward).then(restart)
    .expect(s.owner == 1 and s.phase == "authenticated" and s.key and not(s.pending) and safety)
  run completedAckKeepsReplacementReceiptTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(writeReceipt).then(writeKey).then(ack(true)).then(begin("google"))
    .expect(s.phase == "starting" and s.activation.acknowledged and safety)
    .then(releaseSteward).then(beginWork).then(callback(2)).then(exchanged).then(writeReceipt)
    .expect(s.receipt and not(s.activation.receipt) and s.activation.owner == 1 and safety)

  run cancelledPrecommitWorkerRetainsCleanupTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(cancel).then(begin("google"))
    .expect(s.cleanupOwner == 1 and s.phase == "starting" and not(s.steward) and safety)
    .then(releaseSteward).then(beginWork).then(callback(2))
    .expect(s.cleanupOwner == 0 and s.phase == "exchange" and safety)

  run restartDropsUncommittedWorkerTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(cancel).then(begin("google")).then(restart)
    .expect(s.phase == "idle" and s.cleanupOwner == 0 and not(s.pendingWrite or s.steward or s.key) and safety)

  run resumedAckFencesPendingCallbackTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(writeReceipt).then(writeKey).then(ack(false)).then(ack(false)).then(ack(false))
    .then(releaseSteward).then(begin("google")).then(restart)
    .expect(s.pending and s.activation.running and safety).then(callback(2).fail())
  run resumedAckKeepsColdCallbackRefusedTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(writeReceipt).then(writeKey).then(ack(false)).then(ack(false)).then(ack(false))
    .then(releaseSteward).then(begin("google")).then(restart).then(ack(true)).then(callback(2))
    .expect(s.phase == "browser" and s.pending and not(s.liveIntent or s.callbackAccepted) and s.activation.acknowledged and safety)

  run coldReturnCannotAcquireCredentialIntentTest = init.then(begin("google")).then(restart)
    .then(callback(1)).expect(s.pending and not(s.liveIntent or s.callbackAccepted or s.key) and safety)
  run cancelledAcknowledgmentRetainsRecoveryReceiptTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(writeReceipt).then(writeKey).then(cancel).then(ackWithReceipt(true, true))
    .expect(s.key and s.acknowledged and s.receipt and safety)
    .then(restart).then(ack(true)).expect(s.key and not(s.receipt) and safety)
  run mfaHasFreshWrongCodeBudgetTest = init.then(begin("email")).then(wrongCode)
    .then(codeVerified(true)).expect(s.phase == "mfa" and s.wrongCodes == 0 and safety)
    .then(wrongCode).then(wrongCode).then(wrongCode).then(wrongCode).then(wrongCode)
    .expect(s.phase == "exhausted" and safety)
  run browserGraceBurnsPendingTest = init.then(begin("google")).then(browserGraceElapsed(true))
    .expect(not(s.pending or s.liveIntent) and safety)
  run browserGraceStorageFailureKeepsBytesTest = init.then(begin("google")).then(browserGraceElapsed(false))
    .then(restorePending).then(callback(1)).expect(s.pending and not(s.liveIntent or s.callbackAccepted) and safety)
  run priorGoogleRecordSurvivesEmailCancellationTest = init.then(begin("google")).then(cancelBurnFailed)
    .then(begin("email")).then(orphanedCallback).then(cancel).expect(s.pending and s.pendingOwner == 1 and not(s.liveIntent) and safety)

}
