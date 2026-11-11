module CoreApprovalServiceCurrent {
  import CoreApprovalServiceTemplate(Selectors = Set(1, 2), CanFail = true, RejectUnownedCallbacks = true)
    as Model from "../legacy/CoreApprovalService"

  action init = Model::Init
  action step = Model::Step
  val safety = Model::TypeOK and Model::AtMostOneCallback and Model::ResultAgrees and Model::SingleOwner
  temporal CheckedTemporal = Model::Fairness implies Model::SettlesOnce and Model::CallerSettles

  val state = Model::s
  val settlementStable = Model::settledOnce
  action fire = Model::Fire
  action timeoutTask = Model::TGetTask
  action timeoutCallbackDone = Model::TCallbackDone
  action timeoutCallbackFails = Model::TCallbackFails
  action timeoutResolve = Model::TResolve
  action timeoutDelete = Model::TDelete
  action deliver(selector: int): bool = Model::Deliver(selector)
  action selectionTask(selector: int): bool = Model::SGetTask(selector)
  action selectionCallbackDone(selector: int): bool = Model::SCallbackDone(selector)
  action selectionCallbackFails(selector: int): bool = Model::SCallbackFails(selector)
  action selectionDelete(selector: int): bool = Model::SDelete(selector)
  action cancel = Model::Cancel
  action cancelDelete = Model::CancelDelete
  action stop = Model::Stop

  run secondSelectionPreservesClaimedTaskTest = init.then(deliver(1)).then(deliver(2))
    .then(selectionTask(1)).then(selectionTask(2))
    .expect(state.taskExists and state.spc.get(2) == "done" and state.selRuns == 1 and safety)
    .then(selectionCallbackDone(1)).then(selectionDelete(1))
    .expect(not(state.taskExists) and state.result == "selected" and settlementStable and safety)
}
