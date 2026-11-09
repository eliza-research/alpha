// NotesEditor remove/restore continuations over the canonical controller.
// Payloads are represented by collection membership and authored-content classes.
module CanonicalNotesMutation {
  type Draft = {present: bool, id: int, token: int, base: int, version: int, authored: bool}
  type Write = {kind: str, id: int, token: int, version: int, expectedRevision: int}
  type Mutation = {kind: str, id: int, token: int, phase: str}
  type State = {current: bool, revision: int, notes: Set[int], trash: Set[int], authored: Set[int],
    draft: Draft, nextToken: int, saving: bool, queued: int, write: Write,
    mutation: Mutation, review: bool, probe: str}
  var s: State
  pure val Ids = Set(1, 2)
  pure val NoDraft: Draft = {present: false, id: 0, token: 0, base: 0, version: 0, authored: false}
  pure val NoWrite: Write = {kind: "none", id: 0, token: 0, version: 0, expectedRevision: -1}
  pure val NoMutation: Mutation = {kind: "none", id: 0, token: 0, phase: "idle"}
  pure def saving(value: State): State = {...value, saving: true,
    write: {kind: "save", id: value.draft.id, token: value.draft.token,
      version: value.draft.version, expectedRevision: value.draft.base}}
  pure def requestSave(value: State): State =
    if (not(value.current) or not(value.draft.present)) value
    else if (value.saving) {...value, queued: value.draft.version}
    else if (value.draft.base != value.revision or not(value.draft.authored))
      {...value, review: value.review or value.draft.base != value.revision or value.draft.id != 0}
    else if (value.write.kind != "none") {...value, review: true}
    else saving(value)
  pure def deletion(value: State): State =
    if (value.write.kind != "none" or not(value.current))
      {...value, mutation: {...value.mutation, phase: "false"}, review: value.review or value.current}
    else {...value, mutation: {...value.mutation, phase: "delete"},
      write: {kind: "delete", id: value.mutation.id, token: 0, version: 0, expectedRevision: -1}}
  pure def completeSave(value: State, id: int, revision: int, notes: Set[int], trash: Set[int], authored: Set[int]): State = {
    val same = value.draft.present and value.draft.token == value.write.token
    val changed = same and value.draft.version != value.write.version
    val draft = if (not(same)) value.draft else
      if (changed) {...value.draft, id: id, base: revision}
      else {...value.draft, id: id, base: revision, version: 0, authored: authored.contains(id)}
    val updated = {...value, revision: revision, notes: notes, trash: trash, authored: authored, draft: draft,
      saving: false, queued: -1, write: NoWrite}
    val queued = if (same and value.queued > value.write.version) requestSave(updated) else updated
    if (value.mutation.phase != "save") queued
    else if (not(same) or not(notes.contains(value.mutation.id)))
      {...queued, mutation: {...queued.mutation, phase: "false"}}
    else deletion(queued)
  }
  action init = s' = {current: true, revision: 1, notes: Set(1), trash: Set(2), authored: Ids, draft: NoDraft,
    nextToken: 0, saving: false, queued: -1, write: NoWrite, mutation: NoMutation, review: false, probe: "none"}
  action open(id: int): bool = all {s.current, s.notes.contains(id), Ids.contains(id),
    if (s.draft.present and s.draft.id == id) s' = s
    else all {s.nextToken < 5, s' = {...s, nextToken: s.nextToken + 1,
      draft: {present: true, id: id, token: s.nextToken + 1, base: s.revision, version: 0, authored: s.authored.contains(id)}}}}
  action begin = all {s.current, s.nextToken < 5, s' = {...s, nextToken: s.nextToken + 1,
    draft: {present: true, id: 0, token: s.nextToken + 1, base: s.revision, version: 0, authored: false}}}
  action edit(authored: bool): bool = all {s.draft.present, s.draft.version < 4,
    s' = {...s, draft: {...s.draft, version: s.draft.version + 1, authored: authored}}}
  action close = s' = {...s, draft: NoDraft, queued: -1}
  action save = s' = requestSave(s)
  action remove(id: int): bool = all {Ids.contains(id), not(Set("save", "delete", "restore").contains(s.mutation.phase)),
    {
      val pending = {...s, mutation: {kind: "delete", id: id, token: s.draft.token, phase: "false"}}
      s' = if (not(s.notes.contains(id)) or s.saving) pending
      else if (s.draft.present and s.draft.id == id and s.draft.version > 0) {
        val requested = requestSave(pending)
        if (requested.saving) {...requested, mutation: {...requested.mutation, phase: "save"}} else requested
      } else deletion(pending)
    }}
  action restore(id: int): bool = all {Ids.contains(id), not(Set("save", "delete", "restore").contains(s.mutation.phase)),
    {
      val pending = {...s, mutation: {kind: "restore", id: id, token: 0, phase: "false"}}
      s' = if (not(s.trash.contains(id)) or s.saving) pending
      else if (s.write.kind != "none" or not(s.current)) {...pending, review: s.review or s.current}
      else {...pending, mutation: {...pending.mutation, phase: "restore"},
        write: {kind: "restore", id: id, token: 0, version: 0, expectedRevision: s.revision}}
    }}
  // A second remove/restore call is recorded only when its immediate guard or
  // controller single-writer admission rejects it while another command waits.
  action probe(kind: str, id: int): bool = all {Set("delete", "restore").contains(kind), Ids.contains(id),
    Set("save", "delete", "restore").contains(s.mutation.phase),
    s' = {...s, probe: "false", review: s.review or
      (not(s.saving) and s.current and (if (kind == "delete") s.notes.contains(id) else s.trash.contains(id)))}}
  action saveReply(id: int, revision: int, notes: Set[int], trash: Set[int], authored: Set[int]): bool = all {
    s.current, s.saving, s.write.kind == "save", Ids.contains(id), s.write.id == 0 or s.write.id == id,
    revision.in(1.to(4)), revision >= s.revision, notes.subseteq(Ids), trash.subseteq(Ids),
    notes.intersect(trash) == Set(), notes.union(trash).contains(id), authored.subseteq(notes.union(trash)),
    s' = completeSave(s, id, revision, notes, trash, authored)}
  action mutationReply(revision: int, notes: Set[int], trash: Set[int], authored: Set[int]): bool = all {
    s.current, Set("delete", "restore").contains(s.write.kind), revision.in(1.to(4)), revision >= s.revision,
    notes.subseteq(Ids), trash.subseteq(Ids), notes.intersect(trash) == Set(), notes.union(trash).contains(s.write.id), authored.subseteq(notes.union(trash)),
    s' = {...s, revision: revision, notes: notes, trash: trash, authored: authored, write: NoWrite,
      draft: if (s.write.kind == "delete" and s.draft.id == s.write.id) NoDraft else s.draft,
      queued: if (s.write.kind == "delete" and s.draft.id == s.write.id) -1 else s.queued,
      mutation: {...s.mutation, phase: "true"}}}
  action failed = all {s.write.kind != "none", s' = {...s, saving: false, queued: -1, write: NoWrite,
    review: s.review or s.current, mutation: if (Set("save", "delete", "restore").contains(s.mutation.phase))
      {...s.mutation, phase: "false"} else s.mutation}}
  action snapshot(revision: int, notes: Set[int], trash: Set[int], authored: Set[int]): bool = all {s.current, s.write.kind == "none",
    revision.in(1.to(4)), revision >= s.revision, notes.subseteq(Ids), trash.subseteq(Ids), notes.intersect(trash) == Set(), authored.subseteq(notes.union(trash)),
    s' = {...s, revision: revision, notes: notes, trash: trash, authored: authored}}
  action loseOwner = s' = {...s, current: false, revision: -1, notes: Set(), trash: Set(), authored: Set()}
  action step = any {close, begin, save, failed, loseOwner,
    {nondet id = Ids.oneOf(); open(id)}, {nondet authored = Bool.oneOf(); edit(authored)},
    {nondet id = Ids.oneOf(); remove(id)}, {nondet id = Ids.oneOf(); restore(id)},
    {nondet kind = Set("delete", "restore").oneOf(); nondet id = Ids.oneOf(); probe(kind, id)},
    {nondet id = Ids.oneOf(); nondet revision = 1.to(4).oneOf(); nondet notes = Set(Set(), Set(1), Set(2), Ids).oneOf();
      nondet trash = Set(Set(), Set(1), Set(2), Ids).oneOf(); nondet authored = Set(Set(), Set(1), Set(2), Ids).oneOf(); saveReply(id, revision, notes, trash, authored)},
    {nondet revision = 1.to(4).oneOf(); nondet notes = Set(Set(), Set(1), Set(2), Ids).oneOf();
      nondet trash = Set(Set(), Set(1), Set(2), Ids).oneOf(); nondet authored = Set(Set(), Set(1), Set(2), Ids).oneOf(); mutationReply(revision, notes, trash, authored)},
    {nondet revision = 1.to(4).oneOf(); nondet notes = Set(Set(), Set(1), Set(2), Ids).oneOf();
      nondet trash = Set(Set(), Set(1), Set(2), Ids).oneOf(); nondet authored = Set(Set(), Set(1), Set(2), Ids).oneOf(); snapshot(revision, notes, trash, authored)}, s' = s}
  val TypeOK = s.revision.in((-1).to(4)) and s.notes.subseteq(Ids) and s.trash.subseteq(Ids)
    and s.nextToken.in(0.to(5)) and s.draft.version.in(0.to(4)) and s.queued.in((-1).to(4))
    and Set("none", "save", "delete", "restore").contains(s.write.kind)
    and Set("idle", "save", "delete", "restore", "true", "false").contains(s.mutation.phase)
  val CollectionIdentity = s.notes.intersect(s.trash) == Set() and s.authored.subseteq(s.notes.union(s.trash))
  val SingleWriter = s.saving == (s.write.kind == "save")
  val QueueOwnedBySave = s.queued == -1 or s.saving
  val PendingMutation = (s.mutation.phase != "delete" or s.write.kind == "delete")
    and (s.mutation.phase != "restore" or s.write.kind == "restore")
    and (s.mutation.phase != "save" or s.saving)
  val safety = TypeOK and CollectionIdentity and SingleWriter and QueueOwnedBySave and PendingMutation
  run dirtyDeleteSavesFirstTest = init.then(open(1)).then(edit(true)).then(remove(1))
    .expect(s.mutation.phase == "save" and s.write.kind == "save")
    .then(saveReply(1, 2, Set(1), Set(2), Ids)).expect(s.write.kind == "delete")
    .then(mutationReply(3, Set(), Ids, Ids)).expect(s.mutation.phase == "true" and not(s.draft.present) and safety)
  run changedTokenCancelsDeleteTest = init.then(open(1)).then(edit(true)).then(remove(1)).then(begin)
    .then(saveReply(1, 2, Set(1), Set(2), Ids)).expect(s.mutation.phase == "false" and s.draft.id == 0 and safety)
  run queuedSaveBlocksDeleteTest = init.then(open(1)).then(edit(true)).then(remove(1)).then(edit(true)).then(save)
    .then(saveReply(1, 2, Set(1), Set(2), Ids)).expect(s.saving and s.mutation.phase == "false" and s.review and safety)
  run restoreRevisionTest = init.then(restore(2)).expect(s.write.expectedRevision == 1)
    .then(mutationReply(2, Ids, Set(), Ids)).expect(s.mutation.phase == "true" and safety)
  run emptyCanonicalRecordCanDeleteTest = init.then(snapshot(1, Set(1), Set(2), Set(2))).then(open(1))
    .expect(not(s.draft.authored)).then(remove(1)).expect(s.write.kind == "delete" and safety)
  run lostOwnerCannotPublishTest = init.then(remove(1)).then(loseOwner).then(failed)
    .expect(s.revision == -1 and s.notes == Set() and not(s.review) and safety)
}
