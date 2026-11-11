/// Offline read snapshots. Each verified account identity and service has its own document,
/// so one service's clear, entry bound and size bound never touch another's entries.
module ServiceReadCache {
  type Doc = { n: int, age: int, began: int }
  type Put = { key: int, epoch: int, began: int }
  type Cache = {
    owner: int, docs: int -> Doc, epochs: int -> int, clears: int -> int,
    pending: Set[Put], shown: Set[int], lastClearKey: int, othersBefore: int, othersAfter: int
  }
  var s: Cache
  /// A document key is the owner (tens) and the service (units: 1 Gmail, 2 Google Calendar).
  pure val slots = Set(11, 12, 21, 22)
  pure val services = Set(1, 2)
  pure val emptyDoc: Doc = { n: 0, age: 0, began: 0 }
  pure def others(docs: int -> Doc, key: int): int =
    slots.exclude(Set(key)).fold(0, (sum, k) => sum + docs.get(k).n)
  def Key(service: int): int = s.owner * 10 + service
  action init = s' = {
    owner: 1, docs: slots.mapBy(k => emptyDoc), epochs: slots.mapBy(k => 0), clears: slots.mapBy(k => 0),
    pending: Set(), shown: Set(), lastClearKey: 0, othersBefore: 0, othersAfter: 0 }
  /// A write captures the instance's clear counter when it is requested.
  action beginPut(service: int): bool = all {
    s.pending.size() < 2,
    s' = { ...s, pending: s.pending.union(Set({ key: Key(service), epoch: s.epochs.get(Key(service)),
      began: s.clears.get(Key(service)) })) }
  }
  /// The write lands in the document of the identity and service it was requested for, unless
  /// that document was cleared meanwhile. The oldest entry of that document makes room.
  action commitPut(p: Put): bool = all {
    s.pending.contains(p),
    val doc = s.docs.get(p.key)
    if (p.epoch == s.epochs.get(p.key))
      s' = { ...s, pending: s.pending.exclude(Set(p)),
        docs: s.docs.set(p.key, { n: if (doc.n < 2) doc.n + 1 else 2, age: 0, began: p.began }) }
    else s' = { ...s, pending: s.pending.exclude(Set(p)) }
  }
  action read(service: int): bool = all {
    s.docs.get(Key(service)).n > 0, s.docs.get(Key(service)).age < 2,
    s' = { ...s, shown: s.shown.union(Set(Key(service))) }
  }
  /// An age step is fifteen days. A write is stamped when it is requested and lands within
  /// moments, so no age step separates the two.
  action expire(key: int): bool = all {
    s.docs.get(key).n > 0, s.docs.get(key).age < 2, not(s.pending.exists(p => p.key == key)),
    s' = { ...s, docs: s.docs.set(key, { ...s.docs.get(key), age: s.docs.get(key).age + 1 }) }
  }
  /// A service that lost its grant clears its own document and hides what it showed.
  action clear(service: int): bool = all {
    s.clears.get(Key(service)) < 2,
    val key = Key(service)
    val docs = s.docs.set(key, emptyDoc)
    s' = { ...s, docs: docs, epochs: s.epochs.set(key, s.epochs.get(key) + 1),
      clears: s.clears.set(key, s.clears.get(key) + 1), shown: s.shown.exclude(Set(key)),
      lastClearKey: key, othersBefore: others(s.docs, key), othersAfter: others(docs, key) }
  }
  /// Another account reads other documents. The views of the earlier account are reset.
  action switchOwner = s' = { ...s, owner: if (s.owner == 1) 2 else 1, shown: Set() }
  /// The clear counter lives in the process. Unfinished writes end with it.
  action restart = s' = { ...s, epochs: slots.mapBy(k => 0), pending: Set(), shown: Set() }
  action step = any {
    beginPut(1), beginPut(2), read(1), read(2), clear(1), clear(2), switchOwner, restart,
    { nondet p = s.pending.oneOf()
      commitPut(p) },
    { nondet key = slots.oneOf()
      expire(key) },
    s' = s
  }
  val ShownOwnerIsolation = s.shown.forall(k => k / 10 == s.owner)
  val ShownHasEntry = s.shown.forall(k => s.docs.get(k).n > 0)
  val ClearIsolated = s.othersBefore == s.othersAfter
  val ClearFencesPut = slots.forall(k => s.docs.get(k).n > 0 implies s.docs.get(k).began == s.clears.get(k))
  val TypeOK = slots.forall(k => s.docs.get(k).n.in(0.to(2)) and s.docs.get(k).age.in(0.to(2))
    and s.clears.get(k).in(0.to(2))) and s.owner.in(Set(1, 2)) and s.pending.size() <= 2
  val safety = TypeOK and ShownOwnerIsolation and ShownHasEntry and ClearIsolated and ClearFencesPut
  val ClearedBesideOtherWitness = s.lastClearKey == 12 and s.docs.get(11).n > 0 and s.shown.contains(11)
  val StalePutWitness = s.pending.exists(p => p.epoch != s.epochs.get(p.key))
  val OtherOwnerPutWitness = s.pending.exists(p => p.key / 10 != s.owner)
  val BothOwnersCachedWitness = s.docs.get(11).n > 0 and s.docs.get(21).n > 0
  /// Calendar clears its snapshots while Gmail has saved mail. The mail stays readable.
  run calendarClearKeepsMailTest = init.then(beginPut(1)).then(commitPut({ key: 11, epoch: 0, began: 0 }))
    .then(read(1)).then(beginPut(2)).then(commitPut({ key: 12, epoch: 0, began: 0 }))
    .then(clear(2))
    .expect(s.docs.get(11).n == 1 and s.docs.get(12).n == 0 and s.shown == Set(11) and safety)
    .then(read(1)).expect(safety)
  run clearFencesPutTest = init.then(beginPut(1)).then(clear(1))
    .then(commitPut({ key: 11, epoch: 0, began: 0 }))
    .expect(s.docs.get(11).n == 0 and s.pending == Set() and safety)
  run ownerSwitchIsolatesTest = init.then(beginPut(1)).then(commitPut({ key: 11, epoch: 0, began: 0 }))
    .then(read(1)).then(switchOwner).expect(s.shown == Set() and safety)
    .then(read(1).fail())
  run lateWriteLandsInOwnDocumentTest = init.then(beginPut(1)).then(switchOwner)
    .then(commitPut({ key: 11, epoch: 0, began: 0 }))
    .expect(s.docs.get(11).n == 1 and s.docs.get(21).n == 0 and safety)
    .then(switchOwner).then(read(1)).expect(s.shown == Set(11) and safety)
  run restartEndsWritesTest = init.then(beginPut(1)).then(clear(1)).then(restart)
    .expect(s.pending == Set() and s.epochs.get(11) == 0 and s.clears.get(11) == 1 and safety)
    .then(beginPut(1)).then(commitPut({ key: 11, epoch: 0, began: 1 }))
    .expect(s.docs.get(11).n == 1 and safety)
}
