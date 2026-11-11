/// Typed workflow authoring: a local draft is reviewed, then saved on the agent under one
/// mutation identity. The agent applies a mutation identity at most once.
module WorkflowAuthoring {
  type Authoring = {
    draft: bool, spec: int, review: int, pending: int, pendingSpec: int, minted: int,
    busy: bool, unreceipted: bool, resendReview: bool, storageFailed: bool, discardAsk: bool,
    wire: int, applied: Set[int], saves: int, agentChanged: bool, compilerChanged: bool,
    committed: bool
  }
  var s: Authoring
  action init = s' = {
    draft: true, spec: 0, review: -1, pending: 0, pendingSpec: 0, minted: 0,
    busy: false, unreceipted: false, resendReview: false, storageFailed: false, discardAsk: false,
    wire: 0, applied: Set(), saves: 0, agentChanged: false, compilerChanged: false,
    committed: false }
  val Locked = s.busy or s.pending != 0 or s.storageFailed
  val Applied = s.applied.contains(s.pending)
  pure def saved(v: Authoring): Authoring = { ...v, committed: true, draft: false, pending: 0,
    busy: false, review: -1, unreceipted: false, resendReview: false }
  action edit = all {
    s.draft, not(Locked), s.spec < 2,
    s' = { ...s, spec: s.spec + 1, discardAsk: false }
  }
  /// The first tap shows the full specification. The second sends exactly what was shown,
  /// after the mutation identity is stored with the draft.
  action saveTap = all {
    s.draft, not(Locked), s.minted < 3,
    if (s.review != s.spec) s' = { ...s, review: s.spec }
    else s' = { ...s, pending: s.minted + 1, minted: s.minted + 1, pendingSpec: s.spec,
      busy: true, wire: s.wire + 1 }
  }
  action requestLost = all { s.wire > 0, s' = { ...s, wire: s.wire - 1 } }
  /// The agent saves the workflow, or answers a repeat of an applied identity with its receipt.
  action serverApply = all {
    s.wire > 0, s.pending != 0, Applied or not(s.agentChanged),
    s' = { ...s, wire: s.wire - 1, applied: s.applied.union(Set(s.pending)),
      saves: if (Applied) s.saves else s.saves + 1 }
  }
  action receiptReply = all { s.busy, s.pending != 0, Applied, s' = saved(s) }
  /// The agent refused this exact edit because the workflow changed. It is a known non-save,
  /// so the draft unlocks.
  action refusalReply = all {
    s.busy, s.pending != 0, s.wire > 0, not(Applied), s.agentChanged,
    s' = { ...s, wire: 0, pending: 0, busy: false, review: -1, unreceipted: false, resendReview: false }
  }
  /// No answer arrived (`seen`), or the app was hidden before one could. The draft stays locked
  /// on its pending identity.
  action unknownReply(seen: bool): bool = all {
    s.busy,
    s' = { ...s, busy: false, unreceipted: s.unreceipted and not(seen) }
  }
  /// Refreshing the receipt only reads. No record of the save permits an explicit resend.
  action recover(answered: bool): bool = all {
    s.pending != 0, not(s.busy),
    if (not(answered)) s' = { ...s, unreceipted: false, resendReview: false }
    else if (Applied) s' = saved(s)
    else s' = { ...s, unreceipted: true, resendReview: false }
  }
  /// The first tap asks for confirmation. The second repeats the same request with the same
  /// mutation identity, unless the agent's compiler changed since.
  action resendTap = all {
    s.pending != 0, not(s.busy), s.unreceipted, s.wire < 2,
    if (s.compilerChanged) s' = { ...s, unreceipted: false, resendReview: false }
    else if (not(s.resendReview)) s' = { ...s, resendReview: true }
    else if (Applied) s' = saved(s)
    else s' = { ...s, resendReview: false, busy: true, wire: s.wire + 1 }
  }
  action agentChange = all { not(s.agentChanged), s' = { ...s, agentChanged: true } }
  action compilerChange = all { not(s.compilerChanged), s' = { ...s, compilerChanged: true } }
  action storageFails = all { s.draft, not(s.storageFailed), s' = { ...s, storageFailed: true } }
  action storageRecovers = all { s.storageFailed, s' = { ...s, storageFailed: false } }
  /// A draft with a pending save cannot be discarded.
  action discardTap = all {
    s.draft, not(s.busy), s.pending == 0,
    if (s.discardAsk) s' = { ...s, draft: false, discardAsk: false, review: -1 }
    else s' = { ...s, discardAsk: true }
  }
  /// The draft and its pending identity are stored. Review and resend confirmations are not.
  action restart = s' = { ...s, busy: false, unreceipted: false, resendReview: false, review: -1,
    discardAsk: false }
  action step = any {
    edit, saveTap, requestLost, serverApply, receiptReply, refusalReply, unknownReply(true),
    unknownReply(false),
    recover(true), recover(false), resendTap, agentChange, compilerChange, storageFails,
    storageRecovers, discardTap, restart, s' = s
  }
  val OneSavePerDraft = s.saves <= 1 and s.saves == s.applied.size()
  val PendingNeverEdited = s.pending != 0 implies s.spec == s.pendingSpec and s.draft
  val AppliedNeverAbandoned = s.saves > 0 implies s.committed or Applied
  val ResendNeedsNoRecord = s.resendReview implies s.unreceipted and s.pending != 0 and not(s.busy)
  val UnreceiptedMeansPending = s.unreceipted implies s.pending != 0
  val CommittedClearsDraft = s.committed implies not(s.draft) and s.pending == 0 and s.saves == 1
  val WireNeedsIdentity = s.wire > 0 implies s.pending != 0 or s.committed
  val TypeOK = s.spec.in(0.to(2)) and s.minted.in(0.to(3)) and s.wire.in(0.to(2)) and s.pending.in(0.to(3))
  val safety = TypeOK and OneSavePerDraft and PendingNeverEdited and AppliedNeverAbandoned
    and ResendNeedsNoRecord and UnreceiptedMeansPending and CommittedClearsDraft and WireNeedsIdentity
  val UnreceiptedWitness = s.unreceipted and s.wire == 0 and not(Applied)
  val ResendConfirmWitness = s.resendReview
  val RepeatOnWireWitness = s.wire == 2 and s.busy
  val AppliedUnknownWitness = s.pending != 0 and Applied and not(s.busy)
  val RefusedThenEditedWitness = s.minted == 1 and s.pending == 0 and s.draft and s.spec == 1 and s.agentChanged
  /// The reply to a save that was applied is lost. Refreshing the receipt finishes the save
  /// without sending anything.
  run lostReplyDoesNotDuplicateTest = init.then(saveTap).then(saveTap).then(serverApply)
    .then(unknownReply(true)).expect(s.pending == 1 and not(s.busy) and safety)
    .then(recover(true)).expect(s.committed and s.saves == 1 and s.minted == 1 and safety)
  /// The request never arrived. Only an explicit, confirmed resend repeats it, under the
  /// original identity.
  run unreceiptedExactResendTest = init.then(saveTap).then(saveTap).then(requestLost)
    .then(unknownReply(true)).then(recover(true)).expect(s.unreceipted and s.saves == 0 and safety)
    .then(resendTap).expect(s.resendReview and s.wire == 0)
    .then(resendTap).expect(s.busy and s.wire == 1 and s.pending == 1 and s.minted == 1)
    .then(serverApply).then(receiptReply).expect(s.committed and s.saves == 1 and safety)
  run slowRequestAndResendApplyOnceTest = init.then(saveTap).then(saveTap).then(unknownReply(true))
    .then(recover(true)).then(resendTap).then(resendTap).expect(s.wire == 2)
    .then(serverApply).then(serverApply).then(receiptReply).expect(s.saves == 1 and safety)
  run refusedSaveUnlocksDraftTest = init.then(saveTap).then(saveTap).then(agentChange)
    .then(refusalReply).expect(s.pending == 0 and not(s.busy) and s.saves == 0 and safety)
    .then(edit).expect(s.spec == 1 and safety)
  run pendingBlocksEditTest = init.then(saveTap).then(saveTap).then(unknownReply(true)).then(restart)
    .expect(s.pending == 1 and safety)
    .then(edit.fail())
  run pendingBlocksDiscardTest = init.then(saveTap).then(saveTap).then(unknownReply(true))
    .expect(safety)
    .then(discardTap.fail())
  run changedCompilerBlocksResendTest = init.then(saveTap).then(saveTap).then(requestLost)
    .then(unknownReply(true)).then(recover(true)).then(compilerChange).then(resendTap)
    .expect(not(s.unreceipted) and s.pending == 1 and s.wire == 0 and safety)
    .then(resendTap.fail())
}
