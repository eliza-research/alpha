/// The keyboard-free window height as an estimator with memory, and the canvas arrangement
/// decided from it. Two phones stand for all: on the tall one a keyboard leaves the window
/// taller than wide, on the compact one it does not. The shell measures the window when it
/// mounts, before any field of the new document can hold focus, so the estimator always has a
/// keyboard-free height by the time a keyboard is up.
module KeyboardGeometry {
  type State = {
    compact: bool,
    // The window as Android has it: orientation, soft keyboard, and a focused text field.
    portrait: bool, keyboard: bool, focused: bool,
    // The estimator's remembered keyboard-free size.
    baseWidth: int, baseHeight: int,
    // The last published geometry and whether it was taken from the current window.
    free: int, landscape: bool, wide: bool, canvasWidth: int, measured: bool,
    // The remembered height was measured without a keyboard, or carried through a rotation
    // from one that was.
    primed: bool
  }
  var s: State

  pure val Keyboard = 300
  pure val ReferenceWidth = 412
  pure val WideCanvas = 760
  pure def short(compact: bool): int = if (compact) 360 else 412
  pure def long(compact: bool): int = if (compact) 640 else 915
  pure def width(v: State): int = if (v.portrait) short(v.compact) else long(v.compact)
  pure def fullHeight(v: State): int = if (v.portrait) long(v.compact) else short(v.compact)
  pure def height(v: State): int = if (v.keyboard) fullHeight(v) - Keyboard else fullHeight(v)
  pure def abs(n: int): int = if (n < 0) -n else n
  pure def max(a: int, b: int): int = if (a > b) a else b
  /// A width change while a field has focus is a rotation when the new width is within a fifth
  /// of the remembered height.
  pure def swapped(v: State): bool =
    v.focused and v.baseWidth > 0 and abs(width(v) - v.baseHeight) * 5 <= v.baseHeight
  pure def measuredState(v: State): State =
    val w = width(v)
    val h = height(v)
    val sameWidth = w == v.baseWidth
    val baseHeight =
      if (sameWidth) (if (not(v.focused) or h > v.baseHeight) h else v.baseHeight)
      else if (swapped(v)) max(h, v.baseWidth) else h
    val landscape = w > baseHeight
    val canvas = if (landscape or w >= ReferenceWidth) w else ReferenceWidth
    { ...v, baseWidth: w, baseHeight: baseHeight, free: baseHeight, landscape: landscape,
      canvasWidth: canvas, wide: canvas >= WideCanvas, measured: true,
      primed: if (not(v.keyboard)) true else if (sameWidth or swapped(v)) v.primed else false }

  action initWith(compact: bool): bool = s' = { compact: compact, portrait: true, keyboard: false,
    focused: false, baseWidth: 0, baseHeight: 0, free: 0, landscape: false, wide: false,
    canvasWidth: ReferenceWidth, measured: false, primed: false }
  action init = { nondet compact = Set(true, false).oneOf() initWith(compact) }
  action focus = all { not(s.focused), s' = { ...s, focused: true } }
  /// The keyboard rises only for a focused field, and only after the measurement the shell takes
  /// when it mounts: that one runs in the mount itself, the keyboard arrives in a later resize.
  val keyboardCanRise = s.focused and s.baseWidth > 0 and not(s.keyboard)
  action showKeyboard = all { keyboardCanRise, s' = { ...s, keyboard: true, measured: false } }
  /// Back can hide the keyboard and leave the field focused.
  action hideKeyboard = all { s.keyboard, s' = { ...s, keyboard: false, measured: false } }
  action blur = all { s.focused, s' = { ...s, focused: false, measured: s.measured and not(s.keyboard), keyboard: false } }
  /// Android keeps a focused field and its keyboard through a rotation.
  action rotate = s' = { ...s, portrait: not(s.portrait), measured: false }
  action measure = s' = measuredState(s)
  /// A reloaded renderer starts a new estimator. The replaced document has no focused field and
  /// the WebView drops its keyboard with the document, whatever the orientation is by then.
  action remount = s' = { ...s, focused: false, keyboard: false, baseWidth: 0, baseHeight: 0,
    measured: false, primed: false }
  action step = any { focus, showKeyboard, hideKeyboard, blur, rotate, measure, remount, s' = s }

  /// A keyboard is never read as a rotation: every published reading matches the orientation.
  val KeyboardIsNotRotation = s.measured implies s.landscape == not(s.portrait)
  val FreeHeightIsKeyboardFree = s.measured implies s.free == fullHeight(s)
  /// Every reading rests on a height measured without the keyboard, or carried through a
  /// rotation from one that was; a keyboard is never up over an estimator that has none.
  val EstimatorPrimedBeforeKeyboard = (s.measured implies s.primed) and
    (s.keyboard implies s.focused and s.baseWidth > 0)
  val ReadingColumnFromWideCanvas = s.wide == (s.canvasWidth >= WideCanvas) and
    (s.measured implies s.wide == (not(s.portrait) and not(s.compact)))
  val CanvasAtLeastWindow = s.measured implies s.canvasWidth >= width(s) and s.baseWidth == width(s)
  val safety = KeyboardIsNotRotation and FreeHeightIsKeyboardFree and EstimatorPrimedBeforeKeyboard and
    ReadingColumnFromWideCanvas and CanvasAtLeastWindow

  /// A compact portrait window is wider than tall under its keyboard and still reads portrait.
  val CompactKeyboardReadsPortraitWitness = s.measured and s.keyboard and s.portrait and
    height(s) < width(s) and not(s.landscape)
  val RotationWhileTypingWitness = s.measured and s.primed and s.keyboard and not(s.portrait) and s.landscape
  val WideCanvasWitness = s.measured and s.wide

  run keyboardIsNotRotationTest = initWith(true).then(measure).then(focus).then(showKeyboard).then(measure)
    .expect(height(s) < width(s) and not(s.landscape) and s.free == 640 and s.canvasWidth == 412 and safety)
  run rotationWhileTypingTest = initWith(false).then(measure).then(focus).then(showKeyboard).then(measure)
    .then(rotate).then(measure).expect(s.landscape and s.free == 412 and s.wide and safety)
    .then(rotate).then(measure).expect(not(s.landscape) and s.free == 915 and safety)
  run backHidesKeyboardTest = initWith(true).then(measure).then(focus).then(showKeyboard).then(measure)
    .then(hideKeyboard).then(measure).expect(s.focused and not(s.landscape) and s.free == 640 and safety)
  /// No keyboard before the mount measurement, on a first mount or a reloaded one.
  run keyboardWaitsForMountMeasurementTest = initWith(true).then(focus).expect(not(keyboardCanRise))
    .then(measure).then(showKeyboard).then(measure)
    .expect(not(s.landscape) and s.primed and s.free == 640 and safety)
    .then(remount).then(focus).expect(not(keyboardCanRise) and safety)
  /// Reloading while typing in a compact window: the new estimator first sees the window without
  /// the keyboard, so typing again never reads as landscape.
  run reloadWhileTypingTest = initWith(true).then(measure).then(focus).then(showKeyboard).then(measure)
    .then(remount).expect(not(s.focused) and not(s.keyboard) and not(s.measured) and safety)
    .then(measure).expect(not(s.landscape) and s.primed and s.free == 640 and safety)
    .then(focus).then(showKeyboard).then(measure)
    .expect(height(s) < width(s) and not(s.landscape) and s.free == 640 and safety)
  run remountKeepsTallReadingTest = initWith(false).then(measure).then(focus).then(showKeyboard).then(remount)
    .then(measure).expect(not(s.landscape) and s.free == 915 and s.primed and safety)
  run resizedWindowTakesMeasuredHeightTest = initWith(false).then(measure).then(rotate).then(measure)
    .expect(s.landscape and s.free == 412 and s.primed and safety)
}
