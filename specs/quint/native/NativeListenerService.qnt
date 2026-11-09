/// Whole shared listener/service lifecycle with controlled framework outcomes.
module NativeListenerService {
  type State = {created: bool, destroyed: bool, foregroundRequested: bool, selfStopped: bool,
    modes: bool, recordings: bool, playback: bool, observer: bool, reapplyQueued: bool,
    indicatorTimer: bool, leaseTimer: bool, analyse: bool, capture: bool, record: bool,
    allocations: int, physical: bool, released: bool, microphoneHeld: bool, unsilenced: bool,
    marker: bool, durableMarker: bool, storageFailed: bool, stopRequests: int, epoch: int, epochActive: bool, enginePresent: bool, engineClosed: bool,
    engineLoading: bool, cancels: int, executorShutdown: bool, superDestroyed: bool,
    userEnabled: bool, paused: bool, status: str}
  var s: State
  action init = s' = {created: false, destroyed: false, foregroundRequested: false, selfStopped: false,
    modes: false, recordings: false, playback: false, observer: false, reapplyQueued: false,
    indicatorTimer: false, leaseTimer: false, analyse: false, capture: false, record: false,
    allocations: 0, physical: false, released: false, microphoneHeld: false, unsilenced: false,
    marker: false, durableMarker: false, storageFailed: false, stopRequests: 0, epoch: 0, epochActive: false, enginePresent: false, engineClosed: false,
    engineLoading: false, cancels: 0, executorShutdown: false, superDestroyed: false,
    userEnabled: true, paused: false, status: "none"}
  pure def stopped(st: State, stopOk: bool, releaseOk: bool): State = {
    val released = not(st.record) or releaseOk
    val closesMarker = released and (st.record or st.capture) and not(st.storageFailed)
    {...st, epoch: st.epoch + 1, epochActive: false, analyse: false, capture: false,
      cancels: st.cancels + (if (st.enginePresent) 1 else 0), record: st.record and not(releaseOk),
      physical: st.physical and not(stopOk or releaseOk), released: if (st.record) releaseOk else st.released,
      microphoneHeld: st.microphoneHeld and not(released), unsilenced: st.unsilenced and not(released),
      marker: st.marker and not(closesMarker), durableMarker: st.durableMarker and not(closesMarker)}
  }
  action create = all {not(s.created), s' = {...s, created: true, modes: true, recordings: true,
    playback: true, observer: true, reapplyQueued: true}}
  action start = all {
    s.created, not(s.destroyed or s.storageFailed), s.allocations < 2 or s.capture or s.record,
    val opens = not(s.capture or s.record)
    val analyses = s.capture or opens
    s' = {...s, userEnabled: true, paused: false, foregroundRequested: true, reapplyQueued: false,
      indicatorTimer: true, leaseTimer: true, analyse: analyses, epoch: s.epoch + 2, epochActive: analyses,
      allocations: s.allocations + (if (opens) 1 else 0), capture: s.capture or opens, record: s.record or opens,
      physical: s.physical or opens, released: s.released and not(opens), microphoneHeld: s.microphoneHeld or opens,
      unsilenced: s.unsilenced or opens, marker: s.marker or opens, durableMarker: s.durableMarker or opens,
      engineLoading: s.engineLoading or (analyses and not(s.enginePresent)), status: "LISTENING"}
  }
  action markerWriteFailed = all {
    s.created, s.userEnabled, not(s.paused or s.destroyed or s.storageFailed or s.record), s.allocations < 2,
    s' = {...s, storageFailed: true, stopRequests: s.stopRequests + 1, marker: true,
      foregroundRequested: true, reapplyQueued: true, paused: false, indicatorTimer: true,
      leaseTimer: true, analyse: false, epoch: s.epoch + 3, epochActive: false,
      allocations: s.allocations + 1, released: true, status: "LISTENING"}
  }
  action load = all {
    s.engineLoading,
    s' = {...s, engineLoading: false, enginePresent: not(s.destroyed), engineClosed: s.destroyed}
  }
  action pause(stopOk: bool, releaseOk: bool): bool = all {
    s.created, not(s.destroyed or s.storageFailed),
    val closed = stopped(s, stopOk, releaseOk)
    s' = {...closed, userEnabled: true, paused: true, foregroundRequested: true, reapplyQueued: false,
      indicatorTimer: false, leaseTimer: false, epoch: closed.epoch + 2, epochActive: false, status: "PAUSED_USER"}
  }
  action disable(stopOk: bool, releaseOk: bool): bool = all {
    s.created, not(s.destroyed or s.storageFailed),
    val closed = stopped(s, stopOk, releaseOk)
    s' = {...closed, userEnabled: false, paused: false, foregroundRequested: false, selfStopped: true,
      reapplyQueued: false, indicatorTimer: false, leaseTimer: false, epoch: closed.epoch + 1, status: "OFF"}
  }
  action destroy(stopOk: bool, releaseOk: bool): bool = all {
    s.created, not(s.destroyed),
    val closed = stopped(s, stopOk, releaseOk)
    s' = {...closed, destroyed: true, reapplyQueued: false, indicatorTimer: false, leaseTimer: false,
      modes: false, recordings: false, playback: false, observer: false, executorShutdown: true,
      superDestroyed: true, enginePresent: false, engineClosed: s.engineClosed or s.enginePresent}
  }
  action step = any {
    create,
    all {s.epoch < 12, any {start, markerWriteFailed,
      {nondet stopOk = Bool.oneOf()
       nondet releaseOk = Bool.oneOf()
       any {pause(stopOk, releaseOk), disable(stopOk, releaseOk), destroy(stopOk, releaseOk)}}}},
    load, s' = s
  }
  val DestructionRetiresCallbacks = s.destroyed implies not(s.modes or s.recordings or s.playback or s.observer)
  val DestructionStopsExecutor = s.destroyed implies s.executorShutdown and s.superDestroyed and not(s.capture or s.analyse)
  val UnreleasedCaptureRetainsMarker = s.record implies s.marker and s.durableMarker and s.microphoneHeld
  val AnalysisNeedsCapture = s.analyse implies s.capture and not(s.storageFailed)
  val Bounded = s.allocations.in(0.to(2))
  val safety = DestructionRetiresCallbacks and DestructionStopsExecutor and UnreleasedCaptureRetainsMarker and AnalysisNeedsCapture and Bounded
  run failedDurableMarkerCannotArmRecognitionTest = init.then(create).then(markerWriteFailed)
    .expect(safety and s.storageFailed and s.marker and not(s.durableMarker or s.epochActive or s.engineLoading))
  run releaseFailureStillCleansLifecycleTest = init.then(create).then(start).then(load).then(destroy(true, false))
    .expect(safety and s.record and s.marker and not(s.physical) and s.engineClosed)
  run combinedFailureKeepsPhysicalUncertaintyTest = init.then(create).then(start).then(load).then(destroy(false, false))
    .expect(safety and s.physical and s.record and s.marker)
  run failedRecordRefusesReplacementTest = init.then(create).then(start).then(load).then(pause(false, false)).then(start)
    .expect(safety and s.allocations == 1 and not(s.capture))
  run successfulRetryAllowsNewCaptureTest = init.then(create).then(start).then(load).then(pause(false, false))
    .then(pause(true, true)).then(start).expect(safety and s.allocations == 2 and s.capture)
  run repeatedStartAtCapacityTest = init.then(create).then(start).then(load).then(pause(true, true))
    .then(start).then(start).expect(safety and s.allocations == 2 and s.capture)
  run lateEngineLoadIsClosedTest = init.then(create).then(start).then(destroy(true, true)).then(load)
    .expect(safety and s.engineClosed and not(s.enginePresent))
}
