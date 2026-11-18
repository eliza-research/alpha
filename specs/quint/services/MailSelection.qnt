// Two selected messages. Every provider effect has its own existing durable receipt.
module MailSelection {
  var s: {approved: bool, owner: bool, current: int, sends: List[int], done: Set[int], phase: str}
  action init = s' = {approved: false, owner: true, current: 0, sends: List(0,0), done: Set(), phase: "idle"}
  action approve = all {s.phase == "idle", s.owner, s' = {...s, approved: true, phase: "ready"}}
  action dispatch = all {
    s.approved, s.owner, s.phase == "ready", s.current < 2,
    s.sends.nth(s.current) == 0,
    s' = {...s, sends: s.sends.replaceAt(s.current,1), phase: "dispatching"}
  }
  action succeeded = all {s.phase == "dispatching", s' = {...s, done: s.done.union(Set(s.current)), current: s.current+1, phase: "ready"}}
  action recovered = all {s.phase == "unknown", s' = {...s, done: s.done.union(Set(s.current)), current: s.current+1, phase: "stopped"}}
  action lost = all {s.phase == "dispatching", s' = {...s, phase: "unknown"}}
  action rejected = all {s.phase == "dispatching", s' = {...s, phase: "stopped"}}
  action leave = s' = {...s, owner: false}
  action step = any {approve, dispatch, succeeded, recovered, lost, rejected, leave, s' = s}
  val safety = s.sends.nth(0) <= 1 and s.sends.nth(1) <= 1 and s.current <= 2 and
    (s.sends.nth(0) + s.sends.nth(1) > 0 implies s.approved)
  run distinctMessagesApplyOnce = init.then(approve).then(dispatch).then(succeeded).then(dispatch).then(succeeded).expect(s.done == Set(0,1) and safety)
  run unknownStopsLaterMessages = init.then(approve).then(dispatch).then(lost).expect(s.current == 0 and s.sends == List(1,0) and safety)
  run receiptRecoveryDoesNotResend = init.then(approve).then(dispatch).then(lost).then(recovered).expect(s.phase == "stopped" and s.current == 1 and s.sends == List(1,0) and safety)
  run refusalStopsLaterMessages = init.then(approve).then(dispatch).then(rejected).expect(s.phase == "stopped" and s.sends == List(1,0) and safety)
  run leavingStopsLaterMessages = init.then(approve).then(dispatch).then(leave).then(succeeded).expect(not(s.owner) and s.sends == List(1,0) and safety)
}
