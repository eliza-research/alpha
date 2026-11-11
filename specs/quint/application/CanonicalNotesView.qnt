// CanonicalNotesUi collection projection, draft overlay and navigation waiters.
// Editor and controller callbacks are inputs with their own source-bound models.
module CanonicalNotesView {
  type Data = {kind: str, title: int, body: int, hasPinned: bool, pinned: bool,
    hasFolder: bool, folder: int, voiceContent: bool, linkUrl: bool, handles: bool}
  type Note = {id: int, data: Data}
  type Draft = {present: bool, id: int, token: int, base: int, data: Data}
  type Row = {id: int, kind: str, title: int, body: int, revision: int, pinned: bool, folder: int, handles: bool}
  type State = {current: bool, baseRows: List[Row], rows: List[Row],
    open: int, blank: int, trash: List[int], draft: Draft, waiters: List[int]}
  var s: State
  pure val EmptyData: Data = {kind: "none", title: 0, body: 0, hasPinned: false, pinned: false,
    hasFolder: false, folder: 0, voiceContent: false, linkUrl: false, handles: false}
  pure val EmptyDraft: Draft = {present: false, id: 0, token: 0, base: 0, data: EmptyData}
  pure val EmptyRow: Row = {id: 0, kind: "text", title: 0, body: 0, revision: 0, pinned: false, folder: 0, handles: false}
  pure val Kinds = Set("none", "text", "list", "voice", "link")
  pure def shownKind(data: Data): str =
    if (data.kind == "list") "list"
    else if (data.kind == "voice" and data.voiceContent) "voice"
    else if (data.kind == "link" and data.linkUrl) "link" else "text"
  pure def row(note: Note, revision: int): Row = {id: note.id, kind: shownKind(note.data),
    title: note.data.title, body: note.data.body, revision: revision,
    pinned: note.data.hasPinned and note.data.pinned,
    folder: if (note.data.hasFolder) note.data.folder else 0, handles: false}
  pure def overlay(base: List[Row], draft: Draft): List[Row] =
    if (not(draft.present)) base else {
      val index = base.indices().fold(base.length(), (lowest, i) =>
        if (base.nth(i).id == draft.id and i < lowest) i else lowest)
      val found = index < base.length()
      val old = if (found) base.nth(index) else EmptyRow
      val kind = if (Set("list", "text").contains(draft.data.kind)) draft.data.kind
        else if (found) old.kind else shownKind(draft.data)
      val projected = {id: if (draft.id == 0) draft.token + 2 else draft.id, kind: kind,
        title: draft.data.title, body: draft.data.body, revision: draft.base,
        pinned: if (draft.data.hasPinned) draft.data.pinned else old.pinned,
        folder: if (draft.data.hasFolder) draft.data.folder else old.folder, handles: false}
      if (found) base.replaceAt(index, projected) else List(projected).concat(base)
    }
  pure def validData(data: Data): bool = Kinds.contains(data.kind) and data.title.in(0.to(6))
    and data.body.in(0.to(6)) and data.folder.in(0.to(2))
  pure def validDraft(draft: Draft): bool = draft.id.in(0.to(2)) and draft.token.in(0.to(5))
    and draft.base.in(0.to(4)) and validData(draft.data)
  val PublicRows = if (s.current) s.rows else List()
  val PublicOpen = if (s.current) s.open else 0
  action init = s' = {current: true, baseRows: List(), rows: List(), open: 0, blank: 0,
    trash: List(), draft: EmptyDraft, waiters: List()}
  // This callback runs after accepted raw snapshot rows are projected and before
  // editor reconciliation emits its own changed callback.
  action published(notes: List[Note], trash: List[int], revision: int): bool = all {
    s.current, notes.length() <= 2, revision.in(0.to(4)), trash.length() <= 2,
    notes.indices().forall(i => notes.nth(i).id.in(1.to(2)) and validData(notes.nth(i).data)),
    trash.indices().forall(i => trash.nth(i).in(1.to(2))),
    s' = {...s, baseRows: notes.foldl(List(), (rows, note) => rows.append(row(note, revision))), trash: trash}}
  action painted(draft: Draft): bool = all {validDraft(draft),
    s' = {...s, draft: draft, rows: overlay(s.baseRows, draft),
      open: if (draft.present) (if (draft.id == 0) draft.token + 2 else draft.id) else 0,
      blank: if (draft.present and draft.id == 0) draft.token + 2 else 0}}
  action wait(id: int): bool = all {id.in(1.to(8)), not(s.waiters.indices().exists(i => s.waiters.nth(i) == id)), s.waiters.length() < 3,
    s' = {...s, waiters: s.waiters.append(id)}}
  action drained(current: bool): bool = all {not(current) or s.current,
    s' = {...s, current: current, waiters: List()}}
  action loseOwner = s' = {...s, current: false}
  action retired = s' = {...s, current: false, baseRows: List(), rows: List(),
    open: 0, blank: 0, trash: List(), draft: EmptyDraft, waiters: List()}
  action step = any {loseOwner, retired, {nondet current = Bool.oneOf(); drained(current)},
    {nondet id = 1.to(8).oneOf(); wait(id)}, painted(EmptyDraft),
    {nondet kind = Kinds.oneOf(); nondet title = 0.to(6).oneOf(); nondet body = 0.to(6).oneOf();
      nondet id = 0.to(2).oneOf(); nondet token = 1.to(5).oneOf(); nondet base = 0.to(4).oneOf();
      painted({present: true, id: id, token: token, base: base, data: {...EmptyData, kind: kind, title: title, body: body}})},
    {nondet kind = Kinds.oneOf(); nondet revision = 0.to(4).oneOf();
      published(List({id: 1, data: {...EmptyData, kind: kind, title: 1, body: 2}}), List(2), revision)}, s' = s}
  val TypeOK = s.open.in(0.to(7)) and s.blank.in(0.to(7)) and validDraft(s.draft)
    and s.baseRows.length() <= 2 and s.rows.length() <= 3 and s.waiters.length() <= 3
  val NoLocalHandles = s.rows.indices().forall(i => not(s.rows.nth(i).handles))
    and s.baseRows.indices().forall(i => not(s.baseRows.nth(i).handles))
  val PrivateWhenInactive = s.current or PublicRows == List() and PublicOpen == 0
  val BlankNamesDraft = s.blank == 0 or s.draft.present and s.draft.id == 0 and s.blank == s.open
  val safety = TypeOK and NoLocalHandles and PrivateWhenInactive and BlankNamesDraft
  run newDraftOverlaysFirstTest = init.then(published(List({id: 1, data: EmptyData}), List(), 1))
    .then(painted({present: true, id: 0, token: 1, base: 1, data: {...EmptyData, title: 3}}))
    .expect(s.open == 3 and s.blank == 3 and s.rows.head().id == 3 and s.rows.length() == 2 and safety)
  run canonicalDraftReplacesInPlaceTest = init.then(published(List({id: 1, data: EmptyData}, {id: 2, data: EmptyData}), List(), 1))
    .then(painted({present: true, id: 2, token: 1, base: 1, data: {...EmptyData, body: 4}}))
    .expect(s.rows.nth(1).body == 4 and s.rows.head().id == 1 and s.blank == 0 and safety)
  run localHandlesNeverReachRowsTest = init.then(published(List({id: 1, data: {...EmptyData, handles: true}}), List(), 1))
    .then(painted({present: true, id: 1, token: 1, base: 1, data: {...EmptyData, handles: true}}))
    .expect(NoLocalHandles and safety)
  run ownerLossMasksRetainedRowsTest = init.then(published(List({id: 1, data: EmptyData}), List(), 1)).then(painted(EmptyDraft))
    .then(loseOwner).expect(s.rows.length() == 1 and PublicRows == List() and PublicOpen == 0 and safety)
  run phaseDrainsNavigationWaitersTest = init.then(wait(1)).then(wait(2)).then(drained(true))
    .expect(s.waiters == List() and safety)
  run retirementClearsProjectionTest = init.then(published(List({id: 1, data: EmptyData}), List(2), 1)).then(painted(EmptyDraft)).then(retired)
    .expect(s.baseRows == List() and s.rows == List() and s.trash == List() and safety)
}
