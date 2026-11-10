/// Pure controls for retained browser Calendar forms. No provider mutation is modeled.
module CalendarFormControls {
  type State = { off: int, start: int, duration: int, days: int, leading: int }
  var s: State
  pure def windowStart(off: int): int = if (off == 0) 1 else if (off > 0) (if (off > 3) off - 3 else 1) else off - 3
  pure def window(off: int): Set[int] = Set(0).union(windowStart(off).to(windowStart(off) + 20))
  val windowDays = window(s.off)
  val rows = if (s.days + s.leading <= 35) 35 else 42
  action init = s' = {off: 0, start: 48, duration: 4, days: 30, leading: 1}
  action chooseDay(off: int): bool = all {window(s.off).contains(off), s' = {...s, off: off}}
  action setTime(start: int, duration: int): bool = all {
    start.in(0.to(96)), duration.in(1.to(12)), s' = {...s, start: start, duration: duration}
  }
  action later = {
    val candidate = if (s.start + 1 < 96 - s.duration) s.start + 1 else 96 - s.duration
    s' = {...s, start: if (candidate > s.start) candidate else s.start}
  }
  action month(days: int, leading: int): bool = all {
    days.in(28.to(31)), leading.in(0.to(6)), s' = {...s, days: days, leading: leading}
  }
  action step = any {
    {nondet off = window(s.off).oneOf(); chooseDay(off)}, later,
    setTime(94, 4), setTime(88, 4), setTime(91, 5), month(30, 1), month(31, 5), month(28, 0)
  }
  val safety = window(s.off).contains(0) and window(s.off).contains(s.off)
    and s.start.in(0.to(96)) and s.duration.in(1.to(12)) and rows.in(Set(35, 42))
  run monthAheadAndTodayTest = init.then(chooseDay(20)).then(chooseDay(37)).expect(s.off == 37 and safety)
    .then(chooseDay(0)).expect(s.off == 0 and safety)
  run nearMidnightTest = init.then(setTime(94, 4)).then(later).expect(s.start == 94 and safety)
    .then(setTime(88, 4)).then(later).expect(s.start == 89 and safety)
    .then(setTime(91, 5)).then(later).expect(s.start == 91 and safety)
  run monthRowsTest = init.expect(rows == 35).then(month(31, 5)).expect(rows == 42 and safety)
    .then(month(28, 0)).expect(rows == 35 and safety)
}
