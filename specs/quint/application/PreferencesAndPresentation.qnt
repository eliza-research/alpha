/// Layout projection of surfaceLayout, keyboardFreeHeight and preference readback.
module PreferencesAndPresentation {
  type State = { width: int, freeHeight: int, visibleHeight: int, editing: bool,
    textScale: int, desktop: bool, theme: str, savedTheme: str, draft: str,
    selection: int, nativeShade: bool, webShade: bool, calendarItem: bool, mailConnected: bool, mailItems: bool, workflowItems: bool }
  var s: State
  action init = s' = { width: 412, freeHeight: 915, visibleHeight: 915, editing: false,
    textScale: 100, desktop: false, theme: "light", savedTheme: "light", draft: "text",
    selection: 1, nativeShade: true, webShade: false, calendarItem: false, mailConnected: false, mailItems: false, workflowItems: false }
  val landscape = not(s.desktop) and s.width > s.freeHeight
  val agenda = not(s.desktop) and s.textScale >= 150
  val split = not(s.desktop) and s.textScale < 150 and s.width >= 1000
  val rawDays = (s.width - 76) / (240 * (if (s.textScale > 100) s.textScale else 100) / 100)
  val calendarDays = if (agenda or s.desktop or rawDays < 1) 1 else if (rawDays > 7) 7 else rawDays
  action keyboard = s' = { ...s, editing: true, visibleHeight: 300 }
  action closeKeyboard = s' = { ...s, editing: false, visibleHeight: s.freeHeight }
  action rotate = s' = { ...s, width: s.freeHeight, freeHeight: s.width,
    visibleHeight: if (s.editing) 300 else s.width }
  action largeText = s' = { ...s, textScale: 150 }
  action normalText = s' = { ...s, textScale: 100 }
  action wide = s' = { ...s, width: 1200, freeHeight: 915, visibleHeight: 915 }
  action saveTheme = s' = { ...s, theme: "dark", savedTheme: "dark" }
  action failedSave = s' = s
  action restart = s' = { ...s, theme: s.savedTheme, editing: false, visibleHeight: s.freeHeight }
  action webShade = all { not(s.nativeShade), s' = { ...s, webShade: true } }
  val calendarShown = s.calendarItem
  val mailShown = s.mailConnected and s.mailItems
  val workflowsShown = s.workflowItems
  action populateWidgets = s' = {...s, calendarItem: true, mailConnected: true, mailItems: true, workflowItems: true}
  action disconnectMail = s' = {...s, mailConnected: false}
  action step = any { keyboard, closeKeyboard, rotate, largeText, normalText, wide,
    saveTheme, failedSave, restart, webShade, populateWidgets, disconnectMail, s' = s }
  val OneShade = not(s.nativeShade and s.webShade)
  val ReadableCalendar = calendarDays >= 1 and calendarDays <= 7 and (agenda implies calendarDays == 1)
  val LargeTextSinglePane = s.textScale >= 150 implies not(split)
  val StatePreserved = s.draft == "text" and s.selection == 1
  val safety = OneShade and ReadableCalendar and LargeTextSinglePane and StatePreserved
  run keyboardNotRotationTest = init.then(keyboard).expect(not(landscape) and safety)
  run rotationPreservesDraftTest = init.then(keyboard).then(rotate).expect(landscape and safety)
  run largeTextTest = init.then(wide).then(largeText).expect(agenda and not(split) and safety)
  run preferenceReadbackTest = init.then(saveTheme).then(failedSave).then(restart).expect(s.theme == "dark" and safety)
  run emptyWidgetsHiddenTest = init.expect(not(calendarShown) and not(mailShown) and not(workflowsShown))
  run populatedWidgetsShownTest = init.then(populateWidgets).expect(calendarShown and mailShown and workflowsShown)
  run disconnectedMailHiddenTest = init.then(populateWidgets).then(disconnectMail).expect(not(mailShown) and calendarShown and workflowsShown)
}
