// Faithful translation of the view-refresh photos-library TLA+ model
// (design/view-refresh-2026-11/tla/photos-library/Spec.tla at 4cad393df4).
// Photos view: library window, selection, viewer, trash, external MediaStore changes and agent
// filter/select/review.
//
// Code modelled: apps/app/src/prototype/camera-adapter.ts (CA), photo-library-adapter.ts,
// runtime/photo-library.ts. Proposal: design/view-refresh-2026-11/PLAN.md section 2.
//
// Item ids are ordered by capture date: a larger id is newer.
// Port (2026-11-06): agent photos_open (AgentOpen), reviewed photos_share (AgentShareReview;
// applying shares and changes no item) and the editor's Replace (EditReplace: overwrites the open
// item, a new revision). Album creation changes no modelled item state and is not modelled.
// Fix* = false is the code as written; true is the proposed design. They are immutable fields of s:
// checkerInit is Design.cfg and checkerAsBuilt<X>Init is AsBuilt_<X>.cfg.
//
// Translation notes: TLA+ RECURSIVE Take(S, n, newest) is the set of the n newest (or oldest)
// members of S. Ids are distinct integers, so that is exactly the members with fewer than n
// members of S newer (older) than them. The constants Ids = {1, 2, 3}, W = 2, Cap = 1 and
// Budget = 2 are the same in every configuration.
module PhotosLibrary {
  type Review = { ids: Set[int], revs: int -> int, act: str }
  type State = {
    FixWindow: bool,    // keep the newest W, not the oldest (CA:303,402,465)
    FixPatch: bool,     // store events patch the view (CA:961-988 clears it)
    FixFavToggle: bool, // batch Favorite toggles (CA:341 always sets)
    FixNoCap: bool,     // no user-visible selection cap
    exists: int -> bool, trashed: int -> bool, fav: int -> bool, rev: int -> int, // the store
    tab: str,           // "lib" | "trash"
    sel: Set[int],      // selection: set of ids, or {} when not selecting
    selecting: bool,
    viewer: int,        // 0 = closed, else the open id
    filter: str,        // "none" | "fav"  (set only by the agent, read-only)
    review: Review,     // pending agent review: [ids, revs, act]; NoReview when none
    budget: int,
    lostSel: bool,      // ghost: an unrelated store event cleared the selection
    favStuck: bool,     // ghost: Favorite on an all-favourite selection did nothing
    capHit: bool,       // ghost: a selection tap was refused by the cap
    purgedLive: bool    // ghost: an item never trashed was deleted forever
  }
  type TransitionHistory = { NoActionOnStaleRev: bool, FilterIsReadOnly: bool, ShareChangesNothing: bool }
  var s: State
  var history: TransitionHistory
  val vars = (s, history)
  pure val Ids = 1.to(3)
  pure val W = 2       // loaded window size (240 in code; small here)
  pure val Cap = 1     // selection cap (20 in code)
  pure val Budget = 2  // external MediaStore events
  pure val MaxRev = 2
  pure val NoReview: Review = { ids: Set(), revs: Map(), act: "none" }

  pure def live(x: State): Set[int] = Ids.filter(i => x.exists.get(i) and not(x.trashed.get(i)))
  pure def inTrash(x: State): Set[int] = Ids.filter(i => x.exists.get(i) and x.trashed.get(i))
  pure def matches(x: State, i: int): bool = x.filter == "none" or x.fav.get(i)
  pure def pool(x: State): Set[int] = if (x.tab == "lib") live(x).filter(i => matches(x, i)) else inTrash(x)
  // The loaded window: the n newest (design) or the n oldest (as written) of S.
  pure def Take(S: Set[int], n: int, newest: bool): Set[int] =
    S.filter(x => S.filter(y => if (newest) y > x else y < x).size() < n)
  pure def window(x: State): Set[int] = Take(pool(x), W, x.FixWindow)
  val Live = live(s)
  val InTrash = inTrash(s)
  val Pool = pool(s)
  val Window = window(s)

  val TypeOK = s.exists.keys() == Ids and s.trashed.keys() == Ids and s.fav.keys() == Ids
    and s.rev.keys() == Ids and Ids.forall(i => s.rev.get(i) >= 0 and s.rev.get(i) <= MaxRev)
    and Set("lib", "trash").contains(s.tab) and s.sel.subseteq(Ids)
    and Ids.union(Set(0)).contains(s.viewer) and Set("none", "fav").contains(s.filter)
    and s.budget >= 0 and s.budget <= Budget

  pure def initialState(fixWindow: bool, fixPatch: bool, fixFavToggle: bool, fixNoCap: bool, fav: int -> bool): State = {
    FixWindow: fixWindow, FixPatch: fixPatch, FixFavToggle: fixFavToggle, FixNoCap: fixNoCap,
    exists: Ids.mapBy(i => true), trashed: Ids.mapBy(i => false), fav: fav, rev: Ids.mapBy(i => 0),
    tab: "lib", sel: Set(), selecting: false, viewer: 0, filter: "none", review: NoReview,
    budget: Budget, lostSel: false, favStuck: false, capHit: false, purgedLive: false }

  pure def bump(rev: int -> int, i: int): int -> int = rev.set(i, if (rev.get(i) < MaxRev) rev.get(i) + 1 else rev.get(i))
  pure def bumpAll(rev: int -> int, S: Set[int]): int -> int =
    Ids.mapBy(i => if (S.contains(i) and rev.get(i) < MaxRev) rev.get(i) + 1 else rev.get(i))
  pure def reviewCurrent(x: State): bool = x.review.ids != Set()
    and x.review.ids.forall(i => x.exists.get(i) and not(x.trashed.get(i)) and x.rev.get(i) == x.review.revs.get(i))
  val ReviewCurrent = reviewCurrent(s)

  // AgentApply as a relation, so the action properties can name it exactly.
  // user approved: trash moves the items to Recently deleted; share hands them to Android
  pure def applied(x: State): State =
    if (x.review.act == "trash") { ...x, trashed: Ids.mapBy(i => x.trashed.get(i) or x.review.ids.contains(i)),
      rev: bumpAll(x.rev, x.review.ids), sel: x.sel.exclude(x.review.ids), review: NoReview }
    else { ...x, review: NoReview }
  pure def AgentApplyRelation(before: State, after: State): bool =
    before.review.ids != Set() and reviewCurrent(before) and after == applied(before)
  pure def sameStore(before: State, after: State): bool = before.exists == after.exists
    and before.trashed == after.trashed and before.fav == after.fav and before.rev == after.rev

  // Persistent monitors for the original action properties [][A]_vars.
  pure val initialChecks = { NoActionOnStaleRev: true, FilterIsReadOnly: true, ShareChangesNothing: true }
  // NoActionOnStaleRev == [][AgentApply => \A i \in review.ids : rev[i] = review.revs[i]]_vars
  pure def NoActionOnStaleRevRelation(before: State, after: State): bool = before == after or
    (AgentApplyRelation(before, after) implies before.review.ids.forall(i => before.rev.get(i) == before.review.revs.get(i)))
  // FilterIsReadOnly == [][(filter' # filter) => UNCHANGED <<exists, trashed, fav, rev>>]_vars
  pure def FilterIsReadOnlyRelation(before: State, after: State): bool = before == after or
    ((after.filter != before.filter) implies sameStore(before, after))
  // ShareChangesNothing == [][(AgentApply /\ review.act = "share") => UNCHANGED <<exists, trashed, fav, rev>>]_vars
  pure def ShareChangesNothingRelation(before: State, after: State): bool = before == after or
    ((AgentApplyRelation(before, after) and before.review.act == "share") implies sameStore(before, after))
  action Track(after: State): bool = all {
    s' = after,
    history' = {
      NoActionOnStaleRev: history.NoActionOnStaleRev and NoActionOnStaleRevRelation(s, after),
      FilterIsReadOnly: history.FilterIsReadOnly and FilterIsReadOnlyRelation(s, after),
      ShareChangesNothing: history.ShareChangesNothing and ShareChangesNothingRelation(s, after) }
  }
  val NoActionOnStaleRevInvariant = history.NoActionOnStaleRev
  val FilterIsReadOnlyInvariant = history.FilterIsReadOnly
  val ShareChangesNothingInvariant = history.ShareChangesNothing

  action StartState(fixWindow: bool, fixPatch: bool, fixFavToggle: bool, fixNoCap: bool, fav: int -> bool): bool = all {
    s' = initialState(fixWindow, fixPatch, fixFavToggle, fixNoCap, fav), history' = initialChecks }
  // fav \in [Ids -> BOOLEAN]
  action checkerInit = { nondet fav = Ids.setOfMaps(Bool).oneOf()                      // Design.cfg
    all { s' = initialState(true, true, true, true, fav), history' = initialChecks } }
  action checkerAsBuiltWindowInit = { nondet fav = Ids.setOfMaps(Bool).oneOf()         // AsBuilt_Window.cfg
    all { s' = initialState(false, true, true, true, fav), history' = initialChecks } }
  action checkerAsBuiltPatchInit = { nondet fav = Ids.setOfMaps(Bool).oneOf()          // AsBuilt_Patch.cfg
    all { s' = initialState(true, false, true, true, fav), history' = initialChecks } }
  action checkerAsBuiltFavToggleInit = { nondet fav = Ids.setOfMaps(Bool).oneOf()      // AsBuilt_FavToggle.cfg
    all { s' = initialState(true, true, false, true, fav), history' = initialChecks } }
  action checkerAsBuiltCapInit = { nondet fav = Ids.setOfMaps(Bool).oneOf()            // AsBuilt_Cap.cfg
    all { s' = initialState(true, true, true, false, fav), history' = initialChecks } }
  action init = { nondet fav = Ids.setOfMaps(Bool).oneOf(); StartState(true, true, true, true, fav) }

  // ---------------------------------------------------------------------------
  action SwitchTab(t: str): bool = all { s.tab != t, s.viewer == 0,
    Track({ ...s, tab: t, sel: Set(), selecting: false }) }

  action EnterSelect = all { not(s.selecting), s.viewer == 0, Window != Set(),
    Track({ ...s, selecting: true, sel: Set() }) }

  action Toggle(i: int): bool = all { s.selecting, Window.contains(i),
    if (not(s.sel.contains(i)) and s.sel.size() >= Cap and not(s.FixNoCap)) Track({ ...s, capHit: true })
    else Track({ ...s, sel: if (s.sel.contains(i)) s.sel.exclude(Set(i)) else s.sel.union(Set(i)) }) }

  action SelectAll = all { s.selecting, s.FixNoCap, Track({ ...s, sel: Window }) }

  action CancelSelect = all { s.selecting, Track({ ...s, selecting: false, sel: Set() }) }

  action BatchFavorite = all { s.selecting, s.tab == "lib", s.sel != Set(), {
    val allFav = s.sel.forall(i => s.fav.get(i))
    val target = if (s.FixFavToggle) not(allFav) else true
    Track({ ...s, fav: Ids.mapBy(i => if (s.sel.contains(i)) target else s.fav.get(i)),
      favStuck: s.favStuck or (allFav and not(s.FixFavToggle)),
      rev: bumpAll(s.rev, s.sel), selecting: false, sel: Set() })
  } }

  action BatchTrash = all { s.selecting, s.tab == "lib", s.sel != Set(),
    Track({ ...s, trashed: Ids.mapBy(i => s.trashed.get(i) or s.sel.contains(i)),
      rev: bumpAll(s.rev, s.sel), selecting: false, sel: Set() }) }

  action BatchRestore = all { s.selecting, s.tab == "trash", s.sel != Set(),
    Track({ ...s, trashed: Ids.mapBy(i => s.trashed.get(i) and not(s.sel.contains(i))),
      rev: bumpAll(s.rev, s.sel), selecting: false, sel: Set() }) }

  // Only from Recently deleted, after the confirmation sheet.
  action DeleteForever = all { s.selecting, s.tab == "trash", s.sel != Set(),
    Track({ ...s, purgedLive: s.purgedLive or s.sel.exists(i => not(s.trashed.get(i))),
      exists: Ids.mapBy(i => s.exists.get(i) and not(s.sel.contains(i))),
      selecting: false, sel: Set() }) }

  action OpenViewer(i: int): bool = all { not(s.selecting), s.viewer == 0, Window.contains(i),
    Track({ ...s, viewer: i }) }

  action Swipe(i: int): bool = all { s.viewer != 0, Window.contains(i), i != s.viewer,
    Track({ ...s, viewer: i }) }

  // Delete in the viewer of a library item; the viewer moves on or closes
  action ViewerTrash = all { s.viewer != 0, s.tab == "lib",
    Track({ ...s, trashed: s.trashed.set(s.viewer, true), rev: bump(s.rev, s.viewer), viewer: 0 }) }

  action CloseViewer = all { s.viewer != 0, Track({ ...s, viewer: 0 }) }

  // the Undo toast after a move to Recently deleted
  action Undo(i: int): bool = all { s.exists.get(i), s.trashed.get(i), s.viewer == 0, not(s.selecting),
    Track({ ...s, trashed: s.trashed.set(i, false), rev: bump(s.rev, i) }) }

  // ---------------------------------------------------------------------------
  // Another app, the camera, or Android itself changes MediaStore. kind names the TLA+ disjunct:
  // "remove" (deleted elsewhere), "edit" (edited and (un)favourited elsewhere), "add" (reappears).
  pure def storeChange(x: State, i: int, kind: str): State =
    if (kind == "remove") { ...x, exists: x.exists.set(i, false) }
    else if (kind == "edit") { ...x, rev: bump(x.rev, i), fav: x.fav.set(i, not(x.fav.get(i))) }
    else { ...x, exists: x.exists.set(i, true), trashed: x.trashed.set(i, false), rev: bump(x.rev, i) }
  action StoreEventWith(i: int, kind: str): bool = all { s.budget > 0,
    if (kind == "add") not(s.exists.get(i)) else s.exists.get(i), {
    val c = storeChange(s, i, kind)
    if (s.FixPatch)
      Track({ ...c, budget: s.budget - 1,
        sel: s.sel.filter(j => c.exists.get(j) and (c.trashed.get(j) == (s.tab == "trash"))
          and (s.tab == "trash" or s.filter == "none" or c.fav.get(j))),
        viewer: if (s.viewer != 0 and not(c.exists.get(s.viewer))) 0 else s.viewer })
    else
      Track({ ...c, budget: s.budget - 1, sel: Set(), selecting: false, viewer: 0,
        lostSel: s.lostSel or s.sel.exclude(Set(i)) != Set() })
  } }
  action StoreEvent(i: int): bool = any { StoreEventWith(i, "remove"), StoreEventWith(i, "edit"), StoreEventWith(i, "add") }

  // Agent tools. photos_filter is read-only. photo_library_review captures the revisions it showed
  // the user and applies only if they still match.
  action AgentFilter(f: str): bool = all { s.viewer == 0,
    Track({ ...s, filter: f, sel: s.sel.filter(j => f == "none" or s.fav.get(j)) }) }

  action AgentReview = all { s.review.ids == Set(), s.selecting, s.sel != Set(), s.tab == "lib",
    Track({ ...s, review: { ids: s.sel, revs: s.sel.mapBy(i => s.rev.get(i)), act: "trash" } }) }

  // photos_share: the agent names loaded Library items (unfiltered); the owner confirms over the
  // grid. One item is enough to check the rules (a set behaves the same per item).
  action AgentShareReviewOf(i: int): bool = all { s.review.ids == Set(), Take(Live, W, s.FixWindow).contains(i),
    Track({ ...s, review: { ids: Set(i), revs: Set(i).mapBy(j => s.rev.get(j)), act: "share" } }) }
  action AgentShareReview = any { AgentShareReviewOf(1), AgentShareReviewOf(2), AgentShareReviewOf(3) }

  action AgentApply = all { s.review.ids != Set(), ReviewCurrent, Track(applied(s)) }

  // photos_open: navigation only. The code clears the selection and the filter and shows the item
  // from the loaded Library window; it is refused while a review waits.
  action AgentOpen(i: int): bool = all { s.review.ids == Set(), Take(Live, W, s.FixWindow).contains(i),
    Track({ ...s, viewer: i, tab: "lib", filter: "none", sel: Set(), selecting: false }) }

  // Editor Save > Replace on the open Library item: its pixels are overwritten (a new revision);
  // the viewer stays on it. A review that captured the old revision can no longer apply. Like an
  // external edit it draws on the event budget, which bounds the revisions explored.
  action EditReplace = all { s.viewer != 0, s.tab == "lib", s.exists.get(s.viewer), not(s.trashed.get(s.viewer)),
    not(s.selecting), s.budget > 0,
    Track({ ...s, budget: s.budget - 1, rev: bump(s.rev, s.viewer) }) }

  // user cancelled, or the reviewed revisions are stale
  action AgentReject = all { s.review.ids != Set(), Track({ ...s, review: NoReview }) }

  action AgentSettle = any { AgentApply, AgentReject }
  action Next = any {
    SwitchTab("lib"), SwitchTab("trash"), EnterSelect, SelectAll, CancelSelect,
    { nondet i = Ids.oneOf(); any { Toggle(i), OpenViewer(i), Swipe(i), Undo(i), StoreEvent(i) } },
    BatchFavorite, BatchTrash, BatchRestore, DeleteForever,
    ViewerTrash, CloseViewer,
    AgentFilter("none"), AgentFilter("fav"), AgentReview, AgentApply, AgentReject,
    AgentShareReview, EditReplace, { nondet i = Ids.oneOf(); AgentOpen(i) } }
  action step = any { Next, Track(s) }

  // WF_vars(AgentApply \/ AgentReject)
  temporal Fairness = AgentSettle.weakFair(s)
  val Initial = history == initialChecks and TypeOK
    and s == initialState(s.FixWindow, s.FixPatch, s.FixFavToggle, s.FixNoCap, s.fav)
  temporal Spec = (Initial and s.FixWindow and s.FixPatch and s.FixFavToggle and s.FixNoCap)
    and always(Next.orKeep(vars)) and Fairness

  // ---------------------------------------------------------------------------
  val NewestNeverDropped = Pool != Set() implies Window.exists(m => Pool.forall(y => y <= m))
  val SelectionSubsetOfVisible = s.sel.subseteq(Pool)
  val ViewerShowsExistingItem = s.viewer != 0 implies s.exists.get(s.viewer)
  val NoSpuriousClear = not(s.lostSel)
  val FavoriteReversible = not(s.favStuck)
  val NoSelectionCap = not(s.capHit)
  val DeleteForeverOnlyFromTrash = not(s.purgedLive)
  // A reviewed action never applies to a revision the user did not see.
  temporal NoActionOnStaleRev = always(history.NoActionOnStaleRev)
  // The agent's filter never changes library contents.
  temporal FilterIsReadOnly = always(history.FilterIsReadOnly)
  // Sharing never changes library contents.
  temporal ShareChangesNothing = always(history.ShareChangesNothing)
  temporal ReviewSettles = leadsTo(s.review.ids != Set(), s.review.ids == Set())

  temporal CheckedNoActionOnStaleRev = Fairness implies NoActionOnStaleRev
  temporal CheckedFilterIsReadOnly = Fairness implies FilterIsReadOnly
  temporal CheckedShareChangesNothing = Fairness implies ShareChangesNothing
  temporal CheckedReviewSettles = Fairness implies ReviewSettles
  temporal CheckedTemporal = Fairness implies (NoActionOnStaleRev and FilterIsReadOnly
    and ShareChangesNothing and ReviewSettles)

  val safety = TypeOK and NewestNeverDropped and SelectionSubsetOfVisible and ViewerShowsExistingItem
    and NoSpuriousClear and FavoriteReversible and NoSelectionCap and DeleteForeverOnlyFromTrash
    and NoActionOnStaleRevInvariant and FilterIsReadOnlyInvariant and ShareChangesNothingInvariant

  // ---------------------------------------------------------------------------
  // Scenarios
  pure val noFav = Ids.mapBy(i => false)
  pure val allFav = Ids.mapBy(i => true)
  run designWindowTest = StartState(true, true, true, true, noFav)
    .expect(Window == Set(2, 3) and safety)
  run designSelectTrashUndoTest = StartState(true, true, true, true, noFav)
    .then(EnterSelect).then(Toggle(3)).then(Toggle(2)).expect(s.sel == Set(2, 3) and safety)
    .then(BatchTrash).expect(InTrash == Set(2, 3) and Window == Set(1) and safety)
    .then(Undo(3)).expect(Window == Set(1, 3) and safety)
  run designFavToggleTest = StartState(true, true, true, true, allFav)
    .then(EnterSelect).then(SelectAll).then(BatchFavorite).expect(s.fav.get(3) == false and safety)
  run designPatchTest = StartState(true, true, true, true, noFav)
    .then(EnterSelect).then(Toggle(3)).then(Toggle(2)).then(StoreEventWith(1, "edit"))
    .expect(s.selecting and s.sel == Set(2, 3) and safety)
  run designStaleReviewTest = StartState(true, true, true, true, noFav)
    .then(EnterSelect).then(Toggle(3)).then(AgentReview).then(StoreEventWith(3, "edit"))
    .expect(not(ReviewCurrent) and safety)
    .then(AgentReject).expect(s.review == NoReview and s.trashed.get(3) == false and safety)
  run designShareTest = StartState(true, true, true, true, noFav)
    .then(AgentShareReviewOf(3)).then(AgentApply).expect(s.review == NoReview and InTrash == Set() and safety)
  run designReplaceTest = StartState(true, true, true, true, noFav)
    .then(AgentShareReviewOf(3)).then(OpenViewer(3)).then(EditReplace)
    .expect(not(ReviewCurrent) and s.rev.get(3) == 1 and safety)
  run asBuiltWindowTest = StartState(false, true, true, true, noFav)
    .expect(Window == Set(1, 2) and not(NewestNeverDropped))
  run asBuiltPatchTest = StartState(true, false, true, true, noFav)
    .then(EnterSelect).then(Toggle(3)).then(StoreEventWith(1, "edit"))
    .expect(s.sel == Set() and not(NoSpuriousClear))
  run asBuiltFavToggleTest = StartState(true, true, false, true, allFav)
    .then(EnterSelect).then(Toggle(3)).then(BatchFavorite)
    .expect(s.fav.get(3) and not(FavoriteReversible))
  run asBuiltCapTest = StartState(true, true, true, false, noFav)
    .then(EnterSelect).then(Toggle(3)).then(Toggle(2))
    .expect(s.sel == Set(3) and not(NoSelectionCap))
}
