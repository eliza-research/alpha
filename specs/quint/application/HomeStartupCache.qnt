/// Browser Home presentation before provider revalidation. Cached cards authorize no effects.
module HomeStartupCache {
  type State = {
    owner: int, scope: int, active: bool, today: bool, stored: bool,
    epoch: int, queued: bool, queuedEpoch: int
  }
  var s: State
  action init = s' = {owner: 0, scope: 0, active: true, today: true,
    stored: true, epoch: 0, queued: false, queuedEpoch: 0}
  val visible = s.stored and s.active and s.today and s.owner <= 0 and s.scope <= 0
  action beforeConnection = s' = {...s, owner: -1, scope: -1}
  action otherOwner = s' = {...s, owner: 1}
  action otherScope = s' = {...s, scope: 1}
  action retire = s' = {...s, active: false}
  action nextDay = s' = {...s, today: false}
  action queueWrite = all {not(s.queued), s' = {...s, queued: true, queuedEpoch: s.epoch}}
  action clearStored = all {s.epoch < 3, s' = {...s, stored: false, epoch: s.epoch + 1}}
  action finishWrite = all {
    s.queued,
    s' = {...s, queued: false, stored: s.stored or
      (s.queuedEpoch == s.epoch and s.active and s.owner == 0 and s.scope == 0)}
  }
  action step = any {beforeConnection, otherOwner, otherScope, retire, nextDay,
    queueWrite, clearStored, finishWrite, s' = s}
  val safety = visible implies (s.active and s.today and s.owner <= 0 and s.scope <= 0)
  run immediateRestore = init.expect(visible and safety)
  run providerPendingKeepsSavedRow = init.then(beforeConnection).expect(visible and safety)
  run accountChangeHides = init.then(otherOwner).expect(not(visible) and safety)
  run agentChangeHides = init.then(otherScope).expect(not(visible) and safety)
  run signOutHides = init.then(retire).expect(not(visible) and safety)
  run tomorrowHidesOldLabels = init.then(nextDay).expect(not(visible) and safety)
  run pendingWriteCannotUndoClear = init.then(queueWrite).then(clearStored).then(finishWrite).expect(not(visible) and not(s.stored) and safety)
}
