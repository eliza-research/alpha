// Android scoped-deletion inspection tickets, foreground dialog, and staging boundary.
module NativeCalendarScopedReview {
  type State = {epoch: int, retired: bool, ticket: bool, ticketEpoch: int, expires: int, now: int,
    inspectHeld: bool, inspectEpoch: int, inspectResult: str, reviewPhase: str, reviewEpoch: int, reviewResult: str,
    competing: str, provider: str, granted: bool, locked: bool, focused: bool, dialogFocused: bool,
    resumed: bool, stageRefused: bool, stageCount: int, staged: str}
  var s: State
  val ticketKeys=Set("exact","forged","eventId","revision","sourceId","sourceRevision")
  val times=Set(0,60000,60001)
  val providerChanges=Set("event","source")

  action init = s'={epoch:0,retired:false,ticket:false,ticketEpoch:-1,expires:0,now:0,
    inspectHeld:false,inspectEpoch:-1,inspectResult:"none",reviewPhase:"idle",reviewEpoch:-1,reviewResult:"none",
    competing:"none",provider:"exact",granted:true,locked:false,focused:true,dialogFocused:false,
    resumed:true,stageRefused:false,stageCount:0,staged:"none"}

  pure def foreground(st: State): bool = not(st.retired or st.locked) and st.focused
  pure def reviewForeground(st: State): bool = not(st.retired or st.locked) and st.resumed and
    (st.focused or st.dialogFocused)
  pure def ready(st: State, generation: int): State =
    {...st,ticket:true,ticketEpoch:generation,expires:st.now+60000,inspectResult:"ready"}
  pure def settle(st: State, result: str): State =
    {...st,reviewPhase:"idle",reviewEpoch:-1,reviewResult:result}

  action inspect(visible: bool): bool = all {
    not(s.inspectHeld),s.provider=="exact",
    s'=if (not(s.granted)) {...s,inspectResult:"permission-required"}
       else if (not(foreground(s))) {...s,inspectResult:"unavailable"}
       else if (not(visible)) {...s,inspectResult:"conflict"} else ready(s,s.epoch)
  }
  action holdInspect = all {
    not(s.inspectHeld),s.provider=="exact",s.granted,foreground(s),
    s'={...s,inspectHeld:true,inspectEpoch:s.epoch,inspectResult:"pending"}
  }
  action finishInspect = all {
    s.inspectHeld,
    val completed={...s,inspectHeld:false,inspectEpoch:-1}
    s'=if (s.retired or s.inspectEpoch!=s.epoch) {...completed,inspectResult:"unavailable"}
       else ready(completed,s.inspectEpoch)
  }
  action request(key: str): bool = all {
    key.in(ticketKeys),not(s.inspectHeld),s.reviewPhase=="idle",
    s'=if (not(s.granted)) settle(s,"permission-required")
       else if (not(foreground(s))) settle(s,"unavailable")
       else if (not(s.ticket) or s.now>s.expires or s.provider!="exact" or not(key.in(Set("exact","forged"))))
         settle(s,"conflict")
       else {...s,reviewPhase:"queued",reviewEpoch:s.epoch,reviewResult:"pending"}
  }
  action probeBusy = all {
    s.reviewPhase!="idle",s.granted,foreground(s),s'={...s,competing:"busy"}
  }
  action show = all {
    s.reviewPhase=="queued",
    s'=if (s.reviewEpoch!=s.epoch or not(foreground(s) and s.granted)) settle(s,"cancelled")
       else {...s,reviewPhase:"dialog"}
  }
  action answer(positive: bool): bool = all {
    s.reviewPhase=="dialog",s.stageCount<2,
    s'=if (positive and s.granted and reviewForeground(s))
       {...settle(s,if (s.stageRefused) "unknown" else "queued"),stageCount:s.stageCount+1,staged:"canonical"}
       else settle(s,"cancelled")
  }
  pure def paused(st: State): State = {
    val closed=if (st.reviewPhase=="dialog") settle(st,"cancelled") else st
    {...closed,epoch:st.epoch+1,ticket:false,ticketEpoch:-1,expires:0}
  }
  action pause = all {s.epoch<3,not(s.retired),s'=paused(s)}
  action destroy = all {s.epoch<3,not(s.retired),s'={...paused(s),retired:true}}
  action grant(granted: bool): bool = s'={...s,granted:granted}
  action lock = s'={...s,locked:true}
  action stop = s'={...s,resumed:false}
  action focusDialog = all {s.reviewPhase=="dialog",s'={...s,focused:false,dialogFocused:true}}
  action clock(now: int): bool = all {now.in(times),now>=s.now,s'={...s,now:now}}
  action change(kind: str): bool = all {kind.in(providerChanges),s.provider=="exact",s'={...s,provider:kind}}
  action refuseStage = s'={...s,stageRefused:true}

  val BoundedTicket = if (s.ticket) s.expires>=60000 and s.ticketEpoch>=0 and s.ticketEpoch<=s.epoch
    else s.expires==0 and s.ticketEpoch == -1
  val PendingReviewOwnsReply = (s.reviewPhase!="idle")== (s.reviewResult=="pending") and
    ((s.reviewPhase!="idle")== (s.reviewEpoch>=0))
  val VisibleReviewCurrent = s.reviewPhase!="dialog" or (not(s.retired) and s.reviewEpoch==s.epoch)
  val CanonicalStageOnly = if (s.stageCount==0) s.staged=="none" else s.staged=="canonical"
  val EnqueueResultAfterAttempt = not(s.reviewResult.in(Set("queued","unknown"))) or s.stageCount>0
  val TicketHasCurrentEpoch = not(s.ticket) or s.ticketEpoch==s.epoch
  val safety = all {BoundedTicket,PendingReviewOwnsReply,VisibleReviewCurrent,CanonicalStageOnly,EnqueueResultAfterAttempt,TicketHasCurrentEpoch}

  action step = any {
    {nondet v=Bool.oneOf();inspect(v)},holdInspect,finishInspect,
    {nondet k=ticketKeys.oneOf();request(k)},probeBusy,show,{nondet p=Bool.oneOf();answer(p)},
    pause,destroy,{nondet g=Bool.oneOf();grant(g)},lock,stop,focusDialog,
    {nondet t=times.oneOf();clock(t)},{nondet k=providerChanges.oneOf();change(k)},refuseStage,s'=s
  }

  run canonicalTicketOwnsStagingTest = init.then(inspect(true)).then(request("forged")).then(show)
    .then(focusDialog).then(answer(true)).expect(s.reviewResult=="queued" and s.staged=="canonical")
  run differentRevisionRefusedTest = init.then(inspect(true)).then(request("revision"))
    .expect(s.reviewResult=="conflict" and s.stageCount==0)
  run deadlineInclusiveTest = init.then(inspect(true)).then(clock(60000)).then(request("exact"))
    .expect(s.reviewPhase=="queued")
  run expiredTicketRefusedTest = init.then(inspect(true)).then(clock(60001)).then(request("exact"))
    .expect(s.reviewResult=="conflict")
  run providerRereadRefusesChangedSourceTest = init.then(inspect(true)).then(change("source")).then(request("exact"))
    .expect(s.reviewResult=="conflict")
  run pauseRetiresQueuedReviewTest = init.then(inspect(true)).then(request("exact")).then(pause).then(show)
    .expect(s.reviewResult=="cancelled" and not(s.ticket))
  run revocationRefusesPositiveTest = init.then(inspect(true)).then(request("exact")).then(show).then(grant(false))
    .then(answer(true)).expect(s.reviewResult=="cancelled" and s.stageCount==0)
  run uncertainEnqueueRetainedTest = init.then(inspect(true)).then(request("exact")).then(show).then(refuseStage)
    .then(answer(true)).expect(s.reviewResult=="unknown" and s.stageCount==1)
  run heldCurrentInspectionPublishesTest = init.then(holdInspect).then(finishInspect)
    .expect(TicketHasCurrentEpoch and s.ticket and s.inspectResult=="ready")
  run pauseRetiresHeldInspectionTest = init.then(holdInspect).then(pause).then(finishInspect)
    .expect(TicketHasCurrentEpoch and not(s.ticket) and s.inspectResult=="unavailable")
    .then(request("exact")).expect(s.reviewResult=="conflict" and s.stageCount==0)
    .then(inspect(true)).then(request("exact")).then(show).expect(s.reviewPhase=="dialog" and s.ticketEpoch==1)
  run destroyRetiresHeldInspectionTest = init.then(holdInspect).then(destroy).then(finishInspect)
    .expect(TicketHasCurrentEpoch and not(s.ticket) and s.inspectResult=="unavailable")
}
