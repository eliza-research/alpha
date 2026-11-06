------------------------------ MODULE ChatInput ------------------------------
(***************************************************************************)
(* The assistant dock and chat overlay on Home and inside apps.            *)
(*                                                                         *)
(* Design = "current" models the code at ef9fbf7cd7:                       *)
(*   apps/app/src/prototype/model.js  swipe(), back(), toInput, rest()     *)
(*   apps/app/src/prototype/chat-overlay-motion-adapter.ts  scrimPE/scrimSw *)
(*   (only the open sheet has an outside-touch guard).                     *)
(* Design = "proposed" models ../README.md section "Chat input":           *)
(*   one rule for every raised state -- the first touch outside the dock   *)
(*   or sheet lowers it to the view's resting form and reaches nothing;    *)
(*   only a drag that starts on the dock opens the chat; Back unwinds one  *)
(*   level at a time.                                                      *)
(*                                                                         *)
(* Every action is a function of the state and its parameters, so the     *)
(* machine is deterministic: one event has one outcome.                    *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS Design
ASSUME Design \in {"current", "proposed"}

Views   == {"home", "browser", "app"}   \* app: any view whose rest is the pill
Modes   == {"hidden", "input", "sheet", "full"}
Origins == {"dock", "content", "bottomEdge"}

\* The resting form of the dock in each view (model.js rest()/defaultChat()).
Rest(v) == IF v \in {"home", "browser"} THEN "input" ELSE "hidden"

VARIABLES
  view,     \* the surface under the dock
  mode,     \* chat form: pill (hidden), bar (input), half sheet, full screen
  focus,    \* the composer has focus: the keyboard is up
  draft,    \* "empty" | "text"
  leak,     \* ghost: an outside touch reached content while the chat was raised
  stray,    \* ghost: the chat opened from a drag that did not start on the dock
  skipped,  \* ghost: Back left the view while a raised chat was still open
  lost      \* ghost: a draft disappeared without being sent

vars == <<view, mode, focus, draft, leak, stray, skipped, lost>>

\* Raised: anything above the view's resting form, or the keyboard up. This is
\* what a person sees as "the chat is open"; it does not depend on the design.
Raised == mode = "sheet" \/ (mode = "input" /\ (Rest(view) = "hidden" \/ focus))

\* The surfaces with an outside-touch guard in each design.
Guarded == IF Design = "current" THEN mode = "sheet" ELSE Raised

TypeOK ==
  /\ view \in Views /\ mode \in Modes /\ focus \in BOOLEAN
  /\ draft \in {"empty", "text"}
  /\ leak \in BOOLEAN /\ stray \in BOOLEAN /\ skipped \in BOOLEAN /\ lost \in BOOLEAN

Init ==
  /\ view = "home" /\ mode = Rest("home") /\ focus = FALSE /\ draft = "empty"
  /\ leak = FALSE /\ stray = FALSE /\ skipped = FALSE /\ lost = FALSE

Ghosts == <<leak, stray, skipped, lost>>

\* ---- the dock ----------------------------------------------------------
TapAlpha ==                       \* the Alpha mark on the pill or the bar
  /\ mode \in {"hidden", "input"}
  /\ mode' = "sheet" /\ focus' = FALSE
  /\ UNCHANGED <<view, draft, Ghosts>>

TapType ==                        \* the keyboard button on the pill
  /\ mode = "hidden"
  /\ mode' = "input" /\ focus' = TRUE
  /\ UNCHANGED <<view, draft, Ghosts>>

FocusComposer ==
  /\ mode \in {"input", "sheet", "full"} /\ ~focus
  /\ focus' = TRUE
  /\ UNCHANGED <<view, mode, draft, Ghosts>>

TypeText ==
  /\ focus /\ draft = "empty"
  /\ draft' = "text"
  /\ UNCHANGED <<view, mode, focus, Ghosts>>

Send ==
  /\ draft = "text" /\ mode \in {"input", "sheet", "full"}
  /\ draft' = "empty"
  /\ mode' = IF mode = "full" THEN "full" ELSE "sheet"
  /\ UNCHANGED <<view, focus, Ghosts>>

ImeHide ==                        \* the keyboard's own hide key
  /\ focus
  /\ focus' = FALSE
  /\ UNCHANGED <<view, mode, draft, Ghosts>>

\* ---- touches outside the dock and sheet ---------------------------------
\* Activating content on Home opens an app; inside an app it stays there.
Activate ==
  /\ leak' = (leak \/ Raised)
  /\ focus' = FALSE                \* the browser moves focus off the composer
  /\ IF view = "home"
       THEN /\ view' = "app" /\ mode' = Rest("app")
       ELSE UNCHANGED <<view, mode>>

TapOutside ==
  /\ mode # "full"                 \* full screen leaves nothing outside
  /\ IF Guarded
       THEN /\ mode' = Rest(view) /\ focus' = FALSE
            /\ UNCHANGED <<view, leak>>
       ELSE Activate
  /\ UNCHANGED <<draft, stray, skipped, lost>>

\* ---- vertical drags ------------------------------------------------------
SwipeUp(origin) ==
  /\ mode \in {"hidden", "input"}
  /\ CASE origin = "bottomEdge" ->            \* Android's Home gesture
            /\ view' = "home" /\ mode' = Rest("home") /\ focus' = FALSE
            /\ UNCHANGED <<stray>>
       [] origin = "dock" ->
            /\ mode' = "sheet" /\ focus' = FALSE
            /\ UNCHANGED <<view, stray>>
       [] origin = "content" ->
            IF Design = "current" /\ view = "home"
              THEN /\ mode' = "sheet" /\ focus' = FALSE /\ stray' = TRUE
                   /\ UNCHANGED view
              ELSE UNCHANGED <<view, mode, focus, stray>>   \* content scrolls
  /\ UNCHANGED <<draft, leak, skipped, lost>>

GrabUp ==
  /\ mode = "sheet"
  /\ mode' = "full"
  /\ UNCHANGED <<view, focus, draft, Ghosts>>

GrabDown ==
  /\ mode \in {"sheet", "full"}
  /\ mode' = IF mode = "full" THEN "sheet" ELSE Rest(view)
  /\ focus' = FALSE
  /\ UNCHANGED <<view, draft, Ghosts>>

\* ---- Android Back --------------------------------------------------------
LeaveView ==
  /\ view # "home"
  /\ view' = "home" /\ mode' = Rest("home") /\ focus' = FALSE
  /\ skipped' = (skipped \/ Raised)

Back ==
  /\ IF focus
       THEN /\ focus' = FALSE                  \* the keyboard closes first
            /\ UNCHANGED <<view, mode, skipped>>
     ELSE IF mode = "full"
       THEN /\ mode' = "sheet" /\ UNCHANGED <<view, focus, skipped>>
     ELSE IF mode = "sheet"
       THEN /\ mode' = Rest(view) /\ UNCHANGED <<view, focus, skipped>>
     ELSE IF Design = "proposed" /\ mode = "input" /\ Rest(view) = "hidden"
       THEN /\ mode' = "hidden" /\ UNCHANGED <<view, focus, skipped>>
     ELSE IF view # "home" THEN LeaveView
     ELSE UNCHANGED <<view, mode, focus, skipped>>
  /\ UNCHANGED <<draft, leak, stray, lost>>

\* The agent or a notice opens another view. Raised chat follows the new view.
OpenView(v) ==
  /\ v # view
  /\ view' = v /\ mode' = Rest(v) /\ focus' = FALSE
  /\ UNCHANGED <<draft, Ghosts>>

Next ==
  \/ TapAlpha \/ TapType \/ FocusComposer \/ TypeText \/ Send \/ ImeHide
  \/ TapOutside \/ GrabUp \/ GrabDown \/ Back
  \/ \E o \in Origins : SwipeUp(o)
  \/ \E v \in Views : OpenView(v)

Spec == Init /\ [][Next]_vars

\* ---- properties ------------------------------------------------------------
\* The first touch outside a raised chat lowers it and reaches nothing.
NoLeak == ~leak
\* Only a drag that starts on the dock opens the chat.
NoStrayOpen == ~stray
\* Back lowers the chat one level at a time before it leaves the view.
BackInOrder == ~skipped
\* A collapse never throws a draft away.
DraftKept == ~lost
\* The keyboard is up only while a composer is on screen.
FocusNeedsComposer == focus => mode \in {"input", "sheet", "full"}
\* Every raised form has a single-touch way down (guarded outside or full's own control).
OneTouchDown == Raised => (Guarded \/ mode = "full")
=============================================================================
