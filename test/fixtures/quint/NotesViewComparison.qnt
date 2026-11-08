// Observation and deterministic initializer aliases over the historical model.
module NotesViewReplay {
  import NotesView as Design from "../../../specs/quint/legacy/NotesView"
  val s = Design::s
  val ProfileSafety = Design::safety
  val OtherRevisionChanged = Design::s.rev.get("n2") != 0
  action TestInit(profile: str): bool = Design::TestInit(profile)
  action Hide = Design::Hide
  action Show = Design::Show
  action TrashNote(note: str): bool = Design::TrashNote(note)
  action Restore(note: str): bool = Design::Restore(note)
  action RenameFolder(folder: str, name: str): bool = Design::RenameFolder(folder, name)
  action DeleteFolder(folder: str): bool = Design::DeleteFolder(folder)
  action Record = Design::Record
  action Segment = Design::Segment
  action Pause = Design::Pause
  action Resume = Design::Resume
  action Stop = Design::Stop
}
