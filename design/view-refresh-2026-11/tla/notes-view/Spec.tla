---- MODULE Spec ----
(***************************************************************************)
(* Alpha Phone Notes view: unlimited voice recording with segmented audio  *)
(* and streaming transcription, folders (create, rename, delete), Recently *)
(* deleted, and reviewed agent moves.                                      *)
(*                                                                         *)
(* Live partial text shown while recording (on-device streaming ASR) is    *)
(* display only: it is never saved and is not part of `asr`, so it cannot  *)
(* affect TranscriptPrefixOfAudio.                                         *)
(*                                                                         *)
(* Notes has two sources on mainline (docs/architecture.md): the         *)
(* device-local collection and agent notes. Both follow this model, with  *)
(* two differences outside its state: Done into agent notes saves the     *)
(* transcript (`asr`) and length only, since agent notes keep no audio,    *)
(* and so is refused (the recording stays) until asr = recorded;          *)
(* and in agent notes a deleted folder's stored reference is not rewritten *)
(* but reads as None, so FolderRefsValid holds for the noteFolder the view *)
(* shows (noteFolderOf). Neither changes a modelled transition.            *)
(*                                                                         *)
(* Storage merge, drafts and the write-ahead trash are already checked in  *)
(* ../notes-merge/Spec.tla; this module models the view and recorder on    *)
(* top of that store and assumes its guarantees (a committed write is      *)
(* durable).                                                               *)
(*                                                                         *)
(* Code modelled: apps/app/src/prototype/voice-adapter.ts (VA),            *)
(* android .../AlphaVoiceCloudPlugin.java, notes-trash-adapter.ts.         *)
(* Proposal: design/view-refresh-2026-11/PLAN.md section 3.                *)
(*                                                                         *)
(* Audio is counted in segments (a segment is ~30 s of audio). MaxSeg      *)
(* bounds the model only; with FixUnlimited the product has no limit.      *)
(* Fix* = FALSE is the code as written; TRUE is the proposed design.       *)
(*                                                                         *)
(* `shown` is whether Notes is on screen. The renderer transcribes         *)
(* segments only while it is (note-recorder.ts pump; a hidden WebView is   *)
(* not relied on), so with AsrWhileHidden = FALSE (the code) the           *)
(* transcript keeps up while Notes is shown and catches up when it is      *)
(* shown again; a recording made with the screen off is transcribed then.  *)
(* TranscriptKeepsUp and AsrSettles claim exactly that; AsBuilt_Hidden     *)
(* shows the unconditional claim (TranscriptKeepsUpHidden) does not hold.  *)
(* FixRestoreFolder is a design ablation: the code has no folders yet, so  *)
(* FALSE shows the rule is needed, not that today's code breaks it.        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Notes, Folders,  \* model values
          Names,           \* folder names
          None,            \* "no folder"
          MaxSeg, CapSeg,  \* model bound; the code's cap (29 s = 1 segment)
          Budget,          \* disruptions: process deaths, storage-full, folder deletes
          FixUnlimited,    \* no duration cap for notes (VA:289,510; plugin :82,483)
          FixSegments,     \* audio is finalized per segment, so a crash keeps it
          FixStreamAsr,    \* transcription follows the recording segment by segment
          FixRestoreFolder, \* restore falls back to "no folder" if the folder is gone
          AsrWhileHidden   \* segments are transcribed while Notes is hidden too

VARIABLES rec,        \* "idle" | "recording" | "paused" | "saved"
          recorded,   \* segments captured so far in this recording
          durable,    \* segments that would survive process death now
          asr,        \* segments transcribed
          stopCause,  \* "none" | "user" | "cap" | "storage" | "death"
          folders,    \* existing folders
          folderName, \* Folders -> Names (a folder keeps its id when renamed)
          noteFolder, \* Notes -> Folders \cup {None}
          live,       \* notes not in Recently deleted
          trash,      \* notes in Recently deleted
          rev,        \* note revision (for reviewed agent moves)
          review,     \* pending agent move [n, f, r] or NoReview
          budget,
          shown       \* Notes is on screen

vars == <<rec, recorded, durable, asr, stopCause, folders, folderName, noteFolder, live, trash, rev, review, budget, shown>>
MaxRev == 2
NoReview == [n |-> None, f |-> None, r |-> 0]

TypeOK ==
  /\ rec \in {"idle", "recording", "paused", "saved"}
  /\ recorded \in 0..MaxSeg /\ durable \in 0..MaxSeg /\ asr \in 0..MaxSeg
  /\ stopCause \in {"none", "user", "cap", "storage", "death"}
  /\ folders \subseteq Folders
  /\ folderName \in [Folders -> Names]
  /\ noteFolder \in [Notes -> Folders \cup {None}]
  /\ live \subseteq Notes /\ trash \subseteq Notes /\ live \cap trash = {}
  /\ rev \in [Notes -> 0..MaxRev] /\ budget \in 0..Budget
  /\ shown \in BOOLEAN

Init ==
  /\ rec = "idle" /\ recorded = 0 /\ durable = 0 /\ asr = 0 /\ stopCause = "none"
  /\ folders = Folders
  /\ folderName \in {m \in [Folders -> Names] : \A f, g \in Folders : f # g => m[f] # m[g]}
  /\ noteFolder \in [Notes -> Folders \cup {None}]
  /\ live = Notes /\ trash = {} /\ rev = [n \in Notes |-> 0]
  /\ review = NoReview /\ budget = Budget /\ shown = TRUE

NoteVars == <<folders, folderName, noteFolder, live, trash, rev, review, shown>>
\* `shown` is in both, so every action but Hide and Show leaves it unchanged.
RecVars  == <<rec, recorded, durable, asr, stopCause, shown>>
Bump(n) == rev' = [rev EXCEPT ![n] = IF @ < MaxRev THEN @ + 1 ELSE @]

----------------------------------------------------------------------------
(* Recorder *)
Record ==
  /\ rec \in {"idle", "saved"}
  /\ rec' = "recording" /\ recorded' = 0 /\ durable' = 0 /\ asr' = 0 /\ stopCause' = "none"
  /\ UNCHANGED NoteVars /\ UNCHANGED budget

\* One more segment of audio. Without segmenting, nothing is durable until Stop:
\* an m4a with no moov atom cannot be read after a crash.
Segment ==
  /\ rec = "recording" /\ recorded < MaxSeg
  /\ IF ~FixUnlimited /\ recorded + 1 >= CapSeg
       THEN /\ recorded' = recorded + 1 /\ rec' = "saved" /\ stopCause' = "cap"
            /\ durable' = recorded + 1
       ELSE /\ recorded' = recorded + 1 /\ UNCHANGED <<rec, stopCause>>
            /\ durable' = IF FixSegments THEN recorded + 1 ELSE durable
  /\ UNCHANGED asr /\ UNCHANGED NoteVars /\ UNCHANGED budget

Pause  == rec = "recording" /\ rec' = "paused" /\ UNCHANGED <<recorded, durable, asr, stopCause>> /\ UNCHANGED NoteVars /\ UNCHANGED budget
Resume == rec = "paused" /\ rec' = "recording" /\ UNCHANGED <<recorded, durable, asr, stopCause>> /\ UNCHANGED NoteVars /\ UNCHANGED budget

Stop ==
  /\ rec \in {"recording", "paused"}
  /\ rec' = "saved" /\ durable' = recorded /\ stopCause' = "user"
  /\ UNCHANGED <<recorded, asr>> /\ UNCHANGED NoteVars /\ UNCHANGED budget

StorageFull ==
  /\ rec = "recording" /\ budget > 0 /\ budget' = budget - 1
  /\ rec' = "saved" /\ durable' = recorded /\ stopCause' = "storage"
  /\ UNCHANGED <<recorded, asr>> /\ UNCHANGED NoteVars

ProcessDeath ==
  /\ rec \in {"recording", "paused"} /\ budget > 0 /\ budget' = budget - 1
  /\ rec' = "saved" /\ recorded' = durable /\ stopCause' = "death"
  /\ asr' = IF asr > durable THEN durable ELSE asr
  /\ UNCHANGED durable /\ UNCHANGED NoteVars

\* Streaming ASR transcribes any durable segment while recording; as written,
\* transcription starts only once the recording is saved.
AsrSegment ==
  /\ asr < durable
  /\ FixStreamAsr \/ rec = "saved"
  /\ shown \/ AsrWhileHidden
  /\ asr' = asr + 1
  /\ UNCHANGED <<rec, recorded, durable, stopCause>> /\ UNCHANGED NoteVars /\ UNCHANGED budget

\* Notes leaves the screen (screen off, another view) or comes back; recording goes on.
Hide == shown /\ shown' = FALSE /\ UNCHANGED <<folders, folderName, noteFolder, live, trash, rev, review, rec, recorded, durable, asr, stopCause, budget>>
Show == ~shown /\ shown' = TRUE /\ UNCHANGED <<folders, folderName, noteFolder, live, trash, rev, review, rec, recorded, durable, asr, stopCause, budget>>

----------------------------------------------------------------------------
(* Folders, Recently deleted, agent moves *)
MoveToFolder(n, f) ==
  /\ n \in live /\ f \in folders \cup {None} /\ noteFolder[n] # f
  /\ noteFolder' = [noteFolder EXCEPT ![n] = f] /\ Bump(n)
  /\ UNCHANGED <<folders, folderName, live, trash, review>> /\ UNCHANGED RecVars /\ UNCHANGED budget

\* Deleting a folder moves its live notes to "no folder"; it never trashes them.
DeleteFolder(f) ==
  /\ f \in folders /\ budget > 0 /\ budget' = budget - 1
  /\ folders' = folders \ {f}
  /\ noteFolder' = [n \in Notes |-> IF n \in live /\ noteFolder[n] = f THEN None ELSE noteFolder[n]]
  /\ rev' = [n \in Notes |-> IF n \in live /\ noteFolder[n] = f /\ rev[n] < MaxRev THEN rev[n] + 1 ELSE rev[n]]
  /\ UNCHANGED <<folderName, live, trash, review>> /\ UNCHANGED RecVars

\* Rename keeps the folder's id; a name another folder uses is refused (renameNotesFolder).
RenameFolder(f, nm) ==
  /\ f \in folders /\ folderName[f] # nm
  /\ \A g \in folders \ {f} : folderName[g] # nm
  /\ folderName' = [folderName EXCEPT ![f] = nm]
  /\ UNCHANGED <<folders, noteFolder, live, trash, rev, review>> /\ UNCHANGED RecVars /\ UNCHANGED budget

TrashNote(n) ==
  /\ n \in live
  /\ live' = live \ {n} /\ trash' = trash \cup {n} /\ Bump(n)
  /\ UNCHANGED <<folders, folderName, noteFolder, review>> /\ UNCHANGED RecVars /\ UNCHANGED budget

Restore(n) ==
  /\ n \in trash
  /\ trash' = trash \ {n} /\ live' = live \cup {n} /\ Bump(n)
  /\ noteFolder' = IF FixRestoreFolder /\ noteFolder[n] \notin folders
                     THEN [noteFolder EXCEPT ![n] = None] ELSE noteFolder
  /\ UNCHANGED <<folders, folderName, review>> /\ UNCHANGED RecVars /\ UNCHANGED budget

Expire(n) ==   \* retention elapsed, or "Delete now" / "Empty" after confirmation
  /\ n \in trash
  /\ trash' = trash \ {n}
  /\ UNCHANGED <<folders, folderName, noteFolder, live, rev, review>> /\ UNCHANGED RecVars /\ UNCHANGED budget

AgentProposeMove(n, f) ==
  \* As implemented (notes_move): the target is an existing folder, or None ("no folder").
  /\ review = NoReview /\ n \in live /\ f \in folders \cup {None} /\ noteFolder[n] # f
  /\ review' = [n |-> n, f |-> f, r |-> rev[n]]
  /\ UNCHANGED <<folders, folderName, noteFolder, live, trash, rev>> /\ UNCHANGED RecVars /\ UNCHANGED budget

ReviewCurrent ==
  /\ review # NoReview /\ review.n \in live /\ review.f \in folders \cup {None} /\ rev[review.n] = review.r

AgentApply ==
  /\ ReviewCurrent
  /\ noteFolder' = [noteFolder EXCEPT ![review.n] = review.f] /\ Bump(review.n)
  /\ review' = NoReview
  /\ UNCHANGED <<folders, folderName, live, trash>> /\ UNCHANGED RecVars /\ UNCHANGED budget

AgentReject ==
  /\ review # NoReview /\ review' = NoReview
  /\ UNCHANGED <<folders, folderName, noteFolder, live, trash, rev>> /\ UNCHANGED RecVars /\ UNCHANGED budget

Next ==
  \/ Record \/ Segment \/ Pause \/ Resume \/ Stop \/ StorageFull \/ ProcessDeath \/ AsrSegment
  \/ Hide \/ Show
  \/ \E n \in Notes : TrashNote(n) \/ Restore(n) \/ Expire(n)
       \/ \E f \in Folders \cup {None} : MoveToFolder(n, f) \/ AgentProposeMove(n, f)
  \/ \E f \in Folders : DeleteFolder(f) \/ \E nm \in Names : RenameFolder(f, nm)
  \/ AgentApply \/ AgentReject

Spec == Init /\ [][Next]_vars /\ WF_vars(AsrSegment) /\ WF_vars(AgentApply \/ AgentReject)

----------------------------------------------------------------------------
\* Only the user, low storage or a crash ends a recording; never a duration cap.
NoLengthLimit == stopCause # "cap"
\* After a crash, the audio recorded up to the last finished segment is kept.
CrashKeepsAudio ==
  [][ProcessDeath => durable >= recorded - (IF recorded > 0 THEN 1 ELSE 0)]_vars
TranscriptPrefixOfAudio == asr <= durable
\* While recording, finished segments get transcribed without waiting for Stop, while Notes is
\* shown (with AsrWhileHidden, also while hidden).
TranscriptKeepsUp ==
  (rec = "recording" /\ asr < durable /\ (shown \/ AsrWhileHidden)) ~> (asr = durable \/ rec # "recording" \/ ~(shown \/ AsrWhileHidden))
\* The unconditional claim: holds only with AsrWhileHidden (AsBuilt_Hidden shows the gap).
TranscriptKeepsUpHidden == (rec = "recording" /\ asr < durable) ~> (asr = durable \/ rec # "recording")
FolderNamesUnique == \A f, g \in folders : f # g => folderName[f] # folderName[g]
\* Renaming a folder never changes which notes are in it, or whether a note is live.
RenameKeepsMembership ==
  [][\A f \in Folders, nm \in Names : RenameFolder(f, nm) => UNCHANGED <<noteFolder, live, trash>>]_vars
FolderRefsValid == \A n \in live : noteFolder[n] \in folders \cup {None}
AgentMoveOnlyReviewed ==
  [][AgentApply => rev[review.n] = review.r]_vars
AsrSettles ==
  (rec = "saved" /\ asr < durable /\ (shown \/ AsrWhileHidden)) ~> (asr = durable \/ rec # "saved" \/ ~(shown \/ AsrWhileHidden))
ReviewSettles == (review # NoReview) ~> (review = NoReview)
====
