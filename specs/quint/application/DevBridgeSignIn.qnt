/// The browser development bridge's own Cloud sign-in: the scoped key is minted, acknowledged
/// with bounded retries, checked against its owner and only then stored through the serialized
/// private store; a cancel never reports the old account once the store rename was dispatched.
module DevBridgeSignIn {
  type State = {
    // idle, minting, acking, acknowledged, queued, writing, committing, committed, failed, cancelled
    phase: str, failure: str, ackAttempts: int,
    // Cloud has activated the minted key (an acknowledgement reached it, answered or not).
    keyActivated: bool, loggedOut: bool,
    // The stored credential: 0 the one held when the attempt began, 1 this attempt's, 2 another's.
    store: int, previous: int,
    cancelReply: str, cancelWaiting: bool, residentRetired: bool
  }
  var s: State
  action init = s' = {
    phase: "idle", failure: "none", ackAttempts: 0, keyActivated: false, loggedOut: false,
    store: 0, previous: 0, cancelReply: "none", cancelWaiting: false, residentRetired: false
  }
  pure def failed(v: State, reason: str): State = { ...v, phase: "failed", failure: reason, loggedOut: true }
  /// A verified Steward session (email code or Google return) starts the scoped key exchange.
  action begin = all { s.phase == "idle", s' = { ...s, phase: "minting", previous: s.store } }
  action mint(ok: bool): bool = all {
    s.phase == "minting", s' = if (ok) { ...s, phase: "acking" } else failed(s, "unavailable")
  }
  /// One acknowledgement: confirmed (or already complete), lost or throttled (retried up to three
  /// times, and Cloud may have activated the key all the same), or refused (not retried).
  action acknowledge(result: str, reached: bool): bool = all {
    s.phase == "acking", s.ackAttempts < 3, result.in(Set("confirmed", "transient", "refused")),
    val attempts = s.ackAttempts + 1
    s' = if (result == "confirmed") { ...s, ackAttempts: attempts, keyActivated: true, phase: "acknowledged" }
      else if (result == "refused") failed({ ...s, ackAttempts: attempts }, "activation-pending")
      else if (attempts == 3) failed({ ...s, ackAttempts: attempts, keyActivated: s.keyActivated or reached }, "activation-pending")
      else { ...s, ackAttempts: attempts, keyActivated: s.keyActivated or reached }
  }
  /// The key's owner is read from Cloud; the Steward session is ended either way.
  action identity(ok: bool): bool = all {
    s.phase == "acknowledged", s' = if (ok) { ...s, phase: "queued", loggedOut: true } else failed(s, "unavailable")
  }
  /// Another sign-in or sign-out replaces the stored credential. Store writes are serialized, so
  /// none lands between this attempt's check and its rename.
  action storeChangesElsewhere = all { not(s.phase.in(Set("writing", "committing"))), s.store != 2, s' = { ...s, store: 2 } }
  /// The serialized commit begins: the stored credential must still be the one the attempt began with.
  action commitChecks = all {
    s.phase == "queued",
    s' = if (s.store != s.previous) failed(s, "account-changed") else { ...s, phase: "writing", residentRetired: true }
  }
  /// The phase change and the rename dispatch are one synchronous step: the commit boundary.
  action dispatchRename = all { s.phase == "writing", s' = { ...s, phase: "committing" } }
  action renameSettles(ok: bool): bool = all {
    s.phase == "committing",
    val done = if (ok) { ...s, phase: "committed", store: 1 } else { ...s, phase: "failed", failure: "storage" }
    s' = if (s.cancelWaiting) { ...done, cancelWaiting: false, cancelReply: if (ok) "authenticated" else "unavailable" } else done
  }
  /// Cancel. Before the rename is dispatched the attempt is aborted and reported cancelled. Once
  /// it is dispatched the cancel waits for the store and reports what happened.
  action cancel = all {
    s.cancelReply == "none", not(s.cancelWaiting), not(s.phase.in(Set("idle", "failed", "cancelled"))),
    s' = if (s.phase == "committing") { ...s, cancelWaiting: true }
      else if (s.phase == "committed") { ...s, cancelReply: "authenticated" }
      else { ...s, phase: "cancelled", cancelReply: "cancelled", loggedOut: true }
  }
  action step = {
    nondet ok = Set(true, false).oneOf()
    nondet reached = Set(true, false).oneOf()
    nondet result = Set("confirmed", "transient", "refused").oneOf()
    any { begin, mint(ok), acknowledge(result, reached), identity(ok), storeChangesElsewhere, commitChecks, dispatchRename,
      renameSettles(ok), cancel, s' = s }
  }
  /// Only an acknowledged key is ever stored.
  val StoredOnlyAfterAcknowledgement = s.store == 1 implies s.keyActivated and s.phase == "committed"
  /// A cancel reported as cancelled leaves the stored account as it was.
  val CancelledNeverCommitted = s.cancelReply == "cancelled" implies s.store != 1 and s.phase == "cancelled"
  /// The commit replaces only the credential the attempt began with.
  val CommitFencedToStartingAccount = s.phase.in(Set("writing", "committing")) implies s.store == s.previous
  val AcknowledgementsBounded = s.ackAttempts.in(0.to(3)) and (s.phase == "acking" implies s.ackAttempts < 3)
  /// The Steward session never outlives the key exchange.
  val SessionEndedAfterExchange = s.phase.in(Set("queued", "writing", "committing", "committed", "failed", "cancelled")) implies s.loggedOut
  val WaitingCancelIsAnswered = s.cancelWaiting implies s.phase == "committing" and s.cancelReply == "none"
  val TypeOK = s.phase.in(Set("idle", "minting", "acking", "acknowledged", "queued", "writing", "committing", "committed", "failed", "cancelled"))
    and s.failure.in(Set("none", "unavailable", "activation-pending", "account-changed", "storage"))
    and s.store.in(0.to(2)) and s.cancelReply.in(Set("none", "cancelled", "authenticated", "unavailable"))
  val safety = TypeOK and StoredOnlyAfterAcknowledgement and CancelledNeverCommitted and CommitFencedToStartingAccount and
    AcknowledgementsBounded and SessionEndedAfterExchange and WaitingCancelIsAnswered

  /// An activated key that never reached the store: the owner signs in again.
  val ActivatedKeyNotStoredWitness = s.keyActivated and s.phase.in(Set("failed", "cancelled")) and s.store != 1
  val CancelDuringCommitWitness = s.cancelReply == "authenticated" and s.store == 1
  val AccountChangedRefusedWitness = s.failure == "account-changed" and s.keyActivated
  val AcknowledgedOnThirdAttemptWitness = s.ackAttempts == 3 and s.phase == "acknowledged"

  run storedAfterAcknowledgementTest = init.then(begin).then(mint(true)).then(acknowledge("confirmed", true)).then(identity(true))
    .then(commitChecks).then(dispatchRename).then(renameSettles(true))
    .expect(s.store == 1 and s.phase == "committed" and s.loggedOut and s.residentRetired and safety)
  /// Two lost acknowledgements are retried; a third confirms.
  run acknowledgementRetriedTest = init.then(begin).then(mint(true)).then(acknowledge("transient", false))
    .then(acknowledge("transient", true)).then(acknowledge("confirmed", true))
    .expect(AcknowledgedOnThirdAttemptWitness and safety)
  /// Three lost acknowledgements end the attempt; a key Cloud activated meanwhile is not stored.
  run activationPendingTest = init.then(begin).then(mint(true)).then(acknowledge("transient", false))
    .then(acknowledge("transient", false)).then(acknowledge("transient", true))
    .expect(ActivatedKeyNotStoredWitness and s.failure == "activation-pending" and s.loggedOut and safety)
  run refusedAcknowledgementNotRetriedTest = init.then(begin).then(mint(true)).then(acknowledge("refused", false))
    .expect(s.phase == "failed" and s.ackAttempts == 1 and safety).then(acknowledge("confirmed", true).fail())
  /// The stored account changed while the key was exchanged: nothing is stored over it.
  run accountChangedTest = init.then(begin).then(mint(true)).then(acknowledge("confirmed", true)).then(storeChangesElsewhere)
    .then(identity(true)).then(commitChecks).expect(AccountChangedRefusedWitness and s.store == 2 and safety)
  run cancelBeforeCommitTest = init.then(begin).then(mint(true)).then(acknowledge("confirmed", true)).then(identity(true))
    .then(commitChecks).then(cancel).expect(s.cancelReply == "cancelled" and s.store == 0 and safety)
    .then(dispatchRename.fail())
  /// A cancel after the rename was dispatched waits and reports the committed sign-in.
  run cancelDuringCommitTest = init.then(begin).then(mint(true)).then(acknowledge("confirmed", true)).then(identity(true))
    .then(commitChecks).then(dispatchRename).then(cancel).expect(s.cancelWaiting and s.cancelReply == "none" and safety)
    .then(renameSettles(true)).expect(CancelDuringCommitWitness and safety)
}
