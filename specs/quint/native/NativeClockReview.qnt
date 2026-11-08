// Alpha's exact Clock review and journal boundary. A delivery means an
// Activity handoff to a synthetic external Clock, with no alarm-side receipt.
module NativeClockReview {
  type State = {
    operation: str, outerPhase: str, outerStatus: str, outerClaim: str,
    phase: str, token: int, issued: int, openOwner: int,
    visible: Set[int], retired: Set[int], dialogReplies: int -> str,
    expired: bool, confirming: int, attempts: int, deliveries: int,
    receipt: str, outcome: str
  }
  var s: State

  val actors = Set(1,2)
  val operations = Set("set","show","snooze","dismiss")
  val results = Set("opened","unavailable","denied","failed","unknown")
  val faults = Set("complete","before","after")

  action initWith(operation: str): bool = all {
    operations.contains(operation),
    s' = {operation:operation,outerPhase:"applying",outerStatus:"none",outerClaim:"none",
      phase:"none",token:0,issued:0,openOwner:0,visible:Set(),retired:Set(),
      dialogReplies:actors.mapBy(_actor=>"none"),expired:false,confirming:0,
      attempts:0,deliveries:0,receipt:"none",outcome:"none"}
  }
  action init = initWith("set")

  pure def reply(state: State): str = if (state.receipt=="none") "unknown" else state.receipt
  pure def approval(state: State): State =
    { ...state, phase:"approved",token:state.issued+1,issued:state.issued+1 }
  pure def failed(state: State): State = { ...state, phase:"cancelled",receipt:"failed" }
  pure def hide(state: State, actor: int): State =
    { ...state, visible:state.visible.exclude(Set(actor)) }
  def eligible(actor: int): bool =
    s.outerPhase=="applying" and not(s.retired.contains(actor)) and not(s.expired)

  action review(actor: int, admission: str, saved: str): bool = all {
    actors.contains(actor), s.confirming==0, faults.contains(saved),
    Set("complete","changed","locked","background").contains(admission),
    if (not(eligible(actor)) or admission=="changed") s' = { ...s,outcome:"rejected" }
    else if (not(s.phase.in(Set("none","reviewing")))) s' = { ...s,outcome:reply(s) }
    else if (s.operation=="show") {
      val prepared=if (saved=="before") s else approval(s)
      s' = { ...prepared,outcome:if (saved=="complete") "approved" else "rejected" }
    } else if (s.openOwner!=0) s' = { ...s,outcome:reply(s) }
    else if (s.phase=="none" and saved=="before") s' = { ...s,outcome:"rejected" }
    else {
      val prepared={ ...s,phase:"reviewing" }
      if ((s.phase=="none" and saved=="after") or admission!="complete")
        s' = { ...prepared,outcome:"rejected" }
      else all {
        s.dialogReplies.get(actor)=="none",
        s' = { ...prepared,openOwner:actor,visible:s.visible.union(Set(actor)),
          dialogReplies:s.dialogReplies.set(actor,"pending"),outcome:"pending" }
      }
    }
  }

  // As built, settle(id) can remove a successor claim before the old owner's
  // destroyed check suppresses its callback. The durable reviewing row remains.
  action answer(actor: int, choice: str, saved: str): bool = all {
    actors.contains(actor), s.confirming==0, faults.contains(saved),
    choice.in(Set("positive","negative","cancel")),
    s.dialogReplies.get(actor)=="pending",
    val closed=hide(s,actor)
    if (s.openOwner==0) s' = { ...closed,outcome:"pending" }
    else {
      val unclaimed={ ...closed,openOwner:0 }
      if (s.retired.contains(actor)) s' = { ...unclaimed,outcome:"pending" }
      else {
        val result=if (not(eligible(actor))) "rejected"
          else if (s.phase!="reviewing") reply(s)
          else if (saved!="complete") "rejected"
          else if (choice=="positive") "approved" else "failed"
        val recorded=if (not(eligible(actor)) or s.phase!="reviewing" or saved=="before") unclaimed
          else if (choice=="positive") approval(unclaimed) else failed(unclaimed)
        s' = { ...recorded,dialogReplies:s.dialogReplies.set(actor,result),outcome:result }
      }
    }
  }

  action retire(actor: int): bool = all {
    actors.contains(actor),
    val current=if (s.openOwner==actor) { ...hide(s,actor),openOwner:0 } else s
    s' = { ...current,retired:s.retired.union(Set(actor)) }
  }

  action expire = s' = { ...s,expired:true }

  action cancel(actor: int, saved: str): bool = all {
    actors.contains(actor), s.confirming==0, faults.contains(saved),
    val mutates=s.phase.in(Set("none","reviewing","approved"))
    if (s.retired.contains(actor) or (mutates and (saved=="before" or (s.outerPhase=="terminal" and s.outerStatus!="unknown"))))
      s' = { ...s,outcome:"rejected" }
    else if (mutates and saved=="after") s' = { ...failed(s),outcome:"rejected" }
    else {
      val recorded=if (mutates) failed(s) else s
      val response=reply(recorded)
      val closed=hide(recorded,s.openOwner)
      val replies=if (s.openOwner==0 or s.retired.contains(s.openOwner)) s.dialogReplies
        else s.dialogReplies.set(s.openOwner,if (s.expired) "rejected" else response)
      s' = { ...closed,openOwner:0,dialogReplies:replies,outcome:response }
    }
  }

  action confirm(actor: int, token: int, admission: str, saved: str): bool = all {
    actors.contains(actor), s.confirming==0, faults.contains(saved),
    token.in(0.to(2)), admission.in(Set("complete","locked","background","zone")),
    if (not(eligible(actor)) or s.phase=="none") s' = { ...s,outcome:"rejected" }
    else if (s.phase!="approved") s' = { ...s,outcome:reply(s) }
    else if (token!=s.token or admission.in(Set("locked","background")) or (admission=="zone" and s.operation=="set") or saved=="before")
      s' = { ...s,outcome:"rejected" }
    else {
      val fenced={ ...s,phase:"dispatching",token:0 }
      s' = if (saved=="after") { ...fenced,outcome:"rejected" }
        else { ...fenced,confirming:actor,outcome:"pending" }
    }
  }

  action dispatch(port: str, saved: str): bool = all {
    s.confirming!=0, faults.contains(saved),
    port.in(Set("opened","locked","zone","none","self","missing","denied","unknown-before","unknown-after")),
    if (s.retired.contains(s.confirming)) s' = { ...s,confirming:0,outcome:"rejected" }
    else {
      val failed=s.expired or port=="locked" or (port=="zone" and s.operation=="set")
      val attempted=not(failed) and not(port.in(Set("none","self")))
      val delivered=attempted and port.in(Set("opened","unknown-after","zone"))
      val status=if (failed) "failed" else if (port.in(Set("none","self","missing"))) "unavailable"
        else if (port=="denied") "denied" else if (port.in(Set("unknown-before","unknown-after"))) "unknown" else "opened"
      val sent={ ...s,confirming:0,attempts:s.attempts+(if (attempted) 1 else 0),
        deliveries:s.deliveries+(if (delivered) 1 else 0) }
      val recorded=if (saved=="before") sent else { ...sent,phase:"finished",receipt:status }
      s' = { ...recorded,outcome:if (saved=="complete") status else "rejected" }
    }
  }

  // The as-built product ResultPolicy checks result shape but does not compare
  // the Clock-specific producer entry. Keep this counterexample separate.
  action finish(actor: int, claimed: str): bool = all {
    actors.contains(actor), s.confirming==0, claimed.in(results.union(Set("bare-unknown","ringing"))),
    val status=if (claimed=="opened") "succeeded" else if (claimed.in(Set("unknown","bare-unknown"))) "unknown" else "failed"
    if (s.retired.contains(actor) or claimed=="ringing" or (s.outerPhase=="terminal" and claimed!=s.outerClaim))
      s' = { ...s,outcome:"rejected" }
    else s' = { ...s,outerPhase:"terminal",outerStatus:status,outerClaim:claimed,outcome:status }
  }

  val OneExternalHandoff = s.deliveries<=s.attempts and s.attempts<=1
  val DispatchConsumesApproval = s.phase.in(Set("dispatching","finished")) implies s.token==0
  val ClaimNeedsLiveDialog = s.openOwner==0 or (s.visible.contains(s.openOwner) and not(s.retired.contains(s.openOwner)))
  val NoRingReceipt = s.receipt!="ringing" and s.outerClaim!="ringing"
  val safety = OneExternalHandoff and DispatchConsumesApproval and ClaimNeedsLiveDialog and NoRingReceipt

  action step = any {
    nondet actor=actors.oneOf()
    nondet admission=Set("complete","changed","locked","background").oneOf()
    nondet saved=faults.oneOf()
    review(actor,admission,saved),
    nondet actor=actors.oneOf()
    nondet choice=Set("positive","negative","cancel").oneOf()
    nondet saved=faults.oneOf()
    answer(actor,choice,saved),
    nondet actor=actors.oneOf()
    retire(actor),
    expire,
    nondet actor=actors.oneOf()
    nondet saved=faults.oneOf()
    cancel(actor,saved),
    nondet actor=actors.oneOf()
    nondet token=0.to(2).oneOf()
    nondet admission=Set("complete","locked","background","zone").oneOf()
    nondet saved=faults.oneOf()
    confirm(actor,token,admission,saved),
    nondet port=Set("opened","locked","zone","none","self","missing","denied","unknown-before","unknown-after").oneOf()
    nondet saved=faults.oneOf()
    dispatch(port,saved),
    nondet actor=actors.oneOf()
    nondet outcome=results.union(Set("bare-unknown","ringing")).oneOf()
    finish(actor,outcome),
    s'=s
  }

  action opened = init.then(review(1,"complete","complete")).then(answer(1,"positive","complete"))
  action sealed = opened.then(confirm(1,1,"complete","complete"))

  run staleDialogCanStrandReplacementAsBuiltTest = init.then(review(1,"complete","complete"))
    .then(retire(1)).then(review(2,"complete","complete")).then(answer(1,"positive","complete"))
    .expect(s.openOwner==0 and s.visible==Set(2) and s.phase=="reviewing")
    .then(answer(2,"positive","complete")).expect(s.phase=="reviewing" and s.outcome=="pending")

  run fabricatedOpenedOuterReceiptAsBuiltTest = init.then(finish(1,"ringing"))
    .expect(s.outcome=="rejected")
    .then(finish(1,"opened")).expect(s.outerStatus=="succeeded" and s.attempts==0 and s.phase=="none")

  run approvalTokenIsOneUseTest = sealed.then(dispatch("opened","complete"))
    .then(confirm(1,1,"complete","complete")).expect(s.attempts==1 and s.deliveries==1 and s.outcome=="opened")

  run uncertainEffectNeverReplaysTest = sealed.then(dispatch("unknown-after","before"))
    .then(confirm(1,1,"complete","complete"))
    .expect(s.phase=="dispatching" and s.deliveries==1 and s.outcome=="unknown")

  run expiryAfterDispatchMarkerStillPreventsHandoffTest = sealed.then(expire)
    .then(dispatch("opened","complete")).expect(s.receipt=="failed" and s.attempts==0)

  run retiredSurfaceCannotUseSealedHandoffTest = sealed.then(retire(1))
    .then(dispatch("opened","complete")).expect(s.phase=="dispatching" and s.attempts==0 and s.outcome=="rejected")

  run cancelledApprovalIsNeverASecondEffectTest = opened.then(cancel(1,"complete"))
    .then(confirm(1,1,"complete","complete")).expect(s.phase=="cancelled" and s.outcome=="failed" and s.attempts==0)
}
