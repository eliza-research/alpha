// Calendar confirmation UI and receipt-backed deletion projection.
// Scope: one event, two owners, two provider revisions; no provider I/O model.
module CalendarActionReview {
  var owner: int
  var pending: str
  var pendingOwner: int
  var writes: int
  var visible: int
  var deleted: int
  action init = all {owner'=1,pending'="",pendingOwner'=0,writes'=0,visible'=1,deleted'=0}
  action request(kind: str): bool = all {
    pending=="", Set("save","delete").contains(kind), visible>0,
    pending'=kind,pendingOwner'=owner,owner'=owner,writes'=writes,visible'=visible,deleted'=deleted
  }
  action cancel = all {pending!="",pending'="",pendingOwner'=0,owner'=owner,writes'=writes,visible'=visible,deleted'=deleted}
  action changeOwner = all {owner'=3-owner,pending'="",pendingOwner'=0,writes'=writes,visible'=1,deleted'=0}
  // The real handler checks the captured owner/form again after confirmation.
  action confirm = all {
    pending!="",pendingOwner==owner,writes<3,
    writes'=writes+1,owner'=owner,pending'="",pendingOwner'=0,
    deleted'=if(pending=="delete") visible else deleted,
    visible'=if(pending=="delete") 0 else visible
  }
  // Only a confirmed delete receipt establishes the excluded revision.
  action read(version: int): bool = all {
    Set(1,2).contains(version),owner'=owner,pending'=pending,pendingOwner'=pendingOwner,writes'=writes,deleted'=deleted,
    visible'=if(version==deleted) 0 else version
  }
  action step = any {request("save"),request("delete"),cancel,confirm,changeOwner,read(1),read(2)}
  val safety = (pending=="" or pendingOwner==owner) and (deleted==0 or visible!=deleted) and writes<=3
  run cancelDoesNotWriteTest = init.then(request("save")).then(cancel).expect(writes==0 and visible==1 and safety)
  run confirmOnceTest = init.then(request("save")).then(confirm).expect(writes==1 and pending=="" and safety)
  run ownerChangeCancelsTest = init.then(request("delete")).then(changeOwner).expect(writes==0 and pending=="" and safety)
  run staleReadCannotRestoreDeletedTest = init.then(request("delete")).then(confirm).then(read(1)).expect(visible==0 and safety)
  run restoredRevisionIsVisibleTest = init.then(request("delete")).then(confirm).then(read(2)).expect(visible==2 and safety)
}
