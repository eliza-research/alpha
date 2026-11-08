/// Normal/private tab projection, persistence merge and navigation epoch fencing.
module BrowserSession {
  type State = { normal: Set[int], privateTabs: Set[int], saved: Set[int], active: int,
    epoch: int, captured: int, navigating: bool, committed: bool, pristine: bool,
    history: Set[int], privatePage: bool, privateHistory: Set[int] }
  var s: State
  action init = s' = { normal: Set(1), privateTabs: Set(), saved: Set(), active: 1,
    epoch: 0, captured: 0, navigating: false, committed: false, pristine: true,
    history: Set(), privatePage: false, privateHistory: Set() }
  action normalTab = s' = { ...s, normal: s.normal.union(Set(2)), privateTabs: s.privateTabs.exclude(Set(2)),
    active: 2, privatePage: false, pristine: false, navigating: false }
  action privateTab = s' = { ...s, privateTabs: s.privateTabs.union(Set(3)), active: 3,
    privatePage: true, pristine: false, navigating: false }
  action navigate = all { s.epoch < 2, s' = { ...s, epoch: s.epoch + 1,
    captured: s.epoch + 1, navigating: true, committed: false, pristine: false } }
  action commit = all { s.navigating, s.captured == s.epoch,
    s' = { ...s, navigating: false, committed: true,
      history: if (s.privatePage) s.history else s.history.union(Set(s.active)),
      privateHistory: if (s.privatePage) s.privateHistory.union(Set(s.active)) else s.privateHistory } }
  action snapshot = s' = { ...s, saved: s.normal }
  action closePrivate = s' = { ...s, privateTabs: Set(), privateHistory: Set(),
    active: 1, privatePage: false, navigating: false }
  action restart = s' = { ...s, normal: if (s.saved.size() > 0) s.saved else Set(1),
    privateTabs: Set(), privateHistory: Set(), active: 1, privatePage: false,
    navigating: false, pristine: true }
  action lateRestore = all { not(s.pristine), s' = s }
  action retireNavigation = all { s.epoch < 2,
    s' = { ...s, epoch: s.epoch + 1, navigating: false } }
  action step = any { normalTab, privateTab, navigate, commit, snapshot, closePrivate,
    restart, lateRestore, retireNavigation, s' = s }
  val PrivateNeverSaved = s.saved.intersect(Set(3)).size() == 0
  val PrivateHistoryIsolated = s.history.intersect(Set(3)).size() == 0
  val ActiveTabExists = s.normal.contains(s.active) or s.privateTabs.contains(s.active)
  val TabsDisjoint = s.normal.intersect(s.privateTabs).size() == 0
  val safety = PrivateNeverSaved and PrivateHistoryIsolated and ActiveTabExists and TabsDisjoint
  run privateRestartTest = init.then(privateTab).then(navigate).then(commit).then(snapshot)
    .then(restart).expect(s.privateTabs.size() == 0 and s.privateHistory.size() == 0 and safety)
  run lateRestoreTest = init.then(normalTab).then(lateRestore).expect(s.active == 2 and safety)
  run normalHistoryTest = init.then(navigate).then(commit).then(snapshot)
    .then(restart).expect(s.history.contains(1) and safety)
}
