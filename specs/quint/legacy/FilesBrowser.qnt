// Literal translation of files-browser/Spec.tla and its four TLC configurations.
// FreeName realizes TLA CHOOSE with the lowest free numeric name (TLC's ordering).
module FilesBrowser {
  type Configuration = { name: str, Budget: int, FixCategories: bool, FixConflict: bool, FixIdentity: bool }
  type Review = { f: str, from: str, to: str, ver: int }
  type State = { config: Configuration, loc: str -> str, origin: str -> str, name: str -> int,
    sel: Set[str], cwd: str, stale: bool, ver: str -> int, review: Review, budget: int, lost: bool }
  type History = { SelectionActsOnlyOnPresent: bool, AgentMoveOnlyReviewed: bool }
  var s: State
  var history: History
  val vars = (s, history)
  pure val FilesSet = Set("photo", "pdf", "scan")
  pure val Dirs = Set("Download", "DCIM/Camera", "Documents")
  pure val Gone = "gone"
  pure val Trash = "trash"
  pure val Kind = Map("photo" -> "image", "pdf" -> "pdf", "scan" -> "pdf")
  pure val Home0 = Map("photo" -> "DCIM/Camera", "pdf" -> "Download", "scan" -> Gone)
  pure val Names = 1.to(3)
  pure val NoReview = { f: Gone, from: Gone, to: Gone, ver: 0 }
  pure val Categories = Set("Downloads", "Images", "Documents", "Audio")
  pure val Configurations = Set("Design", "AsBuilt_Categories", "AsBuilt_Identity", "Ablate_Conflict")
  pure def configuration(name) = { name: name, Budget: 1, FixCategories: name != "AsBuilt_Categories",
    FixConflict: name != "Ablate_Conflict", FixIdentity: name != "AsBuilt_Identity" }
  pure def present(before: State): Set[str] = FilesSet.filter(f => Dirs.contains(before.loc.get(f)))
  val Present = present(s)
  pure def listing(before: State, d: str): Set[str] = present(before).filter(f => before.loc.get(f) == d)
  def Listing(d) = listing(s, d)
  pure def namesUnique(before: State): bool = FilesSet.forall(f => FilesSet.forall(g =>
    (f != g and Dirs.contains(before.loc.get(f)) and before.loc.get(f) == before.loc.get(g)) implies before.name.get(f) != before.name.get(g)))
  val NamesUniquePerDir = namesUnique(s)
  def Category(c) = if (c == "Downloads") {
    if (s.config.FixCategories) Present.filter(f => s.loc.get(f) == "Download") else Present
  } else Present.filter(f => Kind.get(f) == (if (c == "Images") "image" else if (c == "Documents") "pdf" else "audio"))
  pure def initialState(configName, names, directory) = { config: configuration(configName), loc: Home0,
    origin: FilesSet.mapBy(f => if (Home0.get(f) == Gone) "Documents" else Home0.get(f)),
    name: names, sel: Set(), cwd: directory, stale: false, ver: FilesSet.mapBy(f => 0),
    review: NoReview, budget: configuration(configName).Budget, lost: false }
  pure val initialHistory = { SelectionActsOnlyOnPresent: true, AgentMoveOnlyReviewed: true }
  action StartState(configName, names, directory) = all { Configurations.contains(configName),
    names.keys() == FilesSet, FilesSet.forall(f => 1.to(2).contains(names.get(f))), Dirs.contains(directory),
    namesUnique(initialState(configName, names, directory)),
    s' = initialState(configName, names, directory), history' = initialHistory }
  action Init(configName) = {
    nondet names = FilesSet.setOfMaps(1.to(2)).oneOf()
    nondet directory = Dirs.oneOf()
    StartState(configName, names, directory)
  }
  // Separate entry points avoid Quint 0.33.1 init/action-helper conversion overlap.
  action checkerInit = {
    nondet names = FilesSet.setOfMaps(1.to(2)).oneOf()
    nondet directory = Dirs.oneOf()
    all { namesUnique(initialState("Design", names, directory)),
      s' = initialState("Design", names, directory), history' = initialHistory }
  }
  action checkerAsBuilt_CategoriesInit = {
    nondet names = FilesSet.setOfMaps(1.to(2)).oneOf()
    nondet directory = Dirs.oneOf()
    all { namesUnique(initialState("AsBuilt_Categories", names, directory)),
      s' = initialState("AsBuilt_Categories", names, directory), history' = initialHistory }
  }
  action checkerAsBuilt_IdentityInit = {
    nondet names = FilesSet.setOfMaps(1.to(2)).oneOf()
    nondet directory = Dirs.oneOf()
    all { namesUnique(initialState("AsBuilt_Identity", names, directory)),
      s' = initialState("AsBuilt_Identity", names, directory), history' = initialHistory }
  }
  action checkerAblate_ConflictInit = {
    nondet names = FilesSet.setOfMaps(1.to(2)).oneOf()
    nondet directory = Dirs.oneOf()
    all { namesUnique(initialState("Ablate_Conflict", names, directory)),
      s' = initialState("Ablate_Conflict", names, directory), history' = initialHistory }
  }
  action init = Init("Design")
  action AsBuilt_CategoriesInit = Init("AsBuilt_Categories")
  action AsBuilt_IdentityInit = Init("AsBuilt_Identity")
  action Ablate_ConflictInit = Init("Ablate_Conflict")
  pure def clash(before: State, f: str, d: str): bool = present(before).exists(g =>
    g != f and before.loc.get(g) == d and before.name.get(g) == before.name.get(f))
  pure def freeName(before: State, f: str, d: str): int = Names.filter(k => present(before).forall(g =>
    (g != f and before.loc.get(g) == d) implies before.name.get(g) != k)).fold(4, (lowest, k) => if (k < lowest) k else lowest)
  pure def moveEnabled(before: State, f: str, d: str): bool = Dirs.contains(before.loc.get(f)) and before.loc.get(f) != d
  pure def moved(before: State, f: str, d: str): State = {
    val conflict = clash(before, f, d)
    val overwrite = conflict and not(before.config.FixConflict)
    { ...before, loc: FilesSet.mapBy(g => if (g == f) d else
        if (overwrite and before.loc.get(g) == d and before.name.get(g) == before.name.get(f)) Gone else before.loc.get(g)),
      name: if (conflict and not(overwrite)) before.name.set(f, freeName(before, f, d)) else before.name,
      origin: before.origin.set(f, d), lost: before.lost or overwrite }
  }
  pure def trashed(before: State): State = { ...before,
    loc: FilesSet.mapBy(f => if (before.sel.contains(f) and before.loc.get(f) == before.cwd) Trash else before.loc.get(f)),
    origin: FilesSet.mapBy(f => if (before.sel.contains(f) and before.loc.get(f) == before.cwd) before.loc.get(f) else before.origin.get(f)), sel: Set() }
  pure def reviewed(before: State): bool = before.loc.get(before.review.f) == before.review.from
    and (before.config.FixIdentity implies before.ver.get(before.review.f) == before.review.ver)
  pure def applyEnabled(before: State): bool = before.review != NoReview and reviewed(before)
    and moveEnabled(before, before.review.f, before.review.to)
  pure def applied(before: State): State = { ...moved(before, before.review.f, before.review.to),
    review: NoReview, sel: before.sel.exclude(Set(before.review.f)) }
  pure def SelectionActsOnlyOnPresentRelation(before: State, after: State): bool =
    (before.sel != Set() and after == trashed(before)) implies FilesSet.forall(f =>
      (after.loc.get(f) == Trash and before.loc.get(f) != Trash) implies before.loc.get(f) == before.cwd)
  pure def AgentMoveOnlyReviewedRelation(before: State, after: State): bool =
    (applyEnabled(before) and after == applied(before)) implies
      (before.loc.get(before.review.f) == before.review.from and before.ver.get(before.review.f) == before.review.ver)
  action Track(after: State): bool = all { s' = after, history' = {
    SelectionActsOnlyOnPresent: history.SelectionActsOnlyOnPresent and SelectionActsOnlyOnPresentRelation(s, after),
    AgentMoveOnlyReviewed: history.AgentMoveOnlyReviewed and AgentMoveOnlyReviewedRelation(s, after) } }
  action Navigate(d) = all { s.cwd != d, Track({ ...s, cwd: d, sel: Set() }) }
  action Toggle(f) = all { Listing(s.cwd).contains(f), Track({ ...s,
    sel: if (s.sel.contains(f)) s.sel.exclude(Set(f)) else s.sel.union(Set(f)) }) }
  action MoveOne(f, d) = all { moveEnabled(s, f, d), Track(moved(s, f, d)) }
  action MoveSel(d) = {
    nondet f = s.sel.oneOf()
    all { s.sel.size() == 1, d != s.cwd,
      if (s.loc.get(f) == s.cwd) all { moveEnabled(s, f, d), Track({ ...moved(s, f, d), sel: Set() }) }
      else Track({ ...s, sel: Set() }) }
  }
  action TrashSel = all { s.sel != Set(), Track(trashed(s)) }
  action Restore(f) = all { s.loc.get(f) == Trash, Track({ ...s,
    name: if (clash(s, f, s.origin.get(f))) s.name.set(f, freeName(s, f, s.origin.get(f))) else s.name,
    loc: s.loc.set(f, s.origin.get(f)) }) }
  action EmptyTrash(f) = all { s.loc.get(f) == Trash, Track({ ...s, loc: s.loc.set(f, Gone) }) }
  action External(f) = all { s.budget > 0, any {
    all { s.loc.get(f) == Gone, s.origin.get(f) != Gone, Track({ ...s, budget: s.budget - 1, stale: true,
      loc: s.loc.set(f, s.origin.get(f)), name: if (clash(s, f, s.origin.get(f))) s.name.set(f, freeName(s, f, s.origin.get(f))) else s.name,
      ver: s.ver.set(f, s.ver.get(f) + 1) }) },
    all { Dirs.contains(s.loc.get(f)), Track({ ...s, budget: s.budget - 1, stale: true, loc: s.loc.set(f, Gone) }) },
    all { Dirs.contains(s.loc.get(f)), Track({ ...s, budget: s.budget - 1, stale: true, ver: s.ver.set(f, s.ver.get(f) + 1) }) }
  } }
  action Refresh = all { s.stale, Track({ ...s, stale: false, sel: s.sel.intersect(Listing(s.cwd)) }) }
  action AgentPropose(f, d) = all { s.review == NoReview, Dirs.contains(s.loc.get(f)), s.loc.get(f) != d,
    Track({ ...s, review: { f: f, from: s.loc.get(f), to: d, ver: s.ver.get(f) } }) }
  val Reviewed = reviewed(s)
  action AgentApply = all { applyEnabled(s), Track(applied(s)) }
  action AgentRefused = all { s.review != NoReview, not(Reviewed), Track({ ...s, review: NoReview }) }
  action AgentReject = all { s.review != NoReview, Track({ ...s, review: NoReview }) }
  action Next = { nondet d = Dirs.oneOf()
    nondet f = FilesSet.oneOf()
    any { Navigate(d), MoveSel(d), Toggle(f), Restore(f), EmptyTrash(f), External(f), AgentPropose(f, d),
      TrashSel, Refresh, AgentApply, AgentRefused, AgentReject } }
  action step = any { Next, Track(s) }
  val TypeOK = Configurations.contains(s.config.name) and s.config == configuration(s.config.name)
    and s.loc.keys() == FilesSet and FilesSet.forall(f => Dirs.union(Set(Trash, Gone)).contains(s.loc.get(f)))
    and s.origin.keys() == FilesSet and FilesSet.forall(f => Dirs.union(Set(Gone)).contains(s.origin.get(f)))
    and s.name.keys() == FilesSet and FilesSet.forall(f => Names.contains(s.name.get(f)))
    and s.sel.subseteq(FilesSet) and Dirs.contains(s.cwd) and 0.to(s.config.Budget).contains(s.budget)
    and s.ver.keys() == FilesSet and FilesSet.forall(f => 0.to(s.config.Budget).contains(s.ver.get(f)))
  val CategoryIsQuery = Category("Downloads") == Present.filter(f => s.loc.get(f) == "Download")
    and Categories.exclude(Set("Downloads")).forall(c => Category(c).subseteq(Present))
  val NoOverwriteWithoutConfirm = not(s.lost)
  val SelectionExists = not(s.stale) implies s.sel.subseteq(Listing(s.cwd))
  val TrashReversible = FilesSet.forall(f => s.loc.get(f) == Trash implies Dirs.contains(s.origin.get(f)))
  val stateSafety = TypeOK and CategoryIsQuery and NoOverwriteWithoutConfirm and NamesUniquePerDir and SelectionExists and TrashReversible
  val safety = TypeOK and CategoryIsQuery and NoOverwriteWithoutConfirm and NamesUniquePerDir and SelectionExists
    and TrashReversible and history.SelectionActsOnlyOnPresent and history.AgentMoveOnlyReviewed
  val Initial = Configurations.contains(s.config.name) and s.name.keys() == FilesSet
    and FilesSet.forall(f => 1.to(2).contains(s.name.get(f))) and Dirs.contains(s.cwd) and NamesUniquePerDir
    and s == initialState(s.config.name, s.name, s.cwd) and history == initialHistory
  temporal Fairness = Refresh.weakFair(s) and (AgentApply or AgentRefused or AgentReject).weakFair(s)
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  temporal SelectionActsOnlyOnPresent = always(history.SelectionActsOnlyOnPresent)
  temporal AgentMoveOnlyReviewed = always(history.AgentMoveOnlyReviewed)
  temporal ListingsConverge = leadsTo(s.stale, not(s.stale))
  temporal ReviewSettles = leadsTo(s.review != NoReview, s.review == NoReview)
  temporal CheckedSelectionActsOnlyOnPresent = Fairness implies SelectionActsOnlyOnPresent
  temporal CheckedAgentMoveOnlyReviewed = Fairness implies AgentMoveOnlyReviewed
  temporal CheckedListingsConverge = Fairness implies ListingsConverge
  temporal CheckedReviewSettles = Fairness implies ReviewSettles
  temporal CheckedTemporal = Fairness implies (SelectionActsOnlyOnPresent and AgentMoveOnlyReviewed and ListingsConverge and ReviewSettles)
  temporal CheckedConfiguredTemporal = CheckedTemporal
  pure val testNames = Map("photo" -> 1, "pdf" -> 1, "scan" -> 2)
  action TestInit(configName) = StartState(configName, testNames, "DCIM/Camera")
  // Deterministic branches of the original External action aid reproducible traces.
  action Rewrite(f) = all { s.budget > 0, Dirs.contains(s.loc.get(f)), Track({ ...s,
    budget: s.budget - 1, stale: true, ver: s.ver.set(f, s.ver.get(f) + 1) }) }
  action Remove(f) = all { s.budget > 0, Dirs.contains(s.loc.get(f)), Track({ ...s,
    budget: s.budget - 1, stale: true, loc: s.loc.set(f, Gone) }) }
  run designConflictTest = TestInit("Design").then(Toggle("photo")).then(MoveSel("Download"))
    .expect(s.loc.get("photo") == "Download" and s.name.get("photo") == 2 and safety)
  run missingSelectionTest = TestInit("Design").then(Toggle("photo")).then(Remove("photo")).then(TrashSel)
    .expect(s.loc.get("photo") == Gone and s.sel == Set() and safety)
  run staleReviewTest = TestInit("Design").then(AgentPropose("photo", "Download")).then(Rewrite("photo"))
    .then(AgentRefused).then(Refresh).expect(s.loc.get("photo") == "DCIM/Camera" and safety)
  run restoreConflictTest = TestInit("Design").then(Toggle("photo")).then(TrashSel).then(Restore("photo"))
    .expect(s.loc.get("photo") == "DCIM/Camera" and safety)
  run asBuiltCategoriesTest = TestInit("AsBuilt_Categories").expect(not(CategoryIsQuery))
  run ablateConflictTest = TestInit("Ablate_Conflict").then(Toggle("photo")).then(MoveSel("Download"))
    .expect(not(NoOverwriteWithoutConfirm) and s.loc.get("pdf") == Gone)
  run asBuiltIdentityTest = TestInit("AsBuilt_Identity").then(AgentPropose("photo", "Download"))
    .then(Rewrite("photo")).then(AgentApply).expect(not(history.AgentMoveOnlyReviewed))
  run ablateSelectedTargetTest = TestInit("Ablate_Conflict").then(Navigate("Download")).then(Toggle("pdf"))
    .then(AgentPropose("photo", "Download")).then(AgentApply)
    .expect(s.sel == Set("pdf") and s.loc.get("pdf") == Gone and not(SelectionExists))

}
