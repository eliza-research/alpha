/// Two physical plain notes, one serialized writer, one independent stale view.
module CanonicalNotesStore {
  type Document = {revision: int, notes: List[int], trash: Set[int], trashPresent: bool, body: int -> int,
    order: int -> int, clock: int -> int, seen: Set[int]}
  type Reply = {outcome: str, id: int, document: Document, raw: bool}
  type State = {phase: str, handles: int, fenced: bool, cache: Document, durable: Document, pending: Document,
    before: Document, stage: str, kind: str, target: int, raw: bool, stopRequested: bool,
    reply: Reply, delayed: Reply, delayHeld: bool}
  var s: State
  pure val ids = Set(1, 2)
  pure val empty = {revision: 0, notes: [], trash: Set(), trashPresent: false, body: Map(1 -> 0, 2 -> 0),
    order: Map(1 -> 0, 2 -> 0), clock: Map(1 -> 0, 2 -> 0), seen: Set()}
  pure val noReply = {outcome: "none", id: 0, document: empty, raw: false}
  pure val initial = {phase: "ready", handles: 1, fenced: false, cache: empty, durable: empty, pending: empty,
    before: empty, stage: "idle", kind: "none", target: 0, raw: false,
    stopRequested: false, reply: noReply, delayed: noReply, delayHeld: false}
  action init = s' = initial
  pure def legacy(first: int, second: int): Document = {...empty, revision: 2, notes: [2, 1], trashPresent: true,
    body: Map(1 -> 1, 2 -> 1), clock: Map(1 -> first, 2 -> second), seen: ids}
  action legacyInit(first: int, second: int): bool = all {
    first.in(0.to(2)), second.in(0.to(2)),
    s' = {...initial, cache: legacy(first, second), durable: legacy(first, second)}
  }
  pure def members(notes: List[int]): Set[int] = notes.foldl(Set(), (shown, id) => shown.union(Set(id)))
  pure def newer(document: Document, candidate: int, current: int): bool =
    document.order.get(candidate) > document.order.get(current) or
      (document.order.get(candidate) == document.order.get(current) and
        document.clock.get(candidate) > document.clock.get(current))
  pure def visible(document: Document): Set[int] = document.notes.foldl(Set(), (shown, id) =>
    if (shown.exists(other => document.body.get(other) == document.body.get(id)))
      shown.map(other => if (document.body.get(other) == document.body.get(id) and newer(document, id, other)) id else other)
    else shown.union(Set(id)))
  pure def inserted(document: Document, id: int, body: int, clock: int): Document = {
    ...document, revision: document.revision + 1, trashPresent: true, notes: [id].concat(document.notes),
    body: document.body.set(id, body), clock: document.clock.set(id, clock),
    order: document.order.set(id, document.revision + 1), seen: document.seen.union(Set(id))
  }
  action prepare(document: Document, kind: str, id: int, raw: bool): bool =
    s' = {...s, pending: {...document, trashPresent: true}, before: s.cache, stage: "prepared", kind: kind,
      target: id, raw: raw, reply: {...noReply, outcome: "pending"}}
  action create(id: int, body: int, clock: int, force: bool): bool = all {
    s.phase == "ready", s.stage == "idle", s.cache.revision < 8,
    id.in(ids), body.in(ids), clock.in(0.to(2)),
    val matches = visible(s.cache).filter(other => s.cache.body.get(other) == body)
    if (not(force) and matches.size() > 0)
      s' = {...s, kind: "replay", reply: {outcome: "noop", id: if (matches.contains(1)) 1 else 2, document: s.cache, raw: false}}
    else all {not(s.cache.seen.contains(id)), prepare(inserted(s.cache, id, body, clock), "create", id, false)}
  }
  action edit(id: int, body: int, clock: int, expected: int): bool = all {
    s.phase == "ready", s.stage == "idle", s.cache.revision < 8,
    members(s.cache.notes).contains(id), body.in(ids), clock.in(0.to(2)), expected == s.cache.revision,
    prepare({...s.cache, revision: s.cache.revision + 1, body: s.cache.body.set(id, body),
      clock: s.cache.clock.set(id, clock), order: s.cache.order.set(id, s.cache.revision + 1)}, "edit", id, false)
  }
  action remove(id: int): bool = all {
    s.phase == "ready", s.stage == "idle", s.cache.revision < 8, members(s.cache.notes).contains(id),
    val removed = members(s.cache.notes.select(other => s.cache.body.get(other) == s.cache.body.get(id)))
    prepare({...s.cache, revision: s.cache.revision + 1,
      notes: s.cache.notes.select(other => not(removed.contains(other))), trash: s.cache.trash.union(removed), trashPresent: true}, "remove", id, false)
  }
  action restore(id: int, expected: int): bool = all {
    s.phase == "ready", s.stage == "idle", s.cache.revision < 8,
    s.cache.trash.contains(id), expected == s.cache.revision,
    prepare({...s.cache, revision: s.cache.revision + 1,
      notes: [id].concat(s.cache.notes), trash: s.cache.trash.exclude(Set(id))}, "restore", id, true)
  }
  action clear(expected: int): bool = all {
    s.phase == "ready", s.stage == "idle", s.cache.revision < 8, expected == s.cache.revision,
    if (s.cache.notes.length() == 0 and s.cache.trashPresent)
      s' = {...s, kind: "clear", reply: {outcome: "success", id: 0, document: s.cache, raw: true}}
    else prepare({...s.cache, revision: s.cache.revision + 1, notes: [],
      trash: s.cache.trash.union(members(s.cache.notes)), trashPresent: true}, "clear", 0, true)
  }
  action rejectRevision(expected: int): bool = all {
    s.phase == "ready", s.stage == "idle", expected != s.cache.revision,
    s' = {...s, reply: {...noReply, outcome: "conflict"}}
  }
  action rejectProjection = all {
    s.phase == "ready", s.stage == "idle", s' = {...s, reply: {...noReply, outcome: "error"}}
  }
  action write = all {
    s.stage == "prepared", s.cache.revision == s.durable.revision,
    s' = {...s, durable: s.pending, stage: "written"}
  }
  action conflict = all {
    s.stage == "prepared", s.cache.revision != s.durable.revision,
    s' = {...s, stage: "idle", reply: {...noReply, outcome: "conflict"}}
  }
  action refused = all {
    s.stage == "prepared", s' = {...s, stage: "idle", reply: {...noReply, outcome: "error"}}
  }
  action lostAcknowledgement = all {
    s.stage == "written", s' = {...s, phase: "error", fenced: true, stage: "idle", reply: {...noReply, outcome: "error"}}
  }
  action confirmed = all {
    s.stage == "written", s' = {...s, cache: s.pending, stage: "published",
      reply: {outcome: "pending", id: s.target, document: s.pending, raw: s.raw}}
  }
  action delivered = all {
    s.stage == "published", s' = {...s, stage: "idle", reply: {...s.reply, outcome: "success"}}
  }
  action holdReply = all {
    s.stage == "published", not(s.delayHeld),
    s' = {...s, stage: "idle", delayed: {...s.reply, outcome: "success"}, delayHeld: true, reply: noReply}
  }
  action deliverHeldReply = all {
    s.delayHeld, s.stage == "idle", s' = {...s, reply: s.delayed, delayHeld: false}
  }
  action rivalCreate(id: int, body: int, clock: int): bool = all {
    s.phase == "ready", s.stage.in(Set("idle", "prepared")), s.durable.revision < 8,
    id.in(ids), body.in(ids), clock.in(0.to(2)), not(s.durable.seen.contains(id)),
    s' = {...s, durable: inserted(s.durable, id, body, clock)}
  }
  action openShared = all {
    s.handles == 1, s.phase == "ready", s' = {...s, handles: 2}
  }
  /// One of two handles closes. The selected survivor keeps its shared cache and failure.
  action closeShared = all { s.handles == 2, s.stage == "idle", s' = {...s, handles: 1} }
  action refuseFenced = all { s.fenced, s' = {...s, reply: {...noReply, outcome: "error"}} }
  action requestStop = s' = {...s, stopRequested: true}
  action stopped = all {
    s.stopRequested, s.handles == 1, s.stage == "idle", not(s.delayHeld),
    s' = {...s, phase: "stopped", handles: 0, fenced: false, cache: empty}
  }
  action restart = all {
    s.phase == "stopped", s' = {...initial, cache: {...s.durable, trashPresent: true}, durable: s.durable}
  }
  action failedRestart = all {
    s.phase == "stopped", s' = {...s, phase: "error", handles: 1}
  }
  pure def valid(document: Document): bool = all {
    document.revision.in(0.to(8)), members(document.notes).subseteq(ids), document.trash.subseteq(ids),
    document.notes.length() == members(document.notes).size(),
    members(document.notes).intersect(document.trash).size() == 0,
    members(document.notes).union(document.trash).subseteq(document.seen),
    ids.forall(id => document.order.get(id).in(0.to(document.revision)) and
      document.clock.get(id).in(0.to(2)) and document.body.get(id).in(0.to(2)))
  }
  val CacheNotes = members(s.cache.notes)
  val DurableNotes = members(s.durable.notes)
  val VisibleNotes = if (s.phase == "ready") visible(s.cache) else Set()
  val ReplyNotes = if (s.reply.raw) members(s.reply.document.notes) else visible(s.reply.document)
  val CacheRevision = if (s.phase == "ready" or s.fenced) s.cache.revision else -1
  val DurableRevision = s.durable.revision
  val ReplyRevision = s.reply.document.revision
  val ReplyId = s.reply.id
  val ReplyOutcome = s.reply.outcome
  val TypeOK = s.handles.in(0.to(2)) and (s.handles == 0 iff s.phase == "stopped") and valid(s.cache) and valid(s.durable) and valid(s.pending) and valid(s.reply.document)
    and valid(s.delayed.document) and s.stage.in(Set("idle", "prepared", "written", "published"))
    and s.phase.in(Set("ready", "stopped", "error"))
  val RawMembershipDisjoint = members(s.durable.notes).intersect(s.durable.trash).size() == 0
  val VisibleContentUnique = VisibleNotes.forall(id => VisibleNotes.forall(other =>
    id == other or s.cache.body.get(id) != s.cache.body.get(other)))
  val ReplyIdentityPresent = s.reply.outcome.in(Set("success", "noop")) and s.reply.id != 0 implies
    ReplyNotes.union(s.reply.document.trash).contains(s.reply.id)
  val ConfirmedRevisionBounded = s.cache.revision <= s.durable.revision and s.reply.document.revision <= s.durable.revision
  val NewerOrderWins = ids.forall(id => ids.forall(other =>
    members(s.cache.notes).contains(id) and members(s.cache.notes).contains(other) and
    s.cache.body.get(id) == s.cache.body.get(other) and s.cache.order.get(id) > s.cache.order.get(other)
      implies not(VisibleNotes.contains(other))))
  val FencedCacheIsUnavailable = s.fenced implies
    (s.phase == "error" and s.handles > 0 and s.stage == "idle" and VisibleNotes == Set())
  val safety = FencedCacheIsUnavailable and TypeOK and RawMembershipDisjoint and VisibleContentUnique and ReplyIdentityPresent and ConfirmedRevisionBounded and NewerOrderWins
  action commit = write.then(confirmed).then(delivered)
  action step = any {
    create(1, 1, 0, true), create(2, 2, 0, true), create(2, 1, 0, true), create(1, 1, 0, false), create(2, 2, 0, false),
    edit(1, 1, 0, s.cache.revision), edit(1, 2, 0, s.cache.revision), edit(2, 1, 2, s.cache.revision),
    remove(1), remove(2), restore(1, s.cache.revision), restore(2, s.cache.revision), clear(s.cache.revision),
    rejectRevision(-1), rejectProjection, write, conflict, refused, lostAcknowledgement, confirmed, delivered,
    holdReply, deliverHeldReply, rivalCreate(1, 1, 1), rivalCreate(2, 2, 2), openShared, closeShared, refuseFenced, requestStop, stopped, restart, failedRestart, s' = s
  }
  run canonicalReplayTest = init.then(create(1, 1, 0, true)).then(commit).then(create(2, 2, 0, true)).then(commit)
    .then(edit(1, 2, 0, 2)).then(commit).then(create(2, 2, 0, false)).expect(s.reply.id == 1 and s.reply.outcome == "noop" and safety)
  run tiedClockEditTest = init.then(create(1, 1, 0, true)).then(commit).then(create(2, 2, 0, true)).then(commit)
    .then(edit(1, 2, 0, 2)).then(commit).expect(VisibleNotes == Set(1) and safety)
  run backwardsClockEditTest = init.then(create(1, 1, 2, true)).then(commit).then(create(2, 2, 1, true)).then(commit)
    .then(edit(1, 2, 0, 2)).then(commit).expect(VisibleNotes == Set(1) and safety)
  run legacyTimestampFallbackTest = legacyInit(2, 1).expect(VisibleNotes == Set(1) and safety)
  run legacyTieUsesRawOrderTest = legacyInit(0, 0).expect(VisibleNotes == Set(2) and safety)
  run mixedLegacyEditTest = legacyInit(2, 1).then(edit(2, 1, 0, 2)).then(commit).expect(VisibleNotes == Set(2) and safety)
  run rawRestoreMembershipTest = init.then(create(1, 1, 0, true)).then(commit).then(create(2, 1, 0, true)).then(commit)
    .then(remove(1)).then(commit).then(restore(2, 3)).then(commit).then(restore(1, 4)).then(commit)
    .expect(ReplyNotes == ids and VisibleNotes == Set(2) and s.reply.id == 1 and safety)
  run lostAckFencesSharedCacheTest = init.then(create(1, 1, 0, true)).then(commit).then(openShared)
    .then(create(2, 2, 0, true)).then(write).then(lostAcknowledgement)
    .expect(s.fenced and CacheNotes == Set(1) and CacheRevision == 1 and DurableNotes == ids and DurableRevision == 2 and safety)
    .then(closeShared).then(refuseFenced).expect(s.fenced and s.reply.outcome == "error" and safety)
    .then(requestStop).then(stopped).then(restart).expect(VisibleNotes == ids and CacheRevision == 2 and safety)
  run fencedStoreCannotAdmitTest = init.then(create(1, 1, 0, true)).then(write).then(lostAcknowledgement)
    .then(create(2, 2, 0, true)).fail()
  run staleWriterRejectedTest = init.then(rivalCreate(1, 1, 0)).then(create(2, 2, 0, true)).then(conflict)
    .expect(CacheRevision == 0 and DurableNotes == Set(1) and safety)
  run restartLoadsUnknownCommitTest = init.then(create(1, 1, 0, true)).then(write).then(lostAcknowledgement)
    .then(requestStop).then(stopped).then(restart).expect(CacheNotes == Set(1) and safety)
  run staleRevisionRejectedTest = init.then(create(1, 1, 0, true)).then(commit).then(rejectRevision(0))
    .expect(CacheRevision == 1 and s.reply.outcome == "conflict" and safety)
  run projectionFailurePreservesDocumentTest = init.then(create(1, 1, 0, true)).then(commit).then(rejectProjection)
    .expect(CacheNotes == Set(1) and DurableRevision == 1 and safety)
  run delayedReplyKeepsOwnCommitTest = init.then(create(1, 1, 0, true)).then(write).then(confirmed).then(holdReply)
    .then(create(2, 2, 0, true)).then(commit).then(deliverHeldReply).expect(ReplyRevision == 1 and DurableRevision == 2 and safety)
  run firstEmptyClearAddsTrashTest = init.then(clear(0)).then(commit).expect(DurableRevision == 1 and s.reply.outcome == "success" and safety)
  run repeatEmptyClearPreservesRevisionTest = init.then(clear(0)).then(commit).then(clear(1)).expect(DurableRevision == 1 and safety)
  run stoppedStoreCannotAdmitTest = init.then(requestStop).then(stopped).then(create(1, 1, 0, true)).fail()
}
