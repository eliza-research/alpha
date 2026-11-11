// Replay aliases preserve the historical actions and design-specific predicates.
module HomeLayoutCurrentReplay {
  import HomeLayout as Design from "../../../specs/quint/legacy/HomeLayout"
  var cachedEvent: bool
  val s = Design::s
  val Shown = (if (s.cal == "event" or cachedEvent) Set("calendar") else Set())
    .union(if (s.flows == "active") Set("workflows") else Set())
    .union(if (s.mail == "unread") Set("inbox") else Set())
    .union(if (s.brief) Set("brief") else Set())
  val CoreShown = Shown.exclude(Set("brief"))
  val DateLine = Design::DateLine
  val SetupLink = Design::SetupLink
  val GridStable = Design::GridStable
  val ProfileSafety = Design::TypeOK and Design::TopNeverBlank and Design::SetupOnlyWhenNeeded
  action init = all {Design::checkerCurrentInit, cachedEvent' = false}
  action CalendarSource(c: str): bool = all {Design::CalendarSource(c), cachedEvent' = if (c == "event") true else if (c == "none" or c == "denied") false else cachedEvent}
  action WorkflowSource(f: str): bool = all {Design::WorkflowSource(f), cachedEvent' = cachedEvent}
  action MailSource(m: str): bool = all {Design::MailSource(m), cachedEvent' = cachedEvent}
  action BriefSource = all {Design::BriefSource, cachedEvent' = cachedEvent}
  action InsetsArrive = all {Design::InsetsArrive, cachedEvent' = cachedEvent}
  action ChangeDock(d: str): bool = all {Design::ChangeDock(d), cachedEvent' = cachedEvent}
}
