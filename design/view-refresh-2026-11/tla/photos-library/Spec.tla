---- MODULE Spec ----
(***************************************************************************)
(* Alpha Phone Photos view: library window, selection, viewer, trash,      *)
(* external MediaStore changes and agent filter/select/review.             *)
(*                                                                         *)
(* Code modelled: apps/app/src/prototype/camera-adapter.ts (CA),           *)
(* photo-library-adapter.ts, runtime/photo-library.ts.                     *)
(* Proposal: design/view-refresh-2026-11/PLAN.md section 2.                *)
(*                                                                         *)
(* Item ids are ordered by capture date: a larger id is newer.             *)
(* Port (2026-11-06): agent photos_open (AgentOpen), reviewed photos_share  *)
(* (AgentShareReview; applying shares and changes no item) and the editor's *)
(* Replace (EditReplace: overwrites the open item, a new revision). Album   *)
(* creation changes no modelled item state and is not modelled.            *)
(* Fix* = FALSE is the code as written; TRUE is the proposed design.       *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Ids,          \* e.g. 1..3
          W,            \* loaded window size (240 in code; small here)
          Cap,          \* selection cap (20 in code)
          Budget,       \* external MediaStore events
          FixWindow,    \* keep the newest W, not the oldest (CA:303,402,465)
          FixPatch,     \* store events patch the view (CA:961-988 clears it)
          FixFavToggle, \* batch Favorite toggles (CA:341 always sets)
          FixNoCap      \* no user-visible selection cap

VARIABLES exists, trashed, fav, rev,   \* the store
          tab,        \* "lib" | "trash"
          sel,        \* selection: set of ids, or {} when not selecting
          selecting,
          viewer,     \* 0 = closed, else the open id
          filter,     \* "none" | "fav"  (set only by the agent, read-only)
          review,     \* pending agent review: [ids, revs, act]; NoReview when none
          budget,
          lostSel,    \* ghost: an unrelated store event cleared the selection
          favStuck,   \* ghost: Favorite on an all-favourite selection did nothing
          capHit,     \* ghost: a selection tap was refused by the cap
          purgedLive  \* ghost: an item never trashed was deleted forever

vars == <<exists, trashed, fav, rev, tab, sel, selecting, viewer, filter, review,
          budget, lostSel, favStuck, capHit, purgedLive>>

MaxRev == 2
NoReview == [ids |-> {}, revs |-> [i \in {} |-> 0], act |-> "none"]
Live    == {i \in Ids : exists[i] /\ ~trashed[i]}
InTrash == {i \in Ids : exists[i] /\ trashed[i]}
Matches(i) == filter = "none" \/ fav[i]
Pool == IF tab = "lib" THEN {i \in Live : Matches(i)} ELSE InTrash

\* The loaded window: the W newest (design) or the W oldest (as written) of Pool.
RECURSIVE Take(_, _, _)
Take(S, n, newest) ==
  IF n = 0 \/ S = {} THEN {}
  ELSE LET m == IF newest THEN CHOOSE x \in S : \A y \in S : y <= x
                          ELSE CHOOSE x \in S : \A y \in S : x <= y
       IN {m} \cup Take(S \ {m}, n - 1, newest)
Window == Take(Pool, W, FixWindow)

TypeOK ==
  /\ exists \in [Ids -> BOOLEAN] /\ trashed \in [Ids -> BOOLEAN]
  /\ fav \in [Ids -> BOOLEAN] /\ rev \in [Ids -> 0..MaxRev]
  /\ tab \in {"lib", "trash"} /\ sel \subseteq Ids /\ selecting \in BOOLEAN
  /\ viewer \in Ids \cup {0} /\ filter \in {"none", "fav"}
  /\ budget \in 0..Budget

Init ==
  /\ exists = [i \in Ids |-> TRUE] /\ trashed = [i \in Ids |-> FALSE]
  /\ fav \in [Ids -> BOOLEAN] /\ rev = [i \in Ids |-> 0]
  /\ tab = "lib" /\ sel = {} /\ selecting = FALSE /\ viewer = 0
  /\ filter = "none" /\ review = NoReview /\ budget = Budget
  /\ lostSel = FALSE /\ favStuck = FALSE /\ capHit = FALSE /\ purgedLive = FALSE

Bump(i) == rev' = [rev EXCEPT ![i] = IF @ < MaxRev THEN @ + 1 ELSE @]
Ghosts == <<lostSel, favStuck, capHit, purgedLive>>

----------------------------------------------------------------------------
SwitchTab(t) ==
  /\ tab # t /\ viewer = 0
  /\ tab' = t /\ sel' = {} /\ selecting' = FALSE
  /\ UNCHANGED <<exists, trashed, fav, rev, viewer, filter, review, budget>> /\ UNCHANGED Ghosts

EnterSelect ==
  /\ ~selecting /\ viewer = 0 /\ Window # {}
  /\ selecting' = TRUE /\ sel' = {}
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, viewer, filter, review, budget>> /\ UNCHANGED Ghosts

Toggle(i) ==
  /\ selecting /\ i \in Window
  /\ IF i \notin sel /\ Cardinality(sel) >= Cap /\ ~FixNoCap
       THEN capHit' = TRUE /\ UNCHANGED sel
       ELSE /\ sel' = IF i \in sel THEN sel \ {i} ELSE sel \cup {i}
            /\ UNCHANGED capHit
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, selecting, viewer, filter, review, budget,
                 lostSel, favStuck, purgedLive>>

SelectAll ==
  /\ selecting /\ FixNoCap
  /\ sel' = Window
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, selecting, viewer, filter, review, budget>> /\ UNCHANGED Ghosts

CancelSelect ==
  /\ selecting /\ selecting' = FALSE /\ sel' = {}
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, viewer, filter, review, budget>> /\ UNCHANGED Ghosts

BatchFavorite ==
  /\ selecting /\ tab = "lib" /\ sel # {}
  /\ LET allFav == \A i \in sel : fav[i]
         target == IF FixFavToggle THEN ~allFav ELSE TRUE
     IN /\ fav' = [i \in Ids |-> IF i \in sel THEN target ELSE fav[i]]
        /\ favStuck' = (favStuck \/ (allFav /\ ~FixFavToggle))
  /\ rev' = [i \in Ids |-> IF i \in sel /\ rev[i] < MaxRev THEN rev[i] + 1 ELSE rev[i]]
  /\ selecting' = FALSE /\ sel' = {}
  /\ UNCHANGED <<exists, trashed, tab, viewer, filter, review, budget, lostSel, capHit, purgedLive>>

BatchTrash ==
  /\ selecting /\ tab = "lib" /\ sel # {}
  /\ trashed' = [i \in Ids |-> trashed[i] \/ i \in sel]
  /\ rev' = [i \in Ids |-> IF i \in sel /\ rev[i] < MaxRev THEN rev[i] + 1 ELSE rev[i]]
  /\ selecting' = FALSE /\ sel' = {}
  /\ UNCHANGED <<exists, fav, tab, viewer, filter, review, budget>> /\ UNCHANGED Ghosts

BatchRestore ==
  /\ selecting /\ tab = "trash" /\ sel # {}
  /\ trashed' = [i \in Ids |-> trashed[i] /\ i \notin sel]
  /\ rev' = [i \in Ids |-> IF i \in sel /\ rev[i] < MaxRev THEN rev[i] + 1 ELSE rev[i]]
  /\ selecting' = FALSE /\ sel' = {}
  /\ UNCHANGED <<exists, fav, tab, viewer, filter, review, budget>> /\ UNCHANGED Ghosts

\* Only from Recently deleted, after the confirmation sheet.
DeleteForever ==
  /\ selecting /\ tab = "trash" /\ sel # {}
  /\ purgedLive' = (purgedLive \/ \E i \in sel : ~trashed[i])
  /\ exists' = [i \in Ids |-> exists[i] /\ i \notin sel]
  /\ selecting' = FALSE /\ sel' = {}
  /\ UNCHANGED <<trashed, fav, rev, tab, viewer, filter, review, budget, lostSel, favStuck, capHit>>

OpenViewer(i) ==
  /\ ~selecting /\ viewer = 0 /\ i \in Window
  /\ viewer' = i
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, sel, selecting, filter, review, budget>> /\ UNCHANGED Ghosts

Swipe(i) ==
  /\ viewer # 0 /\ i \in Window /\ i # viewer
  /\ viewer' = i
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, sel, selecting, filter, review, budget>> /\ UNCHANGED Ghosts

ViewerTrash ==   \* Delete in the viewer of a library item; the viewer moves on or closes
  /\ viewer # 0 /\ tab = "lib"
  /\ trashed' = [trashed EXCEPT ![viewer] = TRUE] /\ Bump(viewer)
  /\ viewer' = 0
  /\ UNCHANGED <<exists, fav, tab, sel, selecting, filter, review, budget>> /\ UNCHANGED Ghosts

CloseViewer ==
  /\ viewer # 0 /\ viewer' = 0
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, sel, selecting, filter, review, budget>> /\ UNCHANGED Ghosts

Undo(i) ==   \* the Undo toast after a move to Recently deleted
  /\ exists[i] /\ trashed[i] /\ viewer = 0 /\ ~selecting
  /\ trashed' = [trashed EXCEPT ![i] = FALSE] /\ Bump(i)
  /\ UNCHANGED <<exists, fav, tab, sel, selecting, viewer, filter, review, budget>> /\ UNCHANGED Ghosts

----------------------------------------------------------------------------
(* Another app, the camera, or Android itself changes MediaStore. *)
StoreEvent(i) ==
  /\ budget > 0 /\ budget' = budget - 1
  /\ \/ /\ exists[i] /\ exists' = [exists EXCEPT ![i] = FALSE] /\ UNCHANGED <<trashed, fav, rev>>
     \/ /\ exists[i] /\ Bump(i) /\ fav' = [fav EXCEPT ![i] = ~@] /\ UNCHANGED <<exists, trashed>>
     \/ /\ ~exists[i] /\ exists' = [exists EXCEPT ![i] = TRUE]
        /\ trashed' = [trashed EXCEPT ![i] = FALSE] /\ Bump(i) /\ UNCHANGED fav
  /\ IF FixPatch
       THEN /\ sel' = {j \in sel : exists'[j] /\ (trashed'[j] <=> tab = "trash")
                                  /\ (tab = "trash" \/ filter = "none" \/ fav'[j])}
            /\ viewer' = IF viewer # 0 /\ ~exists'[viewer] THEN 0 ELSE viewer
            /\ UNCHANGED <<selecting, lostSel>>
       ELSE /\ sel' = {} /\ selecting' = FALSE /\ viewer' = 0
            /\ lostSel' = (lostSel \/ (sel \ {i}) # {})
  /\ UNCHANGED <<tab, filter, review, favStuck, capHit, purgedLive>>

(* Agent tools. photos_filter is read-only. photo_library_review captures the *)
(* revisions it showed the user and applies only if they still match.        *)
AgentFilter(f) ==
  /\ filter' = f /\ viewer = 0
  /\ sel' = {j \in sel : f = "none" \/ fav[j]}
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, selecting, viewer, review, budget>> /\ UNCHANGED Ghosts

AgentReview ==
  /\ review.ids = {} /\ selecting /\ sel # {} /\ tab = "lib"
  /\ review' = [ids |-> sel, revs |-> [i \in sel |-> rev[i]], act |-> "trash"]
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, sel, selecting, viewer, filter, budget>> /\ UNCHANGED Ghosts

ReviewCurrent == review.ids # {} /\ \A i \in review.ids : exists[i] /\ ~trashed[i] /\ rev[i] = review.revs[i]

\* photos_share: the agent names loaded Library items (unfiltered); the owner confirms over the grid.
\* One item is enough to check the rules (a set behaves the same per item) and keeps TLC small.
AgentShareReview ==
  /\ review.ids = {}
  /\ \E i \in Take(Live, W, FixWindow) :
       review' = [ids |-> {i}, revs |-> [j \in {i} |-> rev[j]], act |-> "share"]
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, sel, selecting, viewer, filter, budget>> /\ UNCHANGED Ghosts

AgentApply ==   \* user approved: trash moves the items to Recently deleted; share hands them to Android
  /\ review.ids # {} /\ ReviewCurrent
  /\ IF review.act = "trash"
       THEN /\ trashed' = [i \in Ids |-> trashed[i] \/ i \in review.ids]
            /\ rev' = [i \in Ids |-> IF i \in review.ids /\ rev[i] < MaxRev THEN rev[i] + 1 ELSE rev[i]]
            /\ sel' = sel \ review.ids
       ELSE UNCHANGED <<trashed, rev, sel>>
  /\ review' = NoReview
  /\ UNCHANGED <<exists, fav, tab, selecting, viewer, filter, budget>> /\ UNCHANGED Ghosts

\* photos_open: navigation only. The code clears the selection and the filter and shows the
\* item from the loaded Library window; it is refused while a review waits.
AgentOpen(i) ==
  /\ review.ids = {} /\ i \in Take(Live, W, FixWindow)
  /\ viewer' = i /\ tab' = "lib" /\ filter' = "none" /\ sel' = {} /\ selecting' = FALSE
  /\ UNCHANGED <<exists, trashed, fav, rev, review, budget>> /\ UNCHANGED Ghosts

\* Editor Save > Replace on the open Library item: its pixels are overwritten (a new revision);
\* the viewer stays on it. A review that captured the old revision can no longer apply.
\* Like an external edit it draws on the event budget, which bounds the revisions TLC explores.
EditReplace ==
  /\ viewer # 0 /\ tab = "lib" /\ exists[viewer] /\ ~trashed[viewer] /\ ~selecting
  /\ budget > 0 /\ budget' = budget - 1
  /\ Bump(viewer)
  /\ UNCHANGED <<exists, trashed, fav, tab, sel, selecting, viewer, filter, review>> /\ UNCHANGED Ghosts

AgentReject ==  \* user cancelled, or the reviewed revisions are stale
  /\ review.ids # {} /\ review' = NoReview
  /\ UNCHANGED <<exists, trashed, fav, rev, tab, sel, selecting, viewer, filter, budget>> /\ UNCHANGED Ghosts

Next ==
  \/ SwitchTab("lib") \/ SwitchTab("trash") \/ EnterSelect \/ SelectAll \/ CancelSelect
  \/ \E i \in Ids : Toggle(i) \/ OpenViewer(i) \/ Swipe(i) \/ Undo(i) \/ StoreEvent(i)
  \/ BatchFavorite \/ BatchTrash \/ BatchRestore \/ DeleteForever
  \/ ViewerTrash \/ CloseViewer
  \/ AgentFilter("none") \/ AgentFilter("fav") \/ AgentReview \/ AgentApply \/ AgentReject
  \/ AgentShareReview \/ EditReplace \/ \E i \in Ids : AgentOpen(i)

Spec == Init /\ [][Next]_vars /\ WF_vars(AgentApply \/ AgentReject)

----------------------------------------------------------------------------
NewestNeverDropped == Pool # {} => (\E m \in Window : \A y \in Pool : y <= m)
SelectionSubsetOfVisible == sel \subseteq Pool
ViewerShowsExistingItem == viewer # 0 => exists[viewer]
NoSpuriousClear == ~lostSel
FavoriteReversible == ~favStuck
NoSelectionCap == ~capHit
DeleteForeverOnlyFromTrash == ~purgedLive
\* A reviewed action never applies to a revision the user did not see.
NoActionOnStaleRev ==
  [][AgentApply => \A i \in review.ids : rev[i] = review.revs[i]]_vars
\* The agent's filter never changes library contents.
FilterIsReadOnly ==
  [][(filter' # filter) => UNCHANGED <<exists, trashed, fav, rev>>]_vars
\* Sharing never changes library contents.
ShareChangesNothing ==
  [][(AgentApply /\ review.act = "share") => UNCHANGED <<exists, trashed, fav, rev>>]_vars
ReviewSettles == (review.ids # {}) ~> (review.ids = {})
====
