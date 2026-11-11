/// Native Back: the availability flag Android tests before it leaves the activity, and the one
/// renderer layer each Back closes. Two views stand for every app: one rests on the composer
/// bar, one on the pill.
module BackDispatch {
  type State = {
    // Host: "standalone", "launcher" (launcher flavour, not the HOME app), "home" or "assistant".
    host: str,
    // Layers above the shell, topmost first: a menu popover, a dialog, a modal panel, and an
    // inert phone that none of them owns.
    popover: bool, dialog: bool, panel: bool, inert: bool,
    shade: bool, voice: bool, chat: str,
    // The open view ("" is Home), the views showing their own inner page (each view keeps its
    // page while another view is in front), and the views Back returns to.
    view: str, inners: Set[str], stack: List[str],
    // Home's launcher layers.
    drawer: bool, menu: bool, homeEdit: bool, homeAdd: bool,
    // The last native Back: who took it, what it closed, how many layers went with it, and
    // whether the activity was left while a layer was still open.
    outcome: str, closed: str, removed: int, lostLayer: bool
  }
  var s: State

  pure val BarView = "barView"
  pure val PillView = "pillView"
  pure val Views = Set(BarView, PillView)
  pure val Hosts = Set("standalone", "launcher", "home", "assistant")
  pure val StackLimit = 2

  pure def rest(view: str): str = if (view == PillView) "hidden" else "input"
  /// The open view is on its inner page.
  pure def inner(v: State): bool = v.view != "" and v.inners.contains(v.view)
  /// The assistant surface is the conversation itself: it never rests on the bar or the pill.
  pure def chatOf(v: State): str =
    if (v.host == "assistant" and v.view == "" and (v.chat == "input" or v.chat == "hidden")) "full" else v.chat
  pure def count(flag: bool): int = if (flag) 1 else 0
  pure def layers(v: State): int =
    count(v.popover) + count(v.dialog) + count(v.panel) + count(v.shade) + count(v.voice) +
    count(v.view != "") + count(v.drawer) + count(v.menu) + count(v.homeEdit) + count(v.homeAdd) +
    count(chatOf(v) == "sheet" or chatOf(v) == "full")
  /// The flag the activity reads. It names every state the renderer's Back handler consumes.
  pure def canGoBack(v: State): bool =
    v.dialog or v.view != "" or v.drawer or v.homeEdit or v.homeAdd or v.shade or
    chatOf(v) == "sheet" or chatOf(v) == "full" or v.voice or v.inert or v.panel

  pure def home(v: State): State =
    { ...v, view: "", stack: List(), drawer: false, menu: false, chat: "input",
      shade: false, homeEdit: false, homeAdd: false, popover: false }
  pure def shellBack(v: State): State =
    val chat = chatOf(v)
    if (v.shade) { ...v, shade: false, closed: "shade" }
    else if (v.host == "assistant" and v.view == "" and not(v.voice)) { ...v, closed: "assistant" }
    else if (v.drawer and v.view == "") { ...v, drawer: false, closed: "drawer" }
    else if (v.voice) { ...v, voice: false, closed: "voice" }
    else if (chat == "full") { ...v, chat: "sheet", closed: "conversation" }
    else if (chat == "sheet") { ...v, chat: rest(v.view), closed: "conversation" }
    else if (chat == "input" and rest(v.view) == "hidden") { ...v, chat: "hidden", closed: "bar" }
    else if (v.view != "")
      if (inner(v)) { ...v, inners: v.inners.exclude(Set(v.view)), closed: "inner" }
      else if (v.stack.length() > 0)
        val previous = v.stack.nth(v.stack.length() - 1)
        { ...v, view: previous, stack: v.stack.slice(0, v.stack.length() - 1), chat: rest(previous),
          closed: "stack" }
      // The assistant surface has no Home under its views: leaving the last one closes it.
      else if (v.host == "assistant") { ...v, closed: "assistant" }
      else { ...home(v), closed: "view" }
    else { ...v, closed: "none" }
  /// Home's launcher layers close innermost first; voice and an open conversation lie above
  /// edit mode.
  pure def launcherBack(v: State): State =
    val chat = chatOf(v)
    val above = v.voice or chat == "full" or chat == "sheet" or v.host == "assistant"
    val atHome = v.view == "" and not(v.shade)
    if (atHome and v.menu) { ...v, menu: false, closed: "menu" }
    else if (atHome and not(above) and v.homeAdd) { ...v, homeAdd: false, closed: "add" }
    else if (atHome and not(above) and v.homeEdit and not(v.drawer)) { ...v, homeEdit: false, closed: "edit" }
    else shellBack(v)
  pure def rendererBack(v: State): State =
    if (v.popover) { ...v, popover: false, closed: "popover" }
    else if (v.dialog) { ...v, dialog: false, closed: "dialog" }
    else if (v.panel) { ...v, panel: false, closed: "panel" }
    // An inert phone with no modal of its own is not navigated underneath.
    else if (v.inert) { ...v, closed: "none" }
    else launcherBack(v)

  action initHost(host: str): bool = all { host.in(Hosts),
    s' = { host: host, popover: false, dialog: false, panel: false, inert: false, shade: false,
      voice: false, chat: "input", view: "", inners: Set(), stack: List(), drawer: false, menu: false,
      homeEdit: false, homeAdd: false, outcome: "none", closed: "none", removed: 0, lostLayer: false } }
  action init = { nondet host = Hosts.oneOf() initHost(host) }

  val running = s.outcome != "finish" and s.closed != "assistant"
  val unblocked = running and not(s.popover or s.dialog or s.panel or s.inert)
  /// A view opened from elsewhere starts on its first page; opening the view already in front
  /// leaves it as it is.
  action openView(view: str, push: bool): bool = all { unblocked, view.in(Views),
    s' = { ...s, view: view, inners: if (view != s.view) s.inners.exclude(Set(view)) else s.inners, shade: false, drawer: false, menu: false, homeEdit: false,
      homeAdd: false, chat: rest(view),
      stack: if (push and s.view != "" and s.view != view)
          (if (s.stack.length() < StackLimit) s.stack.append(s.view) else s.stack.slice(1, StackLimit).append(s.view))
        else List() } }
  action openInner = all { unblocked, s.view != "", s' = { ...s, inners: s.inners.union(Set(s.view)) } }
  /// Menus are opened from inside a view.
  action openPopover = all { running, s.view != "", not(s.dialog or s.panel or s.inert), s' = { ...s, popover: true } }
  action openDialog = all { running, s' = { ...s, dialog: true } }
  action openPanel = all { running, not(s.dialog), s' = { ...s, panel: true } }
  action holdInert = all { running, s' = { ...s, inert: true } }
  action releaseInert = all { running, s' = { ...s, inert: false } }
  action openShade = all { unblocked, s' = { ...s, shade: true } }
  action openDrawer = all { unblocked, s.host != "assistant", s.view == "", not(s.homeEdit),
    s' = { ...s, drawer: true, menu: false } }
  action openMenu = all { unblocked, s.drawer, s.view == "", s' = { ...s, menu: true } }
  action startEdit = all { unblocked, s.host != "assistant", s.view == "", not(s.drawer),
    s' = { ...s, homeEdit: true, homeAdd: false } }
  action openAdd = all { unblocked, s.homeEdit, s' = { ...s, homeAdd: true } }
  action startVoice = all { unblocked, s' = { ...s, voice: true, shade: false } }
  action moveChat(chat: str): bool = all { unblocked, not(s.voice),
    chat.in(Set("hidden", "input", "sheet", "full")), s' = { ...s, chat: chat } }
  /// Android hands Back to the page only while the flag is set. Otherwise the HOME app stays on
  /// Home, the launcher flavour moves its task back and any other activity finishes.
  action nativeBack = all { running,
    val after = rendererBack(s)
    s' = if (canGoBack(s)) { ...after, outcome: "renderer", removed: layers(s) - layers(after), lostLayer: false }
      else if (s.host == "home") { ...home(s), outcome: "home", closed: "none", removed: 0, lostLayer: false }
      else { ...s, outcome: if (s.host == "launcher") "background" else "finish", closed: "none",
        removed: 0, lostLayer: layers(s) > 0 } }
  /// The HOME gesture reaches the page as its own event.
  action homeGesture = all { running, s.host == "home", not(s.inert),
    s' = { ...home(s), outcome: "home", closed: "none", removed: 0 } }
  action step = {
    nondet view = Views.oneOf()
    nondet push = Set(true, false).oneOf()
    nondet chat = Set("hidden", "input", "sheet", "full").oneOf()
    any { openView(view, push), openInner, openPopover, openDialog, openPanel, holdInert, releaseInert,
      openShade, openDrawer, openMenu, startEdit, openAdd, startVoice, moveChat(chat), nativeBack,
      homeGesture, s' = s }
  }

  /// Leaving the activity never abandons an open layer.
  val FlagCoversLayers = not(canGoBack(s)) implies rendererBack(s).closed == "none" and layers(s) == 0
  /// A Back the page takes closes something, unless the phone is held inert without a modal.
  val BackMakesProgress = canGoBack(s) and not(s.inert and not(s.popover or s.dialog or s.panel))
    implies rendererBack(s).closed != "none"
  val NoExitOverLayer = not(s.lostLayer)
  val HomeAppStays = s.host == "home" implies not(s.outcome.in(Set("finish", "background")))
  val OneLayerPerBack = s.removed <= 1 and (s.outcome == "renderer" and s.closed == "none" implies s.removed == 0)
  val LauncherLayersAtHome = (s.menu implies s.drawer) and (s.homeAdd implies s.homeEdit) and
    (s.drawer or s.homeEdit implies s.view == "" and s.host != "assistant") and not(s.drawer and s.homeEdit)
  val BoundedStack = s.stack.length() <= StackLimit and (s.view == "" implies s.stack.length() == 0) and
    s.inners.subseteq(Views)
  val safety = FlagCoversLayers and BackMakesProgress and NoExitOverLayer and HomeAppStays and
    OneLayerPerBack and LauncherLayersAtHome and BoundedStack

  val FinishWitness = s.outcome == "finish"
  val BackgroundWitness = s.outcome == "background"
  val StackReturnWitness = s.closed == "stack"
  val InertHoldWitness = s.outcome == "renderer" and s.closed == "none" and s.view != ""
  /// Back returned to a view that was left on its inner page.
  val KeptInnerPageWitness = s.closed == "stack" and inner(s)
  val AssistantViewClosesWitness = s.closed == "assistant" and s.view != ""

  // The drawer over Home in a standalone activity: Back closes it and only the next Back leaves.
  run drawerBeforeExitTest = initHost("standalone").then(openDrawer).then(nativeBack)
    .expect(s.outcome == "renderer" and s.closed == "drawer" and not(s.drawer) and safety)
    .then(nativeBack).expect(s.outcome == "finish" and not(s.lostLayer) and safety)
  run homeAppStaysTest = initHost("home").then(nativeBack).expect(s.outcome == "home" and safety)
    .then(openView(PillView, false)).then(nativeBack)
    .expect(s.outcome == "renderer" and s.view == "" and s.chat == "input" and safety)
  run launcherFlavourBackgroundsTest = initHost("launcher").then(nativeBack)
    .expect(s.outcome == "background" and safety)
  run modalLayersFirstTest = initHost("standalone").then(openView(BarView, false)).then(openInner)
    .then(openPopover).then(openDialog)
    .then(nativeBack).expect(s.closed == "popover" and s.dialog)
    .then(nativeBack).expect(s.closed == "dialog" and inner(s))
    .then(nativeBack).expect(s.closed == "inner" and s.view == BarView)
    .then(nativeBack).expect(s.closed == "view" and s.view == "" and safety)
  run conversationLowersBeforeViewTest = initHost("standalone").then(openView(PillView, false))
    .then(moveChat("full")).then(nativeBack).expect(s.chat == "sheet")
    .then(nativeBack).expect(s.chat == "hidden" and s.view == PillView)
    .then(nativeBack).expect(s.view == "" and safety)
  run raisedBarLowersTest = initHost("standalone").then(openView(PillView, false)).then(moveChat("input"))
    .then(nativeBack).expect(s.closed == "bar" and s.chat == "hidden" and s.view == PillView and safety)
  run editLayersTest = initHost("launcher").then(startEdit).then(openAdd)
    .then(nativeBack).expect(s.closed == "add" and s.homeEdit)
    .then(nativeBack).expect(s.closed == "edit" and not(s.homeEdit))
    .then(nativeBack).expect(s.outcome == "background" and safety)
  run conversationAboveEditTest = initHost("home").then(startEdit).then(moveChat("sheet"))
    .then(nativeBack).expect(s.closed == "conversation" and s.homeEdit and safety)
    .then(nativeBack).expect(s.closed == "edit" and safety)
  run drawerMenuFirstTest = initHost("home").then(openDrawer).then(openMenu)
    .then(nativeBack).expect(s.closed == "menu" and s.drawer)
    .then(nativeBack).expect(s.closed == "drawer" and safety)
  run stackReturnTest = initHost("standalone").then(openView(BarView, false)).then(openView(PillView, true))
    .then(nativeBack).expect(s.closed == "stack" and s.view == BarView and s.chat == "input")
    .then(nativeBack).expect(s.closed == "view" and s.view == "" and safety)
  // Back returns to the earlier view on the page it was left on; the next Back closes that page.
  run stackReturnKeepsInnerPageTest = initHost("standalone").then(openView(BarView, false)).then(openInner)
    .then(openView(PillView, true)).expect(not(inner(s)))
    .then(nativeBack).expect(s.closed == "stack" and s.view == BarView and inner(s) and safety)
    .then(nativeBack).expect(s.closed == "inner" and s.view == BarView and safety)
    .then(openInner).then(openView(BarView, false)).expect(inner(s) and safety)
  // The assistant surface has no Home: Back from its last view closes the surface.
  run assistantViewClosesSurfaceTest = initHost("assistant").then(openView(BarView, false)).then(nativeBack)
    .expect(s.outcome == "renderer" and s.closed == "assistant" and s.view == BarView and safety)
  run inertPhoneIsNotNavigatedTest = initHost("standalone").then(openView(BarView, false)).then(holdInert)
    .then(nativeBack).expect(s.outcome == "renderer" and s.closed == "none" and s.view == BarView and safety)
  run assistantSurfaceClosesTest = initHost("assistant").then(nativeBack)
    .expect(s.outcome == "renderer" and s.closed == "assistant" and safety)
  run voiceStopsBeforeConversationTest = initHost("standalone").then(moveChat("sheet")).then(startVoice)
    .then(nativeBack).expect(s.closed == "voice" and s.chat == "sheet" and safety)
}
