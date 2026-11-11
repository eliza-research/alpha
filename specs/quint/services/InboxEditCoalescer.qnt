/// Retained email edits are written once per pause in typing. At most one edit waits; a later
/// edit replaces it. A store write in flight holds the next one. Time is counted in ticks:
/// a write is due `delay` ticks after the last edit and no later than `maximumWait` ticks after
/// the first edit of a burst.
module InboxEditCoalescer {
  type Coalescer = {
    latest: int, latestBig: bool, waiting: int, waitingBig: bool, timer: bool, remaining: int,
    age: int, held: int, stored: int, invalid: bool, dropped: bool, alive: bool,
    pushes: int, writes: int, heldWrite: bool
  }
  var s: Coalescer
  pure val delay = 2
  pure val maximumWait = 4
  pure def least(a: int, b: int): int = if (a < b) a else b
  action init = s' = {
    latest: 0, latestBig: false, waiting: 0, waitingBig: false, timer: false, remaining: 0,
    age: 0, held: 0, stored: 0, invalid: false, dropped: false, alive: true,
    pushes: 0, writes: 0, heldWrite: false }
  /// The waiting copy is encoded only when it is written. A copy too large to encode is reported
  /// as not retained and the stored copy stays as it was.
  pure def written(v: Coalescer, byTimer: bool): Coalescer =
    if (v.waiting == 0) { ...v, timer: false, remaining: 0 }
    else { ...v, timer: false, remaining: 0, waiting: 0, waitingBig: false, age: 0,
      writes: v.writes + 1, heldWrite: v.heldWrite or (byTimer and v.held > 0),
      stored: if (v.waitingBig) v.stored else v.waiting, invalid: v.waitingBig }
  /// An edit replaces the waiting copy and restarts the pause, bounded by the burst limit.
  action push(big: bool): bool = all {
    s.alive, s.latest < 5,
    val age = if (s.waiting == 0) 0 else s.age
    s' = { ...s, latest: s.latest + 1, latestBig: big, waiting: s.latest + 1, waitingBig: big,
      dropped: false, pushes: s.pushes + 1, age: age, timer: true,
      remaining: least(delay, maximumWait - age) }
  }
  action tick = all {
    s.timer, s.remaining > 0,
    s' = { ...s, remaining: s.remaining - 1, age: s.age + 1 }
  }
  /// The pause ended. A held coalescer keeps the copy waiting without a timer.
  action due = all {
    s.timer, s.remaining == 0,
    if (s.held > 0) s' = { ...s, timer: false } else s' = written(s, true)
  }
  /// Leaving the app, resuming, clearing and retiring write the waiting copy at once.
  action flush = s' = written(s, false)
  action hold = all { s.held < 2, s' = { ...s, held: s.held + 1 } }
  action release = all {
    s.held > 0,
    val lowered = { ...s, held: s.held - 1 }
    if (lowered.held == 0 and lowered.waiting != 0 and not(lowered.timer)) s' = written(lowered, false)
    else s' = lowered
  }
  action discard = all {
    s.waiting != 0,
    s' = { ...s, waiting: 0, waitingBig: false, timer: false, remaining: 0, age: 0, dropped: true }
  }
  /// An account change writes the waiting copy and accepts no further edits.
  action retire = all { s.alive, s' = { ...written(s, false), alive: false } }
  action step = any {
    push(false), push(true), tick, due, flush, hold, release, discard, retire, s' = s
  }
  val WaitingIsLatest = s.waiting != 0 implies s.waiting == s.latest and s.waitingBig == s.latestBig
  val NoSilentLoss = s.waiting == 0 implies s.stored == s.latest or s.invalid or s.dropped
  val WaitingHasDriver = s.waiting != 0 implies s.timer or s.held > 0
  val BurstBounded = s.timer implies s.waiting != 0 and s.age + s.remaining <= maximumWait
  val HeldBlocksDueWrite = not(s.heldWrite)
  val OneWritePerBurst = s.writes <= s.pushes
  val StoredWasPushed = s.stored <= s.latest and (s.invalid implies s.stored < s.latest)
  val TypeOK = s.held.in(0.to(2)) and s.remaining.in(0.to(delay)) and s.age.in(0.to(maximumWait))
    and s.latest.in(0.to(5)) and s.waiting.in(0.to(5)) and s.stored.in(0.to(5))
  val safety = TypeOK and WaitingIsLatest and NoSilentLoss and WaitingHasDriver and BurstBounded
    and HeldBlocksDueWrite and OneWritePerBurst and StoredWasPushed
  val CoalescedBurstWitness = s.pushes >= 3 and s.writes == 1 and s.stored == s.latest
  val HeldPastDueWitness = s.waiting != 0 and s.held > 0 and not(s.timer)
  val NotRetainedWitness = s.invalid and s.waiting == 0 and s.stored != s.latest
  val BurstLimitWitness = s.timer and s.age == maximumWait and s.pushes >= 3
  /// Three edits inside one pause cost one write, of the last edit.
  run burstWritesLatestOnceTest = init.then(push(false)).then(tick).then(push(false)).then(tick)
    .then(push(false)).expect(s.writes == 0 and s.waiting == 3 and safety)
    .then(tick).then(tick).then(due)
    .expect(s.writes == 1 and s.stored == 3 and s.waiting == 0 and safety)
  /// Continuous typing is still written by the burst limit.
  run continuousTypingIsBoundedTest = init.then(push(false)).then(tick).then(push(false)).then(tick)
    .then(push(false)).then(tick).then(push(false)).expect(s.remaining == 1 and safety)
    .then(tick).expect(s.age == maximumWait and s.remaining == 0 and safety)
    .then(due).expect(s.stored == 4 and s.writes == 1 and safety)
    .then(tick.fail())
  /// A slow store holds the next write. The edits made meanwhile are written once, on release.
  run slowStoreHoldsNextWriteTest = init.then(push(false)).then(flush).then(hold)
    .then(push(false)).then(tick).then(tick).then(due)
    .expect(s.writes == 1 and s.waiting == 2 and not(s.timer) and safety)
    .then(push(false)).then(tick).then(tick).then(due).then(release)
    .expect(s.writes == 2 and s.stored == 3 and s.waiting == 0 and safety)
  run leavingWritesAtOnceTest = init.then(push(false)).then(flush)
    .expect(s.stored == 1 and not(s.timer) and safety)
    .then(due.fail())
  /// An edit too large to retain is reported and leaves the earlier copy stored.
  run oversizedEditReportedTest = init.then(push(false)).then(flush).then(push(true)).then(flush)
    .expect(s.invalid and s.stored == 1 and s.latest == 2 and safety)
    .then(push(false)).then(flush).expect(not(s.invalid) and s.stored == 3 and safety)
  run retireWritesWaitingEditTest = init.then(push(false)).then(hold).then(retire)
    .expect(s.stored == 1 and s.waiting == 0 and not(s.alive) and safety)
    .then(push(false).fail())
}
