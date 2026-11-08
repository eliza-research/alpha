/// Shared bridge permission epochs, draft admission and cancellation barrier.
module SharedRecordingAdmission {
  type State = {
    epoch: int, foreground: bool, destroyed: bool, inCall: bool, permission: str,
    pending: int -> int, queued: int -> int, outcomes: int -> str,
    draining: bool, waiters: Set[int], cancelQueued: bool, barrierQueued: bool,
    captureOwner: int, captureOpen: bool, captureInterrupted: bool, starts: int, event: str, events: int,
    lastAccepted: bool, lastEpoch: int, lastCurrent: int, lastForeground: bool,
    lastDestroyed: bool, lastCall: bool, lastDraining: bool
  }
  var s: State
  val slots = Set(1, 2, 3, 4)
  action init = s' = {epoch: 0, foreground: true, destroyed: false, inCall: false, permission: "granted",
    pending: slots.mapBy(_ => -1), queued: slots.mapBy(_ => -1), outcomes: slots.mapBy(_ => "none"),
    draining: false, waiters: Set(), cancelQueued: false, barrierQueued: false,
    captureOwner: 0, captureOpen: false, captureInterrupted: false, starts: 0, event: "none", events: 0,
    lastAccepted: false, lastEpoch: 0, lastCurrent: 0, lastForeground: false,
    lastDestroyed: false, lastCall: false, lastDraining: false}
  action setPermission(value: str): bool = all {
    value.in(Set("granted", "prompt", "denied")), s' = {...s, permission: value}
  }
  action setCall(value: bool): bool = s' = {...s, inCall: value}
  action request(id: int): bool = all {
    id.in(Set(1, 2)), s.outcomes.get(id) == "none",
    s' = if (s.draining) {...s, outcomes: s.outcomes.set(id, "draining")}
      else if (s.inCall) {...s, outcomes: s.outcomes.set(id, "call")}
      else if (s.permission != "granted") {...s, pending: s.pending.set(id, s.epoch), outcomes: s.outcomes.set(id, "pending")}
      else {...s, queued: s.queued.set(id, s.epoch), outcomes: s.outcomes.set(id, "pending")}
  }
  action permissionReply(id: int, granted: bool): bool = all {
    id.in(Set(1, 2)), s.outcomes.get(id) == "pending", s.queued.get(id) == -1,
    val current = s.pending.get(id) == s.epoch
    s' = {...s, pending: s.pending.set(id, -1), permission: if (granted) "granted" else "denied",
      queued: if (current and granted) s.queued.set(id, s.epoch) else s.queued,
      outcomes: s.outcomes.set(id, if (not(current)) "cancelled" else if (granted) "pending" else "permission")}
  }
  action runStart(id: int, opens: bool): bool = all {
    id.in(Set(1, 2)), s.queued.get(id) >= 0, s.starts < 2,
    val admitted = s.foreground and not(s.destroyed or s.draining or s.inCall) and s.queued.get(id) == s.epoch
    val accepted = admitted and s.captureOwner == 0 and opens
    s' = {...s, queued: s.queued.set(id, -1),
      outcomes: s.outcomes.set(id, if (s.destroyed or not(s.foreground) or s.draining or s.queued.get(id) != s.epoch) "cancelled"
        else if (s.inCall) "call" else if (accepted) "recording" else "capture"),
      captureOwner: if (accepted) id else s.captureOwner, captureOpen: s.captureOpen or accepted,
      starts: s.starts + (if (accepted) 1 else 0), lastAccepted: accepted,
      lastEpoch: s.queued.get(id), lastCurrent: s.epoch, lastForeground: s.foreground,
      lastDestroyed: s.destroyed, lastCall: s.inCall, lastDraining: s.draining}
  }
  action pauseHost = all {
    s.epoch < 4,
    val finished = s.captureOpen and not(s.captureInterrupted)
    s' = {...s, foreground: false, captureOpen: s.captureOpen and not(finished),
      event: if (finished) "recorded" else s.event, events: s.events + (if (finished) 1 else 0),
      epoch: s.epoch + (if (slots.forall(id => s.pending.get(id) == -1)) 1 else 0)}
  }
  action resumeHost = s' = {...s, foreground: true}
  action interruptForCall(released: bool): bool =
    if (s.captureOpen and not(s.captureInterrupted)) s' = {...s,
      captureOwner: if (released) 0 else s.captureOwner, captureOpen: not(released),
      captureInterrupted: not(released), event: "call-active", events: s.events + 1}
    else s' = s
  action closeHost = all {
    s.epoch < 4,
    s' = {...s, destroyed: true, epoch: s.epoch + 1, pending: slots.mapBy(_ => -1),
      captureOwner: 0, captureOpen: false, captureInterrupted: false, waiters: Set(),
      outcomes: slots.mapBy(id => if (id.in(s.waiters)) "unavailable" else s.outcomes.get(id))}
  }
  action beginCancel(id: int): bool = all {
    id.in(Set(3, 4)), s.outcomes.get(id) == "none", s.epoch < 4,
    s' = {...s, epoch: s.epoch + 1, pending: slots.mapBy(_ => -1),
      outcomes: s.outcomes.set(id, if (s.destroyed) "unavailable" else "pending"),
      waiters: if (s.destroyed) s.waiters else s.waiters.union(Set(id)),
      draining: s.draining or not(s.destroyed), cancelQueued: s.cancelQueued or not(s.destroyed or s.draining)}
  }
  action runCancel(captureOk: bool, workerAccepts: bool): bool = all {
    s.cancelQueued,
    val failed = not(captureOk and workerAccepts)
    s' = {...s, cancelQueued: false,
      captureOwner: if (captureOk) 0 else s.captureOwner,
      captureOpen: if (captureOk) false else s.captureOpen,
      captureInterrupted: not(captureOk) and s.captureInterrupted,
      barrierQueued: captureOk and workerAccepts,
      waiters: if (failed) Set() else s.waiters,
      outcomes: slots.mapBy(id => if (failed and id.in(s.waiters)) "unavailable" else s.outcomes.get(id))}
  }
  action finishBarrier = all {
    s.barrierQueued,
    s' = {...s, barrierQueued: false, draining: false, waiters: Set(),
      outcomes: slots.mapBy(id => if (id.in(s.waiters)) (if (s.destroyed) "unavailable" else "done") else s.outcomes.get(id))}
  }
  action timeout(id: int): bool = all {
    id.in(s.waiters),
    s' = {...s, waiters: s.waiters.exclude(Set(id)), outcomes: s.outcomes.set(id, "draining")}
  }
  action stopDraft = all {s.captureOpen, not(s.captureInterrupted), s' = {...s, captureOpen: false}}
  action step = {
    nondet id = Set(1, 2).oneOf()
    nondet cancelId = Set(3, 4).oneOf()
    nondet flag = Set(true, false).oneOf()
    any {
      setPermission("granted"), setPermission("prompt"), setPermission("denied"), setCall(flag),
      pauseHost, resumeHost, interruptForCall(flag), closeHost, stopDraft,
      request(id), permissionReply(id, flag), runStart(id, flag), beginCancel(cancelId),
      runCancel(true, true), runCancel(false, true), runCancel(true, false), finishBarrier,
      timeout(cancelId), s' = s
    }
  }
  val AcceptedInCurrentLiveEpoch = s.lastAccepted implies
    s.lastEpoch == s.lastCurrent and s.lastForeground and not(s.lastDestroyed or s.lastCall or s.lastDraining)
  val CaptureHasOwner = s.captureOpen implies s.captureOwner.in(Set(1, 2))
  val InterruptedCaptureIsRetired = s.captureInterrupted implies s.captureOpen and s.event == "call-active"
  val PendingNotQueued = slots.forall(id => s.pending.get(id) == -1 or s.queued.get(id) == -1)
  val DrainOwnsWaiters = s.waiters != Set() implies s.draining
  val Bounded = s.epoch.in(0.to(4)) and s.starts.in(0.to(2))
  val safety = AcceptedInCurrentLiveEpoch and CaptureHasOwner and InterruptedCaptureIsRetired and PendingNotQueued and DrainOwnsWaiters and Bounded
  run lateCallRejectsPermissionStartTest = init.then(setPermission("prompt")).then(request(1)).then(setCall(true))
    .then(permissionReply(1, true)).then(runStart(1, true)).expect(safety and s.starts == 0 and s.outcomes.get(1) == "call")
  run pauseForPromptCanResumeTest = init.then(setPermission("prompt")).then(request(1)).then(pauseHost).then(resumeHost)
    .then(permissionReply(1, true)).then(runStart(1, true)).expect(safety and s.starts == 1 and s.epoch == 0)
  run pauseRetiresQueuedStartTest = init.then(request(1)).then(pauseHost).then(resumeHost).then(runStart(1, true))
    .expect(safety and s.starts == 0 and s.outcomes.get(1) == "cancelled")
  run cancelRetiresPromptTest = init.then(setPermission("prompt")).then(request(1)).then(beginCancel(3))
    .then(permissionReply(1, true)).then(runCancel(true, true)).then(finishBarrier)
    .expect(safety and s.outcomes.get(1) == "cancelled" and s.outcomes.get(3) == "done")
  run timeoutKeepsAdmissionClosedTest = init.then(beginCancel(3)).then(timeout(3)).then(request(1))
    .expect(safety and s.draining and s.outcomes.get(1) == "draining")
  run joinedCancelWaitsForOneBarrierTest = init.then(beginCancel(3)).then(beginCancel(4)).then(runCancel(true, true)).then(finishBarrier)
    .expect(safety and s.outcomes.get(3) == "done" and s.outcomes.get(4) == "done")
  run refusedBarrierStaysClosedTest = init.then(beginCancel(3)).then(runCancel(true, false)).then(request(1))
    .expect(safety and s.draining and s.outcomes.get(3) == "unavailable" and s.outcomes.get(1) == "draining")
  run callDiscardsDraftTest = init.then(request(1)).then(runStart(1, true)).then(setCall(true))
    .then(interruptForCall(true)).then(interruptForCall(true))
    .expect(safety and s.captureOwner == 0 and not(s.captureOpen) and s.event == "call-active" and s.events == 1)
  run failedCallReleaseFencesStopTest = init.then(request(1)).then(runStart(1, true)).then(setCall(true))
    .then(interruptForCall(false)).then(setCall(false)).then(stopDraft.fail())
}
