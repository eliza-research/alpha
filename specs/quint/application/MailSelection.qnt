// Two selected messages. Every provider effect has its own existing durable receipt.
module MailSelection {
  var s: {approved: bool, owner: bool, current: int, sends: List[int], done: Set[int], phase: str}
  action init = s' = {approved: false, owner: true, current: 0, sends: List(0,0), done: Set(), phase: "idle"}
  action approve = s' = {...s, approved: true, phase: "ready"}
  action dispatch = all {
    s.approved, s.owner, s.phase == "ready", s.current < 2,
    s.sends.nth(s.current) == 0,
    s' = {...s, sends: s.sends.replaceAt(s.current,1), phase: "dispatching"}
  }
  action succeeded = all {s.phase.in(Set("dispatching","unknown")), s' = {...s, done: s.done.union(Set(s.current)), current: s.current+1, phase: "ready"}}
  action lost = all {s.phase == "dispatching", s' = {...s, phase: "unknown"}}
  action rejected = all {s.phase == "dispatching", s' = {...s, phase: "stopped"}}
  action leave = s' = {...s, owner: false}
  action step = any {approve, dispatch, succeeded, lost, rejected, leave, s' = s}
  val safety = s.sends.nth(0) <= 1 and s.sends.nth(1) <= 1 and s.current <= 2
  run distinctMessagesApplyOnce = init.then(approve).then(dispatch).then(succeeded).then(dispatch).then(succeeded).expect(s.done == Set(0,1) and safety)
  run unknownStopsLaterMessages = init.then(approve).then(dispatch).then(lost).expect(s.current == 0 and s.sends == List(1,0) and safety)
  run receiptRecoveryDoesNotResend = init.then(approve).then(dispatch).then(lost).then(succeeded).expect(s.current == 1 and s.sends == List(1,0) and safety)
  run refusalStopsLaterMessages = init.then(approve).then(dispatch).then(rejected).expect(s.phase == "stopped" and s.sends == List(1,0) and safety)
}
