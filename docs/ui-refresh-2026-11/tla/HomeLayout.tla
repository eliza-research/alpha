------------------------------ MODULE HomeLayout ------------------------------
(***************************************************************************)
(* Launcher Home: the card row at the top and the position of the app     *)
(* grid.                                                                   *)
(*                                                                         *)
(* Design = "current" models the code at ef9fbf7cd7:                       *)
(*   template.html (calendar, workflows and inbox cards always drawn; the  *)
(*   grid sits between two flex-grow spacers), phone.css (Home's bottom    *)
(*   padding is --alpha-dock-rest, measured by runtime/dock-clearance.ts), *)
(*   main.tsx (Android insets arrive from DailyApps.surfaceInfo() after    *)
(*   the first paint).                                                     *)
(* Design = "proposed" models ../README.md section "Home":                 *)
(*   a card is drawn only when it has something to show; with none, one    *)
(*   date line (plus "Connect Google" while Google is not connected); the  *)
(*   grid is anchored to a bottom reserve computed in CSS from the insets, *)
(*   which are known before Home is first drawn.                           *)
(*                                                                         *)
(* Lengths are canvas pixels on the 412 x 915 reference phone (871 below   *)
(* the status bar).                                                        *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Design
ASSUME Design \in {"current", "proposed"}

H == 871      \* Home layer height
G == 370      \* three rows of app icons
PadTop == 20
Short == 196  \* a card with one line of copy
Tall == 236   \* a card with an event's time and next line, or two mail rows
Fixed == 212  \* proposed: the one height every card and the date line share

CalStates  == {"loading", "none", "event", "error", "denied"}
FlowStates == {"noagent", "loading", "none", "paused", "active", "failed"}
MailStates == {"unconnected", "loading", "none", "unread", "error"}
Docks      == {"pill", "bar", "keyboard"}

VARIABLES cal, flows, mail, brief, insets, dock, top0

vars == <<cal, flows, mail, brief, insets, dock, top0>>

Google == mail # "unconnected"

\* ---- what the card row shows ------------------------------------------
Shown ==
  IF Design = "current"
    THEN {"calendar", "workflows", "inbox"} \cup (IF brief THEN {"brief"} ELSE {})
    ELSE (IF cal = "event" THEN {"calendar"} ELSE {})
         \cup (IF flows = "active" THEN {"workflows"} ELSE {})
         \cup (IF mail = "unread" THEN {"inbox"} ELSE {})
         \cup (IF brief THEN {"brief"} ELSE {})

DateLine  == Design = "proposed" /\ Shown = {}
SetupLink == DateLine /\ ~Google

HasContent(c) ==
  CASE c = "calendar"  -> cal = "event"
    [] c = "workflows" -> flows = "active"
    [] c = "inbox"     -> mail = "unread"
    [] c = "brief"     -> brief

Loading(c) ==
  CASE c = "calendar"  -> cal = "loading"
    [] c = "workflows" -> flows = "loading"
    [] c = "inbox"     -> mail = "loading"
    [] c = "brief"     -> FALSE

\* ---- where the grid is ------------------------------------------------
Max(a, b) == IF a > b THEN a ELSE b
\* Android's bottom bar plus 12px: 28 by default, 60 with three-button navigation.
Clear == IF insets = "pending" THEN 28 ELSE 60
\* --alpha-dock-rest as dock-clearance.ts measures it: the top of the bar.
MeasuredRest ==
  IF insets = "pending" THEN 102          \* not yet published: the CSS fallback
  ELSE CASE dock = "pill" -> Clear + 54
         [] dock = "bar" -> Clear + 62
         [] dock = "keyboard" -> Clear + 62 + 280
RowH ==
  IF Design = "proposed" THEN Fixed
  ELSE IF cal = "event" \/ mail = "unread" \/ flows \in {"active", "paused"} THEN Tall ELSE Short

GridTop ==
  IF Design = "current"
    THEN LET reserve == Max(108, MeasuredRest + 6)
             above == PadTop + RowH
         IN above + (H - reserve - above - G) \div 2
    ELSE H - (Clear + 62 + 24) - G           \* bottom-anchored, CSS only

TypeOK ==
  /\ cal \in CalStates /\ flows \in FlowStates /\ mail \in MailStates /\ brief \in BOOLEAN
  /\ insets \in {"pending", "native"} /\ dock \in Docks /\ top0 \in Int

Init ==
  /\ cal = "loading" /\ flows = "loading" /\ mail = "loading" /\ brief = FALSE
  /\ insets = IF Design = "current" THEN "pending" ELSE "native"
  /\ dock = "bar"
  /\ top0 = GridTop

\* Sources change on their own; the person opens and closes the keyboard.
Source ==
  \/ \E c \in CalStates : cal' = c /\ UNCHANGED <<flows, mail, brief>>
  \/ \E f \in FlowStates : flows' = f /\ UNCHANGED <<cal, mail, brief>>
  \/ \E m \in MailStates : mail' = m /\ UNCHANGED <<cal, flows, brief>>
  \/ brief' = ~brief /\ UNCHANGED <<cal, flows, mail>>
Next ==
  \/ Source /\ UNCHANGED <<insets, dock, top0>>
  \/ insets = "pending" /\ insets' = "native" /\ UNCHANGED <<cal, flows, mail, brief, dock, top0>>
  \/ \E d \in Docks : dock' = d /\ UNCHANGED <<cal, flows, mail, brief, insets, top0>>

Spec == Init /\ [][Next]_vars

\* ---- properties ------------------------------------------------------------
\* The apps never move once Home is drawn.
GridStable == GridTop = top0
\* Every card on Home has something to show.
CardsHaveContent == \A c \in Shown : HasContent(c)
\* No card is drawn just to say it is loading.
NoLoadingCards == \A c \in Shown : ~Loading(c)
\* The top of Home is never blank: cards, or the date line.
TopNeverBlank == Shown # {} \/ DateLine
\* A setup prompt appears only while there is something to set up.
SetupOnlyWhenNeeded == SetupLink => ~Google
=============================================================================
