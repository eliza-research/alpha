/// Pure controls for retained browser Calendar forms. No provider mutation is modeled.
module CalendarFormControls {
  type State = { off: int, start: int, duration: int, days: int, leading: int }
  var s: State
  pure def windowStart(off: int): int = if (off == 0) 1 else if (off > 0) (if (off > 3) off - 3 else 1) else off - 3
  pure def window(off: int): Set[int] = Set(0).union(0.to(20).map(day => windowStart(off) + day))
  val windowDays = window(s.off)
  val rows = if (s.days + s.leading <= 35) 35 else 42
  action init = s' = {off: 0, start: 720, duration: 60, days: 30, leading: 1}
  action chooseDay(off: int): bool = all {window(s.off).contains(off), s' = {...s, off: off}}
  // Times are civil minutes. A date edit changes the chosen day, not the duration.
  pure def atLeast(value: int, minimum: int): int = if (value < minimum) minimum else value
  pure def atMost(value: int, maximum: int): int = if (value > maximum) maximum else value
  val end = s.start + s.duration
  action setDate(off: int): bool = s' = {...s, off: off}
  action setStart(start: int): bool = all { start.in(0.to(1439)), s' = {...s, start: start} }
  action setEnd(endAt: int): bool =
    s' = if (endAt > s.start) {...s, duration: endAt - s.start} else s
  action setEndDate(day: int): bool = setEnd(day * 1440 + end % 1440)
  action setEndTime(minute: int): bool = all {
    minute.in(0.to(1439)), setEnd((end / 1440) * 1440 + minute)
  }
  action retiredStart = s' = s
  action later = s' = {...s, start: atMost(s.start + 15, 1439)}
  action earlier = s' = {...s, start: atLeast(s.start - 15, 0)}
  action endLater = s' = {...s, duration: s.duration + 15}
  action endEarlier = s' = {...s, duration: atLeast(s.duration - 15, 1)}
  action month(days: int, leading: int): bool = all {
    days.in(28.to(31)), leading.in(0.to(6)), s' = {...s, days: days, leading: leading}
  }
  action step = any {
    {nondet off = window(s.off).oneOf(); chooseDay(off)},
    later, earlier, endLater, endEarlier, retiredStart,
    setDate(-40), setDate(40), setStart(0), setStart(1410), setStart(1439),
    setEndDate(0), setEndDate(2), setEndTime(720), setEndTime(721),
    month(30, 1), month(31, 5), month(28, 0)
  }
  val safety = window(s.off).contains(0) and window(s.off).contains(s.off)
    and s.start.in(0.to(1439)) and s.duration >= 1 and rows.in(Set(35, 42))
  run monthAheadAndTodayTest = init.then(chooseDay(20)).then(chooseDay(37)).expect(s.off == 37 and safety)
    .then(chooseDay(0)).expect(s.off == 0 and safety)
  run nearMidnightTest = init.then(setStart(1410)).then(later).expect(s.start == 1425 and s.duration == 60)
    .then(later).expect(s.start == 1439 and safety).then(later).expect(s.start == 1439)
    .then(setStart(1439)).then(later).expect(s.start == 1439 and safety)
    .then(earlier).expect(s.start == 1424).then(setStart(0)).then(earlier).expect(s.start == 0 and safety)
  run durationAndDirectInputsTest = init.then(setDate(40)).expect(s.off == 40 and safety)
    .then(setEndTime(720)).expect(s.duration == 60)
    .then(setEndTime(721)).then(endEarlier).expect(s.duration == 1 and safety)
    .then(setEndDate(2)).expect(s.duration == 2881)
    .then(endLater).expect(s.duration == 2896 and safety)
    .then(endEarlier).expect(s.duration == 2881)
    .then(retiredStart).expect(s.start == 720 and safety)
  run monthRowsTest = init.expect(rows == 35).then(month(31, 5)).expect(rows == 42 and safety)
    .then(month(28, 0)).expect(rows == 35 and safety)
}
