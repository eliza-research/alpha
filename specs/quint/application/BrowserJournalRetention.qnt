/// Shared browser Calendar and Reminder journal retention at the production cutoffs.
module BrowserJournalRetention {
  pure val keepReceipts = 200
  pure val keepSettled = 127
  type Time = {day: int, millis: int}
  pure val epoch: Time = {day: 0, millis: 0}
  pure val wall: Time = {day: 21915, millis: 32400000}
  pure val wallNext: Time = {...wall, millis: wall.millis + 1}
  pure def ageCutoff(now: Time): Time = {...now, day: now.day - 30}
  pure def before(left: Time, right: Time): bool =
    left.day < right.day or (left.day == right.day and left.millis < right.millis)
  pure val boundary = ageCutoff(wall)
  pure val expired = {...boundary, millis: boundary.millis - 1}
  pure val stamps = [{day: -1, millis: 86399999}, epoch, expired, boundary, ageCutoff(wallNext), wall, wallNext]
  pure val elapsedStamps = [0, 1, 2, 3]
  pure val settled = Set("deleted", "undone", "conflict")
  pure val phases = settled.union(Set("queued", "paused", "dispatching", "unknown", "permission-required", "owner-changed"))
  type Receipt = {id: int, dated: bool, at: Time, definite: bool}
  type Deletion = {id: int, elapsed: int, phase: str}
  type State = {
    receipts: List[Receipt], deletions: List[Deletion], claims: Set[int], now: Time,
    receiptStage: str, deletionStage: str, trimmedAt: Time,
    protectedReceipts: Set[int], protectedDeletions: Set[int],
  }
  var s: State

  pure def receiptIds(rows: List[Receipt]): Set[int] = rows.indices().map(index => rows.nth(index).id)
  pure def deletionIds(rows: List[Deletion]): Set[int] = rows.indices().map(index => rows.nth(index).id)
  pure def definiteRows(rows: List[Receipt]): List[Receipt] = rows.select(row => row.definite)
  pure def terminalRows(rows: List[Deletion]): List[Deletion] = rows.select(row => settled.contains(row.phase))
  pure def definiteIndexes(rows: List[Receipt]): Set[int] = rows.indices().filter(index => rows.nth(index).definite)
  pure def terminalIndexes(rows: List[Deletion]): Set[int] = rows.indices().filter(index => settled.contains(rows.nth(index).phase))
  pure def pendingReceiptIds(rows: List[Receipt]): Set[int] =
    rows.indices().filter(index => not(rows.nth(index).definite)).map(index => rows.nth(index).id)
  pure def pendingDeletionIds(rows: List[Deletion]): Set[int] =
    rows.indices().filter(index => not(settled.contains(rows.nth(index).phase))).map(index => rows.nth(index).id)
  pure def ageAllowed(row: Receipt, cutoff: Time): bool = not(row.dated) or not(before(row.at, cutoff))

  pure def newest(rows: List[a], limit: int): List[a] =
    if (rows.length() <= limit) rows else rows.slice(rows.length() - limit, rows.length())
  pure def receiptsAtCount(count: int, at: Time, dated: bool): List[Receipt] =
    range(1, count + 1).foldl([], (rows, id) => rows.append({id: id, dated: dated, at: at, definite: true}))
  pure def deletionsAtCount(count: int): List[Deletion] =
    range(1, count + 1).foldl([], (rows, id) => rows.append({id: id, elapsed: 1, phase: "deleted"}))

  action initFor(receipts: List[Receipt], deletions: List[Deletion], claims: Set[int]): bool = all {
    receipts.length() <= 205, deletions.length() <= 136, claims.size() <= 140,
    receiptIds(receipts).size() == receipts.length(), deletionIds(deletions).size() == deletions.length(),
    receipts.indices().forall(index => {
      val row = receipts.nth(index)
      stamps.indices().exists(stamp => row.at == stamps.nth(stamp)) and (not(row.dated) implies row.at == epoch)
    }),
    deletions.indices().forall(index => {
      val row = deletions.nth(index)
      elapsedStamps.indices().exists(stamp => row.elapsed == elapsedStamps.nth(stamp)) and phases.contains(row.phase)
    }),
    s' = {receipts: receipts, deletions: deletions, claims: claims, now: wall,
      receiptStage: "loaded", deletionStage: "loaded", trimmedAt: wall,
      protectedReceipts: Set(), protectedDeletions: Set()}
  }
  action init = any {
    initFor([], [], Set()),
    initFor(receiptsAtCount(201, epoch, false).append({id: 210, dated: true, at: boundary, definite: false}), [], Set()),
    initFor([{id: 1, dated: true, at: boundary, definite: true},
      {id: 2, dated: true, at: expired, definite: true}], [], Set()),
    initFor([], deletionsAtCount(128).append({id: 130, elapsed: 0, phase: "paused"}), Set(1, 2, 128, 130, 140)),
  }
  action advanceClock = all {s.now == wall, s' = {...s, now: wallNext}}
  action retireReceipts = {
    val rows = s.receipts
    val definite = definiteIndexes(rows)
    val cutoff = ageCutoff(s.now)
    val withinCount = definite.size() <= keepReceipts
    val kept = if (withinCount and definite.forall(index => ageAllowed(rows.nth(index), cutoff))) rows
      else {
        val keptByCount = if (withinCount) receiptIds(rows)
          else {
            val done = definiteRows(rows)
            val ordered = stamps.foldl([], (orderedRows, stamp) =>
              orderedRows.concat(done.select(row => row.at == stamp)))
            receiptIds(newest(ordered, keepReceipts))
          }
        rows.select(row => not(row.definite) or (keptByCount.contains(row.id) and ageAllowed(row, cutoff)))
      }
    s' = {...s, receiptStage: "trimmed", trimmedAt: s.now, protectedReceipts: pendingReceiptIds(rows), receipts: kept}
  }
  action appendReceipt(id: int, definite: bool): bool = all {
    s.receiptStage == "trimmed", not(receiptIds(s.receipts).contains(id)),
    s' = {...s, receiptStage: "appended",
      receipts: s.receipts.append({id: id, dated: true, at: s.now, definite: definite})}
  }
  action acknowledge(id: int): bool = {
    val rows = s.receipts
    val index = rows.indices().filter(i => {
      val row = rows.nth(i)
      row.id == id and not(row.definite)
    }).fold(-1, (_, found) => found)
    all {index >= 0,
      s' = {...s, receiptStage: "loaded", receipts: rows.replaceAt(index, {...rows.nth(index), definite: true})}}
  }
  action trimDeletions = {
    val rows = s.deletions
    val kept = if (terminalIndexes(rows).size() <= keepSettled) rows
      else {
        val terminal = terminalRows(rows)
        val ordered = elapsedStamps.foldl([], (orderedRows, stamp) =>
          orderedRows.concat(terminal.select(row => row.elapsed == stamp)))
        val withinCount = deletionIds(newest(ordered, keepSettled))
        rows.select(row => not(settled.contains(row.phase)) or withinCount.contains(row.id))
      }
    s' = {...s, deletionStage: "trimmed", protectedDeletions: pendingDeletionIds(rows),
      deletions: kept, claims: s.claims.intersect(deletionIds(kept))}
  }
  action appendDeletion(id: int, elapsed: int, claimed: bool): bool = all {
    s.deletionStage == "trimmed", not(deletionIds(s.deletions).contains(id)),
    elapsedStamps.indices().exists(index => elapsedStamps.nth(index) == elapsed),
    s' = {...s, deletionStage: "appended", deletions: s.deletions.append({id: id, elapsed: elapsed, phase: "queued"}),
      claims: if (claimed) s.claims.union(Set(id)) else s.claims}
  }

  val receiptOrder = s.receipts.foldl([], (ids, row) => ids.append(row.id))
  val deletionOrder = s.deletions.foldl([], (ids, row) => ids.append(row.id))
  val definiteCount = definiteIndexes(s.receipts).size()
  val terminalCount = terminalIndexes(s.deletions).size()
  val pendingReceipts = pendingReceiptIds(s.receipts)
  val pendingDeletions = pendingDeletionIds(s.deletions)
  val legacyReceipts = receiptIds(s.receipts.select(row => not(row.dated)))
  val UniqueIdentities = receiptIds(s.receipts).size() == s.receipts.length() and
    deletionIds(s.deletions).size() == s.deletions.length()
  val DefiniteBoundAfterTrim = if (s.receiptStage == "trimmed") definiteCount <= keepReceipts
    else s.receiptStage == "appended" implies definiteCount <= keepReceipts + 1
  val AgeBoundAfterTrim = s.receiptStage != "loaded" implies
    definiteIndexes(s.receipts).forall(index => ageAllowed(s.receipts.nth(index), ageCutoff(s.trimmedAt)))
  val PendingSurvivesRetention = s.protectedReceipts.subseteq(receiptIds(s.receipts)) and
    s.protectedDeletions.subseteq(pendingDeletions)
  val SettledBoundAndClaims = s.deletionStage != "loaded" implies
    terminalCount <= keepSettled and s.claims.subseteq(deletionIds(s.deletions))
  val safety = UniqueIdentities and DefiniteBoundAfterTrim and AgeBoundAfterTrim and PendingSurvivesRetention and SettledBoundAndClaims

  action step = any {
    advanceClock, retireReceipts, appendReceipt(219, true), appendReceipt(220, false),
    acknowledge(210), acknowledge(220), trimDeletions, appendDeletion(219, 3, true), appendDeletion(220, 3, false), s' = s
  }

  run receiptsAtCountKeepStableLegacyOrderTest = initFor(receiptsAtCount(201, epoch, false), [], Set())
    .then(retireReceipts).expect(definiteCount == 200 and receiptOrder.head() == 2 and legacyReceipts.size() == 200 and safety)
  run exactAgeKeepsOnlyThroughBoundaryTest = initFor([
      {id: 1, dated: true, at: expired, definite: true}, {id: 2, dated: true, at: boundary, definite: true},
      {id: 3, dated: true, at: expired, definite: false}, {id: 4, dated: false, at: epoch, definite: true}], [], Set())
    .then(retireReceipts).expect(receiptOrder == [2, 3, 4] and safety)
    .then(advanceClock).then(retireReceipts).expect(receiptOrder == [3, 4] and safety)
  run countAndAgeUseSameOriginalCohortTest = initFor(receiptsAtCount(200, epoch, false)
      .append({id: 210, dated: true, at: expired, definite: true}), [], Set())
    .then(retireReceipts).expect(definiteCount == 199 and receiptOrder.head() == 2 and not(receiptIds(s.receipts).contains(210)) and safety)
  run writeMayAppendAfterExactReceiptBoundTest = initFor(receiptsAtCount(200, wall, true), [], Set())
    .then(retireReceipts).then(appendReceipt(219, true)).expect(definiteCount == 201 and safety)
    .then(retireReceipts).expect(definiteCount == 200 and receiptOrder.head() == 2 and safety)
  run acknowledgedCreationKeepsTimestampUntilNextTrimTest = initFor([
      {id: 210, dated: true, at: expired, definite: false}], [], Set())
    .then(retireReceipts).then(acknowledge(210)).expect(s.receipts.head().at == expired and safety)
    .then(retireReceipts).expect(s.receipts == [] and safety)
  run trimSettledAndDanglingClaimsTest = initFor([], deletionsAtCount(128)
      .append({id: 130, elapsed: 0, phase: "dispatching"}).append({id: 131, elapsed: 0, phase: "unknown"}), Set(1, 2, 128, 130, 131, 140))
    .then(trimDeletions).expect(terminalCount == 127 and deletionOrder.head() == 2 and s.claims == Set(2, 128, 130, 131) and safety)
    .then(appendDeletion(219, 3, true)).expect(pendingDeletions == Set(130, 131, 219) and s.claims.contains(219) and safety)
  run exactly127SettledAndPendingKeepOrderTest = initFor([], deletionsAtCount(127)
      .append({id: 129, elapsed: 0, phase: "queued"}).append({id: 130, elapsed: 0, phase: "paused"}), Set(1, 127, 129, 130, 140))
    .then(trimDeletions).expect(terminalCount == 127 and deletionOrder.head() == 1 and s.claims == Set(1, 127, 129, 130) and safety)
}
