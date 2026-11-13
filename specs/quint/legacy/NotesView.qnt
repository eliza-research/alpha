// Literal translation of the historical notes-view/Spec.tla and all seven configurations.
// String values represent the former uninterpreted TLA model values without changing equality.
module NotesView {
  type Configuration = { name: str, MaxSeg: int, CapSeg: int, Budget: int, Names: Set[str],
    FixUnlimited: bool, FixSegments: bool, FixStreamAsr: bool, FixRestoreFolder: bool, AsrWhileHidden: bool }
  type Review = { n: str, f: str, r: int }
  type State = { config: Configuration, rec: str, recorded: int, durable: int, asr: int, stopCause: str,
    folders: Set[str], folderName: str -> str, noteFolder: str -> str, live: Set[str], trash: Set[str],
    rev: str -> int, review: Review, budget: int, shown: bool }
  type History = { CrashKeepsAudio: bool, RenameKeepsMembership: bool, AgentMoveOnlyReviewed: bool }
  var s: State
  var history: History
  val vars = (s, history)
  pure val Notes = Set("n1", "n2")
  pure val Folders = Set("f1", "f2")
  pure val None = "None"
  pure val MaxRev = 2
  pure val NoReview = { n: None, f: None, r: 0 }
  pure val Configurations = Set("Design", "Rename", "AsBuilt_Cap", "AsBuilt_Segments",
    "AsBuilt_StreamAsr", "AsBuilt_Hidden", "Ablate_RestoreFolder")
  pure def configuration(name) = { name: name, MaxSeg: if (name == "Rename") 1 else 3,
    CapSeg: 1, Budget: if (name == "Rename") 1 else 2,
    Names: if (name == "Rename") Set("a", "b", "c") else Set("a", "b"),
    FixUnlimited: name != "AsBuilt_Cap", FixSegments: name != "AsBuilt_Segments",
    FixStreamAsr: name != "AsBuilt_StreamAsr", FixRestoreFolder: name != "Ablate_RestoreFolder",
    AsrWhileHidden: false }
  pure def uniqueNames(folders, names) = folders.forall(f => folders.forall(g => f != g implies names.get(f) != names.get(g)))
  pure def initialState(name, names, assignments) = { config: configuration(name), rec: "idle",
    recorded: 0, durable: 0, asr: 0, stopCause: "none", folders: Folders,
    folderName: names, noteFolder: assignments, live: Notes, trash: Set(),
    rev: Notes.mapBy(n => 0), review: NoReview, budget: configuration(name).Budget, shown: true }
  pure val initialHistory = { CrashKeepsAudio: true, RenameKeepsMembership: true, AgentMoveOnlyReviewed: true }
  action StartState(name, names, assignments) = all { Configurations.contains(name),
    names.keys() == Folders, Folders.forall(f => configuration(name).Names.contains(names.get(f))), uniqueNames(Folders, names),
    assignments.keys() == Notes, Notes.forall(n => Folders.union(Set(None)).contains(assignments.get(n))),
    s' = initialState(name, names, assignments), history' = initialHistory }
  action Init(name) = {
    nondet names = Folders.setOfMaps(configuration(name).Names).oneOf()
    nondet assignments = Notes.setOfMaps(Folders.union(Set(None))).oneOf()
    StartState(name, names, assignments)
  }
  // Separate entry points avoid Quint 0.33.1 init/action-helper conversion overlap.
  action checkerInit = {
    nondet names = Folders.setOfMaps(configuration("Design").Names).oneOf()
    nondet assignments = Notes.setOfMaps(Folders.union(Set(None))).oneOf()
    all { uniqueNames(Folders, names), s' = initialState("Design", names, assignments), history' = initialHistory }
  }
  action checkerRenameInit = {
    nondet names = Folders.setOfMaps(configuration("Rename").Names).oneOf()
    nondet assignments = Notes.setOfMaps(Folders.union(Set(None))).oneOf()
    all { uniqueNames(Folders, names), s' = initialState("Rename", names, assignments), history' = initialHistory }
  }
  action checkerAsBuilt_CapInit = {
    nondet names = Folders.setOfMaps(configuration("AsBuilt_Cap").Names).oneOf()
    nondet assignments = Notes.setOfMaps(Folders.union(Set(None))).oneOf()
    all { uniqueNames(Folders, names), s' = initialState("AsBuilt_Cap", names, assignments), history' = initialHistory }
  }
  action checkerAsBuilt_SegmentsInit = {
    nondet names = Folders.setOfMaps(configuration("AsBuilt_Segments").Names).oneOf()
    nondet assignments = Notes.setOfMaps(Folders.union(Set(None))).oneOf()
    all { uniqueNames(Folders, names), s' = initialState("AsBuilt_Segments", names, assignments), history' = initialHistory }
  }
  action checkerAsBuilt_StreamAsrInit = {
    nondet names = Folders.setOfMaps(configuration("AsBuilt_StreamAsr").Names).oneOf()
    nondet assignments = Notes.setOfMaps(Folders.union(Set(None))).oneOf()
    all { uniqueNames(Folders, names), s' = initialState("AsBuilt_StreamAsr", names, assignments), history' = initialHistory }
  }
  action checkerAsBuilt_HiddenInit = {
    nondet names = Folders.setOfMaps(configuration("AsBuilt_Hidden").Names).oneOf()
    nondet assignments = Notes.setOfMaps(Folders.union(Set(None))).oneOf()
    all { uniqueNames(Folders, names), s' = initialState("AsBuilt_Hidden", names, assignments), history' = initialHistory }
  }
  action checkerAblate_RestoreFolderInit = {
    nondet names = Folders.setOfMaps(configuration("Ablate_RestoreFolder").Names).oneOf()
    nondet assignments = Notes.setOfMaps(Folders.union(Set(None))).oneOf()
    all { uniqueNames(Folders, names), s' = initialState("Ablate_RestoreFolder", names, assignments), history' = initialHistory }
  }
  action init = Init("Design")
  action RenameInit = Init("Rename")
  action AsBuilt_CapInit = Init("AsBuilt_Cap")
  action AsBuilt_SegmentsInit = Init("AsBuilt_Segments")
  action AsBuilt_StreamAsrInit = Init("AsBuilt_StreamAsr")
  action AsBuilt_HiddenInit = Init("AsBuilt_Hidden")
  action Ablate_RestoreFolderInit = Init("Ablate_RestoreFolder")
  pure def bumped(revisions, n) = revisions.set(n, if (revisions.get(n) < MaxRev) revisions.get(n) + 1 else revisions.get(n))
  pure def processDeathEnabled(before: State): bool = Set("recording", "paused").contains(before.rec) and before.budget > 0
  pure def afterProcessDeath(before: State): State = { ...before, budget: before.budget - 1,
    rec: "saved", recorded: before.durable, stopCause: "death",
    asr: if (before.asr > before.durable) before.durable else before.asr }
  pure def renameEnabled(before: State, f: str, name: str): bool = before.folders.contains(f)
    and before.folderName.get(f) != name
    and before.folders.exclude(Set(f)).forall(g => before.folderName.get(g) != name)
  pure def afterRename(before: State, f: str, name: str): State = { ...before, folderName: before.folderName.set(f, name) }
  pure def reviewCurrent(before: State): bool = before.review != NoReview and before.live.contains(before.review.n)
    and before.folders.union(Set(None)).contains(before.review.f) and before.rev.get(before.review.n) == before.review.r
  pure def afterApply(before: State): State = { ...before,
    noteFolder: before.noteFolder.set(before.review.n, before.review.f), rev: bumped(before.rev, before.review.n), review: NoReview }
  pure def CrashKeepsAudioRelation(before: State, after: State): bool =
    (before.durable >= before.recorded - (if (before.recorded > 0) 1 else 0)) or
      not(processDeathEnabled(before) and after == afterProcessDeath(before))
  pure def RenameKeepsMembershipRelation(before: State, after: State): bool =
    (after.noteFolder == before.noteFolder and after.live == before.live and after.trash == before.trash) or
      Folders.forall(f => before.config.Names.forall(name =>
        not(renameEnabled(before, f, name) and after == afterRename(before, f, name))))
  pure def AgentMoveOnlyReviewedRelation(before: State, after: State): bool =
    (reviewCurrent(before) and after == afterApply(before)) implies before.rev.get(before.review.n) == before.review.r
  action Track(after: State): bool = all { s' = after, history' = {
    CrashKeepsAudio: history.CrashKeepsAudio and CrashKeepsAudioRelation(s, after),
    RenameKeepsMembership: history.RenameKeepsMembership and RenameKeepsMembershipRelation(s, after),
    AgentMoveOnlyReviewed: history.AgentMoveOnlyReviewed and AgentMoveOnlyReviewedRelation(s, after) } }
  action Record = all { Set("idle", "saved").contains(s.rec),
    Track({ ...s, rec: "recording", recorded: 0, durable: 0, asr: 0, stopCause: "none" }) }
  action Segment = all { s.rec == "recording", s.recorded < s.config.MaxSeg,
    if (not(s.config.FixUnlimited) and s.recorded + 1 >= s.config.CapSeg)
      Track({ ...s, recorded: s.recorded + 1, rec: "saved", stopCause: "cap", durable: s.recorded + 1 })
    else Track({ ...s, recorded: s.recorded + 1, durable: if (s.config.FixSegments) s.recorded + 1 else s.durable }) }
  action Pause = all { s.rec == "recording", Track({ ...s, rec: "paused" }) }
  action Resume = all { s.rec == "paused", Track({ ...s, rec: "recording" }) }
  action Stop = all { Set("recording", "paused").contains(s.rec), Track({ ...s, rec: "saved", durable: s.recorded, stopCause: "user" }) }
  action StorageFull = all { s.rec == "recording", s.budget > 0,
    Track({ ...s, budget: s.budget - 1, rec: "saved", durable: s.recorded, stopCause: "storage" }) }
  action ProcessDeath = all { processDeathEnabled(s), Track(afterProcessDeath(s)) }
  action AsrSegment = all { s.asr < s.durable, s.config.FixStreamAsr or s.rec == "saved",
    s.shown or s.config.AsrWhileHidden, Track({ ...s, asr: s.asr + 1 }) }
  action Hide = all { s.shown, Track({ ...s, shown: false }) }
  action Show = all { not(s.shown), Track({ ...s, shown: true }) }
  action MoveToFolder(n, f) = all { s.live.contains(n), s.folders.union(Set(None)).contains(f), s.noteFolder.get(n) != f,
    Track({ ...s, noteFolder: s.noteFolder.set(n, f), rev: bumped(s.rev, n) }) }
  action DeleteFolder(f) = all { s.folders.contains(f), s.budget > 0,
    Track({ ...s, budget: s.budget - 1, folders: s.folders.exclude(Set(f)),
      noteFolder: Notes.mapBy(n => if (s.live.contains(n) and s.noteFolder.get(n) == f) None else s.noteFolder.get(n)),
      rev: Notes.mapBy(n => if (s.live.contains(n) and s.noteFolder.get(n) == f and s.rev.get(n) < MaxRev) s.rev.get(n) + 1 else s.rev.get(n)) }) }
  action RenameFolder(f, name) = all { renameEnabled(s, f, name), Track(afterRename(s, f, name)) }
  action TrashNote(n) = all { s.live.contains(n), Track({ ...s, live: s.live.exclude(Set(n)), trash: s.trash.union(Set(n)), rev: bumped(s.rev, n) }) }
  action Restore(n) = all { s.trash.contains(n), Track({ ...s, trash: s.trash.exclude(Set(n)), live: s.live.union(Set(n)), rev: bumped(s.rev, n),
    noteFolder: if (s.config.FixRestoreFolder and not(s.folders.contains(s.noteFolder.get(n)))) s.noteFolder.set(n, None) else s.noteFolder }) }
  action Expire(n) = all { s.trash.contains(n), Track({ ...s, trash: s.trash.exclude(Set(n)) }) }
  action AgentProposeMove(n, f) = all { s.review == NoReview, s.live.contains(n),
    s.folders.union(Set(None)).contains(f), s.noteFolder.get(n) != f,
    Track({ ...s, review: { n: n, f: f, r: s.rev.get(n) } }) }
  val ReviewCurrent = reviewCurrent(s)
  action AgentApply = all { ReviewCurrent, Track(afterApply(s)) }
  action AgentReject = all { s.review != NoReview, Track({ ...s, review: NoReview }) }
  action Next = any {
    Record, Segment, Pause, Resume, Stop, StorageFull, ProcessDeath, AsrSegment, Hide, Show,
    { nondet n = Notes.oneOf()
      TrashNote(n) },
    { nondet n = Notes.oneOf()
      Restore(n) },
    { nondet n = Notes.oneOf()
      Expire(n) },
    { nondet n = Notes.oneOf()
      nondet f = Folders.union(Set(None)).oneOf()
      MoveToFolder(n, f) },
    { nondet n = Notes.oneOf()
      nondet f = Folders.union(Set(None)).oneOf()
      AgentProposeMove(n, f) },
    { nondet folder = Folders.oneOf()
      DeleteFolder(folder) },
    { nondet folder = Folders.oneOf()
      nondet name = s.config.Names.oneOf()
      RenameFolder(folder, name) },
    AgentApply, AgentReject
  }
  action step = any { Next, Track(s) }
  val TypeOK = Configurations.contains(s.config.name) and s.config == configuration(s.config.name)
    and Set("idle", "recording", "paused", "saved").contains(s.rec)
    and 0.to(s.config.MaxSeg).contains(s.recorded) and 0.to(s.config.MaxSeg).contains(s.durable) and 0.to(s.config.MaxSeg).contains(s.asr)
    and Set("none", "user", "cap", "storage", "death").contains(s.stopCause)
    and s.folders.subseteq(Folders) and s.folderName.keys() == Folders and Folders.forall(f => s.config.Names.contains(s.folderName.get(f)))
    and s.noteFolder.keys() == Notes and Notes.forall(n => Folders.union(Set(None)).contains(s.noteFolder.get(n)))
    and s.live.subseteq(Notes) and s.trash.subseteq(Notes) and s.live.intersect(s.trash) == Set()
    and s.rev.keys() == Notes and Notes.forall(n => 0.to(MaxRev).contains(s.rev.get(n))) and 0.to(s.config.Budget).contains(s.budget)
  val NoLengthLimit = s.stopCause != "cap"
  val TranscriptPrefixOfAudio = s.asr <= s.durable
  val FolderNamesUnique = uniqueNames(s.folders, s.folderName)
  val FolderRefsValid = s.live.forall(n => s.folders.union(Set(None)).contains(s.noteFolder.get(n)))
  val stateSafety = TypeOK and NoLengthLimit and TranscriptPrefixOfAudio and FolderRefsValid and (Set("Design", "Rename", "AsBuilt_Hidden").contains(s.config.name) implies FolderNamesUnique)
  val safety = TypeOK and NoLengthLimit and TranscriptPrefixOfAudio and FolderNamesUnique and FolderRefsValid
    and history.CrashKeepsAudio and history.RenameKeepsMembership and history.AgentMoveOnlyReviewed
  val Initial = Configurations.contains(s.config.name) and uniqueNames(Folders, s.folderName)
    and s.folderName.keys() == Folders and Folders.forall(f => s.config.Names.contains(s.folderName.get(f)))
    and s.noteFolder.keys() == Notes and Notes.forall(n => Folders.union(Set(None)).contains(s.noteFolder.get(n)))
    and s == initialState(s.config.name, s.folderName, s.noteFolder) and history == initialHistory
  temporal Fairness = AsrSegment.weakFair(s) and (AgentApply or AgentReject).weakFair(s)
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  temporal CrashKeepsAudio = always(history.CrashKeepsAudio)
  temporal RenameKeepsMembership = always(history.RenameKeepsMembership)
  temporal AgentMoveOnlyReviewed = always(history.AgentMoveOnlyReviewed)
  temporal TranscriptKeepsUp = leadsTo(s.rec == "recording" and s.asr < s.durable and (s.shown or s.config.AsrWhileHidden),
    s.asr == s.durable or s.rec != "recording" or not(s.shown or s.config.AsrWhileHidden))
  temporal TranscriptKeepsUpHidden = leadsTo(s.rec == "recording" and s.asr < s.durable, s.asr == s.durable or s.rec != "recording")
  temporal AsrSettles = leadsTo(s.rec == "saved" and s.asr < s.durable and (s.shown or s.config.AsrWhileHidden),
    s.asr == s.durable or s.rec != "saved" or not(s.shown or s.config.AsrWhileHidden))
  temporal ReviewSettles = leadsTo(s.review != NoReview, s.review == NoReview)
  temporal CheckedCrashKeepsAudio = Fairness implies CrashKeepsAudio
  temporal CheckedRenameKeepsMembership = Fairness implies RenameKeepsMembership
  temporal CheckedAgentMoveOnlyReviewed = Fairness implies AgentMoveOnlyReviewed
  temporal CheckedTranscriptKeepsUp = Fairness implies TranscriptKeepsUp
  temporal CheckedTranscriptKeepsUpHidden = Fairness implies TranscriptKeepsUpHidden
  temporal CheckedAsrSettles = Fairness implies AsrSettles
  temporal CheckedReviewSettles = Fairness implies ReviewSettles
  temporal CheckedHiddenTemporal = Fairness implies (CrashKeepsAudio and RenameKeepsMembership and AgentMoveOnlyReviewed
    and TranscriptKeepsUpHidden and AsrSettles and ReviewSettles)
  temporal CheckedTemporal = Fairness implies (always(history.CrashKeepsAudio and history.RenameKeepsMembership and history.AgentMoveOnlyReviewed)
    and TranscriptKeepsUp and AsrSettles and ReviewSettles)
  pure val testNames = Map("f1" -> "a", "f2" -> "b")
  pure val testFolders = Map("n1" -> "f1", "n2" -> None)
  action TestInit(name) = StartState(name, testNames, testFolders)
  run recordingTest = TestInit("Design").then(Record).then(Segment).then(AsrSegment).then(Segment)
    .then(ProcessDeath).expect(s.recorded == 2 and s.asr == 1 and safety)
  run hiddenCatchupTest = TestInit("Design").then(Record).then(Hide).then(Segment)
    .expect(s.asr == 0 and safety).then(Show).then(AsrSegment).expect(s.asr == s.durable and safety)
  run restoreFolderTest = TestInit("Design").then(TrashNote("n1")).then(DeleteFolder("f1"))
    .then(Restore("n1")).expect(s.noteFolder.get("n1") == None and safety)
  run renameTest = TestInit("Rename").then(RenameFolder("f1", "c"))
    .expect(s.folderName.get("f1") == "c" and s.noteFolder == testFolders and safety)
  run reviewedMoveTest = TestInit("Design").then(AgentProposeMove("n1", "f2")).then(AgentApply)
    .expect(s.noteFolder.get("n1") == "f2" and safety)
  run asBuiltCapTest = TestInit("AsBuilt_Cap").then(Record).then(Segment).expect(not(NoLengthLimit))
  run asBuiltSegmentsTest = TestInit("AsBuilt_Segments").then(Record).then(Segment).then(Segment)
    .then(ProcessDeath).expect(not(history.CrashKeepsAudio))
  run asBuiltStreamAsrTest = TestInit("AsBuilt_StreamAsr").then(Record).then(Segment)
    .expect(s.rec == "recording" and s.asr < s.durable and not(s.config.FixStreamAsr))
  run asBuiltHiddenTest = TestInit("AsBuilt_Hidden").then(Record).then(Hide).then(Segment)
    .expect(not(s.shown) and s.asr < s.durable and not(s.config.AsrWhileHidden))
  run ablateRestoreFolderTest = TestInit("Ablate_RestoreFolder").then(TrashNote("n1"))
    .then(DeleteFolder("f1")).then(Restore("n1")).expect(not(FolderRefsValid))
}
