// The receipt of one photo edit in the browser library. A save claims the receipt for one
// attempt and one mode; the written photo and the saved receipt commit together; reading an
// uncommitted outcome retires it so a suspended save cannot commit afterwards. A copy never
// writes the original; a replace overwrites exactly the reviewed revision.
module CopyReceipt {
  type State = {
    status: str, parameters: int, replace: bool, attempt: int, serial: int, inflight: Set[int],
    sessionActive: bool, recordedRevision: int, sourceRevision: int, sourceTrashed: bool,
    externalEdits: int, copies: int, replaces: int, reportedNoCopy: bool, refusedSaves: int
  }
  var s: State
  action init = s' = {
    status: "none", parameters: -1, replace: false, attempt: 0, serial: 0, inflight: Set(),
    sessionActive: false, recordedRevision: 0, sourceRevision: 0, sourceTrashed: false,
    externalEdits: 0, copies: 0, replaces: 0, reportedNoCopy: false, refusedSaves: 0
  }
  pure val Terminal = Set("saved", "failed", "cancelled", "unchanged")
  // Opening the editor writes a prepared receipt bound to the source revision shown.
  action begin = all { s.status == "none", not(s.sourceTrashed),
    s' = { ...s, status: "prepared", sessionActive: true, recordedRevision: s.sourceRevision } }
  // Parameters 0 is the identity edit. A receipt serves one set of parameters, one mode and one
  // attempt: a retry cannot turn a copy into a replace.
  action save(parameters: int, replace: bool): bool = all { Set(0, 1, 2).contains(parameters), s.serial < 3,
    val other = s.parameters != -1 and (s.parameters != parameters or s.replace != replace)
    val refused = s.status == "none" or other or s.status == "saving"
    s' = if (refused) { ...s, refusedSaves: if (s.refusedSaves < 2) s.refusedSaves + 1 else 2 }
      else if (Terminal.contains(s.status)) s
      else if (parameters == 0) { ...s, status: "unchanged", parameters: parameters, replace: replace, attempt: s.serial + 1, serial: s.serial + 1 }
      else { ...s, status: "saving", parameters: parameters, replace: replace, attempt: s.serial + 1, serial: s.serial + 1,
        inflight: s.inflight.union(Set(s.serial + 1)) } }
  // The rendered copy is committed only by the attempt that still owns the saving receipt, over
  // an open editor and an unchanged, untrashed source.
  action commit(attempt: int): bool = all { s.inflight.contains(attempt),
    val owns = s.status == "saving" and s.attempt == attempt
    val admitted = s.sessionActive and not(s.sourceTrashed) and s.sourceRevision == s.recordedRevision
    s' = { ...s, inflight: s.inflight.exclude(Set(attempt)),
      status: if (not(owns)) s.status else if (admitted) "saved" else "failed",
      copies: if (owns and admitted and not(s.replace)) s.copies + 1 else s.copies,
      replaces: if (owns and admitted and s.replace) s.replaces + 1 else s.replaces,
      sourceRevision: if (owns and admitted and s.replace) s.sourceRevision + 1 else s.sourceRevision } }
  action renderFails(attempt: int): bool = all { s.inflight.contains(attempt),
    s' = { ...s, inflight: s.inflight.exclude(Set(attempt)),
      status: if (s.status == "saving" and s.attempt == attempt) "failed" else s.status } }
  // Recovery reads the outcome. An uncommitted receipt is cancelled in the same transaction.
  action readResult = all { s.status != "none",
    s' = { ...s, status: if (s.status.in(Set("prepared", "saving"))) "cancelled" else s.status,
      reportedNoCopy: s.reportedNoCopy or s.status.in(Set("prepared", "saving", "cancelled")) } }
  action cancelEditor = all { s.status != "none",
    s' = { ...s, sessionActive: false,
      status: if (s.status.in(Set("prepared", "saving"))) "cancelled" else s.status,
      reportedNoCopy: s.reportedNoCopy or s.status.in(Set("prepared", "saving", "cancelled")) } }
  action sessionExpires = s' = { ...s, sessionActive: false }
  action externalEdit = all { s.externalEdits < 2,
    s' = { ...s, sourceRevision: s.sourceRevision + 1, externalEdits: s.externalEdits + 1 } }
  action trashSource = s' = { ...s, sourceTrashed: true }
  action step = {
    nondet choice = 0.to(5).oneOf()
    nondet attempt = 1.to(3).oneOf()
    any { begin, save(choice / 2, choice % 2 == 1), commit(attempt), renderFails(attempt), readResult, cancelEditor,
      sessionExpires, externalEdit, trashSource, s' = s }
  }
  val AtMostOneWritePerOperation = (s.copies + s.replaces).in(Set(0, 1))
  val WriteIffSavedReceipt = (s.copies + s.replaces == 1) == (s.status == "saved")
  val ReadRetiresUncommitted = s.reportedNoCopy implies s.copies + s.replaces == 0 and s.status != "saving"
  val CopyNeverWritesSource = s.sourceRevision == s.externalEdits + s.replaces
  val ReplaceOnlyWhenChosen = (s.replaces == 1 implies s.replace) and (s.copies == 1 implies not(s.replace))
  val SavingHasOneOwner = s.status == "saving" implies s.inflight.contains(s.attempt) and s.parameters > 0
  val safety = AtMostOneWritePerOperation and WriteIffSavedReceipt and ReadRetiresUncommitted
    and CopyNeverWritesSource and ReplaceOnlyWhenChosen and SavingHasOneOwner
  val SuspendedSaveRetiredWitness = s.status == "cancelled" and s.inflight != Set()
  val SavedCopyWitness = s.copies == 1
  val ReplacedOriginalWitness = s.replaces == 1 and s.sourceRevision != s.recordedRevision
  val ChangedSourceFailedWitness = s.status == "failed" and s.sourceRevision != s.recordedRevision
  val SecondSaveRefusedWitness = s.refusedSaves > 0 and s.status == "saving"
  run copyAndReceiptCommitTogetherTest = init.then(begin).then(save(1, false)).then(commit(1))
    .expect(s.status == "saved" and s.copies == 1 and safety).then(save(1, false)).then(readResult)
    .expect(s.copies == 1 and s.status == "saved" and not(s.reportedNoCopy) and safety)
  // Recovery reports no copy while a save is suspended: that save can no longer commit.
  run readRetiresSuspendedSaveTest = init.then(begin).then(save(1, false)).then(readResult)
    .expect(s.status == "cancelled" and s.reportedNoCopy and safety).then(commit(1))
    .expect(s.copies == 0 and s.status == "cancelled" and safety)
  run changedSourceFailsTest = init.then(begin).then(save(2, false)).then(externalEdit).then(commit(1))
    .expect(s.status == "failed" and s.copies == 0 and safety)
  // A copy save retried as a replace is refused; the suspended copy still commits as a copy.
  run retryCannotTurnCopyIntoReplaceTest = init.then(begin).then(save(1, false)).then(save(1, true))
    .expect(s.refusedSaves == 1 and not(s.replace) and safety).then(commit(1))
    .expect(s.copies == 1 and s.replaces == 0 and s.sourceRevision == 0 and safety)
  run replaceOverwritesReviewedRevisionTest = init.then(begin).then(save(1, true)).then(commit(1))
    .expect(s.status == "saved" and s.replaces == 1 and s.copies == 0 and s.sourceRevision == 1 and safety)
  run identityEditMakesNoCopyTest = init.then(begin).then(save(0, false))
    .expect(s.status == "unchanged" and s.copies == 0 and s.inflight == Set() and safety)
  run otherParametersRefusedTest = init.then(begin).then(save(1, false)).then(save(2, false))
    .expect(s.refusedSaves == 1 and s.parameters == 1 and s.inflight == Set(1) and safety)
}
