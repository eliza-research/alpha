// Replay aliases for scalar trace arguments. The historical designs and their
// transition relation remain in SettingsNav.
module SettingsNavProposedReplay {
  import SettingsNav as Design from "../SettingsNav"
  val s = Design::s
  val ProfileSafety = Design::safety
  val NoInfoRows = Design::NoInfoRows
  action init = Design::checkerInit
  action Open(label: str, kind: str, target: str): bool = Design::Open((label, kind, target))
  action Destroy(label: str, kind: str, target: str): bool = Design::Destroy((label, kind, target))
  action Back = Design::Back
  action Answer = Design::Answer
}

module SettingsNavCurrentReplay {
  import SettingsNav as Design from "../SettingsNav"
  val s = Design::s
  val ProfileSafety = Design::TypeOK and Design::AtMostOneStatus and Design::NoEmptyPages and Design::Shallow
  pure val HasTopWifi = Design::CurTop.contains(("Wi-Fi", "nav", "wifi"))
  action init = Design::checkerCurrentInit
  action Open(label: str, kind: str, target: str): bool = Design::Open((label, kind, target))
  action Destroy(label: str, kind: str, target: str): bool = Design::Destroy((label, kind, target))
  action Back = Design::Back
  action Answer = Design::Answer
}
