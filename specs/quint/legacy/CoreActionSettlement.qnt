// Literal state/transition translation of upstream ActionSettlement.tla at 4787d51a142c.
module CoreActionSettlementTemplate {
  const InHandler: int
  const Late: int
  const Outcomes: Set[str]
  const MayDeny: bool
  type State = {spc: str, hpc: str, phase: str, outcome: str, emitted: int,
    buffer: List[int], chain: List[int], busy: bool, delivered: List[int], target: int}
  var s: State
  pure val N = InHandler + Late
  pure val Ids = 1.to(N)
  val vars = s
  pure val InitialState: State = {spc: "admit", hpc: "idle", phase: "pending", outcome: "none",
    emitted: 0, buffer: List(), chain: List(), busy: false, delivered: List(), target: 0}
  val Initial = s == InitialState
  action Init = s' = InitialState
  // The source partial action is used only inside emission actions. This helper
  // returns its update with all other source fields framed by the enclosing step.
  def Receive(id: int): State =
    if (s.phase == "pending") {...s, buffer: s.buffer.append(id)}
    else if (s.phase == "failed" or s.outcome == "replyFailure") s
    else {...s, chain: s.chain.append(id)}
  action AdmitAccepted = all {s.spc == "admit", s' = {...s, spc: "wait", hpc: "running"}}
  action AdmitDenied = all {s.spc == "admit", MayDeny, s' = {...s, phase: "failed", spc: "done"}}
  action Admit = any {AdmitAccepted, AdmitDenied}
  action HandlerEmit = all {s.hpc == "running", s.emitted < InHandler,
    s' = {...Receive(s.emitted + 1), emitted: s.emitted + 1}}
  action HandlerReturnAs(outcome: str): bool = all {s.hpc == "running", s.emitted == InHandler,
    Outcomes.contains(outcome), s' = {...s, outcome: outcome, hpc: "returned"}}
  action HandlerReturn = {nondet outcome = Outcomes.oneOf(); HandlerReturnAs(outcome)}
  action LateEmit = all {s.hpc == "returned", s.emitted < N,
    s' = {...Receive(s.emitted + 1), emitted: s.emitted + 1}}
  action Settle = all {s.spc == "wait", s.hpc == "returned",
    if (Set("invalid", "throw").contains(s.outcome)) s' = {...s, phase: "failed", buffer: List(), spc: "done"}
    else if (s.outcome == "replyFailure") s' = {...s, phase: "settled", buffer: List(), spc: "done"}
    else s' = {...s, phase: "settled", chain: s.chain.concat(s.buffer),
      target: s.delivered.length() + s.chain.length() + s.buffer.length(), spc: "drain"}}
  action Deliver = all {not(s.busy), s.chain.length() > 0,
    s' = {...s, delivered: s.delivered.append(s.chain.head()), chain: s.chain.tail(), busy: true}}
  action TransportSettle = all {s.busy, s' = {...s, busy: false}}
  action Drained = all {s.spc == "drain",
    s.delivered.length() > s.target or s.delivered.length() == s.target and not(s.busy),
    s' = {...s, spc: "done"}}
  val Finished = s.spc == "done" and not(s.busy) and s.chain.length() == 0
    and (s.hpc == "idle" or s.emitted == N)
  action Next = any {Admit, HandlerEmit, HandlerReturn, LateEmit, Settle, Deliver, TransportSettle,
    Drained, all {Finished, s' = s}}
  action Stutter = s' = s
  action Step = any {Next, Stutter}
  temporal Fairness = Next.weakFair(vars) and HandlerEmit.weakFair(vars) and HandlerReturn.weakFair(vars)
    and LateEmit.weakFair(vars) and Settle.weakFair(vars) and Deliver.weakFair(vars)
    and TransportSettle.weakFair(vars) and Drained.weakFair(vars)
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  val TypeOK = Set("admit", "wait", "drain", "done").contains(s.spc)
    and Set("idle", "running", "returned").contains(s.hpc)
    and Set("pending", "settled", "failed").contains(s.phase)
    and Outcomes.union(Set("none")).contains(s.outcome) and s.emitted.in(0.to(N))
    and s.buffer.indices().forall(i => Ids.contains(s.buffer.nth(i)))
    and s.chain.indices().forall(i => Ids.contains(s.chain.nth(i)))
    and s.delivered.indices().forall(i => Ids.contains(s.delivered.nth(i)))
  val DeliveredInEmissionOrder = s.delivered.indices().forall(i =>
    s.delivered.indices().forall(j => i < j implies s.delivered.nth(i) < s.delivered.nth(j)))
  val DeliveredOnlyEmitted = s.delivered.indices().forall(i => s.delivered.nth(i) <= s.emitted)
  val NoneAfterFailure = s.phase == "failed" implies s.delivered.length() == 0
  val NoneOnReplyFailure = s.outcome == "replyFailure" implies s.delivered.length() == 0
  val NoneWhilePending = s.phase == "pending" implies s.delivered.length() == 0
  temporal SettleReturns = eventually(s.spc == "done")
  temporal AllDelivered = eventually(always(s.phase == "settled" and s.outcome == "ok" implies s.delivered.length() == N))
}
module CoreActionSettlement {
  import CoreActionSettlementTemplate(InHandler = 3, Late = 3, Outcomes = Set("ok"), MayDeny = false) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val state = Model::s
  action admitAccepted = Model::AdmitAccepted
  action admitDenied = Model::AdmitDenied
  action handlerEmit = Model::HandlerEmit
  action handlerReturn(outcome: str): bool = Model::HandlerReturnAs(outcome)
  action lateEmit = Model::LateEmit
  action settle = Model::Settle
  action deliver = Model::Deliver
  action transportSettle = Model::TransportSettle
  action drained = Model::Drained
  val safety = Model::TypeOK and Model::DeliveredInEmissionOrder and Model::DeliveredOnlyEmitted
    and Model::NoneAfterFailure and Model::NoneOnReplyFailure and Model::NoneWhilePending
  temporal CheckedTemporal = Model::Fairness implies Model::SettleReturns and Model::AllDelivered
  run orderedLateDeliveryTest = init.then(Model::AdmitAccepted).then(Model::HandlerEmit).then(Model::HandlerEmit).then(Model::HandlerEmit)
    .then(Model::HandlerReturnAs("ok")).then(Model::Settle).then(Model::LateEmit).then(Model::LateEmit).then(Model::LateEmit)
    .then(Model::Deliver).then(Model::TransportSettle).then(Model::Deliver).then(Model::TransportSettle).then(Model::Deliver).then(Model::TransportSettle)
    .then(Model::Deliver).then(Model::TransportSettle).then(Model::Deliver).then(Model::TransportSettle).then(Model::Deliver).then(Model::TransportSettle)
    .then(Model::Drained).expect(Model::s.delivered == List(1, 2, 3, 4, 5, 6) and Model::Finished and safety)
  run lateBeforeSettlementBuffersTest = init.then(admitAccepted).then(handlerEmit).then(handlerEmit).then(handlerEmit)
    .then(handlerReturn("ok")).then(lateEmit).then(lateEmit).then(lateEmit)
    .expect(state.buffer == List(1, 2, 3, 4, 5, 6) and state.delivered == List() and safety)
    .then(settle).then(deliver).expect(state.target == 6 and state.delivered == List(1) and state.busy and safety)
}
module CoreActionSettlementOutcomes {
  import CoreActionSettlementTemplate(InHandler = 2, Late = 1,
    Outcomes = Set("ok", "replyFailure", "invalid", "throw"), MayDeny = true) as Model
  action init = Model::Init
  action step = Model::Step
  action rawStep = Model::Next
  val state = Model::s
  action admitAccepted = Model::AdmitAccepted
  action admitDenied = Model::AdmitDenied
  action handlerEmit = Model::HandlerEmit
  action handlerReturn(outcome: str): bool = Model::HandlerReturnAs(outcome)
  action lateEmit = Model::LateEmit
  action settle = Model::Settle
  action deliver = Model::Deliver
  action transportSettle = Model::TransportSettle
  action drained = Model::Drained
  val safety = Model::TypeOK and Model::DeliveredInEmissionOrder and Model::DeliveredOnlyEmitted
    and Model::NoneAfterFailure and Model::NoneOnReplyFailure and Model::NoneWhilePending
  temporal CheckedTemporal = Model::Fairness implies Model::SettleReturns and Model::AllDelivered
  run denialTest = init.then(Model::AdmitDenied).expect(Model::Finished and safety)
  run replyFailureDropsCallbacksTest = init.then(Model::AdmitAccepted).then(Model::HandlerEmit).then(Model::HandlerEmit)
    .then(Model::HandlerReturnAs("replyFailure")).then(Model::Settle).then(Model::LateEmit).expect(Model::s.delivered == List() and Model::Finished and safety)
  run failedHandlerDropsCallbacksTest = init.then(Model::AdmitAccepted).then(Model::HandlerEmit).then(Model::HandlerEmit)
    .then(Model::HandlerReturnAs("throw")).then(Model::LateEmit).then(Model::Settle).expect(Model::s.buffer == List() and Model::Finished and safety)
}
