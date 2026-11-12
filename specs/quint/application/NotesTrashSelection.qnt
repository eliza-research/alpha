module NotesTrashSelection {
  var s: {
    owner: bool, phase: str, revision: int, expected: int, cursor: int,
    actionKind: str, approved: bool, sends: Set[int], archived: Set[int],
    restored: Set[int], erased: Set[int]
  }
  action init = s' = {
    owner: true, phase: "idle", revision: 1, expected: 0, cursor: 1,
    actionKind: "none", approved: false, sends: Set(), archived: Set(1, 2, 3),
    restored: Set(), erased: Set()
  }
  action review(kind: str): bool = all {
    s.phase == "idle",
    s' = {...s, phase: "review", expected: s.revision, actionKind: kind}
  }
  action cancel = all {
    s.phase == "review", s' = {...s, phase: "stopped"}
  }
  action approve = all {
    s.owner, s.phase == "review", s.revision == s.expected,
    s' = {...s, phase: "ready", approved: true}
  }
  val mayDispatch = s.owner and s.approved and s.phase == "ready" and
    s.revision == s.expected and s.cursor <= 2 and not(s.sends.contains(s.cursor))
  action dispatch = all {
    mayDispatch, s' = {...s, phase: "sent", sends: s.sends.union(Set(s.cursor))}
  }
  action committed = all {
    s.phase == "sent", s.revision == s.expected,
    s' = {...s,
      phase: if (s.cursor == 2) "done" else "ready",
      archived: s.archived.exclude(Set(s.cursor)),
      restored: if (s.actionKind == "recover") s.restored.union(Set(s.cursor)) else s.restored,
      erased: if (s.actionKind == "erase") s.erased.union(Set(s.cursor)) else s.erased,
      cursor: s.cursor + 1, revision: s.revision + 1, expected: s.expected + 1}
  }
  action lostReply = all {
    s.phase == "sent", s' = {...s, phase: "unknown"}
  }
  action lostAfterCommit = all {
    s.phase == "sent", s.revision == s.expected,
    s' = {...s, phase: "unknown",
      archived: s.archived.exclude(Set(s.cursor)),
      restored: if (s.actionKind == "recover") s.restored.union(Set(s.cursor)) else s.restored,
      erased: if (s.actionKind == "erase") s.erased.union(Set(s.cursor)) else s.erased,
      revision: s.revision + 1}
  }
  action foreignWrite = all {
    s.revision < 5, s' = {...s, revision: s.revision + 1}
  }
  action retire = s' = {...s, owner: false, phase: "retired"}
  action step = any {
    review("recover"), review("erase"), cancel, approve, dispatch, committed,
    lostReply, lostAfterCommit, foreignWrite, retire, s' = s
  }
  val safety =
    s.archived.contains(3) and not(s.sends.contains(3)) and
    s.archived.union(s.restored).union(s.erased) == Set(1, 2, 3) and
    s.archived.intersect(s.restored.union(s.erased)) == Set() and
    s.restored.intersect(s.erased) == Set() and
    (s.sends.size() > 0 implies s.approved) and
    (s.erased.size() > 0 implies s.actionKind == "erase") and
    (s.phase == "unknown" implies not(mayDispatch))
  run selectedRecovery = init.then(review("recover")).then(approve).then(dispatch).then(committed)
    .then(dispatch).then(committed).expect(s.restored == Set(1, 2) and s.archived == Set(3) and safety)
  run selectedErase = init.then(review("erase")).then(approve).then(dispatch).then(committed)
    .then(dispatch).then(committed).expect(s.erased == Set(1, 2) and s.archived == Set(3) and safety)
  run cancelNoSend = init.then(review("erase")).then(cancel).expect(s.sends == Set() and safety)
  run staleSelection = init.then(review("erase")).then(approve).then(foreignWrite)
    .expect(not(mayDispatch) and s.sends == Set() and safety)
  run partialUnknown = init.then(review("erase")).then(approve).then(dispatch).then(committed)
    .then(dispatch).then(lostReply).expect(s.erased == Set(1) and not(mayDispatch) and safety)
  run committedReplyLost = init.then(review("erase")).then(approve).then(dispatch).then(committed)
    .then(dispatch).then(lostAfterCommit).expect(s.erased == Set(1, 2) and not(mayDispatch) and safety)
  run ownerChange = init.then(review("recover")).then(approve).then(dispatch).then(committed)
    .then(retire).expect(s.restored == Set(1) and s.sends == Set(1) and not(mayDispatch) and safety)
}
