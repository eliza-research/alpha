// Shared NotesEditor draft and save protocol over the current canonical controller.
// The controller supplies revisioned records. Record body bytes use equality classes.
module CanonicalNotesDraft {
  type Data = { title: int, body: int, separator: str, format: int, color: str }
  type Draft = { present: bool, token: int, id: int, base: int, version: int,
    data: Data, framing: str }
  type State = { current: bool, revision: int, known: Set[int], records: int -> Data,
    draft: Draft, captured: Draft, saving: bool, queued: int, nextToken: int,
    review: bool, committedId: int, committedToken: int, committedRevision: int }
  var s: State
  pure val Ids = Set(1, 2)
  pure val Colors = Set("yellow", "green", "rose", "slate")
  pure val EmptyData: Data = {title: 0, body: 0, separator: "", format: 0, color: "yellow"}
  pure val InitialData: Data = {title: 1, body: 2, separator: "", format: 0, color: "yellow"}
  pure val EmptyDraft: Draft = {present: false, token: 0, id: 0, base: 0, version: 0,
    data: EmptyData, framing: "fields"}
  pure def framing(data: Data): str = if (data.separator == "lf" or data.body != 0) "verbatim" else "fields"
  pure def authored(data: Data): bool =
    not(Set(0, 5).contains(data.title)) or not(Set(0, 5).contains(data.body)) or Set(2, 4, 7).contains(data.format)
  pure def validData(data: Data): bool = data.title.in(0.to(5)) and data.body.in(0.to(5))
    and data.format.in(0.to(7)) and Set("", "lf").contains(data.separator) and Colors.contains(data.color)
  pure def startSave(value: State): State = { ...value, saving: true, captured: value.draft }
  val SelectionId = if (s.current and s.draft.present and s.draft.id != 0
    and s.known.contains(s.draft.id) and (s.draft.version == 0 or s.draft.base == s.revision)) s.draft.id else 0
  val HasAuthoredContent = s.draft.present and authored(s.draft.data)
  action init = s' = {current: true, revision: 1, known: Set(1),
    records: Map(1 -> InitialData, 2 -> EmptyData), draft: EmptyDraft, captured: EmptyDraft,
    saving: false, queued: -1, nextToken: 0, review: false,
    committedId: 0, committedToken: 0, committedRevision: 0}
  action open(id: int): bool = all { Ids.contains(id),
    if (s.draft.present and s.draft.id == id) s' = s
    else all {s.current, s.revision >= 0, s.known.contains(id), s.nextToken < 5,
      s' = {...s, nextToken: s.nextToken + 1, draft: {present: true, token: s.nextToken + 1,
        id: id, base: s.revision, version: 0, data: s.records.get(id), framing: framing(s.records.get(id))}}}}
  action begin(format: int): bool = all {s.current, s.revision >= 0, Set(0, 1, 5, 6).contains(format), s.nextToken < 5,
    s' = {...s, nextToken: s.nextToken + 1, draft: {present: true, token: s.nextToken + 1,
      id: 0, base: s.revision, version: 0, data: {...EmptyData, format: format}, framing: "fields"}}}
  action edit(data: Data): bool = all {s.draft.present, s.draft.version < 4,
    data.title.in(0.to(5)), data.body.in(0.to(5)), data.format.in(0.to(7)), Colors.contains(data.color),
    s' = {...s, draft: {...s.draft, version: s.draft.version + 1,
      data: {...data, separator: if (s.draft.framing == "fields")
        (if (data.title != 0 and data.body != 0) "lf" else "") else s.draft.data.separator}}}}
  action close = s' = {...s, draft: EmptyDraft, queued: -1}
  pure def requestSave(value: State): State =
    if (not(value.draft.present) or not(value.current)) value
    else if (value.saving) {...value, queued: value.draft.version}
    else if (value.draft.base != value.revision or not(authored(value.draft.data)))
      {...value, review: value.review or value.draft.base != value.revision or value.draft.id != 0}
    else startSave(value)
  action save = s' = requestSave(s)
  action saveFailed = all {s.saving,
    s' = {...s, saving: false, queued: -1, review: s.review or s.current}}
  action saveReply(id: int, revision: int, data: Data): bool = all {
    s.saving, s.current, Ids.contains(id), revision.in(1.to(4)), revision >= s.revision, validData(data),
    s.captured.id == 0 or s.captured.id == id,
    {
      val same = s.draft.present and s.draft.token == s.captured.token
      val changed = same and s.draft.version != s.captured.version
      val draft = if (not(same)) s.draft else
        if (changed) {...s.draft, id: id, base: revision}
        else {...s.draft, id: id, base: revision, version: 0, data: data, framing: framing(data)}
      val result = {...s, revision: revision, known: s.known.union(Set(id)), records: s.records.set(id, data),
        draft: draft, saving: false, queued: -1,
        committedId: if (same) id else s.committedId,
        committedToken: if (same) s.captured.token else s.committedToken,
        committedRevision: if (same) revision else s.committedRevision}
      s' = if (same and s.queued > s.captured.version) requestSave(result) else result
    }
  }
  action snapshot(revision: int, known: Set[int], records: int -> Data): bool = all {
    s.current, revision.in(0.to(4)), revision >= s.revision, known.subseteq(Ids), records.keys() == Ids, Ids.forall(id => validData(records.get(id))),
    s' = {...s, revision: revision, known: known, records: records}}
  action reconcile =
    if (not(s.current) or not(s.draft.present) or s.draft.id == 0 or s.saving) s' = s
    else if (s.draft.version > 0) s' = {...s, review: s.review or s.draft.base != s.revision}
    else if (not(s.known.contains(s.draft.id))) close
    else s' = {...s, draft: {...s.draft, base: s.revision, data: s.records.get(s.draft.id), framing: framing(s.records.get(s.draft.id))}}
  action loseOwner = s' = {...s, current: false, revision: -1, known: Set(), records: Ids.mapBy(_ => EmptyData)}
  action step = any {close, save, saveFailed, reconcile, loseOwner,
    {nondet id = Ids.oneOf(); open(id)}, {nondet format = Set(0, 1, 5, 6).oneOf(); begin(format)},
    {nondet title = 0.to(5).oneOf(); nondet body = 0.to(5).oneOf();
      nondet format = 0.to(7).oneOf(); nondet color = Colors.oneOf();
      edit({title: title, body: body, separator: "", format: format, color: color})},
    {nondet id = Ids.oneOf(); nondet revision = 1.to(4).oneOf(); saveReply(id, revision, s.captured.data)},
    {nondet revision = 0.to(4).oneOf(); nondet known = Set(Set(), Set(1), Set(2), Ids).oneOf(); snapshot(revision, known, s.records)}, s' = s}
  val TypeOK = s.nextToken.in(0.to(5)) and s.revision.in((-1).to(4)) and s.known.subseteq(Ids)
    and s.records.keys() == Ids and s.queued.in((-1).to(4))
    and s.draft.version.in(0.to(4)) and s.captured.version.in(0.to(4))
    and validData(s.draft.data) and validData(s.captured.data)
    and Ids.forall(id => validData(s.records.get(id)))
  val PendingHasCapture = not(s.saving) or s.captured.present
  val QueueOwnedBySave = s.queued == -1 or s.saving
  val SelectionCurrent = SelectionId == 0 or s.current and s.known.contains(SelectionId)
  val safety = TypeOK and PendingHasCapture and QueueOwnedBySave and SelectionCurrent
  run newerEditSurvivesTest = init.then(open(1)).then(edit({...InitialData, title: 3})).then(save)
    .then(edit({...InitialData, title: 3, body: 4})).then(save)
    .then(saveReply(1, 2, {...InitialData, title: 3}))
    .expect(s.draft.data.body == 4 and s.draft.version == 2 and s.saving and safety)
  run closeDuringSaveTest = init.then(open(1)).then(edit({...InitialData, title: 3})).then(save).then(close)
    .then(saveReply(1, 2, {...InitialData, title: 3})).expect(not(s.draft.present) and s.committedId == 0 and safety)
  run blankNewNoteTest = init.then(begin(0)).then(save).expect(not(s.saving) and not(s.review) and safety)
  run externalRevisionNeedsReviewTest = init.then(open(1)).then(edit({...InitialData, title: 3}))
    .then(snapshot(2, Set(1), Map(1 -> InitialData, 2 -> EmptyData))).then(reconcile)
    .expect(s.review and s.draft.data.title == 3 and SelectionId == 0 and safety)
  run cleanRemovedNoteClosesTest = init.then(open(1)).then(snapshot(2, Set(), Ids.mapBy(_ => EmptyData))).then(reconcile)
    .expect(not(s.draft.present) and safety)
}
