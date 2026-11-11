/// The Files recent list: a bounded index of opened documents and the picker grants its rows
/// name. A row evicted or replaced gives up its grant; a grant still named by a kept row is never
/// released, and closing a document keeps the grant its Recent row needs. An exported scan that
/// pushes a row out releases that row's grant too, unless it belongs to the open document, which
/// gives it up when it closes.
/// The limit of two rows stands for the source limit of 24.
module FilesRecentIndex {
  type Row = { key: int, kind: str, name: int, status: str, selection: int }
  type State = {
    rows: List[Row], serial: int, grants: Set[int], released: Set[int], exportReleased: Set[int], opened: int, sessions: int
  }
  var s: State
  pure val Limit = 2
  action init = s' = { rows: [], serial: 0, grants: Set(), released: Set(), exportReleased: Set(), opened: 0, sessions: 0 }
  /// A row replaces the row with its own key. A folder file also replaces a revoked folder row
  /// of the same name; picked documents match only by selection, since two may share a name.
  pure def same(old: Row, row: Row): bool =
    old.key == row.key or (row.kind == "tree" and old.kind == "tree" and old.status == "revoked" and old.name == row.name)
  pure def names(rows: List[Row], id: int): bool = rows.select(row => row.selection == id).length() > 0
  /// Closing the open document keeps a grant Recent still names. Forget removes the row too.
  pure def closed(v: State, forget: bool): State =
    if (v.opened == 0) v
    else {
      val rows = if (forget) v.rows.select(row => row.selection != v.opened) else v.rows
      val release = forget or not(names(v.rows, v.opened))
      { ...v, rows: rows, opened: 0,
        grants: if (release) v.grants.exclude(Set(v.opened)) else v.grants,
        released: if (release) v.released.union(Set(v.opened)) else v.released }
    }
  /// Insert or refresh a row. The index reports the selections no kept row names any more and
  /// the caller releases them, except the open document's. On the picker path the open document
  /// is the row just recorded, so it is never reported; a scan export can push the open
  /// document's row out, and that grant stays until the document closes.
  pure def recorded(v: State, row: Row, exported: bool): State = {
    val others = v.rows.select(old => not(same(old, row)))
    val replaced = v.rows.select(old => same(old, row))
    val ordered = [row].concat(others)
    val kept = ordered.slice(0, if (ordered.length() < Limit) ordered.length() else Limit)
    val dropped = replaced.concat(ordered.slice(kept.length(), ordered.length()))
    val gone = dropped.foldl(Set(), (ids, old) =>
      if (old.selection != 0 and not(names(kept, old.selection))) ids.union(Set(old.selection)) else ids)
    val freed = gone.exclude(Set(v.opened))
    { ...v, rows: kept, grants: v.grants.exclude(freed), released: v.released.union(freed),
      exportReleased: if (exported) v.exportReleased.union(freed) else v.exportReleased }
  }
  /// A document is accepted from the picker or a folder: the previous one closes first.
  /// A picked document has a fresh key per pick; a folder file is keyed by its tree identity.
  action accept(kind: str, id: int, name: int, listed: bool): bool = all {
    Set("selected", "tree").contains(kind), Set(1, 2).contains(id), Set(1, 2).contains(name), s.serial < 5,
    val selection = s.serial + 1
    val before = closed(s, false)
    val granted = { ...before, serial: selection, grants: before.grants.union(Set(selection)), opened: selection }
    val row = { key: if (kind == "selected") 100 + selection else 10 + id, kind: kind, name: name,
      status: "ready", selection: selection }
    s' = if (listed) recorded(granted, row, false) else granted
  }
  /// An exported scan is listed by name and holds no grant. A row it pushes out gives up its
  /// grant, unless that document is the open one: then the grant goes when it closes.
  action savedPdf(name: int): bool = all { Set(1, 2).contains(name),
    s' = recorded(s, { key: 20 + name, kind: "scan-pdf", name: name, status: "saved", selection: 0 }, true) }
  action close(forget: bool): bool = all { s.opened != 0, s' = closed(s, forget) }
  /// Folder capabilities last one Android session: ready folder rows lose their selection.
  action treeSessionEnds = all { s.sessions < 2,
    val ended = s.rows.foldl(Set(), (ids, row) =>
      if (row.kind == "tree" and row.status == "ready") ids.union(Set(row.selection)) else ids)
    s' = { ...s, sessions: s.sessions + 1, opened: if (ended.contains(s.opened)) 0 else s.opened,
      rows: s.rows.foldl([], (rows, row) =>
        rows.append(if (row.kind == "tree" and row.status == "ready") { ...row, status: "revoked", selection: 0 } else row)),
      grants: s.grants.exclude(ended), released: s.released.union(ended) } }
  action step = {
    nondet kind = Set("selected", "tree").oneOf()
    nondet id = Set(1, 2).oneOf()
    nondet name = Set(1, 2).oneOf()
    nondet flag = Bool.oneOf()
    any { accept(kind, id, name, flag), savedPdf(name), close(flag), treeSessionEnds, s' = s }
  }
  val BoundedRecent = s.rows.length() <= Limit
  val KeysUnique = s.rows.indices().forall(i => s.rows.indices().forall(j => i == j or s.rows.nth(i).key != s.rows.nth(j).key))
  val KeptGrantNeverReleased = s.rows.indices().forall(i => not(s.released.contains(s.rows.nth(i).selection)))
  val ReadyRowHoldsGrant = s.rows.indices().forall(i => s.rows.nth(i).status != "ready" or s.grants.contains(s.rows.nth(i).selection))
  /// Every grant still held is named by a Recent row or belongs to the open document.
  val NoOrphanGrant = s.grants.forall(id => id == s.opened or names(s.rows, id))
  /// An export releases only grants of rows it pushed out, never the open document's.
  val ExportReleasesOnlyEvicted = s.exportReleased.subseteq(s.released)
    and s.exportReleased.forall(id => id != s.opened and not(names(s.rows, id)))
  val ReleasedGrantNotHeld = s.released.intersect(s.grants) == Set()
  val OpenDocumentHoldsGrant = s.opened != 0 implies s.grants.contains(s.opened)
  val UnreadyRowHoldsNoSelection = s.rows.indices().forall(i => s.rows.nth(i).status == "ready" or s.rows.nth(i).selection == 0)
  val safety = BoundedRecent and KeysUnique and KeptGrantNeverReleased and ReadyRowHoldsGrant
    and NoOrphanGrant and ExportReleasesOnlyEvicted and ReleasedGrantNotHeld and OpenDocumentHoldsGrant and UnreadyRowHoldsNoSelection
  val EvictedGrantWitness = s.released != Set() and s.rows.length() == Limit and s.sessions == 0
  val RevokedTreeRowWitness = s.rows.indices().exists(i => s.rows.nth(i).kind == "tree" and s.rows.nth(i).status == "revoked")
  val UnlistedOpenWitness = s.opened != 0 and not(names(s.rows, s.opened))
  val ExportReleasesGrantWitness = s.exportReleased != Set() and s.opened == 0
  val ExportEvictsOpenDocumentWitness = s.opened != 0 and not(names(s.rows, s.opened)) and s.rows.length() == Limit
    and s.rows.head().kind == "scan-pdf" and s.exportReleased == Set() and s.released == Set()
  val SameNameRowsWitness = s.rows.length() == 2 and s.rows.nth(0).kind == "selected" and s.rows.nth(1).kind == "selected"
    and s.rows.nth(0).name == s.rows.nth(1).name
  run thirdDocumentEvictsOldestTest = init.then(accept("selected", 1, 1, true)).then(accept("selected", 1, 2, true))
    .then(accept("selected", 1, 1, true))
    .expect(s.rows.length() == 2 and s.released == Set(1) and s.grants == Set(2, 3) and safety)
  /// Two picked files that share a name and type are distinct rows and keep both grants.
  run sameNamePickedTwiceKeepsBothTest = init.then(accept("selected", 1, 1, true)).then(accept("selected", 1, 1, true))
    .expect(s.rows.length() == 2 and s.released == Set() and s.grants == Set(1, 2) and safety)
  /// A folder file opened again keeps its row and gives up the older selection.
  run treeEntryReopenedTest = init.then(accept("tree", 1, 1, true)).then(accept("tree", 1, 1, true))
    .expect(s.rows.length() == 1 and s.rows.head().selection == 2 and s.released == Set(1) and safety)
  run revokedTreeRowReplacedByNameTest = init.then(accept("tree", 1, 1, true)).then(treeSessionEnds)
    .expect(s.rows.head().status == "revoked" and s.grants == Set() and s.opened == 0 and safety)
    .then(accept("tree", 2, 1, true))
    .expect(s.rows.length() == 1 and s.rows.head().status == "ready" and s.rows.head().key == 12 and safety)
  run closeKeepsRecentGrantForgetReleasesTest = init.then(accept("selected", 1, 1, true)).then(close(false))
    .expect(s.grants == Set(1) and s.rows.length() == 1 and safety)
    .then(accept("selected", 1, 2, false)).then(close(false))
    .expect(s.grants == Set(1) and s.released == Set(2) and safety)
    .then(accept("selected", 1, 2, true)).then(close(true))
    .expect(s.grants == Set(1) and s.released == Set(2, 3) and s.rows.length() == 1 and safety)
  /// An exported scan that pushes a closed picked document out of Recent releases its grant.
  run exportEvictsRowAndReleasesGrantTest = init.then(accept("selected", 1, 1, true)).then(accept("selected", 1, 2, true))
    .then(close(false)).then(savedPdf(1))
    .expect(s.rows.length() == 2 and s.grants == Set(2) and s.released == Set(1) and s.exportReleased == Set(1) and safety)
  /// The open document's row pushed out by an export keeps its grant until the document closes.
  run exportKeepsOpenDocumentGrantTest = init.then(accept("selected", 1, 1, true)).then(savedPdf(1)).then(savedPdf(2))
    .expect(s.rows.length() == 2 and s.opened == 1 and s.grants == Set(1) and s.released == Set() and safety)
    .then(close(false))
    .expect(s.grants == Set() and s.released == Set(1) and s.exportReleased == Set() and safety)
  run savedPdfHoldsNoGrantTest = init.then(savedPdf(1)).then(savedPdf(1))
    .expect(s.rows.length() == 1 and s.rows.head().status == "saved" and s.grants == Set() and safety)
}
