/// Home's per-render caches: the agenda card's remembered choice, valid until the clock reaches
/// the next candidate's end, and the storage probe answered at most once per interval. Time is
/// counted in ticks; three candidates stand for every agenda.
module HomeSurface {
  type Candidate = { id: int, begin: int, end: int, allDay: bool, overdue: bool }
  type State = {
    now: int,
    // What Home is given this render: the candidate list and whether the calendar is shown.
    input: Set[int],
    // The remembered agenda: the list it was built from, when it was chosen, until when it
    // stands, the card's item and the item after an overdue one (0 is none).
    built: bool, memoInput: Set[int], at: int, until: int, agenda: int, following: int,
    rendered: bool, selections: int,
    // Browser storage, the remembered probe answer, and whether storage changed since the probe.
    storageWorks: bool, available: bool, probeAt: int, probed: bool, checked: bool, changedSince: bool, probes: int
  }
  var s: State

  pure val Never = 99
  pure val LastTick = 6
  pure val Ttl = 2
  pure val Timed: Candidate = { id: 1, begin: 2, end: 3, allDay: false, overdue: false }
  pure val AllDay: Candidate = { id: 2, begin: 1, end: 5, allDay: true, overdue: false }
  pure val Overdue: Candidate = { id: 3, begin: 0, end: Never, allDay: false, overdue: true }
  pure val Universe = Set(Timed, AllDay, Overdue)
  pure def candidates(ids: Set[int]): Set[Candidate] = Universe.filter(c => ids.contains(c.id))
  /// A timed item stays through its last minute; an all-day item ends when its day does.
  pure def current(c: Candidate, now: int): bool = c.overdue or (if (c.allDay) c.end > now else c.end >= now)
  pure def rank(c: Candidate): int = (if (c.overdue) 0 else 100) + c.begin * 10 + c.id
  pure def first(cs: Set[Candidate]): int =
    cs.fold(0, (found, c) => if (cs.forall(other => rank(c) <= rank(other))) c.id else found)
  pure def chooseAgenda(ids: Set[int], now: int): int = first(candidates(ids).filter(c => current(c, now)))
  pure def chooseFollowing(ids: Set[int], now: int): int =
    val live = candidates(ids).filter(c => current(c, now))
    if (live.exists(c => c.overdue)) first(live.filter(c => not(c.overdue))) else 0
  pure def nextEnd(ids: Set[int], now: int): int =
    candidates(ids).fold(Never, (found, c) => if (c.end >= now and c.end < found) c.end else found)

  action init = s' = { now: 0, input: Set(), built: false, memoInput: Set(), at: 0, until: 0,
    agenda: 0, following: 0, rendered: false, selections: 0,
    storageWorks: true, available: true, probeAt: 0, probed: false, checked: false, changedSince: false, probes: 0 }
  action tick = all { s.now < LastTick, s' = { ...s, now: s.now + 1, rendered: false, checked: false } }
  action clockBack = all { s.now > 0, s' = { ...s, now: s.now - 1, rendered: false, checked: false } }
  action setInput(ids: Set[int]): bool = all { ids != s.input, s' = { ...s, input: ids, rendered: false } }
  /// The shell renders many times a second. The choice is made again only for a new list or
  /// when the clock leaves the interval the last choice stands for.
  action render = {
    val changed = not(s.built) or s.memoInput != s.input
    val stale = changed or not(s.now >= s.at and s.now < s.until)
    s' = if (stale) { ...s, built: true, memoInput: s.input, at: s.now, until: nextEnd(s.input, s.now),
        agenda: chooseAgenda(s.input, s.now), following: chooseFollowing(s.input, s.now), rendered: true,
        selections: if (s.selections < 9) s.selections + 1 else 9 }
      else { ...s, rendered: true }
  }
  action storageChanges = s' = { ...s, storageWorks: not(s.storageWorks), changedSince: true, checked: false }
  /// The synchronous storage read runs once per interval, and again if the clock went back.
  action checkStorage = {
    val due = not(s.probed) or s.now - s.probeAt >= Ttl or s.now < s.probeAt
    s' = if (due) { ...s, probed: true, probeAt: s.now, available: s.storageWorks, checked: true, changedSince: false,
        probes: if (s.probes < 9) s.probes + 1 else 9 }
      else { ...s, checked: true }
  }
  action step = {
    nondet ids = Set(1, 2, 3).powerset().oneOf()
    any { tick, clockBack, setInput(ids), render, storageChanges, checkStorage, s' = s }
  }

  /// A render always shows the choice a fresh selection would make.
  val RememberedChoiceIsFresh = s.rendered implies
    s.agenda == chooseAgenda(s.input, s.now) and s.following == chooseFollowing(s.input, s.now)
  val FollowingOnlyUnderOverdue = s.following != 0 implies s.agenda == Overdue.id and s.following != s.agenda
  val ChoiceFromGivenList = s.rendered implies (s.agenda == 0 or s.input.contains(s.agenda)) and s.memoInput == s.input
  /// A wrong storage answer is one that storage changed under, and it is at most one interval old.
  val ProbeAnswerBounded = s.checked and s.available != s.storageWorks implies
    s.changedSince and s.now - s.probeAt < Ttl and s.now >= s.probeAt
  val safety = RememberedChoiceIsFresh and FollowingOnlyUnderOverdue and ChoiceFromGivenList and ProbeAnswerBounded

  val ReusedChoiceWitness = s.rendered and s.selections == 1 and s.now >= 2 and s.agenda != 0
  val ExpiredChoiceWitness = s.rendered and s.input == Set(1, 2) and s.agenda == AllDay.id and s.now == 4
  val StaleProbeWitness = s.checked and s.available != s.storageWorks
  val OverdueLeadsWitness = s.rendered and s.agenda == Overdue.id and s.following == Timed.id

  // The timed item is still the card in its last minute and gives way the tick after.
  run choiceExpiresAtCandidateEndTest = init.then(setInput(Set(1))).then(render)
    .expect(s.agenda == 1 and s.until == 3 and s.selections == 1)
    .then(tick).then(render).then(tick).then(render).expect(s.agenda == 1 and s.selections == 1)
    .then(tick).then(render).expect(s.now == 3 and s.agenda == 1 and s.selections == 2 and safety)
    .then(tick).then(render).expect(s.agenda == 0 and s.selections == 3 and safety)
  run allDayEndsWithItsDayTest = init.then(setInput(Set(2))).then(render)
    .then(tick).then(tick).then(tick).then(tick).then(render).expect(s.now == 4 and s.agenda == 2 and s.selections == 1)
    .then(tick).then(render).expect(s.agenda == 0 and safety)
  run overdueLeadsAndNamesNextTest = init.then(setInput(Set(1, 2, 3))).then(render)
    .expect(s.agenda == 3 and s.following == 2 and safety)
  run newListIsChosenAgainTest = init.then(setInput(Set(1))).then(render).then(setInput(Set(1, 2))).then(render)
    .expect(s.agenda == 2 and s.selections == 2 and safety)
  run clockGoingBackChoosesAgainTest = init.then(setInput(Set(1))).then(tick).then(tick).then(tick).then(tick)
    .then(render).expect(s.agenda == 0).then(clockBack).then(render).expect(s.agenda == 1 and safety)
  run probeRunsOncePerIntervalTest = init.then(checkStorage).then(storageChanges).then(checkStorage)
    .expect(s.available and s.probes == 1 and safety)
    .then(tick).then(tick).then(checkStorage).expect(not(s.available) and s.probes == 2 and safety)
  run probeAfterClockBackTest = init.then(tick).then(tick).then(checkStorage).then(storageChanges).then(clockBack)
    .then(checkStorage).expect(not(s.available) and s.probes == 2 and safety)
}
