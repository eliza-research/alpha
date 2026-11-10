// Historical design translation; the executable Quint model is retained here.
// Both full row inventories are retained, including duplicate historical entries.
module SettingsNav {
  type Row = (str, str, str)
  type State = { Design: str, stack: List[str], confirming: bool, unconfirmed: bool }
  var s: State
  val vars = s
  pure def R(label, kind, target) = (label, kind, target)
  pure def Label(r: Row): str = r._1
  pure def Kind(r: Row): str = r._2
  pure def Target(r: Row): str = r._3
  pure val CurTop = Set(
      ("Agent name", "toggle", "name"),
      ("Character", "nav", "character"),
      ("Accounts", "nav", "accounts"),
      ("Connections", "nav", "connections"),
      ("Privacy & data", "nav", "privacy"),
      ("Set up Alpha access", "action", "startup"),
      ("Wi-Fi", "nav", "wifi"),
      ("Bluetooth", "nav", "bluetooth"),
      ("Mobile data", "nav", "mobile"),
      ("Display", "nav", "display"),
      ("Sound & vibration", "nav", "sound"),
      ("Notifications", "nav", "notifications"),
      ("Battery", "nav", "battery"),
      ("Models", "nav", "models"),
      ("About", "nav", "about"),
      ("Photos", "nav", "photos"),
      ("Calendar", "nav", "calendar"),
      ("Ask before agent actions", "toggle", "ask"),
      ("Password manager", "nav", "passwords"),
      ("Home app", "info", ""),
      ("Assistant app", "info", ""),
      ("Last change", "info", ""),
      ("Make Alpha your Home app", "action", "home-role"),
      ("Default apps in Android", "external", "android:default-apps"),
      ("Scheduled digests", "dest", "digests"),
      ("Eliza Cloud account & plan", "nav", "cloudplan"),
      ("Agent connection", "nav", "agent"),
      ("Reset Alpha data", "danger", "confirm")
    )
  pure def CurPage(p) =
    if (p == "top") CurTop
    else if (p == "character") Set(
      ("Speech", "info", ""),
      ("Always-on listening", "info", ""),
      ("Pause listening", "action", "listen-pause"),
      ("Turn off listening", "action", "listen-off"),
      ("Listening settings", "external", "android:listener"),
      ("Scheduled digests", "dest", "digests"),
      ("Personality settings", "info", "")
    )
    else if (p == "accounts") Set(
      ("Eliza Cloud", "info", ""),
      ("Manage Cloud account", "dest", "cloud-account"),
      ("Google accounts", "dest", "google"),
      ("Device accounts in Android", "external", "android:accounts")
    )
    else if (p == "connections") Set(
      ("Manage Google accounts", "dest", "google"),
      ("Gmail", "info", ""),
      ("account access", "info", ""),
      ("Last change", "info", ""),
      ("Open Inbox", "dest", "inbox"),
      ("Disconnect Google account", "danger", "confirm"),
      ("Check Gmail connection", "action", "gmail-check"),
      ("Other connectors", "info", ""),
      ("Automatically load email images", "toggle", "mail-images")
    )
    else if (p == "privacy") Set(
      ("Redaction on", "status", ""),
      ("Shared with Cloud", "info", ""),
      ("Voice", "info", ""),
      ("Microphone", "info", ""),
      ("Location", "info", ""),
      ("Camera", "info", ""),
      ("Calendar", "info", ""),
      ("Activity", "nav", "activity"),
      ("Workflow runs", "dest", "workflows"),
      ("Memory", "info", ""),
      ("Device location", "info", ""),
      ("Location in Android", "external", "android:location"),
      ("Manage Alpha permissions", "external", "android:app")
    )
    else if (p == "activity") Set(
      ("Workflow runs", "dest", "workflows")
    )
    else if (p == "wifi") Set(
      ("Wi-Fi", "status", ""),
      ("Manage Wi-Fi networks", "external", "android:wifi")
    )
    else if (p == "bluetooth") Set(
      ("Bluetooth", "info", ""),
      ("Device connections", "info", ""),
      ("Pair or manage devices", "external", "android:bluetooth")
    )
    else if (p == "mobile") Set(
      ("Mobile connection", "info", ""),
      ("Mobile data", "info", ""),
      ("Airplane mode", "info", ""),
      ("Manage mobile networks", "external", "android:mobile"),
      ("Airplane mode in Android", "external", "android:airplane")
    )
    else if (p == "display") Set(
      ("Aa", "status", ""),
      ("Theme", "choice", "theme"),
      ("Manage brightness in Android", "external", "android:display"),
      ("Text size", "choice", "text-size")
    )
    else if (p == "sound") Set(
      ("Media", "info", ""),
      ("Ring", "info", ""),
      ("Alarm", "info", ""),
      ("Do Not Disturb", "info", ""),
      ("Do Not Disturb in Android", "external", "android:dnd"),
      ("Manage sound in Android", "external", "android:sound")
    )
    else if (p == "notifications") Set(
      ("Alpha notifications", "info", ""),
      ("Do Not Disturb", "info", ""),
      ("Delivery timing", "info", ""),
      ("Manage Alpha notifications", "external", "android:notifications"),
      ("channel state", "info", ""),
      ("Manage channel", "external", "android:channel"),
      ("Other apps", "info", ""),
      ("Notification privacy", "info", ""),
      ("Agent access", "info", ""),
      ("Enable selected-app collection", "action", "cross-collect"),
      ("Manage notification access in Android", "external", "android:listener-access"),
      ("Choose notification apps", "action", "cross-apps"),
      ("Local metadata history", "info", ""),
      ("Enable local metadata history", "action", "cross-history"),
      ("View local metadata history", "action", "cross-history-view"),
      ("Clear local metadata history", "danger", "confirm")
    )
    else if (p == "battery") Set(
      ("85%", "status", ""),
      ("Battery saver", "info", ""),
      ("Manage battery in Android", "external", "android:battery")
    )
    else if (p == "models") Set(
      ("Agent", "status", ""),
      ("Connection", "info", ""),
      ("Inference provider", "info", ""),
      ("Inference model", "info", ""),
      ("Voice", "info", ""),
      ("Eliza Cloud account", "dest", "cloud-account")
    )
    else if (p == "about") Set(
      ("Pixel", "status", ""),
      ("Alpha Phone", "info", ""),
      ("Installed or last updated", "info", ""),
      ("Updates", "info", ""),
      ("Android", "info", ""),
      ("Build", "info", ""),
      ("Security patch", "info", ""),
      ("Runtime", "info", ""),
      ("Agent execution", "info", ""),
      ("Agent", "info", ""),
      ("Inference model", "info", ""),
      ("Problem log", "nav", "problems"),
      ("Export diagnostics", "action", "diagnostics"),
      ("Android device information", "external", "android:about"),
      ("Open source licenses", "nav", "licenses")
    )
    else if (p == "problems") Set(
      ("Kept on this device", "info", ""),
      ("Android exit history", "info", ""),
      ("entries", "content", ""),
      ("Export diagnostics", "action", "diagnostics"),
      ("Clear problem log", "danger", "confirm")
    )
    else if (p == "licenses") Set(
      ("licences", "content", "")
    )
    else if (p == "photos") Set(
      ("Library access", "info", ""),
      ("Choose photo access", "action", "photo-access"),
      ("Android photo permissions", "external", "android:app")
    )
    else if (p == "calendar") Set(
      ("Display only", "info", ""),
      ("Device calendars", "info", ""),
      ("Connect or refresh device calendars", "action", "calendar-refresh"),
      ("calendar source", "info", ""),
      ("Calendar visibility", "info", ""),
      ("Google Calendar sync", "dest", "calendar-sync")
    )
    else if (p == "passwords") Set(
      ("vault", "content", ""),
      ("Proton Pass", "info", ""),
      ("Selection", "info", ""),
      ("Autofill", "info", ""),
      ("Vault", "info", ""),
      ("Compatibility", "info", ""),
      ("Choose password provider in Android", "external", "android:autofill"),
      ("Open Proton Pass", "external", "proton"),
      ("Refresh password provider status", "action", "pw-refresh"),
      ("password entry", "nav", "password-entry")
    )
    else if (p == "password-entry") Set(
      ("entry", "content", "")
    )
    else if (p == "cloudplan") Set(
      ("Account", "info", ""),
      ("Plan", "info", ""),
      ("Agent execution", "info", ""),
      ("AI replies", "info", ""),
      ("Plan runs until", "info", ""),
      ("Sign-in expires", "info", ""),
      ("Approve this phone again", "action", "approve"),
      ("Redeem code", "dest", "redeem"),
      ("Manage plan", "dest", "manage-plan"),
      ("Sign out", "danger", "direct")
    )
    else if (p == "agent") Set(
      ("Agent", "info", ""),
      ("AI", "info", ""),
      ("Status", "info", ""),
      ("Connection problem", "info", ""),
      ("Records", "info", ""),
      ("Review", "info", ""),
      ("Reconnect agent", "action", "agent-restart"),
      ("Conversation history", "info", ""),
      ("New conversation", "action", "new-conversation"),
      ("Load conversations", "action", "load-history"),
      ("Restore conversation", "action", "restore"),
      ("Refresh actions", "action", "actions-refresh"),
      ("Sync recorded receipts", "action", "actions-sync"),
      ("action", "content", ""),
      ("I verified it happened", "action", "reconcile")
    )
    else Set()
  pure val PropTop = Set(
      ("Agent name", "toggle", "name"),
      ("Eliza Cloud", "nav", "account"),
      ("Google", "dest", "google"),
      ("Ask before acting", "toggle", "ask"),
      ("Agent", "nav", "agent"),
      ("Listening", "nav", "listening"),
      ("Scheduled digests", "dest", "digests"),
      ("Calendars", "nav", "calendar"),
      ("Passwords", "nav", "passwords"),
      ("Photos access", "action", "photo-access"),
      ("Load images in email", "toggle", "mail-images"),
      ("Make Alpha your Home app", "action", "home-role"),
      ("Theme", "choice", "theme"),
      ("Text size", "choice", "text-size"),
      ("Notifications", "external", "android:notifications"),
      ("Notifications from other apps", "nav", "cross"),
      ("App permissions", "external", "android:app"),
      ("Finish setup", "action", "startup"),
      ("Android settings", "external", "android:settings"),
      ("About", "nav", "about"),
      ("Reset Alpha data", "danger", "confirm")
    )
  pure def PropPage(p) =
    if (p == "top") PropTop
    else if (p == "account") Set(
      ("Plan", "status", ""),
      ("Approve this phone again", "action", "approve"),
      ("Redeem code", "dest", "redeem"),
      ("Manage plan", "dest", "manage-plan"),
      ("Sign out", "danger", "confirm")
    )
    else if (p == "agent") Set(
      ("Running", "status", ""),
      ("Restart agent", "action", "agent-restart"),
      ("Review recovery", "action", "recovery"),
      ("New conversation", "action", "new-conversation"),
      ("Earlier conversations", "nav", "history"),
      ("Actions to review", "content", ""),
      ("It happened", "action", "reconcile"),
      ("It did not happen", "action", "reconcile-not")
    )
    else if (p == "history") Set(
      ("conversation", "content", ""),
      ("Restore", "action", "restore")
    )
    else if (p == "listening") Set(
      ("Listening", "status", ""),
      ("Pause", "action", "listen-pause"),
      ("Turn off", "action", "listen-off"),
      ("Listener settings", "external", "android:listener")
    )
    else if (p == "calendar") Set(
      ("Refresh calendars", "action", "calendar-refresh"),
      ("Google Calendar sync", "dest", "calendar-sync")
    )
    else if (p == "passwords") Set(
      ("vault", "content", ""),
      ("password entry", "nav", "password-entry"),
      ("Password provider", "external", "android:autofill"),
      ("Open Proton Pass", "external", "proton")
    )
    else if (p == "password-entry") Set(
      ("entry", "content", "")
    )
    else if (p == "cross") Set(
      ("Collect from selected apps", "toggle", "cross-collect"),
      ("selected app", "toggle", "cross-app"),
      ("Show previews", "toggle", "cross-preview"),
      ("Add apps", "action", "cross-apps"),
      ("Keep history", "toggle", "cross-history"),
      ("history", "content", ""),
      ("Clear history", "danger", "confirm"),
      ("Notification access", "external", "android:listener-access")
    )
    else if (p == "about") Set(
      ("Version", "status", ""),
      ("Problem log", "nav", "problems"),
      ("Export diagnostics", "action", "diagnostics"),
      ("Open source licenses", "nav", "licenses")
    )
    else if (p == "problems") Set(
      ("entries", "content", ""),
      ("Clear problem log", "danger", "confirm")
    )
    else if (p == "licenses") Set(
      ("licences", "content", "")
    )
    else Set()

  val Pages = if (s.Design == "current")
    Set("top", "character", "accounts", "connections", "privacy", "activity", "wifi", "bluetooth",
      "mobile", "display", "sound", "notifications", "battery", "models", "about", "problems",
      "licenses", "photos", "calendar", "passwords", "password-entry", "cloudplan", "agent")
    else Set("top", "account", "agent", "history", "listening", "calendar", "passwords",
      "password-entry", "cross", "about", "problems", "licenses")
  def Page(p) = if (s.Design == "current") CurPage(p) else PropPage(p)
  val AllRows = Pages.map(p => Page(p)).flatten()
  val Here = s.stack[s.stack.length() - 1]
  val TypeOK = s.stack.length() >= 1 and s.stack.length() <= 4
    and s.stack.indices().forall(i => Pages.contains(s.stack[i]))
  pure def initialState(design) = { Design: design, stack: List("top"), confirming: false, unconfirmed: false }
  action Init(design) = s' = initialState(design)
  action checkerInit = s' = initialState("proposed")
  action checkerCurrentInit = s' = initialState("current")
  action init = Init("proposed")
  action currentInit = Init("current")
  action Open(r: Row): bool = all { not(s.confirming), Page(Here).contains(r), Kind(r) == "nav",
    s.stack.length() < 4, s' = { ...s, stack: s.stack.append(Target(r)) } }
  action Back = if (s.confirming) s' = { ...s, confirming: false }
    else all { s.stack.length() > 1, s' = { ...s, stack: s.stack.slice(0, s.stack.length() - 1) } }
  action Destroy(r: Row): bool = all { not(s.confirming), Page(Here).contains(r), Kind(r) == "danger",
    if (Target(r) == "confirm") s' = { ...s, confirming: true }
    else s' = { ...s, unconfirmed: true } }
  action Answer = all { s.confirming, s' = { ...s, confirming: false } }
  action Next = { nondet r = AllRows.oneOf(); any { Back, Answer, Open(r), Destroy(r) } }
  action step = any { Next, s' = s }
  val Initial = TypeOK and Set("current", "proposed").contains(s.Design) and s == initialState(s.Design)
  temporal Spec = (Initial and s.Design == "proposed") and always(Next.orKeep(s))
  def Controls(p) = Page(p).filter(r => not(Set("status", "content", "info").contains(Kind(r))))
  val NoInfoRows = Page(Here).forall(r => Kind(r) != "info")
  val AtMostOneStatus = Page(Here).filter(r => Kind(r) == "status").size() <= 1
  val NoMirrorPages = (Here != "top" and Controls(Here) != Set())
    implies Controls(Here).exists(r => Kind(r) != "external")
  val NoEmptyPages = Controls(Here) != Set() or Page(Here).exists(r => Kind(r) == "content")
  val SingleEntry = AllRows.filter(r => Set("dest", "external", "nav", "action").contains(Kind(r)))
    .map(r => Target(r)).forall(t => AllRows.filter(r => Target(r) == t
      and Set("dest", "external", "nav", "action").contains(Kind(r))).size() == 1)
  val ConfirmBeforeDestroy = not(s.unconfirmed)
  val Shallow = s.stack.length() <= 3
  val safety = TypeOK and NoInfoRows and AtMostOneStatus and NoMirrorPages and NoEmptyPages
    and SingleEntry and ConfirmBeforeDestroy and Shallow
  run confirmDestructionTest = init.then(Destroy(R("Reset Alpha data", "danger", "confirm")))
    .expect(s.confirming and ConfirmBeforeDestroy).then(Back)
    .expect(not(s.confirming) and safety)
  run navigationTest = init.then(Open(R("Agent", "nav", "agent")))
    .then(Open(R("Earlier conversations", "nav", "history")))
    .expect(Here == "history" and safety).then(Back).then(Back)
    .expect(Here == "top" and safety)
  run currentInfoRowsTest = currentInit.expect(not(NoInfoRows) and not(SingleEntry))
  run currentUnconfirmedSignOutTest = currentInit.then(Open(R("Eliza Cloud account & plan", "nav", "cloudplan")))
    .then(Destroy(R("Sign out", "danger", "direct"))).expect(not(ConfirmBeforeDestroy))
  run currentMirrorPageTest = currentInit.then(Open(R("Wi-Fi", "nav", "wifi")))
    .expect(not(NoMirrorPages))
}

