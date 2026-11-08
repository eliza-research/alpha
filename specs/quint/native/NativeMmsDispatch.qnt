// Actual Alpha MMS review, shared SMS/MMS ID ownership, and outgoing PDU custody.
// Binding 1 and 2 differ in reviewed attachment bytes. Binding 3 is SMS.
module NativeMmsDispatch {
  type Record = { binding: int, status: str, dispatching: bool, boot: int, row: bool }
  type Review = { binding: int, sim: bool }
  type State = {
    groupRecipients: bool, reviewA: Review, reviewB: Review,
    reply: str, replyKind: str, replyBinding: int, memory: Record, disk: Record,
    smsAttempts: int, mmsAttempts: int, mmsAccepted: int,
    files: int, mmsBox: int, deletedMms: int, events: int,
    role: bool, carrier: bool, size: bool, sim: bool, provider: bool, locked: bool, process: int, boot: int
  }
  var s: State
  val actors = Set(1,2)
  val noReview = {binding:0,sim:false}
  val noRecord = {binding:0,status:"none",dispatching:false,boot:0,row:false}

  action initWith(groupRecipients: bool): bool = s' = {
    groupRecipients:groupRecipients,reviewA:noReview,reviewB:noReview,reply:"none",replyKind:"none",replyBinding:0,
    memory:noRecord,disk:noRecord,smsAttempts:0,mmsAttempts:0,mmsAccepted:0,files:0,mmsBox:0,deletedMms:0,events:0,
    role:true,carrier:true,size:true,sim:true,provider:true,locked:false,process:1,boot:1
  }
  action init = {
    nondet groupRecipients=Bool.oneOf()
    initWith(groupRecipients)
  }

  pure def isMms(binding: int): bool = binding.in(Set(1,2))
  pure def wireKind(binding: int): str = if (isMms(binding)) "mms-send" else "sms-send"
  pure def reject(state: State, status: str): State = { ...state,reply:status,replyKind:"none",replyBinding:0 }
  pure def receipt(state: State): State = {
    ...state,reply:state.memory.status,replyKind:wireKind(state.memory.binding),replyBinding:state.memory.binding
  }
  pure def reviewOf(state: State, actor: int): Review = if (actor==1) state.reviewA else state.reviewB
  pure def reviewed(state: State, actor: int, review: Review): State =
    if (actor==1) { ...state,reviewA:review } else { ...state,reviewB:review }
  pure def blocked(state: State, binding: int): bool =
    state.locked or (isMms(binding) and not(state.role and state.carrier))
  pure def decide(state: State, binding: int, outcome: str): State =
    if (state.memory.binding!=0) reject(state,"unavailable")
    else {
      val record={ ...noRecord,binding:binding,status:outcome,boot:state.boot }
      receipt({ ...state,memory:record,disk:record })
    }

  action request(actor: int, binding: int, input: str): bool = all {
    actors.contains(actor), binding.in(1.to(3)), input=="valid" or (input=="bad-bytes" and isMms(binding)),
    s' = if (s.locked) reject(s,"unavailable")
      else if (input=="bad-bytes") reject(s,"invalid")
      else if (s.memory.binding!=0) (if (s.memory.binding==binding) receipt(s) else reject(s,"invalid"))
      else if (reviewOf(s,actor).binding!=0) reject(s,"busy")
      else if (blocked(s,binding)) decide(s,binding,"denied")
      else if (isMms(binding) and not(s.size)) reject(s,"too-large")
      else reject(reviewed(s,actor,{binding:binding,sim:s.sim}),"pending")
  }
  action cancel(actor: int, exact: bool): bool = all {
    actors.contains(actor), not(s.locked), reviewOf(s,actor).binding!=0,
    s' = if (exact) decide(reviewed(s,actor,noReview),reviewOf(s,actor).binding,"cancelled") else s
  }

  val modes = Set("complete","throw-before","throw-after","begin-before","end-before")
  action approve(actor: int, mode: str): bool = all {
    actors.contains(actor), modes.contains(mode),
    val review=reviewOf(s,actor)
    val binding=review.binding
    val mms=isMms(binding)
    all {
      binding!=0,
      mode=="complete" or (mms and s.memory.binding==0 and not(blocked(s,binding)) and review.sim==s.sim and (mode!="end-before" or s.provider)),
      val state=reviewed(s,actor,noReview)
      // The positive dispatch exception reads by ID for MMS; the staged SMS branch checks binding.
      s' = if (blocked(s,binding)) decide(state,binding,"denied")
        else if (s.memory.binding!=0) (if (mms or s.memory.binding==binding) receipt(state) else reject(state,"invalid"))
        else if (review.sim!=s.sim or mode=="begin-before") decide(state,binding,"denied")
        else {
          val row=if (mms) s.provider else s.role
          val submitted=mode!="throw-before" and mode!="throw-after"
          val record={binding:binding,status:if (submitted) "submitted" else "unknown",dispatching:false,boot:s.boot,row:row}
          val disk=if (mode=="end-before") { ...record,status:"unknown",dispatching:true } else record
          receipt({ ...state,memory:record,disk:disk,
            smsAttempts:if (mms) 0 else (if (s.groupRecipients) 2 else 1),
            mmsAttempts:if (mms) 1 else 0, mmsAccepted:if (mms and mode!="throw-before") 1 else 0,
            files:if (mms and submitted) 1 else 0,mmsBox:if (mms and row) 4 else 0,
            deletedMms:if (mms and not(row)) 1 else 0 })
        }
    }
  }

  action readback(actor: int, mms: bool): bool = all {
    actors.contains(actor),
    s' = if (s.locked) reject(s,"unavailable")
      else if (s.memory.binding==0 or isMms(s.memory.binding)!=mms) reject(s,"not-found")
      else receipt(s)
  }

  val callbackModes=Set("complete","bad-uri","foreign-kind","failure-conf","unreadable-conf","before","after")
  action callback(mode: str, ok: bool): bool = all {
    callbackModes.contains(mode), s.mmsAccepted==1, isMms(s.memory.binding), s.events<4,
    val finalAlready=s.memory.status.in(Set("sent","failed"))
    all {
      not(finalAlready and mode.in(Set("before","after"))),
      s' = if (mode.in(Set("bad-uri","foreign-kind"))) s
      else {
        val status=if (finalAlready) s.memory.status else if (ok and mode!="failure-conf") "sent" else "failed"
        val record={ ...s.memory,status:status }
        val disk=if (finalAlready or mode=="before") s.disk else record
        val box=if (not(mode.in(Set("before","after"))) and s.role and s.mmsBox==4)
          (if (status=="sent") 2 else 5) else s.mmsBox
        { ...s,memory:record,disk:disk,files:0,mmsBox:box,
          events:if (not(finalAlready) and not(s.locked) and not(mode.in(Set("before","after")))) s.events+1 else s.events }
      }
    }
  }

  val controlKinds=Set("role","carrier","size","sim","provider","locked")
  action controls(kind: str, allowed: bool): bool = all {
    controlKinds.contains(kind),
    s' = if (kind=="role") { ...s,role:allowed } else if (kind=="carrier") { ...s,carrier:allowed }
      else if (kind=="size") { ...s,size:allowed } else if (kind=="sim") { ...s,sim:allowed }
      else if (kind=="provider") { ...s,provider:allowed } else { ...s,locked:allowed }
  }

  action restart(reboot: bool): bool = all {
    s.process<3,
    val boot=if (reboot) s.boot+1 else s.boot
    val disk=s.disk
    val recovered=if (disk.dispatching or (reboot and disk.status=="submitted"))
      { ...disk,status:"unknown",dispatching:false } else disk
    s'=reject({ ...s,boot:boot,process:s.process+1,reviewA:noReview,reviewB:noReview,memory:recovered,disk:recovered,events:0 },"none")
  }

  val OneKindOwnsDispatch = s.smsAttempts<=2 and s.mmsAccepted<=s.mmsAttempts and s.mmsAttempts<=1
    and (s.smsAttempts==0 or s.mmsAttempts==0)
  val DurableHandoffBinding = (s.mmsAttempts==0 or isMms(s.disk.binding)) and (s.smsAttempts==0 or s.disk.binding==3)
  val PduHeldForAcceptedMms = s.files==0 or (s.files==1 and s.mmsAccepted==1 and isMms(s.disk.binding))
  val MmsNeverClaimsDelivery = (not(isMms(s.memory.binding)) or s.memory.status!="delivered")
    and (not(isMms(s.disk.binding)) or s.disk.status!="delivered") and (s.replyKind!="mms-send" or s.reply!="delivered")
  val OutboxOnlyForMms = s.mmsBox==0 or (isMms(s.disk.binding) and s.disk.row)
  val safety = OneKindOwnsDispatch and DurableHandoffBinding and PduHeldForAcceptedMms and MmsNeverClaimsDelivery and OutboxOnlyForMms

  action step = any {
    nondet actor=actors.oneOf()
    nondet binding=1.to(3).oneOf()
    nondet input=Set("valid","bad-bytes").oneOf()
    request(actor,binding,input),
    nondet actor=actors.oneOf()
    nondet exact=Bool.oneOf()
    cancel(actor,exact),
    nondet actor=actors.oneOf()
    nondet mode=modes.oneOf()
    approve(actor,mode),
    nondet actor=actors.oneOf()
    nondet mms=Bool.oneOf()
    readback(actor,mms),
    nondet mode=callbackModes.oneOf()
    nondet ok=Bool.oneOf()
    callback(mode,ok),
    nondet kind=controlKinds.oneOf()
    nondet allowed=Bool.oneOf()
    controls(kind,allowed),
    restart(false),restart(true),s'=s
  }

  action reviewedA = initWith(false).then(request(1,1,"valid"))
  action handedA = reviewedA.then(approve(1,"complete"))

  run conflictingAttachmentReceivesForeignReceiptAsBuiltTest = reviewedA.then(request(2,2,"valid"))
    .then(approve(1,"complete")).then(approve(2,"complete"))
    .expect(s.replyBinding==1 and s.replyKind=="mms-send" and s.mmsAttempts==1 and s.files==1)
    .then(request(2,2,"valid")).expect(s.reply=="invalid")

  run mmsCanReturnSmsWireReceiptAsBuiltTest = initWith(false).then(request(1,3,"valid")).then(request(2,1,"valid"))
    .then(approve(1,"complete")).then(approve(2,"complete"))
    .expect(s.replyKind=="sms-send" and s.replyBinding==3 and s.smsAttempts==1 and s.mmsAttempts==0 and s.files==0)
    .then(readback(2,true)).expect(s.reply=="not-found")

  run stagedSmsRejectsMmsReceiptTest = reviewedA.then(request(2,3,"valid")).then(approve(1,"complete"))
    .then(approve(2,"complete")).expect(s.reply=="invalid" and s.mmsAttempts==1 and s.smsAttempts==0)

  run exactMmsReviewRetriesOnceTest = reviewedA.then(request(2,1,"valid")).then(approve(1,"complete"))
    .then(approve(2,"complete")).expect(s.reply=="submitted" and s.replyBinding==1 and s.mmsAttempts==1 and s.files==1)

  run invalidAttachmentDoesNotOpenReviewTest = initWith(false).then(request(1,1,"bad-bytes"))
    .expect(s.reply=="invalid" and s.reviewA.binding==0 and s.mmsAttempts==0)

  run carrierFailureOverridesAndroidSuccessTest = handedA.then(callback("bad-uri",true)).then(callback("foreign-kind",true))
    .expect(s.files==1 and s.memory.status=="submitted").then(callback("failure-conf",true))
    .expect(s.memory.status=="failed" and s.files==0 and s.mmsBox==5)

  run providerChildRefusalKeepsRadioAndDeletesPartialRowTest = reviewedA.then(controls("provider",false))
    .then(approve(1,"complete")).expect(s.deletedMms==1 and s.mmsAttempts==1 and not(s.disk.row))
    .then(callback("complete",true)).expect(s.memory.status=="sent" and s.mmsBox==0 and s.files==0)

  run failedCallbackWriteDeletesPduButLosesEvidenceOnRestartTest = handedA.then(callback("before",true))
    .expect(s.files==0 and s.memory.status=="sent" and s.disk.status=="submitted" and s.mmsBox==4)
    .then(restart(false)).expect(s.memory.status=="submitted" and s.mmsAttempts==1)

  run interruptedHandoffRecoversWithoutResendTest = reviewedA.then(approve(1,"end-before")).then(restart(false))
    .expect(s.disk.status=="unknown" and s.files==1).then(request(2,1,"valid"))
    .expect(s.reply=="unknown" and s.mmsAttempts==1).then(callback("complete",true))
    .expect(s.disk.status=="sent" and s.files==0)
}
