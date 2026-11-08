/// reviewFileEmail rereads the same source before inserting into an account-bound local draft.
module FilesAndSharing {
  type State = { phase: str, source: int, reviewedSource: int, owner: int,
    reviewedOwner: int, draft: int, reviewedDraft: int, checked: bool,
    foreground: bool, grant: bool, inserted: bool, sent: bool, bytes: int }
  var s: State
  action init = s' = { phase: "idle", source: 1, reviewedSource: 0, owner: 1,
    reviewedOwner: 0, draft: 1, reviewedDraft: 0, checked: false,
    foreground: true, grant: true, inserted: false, sent: false, bytes: 0 }
  action read = all { s.phase == "idle", s.grant, s.foreground,
    s' = { ...s, phase: "review", reviewedSource: s.source, reviewedOwner: s.owner,
      reviewedDraft: s.draft, checked: false, bytes: s.source } }
  action check = all { s.phase == "review", s' = { ...s, checked: true } }
  action insert = all { s.phase == "review", s.checked, s.foreground, s.grant,
    s.reviewedSource == s.source, s.reviewedOwner == s.owner, s.reviewedDraft == s.draft,
    s' = { ...s, phase: "inserted", inserted: true, checked: false } }
  action changeSource = s' = { ...s, source: if (s.source == 1) 2 else 1 }
  action changeOwner = s' = { ...s, owner: if (s.owner == 1) 2 else 1,
    phase: "idle", inserted: false, checked: false, bytes: 0 }
  action changeDraft = s' = { ...s, draft: if (s.draft == 1) 2 else 1,
    phase: "idle", inserted: false, checked: false, bytes: 0 }
  action revoke = s' = { ...s, grant: false, phase: "cancelled", checked: false, bytes: 0, inserted: false }
  action background = s' = { ...s, foreground: false, phase: "cancelled", checked: false, bytes: 0, inserted: false }
  action cancel = s' = { ...s, phase: "cancelled", checked: false, bytes: 0, inserted: false }
  action restart = s' = { ...s, phase: "idle", foreground: true, checked: false, bytes: 0, inserted: false }
  action step = any { read, check, insert, changeSource, changeOwner, changeDraft, revoke, background, cancel, restart, s' = s }
  val ExactDraft = s.inserted implies (s.owner == s.reviewedOwner and s.draft == s.reviewedDraft and s.bytes == s.reviewedSource)
  val SeparateSend = not(s.sent)
  val ReviewSelection = s.checked implies s.phase == "review"
  val safety = ExactDraft and SeparateSend and ReviewSelection
  run exactCopyTest = init.then(read).then(check).then(insert).expect(s.inserted and s.bytes == 1 and safety)
  run changedSourceTest = init.then(read).then(check).then(changeSource)
    .expect(s.source != s.reviewedSource and not(s.inserted) and safety)
  run changedOwnerTest = init.then(read).then(check).then(changeOwner).expect(not(s.inserted) and safety)
  run revokedReadTest = init.then(read).then(revoke).expect(s.bytes == 0 and safety)
}
