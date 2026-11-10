// Current volume-based Files browser and identity-bound agent moves.
// The finite names, folders and external-change budget follow the reviewed
// files-browser design model with its fixes enabled.
module FilesTree {
  pure val Files = Set(1, 2, 3)
  pure val Folders = Set(10, 20, 30)
  pure val Names = Set(1, 2, 3)
  pure val Gone = 0
  pure val Trash = -1
  type Review = { file: int, from: int, to: int, revision: int }
  pure val NoReview = { file: 0, from: 0, to: 0, revision: 0 }
  type State = {
    locations: int -> int, origins: int -> int, names: int -> int,
    revisions: int -> int, selected: Set[int], folder: int, stale: bool,
    access: bool, review: Review, permanentReview: int, budget: int,
    lastAppliedRevision: int, lastReviewedRevision: int, lost: bool
  }
  var s: State
  action init = s' = {
    locations: Map(1 -> 20, 2 -> 10, 3 -> Gone),
    origins: Map(1 -> 20, 2 -> 10, 3 -> 30),
    names: Files.mapBy(_ => 1), revisions: Files.mapBy(_ => 0),
    selected: Set(), folder: 10, stale: false, access: false,
    review: NoReview, permanentReview: 0, budget: 3,
    lastAppliedRevision: 0, lastReviewedRevision: 0, lost: false
  }
  val present = Files.filter(file => Folders.contains(s.locations.get(file)))
  def listing(folder: int): Set[int] = present.filter(file => s.locations.get(file) == folder)
  def category(kind: str): Set[int] = present.filter(file =>
    if (kind == "downloads") s.locations.get(file) == 10
    else if (kind == "images") file == 1
    else if (kind == "documents") file != 1
    else false)
  def freeNames(file: int, folder: int): Set[int] = Names.exclude(
    present.filter(other => other != file and s.locations.get(other) == folder)
      .map(other => s.names.get(other)))
  pure def moved(value: State, file: int, folder: int, name: int): State = {
    ...value, locations: value.locations.set(file, folder),
    origins: value.origins.set(file, folder), names: value.names.set(file, name),
    selected: value.selected.exclude(Set(file)),
    lost: value.lost or Files.exists(other => other != file and
      value.locations.get(other) == folder and value.names.get(other) == name)
  }
  action grantAccess = s' = { ...s, access: true, selected: Set(), review: NoReview }
  action revokeAccess = s' = {
    ...s, access: false, selected: Set(), review: NoReview, permanentReview: 0
  }
  action navigate(folder: int): bool = all {
    s.access, Folders.contains(folder),
    s' = { ...s, folder: folder, selected: Set() }
  }
  action toggle(file: int): bool = all {
    s.access, listing(s.folder).contains(file),
    s' = { ...s, selected: if (s.selected.contains(file))
      s.selected.exclude(Set(file)) else s.selected.union(Set(file)) }
  }
  action moveSelection(folder: int): bool = all {
    s.access, Folders.contains(folder), folder != s.folder, s.selected.size() == 1,
    {
      nondet file = s.selected.oneOf()
      nondet replacement = freeNames(file, folder).oneOf()
      val name = if (freeNames(file, folder).contains(s.names.get(file))) s.names.get(file) else replacement
      s' = if (s.locations.get(file) == s.folder)
        moved(s, file, folder, name) else { ...s, selected: Set() }
    }
  }
  action trashSelection = all {
    s.access, s.selected != Set(),
    {
      val removed = s.selected.intersect(listing(s.folder))
      s' = { ...s, locations: Files.mapBy(file =>
        if (removed.contains(file)) Trash else s.locations.get(file)),
        origins: Files.mapBy(file =>
          if (removed.contains(file)) s.folder else s.origins.get(file)),
        selected: Set() }
    }
  }
  action restore(file: int): bool = all {
    s.access, Files.contains(file), s.locations.get(file) == Trash,
    {
      nondet replacement = freeNames(file, s.origins.get(file)).oneOf()
      val name = if (freeNames(file, s.origins.get(file)).contains(s.names.get(file))) s.names.get(file) else replacement
      s' = moved(s, file, s.origins.get(file), name)
    }
  }
  action reviewPermanent(file: int): bool = all {
    s.access, Files.contains(file), s.locations.get(file) == Trash,
    s' = { ...s, permanentReview: file }
  }
  action confirmPermanent = all {
    s.access, Files.contains(s.permanentReview), s.locations.get(s.permanentReview) == Trash,
    s' = { ...s, locations: s.locations.set(s.permanentReview, Gone), permanentReview: 0 }
  }
  action externalCreate(file: int, folder: int): bool = all {
    Files.contains(file), Folders.contains(folder), s.locations.get(file) == Gone, s.budget > 0,
    {
      nondet replacement = freeNames(file, folder).oneOf()
      val name = if (freeNames(file, folder).contains(s.names.get(file))) s.names.get(file) else replacement
      s' = { ...s, locations: s.locations.set(file, folder),
        origins: s.origins.set(file, folder), names: s.names.set(file, name),
        revisions: s.revisions.set(file, s.revisions.get(file) + 1),
        stale: true, budget: s.budget - 1 }
    }
  }
  action externalRemove(file: int): bool = all {
    present.contains(file), s.budget > 0,
    s' = { ...s, locations: s.locations.set(file, Gone), stale: true, budget: s.budget - 1 }
  }
  action externalEdit(file: int): bool = all {
    present.contains(file), s.budget > 0,
    s' = { ...s, revisions: s.revisions.set(file, s.revisions.get(file) + 1),
      stale: true, budget: s.budget - 1 }
  }
  action refresh = all {
    s.access, s.stale,
    s' = { ...s, stale: false, selected: s.selected.intersect(listing(s.folder)) }
  }
  action proposeMove(file: int, folder: int): bool = all {
    s.access, s.review == NoReview, present.contains(file),
    Folders.contains(folder), s.locations.get(file) != folder,
    s' = { ...s, review: {file: file, from: s.locations.get(file), to: folder,
      revision: s.revisions.get(file)} }
  }
  val reviewCurrent = if (s.review == NoReview) false else
    s.locations.get(s.review.file) == s.review.from and
    s.revisions.get(s.review.file) == s.review.revision
  action applyMove = all {
    s.access, reviewCurrent,
    {
      nondet replacement = freeNames(s.review.file, s.review.to).oneOf()
      val name = if (freeNames(s.review.file, s.review.to).contains(s.names.get(s.review.file))) s.names.get(s.review.file) else replacement
      s' = { ...moved(s, s.review.file, s.review.to, name), review: NoReview,
        lastAppliedRevision: s.revisions.get(s.review.file),
        lastReviewedRevision: s.review.revision }
    }
  }
  action refuseMove = all {
    s.review != NoReview, not(reviewCurrent), s' = { ...s, review: NoReview }
  }
  action rejectMove = all { s.review != NoReview, s' = { ...s, review: NoReview } }
  action step = any {
    grantAccess, revokeAccess, trashSelection, confirmPermanent, refresh,
    applyMove, refuseMove, rejectMove,
    { nondet folder = Folders.oneOf(); navigate(folder) },
    { nondet folder = Folders.oneOf(); moveSelection(folder) },
    { nondet file = Files.oneOf(); toggle(file) },
    { nondet file = Files.oneOf(); restore(file) },
    { nondet file = Files.oneOf(); reviewPermanent(file) },
    { nondet file = Files.oneOf(); externalRemove(file) },
    { nondet file = Files.oneOf(); externalEdit(file) },
    { nondet file = Files.oneOf(); nondet folder = Folders.oneOf(); externalCreate(file, folder) },
    { nondet file = Files.oneOf(); nondet folder = Folders.oneOf(); proposeMove(file, folder) },
    s' = s
  }
  val CategoryIsQuery = category("downloads") == listing(10) and
    category("images").subseteq(present) and category("documents").subseteq(present)
  val NamesUniquePerFolder = present.forall(file => present.forall(other =>
    file == other or s.locations.get(file) != s.locations.get(other) or s.names.get(file) != s.names.get(other)))
  val NoOverwriteWithoutConfirm = not(s.lost)
  val SelectionExists = not(s.stale) implies s.selected.subseteq(listing(s.folder))
  val TrashReversible = Files.forall(file => s.locations.get(file) == Trash implies Folders.contains(s.origins.get(file)))
  val AgentMoveOnlyReviewed = s.lastAppliedRevision == s.lastReviewedRevision
  val RevokedSelectionEmpty = not(s.access) implies s.selected == Set() and s.review == NoReview
  val TypeOK = s.locations.keys() == Files and s.origins.keys() == Files and
    s.names.keys() == Files and s.revisions.keys() == Files and Folders.contains(s.folder) and
    s.selected.subseteq(Files) and s.budget.in(0.to(3)) and
    Files.forall(file => s.locations.get(file).in(Folders.union(Set(Gone, Trash))) and
      Names.contains(s.names.get(file)) and s.revisions.get(file).in(0.to(3)))
  val safety = CategoryIsQuery and NamesUniquePerFolder and NoOverwriteWithoutConfirm and
    SelectionExists and TrashReversible and AgentMoveOnlyReviewed and RevokedSelectionEmpty and TypeOK
  run categoriesTest = init.then(grantAccess)
    .expect(category("downloads") == Set(2) and category("images") == Set(1) and safety)
  run collisionKeepsBothTest = init.then(grantAccess).then(navigate(20)).then(toggle(1))
    .then(moveSelection(10)).expect(s.locations.get(1) == 10 and s.locations.get(2) == 10 and
      s.names.get(1) != s.names.get(2) and safety)
  run trashRestoreCollisionTest = init.then(grantAccess).then(toggle(2)).then(trashSelection)
    .then(externalCreate(3, 10)).then(restore(2))
    .expect(s.locations.get(2) == 10 and s.locations.get(3) == 10 and s.names.get(2) != s.names.get(3) and safety)
  run staleReviewedIdentityTest = init.then(grantAccess).then(proposeMove(1, 10))
    .then(externalEdit(1)).then(refuseMove).expect(s.locations.get(1) == 20 and s.review == NoReview and safety)
  run missingSelectionTest = init.then(grantAccess).then(toggle(2)).then(externalRemove(2))
    .then(trashSelection).expect(s.locations.get(2) == Gone and s.selected == Set() and safety)
  run revokedReviewTest = init.then(grantAccess).then(proposeMove(1, 10)).then(revokeAccess)
    .expect(s.review == NoReview and s.selected == Set() and safety)
  run permanentTrashReviewTest = init.then(grantAccess).then(toggle(2)).then(trashSelection)
    .then(reviewPermanent(2)).then(confirmPermanent).expect(s.locations.get(2) == Gone and safety)
  run selectionRefreshTest = init.then(grantAccess).then(toggle(2)).then(externalRemove(2))
    .then(refresh).expect(s.selected == Set() and not(s.stale) and safety)
}
