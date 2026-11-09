// Native worker admission, encrypted cursor, synthetic WorkManager commands and notice custody.
module NativeGmailBackground {
  type State = {latestGeneration: int, credential: int, remoteOwner: int, grants: int, reset: bool,
    allowed: bool, observable: bool, locked: bool, phase: str, generation: int, grant: int,
    owner: int, boundCredential: int, cursor: int, continuation: int, incomplete: bool,
    checked: bool, notice: str, tap: str, visible: bool, posts: int, periodic: int,
    catchup: int, schedules: int, cancels: int, attempt: int, admitted: int, configuring: int,
    configOwner: int, configCredential: int, configAttempt: int, configGrantVerified: bool, configQueued: bool,
    workGeneration: int, workEpoch: int, workReply: str, bridgeReply: str, historyReads: int, process: int,
    pendingGrant: int, online: bool, tapAuthorityReads: int, retiredBridge: bool, refusalAttempt: int, consumeGeneration: int, consumeEpoch: int, consumeCurrent: bool}
  var s: State

  val owners = Set(1,2)
  val selections = Set(1,2,3)
  val credentialClasses = Set(0,1,2,3)
  val jobGenerations = Set(0,1,2,3,4)
  val scripts = Set("none","baseline","continued","final","notify","reset","retry","unsupported","forbidden","malformed")
  val faults = Set("none","before","after")
  val tapMethods = Set("pending","consume","release")
  val liveNotices = Set("posted","uncertain")

  action init: bool = s'={
    latestGeneration:0,credential:1,remoteOwner:1,grants:7,reset:false,allowed:true,observable:true,locked:false,
    phase:"disabled",generation:0,grant:0,owner:0,boundCredential:0,cursor:0,continuation:0,incomplete:false,
    checked:false,notice:"none",tap:"none",visible:false,posts:0,periodic:0,catchup:0,schedules:0,cancels:0,
    attempt:0,admitted:0,configuring:0,configOwner:0,configCredential:0,configAttempt:0,configGrantVerified:false,configQueued:false,
    workGeneration:0,workEpoch:0,workReply:"none",bridgeReply:"none",historyReads:0,process:1,
    pendingGrant:0,online:true,tapAuthorityReads:0,retiredBridge:false,refusalAttempt:0,consumeGeneration:0,consumeEpoch:0,consumeCurrent:false
  }

  pure def grantAllowed(grants: int, grant: int): bool =
    if (grant==1) grants.in(Set(1,3,5,7))
    else if (grant==2) grants.in(Set(2,3,6,7))
    else grant==3 and grants.in(Set(4,5,6,7))
  pure def local(st: State): bool = st.generation!=0 and st.credential==st.boundCredential and
    not(st.reset) and st.admitted==st.attempt
  pure def remote(st: State): bool = st.owner==st.remoteOwner and grantAllowed(st.grants,st.grant)
  pure def scheduled(st: State): State = {...st,periodic:st.generation,
    catchup:if (st.catchup==0) st.generation else st.catchup,schedules:st.schedules+1}
  pure def cancelScheduled(st: State): State = {...st,periodic:0,catchup:0,cancels:st.cancels+1,visible:false}
  pure def dropSelection(st: State): State = {...cancelScheduled(st),phase:"disabled",generation:0,grant:0,
    owner:0,boundCredential:0,cursor:0,continuation:0,incomplete:false,checked:false,notice:"none",tap:"none",consumeCurrent:false}
  pure def withdrawAll(st: State): State = {...dropSelection(st),attempt:st.attempt+1,admitted:st.attempt+1,pendingGrant:0}
  pure def freshSelection(st: State): State = scheduled({...dropSelection(st),phase:"waiting",
    latestGeneration:st.latestGeneration+1,generation:st.latestGeneration+1,grant:st.configuring,
    owner:st.configOwner,boundCredential:st.configCredential,incomplete:true})

  action environment(owner: int, grants: int, reset: bool, allowed: bool, observable: bool, locked: bool): bool = all {
    owner.in(owners), grants.in(0.to(7)),
    s'={...s,remoteOwner:owner,grants:grants,reset:reset,allowed:allowed,observable:observable,locked:locked}
  }
  action configureAt(grant: int, owner: int, checked: bool): bool = all {
    grant.in(selections), owner==s.remoteOwner, s.credential!=0, not(s.reset or s.locked),
    s.configuring==0, s.workGeneration==0, s.consumeGeneration==0,s.online,s.attempt<8, s.schedules<8, s.latestGeneration<3,
    s'={...s,attempt:s.attempt+1,configuring:grant,configOwner:owner,configCredential:s.credential,
      configAttempt:s.attempt+1,configGrantVerified:checked and grantAllowed(s.grants,grant),configQueued:not(checked),pendingGrant:grant}
  }
  action beginConfigure(grant: int, owner: int): bool = configureAt(grant,owner,true)
  action queueConfigure(grant: int, owner: int): bool = configureAt(grant,owner,false)
  action finishConfigure: bool = all {
    s.configuring!=0,
    val current=s.attempt==s.configAttempt
    val verified=if (s.configQueued) s.online and s.configOwner==s.remoteOwner and grantAllowed(s.grants,s.configuring)
      else s.configGrantVerified
    val eligible=current and s.configCredential==s.credential and not(s.reset) and verified
    val same=s.grant==s.configuring and s.owner==s.configOwner and s.boundCredential==s.configCredential
    val updated=if (not(eligible)) s else if (same) scheduled(s) else freshSelection(s)
    s'={...updated,configuring:0,configOwner:0,configCredential:0,configAttempt:0,configGrantVerified:false,configQueued:false,
      admitted:if (current) s.attempt else s.admitted,pendingGrant:if (current) 0 else s.pendingGrant,bridgeReply:if (eligible) "configured" else "refused"}
  }
  pure def abandon(st: State, refused: int): State =
    if (st.attempt==refused and st.admitted!=refused)
      {...st,attempt:st.attempt+1,admitted:st.attempt+1,pendingGrant:0}
    else st
  action refuseConfigure(grant: int, owner: int): bool = all {
    grant.in(selections),owner==s.remoteOwner,not(s.locked or s.retiredBridge),
    s.configuring==0,s.consumeGeneration==0,s.attempt<7,
    val started={...s,attempt:s.attempt+1,pendingGrant:grant}
    s'={...abandon(started,started.attempt),retiredBridge:true,bridgeReply:"refused"}
  }
  action holdRefusal(grant: int, owner: int): bool = all {
    grant.in(selections),owner==s.remoteOwner,not(s.locked or s.retiredBridge),
    s.configuring==0,s.consumeGeneration==0,s.attempt<7,
    s'={...s,attempt:s.attempt+1,pendingGrant:grant,refusalAttempt:s.attempt+1,retiredBridge:true}
  }
  action finishRefusal: bool = all {
    s.refusalAttempt!=0,
    s'={...abandon(s,s.refusalAttempt),refusalAttempt:0,bridgeReply:"refused"}
  }
  action withdraw(grant: int): bool = all {
    grant.in(Set(0,1,2,3)),s.attempt<8,
    val pendingMatch=grant!=0 and s.pendingGrant==grant
    val savedMatch=grant!=0 and s.grant==grant
    val nextState=if (grant==0 or savedMatch and (s.pendingGrant==0 or pendingMatch)) withdrawAll(s)
      else if (savedMatch) dropSelection(s)
      else if (pendingMatch) {...s,attempt:s.attempt+1,admitted:s.attempt+1,pendingGrant:0}
      else s
    s'={...nextState,bridgeReply:"withdrawn"}
  }
  action replaceCredential(value: int, notify: bool): bool = all {
    value.in(credentialClasses),value!=s.credential,s.attempt<8,
    s'={...(if (notify) withdrawAll(s) else s),credential:value}
  }
  action resume: bool = all {
    s.schedules<8,s.attempt<8,
    s'=if (s.generation==0 or s.admitted!=s.attempt) s
      else if (local(s)) scheduled(s) else withdrawAll(s)
  }
  action status: bool = s'={...s,bridgeReply:
    if (s.generation==0) "disabled" else if (local(s)) s.phase else "refused"}
  action recreate: bool = all {
    s.process<3,s.configuring==0,s.workGeneration==0,s.consumeGeneration==0,s.refusalAttempt==0,
    s'={...s,process:s.process+1,attempt:0,admitted:0,pendingGrant:0,retiredBridge:false,locked:false}
  }

  pure def retireBehindCheckpoint(st: State): State =
    if (st.cursor==2 and st.continuation==0 and st.tap=="none" and st.notice.in(Set("opened","denied")))
      {...st,notice:"none",visible:false}
    else st
  pure def publishNew(st: State): State =
    if (st.notice!="none") st
    else if (not(st.allowed)) {...st,notice:"denied"}
    else {...st,notice:if (st.observable) "posted" else "uncertain",visible:st.observable,posts:st.posts+1}
  pure def retry(st: State): State = {...st,phase:"retrying",workReply:"retry"}
  pure def unavailable(st: State): State = {...st,phase:"grant-unavailable",workReply:"success",visible:false}
  pure def checkpoint(st: State, nextCursor: int): State =
    {...st,phase:"watching-new-mail",cursor:nextCursor,continuation:0,checked:true,workReply:"success"}
  pure def page(st: State, response: str, fault: str): State =
    if (response=="unsupported") {...st,phase:"unsupported",workReply:"success"}
    else if (response=="forbidden") unavailable(st)
    else if (response.in(Set("retry","malformed"))) retry(st)
    else if (response=="baseline") {
      val saved=checkpoint(st,1)
      if (st.cursor!=0 or fault=="before") retry(st) else if (fault=="after") retry(saved) else saved
    }
    else if (response=="reset") checkpoint({...st,historyReads:if (st.cursor==0) 1 else 2},3)
    else if (response=="continued") {
      val batch=if (st.continuation==0) publishNew(retireBehindCheckpoint(st)) else st
      if (st.cursor!=1) retry(st)
      else {...batch,phase:"catching-up",checked:true,continuation:st.continuation+4,
        historyReads:4,workReply:"retry"}
    }
    else if (response=="notify") {
      if (st.cursor!=1 or st.continuation!=0) retry(st)
      else checkpoint(publishNew(st),2)
    }
    else if (response=="final") {
      if (st.cursor.in(Set(1,2))) checkpoint(retireBehindCheckpoint(st),2) else retry(st)
    }
    else retry(st)

  action work(generation: int, response: str, stopped: bool, fault: str): bool = all {
    generation.in(jobGenerations),response.in(scripts),fault.in(faults),
    s.workGeneration==0,s.consumeGeneration==0,s.continuation<=8,s.posts<8,
    fault=="none" or response=="baseline",
    response!="none" or generation!=s.generation or stopped or not(local(s) and remote(s) and s.online),
    val cleared={...s,historyReads:0}
    s'=if (generation==0) {...cleared,workReply:"failure"}
      else if (generation!=s.generation) {...cleared,workReply:"success"}
      else if (stopped) {...cleared,workReply:"retry"}
      else if (not(local(s))) {...cleared,workReply:"success"}
      else if (s.owner==s.remoteOwner and not(s.online)) retry(cleared)
      else if (not(remote(s))) unavailable(cleared)
      else page({...cleared,historyReads:1},response,fault)
  }
  action beginWorker(generation: int): bool = all {
    generation==s.generation,s.workGeneration==0,s.configuring==0,s.consumeGeneration==0,local(s),remote(s),s.online,s.posts<8,
    s'={...s,historyReads:1,workGeneration:generation,workEpoch:s.attempt,workReply:"running"}
  }
  action finishWorker(stopped: bool): bool = all {
    s.workGeneration!=0,
    val cleared={...s,workGeneration:0,workEpoch:0}
    s'=if (stopped) {...cleared,workReply:"retry"}
      else if (not(local(s)) or s.workGeneration!=s.generation or s.workEpoch!=s.attempt)
        {...cleared,workReply:"success"}
      else if (s.owner==s.remoteOwner and not(s.online)) retry(cleared)
      else if (s.owner==s.remoteOwner and not(s.online)) retry(cleared)
      else if (not(remote(s))) unavailable(cleared)
      else page(cleared,"notify","none")
  }

  pure def routePresent(st: State): bool =
    st.tap!="none" and st.notice.in(liveNotices) and (st.tap!="question" or st.visible)
  action capture(question: bool): bool = all {
    local(s),
    val recorded=s.notice.in(liveNotices) and (not(question) or s.visible)
    s'={...s,tap:if (recorded) (if (question) "question" else "open") else s.tap,
      consumeCurrent:s.consumeCurrent and not(recorded)}
  }
  // Release is an exact local cancellation. Only consuming a notice requires remote admission.
  action tapCall(method: str, exact: bool): bool = all {
    method.in(tapMethods),s.consumeGeneration==0,
    val pending=method=="pending"
    val request=not(s.locked) and local(s) and routePresent(s) and
      (pending or method=="consume" and exact)
    val checks=if (request and s.owner==s.remoteOwner) 1 else 0
    val settled=not(pending or s.locked) and local(s) and exact and
      (if (method=="release") s.tap=="question" else routePresent(s) and remote(s) and s.online)
    val reply=if (pending) {
      if (s.locked or s.generation==0) "empty"
      else if (not(local(s))) "refused"
      else if (not(routePresent(s))) "empty"
      else if (remote(s) and s.online) "pending" else "refused"
    } else if (settled) "settled" else "refused"
    s'={...s,tap:if (settled) "none" else s.tap,
      notice:if (settled and method=="consume") "opened" else s.notice,
      visible:s.visible and not(settled and method=="consume"),bridgeReply:reply,tapAuthorityReads:checks}
  }
  action network(connected: bool): bool = s'={...s,online:connected}
  action beginConsume: bool = all {
    s.consumeGeneration==0,s.workGeneration==0,s.configuring==0,not(s.locked),
    local(s),remote(s),s.online,routePresent(s),
    s'={...s,consumeGeneration:s.generation,consumeEpoch:s.attempt,consumeCurrent:true,tapAuthorityReads:1}
  }
  action finishConsume: bool = all {
    s.consumeGeneration!=0,
    val current=local(s) and not(s.locked) and s.consumeCurrent and routePresent(s) and
      s.consumeGeneration==s.generation and s.consumeEpoch==s.attempt
    s'={...s,consumeGeneration:0,consumeEpoch:0,consumeCurrent:false,
      bridgeReply:if (current) "settled" else "refused",tap:if (current) "none" else s.tap,
      notice:if (current) "opened" else s.notice,visible:s.visible and not(current)}
  }

  val RetiredSelectionIsEmpty = s.generation!=0 or
    (s.grant==0 and s.owner==0 and s.cursor==0 and s.continuation==0 and s.notice=="none" and
      s.tap=="none" and not(s.visible) and s.periodic==0 and s.catchup==0)
  val ExactSchedule = (s.periodic==0 or s.periodic==s.generation) and
    (s.catchup==0 or s.catchup==s.generation) and s.generation<=s.latestGeneration
  val ContinuationKeepsBaseline = s.continuation==0 or s.cursor==1
  val VisibleNoticeIsPosted = not(s.visible) or s.notice=="posted"
  val TapNeedsRetainedNotice = s.tap=="none" or s.notice.in(liveNotices)
  val AdmissionEpoch = s.admitted<=s.attempt and
    (s.configuring!=0 or (s.configAttempt==0 and s.configOwner==0 and s.configCredential==0))
  val PendingGrantOwnsAttempt = s.pendingGrant==0 or (s.admitted<s.attempt and
    (s.pendingGrant==s.configuring and s.configAttempt==s.attempt or s.refusalAttempt==s.attempt))
  val HeldRefusalOwnsClosedBridge = s.refusalAttempt==0 or (s.retiredBridge and s.refusalAttempt<=s.attempt)
  val HeldConsumeHasExactTap = not(s.consumeCurrent) or
    (s.consumeGeneration!=0 and s.consumeGeneration==s.generation and s.tap!="none")
  val safety=all {RetiredSelectionIsEmpty,ExactSchedule,ContinuationKeepsBaseline,
    VisibleNoticeIsPosted,TapNeedsRetainedNotice,AdmissionEpoch,PendingGrantOwnsAttempt,HeldConsumeHasExactTap,HeldRefusalOwnsClosedBridge}

  action step = any {
    { nondet owner=owners.oneOf(); nondet grants=0.to(7).oneOf(); nondet reset=Bool.oneOf();
      nondet allowed=Bool.oneOf(); nondet seen=Bool.oneOf(); nondet locked=Bool.oneOf();
      environment(owner,grants,reset,allowed,seen,locked) },
    { nondet grant=selections.oneOf(); beginConfigure(grant,s.remoteOwner) },
    { nondet grant=selections.oneOf(); queueConfigure(grant,s.remoteOwner) },
    finishConfigure,
    { nondet grant=selections.oneOf(); refuseConfigure(grant,s.remoteOwner) },
    { nondet grant=selections.oneOf(); holdRefusal(grant,s.remoteOwner) },
    finishRefusal,
    { nondet grant=Set(0,1,2,3).oneOf(); withdraw(grant) },
    { nondet value=credentialClasses.oneOf(); nondet notify=Bool.oneOf(); replaceCredential(value,notify) },
    resume,status,recreate,
    { nondet gen=jobGenerations.oneOf(); nondet response=scripts.oneOf(); nondet stopped=Bool.oneOf();
      nondet fault=faults.oneOf(); work(gen,response,stopped,fault) },
    beginWorker(s.generation),
    { nondet stopped=Bool.oneOf(); finishWorker(stopped) },
    { nondet question=Bool.oneOf(); capture(question) },
    { nondet method=tapMethods.oneOf(); nondet exact=Bool.oneOf(); tapCall(method,exact) },
    { nondet connected=Bool.oneOf(); network(connected) },
    beginConsume,finishConsume,
    s'=s,
  }

  run continuationSurvivesRecreationAndSameSelectionTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(work(1,"continued",false,"none"))
    .expect(s.cursor==1 and s.continuation==4 and s.historyReads==4 and s.workReply=="retry")
    .then(recreate).then(resume).then(beginConfigure(1,1)).then(finishConfigure)
    .expect(s.generation==1 and s.cursor==1 and s.continuation==4)
    .then(work(1,"final",false,"none")).expect(s.cursor==2 and s.continuation==0 and s.posts==1)
  run workerRetiredByCredentialTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(beginWorker(1)).then(replaceCredential(2,true))
    .then(finishWorker(false)).expect(s.workReply=="success" and s.cursor==0 and s.posts==0 and s.generation==0)
  run stoppedWorkerRetriesWithoutPageTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(beginWorker(1)).then(finishWorker(true))
    .expect(s.workReply=="retry" and s.cursor==1 and s.posts==0)
  run postcommitFaultKeepsCursorTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"after")).expect(s.cursor==1 and s.workReply=="retry" and s.phase=="retrying")
  run withdrawHeldGrantPreservesSavedCursorTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(beginConfigure(2,1)).then(withdraw(2))
    .expect(s.grant==1 and s.cursor==1 and s.attempt==3 and s.pendingGrant==0)
    .then(finishConfigure).expect(s.bridgeReply=="refused" and s.grant==1 and s.periodic==1)
  run withdrawQueuedGrantBeforeTransportTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(queueConfigure(2,1)).expect(s.pendingGrant==2 and not(s.configGrantVerified))
    .then(withdraw(2)).then(finishConfigure).expect(s.bridgeReply=="refused" and s.grant==1 and s.schedules==1)
  run unrelatedWithdrawalLeavesQueuedSelectionTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(queueConfigure(3,1)).then(withdraw(2)).then(finishConfigure)
    .expect(s.bridgeReply=="configured" and s.grant==3 and s.generation==2)
  run retiringSavedGrantKeepsUnrelatedPendingTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(beginConfigure(3,1)).then(withdraw(1))
    .expect(s.grant==0 and s.pendingGrant==3 and s.attempt==2)
    .then(finishConfigure).expect(s.grant==3 and s.generation==2)
  run withdrawingNeitherGrantLeavesBothUntouchedTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(beginConfigure(3,1)).then(withdraw(2))
    .expect(s.grant==1 and s.pendingGrant==3 and s.attempt==2 and s.periodic==1)
    .then(finishConfigure).expect(s.grant==3)
  run revokedTapCanRetryAfterRestorationTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(work(1,"notify",false,"none")).then(capture(false))
    .then(environment(1,2,false,true,true,false)).then(tapCall("pending",true)).expect(s.bridgeReply=="refused")
    .then(tapCall("consume",true)).expect(s.bridgeReply=="refused" and s.tap=="open" and s.visible)
    .then(environment(1,3,false,true,true,false)).then(tapCall("consume",true))
    .expect(s.bridgeReply=="settled" and s.notice=="opened" and s.tap=="none" and s.tapAuthorityReads==1)
    .then(tapCall("consume",true)).expect(s.bridgeReply=="refused" and s.tapAuthorityReads==0)
  run offlineQuestionCanBeCancelledLocallyTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(work(1,"notify",false,"none")).then(capture(true))
    .then(network(false)).then(tapCall("consume",true))
    .expect(s.bridgeReply=="refused" and s.tap=="question" and s.tapAuthorityReads==1)
    .then(tapCall("release",true))
    .expect(s.bridgeReply=="settled" and s.tap=="none" and s.visible and s.tapAuthorityReads==0)
  run supersededTapCannotSettleAfterVerificationTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(work(1,"notify",false,"none")).then(capture(false))
    .then(beginConsume).then(capture(true)).then(finishConsume)
    .expect(s.bridgeReply=="refused" and s.tap=="question" and s.visible)
  run refusedEnqueueRestoresSavedSelectionTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(work(1,"continued",false,"none"))
    .then(refuseConfigure(2,1)).expect(s.pendingGrant==0 and s.attempt==3 and s.admitted==3)
    .then(status).expect(s.bridgeReply=="catching-up" and s.cursor==1 and s.continuation==4 and s.visible)
    .then(resume).then(work(1,"final",false,"none"))
    .expect(s.workReply=="success" and s.historyReads==1 and s.cursor==2 and s.schedules==2 and s.posts==1)
  run refusedEnqueueKeepsOldWorkerRetiredTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(beginWorker(1)).then(refuseConfigure(2,1))
    .then(finishWorker(false)).expect(s.workReply=="success" and s.posts==0 and s.cursor==1 and s.pendingGrant==0)
    .then(work(1,"notify",false,"none")).expect(s.workReply=="success" and s.posts==1 and s.cursor==2)
  run refusedEnqueueCannotRetireLaterSameGrantTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(holdRefusal(2,1)).then(beginConfigure(2,1)).then(finishRefusal)
    .expect(s.pendingGrant==2 and s.attempt==3 and s.admitted==1)
    .then(finishConfigure).expect(s.grant==2 and s.generation==2 and s.admitted==3)
  run refusedEnqueueCannotRetireSettledSuccessorTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(holdRefusal(2,1)).then(beginConfigure(3,1)).then(finishConfigure)
    .then(finishRefusal).expect(s.grant==3 and s.generation==2 and s.attempt==3 and s.admitted==3)
  run uncertainNoticeNeverRepostsTest = init.then(beginConfigure(1,1)).then(finishConfigure)
    .then(work(1,"baseline",false,"none")).then(environment(1,3,false,true,false,false))
    .then(work(1,"notify",false,"none")).then(recreate).then(work(1,"final",false,"none"))
    .expect(s.notice=="uncertain" and s.posts==1 and not(s.visible))
}
