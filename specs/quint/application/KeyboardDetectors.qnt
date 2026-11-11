/// The two keyboard detectors that watch one window: the canvas estimator, which keeps the
/// keyboard-free height to decide the arrangement, and the chat dock's watch, which keeps its
/// own estimate and calls the composer covered when more than a threshold of that height is
/// hidden. Both run on every resize, the dock's first. One phone and two keyboards stand for
/// all: a full keyboard and a short bar under the dock's threshold.
module KeyboardDetectors {
  type Base = { w: int, h: int }
  type State = {
    // The keyboard covers the page without resizing its layout (only the visual viewport
    // shrinks), or it resizes the layout.
    overlay: bool,
    portrait: bool, keyboard: int, focused: bool,
    // Each detector's remembered keyboard-free size.
    canvas: Base, dock: Base,
    // The canvas reading, and the dock's: covered now, and covered at its last look.
    free: int, landscape: bool, covered: bool, open: bool,
    // Both detectors have looked at the window as it is.
    settled: bool,
    releases: int, covers: int,
    // The composer was released while the short bar was still up.
    releasedUnderBar: bool
  }
  var s: State

  pure val Short = 412
  pure val Long = 915
  pure val Bar = 120
  pure val Tall = 300
  pure val Threshold = 150
  pure def width(v: State): int = if (v.portrait) Short else Long
  pure def full(v: State): int = if (v.portrait) Long else Short
  pure def visual(v: State): int = full(v) - v.keyboard
  pure def layout(v: State): int = if (v.overlay) full(v) else visual(v)
  pure def abs(n: int): int = if (n < 0) -n else n
  pure def max(a: int, b: int): int = if (a > b) a else b
  pure def more(n: int): int = if (n < 3) n + 1 else 3
  /// The shared estimator: a shorter window at the same width while typing is the keyboard; a
  /// width within a fifth of the remembered height while typing is a rotation.
  pure def estimate(base: Base, w: int, h: int, editing: bool): Base =
    if (w == base.w) (if (not(editing) or h > base.h) { w: w, h: h } else base)
    else if (editing and base.w > 0 and abs(w - base.h) * 5 <= base.h) { w: w, h: max(h, base.w) }
    else { w: w, h: h }

  /// Both detectors first see the window when the shell mounts, before a keyboard can be up.
  action initWith(overlay: bool): bool = s' = { overlay: overlay, portrait: true, keyboard: 0, focused: false,
    canvas: { w: Short, h: Long }, dock: { w: Short, h: Long }, free: Long, landscape: false,
    covered: false, open: false, settled: true, releases: 0, covers: 0, releasedUnderBar: false }
  action init = { nondet overlay = Set(true, false).oneOf() initWith(overlay) }
  action focus = all { not(s.focused), s' = { ...s, focused: true } }
  action blur = all { s.focused, s' = { ...s, focused: false, keyboard: 0, settled: s.settled and s.keyboard == 0 } }
  action raise(height: int): bool = all { s.focused, s.keyboard == 0, height.in(Set(Bar, Tall)),
    s' = { ...s, keyboard: height, settled: false } }
  /// Back hides the keyboard and leaves the field focused.
  action lower = all { s.keyboard > 0, s' = { ...s, keyboard: 0, settled: false } }
  action rotate = s' = { ...s, portrait: not(s.portrait), settled: false }
  /// One resize event. The dock looks first: a keyboard that was covering and no longer is
  /// releases the composer, so the canvas then measures an unfocused window. A release under a
  /// keyboard still showing blurs its field: that keyboard goes, and the window it leaves has
  /// not been measured yet.
  action resize = {
    val dock = estimate(s.dock, width(s), layout(s), s.focused)
    val covered = dock.h - visual(s) > Threshold
    val release = s.open and not(covered) and s.focused
    val focused = s.focused and not(release)
    val canvas = estimate(s.canvas, width(s), layout(s), focused)
    s' = { ...s, dock: dock, covered: covered, open: covered, focused: focused, canvas: canvas, free: canvas.h,
      landscape: width(s) > canvas.h, keyboard: if (release) 0 else s.keyboard,
      settled: not(release and s.keyboard > 0),
      releasedUnderBar: s.releasedUnderBar or (release and s.keyboard == Bar),
      releases: if (release) more(s.releases) else s.releases,
      covers: if (covered and not(s.open)) more(s.covers) else s.covers }
  }
  action step = {
    nondet height = Set(Bar, Tall).oneOf()
    any { focus, blur, raise(height), lower, rotate, resize, s' = s }
  }

  /// The two estimators never drift apart: both rest on the same keyboard-free size.
  val EstimatorsAgree = s.settled implies s.dock == s.canvas
  /// The dock calls the composer covered exactly under the full keyboard, in either window mode.
  val DockCoversFullKeyboard = s.settled implies s.covered == (s.keyboard == Tall)
  val CanvasReadsOrientation = s.settled implies s.landscape == not(s.portrait) and s.free == full(s)
  val OpenIsLastLook = s.open == s.covered
  /// The composer is released only by a keyboard the dock saw cover it.
  val ReleaseFollowsCover = s.releases <= s.covers and (s.releasedUnderBar implies s.releases > 0)
  val safety = EstimatorsAgree and DockCoversFullKeyboard and CanvasReadsOrientation and OpenIsLastLook and
    ReleaseFollowsCover

  /// A short bar shortens the window without the dock calling the composer covered, while the
  /// canvas still keeps the keyboard-free height: closing it releases nothing.
  val ShortBarUnseenWitness = s.settled and s.keyboard == Bar and not(s.covered) and s.free == full(s) and not(s.overlay)
  val RotationUnderKeyboardWitness = s.settled and s.keyboard == Tall and not(s.portrait) and s.covered
  val OverlayCoverWitness = s.overlay and s.settled and s.covered
  val ReleasedComposerWitness = s.releases > 0 and not(s.focused) and s.settled
  /// The full keyboard is swapped for the short bar between two looks: the dock takes the bar
  /// for a closed keyboard and releases the composer under it.
  val SwappedKeyboardReleaseWitness = s.releasedUnderBar

  run backHidesKeyboardReleasesComposerTest = initWith(false).then(focus).then(raise(Tall)).then(resize)
    .expect(s.covered and s.free == Long and not(s.landscape) and safety)
    .then(lower).then(resize).expect(not(s.covered) and not(s.focused) and s.releases == 1 and safety)
  run shortBarIsNotCoveredTest = initWith(false).then(focus).then(raise(Bar)).then(resize)
    .expect(not(s.covered) and s.free == Long and safety)
    .then(lower).then(resize).expect(s.focused and s.releases == 0 and safety)
  run overlayKeyboardIsCoveredTest = initWith(true).then(focus).then(raise(Tall)).then(resize)
    .expect(s.covered and s.dock == { w: Short, h: Long } and safety)
  run rotationWhileTypingTest = initWith(false).then(focus).then(raise(Tall)).then(resize).then(rotate).then(resize)
    .expect(s.covered and s.landscape and s.free == Short and s.dock == s.canvas and safety)
    .then(rotate).then(resize).expect(s.covered and not(s.landscape) and s.free == Long and safety)
  run blurLowersWithoutReleaseTest = initWith(false).then(focus).then(raise(Tall)).then(resize).then(blur).then(resize)
    .expect(not(s.covered) and s.releases == 0 and safety)
  run swappedKeyboardReleasesComposerTest = initWith(false).then(focus).then(raise(Tall)).then(resize)
    .then(lower).then(raise(Bar)).then(resize)
    .expect(not(s.focused) and s.keyboard == 0 and s.releasedUnderBar and not(s.settled) and s.free == Long - Bar and safety)
    .then(resize).expect(s.settled and s.free == Long and safety)
  run keyboardNeedsFocusTest = initWith(false).then(raise(Tall).fail())
}
