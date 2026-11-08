/// Three independently retained requests model create, replacement and permanent provider deletion.
module InboxProviderDrafts {
  import RetainedInboxOperation(instance=101) as Create from "./InboxCoordinator"
  import RetainedInboxOperation(instance=102) as Replace from "./InboxCoordinator"
  import RetainedInboxOperation(instance=103) as Delete from "./InboxCoordinator"

  type Local = { id:int,body:int,ref:int,saved:int,savedRef:int,savedId:int,retained:int,retainedRef:int,
    parts:Set[int],savedParts:Set[int],history:int,savedHistory:int,forward:bool }
  type Proposal = { id:int,body:int,ref:int,parts:Set[int],history:int,bytes:int,forward:bool }
  val emptyLocal = {id:0,body:0,ref:0,saved:0,savedRef:0,savedId:0,retained:0,retainedRef:0,
    parts:Set(),savedParts:Set(),history:0,savedHistory:0,forward:false}
  val emptyProposal = {id:0,body:0,ref:0,parts:Set(),history:0,bytes:0,forward:false}
  type State = {owner:int,epoch:int,bound:bool,draftsAllowed:bool,forwardAllowed:bool,slot:str,record:bool,
    recordOwner:int,busy:str,capturedOwner:int,capturedEpoch:int,reviewAllowed:bool,nextSlot:str,targetRef:int,
    copies:int -> Local,proposals:str -> Proposal,receipts:str -> int,network:str -> int,
    remoteRef:int,remoteBody:int,remoteBytes:int,remoteParts:Set[int],sourceHistory:int,sourceBytes:int,
    readRef:int,readMatches:bool,trusted:int -> Set[int],inFlight:str -> bool,effectDone:str -> bool,flightEpoch:str -> int,
    saving:bool,pendingLocal:Local,retiring:bool,retireUncertain:bool,reading:bool,lastEffect:str}
  var s:State
  val slots=Set("create","replace","delete")
  action init = all {
    Create::init,Replace::init,Delete::init,
    s'={owner:1,epoch:0,bound:false,draftsAllowed:false,forwardAllowed:false,slot:"create",record:false,
      recordOwner:0,busy:"idle",capturedOwner:0,capturedEpoch:0,reviewAllowed:false,nextSlot:"replace",targetRef:0,
      copies:Map(1->emptyLocal,2->emptyLocal),proposals:slots.mapBy(_=>emptyProposal),receipts:slots.mapBy(_=>0),network:slots.mapBy(_=>0),
      remoteRef:0,remoteBody:0,remoteBytes:0,remoteParts:Set(),sourceHistory:1,sourceBytes:1,
      readRef:0,readMatches:false,trusted:Map(1->Set(),2->Set()),inFlight:slots.mapBy(_=>false),effectDone:slots.mapBy(_=>false),flightEpoch:slots.mapBy(_=>0),
      saving:false,pendingLocal:emptyLocal,retiring:false,retireUncertain:false,reading:false,lastEffect:"none"}
  }
  action keep = all {Create::s'=Create::s,Replace::s'=Replace::s,Delete::s'=Delete::s}
  val operation = if(s.slot=="create")Create::s else if(s.slot=="replace")Replace::s else Delete::s
  val copy=s.copies.get(s.owner)
  val firstCopy=s.copies.get(1)
  val proposal=s.proposals.get(s.slot)
  val phase=if(not(s.record) or s.recordOwner!=s.owner)"empty" else if(operation.phase=="committing")"review" else operation.phase
  val kind=if(phase=="empty")"none" else if(s.slot=="create")"draft-create" else if(s.slot=="replace")"draft-replace" else "draft-delete"
  val requests=s.network.get("create")+s.network.get("replace")+s.network.get("delete")
  val current=s.bound and s.owner==s.capturedOwner and s.epoch==s.capturedEpoch
  val composerMatches=s.slot=="delete" or (copy.id==proposal.id and copy.body==proposal.body and copy.parts==proposal.parts and copy.history==proposal.history)
  val canConfirm=s.busy=="idle" and phase=="review" and s.draftsAllowed and
    (proposal.parts.size()==0 or s.forwardAllowed) and composerMatches
  action prepareCurrent = if(s.slot=="create")all{Create::prepare,Replace::s'=Replace::s,Delete::s'=Delete::s}
    else if(s.slot=="replace")all{Replace::prepare,Create::s'=Create::s,Delete::s'=Delete::s}
    else all{Delete::prepare,Create::s'=Create::s,Replace::s'=Replace::s}
  action reviewedCurrent = if(s.slot=="create")all{Create::review(true),Replace::s'=Replace::s,Delete::s'=Delete::s}
    else if(s.slot=="replace")all{Replace::review(true),Create::s'=Create::s,Delete::s'=Delete::s}
    else all{Delete::review(true),Create::s'=Create::s,Replace::s'=Replace::s}
  action reserveCurrent = if(s.slot=="create")all{Create::reserve,Replace::s'=Replace::s,Delete::s'=Delete::s}
    else if(s.slot=="replace")all{Replace::reserve,Create::s'=Create::s,Delete::s'=Delete::s}
    else all{Delete::reserve,Create::s'=Create::s,Replace::s'=Replace::s}
  action persistCurrent = if(s.slot=="create")all{Create::persistDispatch,Replace::s'=Replace::s,Delete::s'=Delete::s}
    else if(s.slot=="replace")all{Replace::persistDispatch,Create::s'=Create::s,Delete::s'=Delete::s}
    else all{Delete::persistDispatch,Create::s'=Create::s,Replace::s'=Replace::s}
  action replyCurrent(outcome:str):bool = if(s.slot=="create")all{Create::providerReply(outcome),Replace::s'=Replace::s,Delete::s'=Delete::s}
    else if(s.slot=="replace")all{Replace::providerReply(outcome),Create::s'=Create::s,Delete::s'=Delete::s}
    else all{Delete::providerReply(outcome),Create::s'=Create::s,Replace::s'=Replace::s}
  action checkCurrent(agrees:bool):bool = if(s.slot=="create")all{Create::readReceipt(agrees),Replace::s'=Replace::s,Delete::s'=Delete::s}
    else if(s.slot=="replace")all{Replace::readReceipt(agrees),Create::s'=Create::s,Delete::s'=Delete::s}
    else all{Delete::readReceipt(agrees),Create::s'=Create::s,Replace::s'=Replace::s}
  action restartCurrent = if(s.slot=="create")all{Create::restart,Replace::s'=Replace::s,Delete::s'=Delete::s}
    else if(s.slot=="replace")all{Replace::restart,Create::s'=Create::s,Delete::s'=Delete::s}
    else all{Delete::restart,Create::s'=Create::s,Replace::s'=Replace::s}
  action cancelCurrent = if(s.slot=="create")all{Create::cancelReview,Replace::s'=Replace::s,Delete::s'=Delete::s}
    else if(s.slot=="replace")all{Replace::cancelReview,Create::s'=Create::s,Delete::s'=Delete::s}
    else all{Delete::cancelReview,Create::s'=Create::s,Replace::s'=Replace::s}

  action bind(owner:int):bool = all {
    owner.in(Set(1,2)),s.epoch<3,restartCurrent,
    s'={...s,owner:owner,epoch:s.epoch+(if(s.bound)1 else 0),bound:true,draftsAllowed:true,forwardAllowed:true,busy:"idle"}
  }
  action capabilities(drafts:bool,forward:bool):bool = all {keep,s'={...s,draftsAllowed:drafts,forwardAllowed:forward}}
  action newDraft(forward:bool):bool = all {
    s.bound,copy.id<3,copy.body==0,copy.saved==0,copy.retained==0,s.busy=="idle",keep,
    s'={...s,copies:s.copies.set(s.owner,{...copy,id:copy.id+1,body:1,ref:0,retained:1,retainedRef:0,
      forward:forward,parts:if(forward)Set(1,2) else Set(),history:if(forward)s.sourceHistory else 0})}
  }
  action edit = all {copy.body==1,s.busy.in(Set("idle","read")),keep,
    s'={...s,copies:s.copies.set(s.owner,{...copy,body:2,retained:2,retainedRef:copy.ref})}}
  action removePart(part:int):bool = all {copy.parts.contains(part),s.busy.in(Set("idle","read")),keep,
    s'={...s,copies:s.copies.set(s.owner,{...copy,parts:copy.parts.exclude(Set(part)),history:if(copy.parts.exclude(Set(part)).size()==0)0 else copy.history,retained:copy.body,retainedRef:copy.ref})}}
  action saveLocal = all {s.busy=="idle",copy.body!=0,keep,
    s'={...s,copies:s.copies.set(s.owner,{...copy,saved:copy.body,savedRef:copy.ref,savedId:copy.id,
      savedParts:copy.parts,savedHistory:copy.history,retained:0,retainedRef:0})}}
  action prepare = all {
    s.bound,s.owner==1,s.busy=="idle",not(s.record),not(s.retireUncertain),s.draftsAllowed,
    s.slot=="delete" or (copy.body!=0 and (copy.parts.size()==0 or s.forwardAllowed)),prepareCurrent,
    s'={...s,record:true,recordOwner:s.owner,busy:"prepare",effectDone:s.effectDone.set(s.slot,false),capturedOwner:s.owner,capturedEpoch:s.epoch,
      reviewAllowed:(s.slot=="create" or (if(s.slot=="delete")s.targetRef else copy.ref)==s.remoteRef) and
        (s.slot=="delete" or copy.parts.size()==0 or copy.history==s.sourceHistory),
      proposals:s.proposals.set(s.slot,{id:copy.id,body:copy.body,ref:if(s.slot=="delete")s.targetRef else copy.ref,
        parts:if(s.slot=="delete")Set() else copy.parts,history:copy.history,bytes:if(s.slot=="delete" or copy.parts.size()==0)0 else s.sourceBytes,forward:copy.forward})}
  }
  action reviewed(accepted:bool):bool = all {
    s.busy=="prepare",current,not(accepted) or s.reviewAllowed,
    if(accepted)reviewedCurrent else keep,s'={...s,busy:"idle"}
  }
  action cancelReview = all {phase.in(Set("review","preparing")),s.busy=="idle",cancelCurrent,s'={...s,record:false}}
  action reserve = all {canConfirm,reserveCurrent,s'={...s,busy:"commit",capturedOwner:s.owner,capturedEpoch:s.epoch}}
  action persisted = all {operation.phase=="committing",persistCurrent,s'={...s,busy:if(current)"dispatch" else s.busy}}
  action dispatched = all {s.busy=="dispatch",current,s.network.get(s.slot)==0,keep,
    s'={...s,busy:"reply",inFlight:s.inFlight.set(s.slot,true),flightEpoch:s.flightEpoch.set(s.slot,s.epoch),network:s.network.set(s.slot,1)}}
  /// Provider replacement is explicitly non-atomic; it uses bytes fixed by the prepared review.
  action effect = all {s.inFlight.get(s.slot),not(s.effectDone.get(s.slot)),s.slot=="delete" or s.remoteRef<3,keep,
    s'={...s,effectDone:s.effectDone.set(s.slot,true),lastEffect:s.slot,remoteRef:if(s.slot=="delete")0 else s.remoteRef+1,remoteBody:if(s.slot=="delete")0 else proposal.body,
      remoteParts:if(s.slot=="delete")Set() else proposal.parts,remoteBytes:if(s.slot=="delete")0 else proposal.bytes}}
  action reply(outcome:str):bool = all {s.inFlight.get(s.slot),current,s.flightEpoch.get(s.slot)==s.epoch,outcome!="succeeded" or s.effectDone.get(s.slot),replyCurrent(outcome),
    s'={...s,busy:"idle",inFlight:s.inFlight.set(s.slot,false),receipts:s.receipts.set(s.slot,if(outcome=="succeeded")s.remoteRef else 0)}}
  action lostReply = all {s.inFlight.get(s.slot),keep,s'={...s,busy:"idle",inFlight:s.inFlight.set(s.slot,false)}}
  action finishOld(slot:str):bool = all {slots.contains(slot),s.inFlight.get(slot),slot!=s.slot or s.flightEpoch.get(slot)!=s.epoch,keep,s'={...s,inFlight:s.inFlight.set(slot,false)}}
  action checkReceipt(agrees:bool):bool = all {phase.in(Set("dispatching","observed")),s.busy=="idle",not(agrees) or s.effectDone.get(s.slot),checkCurrent(agrees),
    s'={...s,receipts:s.receipts.set(s.slot,if(agrees)s.remoteRef else s.receipts.get(s.slot))}}
  action beginRead = all {s.busy=="idle",not(s.reading or s.saving or s.retiring),phase=="observed",operation.outcome=="succeeded",s.slot!="delete",keep,
    s'={...s,busy:"read",reading:true,capturedOwner:s.owner,capturedEpoch:s.epoch,readRef:s.receipts.get(s.slot),readMatches:s.remoteRef==s.receipts.get(s.slot)}}
  action readReply(owner:int,epoch:int,compatible:bool):bool = all {s.reading,keep,
    { val matches=current and s.readMatches and compatible and copy.id<3 and not(copy.body==0 and copy.retained!=0) and (copy.body==0 or (copy.body==proposal.body and copy.parts==proposal.parts and copy.history==proposal.history))
      val adoptedCopy={...copy,id:copy.id+1,body:proposal.body,ref:s.readRef,parts:proposal.parts,history:proposal.history,forward:proposal.forward}
      s'=if(owner!=s.capturedOwner or epoch!=s.capturedEpoch)s else if(matches){...s,busy:"save",reading:false,saving:true,pendingLocal:adoptedCopy,copies:s.copies.set(s.owner,adoptedCopy),
        trusted:s.trusted.set(s.owner,s.trusted.get(s.owner).union(Set(s.readRef)))} else {...s,busy:"idle",reading:false}
    }
  }
  action adopted(committed:bool,accepted:bool):bool = all {s.saving,not(accepted) or committed,keep,
    { val owner=s.capturedOwner
      val local=s.copies.get(owner)
      s'={...s,saving:false,busy:if(accepted and current)"retire" else "idle",retiring:accepted and current,nextSlot:"replace",
        copies:if(committed)s.copies.set(owner,{...local,saved:s.pendingLocal.body,savedRef:s.pendingLocal.ref,savedId:s.pendingLocal.id,
          savedParts:s.pendingLocal.parts,savedHistory:s.pendingLocal.history,retained:if(accepted and current)0 else local.retained,
          retainedRef:if(accepted and current)0 else local.retainedRef}) else s.copies}
    }
  }
  action beginDelete = all {s.busy=="idle",not(s.reading or s.saving or s.retiring),phase=="observed",operation.outcome=="succeeded",s.slot!="delete",keep,
    s'={...s,busy:"retire",retiring:true,capturedOwner:s.owner,capturedEpoch:s.epoch,nextSlot:"delete",targetRef:s.receipts.get(s.slot)}}
  action retired(committed:bool,accepted:bool):bool = all {s.retiring,not(accepted) or committed,keep,
    s'={...s,busy:"idle",retiring:false,record:if(committed)false else s.record,slot:if(committed)s.nextSlot else s.slot,
      retireUncertain:committed and not(accepted)}}
  action restart = all {s.epoch<3,restartCurrent,s'={...s,epoch:s.epoch+1,busy:"idle",retireUncertain:false,copies:s.copies.set(s.owner,{...copy,body:0,ref:0,parts:Set(),history:0})}}
  action restoreSaved = all {s.busy=="idle",copy.saved!=0,keep,s'={...s,copies:s.copies.set(s.owner,{...copy,
    id:copy.savedId,body:copy.saved,ref:copy.savedRef,parts:copy.savedParts,history:copy.savedHistory})}}
  action restoreRetained = all {s.busy=="idle",copy.retained!=0,keep,s'={...s,copies:s.copies.set(s.owner,{...copy,
    body:copy.retained,ref:copy.retainedRef,parts:Set(),history:0})}}
  action remoteEdit = all {s.remoteRef>0,s.remoteRef<3,keep,s'={...s,remoteRef:s.remoteRef+1,remoteBody:2}}
  action sourceEdit = all {s.sourceHistory<2,keep,s'={...s,sourceHistory:s.sourceHistory+1,sourceBytes:2}}
  action step = any {bind(1),bind(2),capabilities(true,true),capabilities(false,true),capabilities(true,false),newDraft(false),newDraft(true),
    edit,removePart(1),removePart(2),saveLocal,prepare,reviewed(true),reviewed(false),cancelReview,reserve,persisted,dispatched,effect,
    reply("succeeded"),reply("rejected"),lostReply,finishOld("create"),finishOld("replace"),finishOld("delete"),checkReceipt(true),checkReceipt(false),beginRead,readReply(s.capturedOwner,s.capturedEpoch,true),readReply(s.capturedOwner,s.capturedEpoch,false),readReply(1,0,true),
    adopted(true,true),adopted(true,false),adopted(false,false),beginDelete,retired(true,true),retired(true,false),retired(false,false),restart,restoreSaved,restoreRetained,remoteEdit,sourceEdit,all{keep,s'=s}}
  val EachRequestOnce=slots.forall(slot=>s.network.get(slot)<=1)
  val InFlightHasRequest=slots.forall(slot=>s.inFlight.get(slot) implies s.network.get(slot)==1)
  val DurableRequests=(s.network.get("create")>0 implies Create::s.dispatches==1) and
    (s.network.get("replace")>0 implies Replace::s.dispatches==1) and (s.network.get("delete")>0 implies Delete::s.dispatches==1)
  val VerifiedReferences=Set(1,2).forall(owner=>{val c=s.copies.get(owner)
    (c.ref==0 or s.trusted.get(owner).contains(c.ref)) and (c.savedRef==0 or s.trusted.get(owner).contains(c.savedRef)) and (c.retainedRef==0 or s.trusted.get(owner).contains(c.retainedRef))})
  val ProviderBytesReviewed=s.lastEffect=="none" or (s.remoteBytes==s.proposals.get(s.lastEffect).bytes and s.remoteParts==s.proposals.get(s.lastEffect).parts)
  val ReviewBeforeConfirm=canConfirm implies composerMatches and s.draftsAllowed and (proposal.parts.size()==0 or s.forwardAllowed)
  val TypeOK=s.owner.in(Set(1,2)) and s.epoch.in(0.to(3)) and s.slot.in(slots) and
    s.busy.in(Set("idle","prepare","commit","dispatch","reply","read","save","retire")) and s.remoteRef.in(0.to(3)) and s.copies.keys()==Set(1,2)
  val safety=Create::safety and Replace::safety and Delete::safety and EachRequestOnce and InFlightHasRequest and DurableRequests and VerifiedReferences and ProviderBytesReviewed and ReviewBeforeConfirm and TypeOK
  run createAndAdoptTest=init.then(bind(1)).then(newDraft(false)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(readReply(1,0,true)).then(adopted(true,true)).then(retired(true,true)).expect(copy.savedRef==1 and phase=="empty" and safety)
  run changedRemoteRefusesAdoptionTest=init.then(bind(1)).then(newDraft(false)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(remoteEdit).then(beginRead).then(readReply(1,0,true)).expect(copy.ref==0 and s.busy=="idle" and safety)
  run permissionLossDisablesForwardReviewTest=init.then(bind(1)).then(newDraft(true)).then(prepare).then(reviewed(true)).then(capabilities(true,false))
    .expect(not(canConfirm) and safety).then(reserve.fail())
  run unknownDoesNotRepeatTest=init.then(bind(1)).then(newDraft(false)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(lostReply)
    .then(restart).expect(requests==1 and safety).then(reserve.fail())
  run threeReviewedOperationsTest=init.then(bind(1)).then(newDraft(false)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(readReply(1,0,true)).then(adopted(true,true)).then(retired(true,true)).then(edit)
    .then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginDelete).then(retired(true,true)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .expect(requests==3 and copy.saved==1 and s.remoteRef==0 and safety)
  run retiredReadCannotAdoptTest=init.then(bind(1)).then(newDraft(false)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(bind(2)).then(readReply(1,0,true)).expect(copy.savedRef==0 and firstCopy.savedRef==0 and safety)
  run failedLocalSaveKeepsReceiptTest=init.then(bind(1)).then(newDraft(false)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(readReply(1,0,true)).then(adopted(true,false)).expect(phase=="observed" and copy.savedRef==1 and safety)
  run unknownReceiptRetirementNeedsReloadTest=init.then(bind(1)).then(newDraft(false)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(readReply(1,0,true)).then(adopted(true,true)).then(retired(true,false)).expect(s.retireUncertain and safety).then(prepare.fail())
  run changedForwardPartsRefuseAdoptionTest=init.then(bind(1)).then(newDraft(true)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(removePart(2)).then(readReply(1,0,true)).expect(copy.ref==0 and copy.parts==Set(1) and safety)
  run preparedForwardKeepsReviewedBytesTest=init.then(bind(1)).then(newDraft(true)).then(prepare).then(sourceEdit).then(reviewed(true))
    .then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded")).expect(s.remoteBytes==1 and s.sourceBytes==2 and safety)
  run changedSourceRequiresFreshReviewTest=init.then(bind(1)).then(newDraft(true)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(readReply(1,0,true)).then(adopted(true,true)).then(retired(true,true)).then(sourceEdit).then(prepare).then(reviewed(false))
    .expect(phase=="preparing" and requests==1 and safety).then(reserve.fail())
  run nonAtomicReplacementUsesReviewedSnapshotTest=init.then(bind(1)).then(newDraft(false)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(readReply(1,0,true)).then(adopted(true,true)).then(retired(true,true)).then(prepare).then(reviewed(true)).then(remoteEdit)
    .then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded")).expect(requests==2 and s.remoteRef==3 and safety)
  run retainedForwardHasNoOriginalPartsTest=init.then(bind(1)).then(newDraft(true)).then(prepare).then(reviewed(true)).then(reserve).then(persisted).then(dispatched).then(effect).then(reply("succeeded"))
    .then(beginRead).then(readReply(1,0,true)).then(adopted(true,true)).then(retired(true,true)).then(edit).then(restart).then(restoreRetained)
    .expect(copy.body==2 and copy.parts==Set() and copy.savedParts==Set(1,2) and safety)
}
