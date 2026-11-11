/// Settings device facts: generation-fenced reads, text-size writes settled by token and the
/// mounted owner. The device handles requests in the order they were issued; their results
/// reach the page in any order. The newest size request's result is shown; an older applied
/// one is held and shown when the newest fails, so the page never rests on a size the device
/// does not hold.
module SettingsSession {
  type Op = { kind: str, token: int, instance: int, scaleToken: int, value: int, scale: int, other: int, failed: bool }
  type State = {
    // The mounted Settings instance (0 is none) and its counters.
    owner: int, mounts: int, generation: int, scaleGeneration: int,
    // Requests the device has not handled yet, oldest first, and results on their way back.
    queue: List[Op], results: Set[Op],
    // The device's text size and one other fact that changes outside the page.
    deviceScale: int, deviceOther: int,
    // What the page shows (Unknown before the first read) and the read that supplied it.
    shownScale: int, shownOther: int, shownToken: int,
    // A shown read kept the size because a size request overlapped it.
    regressed: bool, writeFailed: bool, keptSize: bool,
    // The applied size of an older request held while a newer one is in flight (Unknown is none),
    // the newest request token whose success has been seen, and the newest token that failed.
    held: int, latest: int, failedToken: int,
    // How an older applied size last replaced the one shown: 1 when the newest request failed
    // after it, 2 when it arrived after that failure.
    restored: int
  }
  var s: State

  pure val Unknown = -1
  pure val Sizes = Set(75, 100, 115, 130, 150)
  pure val MaxMounts = 2
  pure val MaxGeneration = 4
  pure val MaxScaleGeneration = 3

  action init = s' = { owner: 0, mounts: 0, generation: 0, scaleGeneration: 0, queue: List(), results: Set(),
    deviceScale: 100, deviceOther: 0, shownScale: Unknown, shownOther: Unknown, shownToken: 0,
    regressed: false, writeFailed: false, keptSize: false, held: Unknown, latest: 0, failedToken: 0, restored: 0 }
  action mount = all { s.owner == 0, s.mounts < MaxMounts, s' = { ...s, owner: s.mounts + 1, mounts: s.mounts + 1 } }
  /// Leaving Settings retires every read in flight and forgets the facts.
  action unmount = all { s.owner != 0, s.generation < MaxGeneration,
    s' = { ...s, owner: 0, generation: s.generation + 1, shownScale: Unknown, shownOther: Unknown,
      shownToken: 0, writeFailed: false, held: Unknown, latest: 0, failedToken: 0 } }
  action refresh = all { s.owner != 0, s.generation < MaxGeneration,
    s' = { ...s, generation: s.generation + 1,
      queue: s.queue.append({ kind: "read", token: s.generation + 1, instance: s.owner,
        scaleToken: s.scaleGeneration, value: 0, scale: 0, other: 0, failed: false }) } }
  /// The size control exists once a read has shown a size.
  action changeScale(value: int): bool = all { s.owner != 0, s.shownScale != Unknown, value.in(Sizes),
    s.scaleGeneration < MaxScaleGeneration,
    s' = { ...s, scaleGeneration: s.scaleGeneration + 1, writeFailed: false,
      queue: s.queue.append({ kind: "write", token: s.scaleGeneration + 1, instance: s.owner,
        scaleToken: 0, value: value, scale: 0, other: 0, failed: false }) } }
  action deviceHandles(fails: bool): bool = all { s.queue.length() > 0,
    val op = s.queue.nth(0)
    val rejected = fails and op.kind == "write"
    val scale = if (op.kind == "write" and not(rejected)) op.value else s.deviceScale
    s' = { ...s, queue: s.queue.slice(1, s.queue.length()), deviceScale: scale,
      results: s.results.union(Set({ ...op, scale: scale, other: s.deviceOther, failed: rejected })) } }
  action deviceChanges = all { s.deviceOther < 2, s' = { ...s, deviceOther: s.deviceOther + 1 } }
  /// A read is shown only by the instance and generation that issued it. One that overlapped a
  /// text-size change keeps the size already shown and takes every other fact.
  action settleRead(op: Op): bool = all { op.in(s.results), op.kind == "read",
    val current = s.owner == op.instance and s.generation == op.token
    val overlapped = s.scaleGeneration != op.scaleToken and s.shownScale != Unknown
    s' = if (not(current)) { ...s, results: s.results.exclude(Set(op)) }
      else { ...s, results: s.results.exclude(Set(op)), shownOther: op.other,
        shownScale: if (overlapped) s.shownScale else op.scale, shownToken: op.token,
        regressed: s.regressed or op.token < s.shownToken,
        writeFailed: s.writeFailed and overlapped, keptSize: s.keptSize or overlapped } }
  /// A size request of the mounted instance that succeeded is shown when it is the newest, or when
  /// the newest has already failed; otherwise it is held. A result older than one already seen is
  /// dropped. The newest request's failure is reported and shows the held size.
  action settleWrite(op: Op): bool = all { op.in(s.results), op.kind == "write",
    val dropped = { ...s, results: s.results.exclude(Set(op)) }
    val newest = s.scaleGeneration == op.token
    s' = if (s.owner != op.instance) dropped
      else if (op.failed)
        if (not(newest)) dropped
        else { ...dropped, writeFailed: true, failedToken: op.token, held: Unknown,
          shownScale: if (s.held != Unknown) s.held else s.shownScale,
          restored: if (s.held != Unknown) 1 else s.restored }
      else if (op.token <= s.latest) dropped
      else if (newest) { ...dropped, latest: op.token, held: Unknown, shownScale: op.scale }
      else if (s.failedToken == s.scaleGeneration)
        { ...dropped, latest: op.token, held: Unknown, shownScale: op.scale, restored: 2 }
      else { ...dropped, latest: op.token, held: op.scale } }
  action step = {
    nondet value = Sizes.oneOf()
    nondet fails = Set(true, false).oneOf()
    any { mount, unmount, refresh, changeScale(value), deviceHandles(fails), deviceChanges,
      { all { s.results.size() > 0, { nondet op = s.results.oneOf() any { settleRead(op), settleWrite(op) } } } },
      s' = s }
  }

  val quiet = s.queue.length() == 0 and s.results.size() == 0
  /// With nothing in flight the size shown is the device's, whether or not the newest request failed.
  val ShownSizeIsCurrent = quiet and s.owner != 0 and s.shownScale != Unknown
    implies s.shownScale == s.deviceScale
  /// A held size belongs to a request older than the newest one of the mounted instance.
  val HeldIsOlderRequest = s.held != Unknown implies s.owner != 0 and s.latest > 0 and s.latest < s.scaleGeneration
  val ReadsNeverRegress = not(s.regressed)
  val UnmountedShowsNothing = s.owner == 0 implies s.shownScale == Unknown and s.shownOther == Unknown
  val ShownReadIsOwn = s.shownToken <= s.generation and (s.shownOther != Unknown implies s.shownToken > 0)
  val BoundedCounters = s.generation <= MaxGeneration and s.scaleGeneration <= MaxScaleGeneration and s.owner <= s.mounts
  val safety = ShownSizeIsCurrent and HeldIsOlderRequest and ReadsNeverRegress and UnmountedShowsNothing and ShownReadIsOwn and BoundedCounters

  val OverlappedReadShownWitness = quiet and s.keptSize and s.shownScale == s.deviceScale and s.shownScale != 100
  val RetiredReadWitness = s.owner == 2 and s.shownOther == Unknown and s.generation >= 2 and s.results.size() == 0 and s.queue.length() == 0
  /// The newest request failed after an earlier one was applied: the applied size is shown.
  val FailedNewestShowsAppliedWitness = quiet and s.writeFailed and s.restored == 1 and s.shownScale == s.deviceScale and s.shownScale != 100
  /// The applied size arrived after the newest request's failure and is shown on arrival.
  val LateAppliedShownWitness = quiet and s.writeFailed and s.restored == 2 and s.shownScale == s.deviceScale and s.shownScale != 100

  pure def readOp(token: int, instance: int, scaleToken: int, scale: int, other: int): Op =
    { kind: "read", token: token, instance: instance, scaleToken: scaleToken, value: 0, scale: scale, other: other, failed: false }
  pure def writeOp(token: int, instance: int, value: int): Op =
    { kind: "write", token: token, instance: instance, scaleToken: 0, value: value, scale: value, other: 0, failed: false }

  // A read in flight while the size changes: its other facts are shown and the new size stays.
  run overlappedReadKeepsSizeTest = init.then(mount).then(refresh).then(deviceHandles(false))
    .then(settleRead(readOp(1, 1, 0, 100, 0))).expect(s.shownScale == 100)
    .then(refresh).then(deviceChanges).then(deviceHandles(false))
    .then(changeScale(130)).then(deviceHandles(false))
    .then(settleWrite({ ...writeOp(1, 1, 130), other: 1 })).expect(s.shownScale == 130)
    .then(settleRead(readOp(2, 1, 0, 100, 1)))
    .expect(s.shownScale == 130 and s.shownOther == 1 and s.deviceScale == 130 and s.keptSize and safety)
  run readAfterWriteSeesNewSizeTest = init.then(mount).then(refresh).then(deviceHandles(false))
    .then(settleRead(readOp(1, 1, 0, 100, 0))).then(changeScale(150)).then(refresh)
    .then(deviceHandles(false)).then(deviceHandles(false))
    .then(settleRead(readOp(2, 1, 1, 150, 0))).then(settleWrite(writeOp(1, 1, 150)))
    .expect(s.shownScale == 150 and safety)
  run newestSizeRequestWinsTest = init.then(mount).then(refresh).then(deviceHandles(false))
    .then(settleRead(readOp(1, 1, 0, 100, 0))).then(changeScale(115)).then(changeScale(130))
    .then(deviceHandles(false)).then(deviceHandles(false))
    .then(settleWrite(writeOp(2, 1, 130))).then(settleWrite(writeOp(1, 1, 115)))
    .expect(s.shownScale == 130 and s.deviceScale == 130 and safety)
  run supersededReadIsDroppedTest = init.then(mount).then(refresh).then(refresh)
    .then(deviceHandles(false)).then(deviceChanges).then(deviceHandles(false))
    .then(settleRead(readOp(2, 1, 0, 100, 1))).then(settleRead(readOp(1, 1, 0, 100, 0)))
    .expect(s.shownOther == 1 and s.shownToken == 2 and safety)
  run unmountRetiresReadTest = init.then(mount).then(refresh).then(deviceHandles(false)).then(unmount).then(mount)
    .then(settleRead(readOp(1, 1, 0, 100, 0)))
    .expect(s.owner == 2 and s.shownScale == Unknown and s.shownOther == Unknown and safety)
  // An earlier request is applied and the newest fails: the page shows the applied size, not
  // the one it showed before either request.
  run failedNewestShowsAppliedSizeTest = init.then(mount).then(refresh).then(deviceHandles(false))
    .then(settleRead(readOp(1, 1, 0, 100, 0))).then(changeScale(115)).then(changeScale(130))
    .then(deviceHandles(false)).then(deviceHandles(true)).expect(s.deviceScale == 115)
    .then(settleWrite(writeOp(1, 1, 115))).expect(s.shownScale == 100 and s.held == 115)
    .then(settleWrite({ ...writeOp(2, 1, 130), scale: 115, failed: true }))
    .expect(s.shownScale == 115 and s.deviceScale == 115 and s.writeFailed and s.held == Unknown and safety)
  // The same requests with the failure arriving first: the applied size is shown when it arrives.
  run appliedSizeAfterFailureIsShownTest = init.then(mount).then(refresh).then(deviceHandles(false))
    .then(settleRead(readOp(1, 1, 0, 100, 0))).then(changeScale(115)).then(changeScale(130))
    .then(deviceHandles(false)).then(deviceHandles(true))
    .then(settleWrite({ ...writeOp(2, 1, 130), scale: 115, failed: true }))
    .expect(s.shownScale == 100 and s.writeFailed)
    .then(settleWrite(writeOp(1, 1, 115)))
    .expect(s.shownScale == 115 and s.deviceScale == 115 and s.restored == 2 and safety)
  run sizeControlNeedsReadTest = init.then(mount).then(changeScale(115).fail())
}
