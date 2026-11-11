// One selected local draft and one unrelated peer draft in the existing shelf.
module MailDraftSelection {
  var s: {owner: bool, phase: str, selectedVersion: int, storedVersion: int, peerKept: bool, writes: int, confirmed: bool}
  action init = s' = {owner: true, phase: "idle", selectedVersion: 0, storedVersion: 1, peerKept: true, writes: 0, confirmed: false}
  action selectDraft = all {s.phase == "idle", s' = {...s, selectedVersion: s.storedVersion, phase: "selected"}}
  action confirm = all {s.phase == "selected", s' = {...s, confirmed: true, phase: "read"}}
  action peerEdit = all {s.storedVersion == 1, s' = {...s, storedVersion: 2}}
  action prepare = all {s.phase == "read", s.owner, s' = {...s, phase: if (s.storedVersion == s.selectedVersion) "ready" else "refused"}}
  action commit = all {s.phase == "ready", s.owner, s.confirmed, s.storedVersion == s.selectedVersion, s' = {...s, storedVersion: 0, writes: s.writes + 1, phase: "awaiting"}}
  action conflict = all {s.phase == "ready", s.storedVersion != s.selectedVersion, s' = {...s, phase: "refused"}}
  action readback = all {s.phase == "awaiting", s.storedVersion == 0, s' = {...s, phase: "done"}}
  action retire = s' = {...s, owner: false, phase: "retired"}
  action step = any {selectDraft, confirm, peerEdit, prepare, commit, conflict, readback, retire, s' = s}
  val safety = s.peerKept and s.writes <= 1 and (s.writes > 0 implies s.confirmed)
  // Progress requires an unchanged selected version, stable owner and successful storage replies.
  run selectedVersionRemoved = init.then(selectDraft).then(confirm).then(prepare).then(commit).then(readback).expect(s.phase == "done" and safety)
  run changedVersionRefused = init.then(selectDraft).then(confirm).then(peerEdit).then(prepare).expect(s.phase == "refused" and s.storedVersion == 2 and s.writes == 0 and safety)
  run concurrentChangeRefused = init.then(selectDraft).then(confirm).then(prepare).then(peerEdit).then(conflict).expect(s.phase == "refused" and s.writes == 0 and safety)
  run lostReplyResolvedWithoutReplay = init.then(selectDraft).then(confirm).then(prepare).then(commit).then(readback).expect(s.writes == 1 and s.phase == "done" and safety)
  run retiredOwnerCannotWrite = init.then(selectDraft).then(confirm).then(retire).expect(s.writes == 0 and safety)
}
