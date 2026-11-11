// Browser alarms: pages of the same origin share the alarm records, one visible page holds the
// alarm lock and rings, and the sound stops after a minute or when that page stops owning.
module BrowserAlarmRinging {
  type Tab = {
    // allowed: the page is visible, foreground and unlocked.
    allowed: bool,
    // granted: the lock callback is running and has not yet decided whether to own.
    granted: bool,
    owns: bool,
    // ringing: the posted-alarm set this page last rang for (0 when none).
    ringing: int,
    sound: bool
  }
  type State = {
    tabs: int -> Tab,
    // posted: the current set of ringing alarms, as a version number (0 when nothing rings).
    posted: int, versions: int,
    lockHolder: int
  }
  var s: State
  pure val Tabs = Set(1, 2)
  pure val quiet: Tab = { allowed: true, granted: false, owns: false, ringing: 0, sound: false }
  action init = s' = { tabs: Map(1 -> quiet, 2 -> quiet), posted: 0, versions: 0, lockHolder: 0 }
  pure def retired(tab: Tab): Tab = { ...tab, owns: false, ringing: 0, sound: false }
  def withTab(t: int, tab: Tab): int -> Tab = s.tabs.set(t, tab)

  action alarmPosted = all {
    s.versions < 3, s' = { ...s, posted: s.versions + 1, versions: s.versions + 1 }
  }
  // Dismissed, snoozed or deleted in any page.
  action alarmCleared = all { s.posted != 0, s' = { ...s, posted: 0 } }
  // The owner follows the alarm set: nothing posted releases the lock, a changed set rings again.
  action pollOwner(t: int): bool = all {
    Tabs.contains(t), s.tabs.get(t).allowed, s.tabs.get(t).owns,
    s' = if (s.posted == 0) { ...s, tabs: withTab(t, retired(s.tabs.get(t))), lockHolder: 0 }
      else if (s.posted != s.tabs.get(t).ringing)
        { ...s, tabs: withTab(t, { ...s.tabs.get(t), ringing: s.posted, sound: true }) }
      else s
  }
  // A page that does not own asks for the lock only if it is free; a held lock is not waited for.
  action requestLock(t: int): bool = all {
    Tabs.contains(t), s.tabs.get(t).allowed, not(s.tabs.get(t).owns), not(s.tabs.get(t).granted),
    s.posted != 0, s.lockHolder == 0,
    s' = { ...s, lockHolder: t, tabs: withTab(t, { ...s.tabs.get(t), granted: true }) }
  }
  // Inside the lock the alarms are read again. The page owns and rings only if something still
  // rings and it is still allowed; otherwise the lock is given back at once.
  action lockGranted(t: int): bool = all {
    Tabs.contains(t), s.tabs.get(t).granted,
    s' = if (s.posted != 0 and s.tabs.get(t).allowed and not(s.tabs.get(t).owns))
        { ...s, tabs: withTab(t, { ...s.tabs.get(t), granted: false, owns: true,
            ringing: s.posted, sound: true }) }
      else { ...s, lockHolder: 0, tabs: withTab(t, { ...s.tabs.get(t), granted: false }) }
  }
  // Hidden, unloading or locked: the page stops ringing and gives the lock back.
  action hide(t: int): bool = all {
    Tabs.contains(t), s.tabs.get(t).allowed,
    s' = { ...s, tabs: withTab(t, { ...retired(s.tabs.get(t)), allowed: false }),
      lockHolder: if (s.lockHolder == t and s.tabs.get(t).owns) 0 else s.lockHolder }
  }
  action show(t: int): bool = all {
    Tabs.contains(t), not(s.tabs.get(t).allowed),
    s' = { ...s, tabs: withTab(t, { ...s.tabs.get(t), allowed: true }) }
  }
  // The sound runs for at most a minute per ring, and Cancel or Back silences it at once.
  action soundEnds(t: int): bool = all {
    Tabs.contains(t), s.tabs.get(t).sound,
    s' = { ...s, tabs: withTab(t, { ...s.tabs.get(t), sound: false }) }
  }
  action step = {
    nondet t = Tabs.oneOf()
    any {
      alarmPosted, alarmCleared, pollOwner(t), requestLock(t), lockGranted(t), hide(t), show(t),
      soundEnds(t), s' = s
    }
  }

  val OneRinger = not(s.tabs.get(1).sound and s.tabs.get(2).sound)
    and not(s.tabs.get(1).owns and s.tabs.get(2).owns)
  val OwnerHoldsLock = Tabs.forall(t => s.tabs.get(t).owns implies s.lockHolder == t)
  val LockHasHolder = s.lockHolder == 0
    or s.tabs.get(s.lockHolder).owns or s.tabs.get(s.lockHolder).granted
  val SoundNeedsOwner = Tabs.forall(t => s.tabs.get(t).sound
    implies s.tabs.get(t).owns and s.tabs.get(t).allowed and s.tabs.get(t).ringing != 0)
  val OwnerIsVisible = Tabs.forall(t => s.tabs.get(t).owns implies s.tabs.get(t).allowed)
  val RingingIsKnownSet = Tabs.forall(t => s.tabs.get(t).ringing <= s.versions)
  val TypeOK = s.posted.in(0.to(3)) and s.versions.in(0.to(3)) and s.lockHolder.in(0.to(2))
  val safety = TypeOK and OneRinger and OwnerHoldsLock and LockHasHolder and SoundNeedsOwner
    and OwnerIsVisible and RingingIsKnownSet

  val RingingWitness = s.tabs.get(1).sound
  val OtherPageSilentWitness = s.tabs.get(1).owns and s.tabs.get(2).allowed and s.posted != 0
    and not(s.tabs.get(2).sound)
  val SilentAfterMinuteWitness = s.tabs.get(1).owns and not(s.tabs.get(1).sound) and s.posted != 0
  val HiddenDuringGrantWitness = s.tabs.get(2).granted and not(s.tabs.get(2).allowed)
  val HandoverWitness = s.tabs.get(2).owns and s.versions == 1

  run onePageRingsTest = init.then(alarmPosted).then(requestLock(1)).then(lockGranted(1))
    .expect(RingingWitness and s.lockHolder == 1 and safety)
    .then(alarmCleared).then(pollOwner(1))
    .expect(not(s.tabs.get(1).sound) and not(s.tabs.get(1).owns) and s.lockHolder == 0 and safety)
  // Two pages see the same alarm: only the lock holder rings.
  run twoPagesOneRingerTest = init.then(alarmPosted).then(requestLock(1)).then(requestLock(2).fail())
  run ownerHidesOtherTakesOverTest = init.then(alarmPosted).then(requestLock(1)).then(lockGranted(1))
    .expect(OtherPageSilentWitness).then(hide(1))
    .expect(not(s.tabs.get(1).sound) and s.lockHolder == 0 and safety)
    .then(requestLock(2)).then(lockGranted(2))
    .expect(s.tabs.get(2).sound and s.tabs.get(2).owns and not(s.tabs.get(1).owns) and safety)
  // The page went hidden between asking for the lock and getting it: it must not ring.
  run hiddenBeforeGrantTest = init.then(alarmPosted).then(requestLock(2)).then(hide(2))
    .expect(HiddenDuringGrantWitness).then(lockGranted(2))
    .expect(not(s.tabs.get(2).owns) and not(s.tabs.get(2).sound) and s.lockHolder == 0 and safety)
  run clearedBeforeGrantTest = init.then(alarmPosted).then(requestLock(1)).then(alarmCleared)
    .then(lockGranted(1)).expect(not(s.tabs.get(1).owns) and s.lockHolder == 0 and safety)
  run soundStopsThenRingsAgainTest = init.then(alarmPosted).then(requestLock(1)).then(lockGranted(1))
    .then(soundEnds(1)).expect(SilentAfterMinuteWitness).then(pollOwner(1))
    .expect(not(s.tabs.get(1).sound)).then(alarmPosted).then(pollOwner(1))
    .expect(s.tabs.get(1).sound and s.tabs.get(1).ringing == 2 and safety)
}
