// Literal translation of photos-library/Spec.tla and all five configurations.
// Take uses the count of strictly newer/older IDs, equivalent to the original
// recursive maximum/minimum extraction on the finite totally ordered ID set.
module PhotosLibrary {
  type Configuration = { name: str, Ids: Set[int], W: int, Cap: int, Budget: int,
    FixWindow: bool, FixPatch: bool, FixFavToggle: bool, FixNoCap: bool }
  type Review = { ids: Set[int], revs: int -> int, act: str }
  type State = { config: Configuration, exists: int -> bool, trashed: int -> bool,
    fav: int -> bool, rev: int -> int, tab: str, sel: Set[int], selecting: bool,
    viewer: int, filter: str, review: Review, budget: int,
    lostSel: bool, favStuck: bool, capHit: bool, purgedLive: bool }
  type History = { NoActionOnStaleRev: bool, FilterIsReadOnly: bool, ShareChangesNothing: bool }
  var s: State
  var history: History
  val vars = (s, history)
  pure val MaxRev = 2
  pure val NoReview = { ids: Set(), revs: Map(), act: "none" }
  pure val Configurations = Set("Design", "AsBuilt_Window", "AsBuilt_Patch", "AsBuilt_FavToggle", "AsBuilt_Cap")
  pure def configuration(name) = { name: name, Ids: Set(1, 2, 3), W: 2, Cap: 1, Budget: 2,
    FixWindow: name != "AsBuilt_Window", FixPatch: name != "AsBuilt_Patch",
    FixFavToggle: name != "AsBuilt_FavToggle", FixNoCap: name != "AsBuilt_Cap" }
  pure def live(before: State): Set[int] = before.config.Ids.filter(i => before.exists.get(i) and not(before.trashed.get(i)))
  pure def inTrash(before: State): Set[int] = before.config.Ids.filter(i => before.exists.get(i) and before.trashed.get(i))
  pure def pool(before: State): Set[int] = if (before.tab == "lib")
    live(before).filter(i => before.filter == "none" or before.fav.get(i)) else inTrash(before)
  pure def Take(items, n, newest) = items.filter(i => items.filter(j => if (newest) j > i else j < i).size() < n)
  val Live = live(s)
  val InTrash = inTrash(s)
  def Matches(i) = s.filter == "none" or s.fav.get(i)
  val Pool = pool(s)
  val Window = Take(Pool, s.config.W, s.config.FixWindow)
  pure def initialState(name, favorites) = { config: configuration(name),
    exists: configuration(name).Ids.mapBy(i => true), trashed: configuration(name).Ids.mapBy(i => false),
    fav: favorites, rev: configuration(name).Ids.mapBy(i => 0), tab: "lib", sel: Set(),
    selecting: false, viewer: 0, filter: "none", review: NoReview, budget: configuration(name).Budget,
    lostSel: false, favStuck: false, capHit: false, purgedLive: false }
  pure val initialHistory = { NoActionOnStaleRev: true, FilterIsReadOnly: true, ShareChangesNothing: true }
  action StartState(name, favorites) = all { Configurations.contains(name), favorites.keys() == configuration(name).Ids,
    s' = initialState(name, favorites), history' = initialHistory }
  action Init(name) = { nondet favorites = configuration(name).Ids.setOfMaps(Set(false, true)).oneOf()
    StartState(name, favorites) }
  // Separate entry points avoid Quint 0.33.1 init/action-helper conversion overlap.
  action checkerInit = {
    nondet favorites = configuration("Design").Ids.setOfMaps(Set(false, true)).oneOf()
    all { s' = initialState("Design", favorites), history' = initialHistory }
  }
  action checkerAsBuilt_WindowInit = {
    nondet favorites = configuration("AsBuilt_Window").Ids.setOfMaps(Set(false, true)).oneOf()
    all { s' = initialState("AsBuilt_Window", favorites), history' = initialHistory }
  }
  action checkerAsBuilt_PatchInit = {
    nondet favorites = configuration("AsBuilt_Patch").Ids.setOfMaps(Set(false, true)).oneOf()
    all { s' = initialState("AsBuilt_Patch", favorites), history' = initialHistory }
  }
  action checkerAsBuilt_FavToggleInit = {
    nondet favorites = configuration("AsBuilt_FavToggle").Ids.setOfMaps(Set(false, true)).oneOf()
    all { s' = initialState("AsBuilt_FavToggle", favorites), history' = initialHistory }
  }
  action checkerAsBuilt_CapInit = {
    nondet favorites = configuration("AsBuilt_Cap").Ids.setOfMaps(Set(false, true)).oneOf()
    all { s' = initialState("AsBuilt_Cap", favorites), history' = initialHistory }
  }
  action init = Init("Design")
  action AsBuilt_WindowInit = Init("AsBuilt_Window")
  action AsBuilt_PatchInit = Init("AsBuilt_Patch")
  action AsBuilt_FavToggleInit = Init("AsBuilt_FavToggle")
  action AsBuilt_CapInit = Init("AsBuilt_Cap")
  pure def bump(revisions, i) = revisions.set(i, if (revisions.get(i) < MaxRev) revisions.get(i) + 1 else revisions.get(i))
  pure def bumpAll(before: State, selected: Set[int]): int -> int = before.config.Ids.mapBy(i =>
    if (selected.contains(i) and before.rev.get(i) < MaxRev) before.rev.get(i) + 1 else before.rev.get(i))
  pure def reviewCurrent(before: State): bool = before.review.ids != Set() and before.review.ids.forall(i =>
    before.exists.get(i) and not(before.trashed.get(i)) and before.rev.get(i) == before.review.revs.get(i))
  pure def applied(before: State): State = if (before.review.act == "trash") { ...before,
    trashed: before.config.Ids.mapBy(i => before.trashed.get(i) or before.review.ids.contains(i)),
    rev: bumpAll(before, before.review.ids), sel: before.sel.exclude(before.review.ids), review: NoReview }
    else { ...before, review: NoReview }
  pure def contentsEqual(before: State, after: State): bool = before.exists == after.exists
    and before.trashed == after.trashed and before.fav == after.fav and before.rev == after.rev
  pure def NoActionOnStaleRevRelation(before: State, after: State): bool =
    (reviewCurrent(before) and after == applied(before)) implies
      before.review.ids.forall(i => before.rev.get(i) == before.review.revs.get(i))
  pure def FilterIsReadOnlyRelation(before: State, after: State): bool = (after.filter != before.filter) implies contentsEqual(before, after)
  pure def ShareChangesNothingRelation(before: State, after: State): bool =
    (reviewCurrent(before) and after == applied(before) and before.review.act == "share") implies contentsEqual(before, after)
  action Track(after: State): bool = all { s' = after, history' = {
    NoActionOnStaleRev: history.NoActionOnStaleRev and NoActionOnStaleRevRelation(s, after),
    FilterIsReadOnly: history.FilterIsReadOnly and FilterIsReadOnlyRelation(s, after),
    ShareChangesNothing: history.ShareChangesNothing and ShareChangesNothingRelation(s, after) } }
  action SwitchTab(tab) = all { s.tab != tab, s.viewer == 0, Track({ ...s, tab: tab, sel: Set(), selecting: false }) }
  action EnterSelect = all { not(s.selecting), s.viewer == 0, Window != Set(), Track({ ...s, selecting: true, sel: Set() }) }
  action Toggle(i) = all { s.selecting, Window.contains(i),
    if (not(s.sel.contains(i)) and s.sel.size() >= s.config.Cap and not(s.config.FixNoCap)) Track({ ...s, capHit: true })
    else Track({ ...s, sel: if (s.sel.contains(i)) s.sel.exclude(Set(i)) else s.sel.union(Set(i)) }) }
  action SelectAll = all { s.selecting, s.config.FixNoCap, Track({ ...s, sel: Window }) }
  action CancelSelect = all { s.selecting, Track({ ...s, selecting: false, sel: Set() }) }
  action BatchFavorite = {
    val allFav = s.sel.forall(i => s.fav.get(i))
    val target = if (s.config.FixFavToggle) not(allFav) else true
    all { s.selecting, s.tab == "lib", s.sel != Set(), Track({ ...s,
      fav: s.config.Ids.mapBy(i => if (s.sel.contains(i)) target else s.fav.get(i)),
      favStuck: s.favStuck or (allFav and not(s.config.FixFavToggle)), rev: bumpAll(s, s.sel), selecting: false, sel: Set() }) }
  }
  action BatchTrash = all { s.selecting, s.tab == "lib", s.sel != Set(), Track({ ...s,
    trashed: s.config.Ids.mapBy(i => s.trashed.get(i) or s.sel.contains(i)), rev: bumpAll(s, s.sel), selecting: false, sel: Set() }) }
  action BatchRestore = all { s.selecting, s.tab == "trash", s.sel != Set(), Track({ ...s,
    trashed: s.config.Ids.mapBy(i => s.trashed.get(i) and not(s.sel.contains(i))), rev: bumpAll(s, s.sel), selecting: false, sel: Set() }) }
  action DeleteForever = all { s.selecting, s.tab == "trash", s.sel != Set(), Track({ ...s,
    purgedLive: s.purgedLive or s.sel.exists(i => not(s.trashed.get(i))),
    exists: s.config.Ids.mapBy(i => s.exists.get(i) and not(s.sel.contains(i))), selecting: false, sel: Set() }) }
  action OpenViewer(i) = all { not(s.selecting), s.viewer == 0, Window.contains(i), Track({ ...s, viewer: i }) }
  action Swipe(i) = all { s.viewer != 0, Window.contains(i), i != s.viewer, Track({ ...s, viewer: i }) }
  action ViewerTrash = all { s.viewer != 0, s.tab == "lib", Track({ ...s,
    trashed: s.trashed.set(s.viewer, true), rev: bump(s.rev, s.viewer), viewer: 0 }) }
  action CloseViewer = all { s.viewer != 0, Track({ ...s, viewer: 0 }) }
  action Undo(i) = all { s.exists.get(i), s.trashed.get(i), s.viewer == 0, not(s.selecting),
    Track({ ...s, trashed: s.trashed.set(i, false), rev: bump(s.rev, i) }) }
  pure def eventPatched(before: State, changed: State, i: int): State = if (before.config.FixPatch) { ...changed,
    sel: before.sel.filter(j => changed.exists.get(j) and (changed.trashed.get(j) == (before.tab == "trash"))
      and (before.tab == "trash" or before.filter == "none" or changed.fav.get(j))),
    viewer: if (before.viewer != 0 and not(changed.exists.get(before.viewer))) 0 else before.viewer }
    else { ...changed, sel: Set(), selecting: false, viewer: 0, lostSel: before.lostSel or before.sel.exclude(Set(i)) != Set() }
  action StoreEvent(i) = all { s.budget > 0, any {
    all { s.exists.get(i), Track(eventPatched(s, { ...s, budget: s.budget - 1, exists: s.exists.set(i, false) }, i)) },
    all { s.exists.get(i), Track(eventPatched(s, { ...s, budget: s.budget - 1, rev: bump(s.rev, i), fav: s.fav.set(i, not(s.fav.get(i))) }, i)) },
    all { not(s.exists.get(i)), Track(eventPatched(s, { ...s, budget: s.budget - 1, exists: s.exists.set(i, true),
      trashed: s.trashed.set(i, false), rev: bump(s.rev, i) }, i)) }
  } }
  action AgentFilter(filterValue) = all { s.viewer == 0, Track({ ...s, filter: filterValue,
    sel: s.sel.filter(j => filterValue == "none" or s.fav.get(j)) }) }
  action AgentReview = all { s.review.ids == Set(), s.selecting, s.sel != Set(), s.tab == "lib",
    Track({ ...s, review: { ids: s.sel, revs: s.sel.mapBy(i => s.rev.get(i)), act: "trash" } }) }
  val ReviewCurrent = reviewCurrent(s)
  action ShareReview(i) = all { s.review.ids == Set(), Take(Live, s.config.W, s.config.FixWindow).contains(i),
    Track({ ...s, review: { ids: Set(i), revs: Map(i -> s.rev.get(i)), act: "share" } }) }
  action AgentShareReview = { nondet i = s.config.Ids.oneOf()
    ShareReview(i) }
  action AgentApply = all { ReviewCurrent, Track(applied(s)) }
  action AgentOpen(i) = all { s.review.ids == Set(), Take(Live, s.config.W, s.config.FixWindow).contains(i),
    Track({ ...s, viewer: i, tab: "lib", filter: "none", sel: Set(), selecting: false }) }
  action EditReplace = all { s.viewer != 0, s.tab == "lib", s.exists.get(s.viewer), not(s.trashed.get(s.viewer)),
    not(s.selecting), s.budget > 0, Track({ ...s, budget: s.budget - 1, rev: bump(s.rev, s.viewer) }) }
  action AgentReject = all { s.review.ids != Set(), Track({ ...s, review: NoReview }) }
  action Next = any {
    SwitchTab("lib"),
    SwitchTab("trash"),
    EnterSelect,
    SelectAll,
    CancelSelect,
    { nondet i = s.config.Ids.oneOf()
      Toggle(i) },
    { nondet i = s.config.Ids.oneOf()
      OpenViewer(i) },
    { nondet i = s.config.Ids.oneOf()
      Swipe(i) },
    { nondet i = s.config.Ids.oneOf()
      Undo(i) },
    { nondet i = s.config.Ids.oneOf()
      StoreEvent(i) },
    BatchFavorite,
    BatchTrash,
    BatchRestore,
    DeleteForever,
    ViewerTrash,
    CloseViewer,
    AgentFilter("none"),
    AgentFilter("fav"),
    AgentReview,
    AgentApply,
    AgentReject,
    AgentShareReview,
    EditReplace,
    { nondet i = s.config.Ids.oneOf()
      AgentOpen(i) }
  }
  action step = any { Next, Track(s) }
  val TypeOK = Configurations.contains(s.config.name) and s.config == configuration(s.config.name)
    and s.exists.keys() == s.config.Ids and s.trashed.keys() == s.config.Ids and s.fav.keys() == s.config.Ids
    and s.rev.keys() == s.config.Ids and s.config.Ids.forall(i => 0.to(MaxRev).contains(s.rev.get(i)))
    and Set("lib", "trash").contains(s.tab) and s.sel.subseteq(s.config.Ids)
    and s.config.Ids.union(Set(0)).contains(s.viewer) and Set("none", "fav").contains(s.filter)
    and 0.to(s.config.Budget).contains(s.budget)
  val NewestNeverDropped = Pool != Set() implies Window.exists(m => Pool.forall(y => y <= m))
  val SelectionSubsetOfVisible = s.sel.subseteq(Pool)
  val ViewerShowsExistingItem = s.viewer != 0 implies s.exists.get(s.viewer)
  val NoSpuriousClear = not(s.lostSel)
  val FavoriteReversible = not(s.favStuck)
  val NoSelectionCap = not(s.capHit)
  val DeleteForeverOnlyFromTrash = not(s.purgedLive)
  val stateSafety = TypeOK and NewestNeverDropped and SelectionSubsetOfVisible and ViewerShowsExistingItem and NoSpuriousClear and FavoriteReversible and NoSelectionCap and DeleteForeverOnlyFromTrash
  val safety = TypeOK and NewestNeverDropped and SelectionSubsetOfVisible and ViewerShowsExistingItem
    and NoSpuriousClear and FavoriteReversible and NoSelectionCap and DeleteForeverOnlyFromTrash
    and history.NoActionOnStaleRev and history.FilterIsReadOnly and history.ShareChangesNothing
  val Initial = Configurations.contains(s.config.name) and s.fav.keys() == s.config.Ids
    and s == initialState(s.config.name, s.fav) and history == initialHistory
  temporal Fairness = (AgentApply or AgentReject).weakFair(s)
  temporal Spec = Initial and always(Next.orKeep(vars)) and Fairness
  temporal NoActionOnStaleRev = always(history.NoActionOnStaleRev)
  temporal FilterIsReadOnly = always(history.FilterIsReadOnly)
  temporal ShareChangesNothing = always(history.ShareChangesNothing)
  temporal ReviewSettles = leadsTo(s.review.ids != Set(), s.review.ids == Set())
  temporal CheckedNoActionOnStaleRev = Fairness implies NoActionOnStaleRev
  temporal CheckedFilterIsReadOnly = Fairness implies FilterIsReadOnly
  temporal CheckedShareChangesNothing = Fairness implies ShareChangesNothing
  temporal CheckedReviewSettles = Fairness implies ReviewSettles
  temporal CheckedTemporal = Fairness implies (always(history.NoActionOnStaleRev and history.FilterIsReadOnly and history.ShareChangesNothing) and ReviewSettles)
  temporal CheckedConfiguredTemporal = CheckedTemporal
  action TestInit(name) = StartState(name, Set(1, 2, 3).mapBy(i => true))
  action Remove(i) = all { s.budget > 0, s.exists.get(i),
    Track(eventPatched(s, { ...s, budget: s.budget - 1, exists: s.exists.set(i, false) }, i)) }
  run newestWindowTest = TestInit("Design").expect(Window == Set(2, 3) and safety)
  run favoriteToggleTest = TestInit("Design").then(EnterSelect).then(Toggle(3)).then(BatchFavorite)
    .expect(not(s.fav.get(3)) and safety)
  run selectionPatchTest = TestInit("Design").then(EnterSelect).then(Toggle(3)).then(Remove(1))
    .expect(s.sel == Set(3) and s.selecting and safety)
  run trashRestoreTest = TestInit("Design").then(EnterSelect).then(Toggle(3)).then(BatchTrash)
    .then(SwitchTab("trash")).then(EnterSelect).then(Toggle(3)).then(BatchRestore)
    .expect(not(s.trashed.get(3)) and safety)
  run shareReviewTest = TestInit("Design").then(ShareReview(3)).then(AgentApply)
    .expect(s.review == NoReview and s.exists.get(3) and safety)
  run staleReplaceTest = TestInit("Design").then(ShareReview(3)).then(OpenViewer(3)).then(EditReplace)
    .expect(not(ReviewCurrent) and safety).then(AgentReject).expect(s.review == NoReview and safety)
  run asBuiltWindowTest = TestInit("AsBuilt_Window").expect(not(NewestNeverDropped))
  run asBuiltPatchTest = TestInit("AsBuilt_Patch").then(EnterSelect).then(Toggle(3)).then(Remove(1)).expect(not(NoSpuriousClear))
  run asBuiltFavoriteTest = TestInit("AsBuilt_FavToggle").then(EnterSelect).then(Toggle(3)).then(BatchFavorite).expect(not(FavoriteReversible))
  run asBuiltCapTest = TestInit("AsBuilt_Cap").then(EnterSelect).then(Toggle(3)).then(Toggle(2)).expect(not(NoSelectionCap))
}
