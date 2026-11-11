// Alpha's compact composer uses the existing account-bound mail review and draft store.
// Bound: one composer, revisions 0..2, one send, two independently saved drafts.
module MailComposerPresentation {
  var s: {draft: bool, prompt: str, revision: int, reviewed: int, sends: int, confirmed: int, shelf: Set[int]}
  action init = s' = {draft: true, prompt: "", revision: 0, reviewed: -1, sends: 0, confirmed: -1, shelf: Set()}
  action close = s' = {...s, prompt: ""}
  action askDiscard = all {s.draft, s' = {...s, prompt: "discard"}}
  action askSend = all {s.draft, s.sends == 0, s' = {...s, prompt: "send", reviewed: s.revision}}
  action no = s' = {...s, prompt: ""}
  action yesDiscard = all {s.prompt == "discard", s' = {...s, draft: false, prompt: ""}}
  action yesSend = all {
    s.prompt == "send", s.draft, s.sends == 0, s.reviewed == s.revision,
    s' = {...s, sends: 1, confirmed: s.revision, draft: false, prompt: ""}
  }
  action edit = all {s.draft, s.revision < 2, s' = {...s, revision: s.revision + 1, prompt: "", reviewed: -1}}
  action accountChanged = s' = {...s, prompt: "", reviewed: -1}
  action peerSaves = s' = {...s, shelf: s.shelf.union(Set(2))}
  action saveAside = s' = {...s, shelf: s.shelf.union(Set(1))}
  action step = any {close, askDiscard, askSend, no, yesDiscard, yesSend, edit, accountChanged, peerSaves, saveAside, s' = s}
  val safety = s.sends <= 1 and (s.sends == 1 implies s.confirmed >= 0 and not(s.draft))
  run closeKeepsDraft = init.then(close).expect(s.draft and s.sends == 0 and safety)
  run discardNoKeepsDraft = init.then(askDiscard).then(no).expect(s.draft and s.sends == 0 and safety)
  run discardYesDiscards = init.then(askDiscard).then(yesDiscard).expect(not(s.draft) and s.sends == 0 and safety)
  run sendNoKeepsDraft = init.then(askSend).then(no).expect(s.draft and s.sends == 0 and safety)
  run sendYesUsesReviewedDraft = init.then(edit).then(askSend).then(yesSend).expect(s.sends == 1 and s.confirmed == 1 and safety)
  run editInvalidatesConfirmation = init.then(askSend).then(edit).expect(s.prompt == "" and s.reviewed == -1 and s.sends == 0 and safety)
  run accountChangeInvalidatesConfirmation = init.then(askSend).then(accountChanged).expect(s.prompt == "" and s.reviewed == -1 and s.sends == 0 and safety)
  run concurrentShelfKeepsBoth = init.then(peerSaves).then(saveAside).expect(s.shelf == Set(1,2) and safety)
}
