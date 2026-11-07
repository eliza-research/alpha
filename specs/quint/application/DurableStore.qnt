/// BrowserDomainDocument read/create/CAS, corruption recovery and legacy-write fencing.
/// Opaque values distinguish saved bytes, drafts and retained legacy bytes without parsing content.
module DurableStore {
  type State = { version: int, value: str, legacy: str, baselineLegacy: str,
    readable: bool, draft: str, capturedVersion: int, capturedLegacy: str,
    phase: str, committed: bool, writeFault: bool, emptyTombstone: bool }
  var s: State
  action init = s' = { version: 0, value: "empty", legacy: "old", baselineLegacy: "old",
    readable: true, draft: "empty", capturedVersion: 0, capturedLegacy: "old",
    phase: "idle", committed: false, writeFault: false, emptyTombstone: false }
  action read = all { s.readable, s.legacy == s.baselineLegacy,
    s' = { ...s, draft: s.value, phase: "idle" } }
  action edit = all { s.readable, s.legacy == s.baselineLegacy,
    s' = { ...s, draft: "edit", capturedVersion: s.version,
      capturedLegacy: s.legacy, phase: "editing", committed: false } }
  action prepare = all { s.phase == "editing", s.readable, s.legacy == s.capturedLegacy,
    s' = { ...s, phase: "prepared" } }
  // The last legacy check runs inside the editor before Documents commits its CAS.
  // Another legacy writer can run after that check. A later read detects it.
  action commit = all { s.phase == "prepared", s.readable, not(s.writeFault),
    s.version == s.capturedVersion, s.version < 2,
    s' = { ...s, value: s.draft, version: s.version + 1, phase: "saved", committed: true } }
  action concurrentWrite = all { s.version < 2,
    s' = { ...s, value: "other", version: s.version + 1, committed: false } }
  action legacyWrite = s' = { ...s, legacy: "changed", committed: false }
  action corrupt = s' = { ...s, readable: false, committed: false }
  action failWrites = s' = { ...s, writeFault: true, committed: false }
  action captureRecovery = s' = { ...s, phase: "review", capturedVersion: s.version,
    capturedLegacy: s.legacy, committed: false }
  action restoreReviewed = all { s.phase == "review", not(s.writeFault), s.version < 2,
    s.version == s.capturedVersion, s.legacy == s.capturedLegacy,
    s' = { ...s, value: "recovered", readable: true, baselineLegacy: s.legacy,
      version: s.version + 1, phase: "saved", committed: true } }
  action clearReviewed = all { s.phase == "review", not(s.writeFault), s.version < 2,
    s.version == s.capturedVersion, s.legacy == s.capturedLegacy,
    s' = { ...s, value: "empty", readable: true, baselineLegacy: s.legacy,
      version: s.version + 1, phase: "saved", emptyTombstone: true, committed: true } }
  action restart = s' = { ...s, phase: "idle", draft: s.value, writeFault: false, committed: false }
  action step = any { read, edit, prepare, commit, concurrentWrite, legacyWrite, corrupt,
    failWrites, captureRecovery, restoreReviewed, clearReviewed, restart, s' = s }
  val CommitCurrent = s.committed implies s.version == s.capturedVersion + 1
  // Stronger cross-store condition, retained as a separately falsifiable claim.
  // The source detects a late external legacy write on its next read.
  val CommitLegacyCurrent = s.committed implies s.legacy == s.capturedLegacy
  val LegacyRetained = s.legacy.in(Set("old", "changed"))
  val BoundedVersion = s.version.in(0.to(2))
  val safety = CommitCurrent and LegacyRetained and BoundedVersion
  run competingWriterTest = init.then(edit).then(concurrentWrite)
    .expect(s.value == "other" and s.draft == "edit" and s.version != s.capturedVersion and safety)
  run corruptRecoveryTest = init.then(corrupt).then(captureRecovery).then(restoreReviewed)
    .expect(s.readable and s.value == "recovered" and s.legacy == "old" and safety)
  run staleRecoveryTest = init.then(captureRecovery).then(legacyWrite)
    .expect(s.legacy != s.capturedLegacy and not(s.committed) and safety)
  run failedWriteRetainsDraftTest = init.then(edit).then(failWrites)
    .expect(s.draft == "edit" and s.value == "empty" and safety)
  run legacyWriteAfterPrepareTest = init.then(edit).then(prepare).then(legacyWrite).then(commit)
    .expect(s.committed and not(CommitLegacyCurrent) and safety)
}
