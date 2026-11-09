// One admitted App info request through the mounted drawer, Capacitor and the Java bridge.
module AppInfoHandoffComposition {
  type Target = {packageName: str, activityName: str, user: str}
  type Platform = {personal: str, work: str, profile: str, launch: str}
  type Reply = {resolved: bool, code: str, message: str, queryPackage: str, queryUser: int,
    queryFlags: int, launchUser: int, intentAction: str, intentFlags: int, target: str, opened: bool}
  type Notice = {app: int, message: str}
  type State = {open: bool, inventory: Set[int], staged: Set[int], menu: int, listReads: int,
    selected: int, phase: str, request: Target, platform: Platform, reply: Reply, notice: Notice}
  var s: State

  val apps = Set(1, 2)
  val packages = Set("enabled", "disabled", "removed", "denied")
  val profiles = Set("present", "paused", "locked", "removed", "denied")
  val launchOutcomes = Set("allowed", "argument", "runtime")
  val noTarget = {packageName: "", activityName: "", user: ""}
  val noNotice = {app: 0, message: ""}
  val noReply = {resolved: false, code: "", message: "", queryPackage: "", queryUser: -1,
    queryFlags: 0, launchUser: -1, intentAction: "", intentFlags: 0, target: "", opened: false}

  pure def target(app: int): Target =
    if (app == 1) {packageName: "org.fixture.clock", activityName: "org.fixture.clock.Main", user: ""}
    else {packageName: "org.fixture.mail", activityName: "org.fixture.mail.Main", user: "270"}

  pure def dispatch(app: int, request: Target, platform: Platform): Reply = {
    val work = app == 2
    val status = if (work) platform.work else platform.personal
    val failed = { ...noReply, code: "failed", message: "App info could not be opened" }
    val query = { ...noReply, queryPackage: request.packageName, queryUser: if (work) 27 else -1, queryFlags: 512 }
    if (work and platform.profile == "removed")
      { ...noReply, code: "profile-unavailable", message: "This profile is no longer on the phone." }
    else if (work and platform.profile == "denied") failed
    else if (status == "removed") { ...query, code: "not-installed",
      message: if (work) "This app is no longer available in that profile." else "This app is no longer installed." }
    else if (status == "denied") { ...query, code: failed.code, message: failed.message }
    else {
      val accepted = platform.launch == "allowed"
      val invalid = platform.launch == "argument"
      { ...query, resolved: accepted, opened: accepted, launchUser: if (work) 27 else -1,
        code: if (accepted or invalid) "" else failed.code,
        message: if (accepted) "" else if (invalid) "Choose an installed app" else failed.message,
        intentAction: if (work) "" else "android.settings.APPLICATION_DETAILS_SETTINGS",
        intentFlags: if (work) 0 else 268435456,
        target: if (work) "org.fixture.mail/org.fixture.mail.Main" else "package:org.fixture.clock" }
    }
  }

  action init = s' = {open: false, inventory: apps, staged: apps, menu: 0, listReads: 0,
    selected: 0, phase: "idle", request: noTarget, reply: noReply, notice: noNotice,
    platform: {personal: "enabled", work: "enabled", profile: "present", launch: "allowed"}}
  action openDrawer = all {
    not(s.open), s.listReads < 6,
    s' = { ...s, open: true, inventory: s.staged, listReads: s.listReads + 1 }
  }
  action closeDrawer = all {s.open, s' = { ...s, open: false, menu: 0 }}
  action openMenu(app: int): bool = all {
    s.open, s.inventory.contains(app), s' = { ...s, menu: app }
  }
  action stageInventory(available: Set[int]): bool = all {
    available.subseteq(apps), s' = { ...s, staged: available }
  }
  action setPackageState(app: int, status: str): bool = all {
    apps.contains(app), packages.contains(status),
    s' = { ...s, platform: if (app == 1) { ...s.platform, personal: status } else { ...s.platform, work: status } }
  }
  action setProfile(profile: str): bool = all {
    profiles.contains(profile), s' = { ...s, platform: { ...s.platform, profile: profile } }
  }
  action setLaunch(outcome: str): bool = all {
    launchOutcomes.contains(outcome), s' = { ...s, platform: { ...s.platform, launch: outcome } }
  }
  action requestAppInfo = all {
    s.menu != 0, s.phase.in(Set("idle", "settled")),
    s' = { ...s, selected: s.menu, menu: 0, phase: "queued", request: target(s.menu), reply: noReply }
  }
  action dispatchNative = all {
    s.phase == "queued", s' = { ...s, phase: "answered", reply: dispatch(s.selected, s.request, s.platform) }
  }
  action deliverNative = all {
    s.phase == "answered", s.reply.resolved or s.listReads < 6,
    s' = if (s.reply.resolved) { ...s, phase: "settled" }
    else { ...s, phase: "settled", notice: {app: s.selected, message: s.reply.message},
      listReads: s.listReads + 1, inventory: s.staged, menu: if (s.staged.contains(s.menu)) s.menu else 0 }
  }

  val ExactBridgeTarget = (s.selected == 0 and s.request == noTarget)
    or (apps.contains(s.selected) and s.request == target(s.selected))
  val SameProfileForQueryAndSettings = all {
    s.reply.queryPackage != "" implies (s.reply.queryPackage == s.request.packageName
      and s.reply.queryUser == (if (s.selected == 2) 27 else -1) and s.reply.queryFlags == 512),
    s.reply.target != "" implies (s.reply.queryPackage == s.request.packageName
      and s.reply.launchUser == s.reply.queryUser and s.reply.target ==
        (if (s.selected == 2) "org.fixture.mail/org.fixture.mail.Main" else "package:org.fixture.clock"))
  }
  val RefusedLookupHasNoDispatch = s.reply.code.in(Set("not-installed", "profile-unavailable"))
    implies s.reply.target == ""
  val FailedReplyKeepsNoticeOwner = (s.phase == "settled" and not(s.reply.resolved))
    implies s.notice == {app: s.selected, message: s.reply.message}
  val safety = ExactBridgeTarget and SameProfileForQueryAndSettings and RefusedLookupHasNoDispatch
    and FailedReplyKeepsNoticeOwner and (s.reply.resolved iff s.reply.opened)
    and (s.menu != 0 implies (s.open and s.inventory.contains(s.menu)))

  action step = any {
    openDrawer, closeDrawer,
    nondet app = apps.oneOf()
    openMenu(app),
    nondet available = apps.powerset().oneOf()
    stageInventory(available),
    nondet app = apps.oneOf()
    nondet status = packages.oneOf()
    setPackageState(app, status),
    nondet profile = profiles.oneOf()
    setProfile(profile),
    nondet outcome = launchOutcomes.oneOf()
    setLaunch(outcome),
    requestAppInfo, dispatchNative, deliverNative, s' = s
  }

  run personalDetailsDeliverWithoutRefreshTest = init.then(openDrawer).then(openMenu(1)).then(requestAppInfo)
    .then(dispatchNative).then(deliverNative).expect(s.reply.opened and s.notice == noNotice and s.listReads == 1)
  run removedWorkPackageRefreshesPublishedInventoryTest = init.then(openDrawer).then(openMenu(2)).then(requestAppInfo)
    .then(setPackageState(2, "removed")).then(stageInventory(Set(1))).then(dispatchNative).then(deliverNative)
    .expect(s.reply.target == "" and s.notice.app == 2 and s.listReads == 2 and s.inventory == Set(1))
  run retiredDrawerReplyLeavesNewMenuTest = init.then(openDrawer).then(openMenu(2)).then(requestAppInfo)
    .then(setProfile("removed")).then(dispatchNative).then(closeDrawer).then(openDrawer).then(openMenu(1)).then(deliverNative)
    .expect(s.notice.app == 2 and s.menu == 1 and s.reply.queryPackage == "")
  run acceptedDispatchRemainsTheSameReplyTest = init.then(openDrawer).then(openMenu(2)).then(requestAppInfo)
    .then(dispatchNative).then(setProfile("removed")).then(deliverNative)
    .expect(s.reply.opened and s.notice == noNotice and s.listReads == 1 and s.reply.launchUser == 27)
}
