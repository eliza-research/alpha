// The historical current design deliberately violates the proposed safety suite.
// These aliases replay its exact actions while checking the invariants that the
// original current profile expects to hold.
module ChatInputCurrentComparison {
  import ChatInput as Original from "../ChatInput"

  val s = Original::s
  val CurrentGuarded = Original::Guarded
  val CurrentSafety = Original::TypeOK and Original::DraftKept and Original::FocusNeedsComposer
  action init = Original::currentInit
  action FocusComposer = Original::FocusComposer
  action TypeText = Original::TypeText
  action TapOutside = Original::TapOutside
  action TapType = Original::TapType
  action ImeHide = Original::ImeHide
  action Back = Original::Back
  action OpenView(view: str): bool = Original::OpenView(view)
  action SwipeUp(origin: str): bool = Original::SwipeUp(origin)
}
