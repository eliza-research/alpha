// Alpha's problem-log worker, installed journal, and Android exit-history watermark.
module NativeCrashJournal {
  type Row = {at: int, stamp: str, source: str, kind: str, detail: str, process: str, extra: bool}
  type Disk = {format: str, watermark: int, fillers: int, rows: List[Row]}
  type Request = {op: str, kind: str, cls: str}
  type Reply = {owner: int, outcome: str, fillers: int, rows: List[Row], exitHistory: bool}
  type State = {
    now: int, a: Request, b: Request, closedA: bool, closedB: bool, disk: Disk,
    history: Set[int], historyMode: str, held: int, captured: Set[int], reply: Reply, delegated: int
  }
  var s: State
  val lanes=Set(1,2)
  val retention=2592000000
  val cap=50
  val epochs=Set(1,2,3,4)
  val seeds=Set("empty","capacity","ages","legacy","unsafe","corrupt","oversize")
  val lastSafeOffset=9005439254740991
  val modes=Set("available","old","absent","refused")
  val faults=Set("none","before","staged","after")
  val kinds=Set("startup","render","uncaught")
  val classes=Set("TypeError","RangeError","dirty")
  val noRequest={op:"none",kind:"",cls:""}
  val noDisk={format:"missing",watermark:0,fillers:0,rows:List()}
  val noReply={owner:0,outcome:"none",fillers:0,rows:List(),exitHistory:false}

  pure def renderer(at: int, kind: str, cls: str): Row =
    {at:at,stamp:"safe",source:"renderer",kind:kind,detail:if (cls=="dirty") "Error" else cls,process:"main",extra:false}
  pure def exitRow(id: int): Row = {
    at:id,stamp:"safe",source:"exit",kind:"",detail:if (id==3) "anr" else "crash",
    process:if (id==3) ":isolated_pdf" else if (id==4) "other" else "main",extra:false
  }
  pure def seeded(seed: str): Disk = if (seed=="empty") noDisk
    else if (seed=="capacity") { ...noDisk,format:"valid",fillers:cap }
    else if (seed=="corrupt" or seed=="oversize") { ...noDisk,format:seed }
    else if (seed=="legacy") { ...noDisk,format:"valid",rows:List(
      { ...renderer(1,"startup","TypeError"),extra:true },renderer(2,"render","RangeError"),
      { ...renderer(3,"startup","StringTime"),stamp:"text" },{ ...renderer(4,"startup","FractionTime"),stamp:"fraction" }) }
    else if (seed=="unsafe") { ...noDisk,format:"valid",rows:List(
      renderer(lastSafeOffset,"startup","LastSafeTime"),{ ...renderer(lastSafeOffset+1,"startup","UnsafeTime"),stamp:"unsafe" }) }
    else { ...noDisk,format:"valid",rows:List(
      renderer(10-retention,"startup","ExpiredBoundary"),renderer(11-retention,"startup","RetainedBoundary"),
      renderer(10+retention,"startup","FutureBoundary"),renderer(11+retention,"startup","TooFarFuture")) }

  action initWith(seed: str): bool = all {
    seeds.contains(seed),
    s'={now:if (seed=="unsafe") lastSafeOffset else 10,a:noRequest,b:noRequest,closedA:false,closedB:false,disk:seeded(seed),
      history:Set(),historyMode:"available",held:0,captured:Set(),reply:noReply,delegated:0}
  }
  // Exhaustive aliases of the original init seed choice; actions and safety are unchanged.
  action proofInitEmpty = initWith("empty")
  action proofInitCapacity = initWith("capacity")
  action proofInitAges = initWith("ages")
  action proofInitLegacy = initWith("legacy")
  action proofInitUnsafe = initWith("unsafe")
  action proofInitCorrupt = initWith("corrupt")
  action proofInitOversize = initWith("oversize")

  action init = {
    nondet seed=seeds.oneOf()
    initWith(seed)
  }

  pure def pending(state: State, actor: int): Request = if (actor==1) state.a else state.b
  pure def closed(state: State, actor: int): bool = if (actor==1) state.closedA else state.closedB
  pure def withPending(state: State, actor: int, req: Request): State =
    if (actor==1) { ...state,a:req } else { ...state,b:req }
  pure def response(state: State, actor: int, outcome: str): State =
    { ...state,reply:{ ...noReply,owner:actor,outcome:outcome } }
  pure def admittedInput(op: str, kind: str, cls: str): bool =
    if (op=="record") kind.in(kinds.union(Set("bad-kind"))) and classes.contains(cls)
    else op.in(Set("read","clear")) and kind=="" and cls==""

  action enqueue(actor: int, op: str, kind: str, cls: str): bool = all {
    lanes.contains(actor), admittedInput(op,kind,cls), pending(s,actor).op=="none",
    s'=if (closed(s,actor)) response(s,actor,"closed")
      else response(withPending(s,actor,{op:op,kind:kind,cls:cls}),actor,"pending")
  }
  action destroy(actor: int): bool = all {
    lanes.contains(actor), not(closed(s,actor)),
    s'=if (actor==1) { ...s,closedA:true } else { ...s,closedB:true }
  }

  pure def decoded(disk: Disk): Disk = if (disk.format=="valid") disk else noDisk
  pure def retained(at: int, now: int): bool = at>now-retention and at<=now+retention
  pure def pruned(disk: Disk, now: int): Disk = {
    val rows=disk.rows.foldl(List(),(acc,row)=>if (retained(row.at,now)) acc.append(row) else acc)
    val available=cap-rows.length()
    val fillers=if (not(retained(1,now))) 0 else if (disk.fillers<=available) disk.fillers else available
    { ...disk,rows:rows,fillers:fillers }
  }
  pure def replaced(state: State, doc: Disk, fault: str): State =
    if (fault.in(Set("before","staged"))) state
    else { ...state,disk:pruned({ ...doc,format:"valid" },state.now) }
  pure def harvested(disk: Disk, history: Set[int]): Disk =
    List(4,3,2,1).foldl(disk,(doc,id)=>if (history.contains(id) and id>disk.watermark)
      { ...doc,watermark:if (id>doc.watermark) id else doc.watermark,
        rows:if (id==2) doc.rows else doc.rows.append(exitRow(id)) }
      else doc)

  pure def complete(state: State, actor: int, fault: str, history: Set[int]): State = {
    val req=pending(state,actor)
    val base=withPending(state,actor,noRequest)
    val doc=decoded(state.disk)
    if (req.op=="record" and not(kinds.contains(req.kind))) response(base,actor,"rejected")
    else if (req.op=="record") response(replaced(base,{ ...doc,rows:doc.rows.append(renderer(state.now,req.kind,req.cls)) },fault),
      actor,if (fault=="none") "ok" else "rejected")
    else if (req.op=="clear") response(replaced(base,{ ...doc,rows:List(),fillers:0 },fault),
      actor,if (fault=="none") "ok" else "rejected")
    else {
      val collected=harvested(doc,history)
      val read=if (collected==doc) base else replaced(base,collected,fault)
      val visible=pruned(decoded(read.disk),state.now)
      val rows=visible.rows.foldl(List(),(acc,row)=>if (row.stamp=="safe") acc.append({ ...row,extra:false }) else acc)
      { ...read,reply:{owner:actor,outcome:"read",fillers:visible.fillers,rows:rows,exitHistory:state.historyMode!="old"} }
    }
  }
  action settle(actor: int, fault: str): bool = all {
    lanes.contains(actor), faults.contains(fault), s.held!=actor, pending(s,actor).op!="none",
    s.disk.rows.length()<12 or pending(s,actor).op=="clear",
    s'=complete(s,actor,fault,if (s.historyMode=="available") s.history else Set())
  }
  action beginHeld(actor: int): bool = all {
    lanes.contains(actor), pending(s,actor).op=="read", s.held==0, s.historyMode=="available",
    s'={ ...s,held:actor,captured:s.history }
  }
  action finishHeld(fault: str): bool = all {
    faults.contains(fault), s.held!=0, s.disk.rows.length()<12,
    s'=complete({ ...s,held:0,captured:Set() },s.held,fault,s.captured)
  }
  action historyMode(mode: str): bool = all {
    modes.contains(mode), s.held==0,
    s'={ ...s,historyMode:mode }
  }
  action exit(id: int): bool = all {
    epochs.contains(id), not(s.history.contains(id)),
    s'={ ...s,history:s.history.union(Set(id)) }
  }
  action time(now: int): bool = all {
    now.in(Set(10,20,30,10+retention)), s'={ ...s,now:now }
  }
  action uncaught = all {
    s.delegated<2, s.disk.rows.length()<12,
    val doc=decoded(s.disk)
    val row={at:s.now,stamp:"safe",source:"uncaught",kind:"",detail:"java.lang.IllegalStateException",process:"main",extra:false}
    s'=replaced({ ...s,delegated:s.delegated+1 },{ ...doc,rows:doc.rows.append(row) },"none")
  }

  val BoundedJournal = s.disk.fillers>=0 and s.disk.fillers+s.disk.rows.length()<=cap
    and s.reply.fillers>=0 and s.reply.fillers+s.reply.rows.length()<=cap
  val ExactHeldRead = if (s.held==0) s.captured==Set() else
    lanes.contains(s.held) and pending(s,s.held).op=="read" and s.captured.subseteq(s.history)
  val KnownExitWatermark = s.disk.watermark==0 or s.history.contains(s.disk.watermark)
  val BridgeRowsAllowlisted = s.reply.rows.indices().forall(index=> {
    val row=s.reply.rows.nth(index)
    not(row.extra) and row.stamp=="safe"
  })
  val safety = BoundedJournal and ExactHeldRead and KnownExitWatermark and BridgeRowsAllowlisted

  action step = any {
    nondet actor=lanes.oneOf()
    nondet kind=kinds.union(Set("bad-kind")).oneOf()
    nondet cls=classes.oneOf()
    enqueue(actor,"record",kind,cls),
    nondet actor=lanes.oneOf()
    nondet op=Set("read","clear").oneOf()
    enqueue(actor,op,"",""),
    nondet actor=lanes.oneOf()
    nondet fault=faults.oneOf()
    settle(actor,fault),
    nondet actor=lanes.oneOf()
    beginHeld(actor),
    nondet fault=faults.oneOf()
    finishHeld(fault),
    nondet actor=lanes.oneOf()
    destroy(actor),
    nondet mode=modes.oneOf()
    historyMode(mode),
    nondet id=epochs.oneOf()
    exit(id),
    nondet now=Set(10,20,30,10+retention).oneOf()
    time(now),
    uncaught,s'=s
  }

  run retiredWorkerDrainsOnlyAcceptedWorkTest = initWith("empty").then(enqueue(1,"record","startup","dirty"))
    .then(destroy(1)).then(settle(1,"none")).expect(s.disk.rows.head().detail=="Error")
    .then(enqueue(1,"clear","","")).expect(s.reply.outcome=="closed" and s.disk.rows.length()==1)
  run capEvictsOldestBeforeAppendTest = initWith("capacity").then(enqueue(1,"record","render","TypeError"))
    .then(settle(1,"none")).expect(s.disk.fillers==49 and s.disk.rows.length()==1 and safety)
  run readPrunesAgeWithoutRewritingDiskTest = initWith("ages").then(enqueue(1,"read","","")).then(settle(1,"none"))
    .expect(s.reply.rows.length()==2 and s.disk.rows.length()==4)
  run clearPreservesImportedExitWatermarkTest = initWith("empty").then(exit(1)).then(exit(2))
    .then(enqueue(1,"read","","")).then(settle(1,"none")).expect(s.disk.watermark==2 and s.disk.rows.length()==1)
    .then(enqueue(2,"clear","","")).then(settle(2,"none"))
    .then(enqueue(1,"read","","")).then(settle(1,"none")).expect(s.reply.rows.length()==0 and s.disk.watermark==2)
  run heldPreClearSnapshotImportsUnseenExitAsBuiltTest = initWith("empty").then(exit(3)).then(enqueue(1,"read","",""))
    .then(beginHeld(1)).then(enqueue(2,"clear","","")).then(settle(2,"none"))
    .then(finishHeld("none")).expect(s.disk.rows.length()==1 and s.disk.watermark==3)
  run bridgeRedactsSeededFieldsAndMalformedTimesTest = initWith("legacy").then(enqueue(1,"read","","")).then(settle(1,"none"))
    .expect(s.reply.rows.length()==2 and not(s.reply.rows.head().extra) and s.disk.rows.head().extra and s.disk.rows.length()==4)
  run bridgeKeepsLastSafeIntegerAndDropsLargerTimestampTest = initWith("unsafe").then(enqueue(1,"read","","")).then(settle(1,"none"))
    .expect(s.reply.rows.length()==1 and s.reply.rows.head().at==lastSafeOffset and s.disk.rows.length()==2)
  run writeMayReportFailureAfterReplacementTest = initWith("empty").then(enqueue(1,"record","render","TypeError"))
    .then(settle(1,"after")).expect(s.reply.outcome=="rejected" and s.disk.rows.length()==1)
}
