// Exact selected action-journal recovery, durable write receipts and passive read projection.
module NativeActionRecovery {
  type State = {kind: str, phase: str, attempt: bool, claim: bool, completeBinding: bool, result: str,
    proof: str, status: str, notice: str, visible: bool, live: bool, process: int,
    method: str, requestedBinding: str, reply: str, replyResult: str, noticeReads: int, deletionReads: int,
    reminderReads: int, matches: int, noticeWrites: int, journalWrites: int}
  var s: State

  val kinds = Set("notice","calendar-delete","reminder-cancel","reminder-read","reminder-complete","reminder-create","reminder-update","reminder-snooze",
    "workflow-read","calendar-read","note-read","note-query","maps-read",
    "note-write","calendar-write","files-write","camera-capture","browser-navigate","view-only")
  /// Journaled operation classes for which this native recovery has no receipt reader. Their
  /// saved results are reconciled only by the shared coordinator from its own exact saved
  /// receipts (camera, Calendar, Notes); navigation and Browser opens have no proof at all.
  val unproven = Set("note-write","calendar-write","files-write","camera-capture","browser-navigate","view-only")
  val phases = Set("absent","reserved","applying","unknown","failed","succeeded")
  val methods = Set("notice","deletion","reminder","list","get")
  val addresses = Set("exact","scope","proposal","invalid")
  val candidates = Set("exact","foreign","wrong")
  val faults = Set("none","journal-read","notice-read","receipt-read",
    "notice-before","notice-after","journal-before","journal-after")
  val statuses = Set("missing","applying","unknown","failed","succeeded","withdrawn",
    "deleted","undone","conflict","dispatching")
  val proofs = Set("exact","foreign","payload","owner","proposal","hash","target","operation",
    "outcome","effects","missing-result","result")

  pure def deletionKind(kind: str): bool = kind.in(Set("calendar-delete","reminder-cancel"))
  pure def reminderKind(kind: str): bool = kind.in(Set("reminder-read","reminder-complete","reminder-create","reminder-update","reminder-snooze","reminder-cancel"))
  pure def settled(phase: str): bool = phase.in(Set("succeeded","failed"))
  pure def eligible(phase: str): bool = phase.in(Set("applying","unknown"))

  pure def resultFor(kind: str): str =
    if (kind=="notice") "operation"
    else if (kind=="reminder-create") "reminder-create"
    else if (reminderKind(kind) and kind!="reminder-read") "reminder"
    else if (kind=="workflow-read") "workflow"
    else if (kind=="note-read") "note"
    else if (kind=="note-query") "query"
    else if (kind=="maps-read") "maps"
    else kind

  pure def passive(result: str): str =
    if (result=="workflow") "workflow-retained"
    else if (result=="calendar-read") "calendar-retained"
    else if (result=="note") "note-retained"
    else if (result=="query") "query-retained"
    else if (result=="maps") "maps-retained"
    else if (result=="reminder-read") "reminder-retained"
    else result

  action initWithMetadata(kind: str, phase: str, attempt: bool, claim: bool, completeBinding: bool): bool = all {
    kind.in(kinds), phase.in(phases),
    if (phase.in(Set("applying","succeeded"))) attempt else if (phase.in(Set("absent","reserved"))) not(attempt) else true,
    not(claim) or (attempt and deletionKind(kind)),
    s'={kind:kind,phase:phase,attempt:attempt,claim:claim,completeBinding:completeBinding,result:if (phase=="succeeded") resultFor(kind) else "none",
      proof:"exact",status:"missing",notice:"missing",visible:false,live:true,process:1,method:"none",requestedBinding:"none",reply:"none",replyResult:"none",
      noticeReads:0,deletionReads:0,reminderReads:0,matches:0,noticeWrites:0,journalWrites:0}
  }
  action initWith(kind: str, phase: str, attempt: bool, claim: bool): bool =
    initWithMetadata(kind,phase,attempt,claim,true)
  action init = {
    nondet kind=kinds.oneOf()
    nondet phase=phases.oneOf()
    nondet hasAttempt=Bool.oneOf()
    nondet hasClaim=Bool.oneOf()
    nondet completeBinding=Bool.oneOf()
    val attempt=phase.in(Set("applying","succeeded")) or (phase.in(Set("unknown","failed")) and hasAttempt)
    initWithMetadata(kind,phase,attempt,attempt and deletionKind(kind) and hasClaim,completeBinding)
  }

  // Child receipts are synthetic durable input. Only NoticeDelivery's readback may update its own receipt.
  pure def validReceipt(kind: str, status: str, proof: str): bool =
    if (status=="missing") proof=="exact"
    else if (kind=="notice")
      status.in(Set("applying","unknown","failed","succeeded","withdrawn")) and proof.in(Set("exact","foreign","payload"))
    else if (deletionKind(kind))
      status.in(Set("deleted","undone","conflict","dispatching","unknown")) and
      (if (kind=="calendar-delete") proof.in(Set("exact","owner","proposal","hash","target","operation","outcome"))
       else proof.in(Set("exact","owner","proposal","hash","target","operation","payload","effects","missing-result","result")))
    else reminderKind(kind) and status.in(Set("succeeded","unknown")) and proof.in(Set("exact","foreign","payload","result"))

  action receipt(status: str, proof: str, visible: bool): bool = all {
    validReceipt(s.kind,status,proof),
    s'={...s,status:status,proof:proof,visible:visible,notice:if (s.kind=="notice") status else "missing"}
  }

  pure def refuse(st: State): State = {...st,reply:"refused",replyResult:"none"}
  pure def unchanged(st: State): State = {...st,reply:st.phase,replyResult:st.result}
  pure def absent(st: State): State = {...st,reply:"absent",replyResult:"none"}
  pure def commit(st: State, phase: str, result: str, fault: str): State = {
    val attempted={...st,journalWrites:1}
    if (fault=="journal-before") refuse(attempted)
    else {
      val persisted={...attempted,phase:phase,result:result}
      if (fault=="journal-after") refuse(persisted) else unchanged(persisted)
    }
  }

  pure def notificationReceipt(st: State, fault: str): State = {
    val reading={...st,noticeReads:1}
    if (fault=="notice-read" or (st.notice!="missing" and st.proof!="exact")) refuse(reading)
    else if (st.notice=="succeeded") commit(reading,"succeeded","operation",fault)
    else if (st.notice.in(Set("applying","unknown"))) {
      val checked={...reading,matches:1}
      val nextNotice=if (st.visible) "succeeded" else "unknown"
      if (nextNotice==st.notice) unchanged(checked)
      else {
        val attempted={...checked,noticeWrites:1}
        if (fault=="notice-before") refuse(attempted)
        else {
          val persisted={...attempted,notice:nextNotice}
          if (fault=="notice-after") refuse(persisted)
          else if (nextNotice=="succeeded") commit(persisted,"succeeded","operation",fault)
          else unchanged(persisted)
        }
      }
    }
    else unchanged(reading)
  }

  pure def notification(st: State, candidate: str, fault: str): State =
    if (st.kind!="notice" or candidate!="exact" or not(st.completeBinding)) refuse(st)
    else if (settled(st.phase)) unchanged(st)
    else if (not(st.attempt and eligible(st.phase))) refuse(st)
    else notificationReceipt(st,fault)

  pure def reminder(st: State, candidate: str, fault: str): State =
    if (not(reminderKind(st.kind))) refuse(st)
    else if (settled(st.phase)) unchanged(st)
    else if (not(eligible(st.phase)) or candidate!="exact" or not(st.completeBinding)) refuse(st)
    else {
      val reading={...st,reminderReads:1}
      val cancelled=st.kind=="reminder-cancel"
      val found=if (cancelled) st.status=="deleted" and st.proof!="missing-result" else st.status!="missing"
      val succeeded=if (cancelled) found else st.status=="succeeded"
      if (fault=="receipt-read") refuse(reading)
      else if (not(found)) unchanged(reading)
      else if (st.proof=="foreign" or (st.proof=="payload" and not(cancelled))) refuse(reading)
      else if (not(succeeded)) unchanged(reading)
      else if (not(st.attempt) or st.proof=="result") refuse(reading)
      else commit(reading,"succeeded",resultFor(st.kind),fault)
    }

  pure def deletion(st: State, fault: str): State =
    if (not(deletionKind(st.kind))) unchanged(st)
    else {
      val read={...st,deletionReads:1}
      val obtained={...read,reminderReads:if (st.kind=="reminder-cancel" and st.status!="missing") 1 else 0}
      val matched=st.claim and eligible(st.phase) and
        not(st.proof.in(Set("owner","proposal","hash","target","operation","payload")))
      val complete=st.proof=="exact" or (st.kind=="calendar-delete" and st.proof!="outcome")
      if (fault=="receipt-read") refuse(read)
      else if (not(matched)) unchanged(obtained)
      else if (st.status.in(Set("undone","conflict"))) commit(obtained,"failed","operation",fault)
      else if (st.status=="deleted" and complete) commit(obtained,"succeeded",resultFor(st.kind),fault)
      else unchanged(obtained)
    }

  pure def dispatch(st: State, method: str, address: str, candidate: str, fault: str): State = {
    val ready={...st,method:method,requestedBinding:candidate,noticeReads:0,deletionReads:0,reminderReads:0,matches:0,noticeWrites:0,journalWrites:0}
    val present=st.phase!="absent" and address!="scope" and (method=="list" or address!="proposal")
    if (not(st.live) or address=="invalid" or fault=="journal-read") refuse(ready)
    else if (not(present)) (if (method.in(Set("notice","reminder"))) refuse(ready) else absent(ready))
    else if (method=="list") {...ready,reply:st.phase,replyResult:passive(st.result)}
    else if (method=="get") unchanged(ready)
    else if (method=="notice") notification(ready,candidate,fault)
    else if (method=="reminder") reminder(ready,candidate,fault)
    else deletion(ready,fault)
  }

  action call(method: str,address: str,candidate: str,fault: str): bool = all {
    method.in(methods),address.in(addresses),candidate.in(candidates),fault.in(faults),
    s'=dispatch(s,method,address,candidate,fault)
  }
  action retire: bool = all {s.live,s'={...s,live:false}}
  action restart: bool = all {s.process<3,s'={...s,live:true,process:s.process+1}}

  val SuccessRequiresAdmission = s.phase!="succeeded" or s.attempt
  val ClaimedDeletionRetainsAttempt = not(s.claim) or (deletionKind(s.kind) and s.attempt)
  val PassiveReadOnly = not(s.method.in(Set("get","list"))) or
    (s.noticeReads==0 and s.reminderReads==0 and s.deletionReads==0 and s.noticeWrites==0 and s.journalWrites==0)
  val IndependentCommitBoundaries = s.noticeWrites<=s.noticeReads and s.matches<=s.noticeReads and
    s.journalWrites<=1 and (s.noticeWrites==0 or s.method=="notice")
  val RedactedPassiveReads = s.method!="list" or
    not(s.replyResult.in(Set("workflow","calendar-read","note","query","maps","reminder-read")))
  val ReminderLookupUsesSelectedBinding = s.method!="reminder" or s.reminderReads==0 or
    (s.requestedBinding=="exact" and s.completeBinding)
  /// No notice, reminder or deletion recovery call settles a row of an unproven kind.
  val NoNativeProofNeverSettles = not(s.kind.in(unproven)) or (s.journalWrites==0 and s.noticeWrites==0)
  val ViewOnlyNeverRecoversToSuccess = not(s.kind.in(Set("view-only","browser-navigate"))) or
    (s.journalWrites==0 and s.noticeReads==0 and s.reminderReads==0)
  val safety = all {SuccessRequiresAdmission,ClaimedDeletionRetainsAttempt,PassiveReadOnly,
    NoNativeProofNeverSettles,ViewOnlyNeverRecoversToSuccess,
    IndependentCommitBoundaries,RedactedPassiveReads,ReminderLookupUsesSelectedBinding}

  action step = any {
    { nondet status=statuses.oneOf(); nondet proof=proofs.oneOf(); nondet visible=Bool.oneOf(); receipt(status,proof,visible) },
    { nondet method=methods.oneOf(); nondet address=addresses.oneOf(); nondet candidate=candidates.oneOf();
      nondet fault=faults.oneOf(); call(method,address,candidate,fault) },
    retire,restart,s'=s,
  }

  run noticeReceiptCommitCanOutliveJournalTest = initWith("notice","applying",true,false)
    .then(receipt("applying","exact",true))
    .then(call("notice","exact","exact","notice-after"))
    .expect(s.notice=="succeeded" and s.phase=="applying" and s.reply=="refused")
    .then(call("notice","exact","exact","journal-after"))
    .expect(s.phase=="succeeded" and s.reply=="refused")
    .then(restart).then(call("notice","exact","exact","none"))
    .expect(s.reply=="succeeded" and s.noticeReads==0 and s.journalWrites==0)
  run noticeExactBindingBeforeReadTest = initWith("notice","applying",true,false)
    .then(receipt("succeeded","exact",false)).then(call("notice","exact","foreign","none"))
    .expect(s.reply=="refused" and s.noticeReads==0 and s.phase=="applying")
  run deletionRequiresExactProofTest = initWith("calendar-delete","unknown",true,true)
    .then(receipt("deleted","owner",false)).then(call("deletion","exact","exact","none"))
    .expect(s.phase=="unknown").then(receipt("deleted","exact",false))
    .then(call("deletion","exact","exact","none")).expect(s.phase=="succeeded" and s.result=="calendar-delete")
  run deletionUndoCannotBecomeSuccessTest = initWith("calendar-delete","applying",true,true)
    .then(receipt("undone","exact",false)).then(call("deletion","exact","exact","none"))
    .expect(s.phase=="failed" and s.result=="operation")
  run reminderForeignBindingRefusedBeforeLookupTest = initWith("reminder-read","applying",true,false)
    .then(receipt("succeeded","foreign",false)).then(call("reminder","exact","foreign","none"))
    .expect(s.phase=="applying" and s.reminderReads==0 and s.journalWrites==0 and s.reply=="refused")
    .then(call("reminder","exact","exact","none"))
    .expect(s.phase=="applying" and s.reminderReads==1 and s.reply=="refused")
    .then(receipt("succeeded","exact",false)).then(call("reminder","exact","exact","none"))
    .expect(s.phase=="succeeded" and s.result=="reminder-read" and s.journalWrites==1)
  run passiveReminderFieldsRetainedForExactGetTest = initWith("reminder-read","succeeded",true,false)
    .then(call("list","exact","exact","none")).expect(s.replyResult=="reminder-retained" and s.journalWrites==0)
    .then(call("get","exact","exact","none")).expect(s.replyResult=="reminder-read")
  run settledLegacyReminderStillReadableTest = initWithMetadata("reminder-read","succeeded",true,false,false)
    .then(call("reminder","exact","foreign","none"))
    .expect(s.reply=="succeeded" and s.replyResult=="reminder-read" and s.reminderReads==0)
    .then(call("list","exact","exact","none")).expect(s.replyResult=="reminder-retained")
  run legacyReminderWithoutBindingCannotSettleTest = initWithMetadata("reminder-read","applying",true,false,false)
    .then(receipt("succeeded","exact",false)).then(call("reminder","exact","exact","none"))
    .expect(s.phase=="applying" and s.reminderReads==0 and s.reply=="refused")
  run passiveNoteDoesNotMutateExactReadTest = initWith("note-query","succeeded",true,false)
    .then(call("list","exact","exact","none")).expect(s.replyResult=="query-retained" and s.result=="query")
    .then(call("get","exact","exact","none")).expect(s.replyResult=="query")
  run retiredBridgeCannotRecoverTest = initWith("notice","applying",true,false)
    .then(receipt("succeeded","exact",false)).then(retire).then(call("notice","exact","exact","none"))
    .expect(s.reply=="refused" and s.phase=="applying" and s.noticeReads==0)
  run unprovenKindsStayUnsettledTest = initWith("camera-capture","applying",true,false)
    .then(call("notice","exact","exact","none")).expect(safety and s.reply=="refused" and s.phase=="applying")
    .then(call("reminder","exact","exact","none")).expect(safety and s.reply=="refused" and s.phase=="applying")
    .then(call("deletion","exact","exact","none")).expect(safety and s.phase=="applying" and s.journalWrites==0)
    .then(call("get","exact","exact","none")).expect(safety and s.reply=="applying")
  run viewOnlyNeverRecoversTest = initWith("view-only","unknown",true,false)
    .then(call("notice","exact","exact","none")).then(call("reminder","exact","exact","none"))
    .then(call("deletion","exact","exact","none"))
    .expect(safety and s.phase=="unknown" and s.journalWrites==0 and s.reminderReads==0)
}
