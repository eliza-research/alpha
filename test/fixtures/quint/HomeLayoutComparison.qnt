// Replay aliases preserve the historical actions and design-specific predicates.
module HomeLayoutCurrentReplay {
  import HomeLayout as Design from "../../../specs/quint/legacy/HomeLayout"
  val s = Design::s
  val Shown = Design::Shown
  val CoreShown = Design::Shown.exclude(Set("brief"))
  val DateLine = Design::DateLine
  val SetupLink = Design::SetupLink
  val GridStable = Design::GridStable
  val ProfileSafety = Design::TypeOK and Design::TopNeverBlank and Design::SetupOnlyWhenNeeded
  action init = Design::checkerCurrentInit
  action CalendarSource(c: str): bool = Design::CalendarSource(c)
  action WorkflowSource(f: str): bool = Design::WorkflowSource(f)
  action MailSource(m: str): bool = Design::MailSource(m)
  action BriefSource = Design::BriefSource
  action InsetsArrive = Design::InsetsArrive
  action ChangeDock(d: str): bool = Design::ChangeDock(d)
}
