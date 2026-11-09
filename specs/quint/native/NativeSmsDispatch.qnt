// Alpha's reviewed SMS coordinator and manifest callback boundary.
// One fixed operation ID, two payloads, two bridge actors and up to four parts.
module NativeSmsDispatch {
  type Record = {
    binding: int, status: str, decision: str, dispatching: bool, submitted: bool, unknown: bool, boot: int,
    sent: Set[int], failed: Set[int], reported: Set[int], delivered: Set[int], deliveryFailed: Set[int], rows: Set[int]
  }
  type Review = {binding: int, sim: int}
  type State = {
    recipients: int, parts: int, reply: str, replyBinding: int, memory: Record, disk: Record, tombstoneBinding: int,
    attempts: int, accepted: int, reviews: int -> Review, foreground: Set[int], closed: Set[int], listener: int, events: int,
    image: bool, send: bool, phone: bool, read: bool, locked: bool, role: bool, sim: int,
    process: int, boot: int, old: bool, candidate: str, providerStatus: str, refuseOutbox: bool,
    outbox: Set[int], sentRows: Set[int], failedRows: Set[int]
  }
  var s: State
  val actors = Set(1, 2)
  val noReview = {binding:0,sim:0}
  val noRecord = {binding:0,status:"none",decision:"none",dispatching:false,submitted:false,unknown:false,boot:0,
    sent:Set(),failed:Set(),reported:Set(),delivered:Set(),deliveryFailed:Set(),rows:Set()}

  action initWith(recipients: int, parts: int, role: bool): bool = all {
    recipients.in(1.to(2)), parts.in(1.to(2)),
    s' = {recipients:recipients,parts:parts,reply:"none",replyBinding:0,memory:noRecord,disk:noRecord,tombstoneBinding:0,attempts:0,accepted:0,
      reviews:actors.mapBy(_actor=>noReview),foreground:actors,closed:Set(),listener:2,events:0,
      image:true,send:true,phone:true,read:true,locked:false,role:role,sim:1,process:1,boot:1,old:false,
      candidate:"none",providerStatus:"none",refuseOutbox:false,outbox:Set(),sentRows:Set(),failedRows:Set()}
  }
  action init = {
    nondet recipients=1.to(2).oneOf()
    nondet parts=1.to(2).oneOf()
    nondet role=Bool.oneOf()
    initWith(recipients,parts,role)
  }

  pure def response(state: State, reply: str, binding: int): State = { ...state,reply:reply,replyBinding:binding }
  pure def current(state: State, actor: int): bool =
    state.image and not(state.locked) and state.foreground.contains(actor) and not(state.closed.contains(actor))
  pure def permitted(state: State, actor: int): bool = current(state,actor) and state.send and state.phone and state.sim!=0
  pure def project(record: Record, count: int): Record = {
    val status=if (record.binding==0) "none" else if (record.decision!="none") record.decision
      else if (record.failed.size()>0) "failed"
      else if (record.sent.size()==count) (if (record.delivered.size()==count) "delivered" else "sent")
      else if (record.unknown or record.dispatching) "unknown"
      else if (record.submitted) "submitted" else "unknown"
    { ...record,status:status }
  }
  pure def saved(state: State, record: Record): State = {
    val wire=project(record,state.recipients*state.parts)
    { ...state,memory:wire,disk:wire }
  }
  pure def decide(state: State, binding: int, outcome: str): State =
    if (state.memory.binding!=0 or state.tombstoneBinding!=0) response(state,"unavailable",0)
    else response(saved(state,{ ...noRecord,binding:binding,decision:outcome,boot:state.boot }),outcome,binding)
  pure def receipt(state: State): State = response(state,state.memory.status,state.memory.binding)
  pure def retained(state: State, binding: int): State =
    if (state.tombstoneBinding!=0) response(state,if (state.tombstoneBinding==binding) "expired" else "invalid",0)
    else if (state.memory.binding==binding) receipt(state) else response(state,"invalid",0)
  pure def hasRetainedId(state: State): bool = state.memory.binding!=0 or state.tombstoneBinding!=0

  action access(kind: str, allowed: bool): bool = all {
    kind.in(Set("image","send","phone","read","locked","role")),
    s' = if (kind=="image") { ...s,image:allowed } else if (kind=="send") { ...s,send:allowed }
      else if (kind=="phone") { ...s,phone:allowed } else if (kind=="read") { ...s,read:allowed }
      else if (kind=="locked") { ...s,locked:allowed } else { ...s,role:allowed }
  }
  action simAt(value: int): bool = all { value.in(0.to(3)), s' = { ...s,sim:value } }
  action refuseOutbox(value: bool): bool = s' = { ...s,refuseOutbox:value }
  action age = all { s.memory.binding!=0, s' = { ...s,old:true } }
  // A successful journal capacity write retires the fixed ID into an exact-binding tombstone.
  action prune = all {
    s.old, s.memory.binding!=0, s.memory.binding==s.disk.binding, not(s.memory.dispatching),
    s' = { ...s,memory:noRecord,disk:noRecord,tombstoneBinding:s.memory.binding }
  }

  action request(actor: int, binding: int, mode: str): bool = all {
    actors.contains(actor), binding.in(1.to(2)), mode.in(Set("complete","long-number","divide-refused","empty-parts")),
    if (not(current(s,actor))) s' = response(s,"unavailable",0)
    else if (mode=="long-number") s' = response(s,"invalid",0)
    else if (hasRetainedId(s)) s' = retained(s,binding)
    else if (s.reviews.get(actor).binding!=0) s' = response(s,"busy",0)
    else if (not(permitted(s,actor)) or mode=="divide-refused") s' = decide(s,binding,"denied")
    else if (mode=="empty-parts") s' = response(s,"too-long",0)
    else s' = response({ ...s,reviews:s.reviews.set(actor,{binding:binding,sim:s.sim}) },"pending",0)
  }

  pure def retireReview(state: State, actor: int): State = {
    val review=state.reviews.get(actor)
    if (review.binding==0) state else decide({ ...state,reviews:state.reviews.set(actor,noReview) },review.binding,"cancelled")
  }
  action cancel(actor: int, exact: bool): bool = all {
    actors.contains(actor),
    s' = if (not(current(s,actor))) response(s,"unavailable",0)
      else response(if (exact) retireReview(s,actor) else s,"ok",0)
  }
  action lifecycle(actor: int, mode: str): bool = all {
    actors.contains(actor), mode.in(Set("pause","resume","screen","destroy")),
    val stopped=retireReview(s,actor)
    s' = if (mode=="pause") { ...stopped,foreground:stopped.foreground.exclude(Set(actor)) }
      else if (mode=="resume") { ...stopped,foreground:stopped.foreground.union(Set(actor)) }
      else if (mode=="destroy") { ...stopped,closed:stopped.closed.union(Set(actor)),listener:if (s.listener==actor) 0 else s.listener }
      else stopped
  }

  val dispatchModes = Set("complete","guard-change","throw-before","throw-after","begin-before","begin-after-and-deny-before","end-before","end-after")
  action approve(actor: int, mode: str): bool = all {
    actors.contains(actor), dispatchModes.contains(mode),
    val review=s.reviews.get(actor)
    all {
      review.binding!=0,
      val state={ ...s,reviews:s.reviews.set(actor,noReview) }
      if (not(permitted(s,actor))) s' = decide(state,review.binding,"denied")
      else if (hasRetainedId(state)) s' = retained(state,review.binding)
      else if (review.sim!=s.sim or mode=="begin-before") s' = decide(state,review.binding,"denied")
      else {
        val starting=project({ ...noRecord,binding:review.binding,dispatching:true,boot:s.boot },s.recipients*s.parts)
        if (mode=="begin-after-and-deny-before") s' = response({ ...state,disk:starting },"unavailable",0)
        else {
          val attempted=if (mode.in(Set("guard-change","throw-before","throw-after"))) 1 else s.recipients
          val accepted=if (mode=="throw-before") 0 else attempted
          val outbox=if (s.role and not(s.refuseOutbox)) Set(1,2).filter(recipient => recipient<=attempted) else Set()
          val beforeEnd={ ...starting,rows:outbox }
          val returned=not(mode.in(Set("throw-before","throw-after"))) and (mode!="guard-change" or s.recipients==1)
          val ended=project({ ...beforeEnd,dispatching:false,submitted:returned,unknown:not(returned) },s.recipients*s.parts)
          s' = receipt({ ...state,memory:ended,disk:if (mode=="end-before") beforeEnd else ended,
            attempts:s.attempts+attempted,accepted:s.accepted+accepted,sim:if (mode=="guard-change") 2 else s.sim,outbox:outbox })
        }
      }
    }
  }

  action readback(actor: int): bool = all {
    actors.contains(actor),
    s' = if (not(current(s,actor))) response(s,"unavailable",0)
      else if (s.memory.binding==0) response(s,"not-found",0) else receipt(s)
  }

  action provider(kind: str, status: str): bool = all {
    s.memory.binding!=0, kind.in(Set("none","wrong","ambiguous","exact")),
    not(s.memory.rows.contains(1)) or kind.in(Set("none","exact")),
    status.in(Set("none","pending","complete","failed")),
    s' = { ...s,candidate:kind,providerStatus:status }
  }

  pure def partsOf(recipient: int, count: int): Set[int] =
    if (count==1) Set(recipient) else Set(recipient*2-1,recipient*2)

  pure def settleRow(state: State, index: int): State = {
    val recipient=if (state.parts==1) index else (index+1)/2
    val parts=partsOf(recipient,state.parts)
    if (not(state.role and state.outbox.contains(recipient))) state
    else if (parts.intersect(state.memory.failed).size()>0)
      { ...state,outbox:state.outbox.exclude(Set(recipient)),failedRows:state.failedRows.union(Set(recipient)) }
    else if (parts.subseteq(state.memory.sent))
      { ...state,outbox:state.outbox.exclude(Set(recipient)),sentRows:state.sentRows.union(Set(recipient)) }
    else state
  }

  pure def ownedProvider(state: State): bool = Set(1).intersect(state.outbox.union(state.sentRows).union(state.failedRows)).size()>0

  // A provider match can attach a row without making the send delivered.
  // Only a reported, successfully sent single part can use that row's status.
  pure def reconciled(state: State): State = {
    val memory=state.memory
    val partSet=partsOf(1,state.parts)
    val present=state.candidate=="exact" and not(ownedProvider(state))
    if (not(state.read) or state.old or memory.binding==0 or memory.decision!="none" or
      not(partSet.subseteq(memory.sent)) or (state.boot!=memory.boot and memory.reported.size()==0)) state
    else {
      val attributed=if (present) { ...memory,rows:memory.rows.union(Set(1)) } else memory
      val report=state.parts==1 and memory.reported.contains(1) and not(memory.delivered.contains(1) or memory.deliveryFailed.contains(1))
      val outcome=if (present and report and state.providerStatus=="complete")
          { ...attributed,delivered:attributed.delivered.union(Set(1)) }
        else if (present and report and state.providerStatus=="failed")
          { ...attributed,deliveryFailed:attributed.deliveryFailed.union(Set(1)) }
        else attributed
      if (outcome==memory) state else saved(state,outcome)
    }
  }

  pure def announce(state: State, changed: bool): State =
    if (changed and state.listener!=0 and current(state,state.listener)) { ...state,events:state.events+1 } else state
  pure def deliveryChanged(before: Record, after: Record): bool =
    before.delivered!=after.delivered or before.deliveryFailed!=after.deliveryFailed

  action reconcile: bool = all {
    s.image, s.events<8,
    val read=reconciled(s)
    s' = announce(read,deliveryChanged(s.memory,read.memory))
  }

  action callback(index: int, kind: str, ok: bool, mode: str): bool = all {
    index.in(1.to(4)), index<=s.accepted*s.parts, kind.in(Set("sent","delivery")),
    mode.in(Set("complete","wrong-action","before","after")), s.events<8,
    if (not(s.image) or mode=="wrong-action" or s.memory.binding==0) s' = s
    else {
      val memory=s.memory
      val updated=if (kind=="delivery") { ...memory,reported:memory.reported.union(Set(index)) }
        else if (memory.sent.contains(index) or memory.failed.contains(index)) memory
        else if (ok) { ...memory,sent:memory.sent.union(Set(index)) }
        else { ...memory,failed:memory.failed.union(Set(index)) }
      val changed=updated!=memory
      if (changed and mode=="before") s' = { ...s,memory:project(updated,s.recipients*s.parts) }
      else if (changed and mode=="after") s' = saved(s,updated)
      else {
        val written=if (changed) saved(s,updated) else s
        val read=reconciled(if (kind=="sent") settleRow(written,index) else written)
        s' = announce(read,changed or deliveryChanged(memory,read.memory))
      }
    }
  }

  action restart(reboot: bool): bool = all {
    s.process<3, s.image,
    val boot=if (reboot) s.boot+1 else s.boot
    val stored=s.disk
    val interrupted=stored.dispatching or
      (stored.binding!=0 and stored.decision=="none" and stored.boot!=boot and stored.sent.union(stored.failed).size()<s.recipients*s.parts)
    val loaded=if (interrupted) project({ ...stored,dispatching:false,unknown:true },s.recipients*s.parts) else stored
    val current={ ...s,process:s.process+1,boot:boot,reviews:actors.mapBy(_actor=>noReview),foreground:actors,closed:Set(),
      listener:2,events:0,reply:"none",replyBinding:0,memory:loaded,disk:loaded }
    val recovered=reconciled(current)
    s' = announce(recovered,deliveryChanged(current.memory,recovered.memory))
  }

  val OneRadioCallPerRecipient = s.accepted<=s.attempts and s.attempts<=s.recipients
  val RadioNeedsDurableIntent = s.attempts==0 or s.tombstoneBinding!=0 or (s.disk.binding!=0 and s.disk.decision=="none")
  val TombstoneRetiresLiveRecord = s.tombstoneBinding==0 or (s.memory.binding==0 and s.disk.binding==0)
  pure def evidence(record: Record): bool =
    record.sent.intersect(record.failed).size()==0 and record.delivered.union(record.deliveryFailed).subseteq(record.sent.intersect(record.reported))
  val DeliveryNeedsSentAndReport = evidence(s.memory) and evidence(s.disk) and
    (s.parts==1 or s.memory.delivered.union(s.disk.delivered).union(s.memory.deliveryFailed).union(s.disk.deliveryFailed).size()==0)
  val ProviderRowsHaveOnePhase = s.outbox.intersect(s.sentRows.union(s.failedRows)).size()==0 and s.sentRows.intersect(s.failedRows).size()==0
  val safety = OneRadioCallPerRecipient and RadioNeedsDurableIntent and TombstoneRetiresLiveRecord
    and DeliveryNeedsSentAndReport and ProviderRowsHaveOnePhase

  action step = any {
    nondet kind=Set("image","send","phone","read","locked","role").oneOf()
    nondet allowed=Bool.oneOf()
    access(kind,allowed),
    nondet sim=0.to(3).oneOf()
    simAt(sim),
    refuseOutbox(true),refuseOutbox(false),age,prune,
    nondet actor=actors.oneOf()
    nondet binding=1.to(2).oneOf()
    nondet mode=Set("complete","long-number","divide-refused","empty-parts").oneOf()
    request(actor,binding,mode),
    nondet actor=actors.oneOf()
    nondet exact=Bool.oneOf()
    cancel(actor,exact),
    nondet actor=actors.oneOf()
    nondet mode=Set("pause","resume","screen","destroy").oneOf()
    lifecycle(actor,mode),
    nondet actor=actors.oneOf()
    nondet mode=dispatchModes.oneOf()
    approve(actor,mode),
    nondet actor=actors.oneOf()
    readback(actor),
    nondet kind=Set("none","wrong","ambiguous","exact").oneOf()
    nondet status=Set("none","pending","complete","failed").oneOf()
    provider(kind,status),
    reconcile,
    nondet index=1.to(4).oneOf()
    nondet kind=Set("sent","delivery").oneOf()
    nondet ok=Bool.oneOf()
    nondet mode=Set("complete","wrong-action","before","after").oneOf()
    callback(index,kind,ok,mode),
    restart(false),restart(true),
    s'=s
  }

  action reviewed=initWith(1,1,false).then(request(1,1,"complete"))
  action sent=reviewed.then(approve(1,"complete"))

  run conflictingReviewCannotClaimAnotherReceiptTest = reviewed.then(request(2,2,"complete"))
    .then(approve(1,"complete")).then(approve(2,"complete"))
    .expect(s.reply=="invalid" and s.replyBinding==0 and s.memory.binding==1 and s.attempts==1)

  run lateReviewUsesTombstoneBindingTest = reviewed.then(request(2,1,"complete"))
    .then(approve(1,"complete")).then(age).then(prune).then(approve(2,"complete"))
    .expect(s.reply=="expired" and s.replyBinding==0 and s.attempts==1)
    .then(restart(false)).then(request(1,2,"complete"))
    .expect(s.reply=="invalid" and s.tombstoneBinding==1 and s.attempts==1)

  run exactSecondReviewUsesFirstReceiptWithoutRadioTest = reviewed.then(request(2,1,"complete"))
    .then(approve(1,"complete")).then(approve(2,"complete"))
    .then(request(1,1,"complete"))
    .expect(s.reply=="submitted" and s.replyBinding==1 and s.attempts==1)

  run simChangeAfterFirstRecipientIsUnknownTest = initWith(2,1,false).then(request(1,1,"complete"))
    .then(approve(1,"guard-change")).expect(s.reply=="unknown" and s.accepted==1 and s.attempts==1)
    .then(request(2,1,"complete")).expect(s.reply=="unknown" and s.attempts==1)

  run callbackMemoryDoesNotImplyDurableEvidenceTest = sent.then(callback(1,"sent",true,"before"))
    .expect(s.memory.status=="sent" and s.disk.status=="submitted")
    .then(restart(false)).then(readback(2)).expect(s.reply=="submitted")

  run dispatchMarkerRefusalRecoversUnknownTest = reviewed.then(approve(1,"end-before"))
    .expect(s.memory.status=="submitted" and s.disk.dispatching)
    .then(restart(false)).then(request(2,1,"complete")).expect(s.reply=="unknown" and s.attempts==1)

  run providerReadbackRequiresReportAndUniqueRowTest = sent.then(provider("ambiguous","complete"))
    .then(callback(1,"sent",true,"complete")).then(callback(1,"delivery",false,"complete"))
    .expect(s.memory.status=="sent" and s.memory.rows==Set())
    .then(provider("exact","complete")).then(reconcile).expect(s.memory.status=="delivered")

  run multipartReportDoesNotProveDeliveryTest = initWith(1,2,false).then(request(1,1,"complete")).then(approve(1,"complete"))
    .then(provider("exact","complete")).then(callback(1,"sent",true,"complete")).then(callback(2,"sent",true,"complete"))
    .then(callback(1,"delivery",true,"complete")).then(callback(2,"delivery",true,"complete"))
    .expect(s.memory.status=="sent" and s.memory.delivered==Set())
}
