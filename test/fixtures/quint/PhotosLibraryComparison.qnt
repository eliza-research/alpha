// Aliases and a deterministic existing StoreEvent branch for source replay.
module PhotosLibraryReplay {
  import PhotosLibrary as Design from "../../../specs/quint/legacy/PhotosLibrary"
  val s = Design::s
  val Window = Design::Window
  val Live = Design::Live
  val InTrash = Design::InTrash
  val Favorite1 = Design::s.fav.get(1)
  val Favorite2 = Design::s.fav.get(2)
  val Favorite3 = Design::s.fav.get(3)
  val Revision1 = Design::s.rev.get(1)
  val Revision2 = Design::s.rev.get(2)
  val Revision3 = Design::s.rev.get(3)
  val Reviewed = Design::s.review.ids != Set()
  val ProfileSafety = Design::safety
  action TestInit(profile: str): bool = Design::TestInit(profile)
  action EnterSelect = Design::EnterSelect
  action Toggle(i: int): bool = Design::Toggle(i)
  action BatchFavorite = Design::BatchFavorite
  action BatchTrash = Design::BatchTrash
  action BatchRestore = Design::BatchRestore
  action DeleteForever = Design::DeleteForever
  action SwitchTab(tab: str): bool = Design::SwitchTab(tab)
  action Remove(i: int): bool = Design::Remove(i)
  action OpenViewer(i: int): bool = Design::OpenViewer(i)
  action Swipe(i: int): bool = Design::Swipe(i)
  action CloseViewer = Design::CloseViewer
  action AgentFilter(filterValue: str): bool = Design::AgentFilter(filterValue)
  action AgentOpen(i: int): bool = Design::AgentOpen(i)
  action ShareReview(i: int): bool = Design::ShareReview(i)
  action AgentApply = Design::AgentApply
  action AgentReject = Design::AgentReject
  action EditReplace = Design::EditReplace
  // The second branch of the original StoreEvent, without nondeterministically
  // choosing deletion or insertion while replaying an observed favorite change.
  action StoreFavorite(i: int): bool = all {
    Design::s.budget > 0,
    Design::s.exists.get(i),
    Design::Track(Design::eventPatched(Design::s, { ...Design::s,
      budget: Design::s.budget - 1,
      rev: Design::bump(Design::s.rev, i),
      fav: Design::s.fav.set(i, not(Design::s.fav.get(i))) }, i))
  }
}
