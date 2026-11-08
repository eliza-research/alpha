module RetainedInboxOperation {
  const instance: int
  import InboxDelivery.* from "./InboxDelivery"
  export InboxDelivery.s
  export InboxDelivery.init
  export InboxDelivery.safety
  export InboxDelivery.prepare
  export InboxDelivery.review
  export InboxDelivery.reserve
  export InboxDelivery.persistDispatch
  export InboxDelivery.reserveFailed
  export InboxDelivery.providerReply
  export InboxDelivery.readReceipt
  export InboxDelivery.restart
  export InboxDelivery.cancelReview
  export InboxDelivery.withdrawRead
  export InboxDelivery.withdrawModify
  export InboxDelivery.restoreGrants
}

/// Composer coordination around two independently retained account/grant operation slots.
module InboxCoordinator {
  import RetainedInboxOperation(instance = 1) as First
  import RetainedInboxOperation(instance = 2) as Second
  type Copies = {currentId:int,current:int,savedId:int,saved:int,retainedId:int,retained:int,
    shelfId:int,shelf:int,attachment:int,savedAttachment:int,retainedAttachment:int,shelfAttachment:int,
    savedVersion:int,earlier:bool}
  val emptyCopies = {currentId:0,current:0,savedId:0,saved:0,retainedId:0,retained:0,
    shelfId:0,shelf:0,attachment:0,savedAttachment:0,retainedAttachment:0,shelfAttachment:0,savedVersion:0,earlier:false}
  type Coordinator = {
    owner:int,epoch:int,bound:bool,known:bool,read:bool,send:bool,drafts:bool,mailbox:bool,
    capabilityToken:int,busy:str,busyOwner:int,busyEpoch:int,withdrawOwner:int,withdrawRead:bool,
    copies:int -> Copies,kinds:int -> str,sourceId:int -> int,sourceContent:int -> int,
    sourceAttachment:int -> int,sourceSavedVersion:int -> int,network:int -> int,
    attachmentOwner:int,attachmentEpoch:int,attachmentPending:bool,
    cleanupOwner:int,cleanupBefore:Copies,cleanupChecked:bool
  }
  var s: Coordinator
  action init = all {
    First::init,Second::init,
    s' = {owner:1,epoch:0,bound:false,known:false,read:false,send:false,drafts:false,mailbox:false,
      capabilityToken:0,busy:"idle",busyOwner:0,busyEpoch:0,withdrawOwner:0,withdrawRead:false,
      copies:Map(1 -> emptyCopies,2 -> emptyCopies),kinds:Map(1 -> "archive",2 -> "archive"),
      sourceId:Map(1 -> 0,2 -> 0),sourceContent:Map(1 -> 0,2 -> 0),sourceAttachment:Map(1 -> 0,2 -> 0),
      sourceSavedVersion:Map(1 -> 0,2 -> 0),network:Map(1 -> 0,2 -> 0),
      attachmentOwner:0,attachmentEpoch:0,attachmentPending:false,
      cleanupOwner:1,cleanupBefore:emptyCopies,cleanupChecked:false}
  }
  action keepOperations = all {First::s' = First::s,Second::s' = Second::s}
  val operation = if (s.owner == 1) First::s else Second::s
  val copy = s.copies.get(s.owner)
  val firstCopy = s.copies.get(1)
  val secondCopy = s.copies.get(2)
  val requests = s.network.get(s.owner)
  val phase = if (operation.phase == "committing") "review" else operation.phase
  def allowed(kind:str):bool = s.bound and s.known and s.read and
    (if (kind == "send") s.send else if (kind == "draft") s.drafts else s.mailbox)
  def composerBound(owner:int):bool = s.kinds.get(owner) == "archive" or
    (s.copies.get(owner).currentId == s.sourceId.get(owner) and s.sourceId.get(owner) != 0 and
      s.copies.get(owner).current == s.sourceContent.get(owner) and
      s.copies.get(owner).attachment == s.sourceAttachment.get(owner))
  val canConfirm = s.busy == "idle" and operation.phase == "review" and
    allowed(s.kinds.get(s.owner)) and composerBound(s.owner) and s.withdrawOwner != s.owner
  action prepareFor(owner:int):bool = if (owner == 1) all {First::prepare,Second::s'=Second::s}
    else all {Second::prepare,First::s'=First::s}
  action reviewFor(owner:int,exact:bool):bool = if (owner == 1) all {First::review(exact),Second::s'=Second::s}
    else all {Second::review(exact),First::s'=First::s}
  action reserveFor(owner:int):bool = if (owner == 1) all {First::reserve,Second::s'=Second::s}
    else all {Second::reserve,First::s'=First::s}
  action commitFor(owner:int):bool = if (owner == 1) all {First::persistDispatch,Second::s'=Second::s}
    else all {Second::persistDispatch,First::s'=First::s}
  action failedFor(owner:int):bool = if (owner == 1) all {First::reserveFailed,Second::s'=Second::s}
    else all {Second::reserveFailed,First::s'=First::s}
  action resultFor(owner:int,outcome:str):bool = if (owner == 1) all {First::providerReply(outcome),Second::s'=Second::s}
    else all {Second::providerReply(outcome),First::s'=First::s}
  action receiptFor(owner:int,agrees:bool):bool = if (owner == 1) all {First::readReceipt(agrees),Second::s'=Second::s}
    else all {Second::readReceipt(agrees),First::s'=First::s}
  action restartFor(owner:int):bool = if (owner == 1) all {First::restart,Second::s'=Second::s}
    else all {Second::restart,First::s'=First::s}
  action clearFor(owner:int):bool = if (owner == 1) all {First::cancelReview,Second::s'=Second::s}
    else all {Second::cancelReview,First::s'=First::s}
  action withdrawFor(owner:int,readLoss:bool):bool = if (owner == 1)
    all {if (readLoss) First::withdrawRead else First::withdrawModify,Second::s'=Second::s}
    else all {if (readLoss) Second::withdrawRead else Second::withdrawModify,First::s'=First::s}
  action restoreFor(owner:int):bool = if (owner == 1) all {First::restoreGrants,Second::s'=Second::s}
    else all {Second::restoreGrants,First::s'=First::s}

  action bind(owner:int):bool = all {
    owner.in(Set(1,2)),s.epoch<2,restartFor(owner),
    s'={...s,owner:owner,epoch:s.epoch+(if(s.bound)1 else 0),bound:true,known:false,read:true,
      send:false,drafts:false,mailbox:false,busy:"idle",cleanupChecked:false}
  }
  action unbind = all {
    s.bound,s.epoch<2,keepOperations,s'={...s,epoch:s.epoch+1,bound:false,known:false,read:false,send:false,drafts:false,mailbox:false,
      busy:"idle",copies:s.copies.set(s.owner,{...copy,current:0}),cleanupChecked:false}
  }
  action startCapabilityRead = all {
    s.bound,s.capabilityToken<2,keepOperations,
    s'={...s,capabilityToken:s.capabilityToken+1}
  }
  action capabilities(token:int,owner:int,epoch:int,known:bool,send:bool,drafts:bool,mailbox:bool):bool = all {
    s.bound,keepOperations,
    if (token==s.capabilityToken and owner==s.owner and epoch==s.epoch) s'={...s,known:known,send:known and send,drafts:known and drafts,mailbox:known and mailbox}
    else s'=s
  }
  action newDraft = all {
    s.bound,s.read,not(s.attachmentPending),copy.currentId<2,keepOperations,
    val priorId = if (copy.current!=0) copy.currentId else if (copy.retained!=0) copy.retainedId else copy.savedId
    val priorContent = if (copy.current!=0) copy.current else if (copy.retained!=0) copy.retained else copy.saved
    val priorAttachment = if (copy.current!=0) copy.attachment else if (copy.retained!=0) copy.retainedAttachment else copy.savedAttachment
    s'={...s,copies:s.copies.set(s.owner,{...copy,currentId:copy.currentId+1,current:1,retainedId:copy.currentId+1,retained:1,
      saved:0,savedId:0,shelfId:if(priorContent!=0)priorId else copy.shelfId,
      shelf:if(priorContent!=0)priorContent else copy.shelf,
      shelfAttachment:if(priorContent!=0)priorAttachment else copy.shelfAttachment,
      attachment:0,retainedAttachment:0,earlier:false}),cleanupChecked:false}
  }
  action editDraft = all {
    s.bound,copy.current!=0,copy.current<2,not(s.attachmentPending),keepOperations,
    s'={...s,copies:s.copies.set(s.owner,{...copy,current:copy.current+1,retained:copy.current+1,
      retainedId:copy.currentId,retainedAttachment:copy.attachment}),cleanupChecked:false}
  }
  action saveDraft = all {
    s.bound,copy.current!=0,copy.savedVersion<2,keepOperations,
    s'={...s,copies:s.copies.set(s.owner,{...copy,saved:copy.current,savedId:copy.currentId,
      savedVersion:copy.savedVersion+1,savedAttachment:copy.attachment,retained:0,retainedId:0}),cleanupChecked:false}
  }
  action selectAttachment = all {
    s.bound,copy.current!=0,not(s.attachmentPending),keepOperations,
    s'={...s,attachmentPending:true,attachmentOwner:s.owner,attachmentEpoch:s.epoch}
  }
  action removeAttachment = all {
    s.bound,copy.current!=0,not(s.attachmentPending),keepOperations,
    s'={...s,copies:s.copies.set(s.owner,{...copy,attachment:0,retained:copy.current,
      retainedId:copy.currentId,retainedAttachment:0}),cleanupChecked:false}
  }
  action attachmentResult(valid:bool,value:int):bool = all {
    s.attachmentPending,keepOperations,
    if(valid and value.in(Set(1,2)) and s.owner==s.attachmentOwner and s.epoch==s.attachmentEpoch)
      s'={...s,attachmentPending:false,copies:s.copies.set(s.owner,{...copy,attachment:value,
        retainedId:copy.currentId,retained:copy.current,retainedAttachment:value}),cleanupChecked:false}
    else s'={...s,attachmentPending:false}
  }
  action prepare(kind:str):bool = all {
    kind.in(Set("send","draft","archive")),allowed(kind),s.busy=="idle",s.withdrawOwner!=s.owner,
    kind=="archive" or copy.current!=0,prepareFor(s.owner),
    s'={...s,busy:"prepare",busyOwner:s.owner,busyEpoch:s.epoch,kinds:s.kinds.set(s.owner,kind),
      sourceId:s.sourceId.set(s.owner,copy.currentId),sourceContent:s.sourceContent.set(s.owner,copy.current),
      sourceAttachment:s.sourceAttachment.set(s.owner,copy.attachment),sourceSavedVersion:s.sourceSavedVersion.set(s.owner,copy.savedVersion)}
  }
  action reviewed(exact:bool):bool = all {
    s.busy=="prepare",s.busyOwner==s.owner,s.busyEpoch==s.epoch,reviewFor(s.owner,exact),
    s'={...s,busy:"idle"}
  }
  action reloadReview = all {s.busy=="idle",operation.phase=="preparing",keepOperations,
    s'={...s,busy:"prepare",busyOwner:s.owner,busyEpoch:s.epoch}}
  action cancelReview = all {s.busy=="idle",clearFor(s.owner),s'=s}
  action reserve = all {
    canConfirm,reserveFor(s.owner),s'={...s,busy:"commit",busyOwner:s.owner,busyEpoch:s.epoch}
  }
  action persisted(owner:int):bool = all {
    owner.in(Set(1,2)),commitFor(owner),
    s'=if(owner==s.owner and s.busyOwner==s.owner and s.busyEpoch==s.epoch) {...s,busy:"dispatch"} else s
  }
  action storageRefused(owner:int):bool = all {
    owner.in(Set(1,2)),failedFor(owner),
    s'=if(owner==s.owner and s.busyOwner==s.owner and s.busyEpoch==s.epoch) {...s,busy:"idle"} else s
  }
  /// A capability withdrawn after confirmation does not prove that an admitted request did not run.
  action dispatched = all {
    s.busy=="dispatch",s.busyOwner==s.owner,s.busyEpoch==s.epoch,s.network.get(s.owner)==0,keepOperations,
    s'={...s,busy:"reply",network:s.network.set(s.owner,1)}
  }
  action result(outcome:str):bool = all {
    s.busy=="reply",s.busyOwner==s.owner,s.busyEpoch==s.epoch,resultFor(s.owner,outcome),
    s'={...s,busy:"idle"}
  }
  action lostReply = all {s.busy=="reply",keepOperations,s'={...s,busy:"idle"}}
  action checkReceipt(agrees:bool):bool = all {s.bound,s.read,s.busy=="idle",receiptFor(s.owner,agrees),s'={...s,cleanupChecked:false}}
  action withdraw(readLoss:bool):bool = all {
    s.bound,keepOperations,
    s'={...s,send:false,drafts:false,mailbox:false,read:s.read and not(readLoss),withdrawOwner:s.owner,withdrawRead:readLoss}
  }
  action applyWithdrawal = all {
    s.withdrawOwner!=0,s.busy=="idle",withdrawFor(s.withdrawOwner,s.withdrawRead),
    s'={...s,withdrawOwner:0}
  }
  action regrant = all {s.bound,restoreFor(s.owner),s'={...s,known:true,read:true,send:true,drafts:true,mailbox:true}}
  action restart = all {s.epoch<2,restartFor(s.owner),s'={...s,epoch:s.epoch+1,busy:"idle",copies:s.copies.set(s.owner,{...copy,current:0}),cleanupChecked:false}}
  action resumeDraft = all {
    s.bound,copy.retained!=0,keepOperations,
    s'={...s,copies:s.copies.set(s.owner,{...copy,currentId:copy.retainedId,current:copy.retained,
      attachment:copy.retainedAttachment}),cleanupChecked:false}
  }
  action lateResult = all {keepOperations,s'=s}
  def copyBlocks(copies:Copies,owner:int):bool = {
    (copies.currentId==s.sourceId.get(owner) and copies.current!=0 and
      (copies.current!=s.sourceContent.get(owner) or copies.attachment!=s.sourceAttachment.get(owner))) or
    (copies.retainedId==s.sourceId.get(owner) and copies.retained!=0 and
      (copies.retained!=s.sourceContent.get(owner) or copies.retainedAttachment!=s.sourceAttachment.get(owner)))
  }
  def cleanupBlocked(owner:int):bool = copyBlocks(s.copies.get(owner),owner)
  action cleanup(outcome:str):bool = all {
    s.bound,s.busy=="idle",s.kinds.get(s.owner)=="send",operation.phase=="observed",
    operation.outcome=="succeeded",operation.providerConfirmed,outcome.in(Set("saved","retained-failed","saved-conflict")),keepOperations,
    val source=s.sourceId.get(s.owner)
    val removeCurrent=copy.currentId==source and copy.current==s.sourceContent.get(s.owner) and copy.attachment==s.sourceAttachment.get(s.owner)
    val removeRetained=copy.retainedId==source and copy.retained==s.sourceContent.get(s.owner) and copy.retainedAttachment==s.sourceAttachment.get(s.owner)
    val removeSaved=copy.savedId==source and copy.saved==s.sourceContent.get(s.owner) and copy.savedAttachment==s.sourceAttachment.get(s.owner)
    val removeShelf=copy.shelfId==source and copy.shelf==s.sourceContent.get(s.owner) and copy.shelfAttachment==s.sourceAttachment.get(s.owner)
    s'={...s,cleanupOwner:s.owner,cleanupBefore:copy,cleanupChecked:true,
      copies:if(cleanupBlocked(s.owner))s.copies else s.copies.set(s.owner,{...copy,
        current:if(removeCurrent)0 else copy.current,
        retained:if(removeRetained and outcome!="retained-failed")0 else copy.retained,
        saved:if(removeSaved and outcome=="saved")0 else copy.saved,
        shelf:if(removeShelf and outcome!="retained-failed")0 else copy.shelf,
        earlier:copy.earlier or (copy.savedId==source and copy.saved!=0 and not(removeSaved)
          and copy.savedVersion==s.sourceSavedVersion.get(s.owner) and outcome!="retained-failed")})}
  }
  action step = any {
    bind(1),bind(2),unbind,startCapabilityRead,capabilities(s.capabilityToken,s.owner,s.epoch,true,true,true,true),
    capabilities(s.capabilityToken,s.owner,s.epoch,true,false,false,false),capabilities(s.capabilityToken,s.owner,s.epoch,false,false,false,false),capabilities(0,1,0,true,true,true,true),
    newDraft,editDraft,saveDraft,selectAttachment,attachmentResult(true,1),attachmentResult(true,2),attachmentResult(false,1),removeAttachment,
    prepare("send"),prepare("draft"),prepare("archive"),reviewed(true),reviewed(false),reloadReview,cancelReview,
    reserve,persisted(s.owner),persisted(1),persisted(2),storageRefused(s.owner),storageRefused(1),storageRefused(2),dispatched,result("succeeded"),result("rejected"),result("unknown"),lostReply,
    checkReceipt(true),checkReceipt(false),withdraw(true),withdraw(false),applyWithdrawal,regrant,restart,resumeDraft,lateResult,
    cleanup("saved"),cleanup("retained-failed"),cleanup("saved-conflict"),all{keepOperations,s'=s}
  }
  val AtMostOneNetworkRequest = Set(1,2).forall(owner=>s.network.get(owner)<=1)
  val EffectHasDurableIntent = (s.network.get(1)>0 implies First::s.dispatches==1)
    and (s.network.get(2)>0 implies Second::s.dispatches==1)
  val UnavailableCannotConfirm = (not(s.known) or not(allowed(s.kinds.get(s.owner)))) implies not(canConfirm)
  val CurrentComposerRequired = canConfirm implies composerBound(s.owner)
  val EditedCopiesPreserved = s.cleanupChecked and copyBlocks(s.cleanupBefore,s.cleanupOwner) implies s.copies.get(s.cleanupOwner)==s.cleanupBefore
  val CleanupRequiresFreshSuccess = s.cleanupChecked implies
    (if(s.cleanupOwner==1)First::s.providerConfirmed and First::s.outcome=="succeeded" else Second::s.providerConfirmed and Second::s.outcome=="succeeded")
  val TypeOK = s.owner.in(Set(1,2)) and s.epoch.in(0.to(2)) and s.capabilityToken.in(0.to(2))
    and s.busy.in(Set("idle","prepare","commit","dispatch","reply")) and s.copies.keys()==Set(1,2)
  val safety = First::safety and Second::safety and TypeOK and AtMostOneNetworkRequest and EffectHasDurableIntent
    and UnavailableCannotConfirm and CurrentComposerRequired and EditedCopiesPreserved and CleanupRequiresFreshSuccess

  run unavailableCapabilitiesRefuseConfirmationTest = init.then(bind(1)).then(regrant).then(newDraft)
    .then(prepare("send")).then(reviewed(true)).then(capabilities(0,1,0,false,false,false,false))
    .expect(not(canConfirm) and safety).then(reserve.fail())
  run oldCapabilityReplyIgnoredTest = init.then(bind(1)).then(startCapabilityRead).then(startCapabilityRead)
    .then(capabilities(2,1,0,true,false,false,false)).then(capabilities(1,1,0,true,true,true,true))
    .expect(not(s.send) and safety)
  run changedComposerRefusesReviewTest = init.then(bind(1)).then(regrant).then(newDraft)
    .then(prepare("send")).then(reviewed(true)).then(editDraft).expect(not(canConfirm) and safety).then(reserve.fail())
  run lostOutcomeRetainsEveryCopyTest = init.then(bind(1)).then(regrant).then(newDraft).then(saveDraft)
    .then(prepare("send")).then(reviewed(true)).then(reserve).then(persisted(1)).then(dispatched).then(lostReply)
    .then(restart).expect(copy.saved!=0 and safety).then(cleanup("saved").fail())
  run renewedGrantNeedsFreshReviewTest = init.then(bind(1)).then(regrant).then(newDraft)
    .then(prepare("send")).then(reviewed(true)).then(withdraw(false)).then(applyWithdrawal).then(regrant)
    .expect(operation.phase=="empty" and not(canConfirm) and safety)
  run oldAccountCannotDispatchTest = init.then(bind(1)).then(regrant).then(newDraft)
    .then(prepare("send")).then(reviewed(true)).then(reserve).then(bind(2)).then(persisted(1))
    .expect(First::s.phase=="dispatching" and s.network.get(1)==0 and safety).then(dispatched.fail())
  run knownSuccessCleansExactCopiesTest = init.then(bind(1)).then(regrant).then(newDraft).then(saveDraft)
    .then(prepare("send")).then(reviewed(true)).then(reserve).then(persisted(1)).then(dispatched)
    .then(result("succeeded")).then(cleanup("saved")).expect(copy.current==0 and copy.saved==0 and safety)
  run editDuringSendPreservesAllCopiesTest = init.then(bind(1)).then(regrant).then(newDraft).then(saveDraft)
    .then(prepare("send")).then(reviewed(true)).then(reserve).then(persisted(1)).then(dispatched).then(editDraft)
    .then(result("succeeded")).then(cleanup("saved")).expect(copy.current==2 and copy.saved==1 and safety)
  run olderSavedVersionIsKeptTest = init.then(bind(1)).then(regrant).then(newDraft).then(saveDraft).then(editDraft)
    .then(prepare("send")).then(reviewed(true)).then(reserve).then(persisted(1)).then(dispatched)
    .then(result("succeeded")).then(cleanup("saved")).expect(copy.current==0 and copy.saved==1 and copy.earlier and safety)
  run lateAttachmentCannotCrossOwnerTest = init.then(bind(1)).then(regrant).then(newDraft).then(selectAttachment)
    .then(bind(2)).then(attachmentResult(true,1)).expect(copy.attachment==0 and safety)
  run withdrawalDuringCommitKeepsUnknownTest = init.then(bind(1)).then(regrant).then(newDraft)
    .then(prepare("send")).then(reviewed(true)).then(reserve).then(withdraw(false))
    .then(persisted(1)).then(dispatched).then(lostReply).then(applyWithdrawal).then(regrant)
    .expect(requests==1 and operation.outcome=="unknown" and copy.retained==1 and safety).then(reserve.fail())
  run attachmentChangesInvalidateReviewTest = init.then(bind(1)).then(regrant).then(newDraft)
    .then(selectAttachment).then(attachmentResult(true,1)).then(prepare("send")).then(reviewed(true))
    .then(removeAttachment).expect(not(canConfirm) and safety).then(cancelReview)
    .then(selectAttachment).then(attachmentResult(true,2)).expect(copy.attachment==2 and operation.phase=="empty" and safety)
  run newDraftShelvesLatestCopyTest = init.then(bind(1)).then(regrant).then(newDraft).then(saveDraft)
    .then(editDraft).then(restart).then(newDraft).expect(copy.shelf==2 and copy.current==1 and safety)
  run oldAccountCapabilityIgnoredTest = init.then(bind(1)).then(startCapabilityRead).then(bind(2))
    .then(capabilities(1,2,1,true,false,false,false)).then(capabilities(1,1,0,true,true,true,true))
    .expect(s.known and not(s.send or s.drafts or s.mailbox) and safety)
  run oldInstanceCapabilityIgnoredTest = init.then(bind(1)).then(startCapabilityRead).then(unbind).then(bind(1))
    .then(capabilities(1,1,0,true,true,true,true)).expect(not(s.known or s.send) and safety)
  run oldAccountCasRefusalRetainsReviewTest = init.then(bind(1)).then(regrant).then(newDraft)
    .then(prepare("send")).then(reviewed(true)).then(reserve).then(bind(2)).then(regrant)
    .then(storageRefused(1)).then(bind(1)).then(regrant)
    .expect(canConfirm and First::s.phase=="review" and requests==0 and safety)
}
