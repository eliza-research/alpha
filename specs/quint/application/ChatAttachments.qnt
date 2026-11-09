/// Composer attachment custody and history restoration for a bounded set of bindings.
module ChatAttachments {
  type State = { owner: int, conversation: int, draft: bool, pending: bool,
    generation: int, preparing: bool, heldOwner: int, heldConversation: int, heldGeneration: int,
    sent: bool, saved: Set[int], recorded: Set[int], visible: bool,
    preview: bool, view: str }
  var s: State
  pure def key(owner: int, conversation: int): int = owner * 10 + conversation
  val current = s.heldOwner == s.owner and s.heldConversation == s.conversation and s.heldGeneration == s.generation
  action init = s' = { owner: 1, conversation: 1, draft: false, pending: false,
    generation: 0, preparing: false, heldOwner: 0, heldConversation: 0, heldGeneration: 0,
    sent: false, saved: Set(), recorded: Set(), visible: false,
    preview: false, view: "notes" }
  action attach = all { not(s.pending or (s.preparing and current)), s' = {...s, draft: true} }
  action removeDraft = all { s.draft, not(s.preview), s' = {...s, draft: false} }
  action prepareSend = all { s.draft, not(s.pending or s.preparing),
    s' = {...s, preparing: true, heldOwner: s.owner, heldConversation: s.conversation, heldGeneration: s.generation} }
  action settleStorage(accepted: bool): bool = all {
    s.preparing,
    val stored = if (accepted) s.saved.union(Set(key(s.heldOwner, s.heldConversation))) else s.saved
    val settled = {...s, preparing: false, saved: stored}
    s' = if (accepted and current and s.draft)
      {...settled, draft: false, pending: true, sent: true, visible: true} else settled,
  }
  action send = all { s.draft, not(s.pending or s.preparing), s' = {...s, draft: false, pending: true,
    sent: true, heldOwner: s.owner, heldConversation: s.conversation, heldGeneration: s.generation, visible: true} }
  action store = all { s.sent, current,
    s' = {...s, saved: s.saved.union(Set(key(s.owner,s.conversation)))} }
  action confirmRecorded = all { s.pending, s.sent, current,
    s' = {...s, recorded: s.recorded.union(Set(key(s.owner,s.conversation)))} }
  action finish = all { s.pending, s' = {...s, pending: false} }
  action refusedBeforeDispatch = all { s.pending, current,
    s' = {...s, pending: false, sent: false, visible: false, draft: true} }
  action retiredRefusal = all { not(s.pending), s.heldOwner != 0, not(current), s' = s }
  val restoreVisible = s.saved.contains(key(s.owner,s.conversation)) and s.recorded.contains(key(s.owner,s.conversation))
  action reload = all {s.generation < 7, s' = {...s, generation: s.generation + 1,
    draft: false, pending: false, sent: false, preview: false, visible: restoreVisible}}
  action switchOwner = all {s.generation < 7, s' = {...s, generation: s.generation + 1,
    owner: if(s.owner == 1)2 else 1, draft: false, pending: false, sent: false, visible: false, preview: false}}
  action switchConversation = all {s.generation < 7, s' = {...s, generation: s.generation + 1,
    conversation: if(s.conversation == 1)2 else 1, draft: false, pending: false, sent: false, visible: false, preview: false}}
  action openImage = all { s.visible, s' = {...s, preview: true} }
  action closeImage = s' = {...s, preview: false}
  action step = any {attach,removeDraft,prepareSend,settleStorage(true),settleStorage(false),send,store,confirmRecorded,
    finish,refusedBeforeDispatch,retiredRefusal,reload,switchOwner,switchConversation,openImage,closeImage,s'=s}
  val NoDoublePlacement = s.pending implies (s.sent and not(s.draft or s.preparing))
  val CurrentVisible = s.visible implies ((s.sent and current) or restoreVisible)
  val PreviewInPlace = s.view == "notes" and (s.preview implies (s.visible or s.draft))
  val safety = NoDoublePlacement and CurrentVisible and PreviewInPlace
  run reloadKeepsAttachmentTest = init.then(attach).then(send).then(store).then(confirmRecorded).then(finish).then(reload).expect(s.visible and safety)
  run refusedSendRestoresDraftTest = init.then(attach).then(send).then(refusedBeforeDispatch).expect(s.draft and not(s.visible) and safety)
  run ownerIsolationTest = init.then(attach).then(send).then(store).then(confirmRecorded).then(switchOwner).then(reload).expect(not(s.visible) and safety)
  run conversationIsolationTest = init.then(attach).then(send).then(store).then(confirmRecorded).then(switchConversation).then(reload).expect(not(s.visible) and safety)
  run imagePreviewDoesNotNavigateTest = init.then(attach).then(send).then(openImage).then(closeImage).expect(s.view == "notes" and safety)
  run refusedWriteKeepsDraftTest = init.then(attach).then(prepareSend).then(settleStorage(false))
    .expect(s.draft and not(s.visible) and s.saved == Set() and safety)
  run retiredWriteKeepsOriginalSlotTest = init.then(attach).then(prepareSend).then(switchOwner).then(settleStorage(true))
    .expect(not(s.visible or s.sent or s.pending) and s.saved == Set(11) and safety)
  run revivedConversationDoesNotReviveWriteTest = init.then(attach).then(prepareSend).then(switchConversation)
    .then(switchConversation).then(settleStorage(true)).expect(not(s.visible or s.sent or s.pending) and safety)
  run orphanedBytesDoNotCreateHistoryTest = init.then(attach).then(prepareSend).then(settleStorage(true))
    .then(refusedBeforeDispatch).then(reload).expect(s.saved == Set(11) and not(s.visible) and safety)
}
