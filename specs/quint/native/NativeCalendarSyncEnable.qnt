// Native Calendar consent activation and pause, with exact journal CAS read positions.
module NativeCalendarSyncEnable {
  type State = {epoch: int, lease: bool, leaseEpoch: int, dialog: bool, prepareResult: str,
    enableResult: str, pauseResult: str, statusResult: str, durable: str, writes: List[str],
    compareAttempts: int, pauseRefusals: int, held: str, heldExpected: str, claimedEpoch: int,
    enabledEpoch: int, cloudWriteAllowed: bool, deletionAllowed: bool}
  var s: State

  action init = s'={epoch:0,lease:false,leaseEpoch:-1,dialog:false,prepareResult:"none",enableResult:"none",
    pauseResult:"none",statusResult:"none",durable:"absent",writes:List(),compareAttempts:0,pauseRefusals:0,
    held:"none",heldExpected:"none",claimedEpoch:-1,enabledEpoch:-1,cloudWriteAllowed:false,deletionAllowed:false}

  pure def persist(st: State, durable: str, generation: int): State = {
    val admits=durable=="enabled"
    {...st,durable:durable,writes:st.writes.append(durable),
      enabledEpoch:if (admits) generation else -1,cloudWriteAllowed:admits,deletionAllowed:admits}
  }

  action seedDisabled = all {
    s.durable=="absent",s.prepareResult=="none",s.held=="none",s.writes==List(),
    s'={...s,durable:"paused"}
  }
  action prepare = all {
    not(s.dialog),s.held=="none",s.enableResult!="pending",
    s'={...s,lease:true,leaseEpoch:s.epoch,prepareResult:"ready"}
  }
  action queueEnable = all {
    s.lease,not(s.dialog),s.held=="none",s.enableResult!="pending",
    s'={...s,enableResult:"pending"}
  }
  action show = all {
    s.lease,not(s.dialog),s.enableResult=="pending",s.held=="none",
    s'={...s,dialog:true}
  }
  action holdEnable(position: str): bool = all {
    position.in(Set("before","after")),s.dialog,s.held=="none",s.lease,s.enableResult=="pending",
    s'={...s,held:position,claimedEpoch:s.leaseEpoch,heldExpected:if (position=="after") s.durable else "none"}
  }
  action setPauseRefusals(count: int): bool = all {
    count.in(Set(0,2,8)),s'={...s,pauseRefusals:count}
  }
  action pause = all {
    s.epoch<3,s.compareAttempts<=24,
    // The scope contains a completed consent, or consent whose positive click is already owned.
    s.enableResult!="pending" or s.held!="none",
    val exhausted=s.pauseRefusals==8
    val retired={...s,epoch:s.epoch+1,lease:false,leaseEpoch:-1,dialog:false,pauseRefusals:0,
      compareAttempts:s.compareAttempts+s.pauseRefusals+(if (exhausted) 0 else 1),
      pauseResult:if (exhausted) "unavailable" else "paused"}
    s'=if (exhausted) retired else persist(retired,"paused",-1)
  }
  action finishEnable = all {
    s.held!="none",s.compareAttempts<33,
    val current=s.lease and s.claimedEpoch==s.epoch
    val exactCas=s.held=="before" or s.heldExpected==s.durable
    val completed={...s,dialog:false,held:"none",heldExpected:"none",claimedEpoch:-1,
      compareAttempts:s.compareAttempts+(if (current) 1 else 0),enableResult:if (current and exactCas) "ready" else "context-changed"}
    s'=if (current and exactCas) persist(completed,"enabled",s.claimedEpoch) else completed
  }
  action readStatus = all {
    s.prepareResult=="ready",s.held=="none",
    s'={...s,statusResult:if (s.lease) "ready" else "context-changed"}
  }

  val LeaseOwnsEpoch = if (s.lease) s.leaseEpoch==s.epoch else s.leaseEpoch == -1
  val HeldOwnsPendingReply = if (s.held=="none") s.claimedEpoch == -1 and s.heldExpected=="none"
    else s.claimedEpoch>=0 and s.claimedEpoch<=s.epoch and s.enableResult=="pending"
  val BothGatesUseCommittedConsent = s.cloudWriteAllowed==(s.durable=="enabled") and
    s.deletionAllowed==(s.durable=="enabled")
  val CommittedConsentHasOwner = (s.durable=="enabled")== (s.enabledEpoch>=0)
  val PausedConsentNotResurrected = s.pauseResult!="paused" or s.durable!="enabled" or s.enabledEpoch==s.epoch
  val safety = all {LeaseOwnsEpoch,HeldOwnsPendingReply,BothGatesUseCommittedConsent,CommittedConsentHasOwner,PausedConsentNotResurrected}
  action step = any {
    seedDisabled,prepare,queueEnable,show,{nondet p=Set("before","after").oneOf();holdEnable(p)},
    {nondet count=Set(0,2,8).oneOf();setPauseRefusals(count)},pause,finishEnable,readStatus,s'=s
  }

  run currentEnablePersistsExactConsentTest = init.then(prepare).then(queueEnable).then(show)
    .then(holdEnable("before")).then(finishEnable).expect(s.enableResult=="ready" and s.cloudWriteAllowed and s.deletionAllowed)
  run pauseAfterCommittedEnableRevokesTest = init.then(prepare).then(queueEnable).then(show)
    .then(holdEnable("before")).then(finishEnable).then(pause)
    .expect(s.pauseResult=="paused" and not(s.lease or s.cloudWriteAllowed or s.deletionAllowed))
  run pauseBeforeReadRetiresOldEnableTest = init.then(prepare).then(queueEnable).then(show)
    .then(holdEnable("before")).then(pause).then(finishEnable)
    .expect(PausedConsentNotResurrected and s.enableResult=="context-changed" and not(s.cloudWriteAllowed or s.deletionAllowed))
  run pauseRetiresEnableWithSameDisabledBytesTest = init.then(seedDisabled).then(prepare).then(queueEnable).then(show)
    .then(holdEnable("after")).then(pause).then(finishEnable)
    .expect(PausedConsentNotResurrected and s.writes==List("paused") and s.compareAttempts==1)
  run changedCasSnapshotAlsoRetiresOldEnableTest = init.then(prepare).then(queueEnable).then(show)
    .then(holdEnable("after")).then(pause).then(finishEnable)
    .expect(s.durable=="paused" and s.enableResult=="context-changed")
  run pauseRetriesExactCasTest = init.then(prepare).then(setPauseRefusals(2)).then(pause)
    .expect(s.pauseResult=="paused" and s.compareAttempts==3 and s.writes==List("paused"))
  run pauseCasExhaustionIsUnavailableTest = init.then(prepare).then(setPauseRefusals(8)).then(pause)
    .expect(s.pauseResult=="unavailable" and not(s.lease) and s.durable=="absent" and s.compareAttempts==8)
  run freshExplicitReviewCanEnableAfterPauseTest = init.then(prepare).then(queueEnable).then(show)
    .then(holdEnable("before")).then(pause).then(finishEnable).then(prepare).then(queueEnable).then(show)
    .then(holdEnable("before")).then(finishEnable)
    .expect(PausedConsentNotResurrected and s.writes==List("paused","enabled") and s.enabledEpoch==1)
  run pauseCasExhaustionRetainsPriorConsentTest = init.then(prepare).then(queueEnable).then(show)
    .then(holdEnable("before")).then(finishEnable).then(setPauseRefusals(8)).then(pause)
    .expect(s.pauseResult=="unavailable" and not(s.lease) and s.durable=="enabled" and s.compareAttempts==9)
}
