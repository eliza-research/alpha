/// Cross-boundary admission projected from AlphaClient, native lifecycle and owner-bound adapters.
/// Two owners and two non-reused generations suffice to distinguish current and stale work.
module Application {
  type State = { owner: int, epoch: int, foreground: bool, sensitive: bool,
    reset: bool, resident: bool, pending: bool, capturedOwner: int,
    capturedEpoch: int, reviewed: bool, dispatched: bool, outcome: str,
    voice: bool, cachedOwner: int, commits: int }
  var s: State
  action init = s' = { owner: 0, epoch: 0, foreground: true, sensitive: false,
    reset: false, resident: true, pending: false, capturedOwner: 0,
    capturedEpoch: 0, reviewed: false, dispatched: false, outcome: "none",
    voice: false, cachedOwner: 0, commits: 0 }
  val admitted = s.owner != 0 and s.foreground and not(s.sensitive) and not(s.reset)
  action signIn(owner: int): bool = all { owner.in(Set(1, 2)), s.epoch < 2, not(s.reset),
    s' = { ...s, owner: owner, epoch: s.epoch + 1, pending: false, reviewed: false,
      dispatched: false, voice: false, cachedOwner: 0, outcome: "none" } }
  action begin = all { admitted, not(s.pending),
    s' = { ...s, pending: true, capturedOwner: s.owner, capturedEpoch: s.epoch,
      reviewed: false, dispatched: false, outcome: "pending" } }
  action review = all { s.pending, admitted, s.capturedEpoch == s.epoch,
    s' = { ...s, reviewed: true } }
  action dispatch = all { s.pending, s.reviewed, admitted,
    s.capturedEpoch == s.epoch, s.capturedOwner == s.owner, not(s.dispatched),
    s' = { ...s, dispatched: true, outcome: "unknown" } }
  action finish = all { s.pending, admitted, s.capturedEpoch == s.epoch,
    s.capturedOwner == s.owner,
    s' = { ...s, pending: false, cachedOwner: s.owner,
      outcome: if (s.dispatched) "observed" else "read", commits: if (s.commits < 2) s.commits + 1 else 2 } }
  action startVoice = all { admitted, s' = { ...s, voice: true } }
  action hide = s' = { ...s, foreground: false, pending: false, voice: false,
    outcome: if (s.dispatched) "unknown" else s.outcome }
  action resume = all { not(s.reset), s' = { ...s, foreground: true } }
  action sensitiveView = s' = { ...s, sensitive: true, pending: false, voice: false }
  action leaveSensitive = s' = { ...s, sensitive: false }
  action signOut = all { s.epoch < 2, s' = { ...s, owner: 0, epoch: s.epoch + 1,
    pending: false, reviewed: false, dispatched: false, voice: false, cachedOwner: 0 } }
  action requestReset = s' = { ...s, reset: true, resident: false, pending: false,
    voice: false, reviewed: false, dispatched: false, cachedOwner: 0 }
  action staleCallback = s' = s
  action step = any { signIn(1), signIn(2), begin, review, dispatch, finish,
    startVoice, hide, resume, sensitiveView, leaveSensitive, signOut, requestReset, staleCallback }
  val ResetStopsInitialization = s.reset implies (not(s.resident) and not(s.pending) and not(s.voice))
  val CurrentOwnerCache = s.cachedOwner == 0 or s.cachedOwner == s.owner
  val ReviewedDispatch = s.dispatched implies s.reviewed
  val ActiveVoiceAdmission = s.voice implies admitted
  val PendingIsCurrent = s.pending implies (s.capturedOwner == s.owner and s.capturedEpoch == s.epoch)
  val safety = ResetStopsInitialization and CurrentOwnerCache and ReviewedDispatch and ActiveVoiceAdmission and PendingIsCurrent
  run reviewedEffectTest = init.then(signIn(1)).then(begin).then(review).then(dispatch)
    .then(finish).expect(safety and s.outcome == "observed")
  run ownerSwitchTest = init.then(signIn(1)).then(begin).then(signIn(2))
    .then(staleCallback).expect(safety and not(s.pending) and s.cachedOwner == 0)
  run resetDuringVoiceTest = init.then(signIn(1)).then(startVoice).then(requestReset)
    .then(staleCallback).expect(safety and s.reset)
  run uncertainEffectTest = init.then(signIn(1)).then(begin).then(review).then(dispatch)
    .then(hide).then(staleCallback).expect(safety and s.outcome == "unknown")
}
