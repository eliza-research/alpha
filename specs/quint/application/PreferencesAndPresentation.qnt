/// Layout results returned by surfaceLayout and keyboardFreeHeight, plus preference readback.
module PreferencesAndPresentation {
  type State = { width: int, freeHeight: int, visibleHeight: int, editing: bool,
    textScale: int, desktop: bool, theme: str, savedTheme: str,
    renderedDays: int, renderedSplit: bool, renderedAgenda: bool }
  var s: State
  action init = s' = { width: 412, freeHeight: 915, visibleHeight: 915, editing: false,
    textScale: 100, desktop: false, theme: "light", savedTheme: "light",
    renderedDays: 1, renderedSplit: false, renderedAgenda: false }
  pure def project(st: State): State = {
    val agenda = not(st.desktop) and st.textScale >= 150
    val rawDays = (st.width - 76) / (240 * (if (st.textScale > 100) st.textScale else 100) / 100)
    {renderedAgenda: agenda,
      renderedSplit: not(st.desktop) and st.textScale < 150 and st.width >= 1000,
      renderedDays: if (agenda or st.desktop or rawDays < 1) 1 else if (rawDays > 7) 7 else rawDays, ...st}
  }
  val landscape = not(s.desktop) and s.width > s.freeHeight
  val agenda = s.renderedAgenda
  val split = s.renderedSplit
  val calendarDays = s.renderedDays
  action keyboard = s' = { ...s, editing: true, visibleHeight: 300 }
  action closeKeyboard = s' = { ...s, editing: false, visibleHeight: s.freeHeight }
  action rotate = s' = project({ ...s, width: s.freeHeight, freeHeight: s.width,
    visibleHeight: if (s.editing) 300 else s.width })
  action largeText = s' = project({ ...s, textScale: 150 })
  action normalText = s' = project({ ...s, textScale: 100 })
  action wide = s' = project({ ...s, width: 1200, freeHeight: 915, visibleHeight: 915 })
  action saveTheme = s' = { ...s, theme: "dark", savedTheme: "dark" }
  action failedSave = s' = s
  action restart = s' = { ...s, theme: s.savedTheme, editing: false, visibleHeight: s.freeHeight }
  action step = any { keyboard, closeKeyboard, rotate, largeText, normalText, wide,
    saveTheme, failedSave, restart, s' = s }
  val ReadableCalendar = calendarDays >= 1 and calendarDays <= 7 and (agenda implies calendarDays == 1)
  val LargeTextSinglePane = s.textScale >= 150 implies not(split)
  val AgendaMatchesText = agenda == (not(s.desktop) and s.textScale >= 150)
  val safety = ReadableCalendar and LargeTextSinglePane and AgendaMatchesText
  // These are excluded from step. They prove the result predicates reject broken publications.
  action brokenDayCount = s' = {...s, renderedDays: 0}
  action brokenLargeTextSplit = s' = {...s, renderedSplit: true}
  action brokenAgenda = s' = {...s, renderedAgenda: false}
  run keyboardNotRotationTest = init.then(keyboard).expect(not(landscape) and safety)
  run rotationKeepsGeometryTest = init.then(keyboard).then(rotate).expect(landscape and safety)
  run largeTextTest = init.then(wide).then(largeText).expect(agenda and not(split) and safety)
  run preferenceReadbackTest = init.then(saveTheme).then(failedSave).then(restart).expect(s.theme == "dark" and safety)
  run invalidCalendarResultCanaryTest = init.then(brokenDayCount).expect(not(safety))
  run invalidLargeTextSplitCanaryTest = init.then(largeText).then(brokenLargeTextSplit).expect(not(safety))
  run invalidAgendaCanaryTest = init.then(largeText).then(brokenAgenda).expect(not(safety))
}
