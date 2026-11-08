/// Global startup recovery and the real React root boundary share one reload surface.
module RendererFailureUI {
  type State = { installed: bool, plain: bool, mounted: bool, failed: bool,
    healthy: bool, reactPanel: bool, forced: bool, dialogs: int, rootInert: bool,
    focus: str, plainClass: str, reactClass: str, logged: Set[{ kind: str, errorClass: str }], reloads: int }
  var s: State
  action init = s' = { installed: false, plain: false, mounted: false, failed: false,
    healthy: false, reactPanel: false, forced: false, dialogs: 0, rootInert: false,
    focus: "none", plainClass: "", reactClass: "", logged: Set(), reloads: 0 }
  pure def supportedClass(name: str): bool = name.in(Set("Error", "TypeError", "string", "null"))
  action install = s' = { ...s, installed: true }
  action openDialog = all { s.dialogs < 2, s' = { ...s, dialogs: s.dialogs + 1 } }
  action focusContent = all { s.healthy, not(s.plain), s' = { ...s, focus: "other" } }
  action show(kind: str, name: str): bool = all {
    kind.in(Set("startup", "uncaught")), supportedClass(name),
    if (s.plain or s.reactPanel) s' = s else s' = { ...s, plain: true, rootInert: true,
      focus: "reload", dialogs: 0, plainClass: name, logged: s.logged.union(Set({kind: kind, errorClass: name})) }
  }
  action globalError(valid: bool, name: str): bool = all { supportedClass(name),
    if (s.installed and valid and not(s.healthy or s.reactPanel)) show("startup", name) else s' = s }
  action rejection(name: str): bool = all { supportedClass(name),
    if (s.installed and not(s.healthy or s.reactPanel)) show("startup", name) else s' = s }
  action render(fails: bool, name: str): bool = all { supportedClass(name),
    if (s.mounted and s.failed) s' = s else
      if (fails or s.forced) s' = { ...s, mounted: true, failed: true, healthy: false,
        reactPanel: not(s.plain), forced: false, dialogs: 0, focus: "reload",
        reactClass: if (s.plain) "" else if (s.forced) "Error" else name,
        logged: s.logged.union(Set({kind: "render", errorClass: if (s.forced) "Error" else name})) }
      else s' = { ...s, mounted: true, failed: false, healthy: true, reactPanel: false, reactClass: "" }
  }
  action force = if (not(s.installed)) s' = s else
    if (s.mounted and not(s.failed)) s' = { ...s, forced: false, failed: true, healthy: false,
      reactPanel: not(s.plain), reactClass: if (s.plain) "" else "Error", focus: "reload", dialogs: 0,
      logged: s.logged.union(Set({kind: "render", errorClass: "Error"})) }
    else s' = { ...s, forced: true }
  action unmount = all { s.mounted, s' = { ...s, mounted: false, failed: false,
    healthy: false, reactPanel: false, reactClass: "", focus: if (s.plain) s.focus else "none" } }
  action reload = all { s.plain or s.reactPanel, s.reloads < 2,
    s' = { ...s, reloads: s.reloads + 1 } }
  action step = any { install, openDialog, focusContent, show("startup", "Error"),
    show("uncaught", "TypeError"), globalError(true, "Error"), globalError(false, "Error"),
    rejection("string"), render(false, "Error"), render(true, "Error"), render(true, "TypeError"),
    force, unmount, reload, s' = s }
  val SingleRecovery = not(s.plain and s.reactPanel)
  val BoundaryOwnsItsTree = s.reactPanel implies s.mounted and s.failed and not(s.healthy)
  val PlainRecoveryInertsRoot = s.plain implies s.rootInert
  val ClassesOnly = Set(s.plainClass, s.reactClass).subseteq(Set("", "Error", "TypeError", "string", "null"))
  val safety = SingleRecovery and BoundaryOwnsItsTree and PlainRecoveryInertsRoot and ClassesOnly
  run ignoredResourceErrorTest = init.then(install).then(globalError(false, "Error")).expect(not(s.plain) and safety)
  run startupClosesDialogsTest = init.then(install).then(openDialog).then(openDialog)
    .then(globalError(true, "TypeError")).expect(s.plain and s.dialogs == 0 and s.focus == "reload" and safety)
  run mountedErrorIgnoredTest = init.then(install).then(render(false, "Error"))
    .then(globalError(true, "Error")).then(rejection("string")).expect(s.healthy and not(s.plain) and safety)
  run renderFailureTest = init.then(openDialog).then(render(true, "TypeError"))
    .expect(s.reactPanel and s.dialogs == 0 and s.focus == "reload" and safety)
  run startupThenRenderTest = init.then(show("startup", "Error")).then(render(true, "TypeError"))
    .expect(s.plain and not(s.reactPanel) and s.failed and safety)
  run renderThenStartupTest = init.then(render(true, "TypeError")).then(show("startup", "Error"))
    .expect(s.reactPanel and not(s.plain) and safety)
  run stickyBoundaryTest = init.then(render(true, "Error")).then(render(false, "TypeError"))
    .expect(s.failed and s.reactClass == "Error" and safety)
  run pendingForcedFailureTest = init.then(install).then(force).then(render(false, "Error"))
    .expect(s.reactPanel and not(s.forced) and safety)
  run forceAfterFailureTest = init.then(install).then(render(true, "Error")).then(force).then(unmount)
    .then(render(false, "Error")).expect(s.reactPanel and not(s.forced) and safety)
  run repeatedRecoveryTest = init.then(show("startup", "Error")).then(show("uncaught", "TypeError"))
    .then(reload).expect(s.plainClass == "Error" and s.logged == Set({kind: "startup", errorClass: "Error"}) and safety)
}
