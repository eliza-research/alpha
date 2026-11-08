// Replay names for the original actions and its existing cloud-fault branch.
module MapsReplay {
  import Maps as Design from "../../../specs/quint/legacy/Maps"
  val s = Design::s
  val ProfileSafety = Design::safety
  action StartState(profile: str, net: str, plan: str, cloud: str): bool =
    Design::StartState(profile, net, plan, cloud)
  action OpenMaps = Design::OpenMaps
  action Connect = Design::Connect
  action Connected = Design::Connected
  action Heal = Design::Heal
  action Search = Design::Search
  action PickPlace = Design::PickPlace
  action Directions = Design::Directions
  action Start = Design::Start
  action Arrive = Design::Arrive
  action Back = Design::Back
  action OpenAssistant = Design::OpenAssistant
  action CloseAssistant = Design::CloseAssistant
  action OffRoute = Design::OffRoute
  action CloudFault = all {
    Design::s.faults < Design::MaxFaults,
    Design::s.cloud == "ok",
    Design::Track({ ...Design::s, cloud: "down", faults: Design::s.faults + 1,
      session: if (Design::s.session == "ready") "error" else Design::s.session })
  }
}
