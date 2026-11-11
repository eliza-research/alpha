/// One authenticated CalendarApprovalClient read admission, consumed before POST.
module CalendarApprovalReview {
  type State = {epoch:int, readEpoch:int, reading:bool, admitted:bool, pending:bool,
    aborted:bool, unchanged:bool, matched:bool, inFlight:bool, dispatches:int, decision:str, returned:str}
  var s: State
  action init = s' = {epoch:0,readEpoch:-1,reading:false,admitted:false,pending:false,
    aborted:false,unchanged:true,matched:false,inFlight:false,dispatches:0,decision:"none",returned:"none"}
  val current = s.readEpoch == s.epoch and not(s.aborted)
  action read = all {not(s.reading or s.admitted or s.inFlight), s.readEpoch == -1,
    s' = {...s,readEpoch:s.epoch,reading:true}}
  action readReply(found:bool,pending:bool):bool = all {s.reading,current,
    s' = {...s,reading:false,admitted:found,pending:found and pending,
      returned:if(found)"read" else "missing"}}
  action readFailed = all {s.reading,
    s' = {...s,reading:false,returned:"error"}}
  action retire = all {s.epoch<2,s'={...s,epoch:s.epoch+1}}
  action abort = s'={...s,aborted:true}
  action mutate(pending:bool):bool = all {s.admitted or s.dispatches>0,
    s'={...s,unchanged:false,pending:pending}}
  action decide(decision:str):bool = all {
    s.admitted,s.pending,s.unchanged,current,not(s.inFlight),s.dispatches==0,
    decision.in(Set("approve","reject")),
    s'={...s,admitted:false,inFlight:true,dispatches:1,decision:decision,returned:"read",
      matched:s.admitted and s.pending and s.unchanged and current}}
  action refused(exact:bool):bool = all {
    not(exact) or not(s.admitted and s.pending and s.unchanged and current) or s.inFlight,s'=s}
  action result(kind:str):bool = all {s.inFlight,
    kind.in(Set("succeeded","rejected","invalidated","retryable","blocked","error")),
    (not(current)) implies kind=="error",
    s.decision=="reject" implies kind.in(Set("rejected","error")),
    s'={...s,inFlight:false,returned:kind}}
  action step = any {read,readReply(true,true),readReply(true,false),readReply(false,false),readFailed,
    retire,abort,mutate(true),mutate(false),decide("approve"),decide("reject"),refused(true),refused(false),
    result("succeeded"),result("rejected"),result("invalidated"),result("retryable"),result("blocked"),result("error"),s'=s}
  val OneDecisionPerRead = s.dispatches.in(0.to(1))
  val ConsumedBeforeDispatch = s.dispatches>0 implies not(s.admitted)
  val ExactReadBeforeDecision = s.dispatches>0 implies s.readEpoch>=0 and s.matched and s.decision.in(Set("approve","reject"))
  val TerminalResultHasDecision = s.returned.in(Set("succeeded","rejected","invalidated","retryable","blocked")) implies s.dispatches==1
  val safety = OneDecisionPerRead and ConsumedBeforeDispatch and ExactReadBeforeDecision and TerminalResultHasDecision
  run approveTest = init.then(read).then(readReply(true,true)).then(decide("approve")).then(result("succeeded")).expect(safety)
  run rejectTest = init.then(read).then(readReply(true,true)).then(decide("reject")).then(result("rejected")).expect(safety)
  run lostReplyNeverRearmsTest = init.then(read).then(readReply(true,true)).then(decide("approve"))
    .then(result("error")).then(refused(true)).expect(safety and s.dispatches==1)
  run lateReadTest = init.then(read).then(retire).then(readFailed).expect(safety and not(s.admitted))
  run lateDecisionTest = init.then(read).then(readReply(true,true)).then(decide("approve"))
    .then(retire).then(result("error")).expect(safety and s.dispatches==1)
  run copiedRowTest = init.then(read).then(readReply(true,true)).then(refused(false)).expect(safety and s.admitted)
  run abortedReadAdmissionTest = init.then(read).then(readReply(true,true)).then(abort).then(refused(true)).expect(safety and s.dispatches==0)
  run changedRowTest = init.then(read).then(readReply(true,true)).then(mutate(true)).then(refused(true)).expect(safety and s.dispatches==0)
}
