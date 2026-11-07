------------------------------- MODULE SignIn -------------------------------
(***************************************************************************)
(* Alpha Phone first-run and returning sign-in.                            *)
(*                                                                         *)
(* Design = "current"  models the code at ef9fbf7cd7:                      *)
(*   apps/app/src/runtime/connection-ui.tsx (production sign-in page,      *)
(*   beginSignIn readiness probe, "Retry" and "Retry saved connection"),   *)
(*   apps/app/src/runtime/cloud-sign-in-ui.tsx (method chooser, codes),    *)
(*   android/.../CloudSignInFlow.java (Steward Google Custom Tab return).  *)
(* Design = "proposed" models the redesign in ../README.md:                *)
(*   one screen with Google, email and phone; native Google authorization  *)
(*   when Play services exist, else a Custom Tab that returns on a         *)
(*   verified App Link; one Google consent that also grants Gmail and      *)
(*   Calendar; no manual retry; a saved sign-in is never re-asked offline. *)
(*                                                                         *)
(* Deployment facts are chosen at Init so every deployment is checked:     *)
(*   gms       Google Play services present (false on a plain AOSP image)  *)
(*   appLink   Android verified the https return host for this package     *)
(*   stewardOk Steward allows Alpha's callback (false in production on     *)
(*             2026-10-24, docs/native-google-sign-in-deployment.md)       *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Design, MaxDetours, MaxFlips, MaxTaps
ASSUME Design \in {"current", "proposed"}

VARIABLES
  gms, appLink, stewardOk,
  net,        \* "up" | "down"
  cred,       \* "none" | "valid" | "rejected": the phone's stored Cloud key
  screen,     \* "Boot" | "Gate" | "Checking" | "Choose" | "Google" | "Code" | "Home"
  browser,    \* "none" | "google" | "returning" | "cloudWeb": the browser tab
              \* ("returning": consent given, redirect to Alpha in flight)
  method,     \* "none" | "google" | "email" | "phone"
  offered,    \* sign-in methods visible on the chooser
  retryShown, \* a manual Retry / "Retry saved connection" button is visible
  waiting,    \* proposed: a step is held until the network returns
  scopes,     \* Google scopes Cloud holds for this account
  taps,       \* user taps since boot
  detours,    \* user mistakes or cancellations (wrong code, closed tab, back)
  flips       \* network changes so far

vars == <<gms, appLink, stewardOk, net, cred, screen, browser, method, offered,
          retryShown, waiting, scopes, taps, detours, flips>>

Scopes == {"gmail", "calendar"}
Screens == {"Boot", "Gate", "Checking", "Choose", "Google", "Code", "Home"}

\* Proposed: Google is offered when either native authorization or a verified
\* return exists. Both are known on the phone without a network round trip.
GoogleReady == IF Design = "current" THEN appLink /\ stewardOk
               ELSE gms \/ (appLink /\ stewardOk)
NativeGoogle == Design = "proposed" /\ gms

LocalMethods == {"email", "phone"} \cup (IF GoogleReady THEN {"google"} ELSE {})

TypeOK ==
  /\ gms \in BOOLEAN /\ appLink \in BOOLEAN /\ stewardOk \in BOOLEAN
  /\ net \in {"up", "down"}
  /\ cred \in {"none", "valid", "rejected"}
  /\ screen \in Screens
  /\ browser \in {"none", "google", "returning", "cloudWeb"}
  /\ method \in {"none", "google", "email", "phone"}
  /\ offered \subseteq {"google", "email", "phone"}
  /\ retryShown \in BOOLEAN /\ waiting \in BOOLEAN
  /\ scopes \subseteq Scopes
  /\ taps \in Nat /\ detours \in Nat /\ flips \in Nat

Init ==
  /\ gms \in BOOLEAN /\ appLink \in BOOLEAN /\ stewardOk \in BOOLEAN
  /\ net \in {"up", "down"}
  /\ cred \in {"none", "valid"}
  /\ scopes \in IF cred = "valid" THEN SUBSET Scopes ELSE {{}}
  /\ screen = "Boot" /\ browser = "none" /\ method = "none"
  /\ offered = {} /\ retryShown = FALSE /\ waiting = FALSE
  /\ taps = 0 /\ detours = 0 /\ flips = 0

\* Saturating counters keep the state space finite.
Tap == taps' = IF taps < MaxTaps THEN taps + 1 ELSE taps
Detour == detours' = detours + 1

(***************************** system steps ********************************)

\* Cold start. Current: a saved key that cannot be checked offline still
\* shows the sign-in page with "Retry saved connection" (code-alpha-runtime-001).
Boot ==
  /\ screen = "Boot"
  /\ IF Design = "current"
       THEN IF cred = "valid"
              THEN IF net = "up"
                     THEN screen' = "Home" /\ retryShown' = FALSE
                     ELSE screen' = "Gate" /\ retryShown' = TRUE
              ELSE screen' = "Gate" /\ retryShown' = FALSE
       ELSE IF cred = "valid"
              THEN screen' = "Home" /\ retryShown' = FALSE
              ELSE screen' = "Choose" /\ retryShown' = FALSE
  /\ offered' = IF Design = "proposed" /\ cred # "valid" THEN LocalMethods ELSE {}
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, browser, method, waiting,
                 scopes, taps, detours, flips>>

\* Current only: "Checking Eliza Cloud sign-in…" (beginSignIn, up to 6 s).
\* Offline, the probe returns null: email only, plus a Retry button.
Probe ==
  /\ Design = "current" /\ screen = "Checking"
  /\ screen' = "Choose"
  /\ offered' = IF net = "up"
                  THEN {"email", "phone"} \cup (IF GoogleReady THEN {"google"} ELSE {})
                  ELSE {"email"}
  /\ retryShown' = (net = "down")
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, browser, method, waiting,
                 scopes, taps, detours, flips>>

\* Proposed: a step requested offline runs as soon as the network returns.
AutoResume ==
  /\ Design = "proposed" /\ waiting /\ net = "up"
  /\ waiting' = FALSE
  /\ IF method \in {"email", "phone"} /\ screen = "Choose"
       THEN screen' = "Code" /\ UNCHANGED <<cred, scopes>>
       ELSE IF screen = "Google"
              THEN screen' = "Home" /\ cred' = "valid" /\ scopes' \in SUBSET Scopes
              ELSE UNCHANGED <<screen, cred, scopes>>
  /\ UNCHANGED <<gms, appLink, stewardOk, net, browser, method, offered,
                 retryShown, taps, detours, flips>>

\* Steward returns to https://eliza.app/alphaphone/auth/callback. With a
\* verified App Link Android hands it to Alpha (singleTask) and the tab is
\* finished; without one the browser shows that web page and Alpha hears
\* nothing.
GoogleReturn ==
  /\ screen = "Google" /\ browser = "returning" /\ net = "up"
  /\ IF appLink
       THEN /\ browser' = "none" /\ cred' = "valid" /\ screen' = "Home"
            /\ scopes' \in IF Design = "proposed" THEN SUBSET Scopes ELSE {scopes}
       ELSE /\ browser' = "cloudWeb" /\ UNCHANGED <<cred, screen, scopes>>
  /\ UNCHANGED <<gms, appLink, stewardOk, net, method, offered, retryShown,
                 waiting, taps, detours, flips>>

\* Cloud later refuses the stored key (expired or revoked).
KeyRejected ==
  /\ screen = "Home" /\ cred = "valid" /\ net = "up" /\ detours < MaxDetours
  /\ cred' = "rejected" /\ method' = "none"
  /\ screen' = IF Design = "current" THEN "Gate" ELSE "Choose"
  /\ offered' = IF Design = "current" THEN {} ELSE LocalMethods
  /\ Detour
  /\ UNCHANGED <<gms, appLink, stewardOk, net, browser, retryShown, waiting,
                 scopes, taps, flips>>

NetDrop ==
  /\ flips < MaxFlips /\ net = "up"
  /\ net' = "down"
  /\ flips' = flips + 1
  /\ UNCHANGED <<gms, appLink, stewardOk, cred, screen, browser, method, offered,
                 retryShown, waiting, scopes, taps, detours>>

NetRecover ==
  /\ net = "down" /\ net' = "up"
  /\ UNCHANGED <<gms, appLink, stewardOk, cred, screen, browser, method, offered,
                 retryShown, waiting, scopes, taps, detours, flips>>

(****************************** user steps *********************************)

\* Current: the page's only control is "Sign in with Eliza Cloud".
TapCloudSignIn ==
  /\ Design = "current" /\ screen = "Gate" /\ Tap
  /\ screen' = "Checking"
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, browser, method, offered,
                 retryShown, waiting, scopes, detours, flips>>

\* Current: "Retry saved connection" on the gate, "Retry" on the chooser.
TapRetry ==
  /\ Design = "current" /\ retryShown /\ Tap
  /\ \/ /\ screen = "Gate" /\ cred = "valid"
        /\ IF net = "up" THEN screen' = "Home" /\ retryShown' = FALSE
                         ELSE UNCHANGED <<screen, retryShown>>
     \/ /\ screen = "Choose"
        /\ screen' = "Checking" /\ retryShown' = FALSE
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, browser, method, offered,
                 waiting, scopes, detours, flips>>

ChooseGoogle ==
  /\ screen = "Choose" /\ "google" \in offered /\ ~waiting /\ Tap
  /\ screen' = "Google" /\ method' = "google"
  /\ browser' = IF NativeGoogle THEN "none" ELSE "google"
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, offered, retryShown,
                 waiting, scopes, detours, flips>>

\* Proposed with Play services: the system account sheet returns an auth
\* code that Cloud exchanges; the owner may untick Gmail or Calendar.
NativeConsent ==
  /\ screen = "Google" /\ browser = "none" /\ NativeGoogle /\ ~waiting /\ Tap
  /\ IF net = "up"
       THEN /\ cred' = "valid" /\ screen' = "Home" /\ waiting' = FALSE
            /\ scopes' \in SUBSET Scopes
       ELSE /\ waiting' = TRUE /\ UNCHANGED <<cred, screen, scopes>>
  /\ UNCHANGED <<gms, appLink, stewardOk, net, browser, method, offered,
                 retryShown, detours, flips>>

\* Account chosen in the Custom Tab; GoogleReturn delivers it.
TabConsent ==
  /\ screen = "Google" /\ browser = "google" /\ Tap
  /\ browser' = "returning"
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, screen, method,
                 offered, retryShown, waiting, scopes, detours, flips>>

CloseBrowser ==
  /\ browser # "none" /\ detours < MaxDetours /\ Tap /\ Detour
  /\ browser' = "none"
  /\ screen' = IF screen = "Google" THEN "Choose" ELSE screen
  /\ method' = IF screen = "Google" THEN "none" ELSE method
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, offered, retryShown,
                 waiting, scopes, flips>>

\* Proposed: while a step waits for the network its control is locked and
\* reads "Waiting for connection"; AutoResume sends it.
EnterAddress(m) ==
  /\ screen = "Choose" /\ m \in offered /\ m \in {"email", "phone"} /\ ~waiting /\ Tap
  /\ method' = m
  /\ IF net = "up"
       THEN screen' = "Code" /\ waiting' = FALSE
       ELSE IF Design = "proposed"
              THEN waiting' = TRUE /\ UNCHANGED screen
              ELSE UNCHANGED <<screen, waiting>>   \* error; owner must try again
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, browser, offered,
                 retryShown, scopes, detours, flips>>

\* Six digits: proposed verifies on the sixth digit (SMS/email autofill).
EnterCode ==
  /\ screen = "Code" /\ net = "up" /\ Tap
  /\ cred' = "valid" /\ screen' = "Home"
  /\ UNCHANGED <<gms, appLink, stewardOk, net, browser, method, offered,
                 retryShown, waiting, scopes, detours, flips>>

WrongCode ==
  /\ screen = "Code" /\ net = "up" /\ detours < MaxDetours /\ Tap /\ Detour
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, screen, browser, method,
                 offered, retryShown, waiting, scopes, flips>>

Back ==
  /\ screen \in {"Code", "Google"} /\ detours < MaxDetours /\ Tap /\ Detour
  /\ screen' = "Choose" /\ method' = "none" /\ browser' = "none" /\ waiting' = FALSE
  /\ UNCHANGED <<gms, appLink, stewardOk, net, cred, offered, retryShown,
                 scopes, flips>>

System == Boot \/ Probe \/ AutoResume \/ GoogleReturn
User == TapCloudSignIn \/ TapRetry \/ ChooseGoogle \/ NativeConsent \/ TabConsent
        \/ EnterAddress("email") \/ EnterAddress("phone") \/ EnterCode
Mistake == CloseBrowser \/ WrongCode \/ Back
Env == NetDrop \/ NetRecover \/ KeyRejected

Done == screen = "Home" /\ UNCHANGED vars

Next == System \/ User \/ Mistake \/ Env \/ Done

\* A cooperative owner: mistakes are finite (MaxDetours), the network drops
\* finitely often (MaxFlips) and recovers, and each progressing step that
\* stays available is eventually taken.
Spec == Init /\ [][Next]_vars /\ WF_vars(System) /\ WF_vars(NetRecover)
        /\ SF_vars(TapCloudSignIn) /\ SF_vars(TapRetry) /\ SF_vars(ChooseGoogle)
        /\ SF_vars(NativeConsent) /\ SF_vars(TabConsent) /\ SF_vars(EnterCode)
        /\ SF_vars(EnterAddress("email"))

(****************************** properties *********************************)

\* Eliza Cloud's web pages are never part of signing in.
NoCloudWebPage == browser # "cloudWeb"

\* Email and phone codes never leave Alpha.
CodesStayInApp == method \in {"email", "phone"} => browser = "none"

\* Nothing asks the owner to press Retry: the app retries by itself.
NoManualRetry == ~retryShown

\* A stored key that Cloud has not refused never shows a sign-in screen.
SavedSignInNeverAsked == cred = "valid" => screen \notin {"Gate", "Checking", "Choose", "Code"}

\* Arriving home, no browser tab is left behind.
NoTabLeftBehind == screen = "Home" => browser = "none"

\* Without mistakes, sign-in takes two taps: Google + account, or
\* address + code.
TwoTaps == (screen = "Home" /\ detours = 0 /\ flips = 0 /\ method # "none") => taps <= 2

\* Wherever the deployment can support it, Google is on the first screen.
GoogleWhenPossible ==
  (screen = "Choose" /\ (gms \/ (appLink /\ stewardOk)) /\ net = "up") => "google" \in offered

\* Liveness: a cooperative owner always reaches Home.
ReachesHome == <>(screen = "Home")

=============================================================================
