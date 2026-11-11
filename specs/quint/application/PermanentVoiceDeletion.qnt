/// Two durable effects and recovery ownership from planInterruptedPermanentDeletion.
module PermanentVoiceDeletion {
  pure def recoveryPlan(note: str, known: bool, owned: bool, inTrash: bool, receipt: str, referenced: bool): str =
    if (note == "changed" or not(known) or not(owned) or receipt == "unreadable") "review"
    else if (note == "deleted") {
      if (referenced) "review"
      else if (receipt == "purged") "retire"
      else if (receipt == "removed") { if (inTrash) "erase" else "review" }
      else if (receipt == "unknown") { if (inTrash) "review" else "trash-then-erase" }
      else "review"
    } else {
      if (receipt == "purged") "delete-note"
      else if (receipt == "removed") { if (inTrash) "restore-recording" else "review" }
      else if (inTrash) "review" else "retire"
    }
  type State = { note: str, recordingKnown: bool, owned: bool, inTrash: bool,
    receipt: str, referenced: bool, row: bool, previousProcess: bool,
    claimedElsewhere: bool, lease: int, locked: bool, revision: int,
    capturedRevision: int, planned: str, erasures: int, safeErase: bool }
  var s: State
  action initialFor(note: str, receipt: str, inTrash: bool, previous: bool): bool = s' = {
    note: note, recordingKnown: true, owned: true, inTrash: inTrash, receipt: receipt,
    referenced: false, row: true, previousProcess: previous, claimedElsewhere: false,
    lease: 0, locked: false, revision: 0, capturedRevision: 0, planned: "none",
    erasures: 0, safeErase: true }
  action initial(note: str, receipt: str, inTrash: bool): bool = initialFor(note, receipt, inTrash, true)
  /// The row either survived an earlier process or was just started by this live view.
  action init = {
    nondet previous = Bool.oneOf()
    initialFor("deleted", "unknown", false, previous)
  }
  /// A live view starts a new deletion row of its own. Recovery leaves it alone until that
  /// view's process is gone.
  action startOwn = all { not(s.row),
    s' = { ...s, row: true, previousProcess: false, note: "deleted", receipt: "unknown",
      inTrash: false, recordingKnown: true, owned: true, referenced: false, locked: false,
      planned: "none", claimedElsewhere: false, lease: 0 } }
  /// The recording stops being this note's alone to delete.
  action loseOwnership = all { not(s.locked), s.owned, s.revision < 2,
    s' = { ...s, owned: false, revision: s.revision + 1 } }
  val plan = recoveryPlan(s.note, s.recordingKnown, s.owned, s.inTrash, s.receipt, s.referenced)
  action acquire = all { s.row, s.previousProcess, not(s.claimedElsewhere), s.lease == 0, not(s.locked),
    s' = { ...s, locked: true, capturedRevision: s.revision, planned: plan } }
  action apply = all { s.locked, s.row, s.capturedRevision == s.revision, s.planned == plan,
    s' = if (plan == "retire") { ...s, row: false, locked: false, planned: "none" }
    else if (plan == "erase") { ...s, receipt: "purged", inTrash: false, erasures: 1,
      safeErase: s.note == "deleted" and not(s.referenced) and s.owned and s.recordingKnown, locked: false, planned: "none" }
    else if (plan == "trash-then-erase") { ...s, receipt: "removed", inTrash: true, locked: false, planned: "none" }
    else if (plan == "restore-recording") { ...s, receipt: "restored", inTrash: false, locked: false, planned: "none" }
    else if (plan == "delete-note") { ...s, note: "deleted", locked: false, planned: "none" }
    else { ...s, locked: false, lease: 2, planned: "none" } }
  action liveClaim = all { not(s.locked), s' = { ...s, claimedElsewhere: true, lease: 2 } }
  action processGone = s' = { ...s, previousProcess: true, claimedElsewhere: false, locked: false, planned: "none" }
  action tick = all { s.lease > 0, s' = { ...s, lease: s.lease - 1 } }
  action renewLease = all { s.claimedElsewhere, s' = { ...s, lease: 2 } }
  action externalChange = all { not(s.locked), s.revision < 2,
    s' = { ...s, note: "changed", revision: s.revision + 1 } }
  action otherReference = all { not(s.locked), s.revision < 2,
    s' = { ...s, referenced: true, revision: s.revision + 1 } }
  action unreadable = all { not(s.locked), s' = { ...s, recordingKnown: false } }
  action crash = s' = { ...s, locked: false, planned: "none", previousProcess: true }
  action step = any { acquire, apply, liveClaim, processGone, tick, renewLease,
    externalChange, otherReference, unreadable, crash, startOwn, loseOwnership, s' = s }
  val ExactRecoveryOwnership = s.locked implies s.row and s.previousProcess and not(s.claimedElsewhere) and s.lease == 0
  val NoUnownedErasure = s.erasures == 0 or s.safeErase
  val ChangedRecordNeedsReview = s.note == "changed" implies plan == "review"
  val UnownedNeedsReview = (s.row and not(s.owned)) implies plan == "review"
  val safety = ExactRecoveryOwnership and NoUnownedErasure and ChangedRecordNeedsReview and UnownedNeedsReview
  val LiveOwnRowWitness = s.row and not(s.previousProcess) and not(s.locked)
  val UnownedUnderReviewWitness = s.row and not(s.owned) and s.lease == 2 and not(s.claimedElsewhere)
  val ErasedWitness = s.erasures == 1 and s.receipt == "purged"
  run finishInterruptedDeletionTest = initial("deleted", "unknown", false).then(acquire).then(apply)
    .expect(s.receipt == "removed" and s.row).then(crash).then(acquire).then(apply)
    .expect(s.receipt == "purged" and s.row).then(acquire).then(apply).expect(not(s.row) and safety)
  run rollbackRecordingTest = initial("original", "removed", true).then(acquire).then(apply)
    .expect(s.receipt == "restored").then(acquire).then(apply).expect(not(s.row) and safety)
  run purgedRecordingCommitsNoteTest = initial("original", "purged", false).then(acquire).then(apply)
    .expect(s.note == "deleted").then(acquire).then(apply).expect(not(s.row) and safety)
  run sharedAudioReviewTest = initial("deleted", "unknown", false).then(otherReference).then(acquire).then(apply)
    .expect(s.row and s.lease == 2 and s.erasures == 0 and safety)
  run liveRendererLeaseTest = initial("deleted", "unknown", false).then(liveClaim).then(tick).then(renewLease)
    .expect(s.lease == 2 and s.claimedElsewhere and not(s.locked) and safety)
  run changedNoteReviewTest = initial("deleted", "unknown", false).then(externalChange).then(acquire).then(apply)
    .expect(s.row and s.erasures == 0 and safety)
  run recoveryPlanCasesTest = {
    nondet note = Set("original", "deleted", "changed").oneOf()
    nondet receipt = Set("unknown", "removed", "restored", "purged", "unreadable").oneOf()
    nondet inTrash = Set(false, true).oneOf()
    nondet known = Set(false, true).oneOf()
    nondet owned = Set(false, true).oneOf()
    nondet referenced = Set(false, true).oneOf()
    initial(note, receipt, inTrash).then(s' = { ...s, recordingKnown: known, owned: owned, referenced: referenced })
      .expect((plan == "erase" implies (s.note == "deleted" and s.owned and s.inTrash and not(s.referenced) and s.recordingKnown))
        and (not(s.owned) or not(s.recordingKnown) or s.note == "changed" implies plan == "review") and safety)
  }
  /// A row a live view started is not recovered until that view's process is gone.
  run liveOwnRowNotRecoveredTest = initial("deleted", "unknown", false).then(acquire).then(apply).then(acquire).then(apply)
    .then(acquire).then(apply).expect(not(s.row)).then(startOwn)
    .expect(s.row and not(s.previousProcess) and not(s.locked) and safety)
    .then(processGone).then(acquire).expect(s.locked and s.planned == "trash-then-erase" and safety)
  run lostOwnershipReviewTest = initial("deleted", "unknown", false).then(acquire).then(apply).then(loseOwnership).then(acquire).then(apply)
    .expect(s.row and s.erasures == 0 and s.lease == 2 and s.receipt == "removed" and safety)
}

/// Exhaustive finite decision table, kept separate from mutable recovery state.
module PermanentVoiceDeletionContract {
  import PermanentVoiceDeletion.recoveryPlan
  type Row = { note: str, known: bool, owned: bool, inTrash: bool, receipt: str, referenced: bool, plan: str }
  var rows: Set[Row]
  action init = rows' = tuples(Set("original", "deleted", "changed"), Set(false, true),
    Set(false, true), Set(false, true), Set("unknown", "removed", "restored", "purged", "unreadable"), Set(false, true))
    .map(((note, known, owned, inTrash, receipt, referenced)) => { note: note, known: known,
      owned: owned, inTrash: inTrash, receipt: receipt, referenced: referenced,
      plan: recoveryPlan(note, known, owned, inTrash, receipt, referenced) })
  run decisionTableTest = init.expect(rows.size() == 240
    and rows.forall(row => row.plan == "erase" implies (row.note == "deleted" and row.known and row.owned and row.inTrash and not(row.referenced)))
    and rows.forall(row => (row.note == "changed" or not(row.known) or not(row.owned) or row.receipt == "unreadable") implies row.plan == "review"))
}
