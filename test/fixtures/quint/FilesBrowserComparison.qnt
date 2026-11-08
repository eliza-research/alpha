// Replay names for observations over the unchanged historical profiles.
module FilesBrowserReplay {
  import FilesBrowser as Design from "../../../specs/quint/legacy/FilesBrowser"
  val s = Design::s
  val Downloads = Design::Category("Downloads")
  val Images = Design::Category("Images")
  val Documents = Design::Category("Documents")
  val Audio = Design::Category("Audio")
  val PhotoName = Design::s.name.get("photo")
  val PdfName = Design::s.name.get("pdf")
  val PhotoVersion = Design::s.ver.get("photo")
  val PhotoOrigin = Design::s.origin.get("photo")
  val ProfileSafety = Design::safety
  action TestInit(profile: str): bool = Design::TestInit(profile)
  action Navigate(directory: str): bool = Design::Navigate(directory)
  action Toggle(file: str): bool = Design::Toggle(file)
  action MoveSel(directory: str): bool = Design::MoveSel(directory)
  action TrashSel = Design::TrashSel
  action Restore(file: str): bool = Design::Restore(file)
  action EmptyTrash(file: str): bool = Design::EmptyTrash(file)
  action AgentPropose(file: str, directory: str): bool = Design::AgentPropose(file, directory)
  action AgentApply = Design::AgentApply
  action AgentRefused = Design::AgentRefused
  action Rewrite(file: str): bool = Design::Rewrite(file)
  action Remove(file: str): bool = Design::Remove(file)
  action Refresh = Design::Refresh
}
