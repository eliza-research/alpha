// Same-namespace BrowserStorageVolume journal custody and exact marker identity.
module BrowserFilesTrash {
  type Request = {owner: int, kind: str, subject: int}
  type State = {mode: str, active: Request, queued: Request, prepared: bool, rows: int -> str,
    keys: int -> int, journal: int -> int, allocated: int, expired: Set[int],
    visible: Set[int], status: str, count: int}
  var s: State
  pure val Idle = {owner: 0, kind: "none", subject: 0}
  pure val Modes = Set("web", "fallback")
  pure val Owners = Set(1, 2)
  pure val Files = Set(1, 2)
  pure val Markers = Set(1, 2, 3)
  pure def validRequest(kind: str, subject: int): bool =
    (kind == "trash" and Files.contains(subject)) or (kind == "list" and subject == 0) or
    (kind == "restore" and Markers.contains(subject)) or
    (kind == "empty" and Markers.union(Set(0)).contains(subject))

  action start(mode: str): bool = all {
    Modes.contains(mode),
    s' = {mode: mode, active: Idle, queued: Idle, prepared: false, rows: Files.mapBy(_ => "live"),
      keys: Files.mapBy(_ => 0), journal: Markers.mapBy(_ => 0), allocated: 0,
      expired: Set(), visible: Set(), status: "idle", count: 0}
  }
  action init = any {start("web"), start("fallback")}
  action begin(owner: int, kind: str, subject: int): bool = {
    val request = {owner: owner, kind: kind, subject: subject}
    all {
      Owners.contains(owner), validRequest(kind, subject), s.active == Idle,
      s.queued == Idle or s.queued == request,
      kind == "trash" implies s.rows.get(subject) == "live",
      s' = {...s, active: request, queued: Idle},
    }
  }
  action queue(owner: int, kind: str, subject: int): bool = all {
    Owners.contains(owner), validRequest(kind, subject), s.active != Idle, s.active.owner != owner,
    s.queued == Idle,
    s' = {...s, queued: {owner: owner, kind: kind, subject: subject}}
  }

  action prepareTrash = {
    val file = s.active.subject
    val marker = s.allocated + 1
    all {
      s.active.kind == "trash", not(s.prepared), Markers.contains(marker), s.rows.get(file) == "live",
      s' = {...s, prepared: true, allocated: marker, journal: s.journal.set(marker, file)},
    }
  }
  action abortTrashWrite = all {
    s.active.kind == "trash", not(s.prepared), s.rows.get(s.active.subject) == "live",
    s' = {...s, active: Idle, status: "rejected", count: 0}
  }
  action finishTrash(ok: bool): bool = {
    val file = s.active.subject
    val marker = s.allocated
    all {
      s.active.kind == "trash", s.prepared, s.rows.get(file) == "live",
      s' = {...s, active: Idle, prepared: false, status: if (ok) "trashed" else "failed", count: 0,
        rows: if (ok) s.rows.set(file, "trash") else s.rows,
        keys: if (ok) s.keys.set(file, marker) else s.keys,
        journal: if (ok) s.journal else s.journal.set(marker, 0)},
    }
  }

  pure def exactRows(state: State): Set[int] = Markers.filter(marker => Files.exists(file =>
    state.rows.get(file) == "trash" and state.keys.get(file) == marker and state.journal.get(marker) == file))
  val exact = exactRows(s)
  action prepareRestore = {
    val marker = s.active.subject
    all {
      s.active.kind == "restore", not(s.prepared), exact.contains(marker),
      s' = {...s, prepared: true},
    }
  }
  action finishRestore(ok: bool): bool = {
    val marker = s.active.subject
    all {
      s.active.kind == "restore", s.prepared, Markers.contains(marker), Files.contains(s.journal.get(marker)),
      val file = s.journal.get(marker)
      all {
        exact.contains(marker),
        s' = {...s, active: Idle, prepared: false, status: if (ok) "restored" else "failed", count: 0,
          rows: if (ok) s.rows.set(file, "live") else s.rows,
          keys: if (ok) s.keys.set(file, 0) else s.keys,
          journal: if (ok) s.journal.set(marker, 0) else s.journal},
      },
    }
  }
  action missingRestore = all {
    s.active.kind == "restore", not(s.prepared), not(exact.contains(s.active.subject)),
    s' = {...s, active: Idle, status: "missing", count: 0}
  }

  action finishList = {
    val expired = exact.intersect(s.expired)
    val visible = exact.exclude(expired)
    all {
      s.active.kind == "list",
      s' = {...s, active: Idle, status: "listed", count: 0, visible: visible,
        journal: Markers.mapBy(marker => if (visible.contains(marker)) s.journal.get(marker) else 0),
        rows: Files.mapBy(file => if (expired.contains(s.keys.get(file))) "gone" else s.rows.get(file)),
        keys: Files.mapBy(file => if (expired.contains(s.keys.get(file))) 0 else s.keys.get(file))},
    }
  }
  action expireMarker(marker: int): bool = all {
    s.active == Idle, exact.contains(marker), not(s.expired.contains(marker)),
    s' = {...s, expired: s.expired.union(Set(marker)), status: "clock", count: 0}
  }
  action finishEmpty(confirmed: bool): bool = {
    val marker = s.active.subject
    val erase = confirmed and exact.contains(marker)
    all {
      s.active.kind == "empty",
      s' = {...s, active: Idle,
        status: if (not(confirmed)) "confirmation-required" else if (marker == 0) "invalid" else "ready",
        count: if (erase) 1 else 0,
        rows: if (erase) s.rows.set(s.journal.get(marker), "gone") else s.rows,
        keys: if (erase) s.keys.set(s.journal.get(marker), 0) else s.keys,
        journal: if (erase) s.journal.set(marker, 0) else s.journal},
    }
  }
  action step = any {
    { nondet owner = Owners.oneOf()
      nondet kind = Set("trash", "restore", "list", "empty").oneOf()
      nondet subject = 0.to(3).oneOf()
      any {begin(owner, kind, subject), queue(owner, kind, subject)} },
    prepareTrash, abortTrashWrite, prepareRestore, missingRestore, finishList,
    { nondet ok = Bool.oneOf()
      any {finishTrash(ok), finishRestore(ok), finishEmpty(ok)} },
    { nondet marker = Markers.oneOf()
      expireMarker(marker) },
    s' = s
  }

  val ExclusiveCustody = s.active == Idle or s.queued == Idle or s.active.owner != s.queued.owner
  val ExactTrashMarker = Files.forall(file => s.rows.get(file) == "trash" implies
    Markers.contains(s.keys.get(file)) and s.journal.get(s.keys.get(file)) == file)
  val ListedItemsUseExactRecords = (s.active == Idle and s.status == "listed") implies
    s.visible == exact.exclude(s.expired)
  val KeysStayWithinAllocation = Files.forall(file => 0.to(s.allocated).contains(s.keys.get(file)))
  val PreparedPlacementKeepsSource = s.prepared implies
    ((s.active.kind == "trash" and Files.contains(s.active.subject) and s.rows.get(s.active.subject) == "live") or
     (s.active.kind == "restore" and exact.contains(s.active.subject)))
  val safety = ExclusiveCustody and ExactTrashMarker and ListedItemsUseExactRecords and KeysStayWithinAllocation
    and PreparedPlacementKeepsSource

  action trashedFirst = begin(1, "trash", 1).then(prepareTrash).then(finishTrash(true))

  run heldTrashProtectsPeerListTest = start("web").then(begin(1, "trash", 1)).then(prepareTrash)
    .then(queue(2, "list", 0)).then(finishTrash(true)).then(begin(2, "list", 0)).then(finishList)
    .expect(s.visible == Set(1) and safety)
  run heldRestorePreservesPeerMarkerTest = start("fallback").then(trashedFirst)
    .then(begin(1, "restore", 1)).then(prepareRestore).then(queue(2, "trash", 2)).then(finishRestore(true))
    .then(begin(2, "trash", 2)).then(prepareTrash).then(finishTrash(true))
    .expect(s.rows.get(1) == "live" and s.journal.get(2) == 2 and safety)
  run rejectedJournalWriteReleasesQueueTest = start("fallback").then(begin(1, "trash", 1))
    .then(queue(2, "list", 0)).then(abortTrashWrite).then(begin(2, "list", 0)).then(finishList)
    .expect(s.rows.get(1) == "live" and s.visible == Set() and safety)
  run confirmedOldMarkerSparedNewIncarnationTest = start("web").then(trashedFirst)
    .then(begin(1, "restore", 1)).then(prepareRestore).then(finishRestore(true)).then(trashedFirst)
    .then(begin(2, "empty", 1)).then(finishEmpty(true))
    .expect(s.count == 0 and s.keys.get(1) == 2 and safety)
  run retentionErasesOnlyExpiredMarkerTest = start("web").then(trashedFirst).then(expireMarker(1))
    .then(begin(2, "list", 0)).then(finishList)
    .expect(s.rows.get(1) == "gone" and s.visible == Set() and safety)
  run failedRestoreKeepsExactMarkerTest = start("web").then(trashedFirst)
    .then(begin(1, "restore", 1)).then(prepareRestore).then(finishRestore(false))
    .expect(s.rows.get(1) == "trash" and s.journal.get(1) == 1 and safety)
    .then(begin(2, "list", 0)).then(finishList).expect(s.visible == Set(1) and safety)
    .then(begin(2, "restore", 1)).then(prepareRestore).then(finishRestore(true))
    .expect(s.rows.get(1) == "live" and s.journal.get(1) == 0 and safety)
  run failedTrashKeepsLiveRowTest = start("fallback").then(begin(1, "trash", 1))
    .then(prepareTrash).then(finishTrash(false))
    .expect(s.rows.get(1) == "live" and s.journal.get(1) == 0 and safety)
}
