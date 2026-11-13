/// A tap on the navigation notification is held by the native side as a one-use record. The
/// launcher reads it over the bridge only while it can show Maps, opens Maps when the reply
/// finds a tap, and never opens for a read that Home or disposal overtook.
module MapsNotificationOpen {
  type Open = {
    // The native one-use record of a tap, and whether the launcher can show Maps now.
    pending: bool, ready: bool,
    // A check is owed; one bridge read is in flight; the native side answered that read and
    // whether it found a tap.
    requested: bool, checking: bool, read: bool, found: bool,
    // Home presses and disposal advance the epoch, tap events the revision; a read keeps the
    // epoch and revision it began under.
    epoch: int, revision: int, captured: int, attempt: int,
    disposed: bool,
    // History: taps, Home presses, bridge reads begun, reads begun by the end of another read,
    // failed reads, times Maps was opened, and taps a current read consumed without opening.
    taps: int, cancels: int, reads: int, chained: int, failures: int, opened: int, dropped: int
  }
  var s: Open
  pure val MaxTaps = 3
  pure val MaxCancels = 2
  pure val MaxFailures = 2
  pure def current(v: Open): bool = not(v.disposed) and v.epoch == v.captured
  /// A check begins only when one is owed, none is in flight and Maps can be shown.
  pure def canRead(v: Open): bool = not(v.disposed) and not(v.checking) and v.requested and v.ready
  pure def flushed(v: Open): Open =
    if (canRead(v)) { ...v, checking: true, requested: false, read: false, found: false,
      captured: v.epoch, attempt: v.revision, reads: v.reads + 1 }
    else v

  action init = s' = {
    pending: false, ready: false, requested: true, checking: false, read: false, found: false,
    epoch: 0, revision: 0, captured: 0, attempt: 0, disposed: false,
    taps: 0, cancels: 0, reads: 0, chained: 0, failures: 0, opened: 0, dropped: 0
  }
  /// The tap that started the renderer: the record exists before anything listens for the event.
  action coldTap = all {
    s.taps == 0, s.reads == 0, s.revision == 0, s.cancels == 0, not(s.disposed),
    s' = { ...s, pending: true, taps: 1 }
  }
  /// A tap while the renderer runs: the record is written and the launcher is told. A disposed
  /// adapter no longer listens.
  action tap = all {
    s.taps < MaxTaps,
    s' = if (s.disposed) { ...s, pending: true, taps: s.taps + 1 }
      else flushed({ ...s, pending: true, taps: s.taps + 1, requested: true, revision: s.revision + 1 })
  }
  action setReady(on: bool): bool = all { on != s.ready, s' = { ...s, ready: on } }
  /// A launcher render, or the page becoming visible.
  action flush = all { canRead(s), s' = flushed(s) }
  /// The native side answers the read in flight and consumes its record.
  action nativeReads = all {
    s.checking, not(s.read), s' = { ...s, read: true, found: s.pending, pending: false }
  }
  /// The reply arrives, or the bridge call fails before the native side saw it. A current
  /// failed read is owed again. A tap event that arrived during the read starts the next one.
  action readSettles(ok: bool): bool = {
    val opens = ok and s.found and current(s) and s.ready
    val settled = { ...s, checking: false, read: false, found: false,
      opened: if (opens) s.opened + 1 else s.opened,
      dropped: if (ok and s.found and current(s) and not(s.ready)) s.dropped + 1 else s.dropped,
      failures: if (ok) s.failures else s.failures + 1,
      requested: s.requested or (not(ok) and current(s)) }
    val again = settled.requested and settled.revision != s.attempt and canRead(settled)
    all {
      s.checking, ok == s.read, ok or s.failures < MaxFailures,
      s' = if (again) { ...flushed(settled), chained: s.chained + 1 } else settled
    }
  }
  /// Home: the owed check is dropped, the native record is cleared and a read in flight is stale.
  action cancel = all {
    not(s.disposed), s.cancels < MaxCancels,
    s' = { ...s, requested: false, epoch: s.epoch + 1, pending: false, cancels: s.cancels + 1 }
  }
  action dispose = all {
    not(s.disposed), s' = { ...s, disposed: true, requested: false, epoch: s.epoch + 1 }
  }
  action step = {
    nondet flag = Set(false, true).oneOf()
    // Home and disposal are drawn less often, so sampled traces reach opens.
    nondet draw = 0.to(4).oneOf()
    any {
      coldTap, tap, setReady(flag), flush, nativeReads, readSettles(flag),
      all { draw == 0, cancel },
      all { draw == 0, flag, dispose },
      s' = s
    }
  }

  val TypeOK = s.taps.in(0.to(MaxTaps)) and s.cancels.in(0.to(MaxCancels)) and
    s.failures.in(0.to(MaxFailures)) and s.epoch.in(0.to(MaxCancels + 1)) and
    s.revision.in(0.to(MaxTaps)) and s.captured.in(0.to(s.epoch)) and s.attempt.in(0.to(s.revision))
  /// Maps is opened at most once per tap.
  val OpensNeedTaps = s.opened + s.dropped <= s.taps
  /// The bridge is read once at start, once per tap event and once more per failed read; it
  /// is never polled.
  val ReadsAreOwed = s.reads <= 1 + s.revision + s.failures
  /// A tap the native side still holds is read by a check that is owed or in flight.
  val HeldTapIsOwed = s.pending and not(s.disposed) implies s.requested or s.checking
  val AnswerNeedsRead = (s.read or s.found) implies s.checking
  val DisposedOwesNothing = s.disposed implies not(s.requested)
  val safety = TypeOK and OpensNeedTaps and ReadsAreOwed and HeldTapIsOwed and AnswerNeedsRead and
    DisposedOwesNothing

  // A property the source does not have; it is outside `safety`. A reply that finds a tap after
  // the launcher stopped being able to show Maps consumes the tap without opening Maps later.
  val ConsumedTapOpensDesired = s.dropped == 0

  val ColdTapOpensWitness = s.opened > 0 and s.revision == 0
  val StaleReadWitness = s.checking and s.found and s.epoch != s.captured
  val RetryOpensWitness = s.failures > 0 and s.opened > 0
  val ChainedReadOpensWitness = s.chained > 0 and s.opened > 0
  val DroppedTapWitness = s.dropped > 0
  val TwoOpensWitness = s.opened > 1

  run coldTapWaitsForSafeScreenTest = init.then(coldTap).then(flush.fail())
  run coldTapOpensOnceTest = init.then(coldTap).then(setReady(true)).then(flush)
    .expect(s.checking and s.reads == 1 and s.pending)
    .then(nativeReads).then(readSettles(true))
    .expect(s.opened == 1 and not(s.pending) and not(s.checking) and safety)
    .then(flush.fail())
  run unsafeScreenKeepsTapUntilHomeTest = init.then(tap)
    .expect(s.reads == 0 and s.requested and s.pending)
    .then(cancel).expect(not(s.pending) and not(s.requested))
    .then(setReady(true)).then(tap).expect(s.checking and s.reads == 1)
    .then(nativeReads).then(readSettles(true)).expect(s.opened == 1 and safety)
  run homeDuringReadPreventsOpenTest = init.then(setReady(true)).then(coldTap).then(flush)
    .then(nativeReads).expect(s.found).then(cancel).then(readSettles(true))
    .expect(s.opened == 0 and s.dropped == 0 and not(s.requested) and safety)
    .then(flush.fail())
  run disposalDuringReadPreventsOpenTest = init.then(setReady(true)).then(coldTap).then(flush)
    .then(nativeReads).then(dispose).then(readSettles(true))
    .expect(s.opened == 0 and safety)
    .then(tap).expect(s.pending and not(s.checking) and s.reads == 1 and safety)
  run failedReadIsOwedAgainTest = init.then(setReady(true)).then(coldTap).then(flush)
    .then(readSettles(false)).expect(s.requested and s.pending and not(s.checking) and s.reads == 1)
    .then(flush).then(nativeReads).then(readSettles(true)).expect(s.opened == 1 and s.reads == 2 and safety)
  run tapDuringReadIsReadAgainTest = init.then(setReady(true)).then(flush).then(nativeReads)
    .expect(not(s.found)).then(tap).expect(s.reads == 1 and s.requested and s.pending)
    .then(readSettles(true)).expect(s.opened == 0 and s.checking and s.reads == 2 and s.chained == 1)
    .then(nativeReads).then(readSettles(true)).expect(s.opened == 1 and not(s.checking) and safety)
  run replyOnUnsafeScreenDropsTapTest = init.then(setReady(true)).then(coldTap).then(flush)
    .then(nativeReads).then(setReady(false)).then(readSettles(true))
    .expect(s.opened == 0 and not(s.pending) and not(s.requested) and not(ConsumedTapOpensDesired) and safety)
    .then(setReady(true)).then(flush.fail())
}
