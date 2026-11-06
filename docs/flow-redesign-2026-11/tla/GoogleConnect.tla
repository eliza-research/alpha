---------------------------- MODULE GoogleConnect ----------------------------
(***************************************************************************)
(* Connecting Google for Inbox and Calendar after Eliza Cloud sign-in.     *)
(*                                                                         *)
(* Design = "current" (ef9fbf7cd7):                                        *)
(*  Inbox "Connect Gmail" opens the Google accounts panel                  *)
(*  (google-connection-ui.tsx); "Connect Google account" POSTs             *)
(*  /api/v1/eliza/google/connect/initiate with NO redirectUrl              *)
(*  (cloud-protocol.ts:559) and opens a plain ACTION_VIEW browser          *)
(*  (AlphaConnectionPlugin.java:323). Google returns to Cloud's callback,  *)
(*  which stores the grant and redirects to                                *)
(*  https://cloud.eliza.app/auth/success (generic-callback.ts:148). That   *)
(*  page cannot verify without a browser Cloud session and never closes    *)
(*  (auth-success-page.tsx). Alpha does not re-check on return; only       *)
(*  leaving and re-entering Inbox or "Check Google connections" does.      *)
(*  Calendar shows Google only after a calendar is picked in that panel    *)
(*  (google-calendar-view-adapter.ts:30). An upgrade re-requests a fixed   *)
(*  scope list and can drop Calendar write (code-alpha-runtime-004).       *)
(*                                                                         *)
(* Design = "proposed":                                                    *)
(*  one "Connect Google" control wherever Google is missing; native        *)
(*  authorization (Play services) or a Custom Tab returning on a verified  *)
(*  App Link via Cloud's APP_OAUTH_RETURN_URLS; Gmail and Calendar         *)
(*  requested together with include_granted_scopes; the return refreshes   *)
(*  Inbox and Calendar at once; Calendar shows every visible Google        *)
(*  calendar without a picker.                                             *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Design, MaxDetours, MaxTaps
ASSUME Design \in {"current", "proposed"}

\* Google scopes as Cloud capabilities.
GmailRead == "gmail.read"   GmailWrite == "gmail.write"
CalRead == "cal.read"       CalWrite == "cal.write"
AllScopes == {GmailRead, GmailWrite, CalRead, CalWrite}

VARIABLES
  gms,        \* Play services present (native authorization possible)
  scopes,     \* scopes Cloud holds for the account
  screen,     \* "Inbox" | "Calendar" | "Panel" | "Browser"
  browser,    \* "none" | "consent" | "returning" | "cloudSuccess" | "cloudUnverified"
  requested,  \* scopes the consent in progress asks for
  inboxView,  \* what Inbox shows: "connect" | "mail"
  calView,    \* what Calendar shows: "local" | "google"
  calPicked,  \* current: a Google calendar was chosen in the panel
  taps, detours

vars == <<gms, scopes, screen, browser, requested, inboxView, calView, calPicked,
          taps, detours>>

TypeOK ==
  /\ gms \in BOOLEAN /\ scopes \subseteq AllScopes /\ requested \subseteq AllScopes
  /\ screen \in {"Inbox", "Calendar", "Panel", "Browser"}
  /\ browser \in {"none", "consent", "returning", "cloudSuccess", "cloudUnverified"}
  /\ inboxView \in {"connect", "mail"} /\ calView \in {"local", "google"}
  /\ calPicked \in BOOLEAN /\ taps \in Nat /\ detours \in Nat

\* What a fresh read of Cloud's grant would render.
InboxFor(s) == IF GmailRead \in s THEN "mail" ELSE "connect"
CalFor(s, picked) ==
  IF CalRead \in s /\ (Design = "proposed" \/ picked) THEN "google" ELSE "local"

\* Start signed in to Cloud, possibly already holding scopes from a Google
\* sign-in (SignIn.tla, proposed) or an older grant.
Init ==
  /\ gms \in BOOLEAN
  /\ scopes \in SUBSET AllScopes
  /\ screen \in {"Inbox", "Calendar"}
  /\ browser = "none" /\ requested = {}
  /\ calPicked = FALSE
  /\ inboxView = InboxFor(scopes) /\ calView = CalFor(scopes, FALSE)
  /\ taps = 0 /\ detours = 0

Tap == taps' = IF taps < MaxTaps THEN taps + 1 ELSE taps
InApp == screen \in {"Inbox", "Calendar", "Panel"}

\* Scopes one connect asks for.
Request(cur) ==
  IF Design = "proposed" THEN AllScopes            \* everything, once
  ELSE {GmailRead, CalRead}                        \* connect('read','read')

\* Google's consent shows one checkbox per scope. Proposed asks for
\* gmail.modify and calendar.events, each of which includes read access, so
\* the owner can untick Gmail or Calendar but not "read" alone. Current asks
\* for gmail.readonly and calendar.readonly separately.
Boxes(req) == IF Design = "proposed"
                THEN {b \in {{GmailRead, GmailWrite}, {CalRead, CalWrite}} : b \subseteq req}
                ELSE {{x} : x \in req}
Grantable(req) == {UNION bs : bs \in (SUBSET Boxes(req)) \ {{}}}

(****************************** user steps *********************************)

\* Proposed: the button sits in Inbox or Calendar wherever Google is
\* missing and starts consent immediately. Current: Inbox's button opens the
\* Google accounts panel; Calendar has no button at all.
TapConnect ==
  /\ screen \in {"Inbox", "Calendar"} /\ requested = {} /\ Tap
  /\ IF Design = "proposed"
       THEN /\ (screen = "Inbox" /\ inboxView = "connect")
               \/ (screen = "Calendar" /\ CalRead \notin scopes)
               \/ ~(AllScopes \subseteq scopes)   \* "Allow sending" etc.
            /\ requested' = Request(scopes)
            /\ browser' = IF gms THEN "none" ELSE "consent"
            /\ screen' = IF gms THEN screen ELSE "Browser"
       ELSE /\ screen = "Inbox" /\ inboxView = "connect"
            /\ screen' = "Panel" /\ UNCHANGED <<requested, browser>>
  /\ UNCHANGED <<gms, scopes, inboxView, calView, calPicked, detours>>

\* Current: Settings › Google accounts panel, reached from Inbox only.
PanelConnect ==
  /\ Design = "current" /\ screen = "Panel" /\ browser = "none" /\ Tap
  /\ requested' = Request(scopes)
  /\ browser' = "consent" /\ screen' = "Browser"
  /\ UNCHANGED <<gms, scopes, inboxView, calView, calPicked, detours>>

\* Current: "Calendar to display" radio in the same panel.
PanelPickCalendar ==
  /\ Design = "current" /\ screen = "Panel" /\ CalRead \in scopes /\ ~calPicked /\ Tap
  /\ calPicked' = TRUE
  /\ UNCHANGED <<gms, scopes, screen, browser, requested, inboxView, calView, detours>>

\* "Check Google connections", or leaving and re-entering Inbox.
ManualRefresh ==
  /\ Design = "current" /\ InApp /\ browser = "none" /\ Tap
  /\ inboxView' = InboxFor(scopes) /\ calView' = CalFor(scopes, calPicked)
  /\ UNCHANGED <<gms, scopes, screen, browser, requested, calPicked, detours>>

ClosePanel ==
  /\ screen = "Panel" /\ Tap
  /\ screen' = "Inbox"
  /\ UNCHANGED <<gms, scopes, browser, requested, inboxView, calView, calPicked, detours>>

\* Google's consent. The owner may untick any requested scope (granular
\* consent), but grants at least one so the attempt is not a refusal.
\* Proposed asks with include_granted_scopes, so nothing already held is
\* lost; current replaces the stored grant with what this consent allowed.
Consent ==
  /\ requested # {} /\ Tap
  /\ \/ /\ Design = "proposed" /\ gms /\ browser = "none" /\ InApp
     \/ browser = "consent"
  /\ \E granted \in Grantable(requested) :
       /\ scopes' = IF Design = "proposed" THEN scopes \cup granted ELSE granted
       \* Unticking a box is the owner's choice, counted as a detour.
       /\ detours' = IF granted = requested \/ detours >= MaxDetours THEN detours ELSE detours + 1
  /\ requested' = {}
  /\ IF browser = "consent"
       THEN browser' = "returning" /\ UNCHANGED screen
       ELSE UNCHANGED <<browser, screen>>
  \* Proposed native sheet: the result arrives in-process; views refresh now.
  /\ IF Design = "proposed" /\ browser = "none"
       THEN inboxView' = InboxFor(scopes') /\ calView' = CalFor(scopes', calPicked)
       ELSE UNCHANGED <<inboxView, calView>>
  /\ UNCHANGED <<gms, calPicked>>

\* The owner backs out of Google's page.
Decline ==
  /\ browser = "consent" /\ detours < MaxDetours /\ Tap
  /\ detours' = detours + 1
  /\ browser' = "none" /\ requested' = {}
  /\ screen' = IF Design = "proposed" THEN "Inbox" ELSE "Panel"
  /\ UNCHANGED <<gms, scopes, inboxView, calView, calPicked>>

\* Current: the owner leaves the Cloud page and switches back by hand. The
\* page stays open in the browser's own task.
SwitchBackToAlpha ==
  /\ browser \in {"cloudSuccess", "cloudUnverified"} /\ screen = "Browser" /\ Tap
  /\ screen' = "Panel"
  /\ UNCHANGED <<gms, scopes, browser, requested, inboxView, calView, calPicked, detours>>

CloseBrowserTab ==
  /\ browser \in {"cloudSuccess", "cloudUnverified"} /\ screen # "Browser" /\ Tap
  /\ browser' = "none"
  /\ UNCHANGED <<gms, scopes, screen, requested, inboxView, calView, calPicked, detours>>

\* Moving between apps is navigation, not part of connecting: not counted.
SwitchApp ==
  /\ screen \in {"Inbox", "Calendar"}
  /\ screen' = IF screen = "Inbox" THEN "Calendar" ELSE "Inbox"
  \* Proposed: opening a view reads the cached grant, refreshed on every return.
  /\ IF Design = "proposed"
       THEN inboxView' = InboxFor(scopes) /\ calView' = CalFor(scopes, calPicked)
       ELSE UNCHANGED <<inboxView, calView>>
  /\ UNCHANGED <<gms, scopes, browser, requested, calPicked, taps, detours>>

(****************************** system steps *******************************)

\* Where Google's redirect ends up.
Return ==
  /\ browser = "returning"
  /\ IF Design = "proposed"
       \* Cloud redirects to https://eliza.app/alphaphone/google/return#state=…
       \* (APP_OAUTH_RETURN_URLS); the verified App Link opens MainActivity
       \* (singleTask), which finishes the Custom Tab and refreshes.
       THEN /\ browser' = "none" /\ screen' = "Inbox"
            /\ inboxView' = InboxFor(scopes) /\ calView' = CalFor(scopes, calPicked)
       \* No redirectUrl: Cloud lands on /auth/success. Its proof check needs
       \* a browser Cloud session that a phone signed in inside Alpha lacks.
       ELSE /\ browser' \in {"cloudSuccess", "cloudUnverified"}
            /\ UNCHANGED <<screen, inboxView, calView>>
  /\ UNCHANGED <<gms, scopes, requested, calPicked, taps, detours>>

\* Google or the owner revokes access elsewhere.
Revoke ==
  /\ scopes # {} /\ detours < MaxDetours
  /\ scopes' = {} /\ detours' = detours + 1
  \* Proposed: the next Gmail/Calendar read sees 401 and shows Connect.
  /\ IF Design = "proposed"
       THEN inboxView' = "connect" /\ calView' = "local"
       ELSE UNCHANGED <<inboxView, calView>>
  /\ UNCHANGED <<gms, screen, browser, requested, calPicked, taps>>

User == TapConnect \/ PanelConnect \/ PanelPickCalendar \/ ManualRefresh \/ ClosePanel
        \/ Consent \/ SwitchBackToAlpha \/ CloseBrowserTab \/ SwitchApp
Next == User \/ Decline \/ Return \/ Revoke

Spec == Init /\ [][Next]_vars /\ WF_vars(Return)
        /\ SF_vars(TapConnect) /\ SF_vars(PanelConnect) /\ SF_vars(Consent)
        /\ SF_vars(SwitchBackToAlpha) /\ SF_vars(ManualRefresh)

(****************************** properties *********************************)

\* No Eliza Cloud web page appears in connecting Google.
NoCloudWebPage == browser \notin {"cloudSuccess", "cloudUnverified"}

\* Back in Alpha, no browser tab is left open behind it.
NoTabLeftBehind == screen \in {"Inbox", "Calendar"} => browser \in {"none"}

\* What Inbox and Calendar show always matches the grant Cloud holds once
\* the owner is back in the app (no stale "Connect Gmail").
InboxFresh == (screen = "Inbox" /\ browser = "none") => inboxView = InboxFor(scopes)

\* The grant from Inbox (or Google sign-in) also lights up Calendar, with
\* no separate picker.
OneGrantForBoth == (screen = "Calendar" /\ browser = "none" /\ CalRead \in scopes)
                   => calView = "google"

\* Asking for more never takes away what was already granted.
ScopesNeverShrink == [][Revoke \/ (scopes \subseteq scopes')]_vars

\* From "Connect" to mail in two taps (Connect, then Google's Allow).
TwoTapsToMail ==
  [][(inboxView # "mail" /\ inboxView' = "mail" /\ detours' = 0) => taps' <= 2]_vars

\* After Google's Allow, the owner is back in Alpha with no tab behind.
ReturnsToApp == (browser = "returning") ~> (screen \in {"Inbox", "Calendar"} /\ browser = "none")

=============================================================================
