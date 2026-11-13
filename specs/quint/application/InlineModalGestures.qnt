/// The keyboard and pointer gestures of a phone-positioned modal: Tab wrapping among its
/// controls, Escape, re-entry of focus when the focused control goes away, and the sheet's
/// drag-to-dismiss. Focus ownership on open and close is InlineModalFocus.
module InlineModalGestures {
  type State = {
    mounted: bool,
    // The dialog is a bottom sheet with a grip, decided when it mounts.
    sheet: bool,
    // No other open dialog sits above the modal.
    top: bool,
    // Controls the dialog shows, in order.
    controls: int,
    // Where focus is: a control's index, or one of the places below.
    focus: int,
    // Focus before a dialog opened above; the browser hands it back when that dialog closes.
    resume: int,
    // Where focus was when the modal mounted: the place it goes back to when the modal goes away.
    opener: int,
    // A captured sheet drag, how far down it is pulled (0 none, 1 short, 2 past the dismiss
    // distance), and whether the sheet is drawn displaced.
    drag: bool, pull: int, displaced: bool,
    closes: int, lastClose: str, lastKey: str,
    // Tab presses that wrapped, far pulls released under another dialog, short pulls released,
    // re-entries of focus after its control went away, and closes made under another dialog.
    wraps: int, suppressed: int, kept: int, reentries: int, closedUnder: bool
  }
  var s: State

  pure val OnDialog = -1
  pure val OnAssistant = -2
  pure val Nowhere = -3
  pure val Above = -4
  pure val MaxControls = 3
  pure val MaxCloses = 3
  pure def capped(n: int): int = if (n < 3) n + 1 else 3
  pure def entry(v: State): int = if (v.controls > 0) 0 else OnDialog
  pure def released(v: State): State = { ...v, drag: false, pull: 0, displaced: false }
  pure def closed(v: State, how: str): State =
    { ...v, closes: v.closes + 1, lastClose: how, closedUnder: v.closedUnder or not(v.top) }
  /// Focus that is on neither the dialog nor the assistant is brought to the first control.
  pure def contained(v: State): State =
    if (v.mounted and v.top and v.focus == Nowhere) { ...v, focus: entry(v), reentries: capped(v.reentries) } else v

  action init = s' = { mounted: false, sheet: false, top: true, controls: 0, focus: Nowhere, resume: Nowhere, opener: Nowhere,
    drag: false, pull: 0, displaced: false, closes: 0, lastClose: "", lastKey: "", wraps: 0, suppressed: 0,
    kept: 0, reentries: 0, closedUnder: false }
  /// Mounting moves focus to the first control, or to the dialog when it has none. A modal is
  /// opened from the page or from the assistant, which a dialog above would cover.
  action mount(sheet: bool, controls: int): bool = all { not(s.mounted), s.top, controls >= 0, controls <= MaxControls,
    s' = { ...s, mounted: true, sheet: sheet, controls: controls, opener: s.focus,
      focus: if (controls > 0) 0 else OnDialog, lastKey: "" } }
  /// Unmounting ends a drag. Focus held by the dialog above or by the assistant stays there;
  /// otherwise it goes back to where it was when the modal mounted.
  action unmount = all { s.mounted,
    s' = { ...released(s), mounted: false, sheet: false, controls: 0, lastKey: "", opener: Nowhere,
      focus: if (not(s.top)) Above else if (s.focus == OnAssistant) OnAssistant else s.opener, resume: Nowhere } }
  /// Tab at either end, or from outside the dialog, wraps to the other end. Between the ends
  /// the browser moves focus by one. Shift+Tab from the dialog itself is the browser's.
  action tab(shift: bool): bool = all { s.mounted, s.top, s.focus != Above, not(shift and s.focus == OnDialog and s.controls > 0),
    val outside = s.focus == OnAssistant or s.focus == Nowhere
    val target =
      if (s.controls == 0) OnDialog
      else if (shift and (s.focus == 0 or outside)) s.controls - 1
      else if (not(shift) and (s.focus == s.controls - 1 or outside)) 0
      else if (shift) s.focus - 1 else s.focus + 1
    val wrapped = s.controls > 0 and (outside or (shift and s.focus == 0) or (not(shift) and s.focus == s.controls - 1))
    s' = { ...s, focus: target, lastKey: "tab", wraps: if (wrapped) capped(s.wraps) else s.wraps } }
  /// Escape closes only the top layer.
  action escape = all { s.mounted, s.closes < MaxCloses,
    s' = if (s.top) { ...closed(s, "escape"), lastKey: "escape" } else { ...s, lastKey: "escape" } }
  /// The assistant stays usable beside the modal: focus may rest there.
  action focusAssistant = all { s.mounted, s.top, s' = { ...s, focus: OnAssistant, lastKey: "" } }
  /// The last control leaves the dialog. If it held focus, focus drops and is brought back in.
  action controlLeaves = all { s.mounted, s.controls > 0,
    val fewer = { ...s, controls: s.controls - 1, lastKey: "",
      focus: if (s.focus == s.controls - 1) Nowhere else s.focus,
      resume: if (s.resume == s.controls - 1) Nowhere else s.resume }
    s' = contained(fewer) }
  action controlArrives = all { s.mounted, s.controls < MaxControls,
    s' = contained({ ...s, controls: s.controls + 1, lastKey: "" }) }
  action dialogOpensAbove = all { s.top, s' = { ...s, top: false, resume: s.focus, focus: Above, lastKey: "" } }
  action dialogAboveCloses = all { not(s.top), s' = { ...s, top: true, focus: s.resume, resume: Nowhere, lastKey: "" } }
  /// A press on the sheet's grip area, away from its controls, starts a drag on the top layer.
  action press(place: str): bool = all { s.mounted, not(s.drag), place.in(Set("grip", "control", "low")),
    s' = if (s.sheet and s.top and place == "grip") { ...s, drag: true, pull: 0, lastKey: "" } else { ...s, lastKey: "" } }
  /// A mostly sideways move abandons the drag; any other draws the sheet at the pulled distance.
  action move(kind: str): bool = all { s.mounted, kind.in(Set("up", "short", "far", "side")),
    s' = if (not(s.drag)) { ...s, lastKey: "" }
      else if (kind == "side") { ...released(s), lastKey: "" }
      else { ...s, displaced: true, pull: if (kind == "far") 2 else if (kind == "short") 1 else 0, lastKey: "" } }
  /// Release past the dismiss distance closes the top layer; any release puts the sheet back.
  action lift = all { s.mounted, s.closes < MaxCloses,
    val far = s.drag and s.pull == 2
    val back = { ...released(s), lastKey: "",
      kept: if (s.drag and s.pull == 1) capped(s.kept) else s.kept,
      suppressed: if (far and not(s.top)) capped(s.suppressed) else s.suppressed }
    s' = if (far and s.top) closed(back, "drag") else back }
  action pointerCancel = all { s.mounted, s' = { ...released(s), lastKey: "" } }
  action step = {
    nondet flag = Set(true, false).oneOf()
    nondet count = 0.to(MaxControls).oneOf()
    nondet place = Set("grip", "control", "low").oneOf()
    nondet kind = Set("up", "short", "far", "side").oneOf()
    any { mount(flag, count), unmount, tab(flag), escape, focusAssistant, controlLeaves, controlArrives,
      dialogOpensAbove, dialogAboveCloses, press(place), move(kind), lift, pointerCancel, s' = s }
  }

  /// Only a mounted bottom sheet is dragged.
  val DragNeedsSheet = s.drag implies s.mounted and s.sheet
  /// The sheet is displaced only by the drag that holds it.
  val DisplacedNeedsDrag = s.pull > 0 or s.displaced implies s.drag
  val FocusNamesAControl = s.focus >= Above and s.focus < s.controls and s.resume < s.controls and
    (s.focus >= OnDialog implies s.mounted) and s.opener.in(Set(Nowhere, OnAssistant))
  /// Tab on the top layer never leaves the dialog.
  val TabStaysInside = s.lastKey == "tab" implies s.focus >= OnDialog
  /// A dialog above takes focus, and only then.
  val AboveOwnsFocus = (s.focus == Above) == not(s.top)
  /// Neither Escape nor a drag closes a modal that is under another dialog.
  val NoCloseUnderDialog = not(s.closedUnder) and (s.lastClose != "" implies s.closes > 0)
  val safety = DragNeedsSheet and DisplacedNeedsDrag and FocusNamesAControl and TabStaysInside and
    AboveOwnsFocus and NoCloseUnderDialog

  val DragDismissWitness = s.lastClose == "drag"
  val ShortPullStaysWitness = s.kept > 0 and s.closes == 0
  val WrapWitness = s.wraps > 0
  val SuppressedDismissWitness = s.suppressed > 0
  val ReentryWitness = s.reentries > 0
  val RestsOnBodyWitness = s.mounted and s.top and s.focus == Nowhere
  /// A modal opened from the assistant gives focus back to it.
  val ReturnsToAssistantWitness = not(s.mounted) and s.focus == OnAssistant

  run tabWrapsAtBothEndsTest = init.then(mount(false, 3)).expect(s.focus == 0)
    .then(tab(true)).expect(s.focus == 2 and s.wraps == 1)
    .then(tab(false)).expect(s.focus == 0 and s.wraps == 2)
    .then(tab(false)).expect(s.focus == 1 and s.wraps == 2 and safety)
  run emptyDialogKeepsFocusTest = init.then(mount(false, 0)).expect(s.focus == OnDialog)
    .then(tab(false)).then(tab(true)).expect(s.focus == OnDialog and s.wraps == 0 and safety)
  run tabReturnsFromAssistantTest = init.then(mount(false, 2)).then(focusAssistant)
    .then(tab(true)).expect(s.focus == 1 and safety)
  run lostControlBringsFocusBackTest = init.then(mount(false, 2)).then(tab(false)).expect(s.focus == 1)
    .then(controlLeaves).expect(s.focus == 0 and s.reentries == 1 and safety)
    .then(controlLeaves).expect(s.focus == OnDialog and s.reentries == 2 and safety)
  run farPullDismissesSheetTest = init.then(mount(true, 1)).then(press("grip")).then(move("far"))
    .expect(s.displaced and s.pull == 2)
    .then(lift).expect(s.closes == 1 and s.lastClose == "drag" and not(s.displaced) and safety)
  run shortPullSpringsBackTest = init.then(mount(true, 1)).then(press("grip")).then(move("short")).then(lift)
    .expect(s.closes == 0 and s.kept == 1 and not(s.displaced) and safety)
  run sidewaysMoveAbandonsDragTest = init.then(mount(true, 1)).then(press("grip")).then(move("far")).then(move("side"))
    .expect(not(s.drag) and not(s.displaced)).then(lift).expect(s.closes == 0 and safety)
  run onlyTheGripDragsTest = init.then(mount(true, 1)).then(press("control")).then(move("far")).then(lift)
    .expect(s.closes == 0).then(unmount).then(mount(false, 1)).then(press("grip")).then(move("far")).then(lift)
    .expect(s.closes == 0 and safety)
  run dialogAboveOwnsEscapeAndDragTest = init.then(mount(true, 2)).then(press("grip")).then(move("far"))
    .then(dialogOpensAbove).then(escape).expect(s.closes == 0)
    .then(lift).expect(s.closes == 0 and s.suppressed == 1 and safety)
    .then(dialogAboveCloses).expect(s.focus == 0).then(escape).expect(s.closes == 1 and s.lastClose == "escape" and safety)
  run unmountReturnsFocusTest = init.then(mount(false, 1)).then(focusAssistant).then(unmount)
    .expect(s.focus == OnAssistant and safety)
    .then(mount(false, 2)).expect(s.focus == 0 and s.opener == OnAssistant)
    .then(unmount).expect(s.focus == OnAssistant and safety)
    .then(mount(false, 1)).then(dialogOpensAbove).then(unmount).expect(s.focus == Above and safety)
}
