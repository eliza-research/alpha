/// Current shared LinkedCalendarReconciler plus reviewed controller admission.
module CalendarLinkedSync {
  type State = {
    state: str, pending: str, phase: str, local: int, remote: int, common: int,
    knownProvider: bool, localDeleted: bool, remoteDeleted: bool,
    revision: int, checkpointRevision: int, etag: int, checkpointEtag: int,
    writes: int, localWrites: int, outcome: str, recovery: bool,
    epoch: int, reviewedEpoch: int, reviewedRevision: int, reviewed: bool, enabled: bool
  }
  var s: State
  action initFor(state: str, pending: str, local: int, remote: int, common: int,
    known: bool, deleted: bool, remoteDeleted: bool, etag: int, checkpointEtag: int): bool =
    s' = {state: state, pending: pending, phase: "idle", local: local, remote: remote, common: common,
      knownProvider: known, localDeleted: deleted, remoteDeleted: remoteDeleted,
      revision: 1, checkpointRevision: 1, etag: etag, checkpointEtag: checkpointEtag,
      writes: 0, localWrites: 0, outcome: "none", recovery: false,
      epoch: 0, reviewedEpoch: 0, reviewedRevision: 0, reviewed: false, enabled: true}
  action init = initFor("dirty","create",1,0,0,false,false,false,0,0)
  action reviewSync = s' = {...s, reviewed: true, reviewedEpoch: s.epoch, reviewedRevision: s.revision}
  action enable = all { s.reviewed, s.reviewedEpoch == s.epoch, s.reviewedRevision == s.revision,
    s' = {...s, enabled: true, reviewed: false} }
  action pause = s' = {...s, enabled: false}
  action switchOwner = all { s.epoch < 2, s' = {...s, epoch: s.epoch + 1, enabled: false, reviewed: false} }
  action localEdit = all { s.revision < 2, s' = {...s, local: 2, revision: s.revision + 1} }
  action remoteEdit(value: int, etag: int): bool = all { value.in(0.to(3)), etag.in(0.to(2)),
    s' = {...s, remote: value, etag: etag} }
  action begin = all {s.enabled, s.phase == "idle", s.state.in(Set("clean","dirty")), s' = {...s, phase: "read", outcome: "none", recovery: false}}
  action blocked = all {s.phase == "idle", s.state.in(Set("paused","local_only","quarantined","conflicted")),
    s' = {...s, outcome: if(s.state == "local_only")"paused" else s.state}}
  val concurrent = s.remote != 0 and s.local != s.common and s.remote != s.common and s.local != s.remote
  action analyzed = all {
    s.phase == "read",
    if(s.local == 0)
      if(s.pending == "delete") s' = {...s, phase: "push"}
      else s' = {...s, phase: "idle", state: "quarantined", outcome: "quarantined"}
    else if(concurrent) s' = {...s, phase: "idle", state: "conflicted", pending: "none", outcome: "conflicted"}
    else if(s.remote != 0 and s.remote != s.common and s.local == s.common)
      s' = {...s, phase: if(s.remoteDeleted) "pull-delete" else "pull"}
    else if(s.remote == 0 and s.knownProvider and s.local == s.common) s' = {...s, phase: "pull-delete"}
    else if(s.remote == 0 or s.local != s.remote) s' = {...s, phase: "push"}
    else s' = {...s, phase: "idle", state: "clean", pending: "none", common: s.local,
      checkpointRevision: s.revision, checkpointEtag: s.etag, knownProvider: true, outcome: "clean"}
  }
  action stage = all {s.phase == "push", s' = {...s, phase: "staged", state: "dirty",
    pending: if(s.local == 0 or s.localDeleted)"delete" else if(s.remote == 0)"create" else "update",
    checkpointRevision: s.revision}}
  action dispatch = all {s.phase == "staged", s.writes < 2, s' = {...s, phase: "dispatch", writes: s.writes + 1}}
  /// Side-effect observation is separate from the returned status and durable checkpoint.
  action providerResult(status: str, effected: bool): bool = all {
    s.phase == "dispatch", status.in(Set("succeeded","unknown","not_accepted","precondition_failed")),
    (status == "succeeded") implies effected,
    status.in(Set("not_accepted","precondition_failed")) implies not(effected),
    { val deleted = s.pending == "delete"
      val nextRemote = if(effected) {if(deleted)0 else s.local} else s.remote
      s' = {...s, phase: "idle", remote: nextRemote, etag: if(effected) {if(deleted)0 else 2} else s.etag,
        knownProvider: s.knownProvider or (status == "succeeded" and not(deleted)),
        state: if(status == "succeeded") {if(s.local == 0)"paused" else "clean"}
          else if(status == "unknown")"quarantined" else if(status == "not_accepted")"dirty" else "conflicted",
        pending: if(status.in(Set("succeeded","precondition_failed")))"none" else s.pending,
        common: if(status == "succeeded" and s.local != 0)s.local else s.common,
        checkpointEtag: if(status == "succeeded") {if(deleted)0 else 2} else s.checkpointEtag,
        outcome: if(status == "succeeded")"pushed" else if(status == "unknown")"quarantined" else if(status == "not_accepted")"dirty" else "conflicted"}
    }
  }
  /// Cancellation can prevent the checkpoint even when an already sent provider request applied.
  action abandonedWrite(effected: bool): bool = all {s.phase == "dispatch",
    s' = {...s, phase: "idle", remote: if(effected){if(s.pending == "delete")0 else s.local}else s.remote,
      etag: if(effected){if(s.pending == "delete")0 else 2}else s.etag, outcome: "unknown"}}
  action pullResult(accepted: bool): bool = all {s.phase.in(Set("pull","pull-delete")), s.revision < 2,
    { val deleted = s.phase == "pull-delete"
      s' = {...s, phase: "idle", state: if(accepted){if(deleted)"paused" else "clean"}else"quarantined",
        pending: if(accepted)"none" else s.pending, local: if(accepted){if(deleted)0 else s.remote}else s.local,
        revision: if(accepted and not(deleted))s.revision+1 else s.revision,
        checkpointRevision: if(accepted and not(deleted))s.revision+1 else s.checkpointRevision,
        knownProvider: s.knownProvider or (accepted and s.remote != 0),
        checkpointEtag: if(accepted)s.etag else s.checkpointEtag,
        common: if(accepted and s.remote != 0)s.remote else s.common,
        localWrites: s.localWrites + (if(accepted)1 else 0), outcome: if(accepted)"pulled" else "quarantined"}
    }
  }
  action beginRecovery = all {s.phase == "idle", s' = {...s, phase: "recover", recovery: false}}
  val recoverable = if(s.pending == "delete") s.knownProvider and s.remote == 0 and (s.local == 0 or s.localDeleted)
    else s.local != 0 and s.remote != 0 and not(s.localDeleted or s.remoteDeleted) and s.local == s.remote and
      (s.pending != "update" or (s.checkpointEtag != 0 and s.etag != 0 and s.checkpointEtag != s.etag))
  action recoveryReply = all {s.phase == "recover",
    s' = if(recoverable){...s, phase: "idle", recovery: true, state: if(s.pending == "delete")"paused"else"clean",
      common: if(s.pending == "delete")s.common else s.remote, pending: "none", checkpointEtag: s.etag,
      checkpointRevision: s.revision, knownProvider: true}
    else {...s, phase: "idle", recovery: false}}
  action restart = s' = {...s, phase: "idle", reviewed: false}
  action step = any {begin,blocked,analyzed,stage,dispatch,providerResult("succeeded",true),
    providerResult("unknown",false),providerResult("unknown",true),providerResult("not_accepted",false),providerResult("precondition_failed",false),
    abandonedWrite(true),abandonedWrite(false),pullResult(true),pullResult(false),beginRecovery,recoveryReply,remoteEdit(0,0),remoteEdit(1,1),remoteEdit(2,2),remoteEdit(3,2),
    localEdit,reviewSync,enable,pause,switchOwner,restart,s'=s}
  val DurableMutation = s.phase == "dispatch" implies s.state == "dirty" and s.pending != "none"
  val SettledCheckpoint = s.state.in(Set("clean","paused","conflicted","local_only")) implies s.pending == "none"
  val Bounded = s.writes.in(0.to(2)) and s.epoch.in(0.to(2)) and s.local.in(0.to(3)) and s.remote.in(0.to(3))
  val TypeOK = s.state.in(Set("clean","dirty","paused","local_only","conflicted","quarantined")) and
    s.phase.in(Set("idle","read","push","staged","dispatch","pull","pull-delete","recover")) and s.pending.in(Set("none","create","update","delete"))
  /// A standing review belongs to the current owner and never to a later local revision.
  val ReviewOwnerBound = s.reviewed implies s.reviewedEpoch == s.epoch and s.reviewedRevision <= s.revision
  val safety = TypeOK and Bounded and DurableMutation and SettledCheckpoint and ReviewOwnerBound
  val QuarantinedWriteWitness = s.state == "quarantined" and s.writes == 1 and s.remote == s.local
  val StaleReviewWitness = s.reviewed and s.reviewedRevision < s.revision and not(s.enabled)
  val RecoveredWitness = s.recovery and s.state == "clean"
  run createTest = init.then(begin).then(analyzed).then(stage).then(dispatch).then(providerResult("succeeded",true)).expect(s.state=="clean" and safety)
  run unknownCreateRecoveryTest = init.then(begin).then(analyzed).then(stage).then(dispatch).then(providerResult("unknown",true))
    .then(blocked).expect(s.writes==1).then(beginRecovery).then(recoveryReply).expect(s.recovery and s.state=="clean" and safety)
  run absentUnknownStaysQuarantinedTest = init.then(begin).then(analyzed).then(stage).then(dispatch).then(providerResult("unknown",false))
    .then(beginRecovery).then(recoveryReply).expect(not(s.recovery) and s.state=="quarantined" and safety)
  run conditionalUpdateConflictTest = initFor("clean","none",2,1,1,true,false,false,1,1).then(begin).then(analyzed).then(stage).then(dispatch)
    .then(providerResult("precondition_failed",false)).expect(s.state=="conflicted" and safety)
  run concurrentEditsTest = initFor("clean","none",2,3,1,true,false,false,2,1).then(begin).then(analyzed).expect(s.state=="conflicted" and s.writes==0 and safety)
  run providerPullTest = initFor("clean","none",1,2,1,true,false,false,2,1).then(begin).then(analyzed).then(pullResult(true)).expect(s.local==2 and s.localWrites==1 and safety)
  run localCasRefusedTest = initFor("clean","none",1,2,1,true,false,false,2,1).then(begin).then(analyzed).then(pullResult(false)).expect(s.local==1 and s.state=="quarantined" and safety)
  run missingProviderDeletesLocalTest = initFor("clean","none",1,0,1,true,false,false,0,1).then(begin).then(analyzed).then(pullResult(true)).expect(s.local==0 and s.state=="paused" and safety)
  run notAcceptedKeepsPendingTest = init.then(begin).then(analyzed).then(stage).then(dispatch).then(providerResult("not_accepted",false)).expect(s.state=="dirty" and s.pending=="create" and safety)
  run unchangedEtagCannotRecoverTest = initFor("quarantined","update",2,2,1,true,false,false,1,1).then(beginRecovery).then(recoveryReply).expect(not(s.recovery) and safety)
  run discoveredProviderBecomesLinkedTest = initFor("dirty","create",1,1,0,false,false,false,1,0).then(begin).then(analyzed)
    .expect(s.knownProvider).then(remoteEdit(0,0)).then(begin).then(analyzed).then(pullResult(true)).expect(s.state=="paused" and safety)
  run pausedInFlightPreservesPendingTest = init.then(begin).then(analyzed).then(stage).then(dispatch).then(pause).then(abandonedWrite(true))
    .expect(s.state=="dirty" and s.pending=="create" and not(s.knownProvider)).then(reviewSync).then(enable).then(begin).then(analyzed)
    .expect(s.state=="clean" and s.writes==1 and safety)
  /// A review made for one owner cannot enable sync for the next.
  run reviewRetiredByOwnerSwitchTest = init.then(pause).then(reviewSync).then(switchOwner).expect(not(s.reviewed) and safety)
    .then(enable.fail())
  run freshReviewRequiredTest = init.then(pause).then(reviewSync).then(localEdit).expect(not(s.enabled)).then(reviewSync).then(enable).expect(s.enabled and safety)
}
