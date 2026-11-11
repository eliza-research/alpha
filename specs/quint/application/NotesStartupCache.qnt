/// Read-only saved-list presentation, fenced by account, agent, and restore generation.
module NotesStartupCache {
  type State = {
    owner: int, agent: int, active: bool, generation: int,
    pending: bool, requestedGeneration: int,
    savedOwner: int, savedAgent: int, visibleOwner: int, visibleAgent: int,
    writesAuthorized: bool, storedRevision: int, lastStoredRevision: int, pendingWrite: int
  }
  var s: State
  action init = s' = {
    owner: 0, agent: 0, active: true, generation: 0,
    pending: false, requestedGeneration: 0,
    savedOwner: 0, savedAgent: 0, visibleOwner: -1, visibleAgent: -1,
    writesAuthorized: false, storedRevision: 0, lastStoredRevision: 0, pendingWrite: -1
  }
  val visible = s.active and s.visibleOwner == s.owner and s.visibleAgent == s.agent
  action startRestore = all {
    s.active, s.generation < 3,
    s' = {...s, generation: s.generation + 1, requestedGeneration: s.generation + 1, pending: true}
  }
  action finishRestore = all {
    s.pending,
    s' = if (s.active and s.generation == s.requestedGeneration and s.savedOwner == s.owner and s.savedAgent == s.agent)
      {...s, pending: false, visibleOwner: s.savedOwner, visibleAgent: s.savedAgent}
      else {...s, pending: false}
  }
  action acceptFresh = all {
    s.active, s.generation < 3,
    s' = {...s, generation: s.generation + 1, savedOwner: s.owner, savedAgent: s.agent, visibleOwner: s.owner, visibleAgent: s.agent}
  }
  action changeOwner = s' = {...s, owner: 1 - s.owner}
  action changeAgent = s' = {...s, agent: 1 - s.agent}
  action retire = s' = {...s, active: false}
  action queueOlderWrite = s' = {...s, pendingWrite: 1}
  action newerTabWrite = all { s.storedRevision < 2, s' = {...s, lastStoredRevision: s.storedRevision, storedRevision: 2} }
  action finishWrite = all {
    s.pendingWrite >= 0,
    s' = {...s, lastStoredRevision: s.storedRevision,
      storedRevision: if (s.pendingWrite >= s.storedRevision) s.pendingWrite else s.storedRevision, pendingWrite: -1}
  }
  action step = any { startRestore, finishRestore, acceptFresh, changeOwner, changeAgent, retire, queueOlderWrite, newerTabWrite, finishWrite, s' = s }
  val safety = not(s.writesAuthorized) and s.generation >= 0 and s.generation <= 3 and s.storedRevision >= s.lastStoredRevision
  run delayedWriterCannotReplaceNewer = init.then(queueOlderWrite).then(newerTabWrite).then(finishWrite).expect(s.storedRevision == 2 and safety)
  run restoresSavedRows = init.then(startRestore).then(finishRestore).expect(visible and safety)
  run accountChangeHidesRows = init.then(startRestore).then(finishRestore).then(changeOwner).expect(not(visible) and safety)
  run agentChangeRejectsRead = init.then(startRestore).then(changeAgent).then(finishRestore).expect(not(visible) and safety)
  run retireRejectsRead = init.then(startRestore).then(retire).then(finishRestore).expect(not(visible) and safety)
  run freshReadInvalidatesOlderRestore = init.then(startRestore).then(acceptFresh).then(finishRestore).expect(visible and s.generation > s.requestedGeneration and safety)
}
