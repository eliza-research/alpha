------------------------------ MODULE SettingsNav ------------------------------
(***************************************************************************)
(* Alpha Settings on the Android launcher (production build).             *)
(*                                                                         *)
(* Design = "current" is the page and row inventory rendered at            *)
(*   ef9fbf7cd7 by apps/app/src/prototype/model.js (settings module) as    *)
(*   rewritten by apps/app/src/prototype/settings-adapter.ts.              *)
(* Design = "proposed" is the inventory in ../README.md section            *)
(*   "Settings".                                                           *)
(*                                                                         *)
(* A row is <<label, kind, target>>. Kinds:                                *)
(*   nav      opens another Settings page (target: the page)               *)
(*   dest     opens a flow owned elsewhere (target: the flow)              *)
(*   external opens an Android Settings screen (target: the screen)        *)
(*   toggle, choice, action   change something here                        *)
(*   danger   a destructive action (target: "confirm" or "direct")         *)
(*   status   the page's one-line state                                    *)
(*   content  the person's own data or a record list (log, licences)       *)
(*   info     a fact that cannot be changed here                           *)
(* Rows that exist only in some states (an expiring sign-in, a pending     *)
(* action) are included: the model checks the union of what can appear.   *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Design
ASSUME Design \in {"current", "proposed"}

R(l, k, t) == <<l, k, t>>
Label(r) == r[1]
Kind(r) == r[2]
Target(r) == r[3]

\* ---------------------------------------------------------------- current
CurTop == {
  R("Agent name", "toggle", "name"), R("Character", "nav", "character"),
  R("Accounts", "nav", "accounts"), R("Connections", "nav", "connections"),
  R("Privacy & data", "nav", "privacy"), R("Set up Alpha access", "action", "startup"),
  R("Wi-Fi", "nav", "wifi"), R("Bluetooth", "nav", "bluetooth"), R("Mobile data", "nav", "mobile"),
  R("Display", "nav", "display"), R("Sound & vibration", "nav", "sound"),
  R("Notifications", "nav", "notifications"), R("Battery", "nav", "battery"),
  R("Models", "nav", "models"), R("About", "nav", "about"),
  R("Photos", "nav", "photos"), R("Calendar", "nav", "calendar"),
  R("Ask before agent actions", "toggle", "ask"), R("Password manager", "nav", "passwords"),
  R("Home app", "info", ""), R("Assistant app", "info", ""), R("Last change", "info", ""),
  R("Make Alpha your Home app", "action", "home-role"),
  R("Default apps in Android", "external", "android:default-apps"),
  R("Scheduled digests", "dest", "digests"),
  R("Eliza Cloud account & plan", "nav", "cloudplan"),
  R("Agent connection", "nav", "agent"),
  R("Reset Alpha data", "danger", "confirm") }
CurPage(p) ==
  CASE p = "top" -> CurTop
  [] p = "character" -> { R("Speech", "info", ""), R("Always-on listening", "info", ""),
       R("Pause listening", "action", "listen-pause"), R("Turn off listening", "action", "listen-off"),
       R("Listening settings", "external", "android:listener"),
       R("Scheduled digests", "dest", "digests"), R("Personality settings", "info", "") }
  [] p = "accounts" -> { R("Eliza Cloud", "info", ""), R("Manage Cloud account", "dest", "cloud-account"),
       R("Google accounts", "dest", "google"), R("Device accounts in Android", "external", "android:accounts") }
  [] p = "connections" -> { R("Manage Google accounts", "dest", "google"), R("Gmail", "info", ""),
       R("account access", "info", ""), R("Last change", "info", ""), R("Open Inbox", "dest", "inbox"),
       R("Disconnect Google account", "danger", "confirm"), R("Check Gmail connection", "action", "gmail-check"),
       R("Other connectors", "info", ""), R("Automatically load email images", "toggle", "mail-images") }
  [] p = "privacy" -> { R("Redaction on", "status", ""), R("Shared with Cloud", "info", ""), R("Voice", "info", ""),
       R("Microphone", "info", ""), R("Location", "info", ""), R("Camera", "info", ""), R("Calendar", "info", ""),
       R("Activity", "nav", "activity"), R("Workflow runs", "dest", "workflows"), R("Memory", "info", ""),
       R("Device location", "info", ""), R("Location in Android", "external", "android:location"),
       R("Manage Alpha permissions", "external", "android:app") }
  [] p = "activity" -> { R("Workflow runs", "dest", "workflows") }
  [] p = "wifi" -> { R("Wi-Fi", "status", ""), R("Manage Wi-Fi networks", "external", "android:wifi") }
  [] p = "bluetooth" -> { R("Bluetooth", "info", ""), R("Device connections", "info", ""),
       R("Pair or manage devices", "external", "android:bluetooth") }
  [] p = "mobile" -> { R("Mobile connection", "info", ""), R("Mobile data", "info", ""), R("Airplane mode", "info", ""),
       R("Manage mobile networks", "external", "android:mobile"), R("Airplane mode in Android", "external", "android:airplane") }
  [] p = "display" -> { R("Aa", "status", ""), R("Theme", "choice", "theme"),
       R("Manage brightness in Android", "external", "android:display"), R("Text size", "choice", "text-size") }
  [] p = "sound" -> { R("Media", "info", ""), R("Ring", "info", ""), R("Alarm", "info", ""),
       R("Do Not Disturb", "info", ""), R("Do Not Disturb in Android", "external", "android:dnd"),
       R("Manage sound in Android", "external", "android:sound") }
  [] p = "notifications" -> { R("Alpha notifications", "info", ""), R("Do Not Disturb", "info", ""),
       R("Delivery timing", "info", ""), R("Manage Alpha notifications", "external", "android:notifications"),
       R("channel state", "info", ""), R("Manage channel", "external", "android:channel"),
       R("Other apps", "info", ""), R("Notification privacy", "info", ""), R("Agent access", "info", ""),
       R("Enable selected-app collection", "action", "cross-collect"),
       R("Manage notification access in Android", "external", "android:listener-access"),
       R("Choose notification apps", "action", "cross-apps"),
       R("Local metadata history", "info", ""), R("Enable local metadata history", "action", "cross-history"),
       R("View local metadata history", "action", "cross-history-view"),
       R("Clear local metadata history", "danger", "confirm") }
  [] p = "battery" -> { R("85%", "status", ""), R("Battery saver", "info", ""),
       R("Manage battery in Android", "external", "android:battery") }
  [] p = "models" -> { R("Agent", "status", ""), R("Connection", "info", ""), R("Inference provider", "info", ""),
       R("Inference model", "info", ""), R("Voice", "info", ""), R("Eliza Cloud account", "dest", "cloud-account") }
  [] p = "about" -> { R("Pixel", "status", ""), R("Alpha Phone", "info", ""), R("Installed or last updated", "info", ""),
       R("Updates", "info", ""), R("Android", "info", ""), R("Build", "info", ""), R("Security patch", "info", ""),
       R("Runtime", "info", ""), R("Agent execution", "info", ""), R("Agent", "info", ""), R("Inference model", "info", ""),
       R("Problem log", "nav", "problems"), R("Export diagnostics", "action", "diagnostics"),
       R("Android device information", "external", "android:about"), R("Open source licenses", "nav", "licenses") }
  [] p = "problems" -> { R("Kept on this device", "info", ""), R("Android exit history", "info", ""),
       R("entries", "content", ""), R("Export diagnostics", "action", "diagnostics"),
       R("Clear problem log", "danger", "confirm") }
  [] p = "licenses" -> { R("licences", "content", "") }
  [] p = "photos" -> { R("Library access", "info", ""), R("Choose photo access", "action", "photo-access"),
       R("Android photo permissions", "external", "android:app") }
  [] p = "calendar" -> { R("Display only", "info", ""), R("Device calendars", "info", ""),
       R("Connect or refresh device calendars", "action", "calendar-refresh"),
       R("calendar source", "info", ""), R("Calendar visibility", "info", ""),
       R("Google Calendar sync", "dest", "calendar-sync") }
  [] p = "passwords" -> { R("vault", "content", ""), R("Proton Pass", "info", ""), R("Selection", "info", ""),
       R("Autofill", "info", ""), R("Vault", "info", ""), R("Compatibility", "info", ""),
       R("Choose password provider in Android", "external", "android:autofill"),
       R("Open Proton Pass", "external", "proton"), R("Refresh password provider status", "action", "pw-refresh"),
       R("password entry", "nav", "password-entry") }
  [] p = "password-entry" -> { R("entry", "content", "") }
  [] p = "cloudplan" -> { R("Account", "info", ""), R("Plan", "info", ""), R("Agent execution", "info", ""),
       R("AI replies", "info", ""), R("Plan runs until", "info", ""), R("Sign-in expires", "info", ""),
       R("Approve this phone again", "action", "approve"), R("Redeem code", "dest", "redeem"),
       R("Manage plan", "dest", "manage-plan"), R("Sign out", "danger", "direct") }
  [] p = "agent" -> { R("Agent", "info", ""), R("AI", "info", ""), R("Status", "info", ""),
       R("Connection problem", "info", ""), R("Records", "info", ""), R("Review", "info", ""),
       R("Reconnect agent", "action", "agent-restart"), R("Conversation history", "info", ""),
       R("New conversation", "action", "new-conversation"), R("Load conversations", "action", "load-history"),
       R("Restore conversation", "action", "restore"), R("Refresh actions", "action", "actions-refresh"),
       R("Sync recorded receipts", "action", "actions-sync"), R("action", "content", ""),
       R("I verified it happened", "action", "reconcile") }
  [] OTHER -> {}

\* --------------------------------------------------------------- proposed
PropTop == {
  R("Agent name", "toggle", "name"),
  R("Eliza Cloud", "nav", "account"), R("Google", "dest", "google"),
  R("Ask before acting", "toggle", "ask"), R("Agent", "nav", "agent"),
  R("Listening", "nav", "listening"), R("Scheduled digests", "dest", "digests"),
  R("Calendars", "nav", "calendar"), R("Passwords", "nav", "passwords"),
  R("Photos access", "action", "photo-access"), R("Load images in email", "toggle", "mail-images"),
  R("Make Alpha your Home app", "action", "home-role"),
  R("Theme", "choice", "theme"), R("Text size", "choice", "text-size"),
  R("Notifications", "external", "android:notifications"),
  R("Notifications from other apps", "nav", "cross"),
  R("App permissions", "external", "android:app"), R("Finish setup", "action", "startup"),
  R("Android settings", "external", "android:settings"),
  R("About", "nav", "about"),
  R("Reset Alpha data", "danger", "confirm") }
PropPage(p) ==
  CASE p = "top" -> PropTop
  [] p = "account" -> { R("Plan", "status", ""), R("Approve this phone again", "action", "approve"),
       R("Redeem code", "dest", "redeem"), R("Manage plan", "dest", "manage-plan"),
       R("Sign out", "danger", "confirm") }
  [] p = "agent" -> { R("Running", "status", ""), R("Restart agent", "action", "agent-restart"),
       R("Review recovery", "action", "recovery"), R("New conversation", "action", "new-conversation"),
       R("Earlier conversations", "nav", "history"), R("Actions to review", "content", ""),
       R("It happened", "action", "reconcile"), R("It did not happen", "action", "reconcile-not") }
  [] p = "history" -> { R("conversation", "content", ""), R("Restore", "action", "restore") }
  [] p = "listening" -> { R("Listening", "status", ""), R("Pause", "action", "listen-pause"),
       R("Turn off", "action", "listen-off"), R("Listener settings", "external", "android:listener") }
  [] p = "calendar" -> { R("Refresh calendars", "action", "calendar-refresh"),
       R("Google Calendar sync", "dest", "calendar-sync") }
  [] p = "passwords" -> { R("vault", "content", ""), R("password entry", "nav", "password-entry"),
       R("Password provider", "external", "android:autofill"), R("Open Proton Pass", "external", "proton") }
  [] p = "password-entry" -> { R("entry", "content", "") }
  [] p = "cross" -> { R("Collect from selected apps", "toggle", "cross-collect"),
       R("selected app", "toggle", "cross-app"), R("Show previews", "toggle", "cross-preview"),
       R("Add apps", "action", "cross-apps"), R("Keep history", "toggle", "cross-history"),
       R("history", "content", ""), R("Clear history", "danger", "confirm"),
       R("Notification access", "external", "android:listener-access") }
  [] p = "about" -> { R("Version", "status", ""), R("Problem log", "nav", "problems"),
       R("Export diagnostics", "action", "diagnostics"), R("Open source licenses", "nav", "licenses") }
  [] p = "problems" -> { R("entries", "content", ""), R("Clear problem log", "danger", "confirm") }
  [] p = "licenses" -> { R("licences", "content", "") }
  [] OTHER -> {}

Page(p) == IF Design = "current" THEN CurPage(p) ELSE PropPage(p)
Pages == IF Design = "current"
  THEN {"top", "character", "accounts", "connections", "privacy", "activity", "wifi", "bluetooth",
        "mobile", "display", "sound", "notifications", "battery", "models", "about", "problems",
        "licenses", "photos", "calendar", "passwords", "password-entry", "cloudplan", "agent"}
  ELSE {"top", "account", "agent", "history", "listening", "calendar", "passwords",
        "password-entry", "cross", "about", "problems", "licenses"}
AllRows == UNION {Page(p) : p \in Pages}

VARIABLES stack, confirming, unconfirmed
vars == <<stack, confirming, unconfirmed>>

Here == stack[Len(stack)]

TypeOK ==
  /\ stack \in Seq(Pages) /\ Len(stack) \in 1..4
  /\ confirming \in BOOLEAN /\ unconfirmed \in BOOLEAN

Init == stack = <<"top">> /\ confirming = FALSE /\ unconfirmed = FALSE

Open(r) ==
  /\ ~confirming /\ r \in Page(Here) /\ Kind(r) = "nav" /\ Len(stack) < 4
  /\ stack' = Append(stack, Target(r))
  /\ UNCHANGED <<confirming, unconfirmed>>
Back ==
  /\ IF confirming THEN confirming' = FALSE /\ UNCHANGED stack      \* Back cancels the confirmation
     ELSE /\ Len(stack) > 1 /\ stack' = SubSeq(stack, 1, Len(stack) - 1)
          /\ UNCHANGED confirming
  /\ UNCHANGED unconfirmed
Destroy(r) ==
  /\ ~confirming /\ r \in Page(Here) /\ Kind(r) = "danger"
  /\ IF Target(r) = "confirm" THEN confirming' = TRUE /\ UNCHANGED unconfirmed
     ELSE unconfirmed' = TRUE /\ UNCHANGED confirming
  /\ UNCHANGED stack
Answer ==
  /\ confirming /\ confirming' = FALSE
  /\ UNCHANGED <<stack, unconfirmed>>

Next == Back \/ Answer \/ \E r \in AllRows : Open(r) \/ Destroy(r)
Spec == Init /\ [][Next]_vars

\* ---- properties ------------------------------------------------------------
Controls(p) == {r \in Page(p) : Kind(r) \notin {"status", "content", "info"}}
\* Every row on the page in front can be acted on, apart from its one status line
\* and the person's own content.
NoInfoRows == \A r \in Page(Here) : Kind(r) # "info"
AtMostOneStatus == Cardinality({r \in Page(Here) : Kind(r) = "status"}) <= 1
\* No Alpha page only relays to Android: that is one row, not a page.
NoMirrorPages ==
  (Here # "top" /\ Controls(Here) # {}) => \E r \in Controls(Here) : Kind(r) # "external"
\* Every page has something to do.
NoEmptyPages == Controls(Here) # {} \/ \E r \in Page(Here) : Kind(r) = "content"
\* Each flow and Android screen is reached from one row in all of Settings.
SingleEntry ==
  \A t \in {Target(r) : r \in {x \in AllRows : Kind(x) \in {"dest", "external", "nav", "action"}}} :
    Cardinality({r \in AllRows : Target(r) = t /\ Kind(r) \in {"dest", "external", "nav", "action"}}) = 1
\* Nothing is erased or signed out without a confirmation step.
ConfirmBeforeDestroy == ~unconfirmed
\* Top level plus at most two levels.
Shallow == Len(stack) <= 3
=============================================================================
