// Hosted source renewal journal, redacted alert, and latest exact tap receipt.
module NativeSourceRenewal {
  type Row = {phase: str, token: int, question: bool}
  type Reply = {status: str, id: int, token: int, question: bool}
  type State = {
    rows: int -> Row, visible: Set[int], routes: Set[int], serial: int, now: int,
    owner: int, revision: int, online: bool, revoked: bool, gate: str,
    posts: int, cancels: int, wakeups: int, process: int, locked: bool, reply: Reply
  }
  var s: State
  val ids=Set(1,2,3,4)
  val empty={phase:"none",token:0,question:false}
  val postModes=Set("none","before","final-before","final-after","notify-fail","stale-after","offline-after")
  val captureModes=Set("renew","question","foreign","wrong-prefix")
  val gates=Set("allowed","denied","flip")
  pure def reply(status: str): Reply = {status:status,id:0,token:0,question:false}

  action init = s'={rows:ids.mapBy(_=>empty),visible:Set(),routes:Set(),serial:0,now:1000,
    owner:1,revision:1,online:true,revoked:false,gate:"allowed",posts:0,cancels:0,wakeups:0,process:1,locked:false,reply:reply("none")}
  pure def ownerOf(id: int): int = if (id==4) 2 else 1
  pure def sourceOf(id: int): int = if (id==2) 2 else 1
  pure def current(state: State, id: int): str =
    if (state.now>=2000) "stale"
    else if (not(state.online)) "unverifiable"
    else if (state.revoked or ownerOf(id)!=state.owner or (sourceOf(id)==1 and (if (id==3) 2 else 1)!=state.revision)) "stale"
    else "valid"
  pure def setRow(state: State, id: int, row: Row): State = { ...state,rows:state.rows.set(id,row) }
  pure def result(state: State, status: str): State = { ...state,reply:reply(status) }
  pure def present(state: State, id: int): bool = state.rows.get(id).phase!="none"
  pure def cancelSet(state: State, retiring: Set[int], save: bool): State = {
    ...state, visible:state.visible.exclude(retiring), routes:state.routes.exclude(retiring), cancels:state.cancels+retiring.size(),
    rows:if (save) ids.mapBy(id=>if (retiring.contains(id)) empty else state.rows.get(id)) else state.rows
  }

  action arm(id: int, refusedWrite: bool): bool = all {
    ids.contains(id), s.cancels<12,
    val check=current(s,id)
    val retired=ids.filter(old=>old!=id and present(s,old) and (current(s,old)=="stale" or sourceOf(old)==sourceOf(id)))
    val update=cancelSet(s,retired,not(refusedWrite))
    val row=s.rows.get(id)
    s'=if (check!="valid") result(s,check)
      else if (refusedWrite) result(update,"failed")
      else result(setRow(update,id,if (row.phase.in(Set("none","dispatching"))) { ...row,phase:"armed" } else row),"ok")
  }
  action clear(id: int, refusedWrite: bool): bool = all {
    ids.contains(id), s.cancels<12,
    val retiring=if (present(s,id)) Set(id) else Set()
    s'=result(cancelSet(s,retiring,not(refusedWrite)),if (refusedWrite) "failed" else "ok")
  }
  action withdraw(kept: int, refusedWrite: bool): bool = all {
    kept.in(Set(0,1,2)), s.cancels<12,
    val retiring=ids.filter(id=>present(s,id) and ownerOf(id)!=kept)
    s'=result(cancelSet(s,retiring,not(refusedWrite)),if (refusedWrite) "failed" else "ok")
  }

  pure def dispatched(state: State, id: int, mode: str): State = {
    val row=state.rows.get(id)
    val reserved=setRow(state,id,{ ...row,phase:"dispatching" })
    if (mode=="stale-after") result(cancelSet({ ...reserved,revoked:true },Set(id),true),"ok")
    else if (mode=="offline-after") result(setRow({ ...reserved,online:false },id,{ ...row,phase:"armed" }),"unverifiable")
    else {
      val attempted=state.gate=="allowed"
      val posted=attempted and mode!="notify-fail"
      val fired={ ...reserved,visible:if (posted) reserved.visible.union(Set(id)) else reserved.visible,
        routes:if (attempted) reserved.routes.union(Set(id)) else reserved.routes,
        posts:if (posted) reserved.posts+1 else reserved.posts }
      val refused=state.gate=="denied" or (attempted and mode=="notify-fail")
      val finalRow={ ...row,phase:if (refused) "armed" else "posted" }
      val stored=if (mode=="final-before") fired else setRow(fired,id,finalRow)
      result(stored,if (refused or mode.in(Set("final-before","final-after"))) "failed" else "ok")
    }
  }
  action post(id: int, mode: str): bool = all {
    ids.contains(id), postModes.contains(mode), s.posts<8, s.cancels<12,
    val phase=s.rows.get(id).phase
    val check=current(s,id)
    val eligible=check=="valid" and phase.in(Set("armed","dispatching"))
    all {
      mode.in(Set("none","before")) or eligible,
      s'=if (phase=="none") result(s,"ok")
        else if (check=="stale") (if (mode=="before") result(s,"failed") else result(cancelSet(s,Set(id),true),"ok"))
        else if (check=="unverifiable") result(s,"unverifiable")
        else if (not(eligible)) result(s,"ok")
        else if (mode=="before") result(s,"failed")
        else dispatched(s,id,mode)
    }
  }

  pure def consume(state: State): State = result({ ...state,wakeups:state.wakeups+1 },"consumed")
  pure def pendingId(state: State): int =
    if (state.rows.get(1).token>0) 1 else if (state.rows.get(2).token>0) 2
    else if (state.rows.get(3).token>0) 3 else if (state.rows.get(4).token>0) 4 else 0
  action capture(id: int, mode: str, refusedWrite: bool): bool = all {
    ids.contains(id), captureModes.contains(mode), s.wakeups<10, s.serial<6, s.cancels<12,
    val check=current(s,id)
    val row=s.rows.get(id)
    s'=if (mode.in(Set("foreign","wrong-prefix"))) result(s,"ignored")
      else if (row.phase!="posted") consume(s)
      else if (check=="unverifiable" or refusedWrite) result(s,"ignored")
      else if (check=="stale") consume(cancelSet(s,Set(id),true))
      else consume({ ...s,serial:s.serial+1,rows:ids.mapBy(key=>{
        val old=s.rows.get(key)
        if (key==id) { ...old,token:s.serial+1,question:mode=="question" }
        else { ...old,token:0,question:false }
      }) })
  }
  action pending = all {
    s.cancels<12,
    val id=pendingId(s)
    s'=if (s.locked) result(s,"rejected")
      else if (id==0) result(s,"empty")
      else if (current(s,id)=="stale") result(cancelSet(s,Set(id),true),"empty")
      else if (current(s,id)=="unverifiable") result(s,"rejected")
      else { ...s,reply:{status:"pending",id:id,token:s.rows.get(id).token,question:s.rows.get(id).question} }
  }
  action settle(token: int, discard: bool): bool = all {
    token.in(0.to(6)), s.cancels<12,
    val id=pendingId(s)
    s'=if (s.locked or id==0) result(s,"rejected")
      else if (s.rows.get(id).token!=token) result(s,"rejected")
      else if (current(s,id)=="stale") result(cancelSet(s,Set(id),true),"rejected")
      else if (current(s,id)=="unverifiable" or (discard and not(s.rows.get(id).question))) result(s,"rejected")
      else result(setRow(s,id,{ ...s.rows.get(id),token:0,question:false }),"ok")
  }
  action control(kind: str, value: bool): bool = all {
    kind.in(Set("online","revoked","locked")),
    s'=if (kind=="online") { ...s,online:value } else if (kind=="revoked") { ...s,revoked:value } else { ...s,locked:value }
  }
  action owner(id: int): bool = all { id.in(Set(1,2)), s'={ ...s,owner:id } }
  action revision(id: int): bool = all { id.in(Set(1,2)), s'={ ...s,revision:id } }
  action gate(mode: str): bool = all { gates.contains(mode), s'={ ...s,gate:mode } }
  action time(now: int): bool = all { now.in(Set(1000,1500,2000)), s'={ ...s,now:now } }
  action restart = all { s.process<3, s'={ ...s,process:s.process+1,wakeups:0 } }

  val VisibleAlertHasBothRoutes = s.visible.subseteq(s.routes) and s.routes.subseteq(ids)
  val SingleExactPending = ids.filter(id=>s.rows.get(id).token>0).size()<=1
    and ids.forall(id=>{
      val row=s.rows.get(id)
      (row.token==0 implies not(row.question)) and (row.token>0 implies row.phase=="posted" and row.token<=s.serial)
    })
  val safety=VisibleAlertHasBothRoutes and SingleExactPending

  action step = any {
    nondet id=ids.oneOf()
    nondet refusedWrite=Bool.oneOf()
    arm(id,refusedWrite),
    nondet id=ids.oneOf()
    nondet refusedWrite=Bool.oneOf()
    clear(id,refusedWrite),
    nondet kept=Set(0,1,2).oneOf()
    nondet refusedWrite=Bool.oneOf()
    withdraw(kept,refusedWrite),
    nondet id=ids.oneOf()
    nondet mode=postModes.oneOf()
    post(id,mode),
    nondet id=ids.oneOf()
    nondet mode=captureModes.oneOf()
    nondet refusedWrite=Bool.oneOf()
    capture(id,mode,refusedWrite),
    pending,
    nondet token=0.to(6).oneOf()
    nondet discard=Bool.oneOf()
    settle(token,discard),
    nondet kind=Set("online","revoked","locked").oneOf()
    nondet value=Bool.oneOf()
    control(kind,value),
    owner(1),owner(2),revision(1),revision(2),gate("allowed"),gate("denied"),gate("flip"),
    time(1000),time(1500),time(2000),restart,s'=s
  }

  action armed=init.then(arm(1,false))
  action posted=armed.then(post(1,"none"))
  run oldTapCannotSettleNewerPurposeTest = posted.then(capture(1,"question",false)).then(capture(1,"renew",false))
    .then(settle(1,false)).expect(s.reply.status=="rejected")
    .then(settle(2,true)).expect(s.reply.status=="rejected" and s.rows.get(1).token==2)
    .then(settle(2,false)).expect(s.rows.get(1).token==0 and s.visible.contains(1))
  run ownerChangeRetiresTapAndBothIntentsTest = posted.then(capture(1,"question",false))
    .then(owner(2)).then(settle(1,false))
    .expect(s.reply.status=="rejected" and s.routes==Set() and s.rows.get(1)==empty)
  run uncertainReservationCanRetryTest = armed.then(post(1,"offline-after"))
    .expect(s.reply.status=="unverifiable" and s.rows.get(1).phase=="armed")
    .then(control("online",true)).then(post(1,"none")).expect(s.posts==1 and s.visible.contains(1))
  run interruptedFinalSaveReusesTagTest = armed.then(post(1,"final-before"))
    .expect(s.rows.get(1).phase=="dispatching" and s.visible==Set(1))
    .then(restart).then(post(1,"none")).expect(s.posts==2 and s.visible==Set(1) and s.rows.get(1).phase=="posted")
  run secondAdmissionCanSilentlyLoseAlertAsBuiltTest = armed.then(gate("flip")).then(post(1,"none"))
    .then(gate("allowed")).then(post(1,"none"))
    .expect(s.posts==0 and s.rows.get(1).phase=="posted" and s.visible==Set())
  run failedClearCancelsBeforeSavingAsBuiltTest = posted.then(clear(1,true))
    .expect(s.visible==Set() and s.routes==Set() and s.rows.get(1).phase=="posted" and s.reply.status=="failed")
  run validPrefixWithoutRowOnlyWakesTest = init.then(capture(4,"question",false)).then(pending)
    .expect(s.wakeups==1 and s.reply.status=="empty" and s.serial==0)
}
