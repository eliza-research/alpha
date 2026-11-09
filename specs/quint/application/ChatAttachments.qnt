/// UI attachment custody. Storage success is explicit; byte contents and device sync are abstracted.
module ChatAttachments {
  type State = { owner: int, conversation: int, draft: bool, pending: bool,
    heldOwner: int, heldConversation: int, sent: bool, saved: Set[int], visible: bool,
    preview: bool, view: str }
  var s: State
  pure def key(owner: int, conversation: int): int = owner * 10 + conversation
  action init = s' = { owner: 1, conversation: 1, draft: false, pending: false,
    heldOwner: 0, heldConversation: 0, sent: false, saved: Set(), visible: false,
    preview: false, view: "notes" }
  action attach = all { not(s.pending), s' = {...s, draft: true} }
  action send = all { s.draft, not(s.pending), s' = {...s, draft: false, pending: true,
    sent: true, heldOwner: s.owner, heldConversation: s.conversation, visible: true} }
  action store = all { s.sent, s.heldOwner == s.owner, s.heldConversation == s.conversation,
    s' = {...s, saved: s.saved.union(Set(key(s.owner,s.conversation)))} }
  action finish = all { s.pending, s' = {...s, pending: false} }
  action refusedBeforeDispatch = all { s.pending, s.heldOwner == s.owner, s.heldConversation == s.conversation,
    s' = {...s, pending: false, sent: false, visible: false, draft: true} }
  action reload = s' = {...s, draft: false, pending: false, sent: false, preview: false,
    visible: s.saved.contains(key(s.owner,s.conversation))}
  action switchOwner = s' = {...s, owner: if(s.owner == 1)2 else 1, draft: false, pending: false,
    sent: false, visible: false, preview: false}
  action switchConversation = s' = {...s, conversation: if(s.conversation == 1)2 else 1,
    draft: false, pending: false, sent: false, visible: false, preview: false}
  action openImage = all { s.visible, s' = {...s, preview: true} }
  action closeImage = s' = {...s, preview: false}
  action step = any {attach,send,store,finish,refusedBeforeDispatch,reload,switchOwner,switchConversation,openImage,closeImage,s'=s}
  val NoDoublePlacement = s.pending implies (s.sent and not(s.draft))
  val CurrentVisible = s.visible implies ((s.sent and s.heldOwner == s.owner and s.heldConversation == s.conversation) or s.saved.contains(key(s.owner,s.conversation)))
  val PreviewInPlace = s.view == "notes" and (s.preview implies (s.visible or s.draft))
  val safety = NoDoublePlacement and CurrentVisible and PreviewInPlace
  run reloadKeepsAttachmentTest = init.then(attach).then(send).then(store).then(finish).then(reload).expect(s.visible and safety)
  run refusedSendRestoresDraftTest = init.then(attach).then(send).then(refusedBeforeDispatch).expect(s.draft and not(s.visible) and safety)
  run ownerIsolationTest = init.then(attach).then(send).then(store).then(switchOwner).then(reload).expect(not(s.visible) and safety)
  run conversationIsolationTest = init.then(attach).then(send).then(store).then(switchConversation).then(reload).expect(not(s.visible) and safety)
  run imagePreviewDoesNotNavigateTest = init.then(attach).then(send).then(openImage).then(closeImage).expect(s.view == "notes" and safety)
}
