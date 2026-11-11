/// One reviewed SMS send in the Messages composer: the operation ID and draft revision the
/// renderer holds, against the native send journal's answer for that ID.
module SmsSend {
  type State = {
    active: bool, lifecycle: int, draftRevision: int, busy: bool,
    // The operation ID the draft holds (0: none) and the IDs minted so far.
    operationId: int, minted: int,
    // The native call in flight: its ID, the visit and draft it was started under, and the answer
    // native has resolved but the renderer has not yet received.
    call: int, callLifecycle: int, callDraft: int, reply: str,
    journal: int -> str, dispatches: int -> int,
    // The receipt on screen, whether a send or a read-back put it there, and the visit and draft
    // it was shown for.
    shown: str, shownFrom: str, shownLifecycle: int, shownDraft: int,
    sendAccess: bool, edits: int
  }
  var s: State
  pure val IDS = Set(1, 2, 3)
  pure val CLOSED = Set("cancelled", "denied")
  action init = s' = {
    active: false, lifecycle: 0, draftRevision: 0, busy: false, operationId: 0, minted: 0,
    call: 0, callLifecycle: 0, callDraft: 0, reply: "none",
    journal: IDS.mapBy(_ => "none"), dispatches: IDS.mapBy(_ => 0),
    shown: "none", shownFrom: "none", shownLifecycle: 0, shownDraft: 0, sendAccess: true, edits: 0
  }
  action open = all {
    not(s.active), s.lifecycle < 4,
    s' = { ...s, active: true, lifecycle: s.lifecycle + 1 }
  }
  /// Leaving Messages or hiding the page discards the draft, its ID and its receipt.
  action leave = all {
    s.active, s.lifecycle < 4, s.draftRevision < 5,
    s' = { ...s, active: false, lifecycle: s.lifecycle + 1, draftRevision: s.draftRevision + 1,
      busy: false, operationId: 0, shown: "none", shownFrom: "none" }
  }
  /// Editing recipients or text, picking a SIM, or Clear.
  action edit = all {
    s.active, not(s.busy), s.draftRevision < 5, s.edits < 3,
    s' = { ...s, draftRevision: s.draftRevision + 1, operationId: 0, shown: "none", shownFrom: "none",
      edits: s.edits + 1 }
  }
  /// Granting or losing send access changes neither the draft nor its ID.
  action accessChanged = s' = { ...s, sendAccess: not(s.sendAccess) }
  /// Send mints an ID only when the draft holds none. One native review is open at a time.
  action send = all {
    s.active, not(s.busy), s.call == 0, s.operationId != 0 or s.minted < 3,
    val id = if (s.operationId != 0) s.operationId else s.minted + 1
    s' = { ...s, busy: true, operationId: id, minted: if (s.operationId != 0) s.minted else s.minted + 1,
      call: id, callLifecycle: s.lifecycle, callDraft: s.draftRevision, reply: "none" }
  }
  /// Native answers a repeated ID with its existing record. A new ID is reviewed: a refused send
  /// access records denied, a declined review records cancelled, and a confirmed one dispatches once.
  action nativeDecide(confirmed: bool): bool = all {
    s.call != 0, s.reply == "none",
    val existing = s.journal.get(s.call)
    val decided = if (not(s.sendAccess)) "denied" else if (confirmed) "submitted" else "cancelled"
    s' = if (existing != "none") { ...s, reply: existing }
      else { ...s, reply: decided, journal: s.journal.set(s.call, decided),
        dispatches: if (decided == "submitted") s.dispatches.set(s.call, s.dispatches.get(s.call) + 1) else s.dispatches }
  }
  /// The renderer receives the answer. A visit or draft that moved on drops it. A record closed
  /// without a dispatch releases the ID and starts a new draft revision, so the same text can be
  /// sent again under a new ID while the receipt stays on screen.
  action deliver = all {
    s.call != 0, s.reply != "none",
    val current = s.active and s.callLifecycle == s.lifecycle and s.callDraft == s.draftRevision
    val closed = current and s.reply.in(CLOSED)
    val draft = if (closed) s.draftRevision + 1 else s.draftRevision
    s' = { ...s, call: 0, reply: "none",
      busy: if (s.callLifecycle == s.lifecycle) false else s.busy,
      shown: if (current) s.reply else s.shown,
      shownFrom: if (current) "send" else s.shownFrom,
      shownLifecycle: if (current) s.lifecycle else s.shownLifecycle,
      shownDraft: if (current) draft else s.shownDraft,
      draftRevision: draft,
      operationId: if (closed) 0 else s.operationId }
  }
  /// The call rejects. A refusal native makes before it journals anything releases the ID; any
  /// other rejection leaves the outcome unknown, so the ID stays with the draft.
  action callRejected(beforeJournal: bool): bool = all {
    s.call != 0,
    beforeJournal implies s.reply == "none" and s.journal.get(s.call) == "none",
    val current = s.active and s.callLifecycle == s.lifecycle and s.callDraft == s.draftRevision
    s' = { ...s, call: 0, reply: "none",
      busy: if (s.callLifecycle == s.lifecycle) false else s.busy,
      shown: if (not(current)) s.shown else if (beforeJournal) "refused" else "outcome-unknown",
      shownFrom: if (current) "send" else s.shownFrom,
      shownLifecycle: if (current) s.lifecycle else s.shownLifecycle,
      shownDraft: if (current) s.draftRevision else s.shownDraft,
      operationId: if (current and beforeJournal) 0 else s.operationId }
  }
  /// Sent and delivery evidence, or startup reconciliation of an interrupted dispatch.
  action journalAdvance(id: int, status: str): bool = all {
    val before = s.journal.get(id)
    all {
      before == "submitted" and status.in(Set("sent", "failed", "unknown")) or before == "sent" and status == "delivered",
      s' = { ...s, journal: s.journal.set(id, status) }
    }
  }
  /// A native send update or a manual refresh re-reads the record for the ID the draft holds.
  /// It only replaces the receipt; the ID stays until a send answers.
  action reconcile = all {
    s.active, s.operationId != 0, s.journal.get(s.operationId) != "none",
    s' = { ...s, shown: s.journal.get(s.operationId), shownFrom: "read-back",
      shownLifecycle: s.lifecycle, shownDraft: s.draftRevision }
  }
  action step = {
    nondet id = IDS.oneOf()
    nondet status = Set("sent", "failed", "unknown", "delivered").oneOf()
    nondet confirmed = Set(true, false).oneOf()
    nondet beforeJournal = Set(true, false).oneOf()
    any { open, leave, edit, accessChanged, send, nativeDecide(confirmed), deliver,
      callRejected(beforeJournal), journalAdvance(id, status), reconcile, s' = s }
  }
  val AtMostOneDispatchPerOperation = IDS.forall(id => s.dispatches.get(id) <= 1)
  val DispatchJournaled = IDS.forall(id =>
    (s.dispatches.get(id) == 1) == s.journal.get(id).in(Set("submitted", "sent", "delivered", "failed", "unknown")))
  /// Once a send has answered that nothing was dispatched, the idle draft holds no ID.
  val ClosedAnswerReleasesId = (s.shownFrom == "send" and not(s.busy) and s.shown.in(CLOSED.union(Set("refused")))) implies
    s.operationId == 0
  /// An ID the draft holds while idle was minted for it and never refused before journaling.
  val HeldIdWasMinted = s.operationId <= s.minted and s.call <= s.minted
  val StaleResultNeverShown = s.shown != "none" implies
    s.active and s.shownLifecycle == s.lifecycle and s.shownDraft == s.draftRevision
  val InactiveHoldsNothing = not(s.active) implies s.operationId == 0 and not(s.busy) and s.shown == "none"
  val BusyHasCall = s.busy implies s.call != 0 and s.callLifecycle == s.lifecycle
  val TypeOK = s.operationId.in(0.to(3)) and s.minted.in(0.to(3)) and s.call.in(0.to(3))
    and s.lifecycle.in(0.to(4)) and s.draftRevision.in(0.to(8)) and s.edits.in(0.to(3))
    and s.shown.in(Set("none", "cancelled", "denied", "submitted", "sent", "delivered", "failed", "unknown", "outcome-unknown", "refused"))
    and s.shownFrom.in(Set("none", "send", "read-back"))
  val safety = TypeOK and AtMostOneDispatchPerOperation and DispatchJournaled and ClosedAnswerReleasesId and
    HeldIdWasMinted and StaleResultNeverShown and InactiveHoldsNothing and BusyHasCall

  val RetryAfterClosedRecordWitness = s.minted >= 2 and s.journal.get(1).in(CLOSED) and s.dispatches.get(2) == 1 and s.edits == 0
  val RepeatedIdAnsweredFromJournalWitness = s.call != 0 and s.reply != "none" and s.dispatches.get(s.call) == 1 and s.shown == "outcome-unknown"
  val StaleAnswerDroppedWitness = s.call != 0 and s.reply != "none" and s.callLifecycle != s.lifecycle
  val SentEvidenceWitness = s.shown == "sent" and s.shownFrom == "read-back"
  val RefusedBeforeJournalWitness = s.shown == "refused" and s.operationId == 0 and s.journal.get(1) == "none" and s.minted == 1

  /// A cancelled review, then access refused, then a confirmed send: each retry of the unedited
  /// draft gets a new ID, and only the confirmed one is dispatched.
  run retryAfterCancelledAndDeniedTest = init.then(open).then(send).then(nativeDecide(false)).then(deliver)
    .expect(s.shown == "cancelled" and s.operationId == 0 and s.draftRevision == 1 and safety)
    .then(accessChanged).then(send).then(nativeDecide(true)).then(deliver)
    .expect(s.shown == "denied" and s.operationId == 0 and safety)
    .then(accessChanged).then(send).then(nativeDecide(true)).then(deliver)
    .expect(s.shown == "submitted" and s.operationId == 3 and s.dispatches.get(3) == 1
      and s.dispatches.get(1) == 0 and s.dispatches.get(2) == 0 and s.edits == 0 and safety)
  /// After an unknown outcome the same ID is sent again and native answers from its record.
  run repeatedIdNeverDispatchesTwiceTest = init.then(open).then(send).then(nativeDecide(true)).then(callRejected(false))
    .expect(s.shown == "outcome-unknown" and s.operationId == 1 and safety)
    .then(send).then(nativeDecide(true)).expect(RepeatedIdAnsweredFromJournalWitness)
    .then(deliver).expect(s.shown == "submitted" and s.dispatches.get(1) == 1 and s.minted == 1 and safety)
  run staleAnswerDroppedTest = init.then(open).then(send).then(nativeDecide(true)).then(leave).then(open)
    .expect(StaleAnswerDroppedWitness).then(deliver)
    .expect(s.shown == "none" and s.operationId == 0 and not(s.busy) and s.dispatches.get(1) == 1 and safety)
  run editResetsOperationTest = init.then(open).then(send).then(nativeDecide(true)).then(deliver).then(edit)
    .expect(s.operationId == 0 and s.shown == "none").then(send).expect(s.operationId == 2 and safety)
  run deliveryEvidenceTest = init.then(open).then(send).then(nativeDecide(true)).then(deliver)
    .then(journalAdvance(1, "sent")).then(journalAdvance(1, "delivered")).then(reconcile)
    .expect(s.shown == "delivered" and s.shownFrom == "read-back" and s.operationId == 1 and safety)
  /// A cancelled record learned only through a read-back keeps the ID; the next Send is answered
  /// from that record, which releases it, and the Send after that dispatches under a new ID.
  run readBackKeepsIdUntilSendAnswersTest = init.then(open).then(send).then(nativeDecide(false)).then(callRejected(false))
    .expect(s.operationId == 1 and s.shown == "outcome-unknown").then(reconcile)
    .expect(s.shown == "cancelled" and s.shownFrom == "read-back" and s.operationId == 1 and safety)
    .then(send).then(nativeDecide(true)).then(deliver)
    .expect(s.shown == "cancelled" and s.operationId == 0 and s.dispatches.get(1) == 0 and safety)
    .then(send).then(nativeDecide(true)).then(deliver)
    .expect(s.shown == "submitted" and s.operationId == 2 and s.dispatches.get(2) == 1 and s.edits == 0 and safety)
  /// A refusal before anything is journaled releases the ID without a new draft revision.
  run refusedBeforeJournalTest = init.then(open).then(send).then(callRejected(true))
    .expect(RefusedBeforeJournalWitness and s.draftRevision == 0 and not(s.busy) and safety)
    .then(send).expect(s.operationId == 2 and safety)
}
