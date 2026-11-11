module WorkflowRecoverySelection {
  var s: {owner: bool, phase: str, current: int, sends: List[int], removed: Set[int], retained: Set[int], approved: bool, restoredInactive: bool, permanent: bool, erased: Set[int]}
  action init = s' = {owner: true, phase: "idle", current: 0, sends: List(0,0), removed: Set(), retained: Set(0,1), approved: false, restoredInactive: false, permanent: false, erased: Set()}
  action review = all {s.phase == "idle", s' = {...s, phase: "review"}}
  action reviewErase = all {s.phase == "idle", s' = {...s, phase: "review", permanent: true, removed: Set(0,1)}}
  action cancel = all {s.phase == "review", s' = {...s, phase: "idle"}}
  action approve = all {s.phase == "review", s' = {...s, approved: true, phase: "ready"}}
  action dispatch = all {s.owner, s.approved, s.phase == "ready", s.current < 2, s.sends.nth(s.current) == 0, s' = {...s, phase: "inflight", sends: s.sends.replaceAt(s.current,1)}}
  action saved = all {s.phase == "inflight", s' = {...s, removed: if (s.permanent) s.removed.exclude(Set(s.current)) else s.removed.union(Set(s.current)), retained: if (s.permanent) s.retained.exclude(Set(s.current)) else s.retained, erased: if (s.permanent) s.erased.union(Set(s.current)) else s.erased, current: s.current+1, phase: "ready"}}
  action unknown = all {s.phase == "inflight", s' = {...s, phase: "unknown"}}
  action rejected = all {s.phase == "inflight", s' = {...s, phase: "stopped"}}
  action retire = s' = {...s, owner: false, phase: "retired"}
  action restore = all {s.owner, not(s.permanent), s.current == 2, s.phase == "ready", s' = {...s, removed: Set(), restoredInactive: true, phase: "done"}}
  action step = any {review,reviewErase,cancel,approve,dispatch,saved,unknown,rejected,retire,restore,s' = s}
  val safety = s.retained.union(s.erased) == Set(0,1) and s.retained.intersect(s.erased) == Set() and (s.erased.size() > 0 implies s.approved and s.permanent) and s.sends.nth(0) <= 1 and s.sends.nth(1) <= 1 and (s.current > 0 implies s.approved)
  // Successful completion assumes the same owner and a successful response to each admitted request.
  run recoverKeepsRecords = init.then(review).then(approve).then(dispatch).then(saved).then(dispatch).then(saved).then(restore).expect(s.phase == "done" and s.restoredInactive and safety)
  run cancelHasNoEffect = init.then(review).then(cancel).expect(s.sends == List(0,0) and s.removed == Set() and safety)
  run unknownStopsBatch = init.then(review).then(approve).then(dispatch).then(unknown).expect(s.current == 0 and s.sends == List(1,0) and safety)
  run rejectionStopsBatch = init.then(review).then(approve).then(dispatch).then(rejected).expect(s.current == 0 and s.sends == List(1,0) and safety)
  run ownerChangeStopsBatch = init.then(review).then(approve).then(dispatch).then(saved).then(retire).expect(s.sends == List(1,0) and safety)
  run permanentDeletion = init.then(reviewErase).then(approve).then(dispatch).then(saved).then(dispatch).then(saved).expect(s.erased == Set(0,1) and s.retained == Set() and safety)
  run cancelPermanent = init.then(reviewErase).then(cancel).expect(s.retained == Set(0,1) and s.erased == Set() and safety)
}
