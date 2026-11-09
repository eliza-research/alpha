// Current native Photos catalog window and its serialized access/page reads.
module PhotosWindow {
  type Row = {id: int, rank: int, revision: int}
  type State = {hidden: bool, active: bool, disposed: bool, captures: List[Row], loaded: bool,
    loading: bool, next: int, epoch: int, access: str, again: bool, job: int, jobToken: int,
    phase: str, more: bool, reader: bool, rows: List[Row], cursor: int, want: int, error: bool}
  var s: State
  pure val Ids = Set(1, 2, 3)
  pure val NoRow: Row = {id: 0, rank: 0, revision: 0}
  pure def validRows(rows: List[Row]): bool = rows.length() <= 3
    and rows.indices().forall(i => Ids.contains(rows.nth(i).id) and rows.nth(i).rank.in(1.to(3)) and rows.nth(i).revision.in(1.to(2)))
    and rows.indices().map(i => rows.nth(i).id).size() == rows.length()
  pure def key(row: Row): int = row.rank * 4 + row.id
  pure def sorted(rows: List[Row]): List[Row] = rows.foldl(List(), (out, row) =>
    out.select(previous => key(previous) >= key(row)).concat(List(row)).concat(out.select(previous => key(previous) < key(row))))
  pure def merged(kept: List[Row], page: List[Row]): List[Row] = {
    val byId = kept.concat(page).foldl(Ids.mapBy(_ => NoRow), (values, row) => values.set(row.id, row))
    sorted(List(1, 2, 3).foldl(List(), (values, id) => if (byId.get(id).id == 0) values else values.append(byId.get(id))))
  }
  pure def start(value: State, more: bool): State =
    if (value.disposed or value.hidden) value
    else if (value.loading) {...value, again: true}
    else {...value, loading: true, epoch: value.epoch + 1, job: value.job + 1,
      jobToken: value.epoch + 1, phase: "access", more: more}
  pure def finish(value: State): State = {
    val ready = {...value, loading: false, phase: "none"}
    if (not(value.again) or value.disposed) ready
    else start({...ready, again: false}, false)
  }
  pure def current(value: State): bool = not(value.disposed) and not(value.hidden) and value.jobToken == value.epoch
  action init = s' = {hidden: false, active: true, disposed: false, captures: List(), loaded: false,
    loading: false, next: 0, epoch: 0, access: "unknown", again: false, job: 0, jobToken: 0,
    phase: "none", more: false, reader: false, rows: List(), cursor: 0, want: 0, error: false}
  action refresh(more: bool): bool = all {s.job < 4, s.epoch < 6, s' = start(s, more)}
  action accessReply(scope: str, success: bool): bool = all {s.phase == "access", Set("full", "partial", "selected", "denied").contains(scope),
    s.job < 4 or not(s.again), s.epoch < 6 or not(s.again),
    if (not(current(s))) s' = finish(s)
    else if (not(success)) s' = finish({...s, loaded: true, error: true})
    else s' = {...s, access: scope, reader: true, rows: List(), cursor: if (s.more) s.next else 0,
      want: if (s.more) 1 else if (s.captures.length() == 0) 1 else s.captures.length(), phase: "page"}}
  action pageReply(rows: List[Row], cursor: int, success: bool): bool = all {
    s.phase == "page", validRows(rows), cursor.in(0.to(2)), s.job < 4 or not(s.again), s.epoch < 6 or not(s.again),
    s.rows.indices().map(i => s.rows.nth(i).id).intersect(rows.indices().map(i => rows.nth(i).id)) == Set(),
    if (not(current(s))) s' = finish(s)
    else if (not(success)) s' = finish({...s, loaded: true, error: true})
    else {
      val allRows = s.rows.concat(rows)
      val read = {...s, rows: allRows, cursor: cursor}
      if (cursor != 0 and not(s.more) and allRows.length() < s.want) s' = read
      else s' = finish({...read, captures: if (s.more) merged(s.captures, allRows) else sorted(allRows),
        next: cursor, loaded: true, error: false})
    }}
  action hide = all {s.epoch < 6,
    s' = if (s.disposed) {...s, hidden: true}
      else {...s, hidden: true, epoch: s.epoch + 1, captures: List(), next: 0, loaded: false}}
  action show = all {s.job < 4, s.epoch < 6,
    {val visible = {...s, hidden: false, loaded: if (s.disposed) s.loaded else false}
      s' = if (s.disposed or not(s.active)) visible else start(visible, false)}}
  action leave = s' = {...s, active: false}
  action enter = s' = {...s, active: true}
  action dispose = s' = {...s, disposed: true, captures: List()}
  action step = any {hide, show, leave, enter, dispose,
    {nondet more = Bool.oneOf(); refresh(more)},
    {nondet scope = Set("full", "partial", "selected", "denied").oneOf(); nondet success = Bool.oneOf(); accessReply(scope, success)},
    {nondet rows = Set(List(), List({id: 1, rank: 1, revision: 1}), List({id: 2, rank: 2, revision: 1}),
      List({id: 3, rank: 3, revision: 2}), List({id: 1, rank: 1, revision: 1}, {id: 2, rank: 2, revision: 1})).oneOf();
      nondet cursor = 0.to(2).oneOf(); nondet success = Bool.oneOf(); pageReply(rows, cursor, success)}, s' = s}
  val TypeOK = s.epoch.in(0.to(6)) and s.job.in(0.to(4)) and s.next.in(0.to(2))
    and s.cursor.in(0.to(2)) and validRows(s.captures) and validRows(s.rows)
  val HiddenCatalogEmpty = s.hidden implies s.captures.length() == 0
  val OneSerializedRead = s.loading == (s.phase != "none")
  val safety = TypeOK and HiddenCatalogEmpty and OneSerializedRead
  run hiddenFirstAccessCannotReadTest = init.then(refresh(false)).then(hide).then(accessReply("full", true))
    .expect(s.access == "unknown" and not(s.loading) and s.captures == List() and safety)
  run hiddenPageCannotPublishTest = init.then(refresh(false)).then(accessReply("full", true)).then(hide)
    .then(pageReply(List({id: 1, rank: 1, revision: 1}), 0, true)).expect(s.captures == List() and not(s.loaded) and safety)
  run coalescedRefreshStartsAgainTest = init.then(refresh(false)).then(refresh(true)).then(accessReply("full", true))
    .then(pageReply(List({id: 1, rank: 1, revision: 1}), 0, true)).expect(s.loading and s.job == 2 and not(s.more) and safety)
  run moreMergesExistingIdentityTest = init.then(refresh(false)).then(accessReply("full", true))
    .then(pageReply(List({id: 1, rank: 1, revision: 1}), 1, true)).then(refresh(true)).then(accessReply("full", true))
    .then(pageReply(List({id: 1, rank: 2, revision: 2}, {id: 2, rank: 1, revision: 1}), 0, true))
    .expect(s.captures.length() == 2 and s.captures.head().revision == 2 and safety)
  run disposedAccessSettlesTest = init.then(refresh(false)).then(dispose).then(accessReply("full", true))
    .expect(not(s.loading) and s.captures == List() and safety)
}
