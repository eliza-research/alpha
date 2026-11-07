------------------------------ MODULE Calendar ------------------------------
(***************************************************************************)
(* Calendar views, event actions and Google synchronisation.               *)
(*                                                                         *)
(* Design = "current" (ef9fbf7cd7):                                        *)
(*  - Google events appear only after one calendar is chosen in Settings › *)
(*    Google accounts (google-calendar-view-adapter.ts:30); there is no    *)
(*    control for that on the Calendar screen.                             *)
(*  - Google rows are read-only (google-calendar-view-adapter.ts:64).      *)
(*  - One zero-length Google event makes the whole feed fail               *)
(*    (google-calendar.ts:62, int-alphaphone-017).                         *)
(*  - A conflicted linked row has no resolution surface                    *)
(*    (calendar-linked-sync.ts resolveConflict has no caller,              *)
(*    code-alpha-runtime-008/009).                                         *)
(*  - No search or schedule view.                                          *)
(* Design = "proposed": Google Calendar is the source of truth when        *)
(* connected (cached for offline), every visible Google calendar shows     *)
(* without a picker, events are created, edited, deleted and answered      *)
(* (RSVP) in Alpha through an outbox, a bad event is skipped, and a        *)
(* conflict offers Keep mine / Keep Google's inline.                       *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Design, MaxRemote, MaxFlips
ASSUME Design \in {"current", "proposed"}

Ids == {1, 2, 3}        \* 1, 2 exist on Google; 3 is created in Alpha
Fresh == 3
TopViews == {"Day", "Week", "Month", "Schedule"}
Views == TopViews \cup {"Event", "Editor", "Search"}

VARIABLES
  access,    \* Google Calendar access from GoogleConnect: "none" | "read" | "write"
  picked,    \* current: a Google calendar chosen in Settings
  net,       \* "up" | "down"
  view, top, \* the visible view and the top-level view Back returns to
  focus,     \* event shown in Event/Editor (0 = none)
  server,    \* [Ids -> BOOLEAN] event exists on Google
  local,     \* [Ids -> BOOLEAN] event exists in Alpha's view of the calendar
  op,        \* [Ids -> "none" | "create" | "update" | "delete"] outbox
  conflict,  \* [Ids -> BOOLEAN] Google changed the event under a pending op
  undo,      \* id whose deletion can still be undone (0 = none)
  bad,       \* event 2 is malformed (for example zero length)
  rsvp,      \* [Ids -> "none" | "yes" | "no" | "maybe"]
  remote, flips

vars == <<access, picked, net, view, top, focus, server, local, op, conflict,
          undo, bad, rsvp, remote, flips>>

TypeOK ==
  /\ access \in {"none", "read", "write"} /\ picked \in BOOLEAN /\ net \in {"up", "down"}
  /\ view \in Views /\ top \in TopViews /\ focus \in Ids \cup {0}
  /\ server \in [Ids -> BOOLEAN] /\ local \in [Ids -> BOOLEAN]
  /\ op \in [Ids -> {"none", "create", "update", "delete"}]
  /\ conflict \in [Ids -> BOOLEAN] /\ undo \in Ids \cup {0} /\ bad \in BOOLEAN
  /\ rsvp \in [Ids -> {"none", "yes", "no", "maybe"}]
  /\ remote \in Nat /\ flips \in Nat

Init ==
  /\ access \in {"none", "read", "write"}
  /\ picked = FALSE /\ net \in {"up", "down"}
  /\ view = "Day" /\ top = "Day" /\ focus = 0
  /\ server = [i \in Ids |-> i # Fresh] /\ local = [i \in Ids |-> i # Fresh]
  /\ op = [i \in Ids |-> "none"] /\ conflict = [i \in Ids |-> FALSE]
  /\ undo = 0 /\ bad \in BOOLEAN /\ rsvp = [i \in Ids |-> "none"]
  /\ remote = 0 /\ flips = 0

(************************** what the screen shows *************************)

\* Google events reach the screen only with access (and, today, a pick).
GoogleShown == access # "none" /\ (Design = "proposed" \/ picked)
\* Today one bad event fails the whole feed; proposed skips just that event.
FeedFails == Design = "current" /\ bad
\* Event 3 is created in Alpha and stored on the phone too, so it shows
\* whatever happens to the Google feed.
Displayed ==
  {i \in Ids : local[i] /\ ~(i = 2 /\ bad) /\ (i = Fresh \/ (GoogleShown /\ ~FeedFails))}
\* Today only events created in Alpha are linked and editable; Google's own
\* events are display-only.
Writable(i) == access = "write" /\ (Design = "proposed" \/ i = Fresh)

(********************************* views ************************************)

Switch(v) ==
  /\ v \in TopViews /\ view \in TopViews /\ v # view
  /\ (v = "Schedule" => Design = "proposed")   \* no schedule list today
  /\ view' = v /\ top' = v
  /\ UNCHANGED <<access, picked, net, focus, server, local, op, conflict, undo,
                 bad, rsvp, remote, flips>>

OpenSearch ==
  /\ Design = "proposed" /\ view \in TopViews
  /\ view' = "Search"
  /\ UNCHANGED <<access, picked, net, top, focus, server, local, op, conflict,
                 undo, bad, rsvp, remote, flips>>

OpenEvent(i) ==
  /\ view \in TopViews \cup {"Search"} /\ i \in Displayed
  /\ view' = "Event" /\ focus' = i
  /\ UNCHANGED <<access, picked, net, top, server, local, op, conflict, undo,
                 bad, rsvp, remote, flips>>

Back ==
  /\ view \notin TopViews
  /\ view' = IF view = "Editor" /\ focus # 0 /\ local[focus] THEN "Event" ELSE top
  /\ focus' = IF view = "Editor" /\ focus # 0 /\ local[focus] THEN focus ELSE 0
  /\ UNCHANGED <<access, picked, net, top, server, local, op, conflict, undo,
                 bad, rsvp, remote, flips>>

(******************************** actions ***********************************)

NewEvent ==
  /\ view \in TopViews /\ Writable(Fresh) /\ ~local[Fresh] /\ ~server[Fresh]
  /\ view' = "Editor" /\ focus' = Fresh
  /\ UNCHANGED <<access, picked, net, top, server, local, op, conflict, undo,
                 bad, rsvp, remote, flips>>

Edit ==
  /\ view = "Event" /\ Writable(focus) /\ op[focus] # "delete"
  /\ view' = "Editor"
  /\ UNCHANGED <<access, picked, net, top, focus, server, local, op, conflict,
                 undo, bad, rsvp, remote, flips>>

\* Saving shows the change at once and queues it.
Save ==
  /\ view = "Editor"
  /\ local' = [local EXCEPT ![focus] = TRUE]
  /\ op' = [op EXCEPT ![focus] = IF server[focus] THEN "update" ELSE "create"]
  /\ view' = "Event"
  /\ UNCHANGED <<access, picked, net, top, focus, server, conflict, undo, bad,
                 rsvp, remote, flips>>

\* Delete hides the event and offers Undo; nothing reaches Google until
\* the Undo window closes. Recurring events ask "This event / All events"
\* in the same sheet (not modelled separately).
Delete ==
  /\ view = "Event" /\ Writable(focus) /\ undo = 0
  /\ local' = [local EXCEPT ![focus] = FALSE]
  /\ op' = [op EXCEPT ![focus] = IF server[focus] THEN "delete" ELSE "none"]
  /\ undo' = focus /\ view' = top /\ focus' = 0
  /\ UNCHANGED <<access, picked, net, top, server, conflict, bad, rsvp, remote, flips>>

UndoDelete ==
  /\ undo # 0
  /\ local' = [local EXCEPT ![undo] = TRUE]
  /\ op' = [op EXCEPT ![undo] = "none"]
  /\ undo' = 0
  /\ UNCHANGED <<access, picked, net, view, top, focus, server, conflict, bad,
                 rsvp, remote, flips>>

UndoExpires ==
  /\ undo # 0 /\ undo' = 0
  /\ UNCHANGED <<access, picked, net, view, top, focus, server, local, op,
                 conflict, bad, rsvp, remote, flips>>

\* Answer an invitation in Alpha (proposed); today invites are fixtures only.
Rsvp(a) ==
  /\ Design = "proposed" /\ view = "Event" /\ Writable(focus) /\ local[focus] /\ rsvp[focus] # a
  /\ rsvp' = [rsvp EXCEPT ![focus] = a]
  /\ op' = [op EXCEPT ![focus] = IF op[focus] = "create" THEN "create" ELSE "update"]
  /\ UNCHANGED <<access, picked, net, view, top, focus, server, local, conflict,
                 undo, bad, remote, flips>>

\* Proposed: a conflict is shown on the event with Keep mine / Keep Google's.
Resolve(keepMine) ==
  /\ Design = "proposed" /\ \E i \in Ids : conflict[i]
  /\ \E i \in Ids :
       /\ conflict[i]
       /\ conflict' = [conflict EXCEPT ![i] = FALSE]
       /\ op' = [op EXCEPT ![i] = IF keepMine THEN op[i] ELSE "none"]
       /\ local' = [local EXCEPT ![i] = IF keepMine THEN local[i] ELSE server[i]]
  /\ UNCHANGED <<access, picked, net, view, top, focus, server, undo, bad, rsvp,
                 remote, flips>>

\* Current: the only route to Google events.
PickInSettings ==
  /\ Design = "current" /\ access # "none" /\ ~picked
  /\ picked' = TRUE
  /\ UNCHANGED <<access, net, view, top, focus, server, local, op, conflict, undo,
                 bad, rsvp, remote, flips>>

(*************************** system and world *****************************)

\* The outbox sends one change when online, outside the Undo window, and
\* not while a conflict waits for the owner.
Sync(i) ==
  /\ net = "up" /\ op[i] # "none" /\ ~conflict[i] /\ undo # i /\ access = "write"
  /\ (Design = "proposed" \/ picked)        \* today: sync needs a chosen calendar
  /\ server' = [server EXCEPT ![i] = (op[i] # "delete")]
  /\ op' = [op EXCEPT ![i] = "none"]
  /\ UNCHANGED <<access, picked, net, view, top, focus, local, conflict, undo,
                 bad, rsvp, remote, flips>>

\* Someone edits or deletes the event on Google while a change is queued.
RemoteChange(i) ==
  /\ remote < MaxRemote /\ server[i] /\ op[i] # "none" /\ ~conflict[i]
  /\ remote' = remote + 1
  /\ conflict' = [conflict EXCEPT ![i] = TRUE]
  /\ server' \in {[server EXCEPT ![i] = TRUE], [server EXCEPT ![i] = FALSE]}
  /\ UNCHANGED <<access, picked, net, view, top, focus, local, op, undo, bad,
                 rsvp, flips>>

NetDrop ==
  /\ flips < MaxFlips /\ net = "up" /\ net' = "down" /\ flips' = flips + 1
  /\ UNCHANGED <<access, picked, view, top, focus, server, local, op, conflict,
                 undo, bad, rsvp, remote>>
NetRecover ==
  /\ net = "down" /\ net' = "up"
  /\ UNCHANGED <<access, picked, view, top, focus, server, local, op, conflict,
                 undo, bad, rsvp, remote, flips>>

Nav == (\E v \in TopViews : Switch(v)) \/ OpenSearch \/ (\E i \in Ids : OpenEvent(i)) \/ Back
Act == NewEvent \/ Edit \/ Save \/ Delete \/ UndoDelete
       \/ (\E a \in {"yes", "no", "maybe"} : Rsvp(a)) \/ PickInSettings
World == UndoExpires \/ (\E i \in Ids : RemoteChange(i)) \/ NetDrop \/ NetRecover

Next == Nav \/ Act \/ (\E k \in BOOLEAN : Resolve(k)) \/ (\E i \in Ids : Sync(i)) \/ World

\* The outbox, the network and Undo timers are fair; the owner eventually
\* answers a visible conflict.
Spec == Init /\ [][Next]_vars
        /\ \A i \in Ids : WF_vars(Sync(i))
        /\ WF_vars(NetRecover) /\ WF_vars(UndoExpires)
        /\ SF_vars(\E k \in BOOLEAN : Resolve(k))

(******************************* properties *********************************)

\* Every non-top view has Back.
AlwaysBack == view \notin TopViews => ENABLED Back

\* Connecting Google is enough to see Google events.
GoogleVisibleWhenConnected == access # "none" => GoogleShown

\* A malformed event never hides the others.
BadEventIsolated == (GoogleShown /\ local[1]) => 1 \in Displayed

\* With write access, a Google event can be edited in Alpha.
EditableWhenWritable ==
  (view = "Event" /\ access = "write" /\ focus \in Displayed /\ op[focus] # "delete")
    => ENABLED Edit

\* A saved change shows immediately, online or not.
SavedChangeVisible == \A i \in Ids : op[i] \in {"create", "update"} => local[i]

\* Undo is real: Google never receives a delete that can still be undone.
\* (An Alpha send is the step that clears op[i] and changes Google.)
UndoBeforeSend ==
  [][\A i \in Ids : (undo = i /\ op[i] = "delete")
        => ~(op'[i] = "none" /\ server[i] /\ ~server'[i])]_vars

\* Every queued change eventually settles (sent, or resolved by the owner).
OutboxDrains == \A i \in Ids : (op[i] # "none") ~> (op[i] = "none")

=============================================================================
