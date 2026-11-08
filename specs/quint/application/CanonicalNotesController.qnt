// Current CanonicalNotesController + shared NotesController / NotesSnapshotState.
// Note bodies are opaque IDs. Transport callbacks may outlive cancellation.
module CanonicalNotesController {
  type State = { owner: bool, retired: bool, revision: int, notes: Set[int],
    readId: int, readAbortId: int, reads: Set[int], readCalls: Set[int], aborted: Set[int],
    writeId: int, seq: int, invalidated: bool, phase: str, failure: str,
    publishedCurrent: bool, publishedMonotonic: bool, listening: bool }
  var s: State
  pure val MaxRequests = 6
  pure val Notes = Set(1, 2)
  pure def current(value: State): bool = value.owner and not(value.retired)
  pure def beginRead(value: State): State = {
    val id = value.seq + 1
    { ...value, seq: id, readId: id, readAbortId: id,
      reads: value.reads.union(Set(id)), readCalls: value.readCalls.union(Set(id)), invalidated: false, phase: "loading" }
  }
  // A completed operation coalesces all intervening invalidations into one GET.
  pure def settle(value: State): State =
    if (value.invalidated and current(value) and value.writeId == 0)
      if (value.readId == 0) beginRead(value)
      else { ...value, invalidated: false }
    else value
  val VisibleRevision = if (current(s)) s.revision else -1
  val VisibleNotes = if (current(s)) s.notes else Set()
  val ReadActive = s.readId != 0
  val Writing = s.writeId != 0
  action init = s' = { owner: true, retired: false, revision: -1, notes: Set(),
    readId: 0, readAbortId: 0, reads: Set(), readCalls: Set(), aborted: Set(), writeId: 0, seq: 0,
    invalidated: false, phase: "none", failure: "none", publishedCurrent: true,
    publishedMonotonic: true, listening: false }
  action refresh = all { current(s),
    if (Writing) s' = { ...s, invalidated: true }
    else if (ReadActive) s' = s
    else all { s.seq < MaxRequests, s' = beginRead(s) } }
  action interact = all { current(s), not(Writing), s.seq < MaxRequests,
    s' = { ...s, writeId: s.seq + 1, seq: s.seq + 1, phase: "saving",
      aborted: if (ReadActive) s.aborted.union(Set(s.readId)) else s.aborted,
      invalidated: s.invalidated or ReadActive, readId: 0, readAbortId: 0 } }
  action invalidate(revision: int): bool =
    if (not(current(s)) or (revision >= 0 and s.revision >= 0 and revision <= s.revision)) s' = s
    else if (ReadActive or Writing) s' = { ...s, invalidated: true }
    else all { s.seq < MaxRequests, s' = beginRead(s) }
  action listen = s' = { ...s, listening: current(s) }
  action event(sameSession: bool, revision: int): bool =
    if (s.listening and sameSession) invalidate(revision) else s' = s
  action loseOwner = s' = { ...s, owner: false }
  action retire = if (s.retired) s' = s else
    s' = { ...s, retired: true, revision: -1, notes: Set(), invalidated: false,
      listening: false, aborted: s.aborted.union(s.readCalls), phase: "retired" }
  action readReply(id: int, revision: int, notes: Set[int], success: bool): bool = all {
    s.reads.contains(id), revision.in(0.to(2)), notes.subseteq(Notes),
    {
      val canPublish = current(s) and not(s.aborted.contains(id))
      val accepted = canPublish and success and revision >= s.revision
      val reviewed = canPublish and not(accepted)
      val result = { ...s, reads: s.reads.exclude(Set(id)),
        readId: if (s.readId == id) 0 else s.readId,
        readAbortId: if (s.readId == id) 0 else s.readAbortId,
        revision: if (accepted) revision else s.revision,
        notes: if (accepted) notes else s.notes,
        phase: if (accepted) "ready" else if (reviewed) "review" else s.phase,
        failure: if (reviewed) "read" else s.failure,
        publishedCurrent: if (accepted) current(s) else s.publishedCurrent,
        publishedMonotonic: if (accepted) revision >= s.revision else s.publishedMonotonic }
      all { not(result.invalidated and current(result) and result.writeId == 0 and result.readId == 0) or result.seq < MaxRequests,
        s' = settle(result) }
    }
  }
  action writeReply(revision: int, notes: Set[int], success: bool): bool = all {
    Writing, revision.in(0.to(2)), notes.subseteq(Notes),
    {
      val accepted = current(s) and success and revision >= s.revision
      val reviewed = current(s) and not(accepted)
      val result = { ...s, writeId: 0,
        revision: if (accepted) revision else s.revision,
        notes: if (accepted) notes else s.notes,
        phase: if (accepted) "ready" else if (reviewed) "review" else s.phase,
        failure: if (reviewed) "interact" else s.failure,
        publishedCurrent: if (accepted) current(s) else s.publishedCurrent,
        publishedMonotonic: if (accepted) revision >= s.revision else s.publishedMonotonic }
      all { not(result.invalidated and current(result) and result.readId == 0) or result.seq < MaxRequests,
        s' = settle(result) }
    }
  }
  action step = any { refresh, interact, listen, loseOwner, retire,
    { nondet revision = (-1).to(2).oneOf(); invalidate(revision) },
    { nondet revision = (-1).to(2).oneOf(); nondet same = Bool.oneOf(); event(same, revision) },
    { nondet id = 1.to(MaxRequests).oneOf(); nondet revision = 0.to(2).oneOf();
      nondet notes = Set(Set(), Set(1), Set(2), Notes).oneOf(); nondet success = Bool.oneOf(); readReply(id, revision, notes, success) },
    { nondet revision = 0.to(2).oneOf(); nondet notes = Set(Set(), Set(1), Set(2), Notes).oneOf();
      nondet success = Bool.oneOf(); writeReply(revision, notes, success) }, s' = s }
  val TypeOK = s.seq.in(0.to(MaxRequests)) and s.reads.subseteq(1.to(s.seq))
    and s.aborted.subseteq(1.to(s.seq)) and s.notes.subseteq(Notes)
    and s.revision.in((-1).to(2)) and s.readAbortId == s.readId
    and s.readId.in(0.to(s.seq)) and s.writeId.in(0.to(s.seq))
    and Set("none", "loading", "ready", "saving", "review", "retired").contains(s.phase)
    and Set("none", "read", "interact").contains(s.failure)
  val CurrentReadTracked = s.readId == 0 or s.reads.contains(s.readId)
  val WritesRetireReadPointer = not(Writing) or s.readId == 0
  val RetiredHasNoSnapshot = not(s.retired) or (s.revision == -1 and s.notes == Set() and s.phase == "retired")
  val safety = TypeOK and CurrentReadTracked and WritesRetireReadPointer
    and RetiredHasNoSnapshot and s.publishedCurrent and s.publishedMonotonic
  run coalescedReadTest = init.then(refresh).then(refresh).then(invalidate(2))
    .then(readReply(1, 1, Set(1), true)).expect(s.readId == 2 and s.revision == 1 and safety)
  run writeRetiresReadTest = init.then(refresh).then(interact)
    .then(readReply(1, 0, Set(1), true)).then(writeReply(1, Set(2), true))
    .expect(s.readId == 3 and s.revision == 1 and s.notes == Set(2) and safety)
  run staleReadTest = init.then(refresh).then(readReply(1, 2, Notes, true))
    .then(refresh).then(readReply(2, 1, Set(1), true))
    .expect(s.phase == "review" and s.revision == 2 and safety)
  run retiredReadTest = init.then(refresh).then(retire).then(readReply(1, 2, Notes, true))
    .expect(s.phase == "retired" and VisibleNotes == Set() and safety)
  run ownerLostWriteTest = init.then(interact).then(loseOwner).then(writeReply(2, Notes, true))
    .expect(VisibleRevision == -1 and s.revision == -1 and safety)
  run wrongSessionIgnoredTest = init.then(listen).then(event(false, 2))
    .expect(s.seq == 0 and s.listening and safety)
}
