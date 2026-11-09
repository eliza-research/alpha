// HostedDelivery and HostedInbox with two exact scopes, three tracked runs and
// a synthetic resident result channel. No workflow execution is an action.
module NativeHostedInbox {
  type Entry = {id: int, cursor: int, revision: int}
  type Row = {cursor: int, revision: int}
  type Bucket = {
    client: bool, rows: int -> Row, retained: List[int], removal: Set[int],
    pendingNotices: Set[int], posted: Set[int], packed: bool, head: int
  }
  type State = {
    owner: int, generation: int, enabled: bool, polling: bool, preference: bool,
    status: str, runningOwner: int, runningGeneration: int, background: bool,
    closed: bool, stage: str, page: int, ackRun: int, ackCursor: int,
    ackAccepted: bool, gets: int, acks: int, receipts: int, outcome: str,
    buckets: int -> Bucket
  }
  var s: State

  val owners = Set(1, 2)
  val runs = Set(1, 2, 3)
  val absentRow = {cursor: 0, revision: 0}
  val emptyBucket = {
    client: false, rows: runs.mapBy(_run => absentRow), retained: List(), removal: Set(),
    pendingNotices: Set(), posted: Set(), packed: false, head: 0
  }

  action init = s' = {
    owner: 0, generation: 0, enabled: false, polling: false, preference: true,
    status: "none", runningOwner: 0, runningGeneration: 0, background: false,
    closed: false, stage: "idle", page: 0, ackRun: 0, ackCursor: 0,
    ackAccepted: false, gets: 0, acks: 0, receipts: 0, outcome: "none",
    buckets: owners.mapBy(_owner => emptyBucket)
  }

  action configure(owner: int): bool = all {
    owners.contains(owner),
    s.generation < 4,
    s' = { ...s, owner: owner, generation: s.generation + 1, enabled: true,
      polling: s.preference, status: "waiting", closed: s.runningOwner != 0 }
  }

  action retire(owner: int): bool = all {
    owners.contains(owner),
    s.generation < 4,
    s' = if (owner == s.owner) { ...s, owner: 0, generation: s.generation + 1, enabled: false,
      polling: false, status: "paused", closed: s.runningOwner != 0 } else s
  }

  action polling(on: bool): bool =
    s' = { ...s, polling: on, preference: on, closed: s.closed or (not(on) and s.runningOwner != 0) }

  action stop(generation: int): bool =
    s' = { ...s, closed: s.closed or (generation == s.generation and s.runningOwner != 0) }

  // One tracked oldest record followed by 99 anonymous historical rows.
  action seedFull(owner: int): bool = all {
    owners.contains(owner), s.stage == "idle",
    val bucket = s.buckets.get(owner)
    all {
      bucket.retained == List(1), not(bucket.packed), bucket.removal == Set(),
      s' = { ...s, buckets: s.buckets.set(owner, { ...bucket, packed: true, head: 1 }) }
    }
  }

  pure def includes(values: List[int], id: int): bool = values.foldl(false, (found, value) => found or value == id)

  pure def cleanup(bucket: Bucket): Bucket =
    { ...bucket, rows: bucket.removal.fold(bucket.rows, (rows, id) => rows.set(id, absentRow)), removal: Set() }

  pure def notify(bucket: Bucket, successful: bool): Bucket =
    if (successful) { ...bucket, posted: bucket.posted.union(bucket.pendingNotices), pendingNotices: Set() }
    else bucket

  def allowed(generation: int, background: bool): bool =
    s.enabled and generation == s.generation and (not(background) or s.polling)

  action start(generation: int, background: bool, noticeOk: bool): bool = all {
    s.stage == "idle", allowed(generation, background), s.gets < 6,
    val bucket = s.buckets.get(s.owner)
    s' = { ...s, runningOwner: s.owner, runningGeneration: generation, background: background,
      closed: false, stage: "get", page: 1, gets: s.gets + 1, outcome: "started",
      buckets: s.buckets.set(s.owner, notify(cleanup({ ...bucket, client: true }), noticeOk)) }
  }

  pure def terminal(state: State, result: str): State = {
    ...state, runningOwner: 0, runningGeneration: 0, background: false, closed: false, stage: "idle",
    page: 0, ackRun: 0, ackCursor: 0, ackAccepted: false, outcome: result,
    status: if (result == "cancelled") state.status else result,
    enabled: state.enabled and not(result.in(Set("storage-error", "reconnect-required")))
  }

  action startFailed(generation: int, background: bool, result: str): bool = all {
    s.stage == "idle", allowed(generation, background),
    result.in(Set("storage-error", "reconnect-required", "retry")),
    s' = terminal(s, result)
  }

  val retired = s.runningGeneration != s.generation or (s.background and not(s.polling))

  pure def ordered(entries: List[Entry]): bool = entries.foldl({ok: true, cursor: 0}, (order, entry) =>
    {ok: order.ok and entry.cursor > order.cursor, cursor: entry.cursor}).ok

  pure def writePage(bucket: Bucket, entries: List[Entry], mode: str): {rows: int -> Row, result: str, position: int} =
    entries.foldl({rows: bucket.rows, result: "ok", position: 0}, (work, entry) => {
      val following = { ...work, position: work.position + 1 }
      val rowValue = {cursor: entry.cursor, revision: entry.revision}
      if (work.result != "ok") work
      else if (work.rows.get(entry.id) != absentRow)
        if (work.rows.get(entry.id) == rowValue) following else { ...work, result: "retry" }
      else if ((mode == "first-row" and work.position == 0) or (mode == "second-row" and work.position == 1))
        { ...work, result: "storage-error" }
      else { ...following, rows: work.rows.set(entry.id, rowValue) }
    })

  pure def commitPage(bucket: Bucket, entries: List[Entry], rows: int -> Row): Bucket = {
    val added = entries.foldl(List(), (ids, entry) =>
      if (includes(bucket.retained, entry.id) or includes(ids, entry.id)) ids else ids.append(entry.id))
    val removed = if (bucket.packed and bucket.head != 0 and added.length() > 0) Set(bucket.head) else Set()
    val retained = bucket.retained.concat(added).foldl(List(), (ids, id) =>
      if (removed.contains(id)) ids else ids.append(id))
    {
      ...bucket, rows: rows, retained: retained, removal: bucket.removal.union(removed),
      pendingNotices: bucket.pendingNotices.union(added.foldl(Set(), (ids, id) => ids.union(Set(id)))).exclude(removed),
      head: if (removed.size() > 0) 0 else bucket.head
    }
  }

  action receive(entries: List[Entry], mode: str, noticeOk: bool): bool = all {
    s.stage == "get", entries.length() <= 2, s.acks < 6,
    mode.in(Set("complete", "invalid", "oversized", "transport", "first-row", "second-row", "index", "notice-index")),
    mode != "notice-index" or (entries.length() == 1 and noticeOk and
      s.buckets.get(s.runningOwner).pendingNotices.size() == 0),
    if (retired) s' = terminal(s, "cancelled")
    else if (s.closed or mode.in(Set("invalid", "oversized", "transport")) or not(ordered(entries))) s' = terminal(s, "retry")
    else if (entries.length() == 0) s' = terminal(s, "current")
    else {
      val bucket = s.buckets.get(s.runningOwner)
      val work = writePage(bucket, entries, mode)
      val stored = { ...bucket, rows: work.rows }
      if (work.result != "ok" or mode == "index") s' = terminal(
        { ...s, buckets: s.buckets.set(s.runningOwner, stored) },
        if (work.result == "ok") "storage-error" else work.result)
      else {
        val committed = commitPage(bucket, entries, work.rows)
        val last = entries[entries.length() - 1]
        if (mode == "notice-index" and committed.pendingNotices.size() == 1) {
          val visible = { ...committed, posted: committed.posted.union(committed.pendingNotices) }
          s' = terminal({ ...s, buckets: s.buckets.set(s.runningOwner, visible) }, "storage-error")
        } else {
          val nextBucket = notify(committed, noticeOk)
          s' = { ...s, buckets: s.buckets.set(s.runningOwner, nextBucket),
            stage: "ack", acks: s.acks + 1, ackRun: last.id, ackCursor: last.cursor }
        }
      }
    }
  }

  action ackEffect: bool = all {
    s.stage == "ack", not(s.ackAccepted),
    s' = { ...s, ackAccepted: true, receipts: s.receipts + 1 }
  }

  action ackReply(mode: str): bool = all {
    s.stage == "ack", mode.in(Set("complete", "lost", "remove-refused")), s.gets < 6,
    mode != "remove-refused" or s.buckets.get(s.runningOwner).removal.contains(1),
    if (retired) s' = terminal(s, "cancelled")
    else if (s.closed or mode == "lost") s' = terminal(s, "retry")
    else if (mode == "remove-refused") s' = terminal(s, "storage-error")
    else {
      val buckets = s.buckets.set(s.runningOwner, cleanup(s.buckets.get(s.runningOwner)))
      s' = if (s.page == 2) terminal({ ...s, buckets: buckets }, "current")
        else { ...s, buckets: buckets, stage: "get", page: 2, gets: s.gets + 1,
          ackRun: 0, ackCursor: 0, ackAccepted: false }
    }
  }

  val HistoryIsDurable = owners.forall(owner => {
    val bucket = s.buckets.get(owner)
    bucket.retained.foldl(true, (ok, id) => ok and bucket.rows.get(id) != absentRow) and
      bucket.pendingNotices.forall(id => includes(bucket.retained, id)) and
      bucket.removal.forall(id => not(includes(bucket.retained, id)))
  })
  val AckFollowsExactCommit = if (s.stage == "ack") {
    val bucket = s.buckets.get(s.runningOwner)
    bucket.client and (includes(bucket.retained, s.ackRun) or bucket.removal.contains(s.ackRun)) and
      bucket.rows.get(s.ackRun).cursor == s.ackCursor and s.ackCursor > 0
  } else s.ackRun == 0 and s.ackCursor == 0
  val OneRunOwner = (s.stage == "idle") == (s.runningOwner == 0) and
    (s.runningOwner == 0 or s.runningGeneration > 0) and s.receipts <= s.acks and s.acks <= s.gets
  val safety = HistoryIsDurable and AckFollowsExactCommit and OneRunOwner

  pure def row(id: int, cursor: int, revision: int): Entry = {id: id, cursor: cursor, revision: revision}
  val pages = Set(List(), List(row(1, 1, 1)), List(row(2, 2, 1)), List(row(3, 3, 1)),
    List(row(1, 1, 2)), List(row(1, 3, 1)), List(row(1, 1, 1), row(2, 2, 1)),
    List(row(2, 2, 1), row(1, 1, 1)), List(row(2, 2, 1), row(1, 3, 1)))

  action step = any {
    nondet owner = owners.oneOf()
    configure(owner),
    nondet owner = owners.oneOf()
    retire(owner),
    nondet on = Bool.oneOf()
    polling(on),
    stop(s.generation), stop(s.generation - 1),
    nondet owner = owners.oneOf()
    seedFull(owner),
    nondet background = Bool.oneOf()
    nondet notice = Bool.oneOf()
    start(s.generation, background, notice),
    nondet result = Set("storage-error", "reconnect-required", "retry").oneOf()
    startFailed(s.generation, false, result),
    nondet page = pages.oneOf()
    nondet mode = Set("complete", "invalid", "oversized", "transport", "first-row", "second-row", "index", "notice-index").oneOf()
    nondet notice = Bool.oneOf()
    receive(page, mode, notice),
    ackEffect,
    nondet mode = Set("complete", "lost", "remove-refused").oneOf()
    ackReply(mode),
    s' = s
  }

  action ready = init.then(configure(1))
  action first = ready.then(start(1, false, true)).then(receive(List(row(1, 1, 1)), "complete", true))

  run indexWriteFailureLeavesOrphanButNeverAcknowledgesTest = ready.then(start(1, false, true))
    .then(receive(List(row(1, 1, 1)), "index", true))
    .expect(s.acks == 0 and s.buckets.get(1).retained == List() and s.buckets.get(1).rows.get(1).revision == 1)

  run retiredReadDoesNotCommitIntoReplacementTest = ready.then(start(1, false, true)).then(configure(2))
    .then(receive(List(row(1, 1, 1)), "complete", true))
    .expect(s.owner == 2 and s.status == "waiting" and s.acks == 0 and s.buckets.get(1).retained == List())

  run alreadyAcceptedAckSurvivesRetirementTest = first.then(ackEffect).then(retire(1)).then(ackReply("complete"))
    .expect(s.receipts == 1 and s.owner == 0 and s.status == "paused" and s.buckets.get(1).retained == List(1))

  run lostAckReplyRecoversSameRowTest = first.then(ackEffect).then(ackReply("lost"))
    .then(start(1, false, true)).then(receive(List(row(1, 1, 1)), "complete", true))
    .expect(s.buckets.get(1).retained == List(1) and s.buckets.get(1).posted == Set(1) and s.acks == 2)

  run pendingNoticeReplaysOnNextReadTest = ready.then(start(1, false, true))
    .then(receive(List(row(1, 1, 1)), "complete", false)).then(ackEffect).then(ackReply("lost"))
    .then(start(1, false, true))
    .expect(s.buckets.get(1).pendingNotices == Set() and s.buckets.get(1).posted == Set(1))

  run visibleNoticeBeforeFailedIndexClearRecoversOnceTest = ready.then(start(1, false, true))
    .then(receive(List(row(1, 1, 1)), "notice-index", true))
    .expect(s.acks == 0 and s.buckets.get(1).pendingNotices == Set(1) and s.buckets.get(1).posted == Set(1))
    .then(configure(1)).then(start(2, false, true))
    .expect(s.buckets.get(1).pendingNotices == Set() and s.buckets.get(1).posted == Set(1))

  run packedReplayAcknowledgesJournaledLastRowTest = ready.then(start(1, false, true))
    .then(receive(List(row(1, 3, 1)), "complete", true)).then(ackReply("lost")).then(seedFull(1))
    .then(start(1, false, true)).then(receive(List(row(2, 2, 1), row(1, 3, 1)), "complete", true))
    .expect(AckFollowsExactCommit and s.ackRun == 1 and s.buckets.get(1).removal.contains(1))

  run oldRowDeletionWaitsForAckOrRecoveryTest = first.then(ackEffect).then(ackReply("lost")).then(seedFull(1))
    .then(start(1, false, true)).then(receive(List(row(2, 2, 1)), "complete", true))
    .expect(s.buckets.get(1).retained == List(2) and s.buckets.get(1).removal == Set(1) and s.buckets.get(1).rows.get(1).revision == 1)
    .then(ackEffect).then(ackReply("remove-refused")).then(configure(1)).then(start(2, false, true))
    .expect(s.buckets.get(1).removal == Set() and s.buckets.get(1).rows.get(1) == absentRow)
}
