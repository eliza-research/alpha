// A selected launcher entry may disappear before App info reaches Android.
module NativeAppInfoHandoff {
  type Reply = {result: str, query: str, queryUser: int, includeDisabled: bool,
    attempt: str, launchUser: int, target: str, intentAction: str, newTask: bool, opened: bool}
  type State = {entry: str, personalStatus: str, workStatus: str, profile: str, launch: str, reply: Reply}
  var s: State

  val personalEntries = Set("personal", "nullUser")
  val workEntries = Set("work", "workNoActivity", "workEmptyActivity", "workNullActivity")
  val invalidEntries = Set("ownPackage", "missingPackage", "nullPackage", "emptyPackage", "numericPackage",
    "numericActivity", "numericUser", "badSerial")
  val entries = personalEntries.union(workEntries).union(invalidEntries).union(Set("currentProfile"))
  val visibleProfiles = Set("present", "paused", "locked")
  val profiles = visibleProfiles.union(Set("removed", "unmapped", "noUsers", "noLauncher", "denied"))
  val statuses = Set("enabled", "disabled", "removed", "denied")
  val launches = Set("allowed", "argument", "runtime")
  val settingsAction = "android.settings.APPLICATION_DETAILS_SETTINGS"

  pure def reply(result: str): Reply = {
    result: result, query: "none", queryUser: -1, includeDisabled: false,
    attempt: "none", launchUser: -1, target: "", intentAction: "", newTask: false, opened: false
  }

  action init = s' = {entry: "personal", personalStatus: "enabled", workStatus: "enabled",
    profile: "present", launch: "allowed", reply: reply("none")}
  action selectEntry(entry: str): bool = all {
    entries.contains(entry), s' = { ...s, entry: entry, reply: reply("none") }
  }
  action setPersonalStatus(status: str): bool = all {
    statuses.contains(status), s' = { ...s, personalStatus: status }
  }
  action setWorkStatus(status: str): bool = all {
    statuses.contains(status), s' = { ...s, workStatus: status }
  }
  action setProfile(profile: str): bool = all {
    profiles.contains(profile), s' = { ...s, profile: profile }
  }
  action setLaunch(launch: str): bool = all {
    launches.contains(launch), s' = { ...s, launch: launch }
  }

  pure def dispatch(state: State, personal: bool): Reply = {
    val route = if (personal) "personal" else "work"
    val user = if (personal) -1 else 27
    val status = if (personal) state.personalStatus else state.workStatus
    val queried = { ...reply("notInstalled"), query: route, queryUser: user, includeDisabled: true }
    if (status == "removed") queried
    else if (status == "denied") { ...queried, result: "failed" }
    else { ...queried,
      result: if (state.launch == "allowed") "resolved" else if (state.launch == "argument") "invalid" else "failed",
      attempt: route, launchUser: user,
      target: if (personal) "package:fixture.app"
        else if (state.entry == "work") "fixture.app/fixture.app.Work" else "fixture.app/fixture.app",
      intentAction: if (personal) settingsAction else "", newTask: personal, opened: state.launch == "allowed"
    }
  }

  action invoke = s' = { ...s, reply:
    if (invalidEntries.contains(s.entry)) reply("invalid")
    else if (personalEntries.contains(s.entry)) dispatch(s, true)
    else if (s.entry == "currentProfile") reply("profileUnavailable")
    else if (s.profile == "denied") reply("failed")
    else if (not(visibleProfiles.contains(s.profile))) reply("profileUnavailable")
    else dispatch(s, false)
  }

  val NoRejectedLookupLaunch = s.reply.result.in(Set("notInstalled", "profileUnavailable")) implies s.reply.attempt == "none"
  val RefusedInputSkipsLookup = all {
    (invalidEntries.contains(s.entry) and s.reply.result != "none") implies
      (s.reply.result == "invalid" and s.reply.query == "none" and s.reply.attempt == "none"),
    (s.reply.result == "profileUnavailable") implies s.reply.query == "none"
  }
  val MatchingLookupAndLaunch = (s.reply.attempt != "none") implies
    (s.reply.attempt == s.reply.query and s.reply.launchUser == s.reply.queryUser and s.reply.includeDisabled)
  val ExactProfileAndTarget = all {
    (s.reply.attempt == "personal") implies (personalEntries.contains(s.entry) and s.reply.launchUser == -1
      and s.reply.target == "package:fixture.app" and s.reply.intentAction == settingsAction and s.reply.newTask),
    (s.reply.attempt == "work") implies (workEntries.contains(s.entry) and s.reply.launchUser == 27
      and s.reply.target == (if (s.entry == "work") "fixture.app/fixture.app.Work" else "fixture.app/fixture.app")
      and s.reply.intentAction == "" and not(s.reply.newTask))
  }
  val ReplyMatchesDispatch = (s.reply.result == "resolved") iff s.reply.opened
  val safety = NoRejectedLookupLaunch and RefusedInputSkipsLookup and MatchingLookupAndLaunch
    and ExactProfileAndTarget and ReplyMatchesDispatch

  action step = any {
    nondet entry = entries.oneOf()
    selectEntry(entry),
    nondet personalStatus = statuses.oneOf()
    setPersonalStatus(personalStatus),
    nondet workStatus = statuses.oneOf()
    setWorkStatus(workStatus),
    nondet profile = profiles.oneOf()
    setProfile(profile),
    nondet launch = launches.oneOf()
    setLaunch(launch),
    invoke,
    s' = s
  }

  run personalOpensPackageSettingsTest = init.then(selectEntry("nullUser")).then(invoke)
    .expect(s.reply.result == "resolved" and s.reply.attempt == "personal" and s.reply.newTask)
  run removedPersonalAppHasNoLaunchTest = init.then(setPersonalStatus("removed")).then(invoke)
    .expect(s.reply.result == "notInstalled" and s.reply.query == "personal" and s.reply.attempt == "none")
  run workUsesSelectedComponentTest = init.then(selectEntry("work")).then(invoke)
    .expect(s.reply.result == "resolved" and s.reply.target == "fixture.app/fixture.app.Work" and s.reply.launchUser == 27)
  run workUsesPackageFallbackTest = init.then(selectEntry("workEmptyActivity")).then(invoke)
    .expect(s.reply.result == "resolved" and s.reply.target == "fixture.app/fixture.app")
  run removedProfileRefusesBeforeLookupTest = init.then(selectEntry("work")).then(setProfile("removed")).then(invoke)
    .expect(s.reply.result == "profileUnavailable" and s.reply.query == "none")
  run currentProfileSerialNeverFallsBackTest = init.then(selectEntry("currentProfile")).then(invoke)
    .expect(s.reply.result == "profileUnavailable" and s.reply.attempt == "none")
  run removedWorkAppHasNoLaunchTest = init.then(selectEntry("work")).then(setWorkStatus("removed")).then(invoke)
    .expect(s.reply.result == "notInstalled" and s.reply.queryUser == 27 and s.reply.attempt == "none")
  run invalidInputRefusesBeforeLookupTest = init.then(selectEntry("numericActivity")).then(invoke)
    .expect(s.reply.result == "invalid" and s.reply.query == "none" and s.reply.attempt == "none")
  run disabledPausedOrLockedWorkAppHasExactDetailsTest = init.then(selectEntry("work")).then(setWorkStatus("disabled"))
    .then(setProfile("paused")).then(invoke).expect(s.reply.result == "resolved" and s.reply.attempt == "work")
    .then(setProfile("locked")).then(invoke).expect(s.reply.result == "resolved" and s.reply.attempt == "work")
  run refusedLookupHasNoLaunchTest = init.then(setPersonalStatus("denied")).then(invoke)
    .expect(s.reply.result == "failed" and s.reply.query == "personal" and s.reply.attempt == "none")
    .then(selectEntry("work")).then(setProfile("denied")).then(invoke)
    .expect(s.reply.result == "failed" and s.reply.query == "none" and s.reply.attempt == "none")
  run refusedLaunchRetainsAttemptTest = init.then(selectEntry("work")).then(setLaunch("argument")).then(invoke)
    .expect(s.reply.result == "invalid" and s.reply.attempt == "work" and not(s.reply.opened))
    .then(setLaunch("runtime")).then(invoke)
    .expect(s.reply.result == "failed" and s.reply.attempt == "work" and not(s.reply.opened))
}
