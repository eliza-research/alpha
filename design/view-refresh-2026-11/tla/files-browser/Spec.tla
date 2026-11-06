---- MODULE Spec ----
(***************************************************************************)
(* Alpha Phone Files view: category listings, folder tree, move/copy,      *)
(* trash, external changes and reviewed agent moves.                       *)
(*                                                                         *)
(* Code modelled: apps/app/src/prototype/files-tree-adapter.ts:15-20,145   *)
(* and DailyAppsPlugin.java:132-136 (each location opens                   *)
(* ACTION_OPEN_DOCUMENT with a MIME filter and no initial URI, so the      *)
(* picker lists its own Recent set).                                       *)
(* Proposal: design/view-refresh-2026-11/PLAN.md section 4.                *)
(*                                                                         *)
(* Files are model values with a kind; directories are a fixed set. A file *)
(* not on the device has loc = Gone. Fix* = FALSE is the code as written.  *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Budget,
          FixCategories, \* categories are queries over storage, not the picker's Recent
          FixConflict    \* a move into a folder with the same name asks first (no overwrite)

FilesSet == {"photo", "pdf", "scan"}
Dirs == {"Download", "DCIM/Camera", "Documents"}
Gone == "gone"
Trash == "trash"
Kind == [f \in FilesSet |-> IF f = "photo" THEN "image" ELSE "pdf"]
\* a camera photo, a downloaded PDF, a scan not yet saved
Home0 == [f \in FilesSet |-> CASE f = "photo" -> "DCIM/Camera" [] f = "pdf" -> "Download"
                                [] OTHER -> Gone]
Names == 1..3   \* enough for every file to share one folder

VARIABLES loc,       \* FilesSet -> Dirs \cup {Trash, Gone}
          origin,    \* FilesSet -> Dirs: where Restore puts it back
          name,      \* FilesSet -> Names: a name; equal names in one dir conflict
          sel,       \* selected files in the open folder
          cwd,       \* open folder
          stale,     \* listing out of date after an external change
          review,    \* pending agent move [f, from, to] or NoReview
          budget,
          lost       \* ghost: a file was overwritten without confirmation

vars == <<loc, origin, name, sel, cwd, stale, review, budget, lost>>
NoReview == [f |-> Gone, from |-> Gone, to |-> Gone]

Present == {f \in FilesSet : loc[f] \in Dirs}
NamesUniquePerDir == \A f, g \in FilesSet : (f # g /\ loc[f] \in Dirs /\ loc[f] = loc[g]) => name[f] # name[g]

\* What each Browse entry lists.
Category(c) ==
  IF FixCategories
    THEN CASE c = "Downloads" -> {f \in Present : loc[f] = "Download"}
           [] c = "Images"    -> {f \in Present : Kind[f] = "image"}
           [] c = "Documents" -> {f \in Present : Kind[f] = "pdf"}
           [] c = "Audio"     -> {f \in Present : Kind[f] = "audio"}
    ELSE \* the picker's Recent view, MIME-filtered for Documents and Audio only
         CASE c = "Downloads" -> Present
           [] c = "Images"    -> {f \in Present : Kind[f] = "image"}
           [] c = "Documents" -> {f \in Present : Kind[f] = "pdf"}
           [] c = "Audio"     -> {f \in Present : Kind[f] = "audio"}
Categories == {"Downloads", "Images", "Documents", "Audio"}
Listing(d) == {f \in Present : loc[f] = d}

TypeOK ==
  /\ loc \in [FilesSet -> Dirs \cup {Trash, Gone}]
  /\ origin \in [FilesSet -> Dirs \cup {Gone}]
  /\ name \in [FilesSet -> Names]
  /\ sel \subseteq FilesSet /\ cwd \in Dirs /\ stale \in BOOLEAN /\ budget \in 0..Budget

Init ==
  /\ loc = Home0
  /\ origin = [f \in FilesSet |-> IF Home0[f] = Gone THEN "Documents" ELSE Home0[f]]
  /\ name \in [FilesSet -> 1..2] /\ NamesUniquePerDir
  /\ sel = {} /\ cwd \in Dirs /\ stale = FALSE /\ review = NoReview
  /\ budget = Budget /\ lost = FALSE

----------------------------------------------------------------------------
Navigate(d) == cwd # d /\ cwd' = d /\ sel' = {} /\ UNCHANGED <<loc, origin, name, stale, review, budget, lost>>

\* The renderer cannot know about an external change before Android reports it, so actions
\* are not guarded by ~stale. A selected file that is gone is skipped ("missing" outcome).
Toggle(f) ==
  /\ f \in Listing(cwd)
  /\ sel' = IF f \in sel THEN sel \ {f} ELSE sel \cup {f}
  /\ UNCHANGED <<loc, origin, name, cwd, stale, review, budget, lost>>

Clash(f, d) == \E g \in Present : g # f /\ loc[g] = d /\ name[g] = name[f]
FreeName(f, d) == CHOOSE k \in Names : \A g \in Present : (g # f /\ loc[g] = d) => name[g] # k

\* Moving one file. With FixConflict a clash is resolved by keeping both
\* (rename to a free "name (1)"); as written, a same-named file is replaced.
MoveOne(f, d) ==
  /\ loc[f] \in Dirs /\ loc[f] # d
  /\ IF Clash(f, d) /\ ~FixConflict
       THEN /\ loc' = [g \in FilesSet |-> IF g = f THEN d
                        ELSE IF loc[g] = d /\ name[g] = name[f] THEN Gone ELSE loc[g]]
            /\ lost' = TRUE /\ UNCHANGED name
       ELSE /\ loc' = [loc EXCEPT ![f] = d]
            /\ name' = IF Clash(f, d) THEN [name EXCEPT ![f] = FreeName(f, d)] ELSE name
            /\ UNCHANGED lost
  /\ origin' = [origin EXCEPT ![f] = d]

MoveSel(d) ==
  /\ Cardinality(sel) = 1 /\ d # cwd
  /\ \E f \in sel : IF loc[f] = cwd THEN MoveOne(f, d)
                      ELSE UNCHANGED <<loc, origin, name, lost>>   \* gone: "missing", nothing moves
  /\ sel' = {}
  /\ UNCHANGED <<cwd, stale, review, budget>>

TrashSel ==
  /\ sel # {}
  /\ loc' = [f \in FilesSet |-> IF f \in sel /\ loc[f] = cwd THEN Trash ELSE loc[f]]
  /\ origin' = [f \in FilesSet |-> IF f \in sel /\ loc[f] = cwd THEN loc[f] ELSE origin[f]]
  /\ sel' = {}
  /\ UNCHANGED <<name, cwd, stale, review, budget, lost>>

Restore(f) ==
  /\ loc[f] = Trash
  /\ IF Clash(f, origin[f])
       THEN name' = [name EXCEPT ![f] = FreeName(f, origin[f])]
       ELSE UNCHANGED name
  /\ loc' = [loc EXCEPT ![f] = origin[f]]
  /\ UNCHANGED <<origin, sel, cwd, stale, review, budget, lost>>

EmptyTrash(f) ==   \* after the confirmation sheet
  /\ loc[f] = Trash /\ loc' = [loc EXCEPT ![f] = Gone]
  /\ UNCHANGED <<origin, name, sel, cwd, stale, review, budget, lost>>

\* The camera, a download, or another app adds or removes a file.
External(f) ==
  /\ budget > 0 /\ budget' = budget - 1
  \* Creation: the filesystem itself never allows two equal names in one folder
  \* (Android picks "name (1)"), so the writer gets a free name on a clash.
  /\ \/ /\ loc[f] = Gone /\ origin[f] # Gone /\ loc' = [loc EXCEPT ![f] = origin[f]]
        /\ name' = IF Clash(f, origin[f]) THEN [name EXCEPT ![f] = FreeName(f, origin[f])] ELSE name
     \/ /\ loc[f] \in Dirs /\ loc' = [loc EXCEPT ![f] = Gone] /\ UNCHANGED name
  /\ stale' = TRUE
  /\ UNCHANGED <<sel, origin, cwd, review, lost>>   \* the listing learns of it at Refresh

\* Reload on Android's change event: the listing and the selection catch up (stale rows pruned).
Refresh == stale /\ stale' = FALSE /\ sel' = sel \cap Listing(cwd)
           /\ UNCHANGED <<loc, origin, name, cwd, review, budget, lost>>

AgentPropose(f, d) ==
  /\ review = NoReview /\ loc[f] \in Dirs /\ loc[f] # d
  /\ review' = [f |-> f, from |-> loc[f], to |-> d]
  /\ UNCHANGED <<loc, origin, name, sel, cwd, stale, budget, lost>>

AgentApply ==
  /\ review # NoReview /\ loc[review.f] = review.from
  /\ MoveOne(review.f, review.to)
  /\ review' = NoReview /\ sel' = sel \ {review.f}
  /\ UNCHANGED <<cwd, stale, budget>>

AgentReject ==
  /\ review # NoReview /\ review' = NoReview
  /\ UNCHANGED <<loc, origin, name, sel, cwd, stale, budget, lost>>

Next ==
  \/ \E d \in Dirs : Navigate(d) \/ MoveSel(d)
  \/ \E f \in FilesSet : Toggle(f) \/ Restore(f) \/ EmptyTrash(f) \/ External(f)
       \/ \E d \in Dirs : AgentPropose(f, d)
  \/ TrashSel \/ Refresh \/ AgentApply \/ AgentReject

Spec == Init /\ [][Next]_vars /\ WF_vars(Refresh) /\ WF_vars(AgentApply \/ AgentReject)

----------------------------------------------------------------------------
\* Each Browse entry lists exactly what its name says: Downloads is the
\* Download folder, so a camera photo is never in it.
CategoryIsQuery ==
  /\ Category("Downloads") = {f \in Present : loc[f] = "Download"}
  /\ \A c \in Categories \ {"Downloads"} : Category(c) \subseteq Present
NoOverwriteWithoutConfirm == ~lost
\* Once the listing has caught up, every selected row exists in the open folder.
SelectionExists == ~stale => sel \subseteq Listing(cwd)
\* Selection actions touch only files that are really in the open folder.
SelectionActsOnlyOnPresent == [][TrashSel => \A f \in FilesSet : (loc'[f] = Trash /\ loc[f] # Trash) => loc[f] = cwd]_vars
TrashReversible == \A f \in FilesSet : loc[f] = Trash => origin[f] \in Dirs
\* An approved agent move applies only to the file where the user saw it.
AgentMoveOnlyReviewed == [][AgentApply => loc[review.f] = review.from]_vars
ListingsConverge == stale ~> ~stale
ReviewSettles == (review # NoReview) ~> (review = NoReview)
====
