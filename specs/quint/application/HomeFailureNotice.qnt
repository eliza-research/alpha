// Home's projection of shared launcher failures into its notice surface.
module HomeFailureNotice {
  type Notice = {surface: str, kind: str}
  type State = {surface: str, seenStatus: str, seenError: str, seenApps: int,
    launchReported: bool, notices: List[Notice]}
  var s: State
  pure val Surfaces = Set("home", "drawer", "app", "edit")
  pure val Statuses = Set("idle", "loading", "ready", "failed")
  pure val Errors = Set("", "launch-paused", "launch-disabled", "stale-app", "favorites")
  action init = s' = {surface: "home", seenStatus: "ready", seenError: "", seenApps: 1,
    launchReported: false, notices: List()}
  action show(surface: str): bool = all {Surfaces.contains(surface), s' = {...s, surface: surface}}
  action report(status: str, error: str, apps: int, missingFavorite: bool): bool = all {
    Statuses.contains(status), Errors.contains(error), apps.in(s.seenApps.to(s.seenApps + 1)), apps <= 8,
    s.notices.length() < 6,
    val read = apps != s.seenApps
    val afterLaunch = s.launchReported and read
    val errorToast = s.surface == "home" and error != "" and error != s.seenError
    val inventoryToast = s.surface == "home" and not(errorToast) and status == "failed"
      and s.seenStatus != "failed" and not(afterLaunch) and missingFavorite
    val notice = if (errorToast) error else if (inventoryToast) "inventory" else ""
    s' = {...s, seenStatus: status, seenError: error, seenApps: apps,
      launchReported: errorToast or (not(read) and s.launchReported),
      notices: if (notice == "") s.notices else s.notices.append({surface: s.surface, kind: notice})}
  }
  action step = any {
    {nondet surface = Surfaces.oneOf(); show(surface)},
    {nondet status = Statuses.oneOf(); nondet error = Errors.oneOf(); nondet apps = s.seenApps.to(s.seenApps + 1).oneOf();
      nondet missing = Bool.oneOf(); report(status, error, apps, missing)},
    s' = s,
  }
  val TypeOK = Surfaces.contains(s.surface) and Statuses.contains(s.seenStatus) and Errors.contains(s.seenError)
    and s.seenApps.in(1.to(8)) and s.notices.length() <= 6
  val OnlyHomeToasts = s.notices.indices().forall(i => s.notices.nth(i).surface == "home")
  val safety = TypeOK and OnlyHomeToasts
  run failedInventoryReportsOnceTest = init.then(report("failed", "", 2, true)).then(report("failed", "", 3, true))
    .expect(s.notices == List({surface: "home", kind: "inventory"}) and safety)
  run followupReadDoesNotDuplicateLaunchTest = init.then(report("ready", "launch-paused", 1, false))
    .then(report("failed", "launch-paused", 2, true)).expect(s.notices == List({surface: "home", kind: "launch-paused"}) and not(s.launchReported) and safety)
  run drawerAndOtherViewsOwnTheirErrorsTest = init.then(show("drawer")).then(report("ready", "launch-disabled", 1, false))
    .then(show("app")).then(report("failed", "launch-disabled", 2, true)).expect(s.notices == List() and safety)
  run recoveryPermitsNewInventoryNoticeTest = init.then(report("failed", "", 2, true)).then(report("ready", "", 3, false))
    .then(report("failed", "", 4, true)).expect(s.notices.length() == 2 and safety)
}
