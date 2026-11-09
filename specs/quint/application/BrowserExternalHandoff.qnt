// External browser dispatch is admitted at the final presentation boundary.
module BrowserExternalHandoff {
  type Launch = {tab: str, revision: int, privateConfirmed: bool, approved: bool, exact: bool}
  type State = {privateTab: bool, https: bool, hidden: bool, left: bool, disposed: bool, selected: str,
    revision: int, settled: bool, sharing: bool, confirming: bool, phase: str, menu: bool, clearedGeometry: bool,
    updates: int, reviews: int, requests: int, approved: bool, boundTab: str, boundRevision: int, boundPrivate: bool,
    launches: List[Launch], errors: List[str]}
  var s: State

  pure def initial(privateTab: bool, https: bool): State = {privateTab: privateTab, https: https,
    hidden: false, left: false, disposed: false, selected: "primary", revision: 0, settled: true,
    sharing: false, confirming: false, phase: "idle", menu: true, clearedGeometry: false, updates: 0,
    reviews: 0, requests: 0, approved: false, boundTab: "", boundRevision: 0, boundPrivate: false,
    launches: List(), errors: List()}
  action initPublic = s' = initial(false, true)
  action initPrivate = s' = initial(true, true)
  action initHttp = s' = initial(false, false)
  action init = any {initPublic, initPrivate, initHttp}

  pure def current(state: State): bool =
    not(state.disposed) and not(state.hidden) and not(state.left) and state.selected == state.boundTab
      and (state.boundTab != "primary" or (state.settled and state.revision == state.boundRevision))
  pure def presenting(state: State, phase: str): State =
    {...state, phase: phase, clearedGeometry: true, updates: state.updates + 1}
  pure def cleanup(state: State): State =
    presenting({...state, sharing: false, confirming: false}, "cleanup")
  pure def changed(state: State): State =
    cleanup({...state, errors: state.errors.append("changed")})
  pure def beforeDispatch(state: State): State =
    if (current(state)) presenting(state, "present") else changed(state)

  action start = all {
    s.requests < 3, s.phase != "cleanup",
    val requested = {...s, requests: s.requests + 1}
    s' = if (s.sharing or s.confirming or s.disposed) requested
      else if (s.selected == "primary" and (not(s.https) or not(s.settled)))
        {...requested, boundTab: "", boundRevision: 0, boundPrivate: false, errors: s.errors.append("no-page")}
      else {
        val primary = s.selected == "primary"
        val bound = {...requested, sharing: true, menu: false, approved: false, boundTab: s.selected,
          boundRevision: if (primary) s.revision else 0, boundPrivate: primary and s.privateTab}
        if (bound.boundPrivate) presenting({...bound, confirming: true}, "prepareReview")
        else beforeDispatch(bound)
      },
  }

  action update = all {
    s.phase.in(Set("prepareReview", "present", "cleanup")),
    s' = if (s.phase == "prepareReview") {...s, phase: "review", reviews: s.reviews + 1}
      else if (s.phase == "cleanup") {...s, phase: "idle"}
      else if (current(s)) {...s, phase: "dispatch", launches: s.launches.append(
        {tab: s.boundTab, revision: s.boundRevision, privateConfirmed: s.boundPrivate,
          approved: s.approved, exact: true})}
      else changed(s),
  }
  action review(approved: bool): bool = all {
    s.phase == "review",
    val reviewed = {...s, confirming: false, approved: approved}
    s' = if (approved) beforeDispatch(reviewed) else cleanup(reviewed),
  }
  action complete(accepted: bool): bool = all {
    s.phase == "dispatch",
    s' = cleanup(if (accepted) s else {...s, errors: s.errors.append("refused")}),
  }
  action selectTab(tab: str): bool = all {
    tab.in(Set("primary", "other")), s' = {...s, selected: tab},
  }
  action hide(hidden: bool): bool = s' = {...s, hidden: hidden}
  action leave(left: bool): bool = s' = {...s, left: left}
  action dispose = s' = {...s, disposed: true, settled: false, revision: 0}
  action navigate(settled: bool): bool = all {
    not(s.disposed), s.https, s.revision < 2,
    s' = {...s, settled: settled, revision: s.revision + 1},
  }
  action step = any {
    start, update, review(true), review(false), complete(true), complete(false),
    selectTab("primary"), selectTab("other"), hide(true), hide(false), leave(true), leave(false),
    dispose, navigate(true), navigate(false), s' = s,
  }

  val ExactDispatch = s.launches.foldl(true, (valid, launch) => valid and launch.exact)
  val PrivateDispatchHasApproval = s.launches.foldl(true,
    (valid, launch) => valid and (launch.privateConfirmed implies launch.approved))
  val BusyOwnsPresentation =
    s.sharing == s.phase.in(Set("prepareReview", "review", "present", "dispatch")) and
    s.confirming == s.phase.in(Set("prepareReview", "review"))
  val safety = ExactDispatch and PrivateDispatchHasApproval and BusyOwnsPresentation

  run publicExactDispatchTest = initPublic.then(start).then(update)
    .expect(s.launches.length() == 1 and not(s.launches[0].privateConfirmed) and safety)
    .then(complete(true)).then(update).expect(s.phase == "idle" and s.updates == 2 and safety)
  run privateDuplicateIsSuppressedTest = initPrivate.then(start).then(update).then(start).then(review(true)).then(update)
    .expect(s.reviews == 1 and s.launches.length() == 1 and s.launches[0].approved and safety)
  run privateCancellationRestoresPresentationTest = initPrivate.then(start).then(update).then(review(false)).then(update)
    .expect(s.phase == "idle" and s.launches.length() == 0 and s.updates == 2 and safety)
  run sameAddressRecommitDuringFinalPresentationTest = initPrivate.then(start).then(update).then(review(true))
    .then(navigate(true)).then(update).expect(s.launches.length() == 0 and s.errors == List("changed") and safety)
  run viewDepartureDuringFinalPresentationTest = initPublic.then(start).then(leave(true)).then(update)
    .expect(s.launches.length() == 0 and s.errors == List("changed") and safety)
  run selectedTabChangeBeforeDispatchTest = initPublic.then(start).then(selectTab("other")).then(update)
    .expect(s.launches.length() == 0 and s.errors == List("changed") and safety)
  run hiddenDocumentCannotDispatchTest = initPublic.then(start).then(hide(true)).then(update)
    .expect(s.launches.length() == 0 and s.errors == List("changed") and safety)
  run missingHttpsNeverPreparesTest = initHttp.then(start)
    .expect(s.updates == 0 and s.launches.length() == 0 and s.errors == List("no-page") and safety)
}
