// Pending recording bytes and manifest publication on the real journal API.
module BrowserNoteRecordingJournal {
  type State = {count: int, offset: bool, manifest: str, clips: List[str], texts: List[int],
    savePending: bool, readPending: bool, captured: List[int], readTexts: List[int], outcome: str}
  var s: State
  pure def initState(count: int, offset: bool): State = {
    count: count, offset: offset, manifest: "absent", clips: List("absent", "absent"),
    texts: List(0, 0), savePending: false, readPending: false, captured: List(0, 0),
    readTexts: List(0, 0), outcome: "none",
  }
  action initFor(count: int, offset: bool): bool = all {
    count.in(Set(1, 2)), not(offset) or count == 1, s' = initState(count, offset),
  }
  action init = any {initFor(1, false), initFor(2, false), initFor(1, true)}
  pure def mapClips(st: State, value: str, limit: int): List[str] =
    List(if (not(st.offset) and limit > 0) value else st.clips.nth(0),
      if (not(st.offset) and st.count == 2 and limit > 1) value else st.clips.nth(1))
  val available = s.offset or s.clips.indices().forall(i => i >= s.count or s.clips.nth(i) == "live")
  action prepareSave(failAt: int): bool = all {
    not(s.savePending), failAt.in(Set(0, 1, 2)),
    val tombstone = not(s.offset) and s.clips.indices().exists(i => i < s.count and s.clips.nth(i) == "retired")
    val failure = tombstone or (not(s.offset) and failAt > 0 and failAt <= s.count)
    val limit = if (tombstone) 0 else if (failure) failAt - 1 else s.count
    s' = {...s, clips: mapClips(s, "live", limit), savePending: not(failure),
      outcome: if (failure) "error" else "pending"},
  }
  action publishSave = all {
    s.savePending,
    s' = {...s, savePending: false, manifest: if (s.manifest == "retired") "retired" else "live",
      outcome: if (s.manifest == "retired") "error" else "saved"},
  }
  action setText(index: int, text: int): bool = all {
    index >= 0, index < s.count, text.in(Set(1, 2)),
    s' = if (s.manifest == "live") {...s, texts: s.texts.replaceAt(index, text), outcome: "text"}
      else {...s, outcome: "error"},
  }
  action changedBytes = all {
    s.manifest == "live", not(s.offset),
    s' = {...s, outcome: "error"},
  }
  action wrongBinding = all {s.manifest == "live", s' = {...s, outcome: "error"}}
  action wrongOwner = all {s.manifest == "live", s' = {...s, outcome: "error"}}
  action beginRead = all {
    not(s.readPending),
    s' = if (s.manifest != "live") {...s, readTexts: List(0, 0), outcome: "empty"}
      else if (s.offset) {...s, readTexts: s.texts, outcome: "read"}
      else {...s, readPending: true, captured: s.texts, outcome: "pending"},
  }
  action finishRead = all {
    s.readPending,
    s' = {...s, readPending: false, readTexts: if (available) s.captured else List(0, 0),
      outcome: if (available) "read" else "error"},
  }
  action retire(failAt: int): bool = all {
    failAt.in(Set(0, 1, 2, 3)),
    val live = s.manifest == "live"
    val failed = live and (failAt == 3 or (not(s.offset) and failAt > 0 and failAt <= s.count))
    val limit = if (failAt > 0 and failAt <= s.count) failAt - 1 else s.count
    s' = {...s, clips: if (live) mapClips(s, "retired", limit) else s.clips,
      manifest: if (live and not(failed)) "retired" else s.manifest,
      texts: if (live and not(failed)) List(0, 0) else s.texts,
      outcome: if (failed) "error" else "retired"},
  }
  action step = any {
    prepareSave(0), prepareSave(1), prepareSave(2), publishSave, beginRead, finishRead,
    retire(0), retire(1), retire(2), retire(3), changedBytes, wrongBinding, wrongOwner,
    {nondet i = 0.to(s.count - 1).oneOf(); nondet text = Set(1, 2).oneOf(); setText(i, text)},
    s' = s,
  }
  val RetiredBytesStayRetired = s.manifest == "retired" implies
    (s.offset or s.clips.indices().forall(i => i >= s.count or s.clips.nth(i) == "retired"))
  val BoundFields = s.texts.length() == 2 and s.readTexts.length() == 2 and s.clips.length() == 2
    and s.texts.indices().forall(i => s.texts.nth(i).in(Set(0, 1, 2)))
  val safety = RetiredBytesStayRetired and BoundFields
  run bytesPrecedeManifestTest = initFor(2, false).then(prepareSave(0))
    .expect(s.manifest == "absent" and s.clips == List("live", "live"))
    .then(publishSave).expect(s.manifest == "live" and safety)
  run retryPreservesLateTextTest = init.then(prepareSave(0)).then(publishSave).then(setText(0, 1))
    .then(prepareSave(0)).then(setText(0, 2)).then(publishSave).expect(s.texts.nth(0) == 2 and safety)
  run retirementFencesPreparedSaveTest = init.then(prepareSave(0)).then(publishSave)
    .then(prepareSave(0)).then(retire(0)).then(publishSave).expect(s.manifest == "retired" and s.outcome == "error" and safety)
  run partialRetirementIsUnreadableTest = initFor(2, false).then(prepareSave(0)).then(publishSave)
    .then(retire(2)).then(beginRead).then(finishRead).expect(s.manifest == "live" and s.outcome == "error" and safety)
  run retiredReadCannotReturnDeletedBytesTest = initFor(1, false).then(prepareSave(0)).then(publishSave)
    .then(beginRead).then(retire(0)).then(finishRead).expect(s.outcome == "error" and safety)
  run retirementBeforePublicationIsNoOpTest = initFor(1, false).then(prepareSave(0))
    .then(retire(0)).then(publishSave).expect(s.manifest == "live" and safety)
  run offsetSegmentsNeedNoClipsTest = initFor(1, true).then(prepareSave(0)).then(publishSave)
    .then(setText(0, 1)).then(beginRead).expect(s.outcome == "read" and s.readTexts.nth(0) == 1 and safety)
}
