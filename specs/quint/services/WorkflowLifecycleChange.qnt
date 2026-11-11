/// Reviewed removal and restore of a workflow on the agent. The change is named against the
/// version the owner reviewed and recorded in the pending journal before it is sent. The journal
/// entry is released only when the outcome is known: by the reply, by the agent's receipt, or
/// because the workflow has moved to another version, which the agent refuses. A retained change
/// the agent holds no receipt for, on a workflow that keeps that version, may never have arrived:
/// the owner can send that same request again, and the agent applies one request at most once.
module WorkflowLifecycleChange {
  type Lifecycle = {
    removed: bool, version: int, knownRemoved: bool, knownVersion: int,
    ongoing: bool, interrupted: bool, review: bool, unknownReview: bool,
    intent: bool, intentVersion: int, intentRemove: bool, busy: bool, stage: str,
    offer: bool, resendReview: bool, checked: bool,
    wire: int, wireId: int, wireVersion: int, wireRemove: bool, reply: str,
    receipts: Set[int], seen: bool, sent: int, resends: int, admissions: int, applications: int
  }
  var s: Lifecycle
  action init = s' = {
    removed: false, version: 0, knownRemoved: false, knownVersion: 0,
    ongoing: false, interrupted: false, review: false, unknownReview: false,
    intent: false, intentVersion: 0, intentRemove: false, busy: false, stage: "idle",
    offer: false, resendReview: false, checked: false,
    wire: 0, wireId: 0, wireVersion: 0, wireRemove: false, reply: "none",
    receipts: Set(), seen: false, sent: 0, resends: 0, admissions: 0, applications: 0 }
  /// The newest request is the `admissions`-th; the agent keeps a receipt per applied request.
  pure def appliedThis(v: Lifecycle): bool = v.receipts.contains(v.admissions)
  pure def more(n: int): int = if (n < 2) n + 1 else 2
  pure def reread(v: Lifecycle): Lifecycle = { ...v, knownRemoved: v.removed, knownVersion: v.version }
  pure def settled(v: Lifecycle): Lifecycle = { ...v, busy: false, stage: "idle", reply: "none" }
  pure def released(v: Lifecycle): Lifecycle =
    { ...reread(settled(v)), intent: false, offer: false, resendReview: false }
  /// The agent refuses a change while a run is unfinished, and one named against another version.
  pure def refusedNow(v: Lifecycle): bool = v.version != v.wireVersion or v.ongoing or v.interrupted
  /// The first tap shows the review. The second records the change and starts sending it.
  /// Interrupted runs are reviewed and cancelled first; an ongoing run blocks the change.
  action lifecycleTap = all {
    not(s.busy), not(s.intent), not(s.ongoing), s.admissions < 3,
    if (s.interrupted)
      if (not(s.unknownReview)) s' = { ...s, unknownReview: true, review: true }
      else s' = { ...s, unknownReview: false, review: false, busy: true, stage: "cancelling" }
    else if (not(s.review)) s' = { ...s, review: true }
    else s' = { ...s, review: false, intent: true, intentVersion: s.knownVersion,
      intentRemove: not(s.knownRemoved), busy: true, stage: "admitted", reply: "none",
      sent: 0, resends: 0, seen: false, checked: false, admissions: s.admissions + 1 }
  }
  action cancelReply(stopped: bool): bool = all {
    s.busy, s.stage == "cancelling",
    s' = { ...settled(s), interrupted: not(stopped) }
  }
  /// A request of an earlier change still in flight names an older version or already has its
  /// receipt and can only be refused or answered, so the model keeps the newest request alone.
  action dispatch = all {
    s.busy, s.stage == "admitted",
    s' = { ...s, stage: "sent", wire: 1, wireId: s.admissions, wireVersion: s.intentVersion,
      wireRemove: s.intentRemove, sent: 1, reply: "none" }
  }
  /// Leaving before the request is sent is a known non-change.
  action abortBeforeDispatch = all {
    s.busy, s.stage == "admitted",
    s' = { ...settled(s), intent: false }
  }
  /// The agent applies a request once, for the version it names, and keeps its receipt.
  action serverApply = all {
    s.wire > 0, not(s.receipts.contains(s.wireId)), not(refusedNow(s)),
    s' = { ...s, wire: s.wire - 1, removed: s.wireRemove, receipts: s.receipts.union(Set(s.wireId)),
      reply: if (s.stage == "sent" and s.wireId == s.admissions) "ok" else s.reply,
      applications: s.applications + 1 }
  }
  /// A repeat of an applied request is answered with the receipt already held.
  action serverReplay = all {
    s.wire > 0, s.receipts.contains(s.wireId),
    s' = { ...s, wire: s.wire - 1,
      reply: if (s.stage == "sent" and s.wireId == s.admissions) "ok" else s.reply }
  }
  action serverReject = all {
    s.wire > 0, not(s.receipts.contains(s.wireId)), refusedNow(s),
    s' = { ...s, wire: s.wire - 1,
      reply: if (s.stage == "sent" and s.wireId == s.admissions) "rejected" else s.reply }
  }
  action requestLost = all { s.wire > 0, s' = { ...s, wire: s.wire - 1 } }
  action successReply = all {
    s.busy, s.stage == "sent", s.reply == "ok",
    s' = { ...released(s), seen: true }
  }
  /// A refusal of the only request sent is a known non-change: the entry is released and the
  /// current workflow is read. A refusal of a resent request says nothing about an earlier copy
  /// that may still arrive, so the workflow and then the receipt are read: the entry is released
  /// when a receipt exists or the workflow has moved on, and otherwise stays retained and can be
  /// sent again.
  action rejectedReply = all {
    s.busy, s.stage == "sent", s.reply == "rejected",
    if (s.resends == 0) s' = released(s)
    else if (appliedThis(s)) s' = { ...released(s), seen: true }
    else if (s.version != s.intentVersion) s' = released(s)
    else s' = { ...reread(settled(s)), offer: true }
  }
  /// No answer arrived, or the app was hidden before one could.
  action unknownReply = all { s.busy, s.stage == "sent", s' = settled(s) }
  /// Opening the workflow reads it, then asks the agent for the receipt of a retained change.
  /// Without a receipt, a change named against a version that is no longer current can never
  /// apply and is released; one named against the current version stays retained and the same
  /// request is offered for sending again.
  action refresh = all {
    not(s.busy),
    val read = { ...reread(s), review: false, unknownReview: false, resendReview: false,
      offer: false, checked: true }
    if (not(s.intent)) s' = read
    else if (appliedThis(s)) s' = { ...read, intent: false, seen: true }
    else if (s.version != s.intentVersion) s' = { ...read, intent: false }
    else s' = { ...read, offer: true }
  }
  /// The first tap on an offered change shows what a resend does; the second starts it.
  action resendTap = all {
    not(s.busy), s.intent, s.offer,
    if (not(s.resendReview)) s' = { ...s, resendReview: true }
    else s' = { ...s, resendReview: false, offer: false, checked: false, busy: true,
      stage: "resending", reply: "none" }
  }
  /// The receipt is read once more; only without one is the same request sent again. A copy
  /// sent earlier may still be in flight beside it.
  action resendDispatch = all {
    s.busy, s.stage == "resending",
    if (appliedThis(s)) s' = { ...released(s), seen: true }
    else s' = { ...s, stage: "sent", wire: if (s.wireId == s.admissions) more(s.wire) else 1,
      wireId: s.admissions, wireVersion: s.intentVersion, wireRemove: s.intentRemove,
      sent: more(s.sent), resends: more(s.resends), reply: "none" }
  }
  /// Leaving before the resend goes out keeps the entry: an earlier copy may have been sent.
  action abortResend = all { s.busy, s.stage == "resending", s' = settled(s) }
  /// The workflow changes on the agent from elsewhere.
  action remoteEdit = all { s.version < 2, s' = { ...s, version: s.version + 1 } }
  /// A run with an unknown outcome blocks new runs until it is cancelled.
  action runStarts = all {
    not(s.ongoing), not(s.interrupted), not(s.busy), s' = { ...s, ongoing: true }
  }
  action runFinishes = all { s.ongoing, s' = { ...s, ongoing: false } }
  action runInterrupted = all { s.ongoing, s' = { ...s, ongoing: false, interrupted: true } }
  /// Leaving a review. Without one open, going back changes nothing here.
  action back = all {
    not(s.busy), s.review or s.resendReview,
    s' = { ...s, review: false, unknownReview: false, resendReview: false }
  }
  /// The app stops. What it knew about receipts is gone; the journal entry is not.
  action restart = all {
    s.busy or s.intent or s.review or s.checked,
    s' = { ...settled(s), review: false, unknownReview: false,
      offer: false, resendReview: false, checked: false }
  }
  action step = any {
    lifecycleTap, cancelReply(true), cancelReply(false), dispatch, abortBeforeDispatch,
    serverApply, serverReplay, serverReject, requestLost, successReply, rejectedReply,
    unknownReply, refresh, resendTap, resendDispatch, abortResend,
    remoteEdit, runStarts, runFinishes, runInterrupted, back, restart, s' = s
  }
  val EverySendIsFirstOrReviewed = s.sent <= 1 + s.resends
  val AppliedOncePerIntent = s.applications <= s.admissions and s.applications == s.receipts.size()
  val ReleasedRequestCannotApply = s.wire > 0 and not(s.intent)
    implies s.version != s.wireVersion or s.receipts.contains(s.wireId)
  val UnseenChangeStaysRetained = appliedThis(s) and not(s.seen) implies s.intent
  /// Reading the receipt never leaves a retained change without a way forward: it is released,
  /// or the same request is offered for sending again.
  val CheckedRetainedIsOffered = s.intent and s.checked and not(s.busy) implies s.offer
  val OfferIsForRetainedVersion = s.offer implies s.intent and s.knownVersion == s.intentVersion
  val ResendNeedsOffer = s.resendReview implies s.offer and not(s.busy)
  val ReviewNeedsUnlocked = s.review implies not(s.intent) and not(s.busy)
  val UnknownReviewIsReview = s.unknownReview implies s.review and s.interrupted
  val BusyStage = s.busy == (s.stage != "idle")
  val TypeOK = s.stage.in(Set("idle", "admitted", "sent", "resending", "cancelling"))
    and s.reply.in(Set("none", "ok", "rejected")) and s.version.in(0.to(2))
    and s.admissions.in(0.to(3)) and s.sent.in(0.to(2)) and s.resends.in(0.to(2))
    and s.wire.in(0.to(2)) and s.wireId.in(0.to(3)) and s.receipts.subseteq(1.to(3))
  val safety = TypeOK and EverySendIsFirstOrReviewed and AppliedOncePerIntent
    and ReleasedRequestCannotApply and UnseenChangeStaysRetained and CheckedRetainedIsOffered
    and OfferIsForRetainedVersion and ResendNeedsOffer and ReviewNeedsUnlocked
    and UnknownReviewIsReview and BusyStage
  val AppliedUnconfirmedWitness = s.intent and appliedThis(s) and not(s.seen) and not(s.busy)
  val LateRequestReleasedWitness = s.wire > 0 and not(s.intent)
  /// The app stopped between the record and the send. The entry is retained until it is read.
  val NeverSentRetainedWitness = s.intent and s.sent == 0 and not(s.busy)
  val NeverSentResentAppliedWitness = s.resends == 1 and s.sent == 1 and s.seen and not(s.intent)
    and s.applications == 1
  val RefusedResendRetainedWitness = s.intent and s.offer and s.resends >= 1 and not(s.busy)
  val InterruptedReviewWitness = s.unknownReview and s.interrupted
  val RemovedThenRestoredWitness = s.applications == 2 and not(s.removed) and not(s.intent)
  run reviewedRemovalTest = init.then(lifecycleTap).expect(s.review and not(s.intent))
    .then(lifecycleTap).then(dispatch).then(serverApply).then(successReply)
    .expect(s.removed and s.knownRemoved and not(s.intent) and s.applications == 1 and safety)
  /// The reply to an applied removal is lost. Another change stays blocked until the agent's
  /// receipt is read, and nothing is sent twice.
  run lostReplyStaysRetainedTest = init.then(lifecycleTap).then(lifecycleTap).then(dispatch)
    .then(serverApply).then(unknownReply).then(restart)
    .expect(s.intent and s.removed and not(s.knownRemoved) and safety)
    .then(refresh).expect(not(s.intent) and s.knownRemoved and s.sent == 1 and safety)
    .then(lifecycleTap).then(lifecycleTap).then(dispatch).then(serverApply).then(successReply)
    .expect(not(s.removed) and s.applications == 2 and safety)
  /// The app stops after the change is recorded and before it is sent. Reading the receipt
  /// offers the same request; a reviewed second tap sends it and it is applied once.
  run neverSentIsResentTest = init.then(lifecycleTap).then(lifecycleTap).then(restart)
    .expect(NeverSentRetainedWitness and not(s.offer) and safety)
    .then(refresh).expect(s.intent and s.offer and s.sent == 0 and safety)
    .then(resendTap).expect(s.resendReview and s.sent == 0 and s.wire == 0 and safety)
    .then(resendTap).then(resendDispatch)
    .expect(s.wire == 1 and s.sent == 1 and s.resends == 1 and safety)
    .then(serverApply).then(successReply)
    .expect(s.removed and s.knownRemoved and not(s.intent) and s.applications == 1 and safety)
    .then(lifecycleTap).expect(s.review and safety)
  /// The first request was only delayed. The resent copy and the delayed one both reach the
  /// agent; the change is applied once and the second copy is answered from the receipt.
  run delayedCopyAndResendApplyOnceTest = init.then(lifecycleTap).then(lifecycleTap)
    .then(dispatch).then(unknownReply).then(refresh).expect(s.offer and s.wire == 1 and safety)
    .then(resendTap).then(resendTap).then(resendDispatch).expect(s.wire == 2 and safety)
    .then(serverApply).then(successReply).expect(not(s.intent) and s.wire == 1 and safety)
    .expect(s.receipts.contains(s.wireId))
    .then(serverReplay).expect(s.applications == 1 and s.removed and s.wire == 0 and safety)
  /// A resent copy is refused while a run is unfinished. The delayed first copy could still
  /// apply once the run ends, so the entry stays retained and the request is offered again.
  run refusedResendStaysRetainedTest = init.then(lifecycleTap).then(lifecycleTap)
    .then(dispatch).then(unknownReply).then(refresh).then(runStarts)
    .then(resendTap).then(resendTap).then(resendDispatch).then(serverReject).then(rejectedReply)
    .expect(s.intent and s.offer and s.wire == 1 and safety)
    .then(runFinishes).then(serverApply)
    .expect(s.removed and s.intent and safety)
    .then(refresh).expect(not(s.intent) and s.seen and s.knownRemoved and safety)
  /// A resent copy refused because the workflow moved on is released: no copy can apply.
  run resendAfterEditReleasesTest = init.then(lifecycleTap).then(lifecycleTap).then(restart)
    .then(refresh).then(resendTap).then(remoteEdit).then(resendTap).then(resendDispatch)
    .then(serverReject).then(rejectedReply)
    .expect(not(s.intent) and s.knownVersion == 1 and not(s.removed) and s.applications == 0 and safety)
  /// Leaving the resend review, or leaving before the resend goes out, sends nothing.
  run abandonedResendKeepsEntryTest = init.then(lifecycleTap).then(lifecycleTap).then(restart)
    .then(refresh).then(resendTap).then(back).expect(s.intent and s.offer and not(s.resendReview) and safety)
    .then(resendTap).then(resendTap).then(abortResend)
    .expect(s.intent and s.sent == 0 and s.wire == 0 and not(s.offer) and safety)
    .then(refresh).expect(s.offer and safety)
  /// The workflow changed elsewhere while the request was still on its way. The entry is
  /// released as a known non-change and the late request is refused.
  run changedVersionReleasesTest = init.then(lifecycleTap).then(lifecycleTap).then(dispatch)
    .then(unknownReply).then(remoteEdit).then(refresh)
    .expect(not(s.intent) and s.wire == 1 and safety)
    .then(serverReject).expect(not(s.removed) and s.applications == 0 and safety)
  run refusedChangeReleasesTest = init.then(lifecycleTap).then(lifecycleTap).then(remoteEdit)
    .then(dispatch).then(serverReject).then(rejectedReply)
    .expect(not(s.intent) and s.knownVersion == 1 and not(s.removed) and safety)
  run interruptedRunsAreCancelledFirstTest = init.then(runStarts).then(runInterrupted)
    .then(lifecycleTap).expect(s.unknownReview and not(s.intent) and safety)
    .then(lifecycleTap).then(cancelReply(true)).expect(not(s.interrupted) and not(s.intent) and safety)
    .then(lifecycleTap).then(lifecycleTap).expect(s.intent and s.stage == "admitted" and safety)
  /// A retained change blocks a new one, and nothing is resent before the receipt is read.
  run unreadRetainedCannotResendTest = init.then(lifecycleTap).then(lifecycleTap).then(restart)
    .expect(s.intent and not(s.offer) and safety).then(resendTap.fail())
  run retainedBlocksAnotherChangeTest = init.then(lifecycleTap).then(lifecycleTap).then(dispatch)
    .then(requestLost).then(unknownReply).then(refresh)
    .expect(s.intent and s.offer and not(s.removed) and safety)
    .then(lifecycleTap.fail())
  /// A second copy of an applied request cannot be applied again.
  run appliedCopyCannotApplyAgainTest = init.then(lifecycleTap).then(lifecycleTap)
    .then(dispatch).then(unknownReply).then(refresh).then(resendTap).then(resendTap)
    .then(resendDispatch).then(serverApply).expect(s.wire == 1 and safety)
    .then(serverApply.fail())
  run ongoingRunBlocksRemovalTest = init.then(runStarts).expect(safety)
    .then(lifecycleTap.fail())
  run abortBeforeDispatchReleasesTest = init.then(lifecycleTap).then(lifecycleTap)
    .then(abortBeforeDispatch).expect(not(s.intent) and s.sent == 0 and s.wire == 0 and safety)
}
