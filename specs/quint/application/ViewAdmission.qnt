/// Image-only views admitted at runtime: the shell's stored view, the view it reports, the view
/// order and the image's Contacts capability.
module ViewAdmission {
  type State = {
    // The view the shell stores, and whether Contacts is enabled and listed in the view order.
    rawView: str, admitted: bool, ordered: bool,
    // What the image reports now; the shell learns it on the next refresh.
    capability: bool, leaves: int, refreshes: int
  }
  var s: State
  action init = s' = { rawView: "home", admitted: false, ordered: false, capability: false, leaves: 0, refreshes: 0 }
  /// A deferred view reads as no view, which renders Home.
  pure def reported(v: State): str = if (v.rawView == "contacts" and not(v.admitted)) "none" else v.rawView
  /// Only an enabled view can be opened.
  action navigate(view: str): bool = all {
    view.in(Set("home", "notes", "contacts")), view != "contacts" or s.admitted,
    s' = { ...s, rawView: view, leaves: if (s.rawView == "contacts" and view != "contacts" and s.leaves < 3) s.leaves + 1 else s.leaves }
  }
  action capabilityChanges = s' = { ...s, capability: not(s.capability) }
  /// The refresh on start and on every return to the app. A shell showing Contacts leaves it
  /// while the view is still enabled; then the admission and the view order follow the image.
  action refreshImage = all {
    s.refreshes < 6,
    val leaving = not(s.capability) and reported(s) == "contacts"
    s' = { ...s, refreshes: s.refreshes + 1, admitted: s.capability, ordered: s.capability,
      rawView: if (leaving) "home" else s.rawView,
      leaves: if (leaving and s.leaves < 3) s.leaves + 1 else s.leaves }
  }
  action step = {
    nondet view = Set("home", "notes", "contacts").oneOf()
    any { navigate(view), capabilityChanges, refreshImage, s' = s }
  }
  /// The stored view is never a deferred view, so nothing is unmasked when the view is admitted again.
  val RawViewNeverDeferred = s.rawView == "contacts" implies s.admitted
  val ReportedMatchesRaw = reported(s) == s.rawView
  val OrderMatchesAdmission = s.ordered == s.admitted
  val TypeOK = s.rawView.in(Set("home", "notes", "contacts")) and s.leaves.in(0.to(3)) and s.refreshes.in(0.to(6))
  val safety = TypeOK and RawViewNeverDeferred and ReportedMatchesRaw and OrderMatchesAdmission

  val ContactsOpenWitness = s.rawView == "contacts"
  val RevokedWhileOpenWitness = s.rawView == "contacts" and not(s.capability)
  val RevokedAndLeftWitness = not(s.admitted) and s.leaves > 0 and s.rawView == "home"

  /// The image withdraws Contacts while the view is open: the shell goes Home through the view's
  /// leave path, and re-admission later does not bring Contacts back by itself.
  run revokedWhileOpenTest = init.then(capabilityChanges).then(refreshImage).then(navigate("contacts"))
    .then(capabilityChanges).expect(RevokedWhileOpenWitness and safety)
    .then(refreshImage).expect(RevokedAndLeftWitness and s.leaves == 1 and not(s.ordered) and safety)
    .then(capabilityChanges).then(refreshImage)
    .expect(s.rawView == "home" and s.admitted and s.ordered and safety)
  run deferredViewCannotOpenTest = init.then(navigate("contacts").fail())
  /// The capability alone admits nothing until the shell has refreshed.
  run unrefreshedCapabilityTest = init.then(capabilityChanges).then(navigate("contacts").fail())
  run admittedViewOpensTest = init.then(capabilityChanges)
    .then(refreshImage).then(navigate("contacts")).expect(ContactsOpenWitness and safety)
    .then(navigate("notes")).expect(s.leaves == 1 and safety)
  run revokedElsewhereTest = init.then(capabilityChanges).then(refreshImage).then(navigate("notes"))
    .then(capabilityChanges).then(refreshImage).expect(s.rawView == "notes" and s.leaves == 0 and not(s.admitted) and safety)
}
