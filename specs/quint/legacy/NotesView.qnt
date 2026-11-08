// Faithful translation of the view-refresh notes-view TLA+ model
// (design/view-refresh-2026-11/tla/notes-view/Spec.tla at 4cad393df4).
// Notes view: unlimited voice recording with segmented audio and streaming transcription, folders
// (create, rename, delete), Recently deleted, and reviewed agent moves.
//
// Live partial text shown while recording (on-device streaming ASR) is display only: it is never
// saved and is not part of `asr`, so it cannot affect TranscriptPrefixOfAudio.
//
// Notes has two sources on mainline (docs/architecture.md): the device-local collection and agent
// notes. Both follow this model, with two differences outside its state: Done into agent notes
// saves the transcript (`asr`) and length only, since agent notes keep no audio, and so is refused
// (the recording stays) until asr = recorded; and in agent notes a deleted folder's stored
// reference is not rewritten but reads as None, so FolderRefsValid holds for the noteFolder the view
// shows (noteFolderOf). Neither changes a modelled transition.
//
// Storage merge, drafts and the write-ahead trash are checked by the notes-merge model; this
// module models the view and recorder on top of that store and assumes its guarantees (a committed
// write is durable).
//
// Code modelled: apps/app/src/prototype/voice-adapter.ts (VA), android .../AlphaVoiceCloudPlugin.java,
// notes-trash-adapter.ts. Proposal: design/view-refresh-2026-11/PLAN.md section 3.
//
// Audio is counted in segments (a segment is ~30 s of audio). MaxSeg bounds the model only; with
// FixUnlimited the product has no limit. Fix* = false is the code as written; true is the proposed
// design.
//
// `shown` is whether Notes is on screen. The renderer transcribes segments only while it is
// (note-recorder.ts pump; a hidden WebView is not relied on), so with AsrWhileHidden = false (the
// code) the transcript keeps up while Notes is shown and catches up when it is shown again; a
// recording made with the screen off is transcribed then. TranscriptKeepsUp and AsrSettles claim
// exactly that; AsBuilt_Hidden shows the unconditional claim (TranscriptKeepsUpHidden) does not hold.
// FixRestoreFolder is a design ablation: the code has no folders yet, so false shows the rule is
// needed, not that today's code breaks it.
//
// Translation notes: the TLA+ CONSTANTS are immutable fields of s chosen by one initializer per
// configuration. Model values become strings: Notes = {"n1", "n2"}, Folders = {"f1", "f2"},
// None = "None", names "a", "b", "c".
module NotesView {
  type Review = { n: str, f: str, r: int }
  type State = {
    FixUnlimited: bool,     // no duration cap for notes (VA:289,510; plugin :82,483)
    FixSegments: bool,      // audio is finalized per segment, so a crash keeps it
    FixStreamAsr: bool,     // transcription follows the recording segment by segment
    FixRestoreFolder: bool, // restore falls back to "no folder" if the folder is gone
    AsrWhileHidden: bool,   // segments are transcribed while Notes is hidden too
    MaxSeg: int, CapSeg: int, // model bound; the code's cap (29 s = 1 segment)
    Budget: int,            // disruptions: process deaths, storage-full, folder deletes
    Names: Set[str],        // folder names
    rec: str,               // "idle" | "recording" | "paused" | "saved"
    recorded: int,          // segments captured so far in this recording
    durable: int,           // segments that would survive process death now
    asr: int,               // segments transcribed
    stopCause: str,         // "none" | "user" | "cap" | "storage" | "death"
    folders: Set[str],      // existing folders
    folderName: str -> str, // Folders -> Names (a folder keeps its id when renamed)
    noteFolder: str -> str, // Notes -> Folders \cup {None}
    live: Set[str],         // notes not in Recently deleted
    trash: Set[str],        // notes in Recently deleted
    rev: str -> int,        // note revision (for reviewed agent moves)
    review: Review,         // pending agent move [n, f, r] or NoReview
    budget: int,
    shown: bool             // Notes is on screen
  }
  type TransitionHistory = { CrashKeepsAudio: bool, RenameKeepsMembership: bool, AgentMoveOnlyReviewed: bool }
  var s: State
  var history: TransitionHistory
  val vars = (s, history)
  pure val Notes = Set("n1", "n2")
  pure val Folders = Set("f1", "f2")
  pure val None = "None"
  pure val MaxRev = 2
  pure val NoReview: Review = { n: None, f: None, r: 0 }
  pure val FolderTargets = Folders.union(Set(None))

  val TypeOK = Set("idle", "recording", "paused", "saved").contains(s.rec)
    and s.recorded >= 0 and s.recorded <= s.MaxSeg and s.durable >= 0 and s.durable <= s.MaxSeg
    and s.asr >= 0 and s.asr <= s.MaxSeg
    and Set("none", "user", "cap", "storage", "death").contains(s.stopCause)
    and s.folders.subseteq(Folders)
    and s.folderName.keys() == Folders and Folders.forall(f => s.Names.contains(s.folderName.get(f)))
    and s.noteFolder.keys() == Notes and Notes.forall(n => FolderTargets.contains(s.noteFolder.get(n)))
    and s.live.subseteq(Notes) and s.trash.subseteq(Notes) and s.live.intersect(s.trash) == Set()
    and s.rev.keys() == Notes and Notes.forall(n => s.rev.get(n) >= 0 and s.rev.get(n) <= MaxRev)
    and s.budget >= 0 and s.budget <= s.Budget

  type Config = { FixUnlimited: bool, FixSegments: bool, FixStreamAsr: bool, FixRestoreFolder: bool,
    AsrWhileHidden: bool, MaxSeg: int, CapSeg: int, Budget: int, Names: Set[str] }
  pure val DesignConfig: Config = { FixUnlimited: true, FixSegments: true, FixStreamAsr: true, FixRestoreFolder: true,
    AsrWhileHidden: false, MaxSeg: 3, CapSeg: 1, Budget: 2, Names: Set("a", "b") }  // Design.cfg, AsBuilt_Hidden.cfg
  pure val AsBuiltCapConfig: Config = { ...DesignConfig, FixUnlimited: false }           // AsBuilt_Cap.cfg
  pure val AsBuiltSegmentsConfig: Config = { ...DesignConfig, FixSegments: false }        // AsBuilt_Segments.cfg
  pure val AsBuiltStreamAsrConfig: Config = { ...DesignConfig, FixStreamAsr: false }      // AsBuilt_StreamAsr.cfg
  pure val AblateRestoreFolderConfig: Config = { ...DesignConfig, FixRestoreFolder: false } // Ablate_RestoreFolder.cfg
  pure val RenameConfig: Config = { ...DesignConfig, MaxSeg: 1, Budget: 1, Names: Set("a", "b", "c") } // Rename.cfg

  // folderName \in {m \in [Folders -> Names] : \A f, g \in Folders : f # g => m[f] # m[g]}
  pure def injectiveNames(names: Set[str]): Set[str -> str] = Folders.setOfMaps(names)
    .filter(m => Folders.forall(f => Folders.forall(g => f != g implies m.get(f) != m.get(g))))
  pure val NoteFolderChoices: Set[str -> str] = Notes.setOfMaps(FolderTargets)

  pure def initialState(c: Config, folderName: str -> str, noteFolder: str -> str): State = {
    FixUnlimited: c.FixUnlimited, FixSegments: c.FixSegments, FixStreamAsr: c.FixStreamAsr,
    FixRestoreFolder: c.FixRestoreFolder, AsrWhileHidden: c.AsrWhileHidden,
    MaxSeg: c.MaxSeg, CapSeg: c.CapSeg, Budget: c.Budget, Names: c.Names,
    rec: "idle", recorded: 0, durable: 0, asr: 0, stopCause: "none",
    folders: Folders, folderName: folderName, noteFolder: noteFolder,
    live: Notes, trash: Set(), rev: Notes.mapBy(n => 0),
    review: NoReview, budget: c.Budget, shown: true }

  pure def bump(rev: str -> int, n: str): str -> int = rev.set(n, if (rev.get(n) < MaxRev) rev.get(n) + 1 else rev.get(n))

  // ---------------------------------------------------------------------------
  // Relations for the actions named by action properties.
  pure def death(x: State): State = { ...x, budget: x.budget - 1, rec: "saved", recorded: x.durable,
    stopCause: "death", asr: if (x.asr > x.durable) x.durable else x.asr }
  pure def ProcessDeathRelation(before: State, after: State): bool =
    Set("recording", "paused").contains(before.rec) and before.budget > 0 and after == death(before)
  pure def renamed(x: State, f: str, nm: str): State = { ...x, folderName: x.folderName.set(f, nm) }
  pure def renameEnabled(x: State, f: str, nm: str): bool = x.folders.contains(f) and x.folderName.get(f) != nm
    and x.folders.exclude(Set(f)).forall(g => x.folderName.get(g) != nm)
  pure def RenameFolderRelation(before: State, after: State, f: str, nm: str): bool =
    renameEnabled(before, f, nm) and after == renamed(before, f, nm)
  pure def reviewCurrent(x: State): bool = x.review != NoReview and x.live.contains(x.review.n)
    and x.folders.union(Set(None)).contains(x.review.f) and x.rev.get(x.review.n) == x.review.r
  pure def applied(x: State): State = { ...x, noteFolder: x.noteFolder.set(x.review.n, x.review.f),
    rev: bump(x.rev, x.review.n), review: NoReview }
  pure def AgentApplyRelation(before: State, after: State): bool = reviewCurrent(before) and after == applied(before)

  // Persistent monitors for the original action properties [][A]_vars.
  pure val initialChecks = { CrashKeepsAudio: true, RenameKeepsMembership: true, AgentMoveOnlyReviewed: true }
  // CrashKeepsAudio == [][ProcessDeath => durable >= recorded - (IF recorded > 0 THEN 1 ELSE 0)]_vars
  pure def CrashKeepsAudioRelation(before: State, after: State): bool = before == after or
    (ProcessDeathRelation(before, after) implies before.durable >= before.recorded - (if (before.recorded > 0) 1 else 0))
  // RenameKeepsMembership == [][\A f \in Folders, nm \in Names : RenameFolder(f, nm) => UNCHANGED <<noteFolder, live, trash>>]_vars
  pure def RenameKeepsMembershipRelation(before: State, after: State): bool = before == after or
    Folders.forall(f => before.Names.forall(nm => RenameFolderRelation(before, after, f, nm) implies
      (after.noteFolder == before.noteFolder and after.live == before.live and after.trash == before.trash)))
  // AgentMoveOnlyReviewed == [][AgentApply => rev[review.n] = review.r]_vars
  pure def AgentMoveOnlyReviewedRelation(before: State, after: State): bool = before == after or
    (AgentApplyRelation(before, after) implies before.rev.get(before.review.n) == before.review.r)
  action Track(after: State): bool = all {
    s' = after,
    history' = {
      CrashKeepsAudio: history.CrashKeepsAudio and CrashKeepsAudioRelation(s, after),
      RenameKeepsMembership: history.RenameKeepsMembership and RenameKeepsMembershipRelation(s, after),
      AgentMoveOnlyReviewed: history.AgentMoveOnlyReviewed and AgentMoveOnlyReviewedRelation(s, after) }
  }
  val CrashKeepsAudioInvariant = history.CrashKeepsAudio
  val RenameKeepsMembershipInvariant = history.RenameKeepsMembership
  val AgentMoveOnlyReviewedInvariant = history.AgentMoveOnlyReviewed

  // Initializers, one per TLA+ configuration (AsBuilt_Hidden.cfg uses Design constants: checkerInit).
  action StartState(c: Config, folderName: str -> str, noteFolder: str -> str): bool = all {
    s' = initialState(c, folderName, noteFolder), history' = initialChecks }
  action checkerInit = {
    nondet folderName = injectiveNames(DesignConfig.Names).oneOf()
    nondet noteFolder = NoteFolderChoices.oneOf()
    all { s' = initialState(DesignConfig, folderName, noteFolder), history' = initialChecks } }
  action checkerAsBuiltCapInit = {
    nondet folderName = injectiveNames(AsBuiltCapConfig.Names).oneOf()
    nondet noteFolder = NoteFolderChoices.oneOf()
    all { s' = initialState(AsBuiltCapConfig, folderName, noteFolder), history' = initialChecks } }
  action checkerAsBuiltSegmentsInit = {
    nondet folderName = injectiveNames(AsBuiltSegmentsConfig.Names).oneOf()
    nondet noteFolder = NoteFolderChoices.oneOf()
    all { s' = initialState(AsBuiltSegmentsConfig, folderName, noteFolder), history' = initialChecks } }
  action checkerAsBuiltStreamAsrInit = {
    nondet folderName = injectiveNames(AsBuiltStreamAsrConfig.Names).oneOf()
    nondet noteFolder = NoteFolderChoices.oneOf()
    all { s' = initialState(AsBuiltStreamAsrConfig, folderName, noteFolder), history' = initialChecks } }
  action checkerAblateRestoreFolderInit = {
    nondet folderName = injectiveNames(AblateRestoreFolderConfig.Names).oneOf()
    nondet noteFolder = NoteFolderChoices.oneOf()
    all { s' = initialState(AblateRestoreFolderConfig, folderName, noteFolder), history' = initialChecks } }
  action checkerRenameInit = {
    nondet folderName = injectiveNames(RenameConfig.Names).oneOf()
    nondet noteFolder = NoteFolderChoices.oneOf()
    all { s' = initialState(RenameConfig, folderName, noteFolder), history' = initialChecks } }
  action init = {
    nondet folderName = injectiveNames(DesignConfig.Names).oneOf()
    nondet noteFolder = NoteFolderChoices.oneOf()
    StartState(DesignConfig, folderName, noteFolder) }

  // ---------------------------------------------------------------------------
  // Recorder
  action Record = all { Set("idle", "saved").contains(s.rec),
    Track({ ...s, rec: "recording", recorded: 0, durable: 0, asr: 0, stopCause: "none" }) }

  // One more segment of audio. Without segmenting, nothing is durable until Stop: an m4a with no
  // moov atom cannot be read after a crash.
  action Segment = all { s.rec == "recording", s.recorded < s.MaxSeg,
    if (not(s.FixUnlimited) and s.recorded + 1 >= s.CapSeg)
      Track({ ...s, recorded: s.recorded + 1, rec: "saved", stopCause: "cap", durable: s.recorded + 1 })
    else
      Track({ ...s, recorded: s.recorded + 1, durable: if (s.FixSegments) s.recorded + 1 else s.durable }) }

  action Pause = all { s.rec == "recording", Track({ ...s, rec: "paused" }) }
  action Resume = all { s.rec == "paused", Track({ ...s, rec: "recording" }) }

  action Stop = all { Set("recording", "paused").contains(s.rec),
    Track({ ...s, rec: "saved", durable: s.recorded, stopCause: "user" }) }

  action StorageFull = all { s.rec == "recording", s.budget > 0,
    Track({ ...s, budget: s.budget - 1, rec: "saved", durable: s.recorded, stopCause: "storage" }) }

  action ProcessDeath = all { Set("recording", "paused").contains(s.rec), s.budget > 0, Track(death(s)) }

  // Streaming ASR transcribes any durable segment while recording; as written, transcription
  // starts only once the recording is saved.
  val AsrSegmentEnabled = s.asr < s.durable and (s.FixStreamAsr or s.rec == "saved") and (s.shown or s.AsrWhileHidden)
  action AsrSegment = all { AsrSegmentEnabled, Track({ ...s, asr: s.asr + 1 }) }

  // Notes leaves the screen (screen off, another view) or comes back; recording goes on.
  action Hide = all { s.shown, Track({ ...s, shown: false }) }
  action Show = all { not(s.shown), Track({ ...s, shown: true }) }

  // ---------------------------------------------------------------------------
  // Folders, Recently deleted, agent moves
  action MoveToFolder(n: str, f: str): bool = all {
    s.live.contains(n), s.folders.union(Set(None)).contains(f), s.noteFolder.get(n) != f,
    Track({ ...s, noteFolder: s.noteFolder.set(n, f), rev: bump(s.rev, n) }) }

  // Deleting a folder moves its live notes to "no folder"; it never trashes them.
  action DeleteFolder(f: str): bool = all { s.folders.contains(f), s.budget > 0,
    Track({ ...s, budget: s.budget - 1, folders: s.folders.exclude(Set(f)),
      noteFolder: Notes.mapBy(n => if (s.live.contains(n) and s.noteFolder.get(n) == f) None else s.noteFolder.get(n)),
      rev: Notes.mapBy(n => if (s.live.contains(n) and s.noteFolder.get(n) == f and s.rev.get(n) < MaxRev)
        s.rev.get(n) + 1 else s.rev.get(n)) }) }

  // Rename keeps the folder's id; a name another folder uses is refused (renameNotesFolder).
  action RenameFolder(f: str, nm: str): bool = all { renameEnabled(s, f, nm), Track(renamed(s, f, nm)) }

  action TrashNote(n: str): bool = all { s.live.contains(n),
    Track({ ...s, live: s.live.exclude(Set(n)), trash: s.trash.union(Set(n)), rev: bump(s.rev, n) }) }

  action Restore(n: str): bool = all { s.trash.contains(n),
    Track({ ...s, trash: s.trash.exclude(Set(n)), live: s.live.union(Set(n)), rev: bump(s.rev, n),
      noteFolder: if (s.FixRestoreFolder and not(s.folders.union(Set(None)).contains(s.noteFolder.get(n))))
        s.noteFolder.set(n, None) else s.noteFolder }) }

  // retention elapsed, or "Delete now" / "Empty" after confirmation
  action Expire(n: str): bool = all { s.trash.contains(n), Track({ ...s, trash: s.trash.exclude(Set(n)) }) }

  // As implemented (notes_move): the target is an existing folder, or None ("no folder").
  action AgentProposeMove(n: str, f: str): bool = all { s.review == NoReview, s.live.contains(n),
    s.folders.union(Set(None)).contains(f), s.noteFolder.get(n) != f,
    Track({ ...s, review: { n: n, f: f, r: s.rev.get(n) } }) }

  val ReviewCurrent = reviewCurrent(s)
  action AgentApply = all { ReviewCurrent, Track(applied(s)) }
  action AgentReject = all { s.review != NoReview, Track({ ...s, review: NoReview }) }
  action AgentSettle = any { AgentApply, AgentReject }

  action Next = any {
    Record, Segment, Pause, Resume, Stop, StorageFull, ProcessDeath, AsrSegment, Hide, Show,
    { nondet n = Notes.oneOf()
      any { TrashNote(n), Restore(n), Expire(n),
        { nondet f = FolderTargets.oneOf(); any { MoveToFolder(n, f), AgentProposeMove(n, f) } } } },
    { nondet f = Folders.oneOf()
      any { DeleteFolder(f), { nondet nm = s.Names.oneOf(); RenameFolder(f, nm) } } },
    AgentApply, AgentReject }
  action step = any { Next, Track(s) }

  // WF_vars(AsrSegment) /\ WF_vars(AgentApply \/ AgentReject)
  temporal Fairness = AsrSegment.weakFair(s) and AgentSettle.weakFair(s)
  val Initial = history == initialChecks and TypeOK and s.folders == Folders
    and Set(DesignConfig, AsBuiltCapConfig, AsBuiltSegmentsConfig, AsBuiltStreamAsrConfig, AblateRestoreFolderConfig, RenameConfig)
      .exists(c => injectiveNames(c.Names).exists(m => NoteFolderChoices.exists(nf => s == initialState(c, m, nf))))
  temporal Spec = (Initial and s.FixUnlimited and s.FixSegments and s.FixStreamAsr and s.FixRestoreFolder)
    and always(Next.orKeep(vars)) and Fairness

  // ---------------------------------------------------------------------------
  // Only the user, low storage or a crash ends a recording; never a duration cap.
  val NoLengthLimit = s.stopCause != "cap"
  // After a crash, the audio recorded up to the last finished segment is kept.
  temporal CrashKeepsAudio = always(history.CrashKeepsAudio)
  val TranscriptPrefixOfAudio = s.asr <= s.durable
  val Transcribing = s.shown or s.AsrWhileHidden
  // While recording, finished segments get transcribed without waiting for Stop, while Notes is
  // shown (with AsrWhileHidden, also while hidden).
  temporal TranscriptKeepsUp = leadsTo(s.rec == "recording" and s.asr < s.durable and Transcribing,
    s.asr == s.durable or s.rec != "recording" or not(Transcribing))
  // The unconditional claim: holds only with AsrWhileHidden (AsBuilt_Hidden shows the gap).
  temporal TranscriptKeepsUpHidden = leadsTo(s.rec == "recording" and s.asr < s.durable,
    s.asr == s.durable or s.rec != "recording")
  val FolderNamesUnique = s.folders.forall(f => s.folders.forall(g => f != g implies s.folderName.get(f) != s.folderName.get(g)))
  // Renaming a folder never changes which notes are in it, or whether a note is live.
  temporal RenameKeepsMembership = always(history.RenameKeepsMembership)
  val FolderRefsValid = s.live.forall(n => s.folders.union(Set(None)).contains(s.noteFolder.get(n)))
  temporal AgentMoveOnlyReviewed = always(history.AgentMoveOnlyReviewed)
  temporal AsrSettles = leadsTo(s.rec == "saved" and s.asr < s.durable and Transcribing,
    s.asr == s.durable or s.rec != "saved" or not(Transcribing))
  temporal ReviewSettles = leadsTo(s.review != NoReview, s.review == NoReview)

  temporal CheckedCrashKeepsAudio = Fairness implies CrashKeepsAudio
  temporal CheckedAgentMoveOnlyReviewed = Fairness implies AgentMoveOnlyReviewed
  temporal CheckedRenameKeepsMembership = Fairness implies RenameKeepsMembership
  temporal CheckedTranscriptKeepsUp = Fairness implies TranscriptKeepsUp
  temporal CheckedTranscriptKeepsUpHidden = Fairness implies TranscriptKeepsUpHidden
  temporal CheckedAsrSettles = Fairness implies AsrSettles
  temporal CheckedReviewSettles = Fairness implies ReviewSettles
  // Design.cfg and Rename.cfg PROPERTY lists.
  temporal CheckedTemporal = Fairness implies (CrashKeepsAudio and AgentMoveOnlyReviewed
    and RenameKeepsMembership and TranscriptKeepsUp and AsrSettles and ReviewSettles)

  // Design.cfg and Rename.cfg INVARIANT lists plus the action-property monitors.
  val safety = TypeOK and NoLengthLimit and TranscriptPrefixOfAudio and FolderRefsValid and FolderNamesUnique
    and CrashKeepsAudioInvariant and RenameKeepsMembershipInvariant and AgentMoveOnlyReviewedInvariant

  // ---------------------------------------------------------------------------
  // Scenarios
  pure val names0 = Map("f1" -> "a", "f2" -> "b")
  pure val inF1 = Map("n1" -> "f1", "n2" -> "None")
  run designLongRecordingTest = StartState(DesignConfig, names0, inF1)
    .then(Record).then(Segment).then(AsrSegment).then(Segment).then(Segment)
    .expect(s.rec == "recording" and s.recorded == 3 and s.durable == 3 and s.asr == 1 and safety)
    .then(ProcessDeath).expect(s.recorded == 3 and s.stopCause == "death" and safety)
  run designHiddenCatchUpTest = StartState(DesignConfig, names0, inF1)
    .then(Record).then(Hide).then(Segment).expect(s.asr == 0 and safety)
    .then(Show).then(AsrSegment).expect(s.asr == 1 and safety)
  run designFolderTest = StartState(DesignConfig, names0, inF1)
    .expect(not(renameEnabled(s, "f2", "a"))).then(TrashNote("n1"))
    .then(DeleteFolder("f1")).then(Restore("n1")).expect(s.noteFolder.get("n1") == None and safety)
  run designRenameTest = StartState(RenameConfig, names0, inF1)
    .then(RenameFolder("f1", "c")).expect(s.folderName.get("f1") == "c" and s.noteFolder == inF1 and safety)
  run designStaleReviewTest = StartState(DesignConfig, names0, inF1)
    .then(AgentProposeMove("n1", "f2")).then(MoveToFolder("n1", None)).expect(not(ReviewCurrent))
    .then(AgentReject).expect(s.noteFolder.get("n1") == None and safety)
  run asBuiltCapTest = StartState(AsBuiltCapConfig, names0, inF1)
    .then(Record).then(Segment).expect(s.stopCause == "cap" and not(NoLengthLimit))
  run asBuiltSegmentsTest = StartState(AsBuiltSegmentsConfig, names0, inF1)
    .then(Record).then(Segment).then(Segment).then(ProcessDeath)
    .expect(s.recorded == 0 and not(CrashKeepsAudioInvariant))
  run asBuiltStreamAsrTest = StartState(AsBuiltStreamAsrConfig, names0, inF1)
    .then(Record).then(Segment).expect(s.asr < s.durable and s.rec == "recording")
    .expect(not(AsrSegmentEnabled)).then(Segment).expect(not(AsrSegmentEnabled) and s.asr == 0)
  run ablateRestoreFolderTest = StartState(AblateRestoreFolderConfig, names0, inF1)
    .then(TrashNote("n1")).then(DeleteFolder("f1")).then(Restore("n1")).expect(not(FolderRefsValid))
  run asBuiltHiddenTest = StartState(DesignConfig, names0, inF1)
    .then(Record).then(Segment).then(Hide).expect(not(AsrSegmentEnabled))
    .then(Segment).expect(s.rec == "recording" and s.asr < s.durable and not(AsrSegmentEnabled))
}
