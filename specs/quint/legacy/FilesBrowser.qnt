// Faithful translation of the view-refresh files-browser TLA+ model
// (design/view-refresh-2026-11/tla/files-browser/Spec.tla at 59badc34ca, with the reviewed-identity
// revision). Files view: category listings, folder tree, move/copy, trash, external changes and
// reviewed agent moves.
//
// Code modelled: apps/app/src/prototype/files-tree-adapter.ts:15-20,145 (revised: reviewed agent
// moves bind the reviewed file's identity, files-browser-adapter.ts run() and StorageBrowser expect
// checks) and DailyAppsPlugin.java:132-136 (each location opens ACTION_OPEN_DOCUMENT with a MIME
// filter and no initial URI, so the picker lists its own Recent set).
// Proposal: design/view-refresh-2026-11/PLAN.md section 4.
//
// Files are model values with a kind; directories are a fixed set. A file not on the device has
// loc = Gone. Fix* = false is the code as written (FixConflict = false is a design ablation). The
// flags are immutable fields of s: checkerInit is Design.cfg and each other initializer is one cfg.
//
// Translation notes: FreeName's TLA+ CHOOSE over 1..3 is the smallest free name, which is the value
// TLC's CHOOSE returns for an integer interval; the model only needs a deterministic free name.
// Budget = 1 in every configuration.
module FilesBrowser {
  type Review = { f: str, from: str, to: str, ver: int }
  type State = {
    FixCategories: bool, // categories are queries over storage, not the picker's Recent
    FixConflict: bool,   // a move into a folder with the same name asks first (no overwrite)
    FixIdentity: bool,   // a reviewed agent move/trash binds the file's identity (size, mtime) too
    loc: str -> str,     // FilesSet -> Dirs \cup {Trash, Gone}
    origin: str -> str,  // FilesSet -> Dirs: where Restore puts it back
    name: str -> int,    // FilesSet -> Names: a name; equal names in one dir conflict
    sel: Set[str],       // selected files in the open folder
    cwd: str,            // open folder
    stale: bool,         // listing out of date after an external change
    ver: str -> int,     // the file's identity (size, mtime); an edit or a new file at the same
                         // name is a new identity
    review: Review,      // pending agent move [f, from, to, ver] or NoReview
    budget: int,
    lost: bool           // ghost: a file was overwritten without confirmation
  }
  type TransitionHistory = { SelectionActsOnlyOnPresent: bool, AgentMoveOnlyReviewed: bool }
  var s: State
  var history: TransitionHistory
  val vars = (s, history)
  pure val Budget = 1
  pure val FilesSet = Set("photo", "pdf", "scan")
  pure val Dirs = Set("Download", "DCIM/Camera", "Documents")
  pure val Gone = "gone"
  pure val Trash = "trash"
  pure def Kind(f: str): str = if (f == "photo") "image" else "pdf"
  // a camera photo, a downloaded PDF, a scan not yet saved
  pure val Home0: str -> str = Map("photo" -> "DCIM/Camera", "pdf" -> "Download", "scan" -> Gone)
  pure val Names = 1.to(3) // enough for every file to share one folder
  pure val NoReview: Review = { f: Gone, from: Gone, to: Gone, ver: 0 }
  pure val Categories = Set("Downloads", "Images", "Documents", "Audio")

  pure def present(x: State): Set[str] = FilesSet.filter(f => Dirs.contains(x.loc.get(f)))
  pure def namesUniquePerDir(x: State): bool = FilesSet.forall(f => FilesSet.forall(g =>
    (f != g and Dirs.contains(x.loc.get(f)) and x.loc.get(f) == x.loc.get(g)) implies x.name.get(f) != x.name.get(g)))
  pure def listing(x: State, d: str): Set[str] = present(x).filter(f => x.loc.get(f) == d)
  // What each Browse entry lists.
  pure def category(x: State, c: str): Set[str] =
    if (x.FixCategories)
      (if (c == "Downloads") present(x).filter(f => x.loc.get(f) == "Download")
       else if (c == "Images") present(x).filter(f => Kind(f) == "image")
       else if (c == "Documents") present(x).filter(f => Kind(f) == "pdf")
       else present(x).filter(f => Kind(f) == "audio"))
    else // the picker's Recent view, MIME-filtered for Documents and Audio only
      (if (c == "Downloads") present(x)
       else if (c == "Images") present(x).filter(f => Kind(f) == "image")
       else if (c == "Documents") present(x).filter(f => Kind(f) == "pdf")
       else present(x).filter(f => Kind(f) == "audio"))
  val Present = present(s)
  val NamesUniquePerDir = namesUniquePerDir(s)
  def Listing(d: str): Set[str] = listing(s, d)
  def Category(c: str): Set[str] = category(s, c)

  val TypeOK = s.loc.keys() == FilesSet and FilesSet.forall(f => Dirs.union(Set(Trash, Gone)).contains(s.loc.get(f)))
    and s.origin.keys() == FilesSet and FilesSet.forall(f => Dirs.union(Set(Gone)).contains(s.origin.get(f)))
    and s.name.keys() == FilesSet and FilesSet.forall(f => Names.contains(s.name.get(f)))
    and s.sel.subseteq(FilesSet) and Dirs.contains(s.cwd) and s.budget >= 0 and s.budget <= Budget
    and s.ver.keys() == FilesSet and FilesSet.forall(f => s.ver.get(f) >= 0 and s.ver.get(f) <= Budget)

  pure def initialState(fixCategories: bool, fixConflict: bool, fixIdentity: bool, name: str -> int, cwd: str): State = {
    FixCategories: fixCategories, FixConflict: fixConflict, FixIdentity: fixIdentity,
    loc: Home0, origin: FilesSet.mapBy(f => if (Home0.get(f) == Gone) "Documents" else Home0.get(f)),
    name: name, sel: Set(), cwd: cwd, stale: false, review: NoReview,
    ver: FilesSet.mapBy(f => 0), budget: Budget, lost: false }
  // name \in [FilesSet -> 1..2] /\ NamesUniquePerDir (over Home0; every such map qualifies, but the
  // filter is kept as written)
  pure val InitialNames: Set[str -> int] = FilesSet.setOfMaps(1.to(2)).filter(m => FilesSet.forall(f => FilesSet.forall(g =>
    (f != g and Dirs.contains(Home0.get(f)) and Home0.get(f) == Home0.get(g)) implies m.get(f) != m.get(g))))

  pure def clash(x: State, f: str, d: str): bool = present(x).exists(g => g != f and x.loc.get(g) == d and x.name.get(g) == x.name.get(f))
  pure def freeName(x: State, f: str, d: str): int = {
    val free = Names.filter(k => present(x).forall(g => (g != f and x.loc.get(g) == d) implies x.name.get(g) != k))
    free.fold(4, (m, k) => if (k < m) k else m)
  }

  // Moving one file. With FixConflict a clash is resolved by keeping both (rename to a free
  // "name (1)"); as written, a same-named file is replaced. moveOk is MoveOne's guard.
  pure def moveOk(x: State, f: str, d: str): bool = Dirs.contains(x.loc.get(f)) and x.loc.get(f) != d
  pure def moveOne(x: State, f: str, d: str): State =
    if (clash(x, f, d) and not(x.FixConflict))
      { ...x, loc: FilesSet.mapBy(g => if (g == f) d
              else if (x.loc.get(g) == d and x.name.get(g) == x.name.get(f)) Gone else x.loc.get(g)),
        lost: true, origin: x.origin.set(f, d) }
    else
      { ...x, loc: x.loc.set(f, d),
        name: if (clash(x, f, d)) x.name.set(f, freeName(x, f, d)) else x.name,
        origin: x.origin.set(f, d) }

  pure def trashSel(x: State): State = { ...x,
    loc: FilesSet.mapBy(f => if (x.sel.contains(f) and x.loc.get(f) == x.cwd) Trash else x.loc.get(f)),
    origin: FilesSet.mapBy(f => if (x.sel.contains(f) and x.loc.get(f) == x.cwd) x.loc.get(f) else x.origin.get(f)),
    sel: Set() }
  pure def TrashSelRelation(before: State, after: State): bool = before.sel != Set() and after == trashSel(before)

  // Native applies the reviewed move only to the file the owner reviewed: still where it was and
  // (FixIdentity) with the same size and mtime. Otherwise it refuses and changes nothing.
  pure def reviewed(x: State): bool = x.loc.get(x.review.f) == x.review.from
    and (x.FixIdentity implies x.ver.get(x.review.f) == x.review.ver)
  pure def agentApplied(x: State): State = { ...moveOne(x, x.review.f, x.review.to),
    review: NoReview, sel: x.sel.exclude(Set(x.review.f)) }
  pure def AgentApplyRelation(before: State, after: State): bool = before.review != NoReview and reviewed(before)
    and moveOk(before, before.review.f, before.review.to) and after == agentApplied(before)

  // Persistent monitors for the original action properties [][A]_vars.
  pure val initialChecks = { SelectionActsOnlyOnPresent: true, AgentMoveOnlyReviewed: true }
  // SelectionActsOnlyOnPresent == [][TrashSel => \A f \in FilesSet : (loc'[f] = Trash /\ loc[f] # Trash) => loc[f] = cwd]_vars
  pure def SelectionActsOnlyOnPresentRelation(before: State, after: State): bool = before == after or
    (TrashSelRelation(before, after) implies FilesSet.forall(f =>
      (after.loc.get(f) == Trash and before.loc.get(f) != Trash) implies before.loc.get(f) == before.cwd))
  // AgentMoveOnlyReviewed == [][AgentApply => loc[review.f] = review.from /\ ver[review.f] = review.ver]_vars
  pure def AgentMoveOnlyReviewedRelation(before: State, after: State): bool = before == after or
    (AgentApplyRelation(before, after) implies
      (before.loc.get(before.review.f) == before.review.from and before.ver.get(before.review.f) == before.review.ver))
  action Track(after: State): bool = all {
    s' = after,
    history' = {
      SelectionActsOnlyOnPresent: history.SelectionActsOnlyOnPresent and SelectionActsOnlyOnPresentRelation(s, after),
      AgentMoveOnlyReviewed: history.AgentMoveOnlyReviewed and AgentMoveOnlyReviewedRelation(s, after) }
  }
  val SelectionActsOnlyOnPresentInvariant = history.SelectionActsOnlyOnPresent
  val AgentMoveOnlyReviewedInvariant = history.AgentMoveOnlyReviewed

  action StartState(fixCategories: bool, fixConflict: bool, fixIdentity: bool, name: str -> int, cwd: str): bool = all {
    s' = initialState(fixCategories, fixConflict, fixIdentity, name, cwd), history' = initialChecks }
  action checkerInit = { nondet name = InitialNames.oneOf()                 // Design.cfg
    nondet cwd = Dirs.oneOf()
    all { s' = initialState(true, true, true, name, cwd), history' = initialChecks } }
  action checkerAblateConflictInit = { nondet name = InitialNames.oneOf()   // Ablate_Conflict.cfg
    nondet cwd = Dirs.oneOf()
    all { s' = initialState(true, false, true, name, cwd), history' = initialChecks } }
  action checkerAsBuiltCategoriesInit = { nondet name = InitialNames.oneOf() // AsBuilt_Categories.cfg
    nondet cwd = Dirs.oneOf()
    all { s' = initialState(false, true, true, name, cwd), history' = initialChecks } }
  action checkerAsBuiltIdentityInit = { nondet name = InitialNames.oneOf()  // AsBuilt_Identity.cfg
    nondet cwd = Dirs.oneOf()
    all { s' = initialState(true, true, false, name, cwd), history' = initialChecks } }
  action init = { nondet name = InitialNames.oneOf(); nondet cwd = Dirs.oneOf(); StartState(true, true, true, name, cwd) }

  // ---------------------------------------------------------------------------
  action Navigate(d: str): bool = all { s.cwd != d, Track({ ...s, cwd: d, sel: Set() }) }

  // The renderer cannot know about an external change before Android reports it, so actions are
  // not guarded by ~stale. A selected file that is gone is skipped ("missing" outcome).
  action Toggle(f: str): bool = all { Listing(s.cwd).contains(f),
    Track({ ...s, sel: if (s.sel.contains(f)) s.sel.exclude(Set(f)) else s.sel.union(Set(f)) }) }

  action MoveSel(d: str): bool = all { s.sel.size() == 1, d != s.cwd,
    nondet f = s.sel.oneOf()
    if (s.loc.get(f) == s.cwd) all { moveOk(s, f, d), Track({ ...moveOne(s, f, d), sel: Set() }) }
    else Track({ ...s, sel: Set() }) } // gone: "missing", nothing moves

  action TrashSel = all { s.sel != Set(), Track(trashSel(s)) }

  action Restore(f: str): bool = all { s.loc.get(f) == Trash,
    Track({ ...s, loc: s.loc.set(f, s.origin.get(f)),
      name: if (clash(s, f, s.origin.get(f))) s.name.set(f, freeName(s, f, s.origin.get(f))) else s.name }) }

  action EmptyTrash(f: str): bool = all { s.loc.get(f) == Trash, Track({ ...s, loc: s.loc.set(f, Gone) }) } // after the confirmation sheet

  // The camera, a download, or another app adds, removes or rewrites a file. Creation: the
  // filesystem itself never allows two equal names in one folder (Android picks "name (1)"), so the
  // writer gets a free name on a clash. The listing learns of it at Refresh.
  action ExternalWith(f: str, kind: str): bool = all { s.budget > 0,
    if (kind == "create") all { s.loc.get(f) == Gone, s.origin.get(f) != Gone,
      Track({ ...s, budget: s.budget - 1, stale: true, loc: s.loc.set(f, s.origin.get(f)),
        name: if (clash(s, f, s.origin.get(f))) s.name.set(f, freeName(s, f, s.origin.get(f))) else s.name,
        ver: s.ver.set(f, s.ver.get(f) + 1) }) }
    else if (kind == "remove") all { Dirs.contains(s.loc.get(f)),
      Track({ ...s, budget: s.budget - 1, stale: true, loc: s.loc.set(f, Gone) }) }
    else all { Dirs.contains(s.loc.get(f)), // rewrite in place
      Track({ ...s, budget: s.budget - 1, stale: true, ver: s.ver.set(f, s.ver.get(f) + 1) }) } }
  action External(f: str): bool = any { ExternalWith(f, "create"), ExternalWith(f, "remove"), ExternalWith(f, "rewrite") }

  // Reload on Android's change event: the listing and the selection catch up (stale rows pruned).
  action Refresh = all { s.stale, Track({ ...s, stale: false, sel: s.sel.intersect(Listing(s.cwd)) }) }

  action AgentPropose(f: str, d: str): bool = all { s.review == NoReview, Dirs.contains(s.loc.get(f)), s.loc.get(f) != d,
    Track({ ...s, review: { f: f, from: s.loc.get(f), to: d, ver: s.ver.get(f) } }) }

  val Reviewed = reviewed(s)
  action AgentApply = all { s.review != NoReview, Reviewed, moveOk(s, s.review.f, s.review.to), Track(agentApplied(s)) }
  action AgentRefused = all { s.review != NoReview, not(Reviewed), Track({ ...s, review: NoReview }) }
  action AgentReject = all { s.review != NoReview, Track({ ...s, review: NoReview }) }
  action AgentSettle = any { AgentApply, AgentRefused, AgentReject }

  action Next = any {
    { nondet d = Dirs.oneOf(); any { Navigate(d), MoveSel(d) } },
    { nondet f = FilesSet.oneOf()
      any { Toggle(f), Restore(f), EmptyTrash(f), External(f), { nondet d = Dirs.oneOf(); AgentPropose(f, d) } } },
    TrashSel, Refresh, AgentApply, AgentRefused, AgentReject }
  action step = any { Next, Track(s) }

  // WF_vars(Refresh) /\ WF_vars(AgentApply \/ AgentRefused \/ AgentReject)
  temporal Fairness = Refresh.weakFair(s) and AgentSettle.weakFair(s)
  val Initial = history == initialChecks and TypeOK and InitialNames.contains(s.name)
    and s == initialState(s.FixCategories, s.FixConflict, s.FixIdentity, s.name, s.cwd)
  temporal Spec = (Initial and s.FixCategories and s.FixConflict and s.FixIdentity)
    and always(Next.orKeep(vars)) and Fairness

  // ---------------------------------------------------------------------------
  // Each Browse entry lists exactly what its name says: Downloads is the Download folder, so a
  // camera photo is never in it.
  val CategoryIsQuery = Category("Downloads") == Present.filter(f => s.loc.get(f) == "Download")
    and Categories.exclude(Set("Downloads")).forall(c => Category(c).subseteq(Present))
  val NoOverwriteWithoutConfirm = not(s.lost)
  // Once the listing has caught up, every selected row exists in the open folder.
  val SelectionExists = not(s.stale) implies s.sel.subseteq(Listing(s.cwd))
  // Selection actions touch only files that are really in the open folder.
  temporal SelectionActsOnlyOnPresent = always(history.SelectionActsOnlyOnPresent)
  val TrashReversible = FilesSet.forall(f => s.loc.get(f) == Trash implies Dirs.contains(s.origin.get(f)))
  // An approved agent move applies only to the file the user reviewed: where they saw it, and the
  // same file (not rewritten or replaced by another file of that name since).
  temporal AgentMoveOnlyReviewed = always(history.AgentMoveOnlyReviewed)
  temporal ListingsConverge = leadsTo(s.stale, not(s.stale))
  temporal ReviewSettles = leadsTo(s.review != NoReview, s.review == NoReview)

  temporal CheckedAgentMoveOnlyReviewed = Fairness implies AgentMoveOnlyReviewed
  temporal CheckedListingsConverge = Fairness implies ListingsConverge
  temporal CheckedReviewSettles = Fairness implies ReviewSettles
  temporal CheckedSelectionActsOnlyOnPresent = Fairness implies SelectionActsOnlyOnPresent
  temporal CheckedTemporal = Fairness implies (AgentMoveOnlyReviewed and ListingsConverge
    and ReviewSettles and SelectionActsOnlyOnPresent)

  val safety = TypeOK and CategoryIsQuery and NoOverwriteWithoutConfirm and NamesUniquePerDir
    and SelectionExists and TrashReversible and SelectionActsOnlyOnPresentInvariant and AgentMoveOnlyReviewedInvariant

  // ---------------------------------------------------------------------------
  // Scenarios
  pure val sameNames: str -> int = Map("photo" -> 1, "pdf" -> 1, "scan" -> 1)
  run designMoveKeepsBothTest = StartState(true, true, true, sameNames, "DCIM/Camera")
    .then(Toggle("photo")).then(MoveSel("Download"))
    .expect(s.loc.get("photo") == "Download" and s.loc.get("pdf") == "Download" and s.name.get("photo") == 2 and safety)
  run designTrashRestoreTest = StartState(true, true, true, sameNames, "Download")
    .then(Toggle("pdf")).then(TrashSel).expect(s.loc.get("pdf") == Trash and safety)
    .then(Restore("pdf")).expect(s.loc.get("pdf") == "Download" and safety)
  run designStaleSelectionTest = StartState(true, true, true, sameNames, "Download")
    .then(Toggle("pdf")).then(ExternalWith("pdf", "remove")).then(TrashSel)
    .expect(s.loc.get("pdf") == Gone and safety)
    .then(Refresh).expect(not(s.stale) and safety)
  run designIdentityRefusedTest = StartState(true, true, true, sameNames, "Download")
    .then(AgentPropose("pdf", "Documents")).then(ExternalWith("pdf", "rewrite"))
    .expect(not(Reviewed)).then(AgentRefused)
    .expect(s.review == NoReview and s.loc.get("pdf") == "Download" and safety)
  run designAgentMoveTest = StartState(true, true, true, sameNames, "Download")
    .then(AgentPropose("pdf", "Documents")).then(AgentApply)
    .expect(s.loc.get("pdf") == "Documents" and safety)
  run asBuiltCategoriesTest = StartState(false, true, true, sameNames, "Download")
    .expect(Category("Downloads") == Set("photo", "pdf") and not(CategoryIsQuery))
  run ablateConflictTest = StartState(true, false, true, sameNames, "DCIM/Camera")
    .then(Toggle("photo")).then(MoveSel("Download"))
    .expect(s.loc.get("pdf") == Gone and not(NoOverwriteWithoutConfirm))
  run asBuiltIdentityTest = StartState(true, true, false, sameNames, "Download")
    .then(AgentPropose("pdf", "Documents")).then(ExternalWith("pdf", "rewrite")).then(AgentApply)
    .expect(s.loc.get("pdf") == "Documents" and not(AgentMoveOnlyReviewedInvariant))
}
