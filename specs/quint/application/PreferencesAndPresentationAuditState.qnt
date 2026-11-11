// Complementary audit scope; the canonical model and its source correspondence remain registered separately.
/// Layout projection of surfaceLayout, keyboardFreeHeight and preference readback.
module PreferencesAndPresentationAuditState {
  type State = { width: int, freeHeight: int, visibleHeight: int, editing: bool,
    textScale: int, desktop: bool, theme: str, savedTheme: str, draft: str,
    selection: int, nativeShade: bool, webShade: bool }
  var s: State
  action init = s' = { width: 412, freeHeight: 915, visibleHeight: 915, editing: false,
    textScale: 100, desktop: false, theme: "light", savedTheme: "light", draft: "text",
    selection: 1, nativeShade: true, webShade: false }
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
  /// Android's shade is the only one on a phone; a browser development build has none and
  /// draws a stand-in instead.
  action browserBuild = all { not(s.webShade), s' = { ...s, nativeShade: false } }
  action androidBuild = all { not(s.webShade), s' = { ...s, nativeShade: true } }
  action webShade = all { not(s.nativeShade), s' = { ...s, webShade: true } }
  action closeWebShade = all { s.webShade, s' = { ...s, webShade: false } }
  action typeDraft = s' = { ...s, draft: "edited", selection: 2 }
  action step = any { keyboard, closeKeyboard, rotate, largeText, normalText, wide,
    saveTheme, failedSave, restart, browserBuild, androidBuild, webShade, closeWebShade, typeDraft, s' = s }
  val OneShade = not(s.nativeShade and s.webShade)
  val ReadableCalendar = calendarDays >= 1 and calendarDays <= 7 and (agenda implies calendarDays == 1)
  val LargeTextSinglePane = s.textScale >= 150 implies not(split)
  /// Layout changes leave the text being edited and its selection as they were typed.
  val StatePreserved = (s.draft == "text" and s.selection == 1) or (s.draft == "edited" and s.selection == 2)
  val safety = OneShade and ReadableCalendar and LargeTextSinglePane and StatePreserved
  val WebShadeWitness = s.webShade
  val EditedLandscapeWitness = s.draft == "edited" and landscape and s.editing
  run keyboardNotRotationTest = init.then(keyboard).expect(not(landscape) and safety)
  run rotationPreservesDraftTest = init.then(keyboard).then(rotate).expect(landscape and safety)
  run typedTextSurvivesLayoutChangesTest = init.then(typeDraft).then(keyboard).then(rotate).then(largeText).then(wide)
    .expect(s.draft == "edited" and s.selection == 2 and safety)
  run oneShadePerBuildTest = init.then(webShade.fail())
  run browserStandInTest = init.then(browserBuild).then(webShade).expect(s.webShade and not(s.nativeShade) and safety)
    .then(closeWebShade).then(androidBuild).expect(s.nativeShade and not(s.webShade) and safety)
  run largeTextTest = init.then(wide).then(largeText).expect(agenda and not(split) and safety)
  run preferenceReadbackTest = init.then(saveTheme).then(failedSave).then(restart).expect(s.theme == "dark" and safety)
}
