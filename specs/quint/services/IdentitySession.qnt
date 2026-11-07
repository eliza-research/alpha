/// Native Cloud sign-in. Source mappings and finite abstractions are in manifest.json.
module IdentitySession {
  type Session = {
    phase: str, method: str, epoch: int, owner: int, ownerEpoch: int, attemptOwner: int,
    pending: bool, consumed: Set[int], wrongCodes: int, cooldown: bool,
    receipt: bool, key: bool, acknowledged: bool, ackTries: int,
    oldKey: bool, revoked: bool, steward: bool, callbackAccepted: bool, cancelRequested: bool
  }
  var s: Session
  action init = s' = {
    phase: "idle", method: "none", epoch: 0, owner: 0, ownerEpoch: 0, attemptOwner: 0,
    pending: false, consumed: Set(), wrongCodes: 0, cooldown: false,
    receipt: false, key: false, acknowledged: false, ackTries: 0,
    oldKey: false, revoked: false, steward: false, callbackAccepted: false, cancelRequested: false
  }
  action begin(method: str): bool = all {
    s.phase.in(Set("idle", "authenticated", "cancelled", "expired", "exhausted", "failed")),
    s.epoch < 2,
    method.in(Set("google", "email", "phone")),
    not(s.cooldown),
    s' = { ...s, phase: if (method == "google") "browser" else "code",
      method: method, epoch: s.epoch + 1, attemptOwner: s.epoch + 1,
      pending: method == "google", wrongCodes: 0, cooldown: method != "google",
      receipt: false, key: false, acknowledged: false, ackTries: 0,
      oldKey: s.owner != 0, revoked: false, steward: false, callbackAccepted: false, cancelRequested: false }
  }
  /// Wrong-state callbacks do not burn the encrypted pending record.
  action callback(token: int): bool = all {
    s.phase == "browser", s.pending,
    if (token == s.epoch)
      s' = { ...s, phase: "exchange", pending: false,
        consumed: s.consumed.union(Set(token)), callbackAccepted: true }
    else s' = s
  }
  /// A failed durable burn retains the record and cannot enter exchange.
  action callbackBurnFailed = all {
    s.phase == "browser", s.pending,
    s' = { ...s, phase: "failed", callbackAccepted: false }
  }
  /// Failed cancellation cannot claim that the stored pending record was removed.
  action cancelBurnFailed = all {
    s.phase == "browser", s.pending,
    s' = { ...s, phase: "cancelled", cancelRequested: true, callbackAccepted: false }
  }
  /// A process restart can find an unretired record; successful burn is still required.
  action restorePending = all {
    s.pending, s.phase.in(Set("failed", "cancelled")),
    s' = { ...s, phase: "browser", cancelRequested: false }
  }
  /// Browser resume without a result leaves the pending record for a late return.
  action browserClosed = all { s.phase == "browser", s' = s }
  action wrongCode = all {
    s.phase == "code", s.wrongCodes < 5,
    s' = { ...s, wrongCodes: s.wrongCodes + 1,
      phase: if (s.wrongCodes == 4) "exhausted" else "code" }
  }
  action codeVerified(needsMfa: bool): bool = all {
    s.phase == "code", s.wrongCodes < 5,
    s' = { ...s, phase: if (needsMfa) "mfa" else "exchange" }
  }
  action mfaVerified = all { s.phase == "mfa", s' = { ...s, phase: "exchange" } }
  action exchanged = all {
    s.phase == "exchange", s' = { ...s, phase: "minted", steward: true }
  }
  action writeReceipt = all {
    s.phase == "minted", s' = { ...s, receipt: true, phase: "receipt-saved" }
  }
  /// A storage failure cannot proceed to acknowledging an unsaved key.
  action storageFailure = all {
    s.phase.in(Set("minted", "receipt-saved")), s' = { ...s, phase: "failed" }
  }
  action writeKey = all {
    s.phase == "receipt-saved", s.receipt,
    s' = { ...s, key: true, owner: s.attemptOwner, ownerEpoch: s.epoch, phase: "acknowledging" }
  }
  action ack(success: bool): bool = all {
    s.phase == "acknowledging", s.key, s.receipt, s.ackTries < 3,
    s' = { ...s, ackTries: s.ackTries + 1,
      acknowledged: success,
      receipt: not(success),
      phase: if (success) { if (s.oldKey) "revoking-previous" else "authenticated" }
        else if (s.ackTries == 2) "activation-pending" else "acknowledging" }
  }
  /// Startup retries the retained ack. The previous token was transient and cannot be revoked after restart.
  action restart = all {
    s.phase.in(Set("activation-pending", "acknowledging")), s.receipt, s.key,
    s' = { ...s, phase: "acknowledging", ackTries: 0, steward: false, oldKey: false, revoked: false }
  }
  action revokePrevious(success: bool): bool = all {
    s.phase == "revoking-previous", s.oldKey,
    s' = { ...s, phase: "authenticated", oldKey: false, revoked: success }
  }
  action cooldownElapsed = all { s.cooldown, s' = { ...s, cooldown: false } }
  /// Key persistence is the commit point. Cancelling the UI cannot stop activation.
  action cancel = all {
    not(s.phase.in(Set("idle", "authenticated"))),
    if (s.key) s' = { ...s, cancelRequested: true }
    else s' = { ...s, phase: "cancelled", pending: false, cancelRequested: true,
      consumed: if (s.method == "google") s.consumed.union(Set(s.epoch)) else s.consumed }
  }
  /// complete() publishes authentication before its finally block drops the transient session.
  action releaseSteward = all {
    s.steward, s.phase.in(Set("authenticated", "activation-pending", "cancelled", "failed")),
    s' = { ...s, steward: false }
  }
  action expire = all {
    s.pending,
    s' = { ...s, phase: "expired", pending: false,
      consumed: s.consumed.union(Set(s.epoch)) }
  }
  action signOut = all {
    s.owner != 0,
    s' = { ...s, owner: 0, key: false, acknowledged: false, receipt: false,
      phase: "idle", pending: false, steward: false }
  }
  action step = any {
    begin("google"), begin("email"), begin("phone"), callback(0), callback(s.epoch),
    browserClosed, callbackBurnFailed, cancelBurnFailed, restorePending, wrongCode, codeVerified(false), codeVerified(true), mfaVerified,
    exchanged, writeReceipt, storageFailure, writeKey, ack(false), ack(true),
    restart, revokePrevious(false), revokePrevious(true), cooldownElapsed,
    cancel, releaseSteward, expire, signOut, s' = s
  }
  val KeyBeforeAck = s.acknowledged implies (s.key and s.owner == s.attemptOwner)
  val DurableReceiptBeforeKey = s.phase == "acknowledging" implies (s.receipt and s.key)
  val SingleUseGoogleReturn = s.pending implies not(s.epoch.in(s.consumed))
  val MatchedReturnBurned = s.callbackAccepted implies s.epoch.in(s.consumed)
  val BoundedAttempts = s.wrongCodes <= 5 and s.ackTries <= 3
  val NoExchangeWithPending = s.phase.in(Set("exchange", "minted", "receipt-saved", "acknowledging", "activation-pending", "revoking-previous", "authenticated")) implies not(s.pending)
  val AuthenticatedKey = s.phase == "authenticated" implies s.key and s.acknowledged
  val TypeOK = s.phase.in(Set("idle", "browser", "code", "mfa", "exchange", "minted", "receipt-saved", "acknowledging", "activation-pending", "authenticated", "cancelled", "expired", "exhausted", "failed", "revoking-previous")) and s.epoch.in(0.to(2)) and s.owner.in(0.to(2)) and s.ownerEpoch.in(0.to(2)) and s.wrongCodes.in(0.to(5)) and s.ackTries.in(0.to(3))
  val safety = TypeOK and KeyBeforeAck and DurableReceiptBeforeKey and SingleUseGoogleReturn and
    MatchedReturnBurned and BoundedAttempts and AuthenticatedKey and NoExchangeWithPending

  run failedCallbackBurnTest = init.then(begin("google")).then(callbackBurnFailed)
    .expect(s.pending and not(s.callbackAccepted) and s.phase == "failed" and safety)
    .then(restorePending).then(callback(1)).expect(not(s.pending) and safety)
  run failedCancelBurnTest = init.then(begin("google")).then(cancelBurnFailed)
    .expect(s.pending and s.cancelRequested and safety).then(restorePending)
    .then(callback(1)).expect(not(s.pending) and safety)
  run recoveredAckLosesPreviousRevocationTest = init.then(begin("google")).then(callback(1))
    .then(exchanged).then(writeReceipt).then(writeKey).then(ack(true)).then(releaseSteward)
    .then(begin("google")).then(callback(2)).then(exchanged).then(writeReceipt).then(writeKey)
    .then(ack(false)).then(ack(false)).then(ack(false)).then(restart).then(ack(true))
    .expect(s.phase == "authenticated" and not(s.oldKey or s.revoked) and safety)
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

}
