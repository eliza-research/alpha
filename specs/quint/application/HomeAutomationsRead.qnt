// Read-only Home preload. Workflows actions and request settlement remain separate.
module HomeAutomationsRead {
  var owner: int
  var atHome: bool
  var suspended: bool
  var reading: int
  var shownOwner: int
  var rows: int
  action init=all{owner'=1,atHome'=true,suspended'=false,reading'=0,shownOwner'=0,rows'=0}
  action start=all{atHome,not(suspended),reading==0,reading'=owner,owner'=owner,atHome'=atHome,suspended'=suspended,shownOwner'=shownOwner,rows'=rows}
  action finish(count:int):bool=all{reading!=0,count.in(0.to(2)),reading'=0,owner'=owner,atHome'=atHome,suspended'=suspended,shownOwner'=if(atHome and not(suspended) and reading==owner) owner else shownOwner,rows'=if(atHome and not(suspended) and reading==owner) count else rows}
  // Restoring a local snapshot is read-only and must match the current owner.
  action restore(savedOwner:int,count:int):bool=all{atHome,not(suspended),savedOwner==owner,count.in(0.to(2)),shownOwner'=savedOwner,rows'=count,owner'=owner,atHome'=atHome,suspended'=suspended,reading'=reading}
  action leave=all{owner'=owner,atHome'=false,suspended'=suspended,reading'=0,shownOwner'=shownOwner,rows'=rows}
  action enter=all{owner'=owner,atHome'=true,suspended'=suspended,reading'=reading,shownOwner'=shownOwner,rows'=rows}
  action changeOwner=all{owner'=3-owner,atHome'=atHome,suspended'=suspended,reading'=0,shownOwner'=0,rows'=0}
  action suspend=all{owner'=owner,atHome'=atHome,suspended'=true,reading'=0,shownOwner'=0,rows'=0}
  action resume=all{owner'=owner,atHome'=atHome,suspended'=false,reading'=reading,shownOwner'=shownOwner,rows'=rows}
  action step=any{start,{nondet cachedOwner=1.to(2).oneOf();nondet count=0.to(2).oneOf();restore(cachedOwner,count)},leave,enter,changeOwner,suspend,resume,{nondet count=0.to(2).oneOf();finish(count)}}
  val safety=(rows>0 implies shownOwner==owner) and (suspended implies reading==0)
  run savedHomeBeforeNetworkTest=init.then(restore(1,1)).expect(rows==1 and reading==0 and safety)
  run homeLoadsWithoutOpeningWorkflowsTest=init.then(start).then(finish(1)).expect(rows==1 and atHome and safety)
  run ownerChangeClearsRowsTest=init.then(start).then(finish(1)).then(changeOwner).expect(rows==0 and safety)
  run leavingAbortsReadTest=init.then(start).then(leave).expect(reading==0 and rows==0 and safety)
}
