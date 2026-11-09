/// Android IME visibility and composer focus; viewport size is independent of native visibility.
module KeyboardFocus {
  type State = { native: int, covered: bool, focus: str, draft: str, selection: int }
  var s: State
  action init = s' = { native: -1, covered: false, focus: "none", draft: "keep", selection: 2 }
  action tapComposer = s' = { ...s, focus: "composer" }
  action tapOther = s' = { ...s, focus: "other" }
  action nativeVisibility(visible: bool): bool = s' = { ...s, native: if (visible) 1 else 0,
    focus: if (s.native == 1 and not(visible) and s.focus == "composer") "none" else s.focus }
  action viewport(covered: bool): bool = s' = { ...s, covered: covered,
    focus: if (s.native == -1 and s.covered and not(covered) and s.focus == "composer") "none" else s.focus }
  action background = s' = { ...s, focus: if (s.focus == "composer") "none" else s.focus }
  action step = any { tapComposer, tapOther, nativeVisibility(true), nativeVisibility(false),
    viewport(true), viewport(false), background }
  val safety = Set(-1, 0, 1).contains(s.native) and Set("none", "composer", "other").contains(s.focus)
    and s.draft == "keep" and s.selection == 2
  run floatingKeyboardBackAndRetapTest = init.then(tapComposer).then(nativeVisibility(true))
    .then(nativeVisibility(false)).expect(s.focus == "none" and not(s.covered) and safety)
    .then(tapComposer).then(nativeVisibility(false)).expect(s.focus == "composer" and safety)
  run initialHiddenDoesNotStealFocusTest = init.then(tapComposer).then(nativeVisibility(false))
    .expect(s.focus == "composer" and safety)
  run otherFieldRetainsFocusTest = init.then(nativeVisibility(true)).then(tapOther)
    .then(nativeVisibility(false)).expect(s.focus == "other" and safety)
  run browserFallbackTest = init.then(tapComposer).then(viewport(true)).then(viewport(false))
    .expect(s.focus == "none" and safety)
  run nativeOwnsResizeOrderingTest = init.then(tapComposer).then(nativeVisibility(true))
    .then(viewport(true)).then(viewport(false)).expect(s.focus == "composer" and safety)
    .then(nativeVisibility(false)).expect(s.focus == "none" and safety)
}
