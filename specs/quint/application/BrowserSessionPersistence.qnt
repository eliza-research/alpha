/// The saved-tabs writer behind the browser poll: the hydration gate, one write in flight,
/// change detection, and backoff after a rejected write.
module BrowserSessionPersistence {
  // Snapshot contents are identities; 0 is the empty record.
  pure val Contents = 0.to(3)
  pure val None = -1
  type State = {
    readDone: bool, hydrated: bool, clearing: bool,
    // What the renderer would save now, and whether an input changed since the saver last looked.
    content: int, dirty: bool,
    lastSaved: int, failed: bool, failures: int,
    // Poll ticks left before a rejected snapshot may be written again.
    wait: int,
    // The write the native side is handling and the one queued behind it.
    inflight: int, pending: int,
    disk: int, launchDisk: int,
    retriedEarly: bool, skippedAsSaved: bool
  }
  var s: State
  action init = s' = { readDone: false, hydrated: false, clearing: false, content: 0, dirty: false,
    lastSaved: None, failed: false, failures: 0, wait: 0, inflight: None, pending: None,
    disk: 1, launchDisk: 1, retriedEarly: false, skippedAsSaved: false }
  val saving = s.hydrated and not(s.clearing)
  // 2 s doubling to 60 s in the source; here one more tick per consecutive failure, at most 3.
  pure def retryDelay(failures: int): int = if (failures > 3) 3 else failures
  // After a restore or a clear the current snapshot counts as stored.
  pure def primed(t: State): State = { ...t, dirty: false, lastSaved: t.content, failed: false, failures: 0 }
  // The user or a page changes what would be saved.
  action edit(content: int): bool = all {
    Contents.contains(content), content != s.content,
    s' = { ...s, content: content, dirty: true }
  }
  // An input changes identity while the snapshot stays the same.
  action touch = s' = { ...s, dirty: true }
  // The saved record is read once per launch. A failed read leaves saving off. A successful read
  // adds the saved entries to what is already open, so the result never holds less than before
  // (a larger identity stands for a snapshot that includes the smaller ones).
  action restoreSettles(ok: bool, merged: int): bool = all {
    not(s.readDone), Contents.contains(merged), merged >= s.content,
    s' = if (ok) primed({ ...s, readDone: true, hydrated: true, content: merged })
      else { ...s, readDone: true }
  }
  // One poll. Nothing is built while saving is off, or when no input changed and no retry is due.
  // A changed snapshot is written at once; an unchanged, rejected one only when its wait is over.
  action poll = all {
    saving,
    s.pending == None or not((s.dirty or (s.failed and s.wait == 0)) and
      (s.content != s.lastSaved or (s.failed and s.wait == 0))),
    s' = if (not(s.dirty) and not(s.failed and s.wait == 0)) s
      else if (s.content == s.lastSaved and not(s.failed and s.wait == 0)) { ...s, dirty: false }
      else { ...s, dirty: false, lastSaved: s.content, failed: false,
        retriedEarly: s.retriedEarly or (s.failed and s.wait > 0 and s.content == s.lastSaved),
        inflight: if (s.inflight == None) s.content else s.inflight,
        pending: if (s.inflight == None) None else s.content }
  }
  action tick = all { s.wait > 0, s' = { ...s, wait: s.wait - 1 } }
  // The write in flight settles; the native side rejects a write while it is clearing. The queued
  // write then starts, or is passed over when saving has been switched off meanwhile.
  action writeSettles(ok: bool): bool = all {
    s.inflight != None, ok implies not(s.clearing),
    s' = {
      ...s,
      disk: if (ok) s.inflight else s.disk,
      failed: if (not(ok) and s.lastSaved == s.inflight) true else s.failed,
      failures: if (ok and s.lastSaved == s.inflight) 0
        else if (not(ok) and s.lastSaved == s.inflight) (if (s.failures < 4) s.failures + 1 else 4)
        else if (s.pending != None and not(saving) and s.lastSaved == s.pending) 0
        else s.failures,
      wait: if (not(ok) and s.lastSaved == s.inflight) retryDelay(s.failures + 1) else s.wait,
      inflight: if (s.pending != None and saving) s.pending else None,
      pending: None,
      skippedAsSaved: s.skippedAsSaved or (s.pending != None and not(saving) and s.lastSaved == s.pending)
    }
  }
  action clearStart = all { not(s.clearing), s' = { ...s, clearing: true } }
  // The native side answers a write it received before the clear first, so none is in flight here.
  action clearSettles(ok: bool): bool = all {
    s.clearing, s.inflight == None,
    s' = if (ok) primed({ ...s, clearing: false, hydrated: true, content: 0, disk: 0, skippedAsSaved: false })
      else { ...s, clearing: false }
  }
  action step = {
    nondet content = Contents.oneOf()
    nondet ok = Set(false, true).oneOf()
    any { edit(content), touch, restoreSettles(ok, content), poll, tick, writeSettles(ok),
      clearStart, clearSettles(ok), s' = s }
  }
  val UnreadRecordNeverOverwritten = not(s.hydrated) implies (s.disk == s.launchDisk and s.inflight == None)
  val NoRetryBeforeBackoff = not(s.retriedEarly)
  val OneWriteInFlight = s.pending != None implies s.inflight != None
  val FailedSnapshotIsCounted = s.failed implies (s.failures > 0 and s.lastSaved != None)
  val TypeOK = s.wait.in(0.to(3)) and s.failures.in(0.to(4)) and
    s.inflight.in(Contents.union(Set(None))) and s.pending.in(Contents.union(Set(None))) and
    s.lastSaved.in(Contents.union(Set(None)))
  val safety = TypeOK and UnreadRecordNeverOverwritten and NoRetryBeforeBackoff and
    OneWriteInFlight and FailedSnapshotIsCounted
  val BackoffWaitingWitness = s.failed and s.wait > 1 and s.inflight == None and saving
  val UnreadKeptWitness = s.readDone and not(s.hydrated) and s.dirty and s.disk == s.launchDisk
  val QueuedBehindWriteWitness = s.pending != None and s.inflight != None
  // A queued write passed over during a clear is counted as stored. When that clear then fails,
  // the record keeps the older snapshot until something else changes.
  val PassedOverWriteCountsAsSavedWitness = s.skippedAsSaved and saving and not(s.failed) and
    not(s.dirty) and s.inflight == None and s.lastSaved == s.content and s.disk != s.content
  // A rejected write is not repeated on the following polls; it is written again only after its wait.
  run rejectedWriteBacksOffTest = init.then(restoreSettles(true, 1)).then(edit(2)).then(poll)
    .expect(s.inflight == 2).then(writeSettles(false))
    .expect(s.failed and s.wait == 1 and s.disk == 1).then(poll).then(poll)
    .expect(s.inflight == None and not(s.retriedEarly)).then(tick).then(poll)
    .expect(s.inflight == 2 and not(s.failed)).then(writeSettles(true))
    .expect(s.disk == 2 and s.failures == 0 and safety)
  run changedSnapshotSkipsBackoffTest = init.then(restoreSettles(true, 1)).then(edit(2)).then(poll)
    .then(writeSettles(false)).then(edit(3)).then(poll)
    .expect(s.inflight == 3 and s.wait == 1 and not(s.retriedEarly) and safety)
  run failedReadNeverWritesTest = init.then(restoreSettles(false, 0)).then(edit(2)).then(touch)
    .expect(not(saving) and s.disk == 1 and s.inflight == None and s.dirty and safety)
  run backoffGrowsTest = init.then(restoreSettles(true, 1)).then(edit(2)).then(poll).then(writeSettles(false))
    .then(tick).then(poll).then(writeSettles(false))
    .expect(s.failures == 2 and s.wait == 2 and safety)
  run idlePollTest = init.then(restoreSettles(true, 1)).then(poll).then(touch).then(poll)
    .expect(s.inflight == None and not(s.dirty) and s.disk == 1 and safety)
  run writeDuringClearIsRejectedTest = init.then(restoreSettles(true, 1)).then(edit(2)).then(poll)
    .then(clearStart).then(writeSettles(false)).then(clearSettles(true))
    .expect(s.disk == 0 and s.content == 0 and s.lastSaved == 0 and not(s.failed) and safety)
}
