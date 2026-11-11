/// Tap-to-focus over the browser camera preview. Each tap retires the one before it and owns
/// the focus target; driver writes to one track run one at a time, and a tap retired while it
/// waits behind another write never reaches the driver. The target reads as applied only for the latest tap.
module CameraFocusWrites {
  type State = {
    epoch: int, trackLive: bool, reticle: int, queue: List[int], writing: int,
    hardware: int, confirmed: int, skipped: Set[int], written: Set[int]
  }
  var s: State
  action init = s' = {
    epoch: 0, trackLive: true, reticle: 0, queue: [], writing: 0,
    hardware: 0, confirmed: 0, skipped: Set(), written: Set()
  }
  pure def alive(v: State, tap: int): bool = tap == v.epoch and v.reticle == tap and v.trackLive
  /// The taps waiting behind a finished write run in order, without yielding to anything else:
  /// each retired tap leaves without writing and the first live one starts its driver write.
  /// The writing tap stays at the head of the queue until the driver answers.
  pure def drained(v: State): State = v.queue.foldl({ ...v, queue: [] }, (acc, tap) =>
    if (acc.writing != 0) { ...acc, queue: acc.queue.append(tap) }
    else if (alive(v, tap)) { ...acc, writing: tap, written: acc.written.union(Set(tap)), queue: acc.queue.append(tap) }
    else { ...acc, skipped: acc.skipped.union(Set(tap)) })
  /// A tap inside the viewfinder: the earlier target goes away. With no write in flight this
  /// tap's write starts at once; otherwise it waits its turn.
  action tapFocus = all { s.trackLive, s.epoch < 4,
    val tap = s.epoch + 1
    s' = drained({ ...s, epoch: tap, reticle: tap, confirmed: 0, queue: s.queue.append(tap) }) }
  /// The preview stops or flips: the target goes away and every waiting tap is retired.
  action clear = all { s.epoch < 4, s' = { ...s, epoch: s.epoch + 1, reticle: 0, confirmed: 0 } }
  action trackEnds = all { s.trackLive, s' = { ...s, trackLive: false } }
  /// The driver answers. A write that began before its tap was retired still changes the lens;
  /// only a tap that is still current marks its target as applied. The waiting taps follow.
  action driverReplies(applied: bool): bool = all { s.writing != 0,
    s' = drained({ ...s, writing: 0, queue: s.queue.tail(),
      hardware: if (applied) s.writing else s.hardware,
      confirmed: if (applied and alive(s, s.writing)) s.writing else s.confirmed }) }
  action step = {
    nondet applied = Bool.oneOf()
    any { tapFocus, clear, trackEnds, driverReplies(applied), s' = s }
  }
  val OneDriverWritePerTrack = s.writing == 0 or (s.queue.length() > 0 and s.queue.head() == s.writing)
  val AppliedTargetIsLatestTap = s.confirmed != 0 implies
    (s.confirmed == s.epoch and s.confirmed == s.reticle and s.hardware == s.confirmed)
  val RetiredWaitingTapNeverWrites = s.skipped.intersect(s.written) == Set()
  val WritesInTapOrder = s.writing == 0 or s.hardware < s.writing
  val LensSetOnlyByDriverWrite = s.hardware == 0 or s.written.contains(s.hardware)
  val safety = OneDriverWritePerTrack and AppliedTargetIsLatestTap and RetiredWaitingTapNeverWrites
    and WritesInTapOrder and LensSetOnlyByDriverWrite
  val RetiredWriteInFlightWitness = s.writing != 0 and s.writing != s.epoch
  val LensFollowsRetiredTapWitness = s.hardware != 0 and s.hardware != s.epoch and s.reticle == s.epoch and s.writing == 0
  val SkippedTapWitness = s.skipped != Set() and s.confirmed != 0
  val AppliedTargetWitness = s.confirmed == 2 and s.hardware == 2
  /// The driver answers an earlier tap after a newer one: the lens moved, the newer target is
  /// not marked applied until its own write returns.
  run lateReplyOfRetiredTapTest = init.then(tapFocus).then(tapFocus)
    .expect(s.writing == 1 and s.queue == [1, 2] and safety).then(driverReplies(true))
    .expect(s.hardware == 1 and s.confirmed == 0 and s.reticle == 2 and s.writing == 2 and safety)
    .then(driverReplies(true))
    .expect(s.hardware == 2 and s.confirmed == 2 and s.queue == [] and safety)
  run retiredWaitingTapSkipsDriverTest = init.then(tapFocus).then(tapFocus).then(tapFocus)
    .then(driverReplies(true))
    .expect(s.skipped == Set(2) and s.writing == 3 and s.hardware == 1 and safety)
    .then(driverReplies(true))
    .expect(s.written == Set(1, 3) and s.confirmed == 3 and safety)
  run clearedPreviewKeepsTargetUnappliedTest = init.then(tapFocus).then(clear).then(driverReplies(true))
    .expect(s.reticle == 0 and s.confirmed == 0 and s.hardware == 1 and safety)
  /// A tap waiting when the track ends never reaches the driver.
  run endedTrackSkipsWaitingWriteTest = init.then(tapFocus).then(tapFocus).then(trackEnds).then(driverReplies(true))
    .expect(s.skipped == Set(2) and s.written == Set(1) and s.hardware == 1 and s.writing == 0 and safety)
  run refusedDriverLeavesTargetUnappliedTest = init.then(tapFocus).then(driverReplies(false))
    .expect(s.confirmed == 0 and s.hardware == 0 and s.reticle == 1 and s.queue == [] and safety)
  /// The first tap starts its write in the same turn, so nothing can retire it beforehand.
  run firstTapWritesAtOnceTest = init.then(tapFocus)
    .expect(s.writing == 1 and s.written == Set(1) and s.skipped == Set() and safety)
}
