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
  /// Shared by the registered state-machine scenario and the source planner table adapter.
  pure val decisionRows = tuples(Set("original", "deleted", "changed"), Set(false, true),
    Set(false, true), Set(false, true), Set("unknown", "removed", "restored", "purged", "unreadable"), Set(false, true))
    .map(((note, known, owned, inTrash, receipt, referenced)) => { note: note, known: known,
      owned: owned, inTrash: inTrash, receipt: receipt, referenced: referenced,
      plan: recoveryPlan(note, known, owned, inTrash, receipt, referenced) })
  type State = { note: str, recordingKnown: bool, owned: bool, inTrash: bool,
    receipt: str, referenced: bool, row: bool, previousProcess: bool,
    claimedElsewhere: bool, lease: int, locked: bool, revision: int,
    capturedRevision: int, planned: str, erasures: int, safeErase: bool }
  var s: State
  action initial(note: str, receipt: str, inTrash: bool): bool = s' = {
    note: note, recordingKnown: true, owned: true, inTrash: inTrash, receipt: receipt,
    referenced: false, row: true, previousProcess: true, claimedElsewhere: false,
    lease: 0, locked: false, revision: 0, capturedRevision: 0, planned: "none",
    erasures: 0, safeErase: true }
  action init = initial("deleted", "unknown", false)
  val plan = recoveryPlan(s.note, s.recordingKnown, s.owned, s.inTrash, s.receipt, s.referenced)
  action acquire = all { s.row, s.previousProcess, not(s.claimedElsewhere), s.lease == 0, not(s.locked),
    s' = { ...s, locked: true, capturedRevision: s.revision, planned: plan } }
  action apply = all { s.locked, s.row, s.capturedRevision == s.revision, s.planned == plan,
    s' = if (plan == "retire") { ...s, row: false, locked: false, planned: "none" }
    else if (plan == "erase") { ...s, receipt: "purged", inTrash: false, erasures: 1,
      safeErase: s.note == "deleted" and not(s.referenced), locked: false, planned: "none" }
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
    externalChange, otherReference, unreadable, crash, s' = s }
  val ExactRecoveryOwnership = s.locked implies s.row and s.previousProcess and not(s.claimedElsewhere) and s.lease == 0
  val NoUnownedErasure = s.erasures == 0 or s.safeErase
  val ChangedRecordNeedsReview = s.note == "changed" implies plan == "review"
  val safety = ExactRecoveryOwnership and NoUnownedErasure and ChangedRecordNeedsReview
  run finishInterruptedDeletionTest = init.then(acquire).then(apply)
    .expect(s.receipt == "removed" and s.row).then(crash).then(acquire).then(apply)
    .expect(s.receipt == "purged" and s.row).then(acquire).then(apply).expect(not(s.row) and safety)
  run rollbackRecordingTest = initial("original", "removed", true).then(acquire).then(apply)
    .expect(s.receipt == "restored").then(acquire).then(apply).expect(not(s.row) and safety)
  run purgedRecordingCommitsNoteTest = initial("original", "purged", false).then(acquire).then(apply)
    .expect(s.note == "deleted").then(acquire).then(apply).expect(not(s.row) and safety)
  run sharedAudioReviewTest = init.then(otherReference).then(acquire).then(apply)
    .expect(s.row and s.lease == 2 and s.erasures == 0 and safety)
  run liveRendererLeaseTest = init.then(liveClaim).then(tick).then(renewLease)
    .expect(s.lease == 2 and s.claimedElsewhere and not(s.locked) and safety)
  run changedNoteReviewTest = init.then(externalChange).then(acquire).then(apply)
    .expect(s.row and s.erasures == 0 and safety)
  run recoveryPlanCasesTest = {
    nondet note = Set("original", "deleted", "changed").oneOf()
    nondet receipt = Set("unknown", "removed", "restored", "purged", "unreadable").oneOf()
    nondet inTrash = Set(false, true).oneOf()
    nondet known = Set(false, true).oneOf()
    nondet owned = Set(false, true).oneOf()
    nondet referenced = Set(false, true).oneOf()
    initial(note, receipt, inTrash).then(s' = { ...s, recordingKnown: known, owned: owned, referenced: referenced })
  }
  run decisionTableTest = init.expect(decisionRows.size() == 240)
}

/// Exhaustive finite decision table, kept separate from mutable recovery state.
module PermanentVoiceDeletionContract {
  import PermanentVoiceDeletion.decisionRows
  type Row = { note: str, known: bool, owned: bool, inTrash: bool, receipt: str, referenced: bool, plan: str }
  var rows: Set[Row]
  action init = rows' = decisionRows
  run decisionTableTest = init.expect(rows.size() == 240)
}
