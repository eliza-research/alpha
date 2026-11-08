// Shared launcher inventory/default readback and native handoff ownership.
module LauncherOwnership {
  type Read = {listDone: bool, listOk: bool, entries: List[int], dialDone: bool, dial: int}
  type Launch = {lifetime: int, target: int, resolvedDial: int}
  type State = {status: str, apps: List[int], dial: int, error: str, launching: int,
    generation: int, lifetime: int, pendingReads: Set[int], reads: int -> Read,
    nextLaunch: int, pendingLaunches: Set[int], launches: int -> Launch}
  var s: State
  pure val AppIds = 1.to(3)
  pure val DialTarget = 4
  pure val ReadIds = 1.to(8)
  pure val LaunchIds = 1.to(4)
  pure val EmptyRead: Read = {listDone: false, listOk: false, entries: List(), dialDone: false, dial: 0}
  pure val EmptyLaunch: Launch = {lifetime: 0, target: 0, resolvedDial: 0}
  action init = s' = {status: "idle", apps: List(), dial: 0, error: "", launching: 0,
    generation: 0, lifetime: 0, pendingReads: Set(), reads: ReadIds.mapBy(_ => EmptyRead),
    nextLaunch: 0, pendingLaunches: Set(), launches: LaunchIds.mapBy(_ => EmptyLaunch)}
  pure def startRead(value: State, quiet: bool): State = {
    val id = value.generation + 1
    {...value, generation: id, pendingReads: value.pendingReads.union(Set(id)),
      status: if (quiet and value.status != "idle") value.status else "loading",
      error: if (quiet and value.status != "idle") value.error else ""}
  }
  pure def uniqueApps(entries: List[int]): List[int] =
    entries.foldl(List(), (accepted, id) => if (AppIds.contains(id) and not(accepted.indices().exists(i => accepted.nth(i) == id)))
      accepted.append(id) else accepted)
  pure def afterRead(value: State, id: int, read: Read): State = {
    val updated = {...value, reads: value.reads.set(id, read)}
    if (not(read.listDone and read.dialDone)) updated
    else {
      val finished = {...updated, pendingReads: updated.pendingReads.exclude(Set(id))}
      if (id != value.generation) finished
      else {...finished, status: if (read.listOk) "ready" else "failed",
        apps: if (read.listOk) uniqueApps(read.entries) else List(), dial: read.dial}
    }
  }
  action request(quiet: bool): bool = all {s.generation < 8 or quiet and s.status == "idle",
    s' = if (quiet and s.status == "idle") s else startRead(s, quiet)}
  action listReply(id: int, ok: bool, entries: List[int]): bool = all {
    s.pendingReads.contains(id), not(s.reads.get(id).listDone), entries.length() <= 4,
    entries.indices().forall(i => entries.nth(i).in(0.to(3))), ok or entries == List(),
    s' = afterRead(s, id, {...s.reads.get(id), listDone: true, listOk: ok, entries: entries})}
  action dialReply(id: int, dial: int): bool = all {
    s.pendingReads.contains(id), not(s.reads.get(id).dialDone), dial.in(0.to(2)),
    s' = afterRead(s, id, {...s.reads.get(id), dialDone: true, dial: dial})}
  action cancelPending = all {s.generation < 8,
    s' = {...s, generation: s.generation + 1, lifetime: s.lifetime + 1, launching: 0}}
  pure def startLaunch(value: State, target: int): State = {
    val id = value.nextLaunch + 1
    {...value, launching: target, error: "", nextLaunch: id, pendingLaunches: value.pendingLaunches.union(Set(id)),
      launches: value.launches.set(id, {lifetime: value.lifetime, target: target, resolvedDial: if (target == DialTarget) value.dial else 0})}
  }
  action launchApp(app: int): bool = all {AppIds.contains(app), s.nextLaunch < 4,
    s' = if (s.launching != 0) s
      else if (s.apps.indices().exists(i => s.apps.nth(i) == app)) startLaunch(s, app)
      else {...s, error: "stale-app"}}
  action launchDial = all {s.nextLaunch < 4,
    s' = if (s.launching != 0 or s.dial == 0) s else startLaunch(s, DialTarget)}
  action launchReply(id: int, ok: bool): bool = all {
    s.pendingLaunches.contains(id),
    val call = s.launches.get(id)
    all {
      ok or call.lifetime != s.lifetime or s.generation < 8,
      val settled = {...s, pendingLaunches: s.pendingLaunches.exclude(Set(id))}
      s' = if (call.lifetime != s.lifetime) settled
        else if (ok) {...settled, launching: 0}
        else startRead({...settled, launching: 0, error: if (call.target == DialTarget) "dial-failed" else "launch-failed"}, true)
    }
  }
  action clearError = s' = {...s, error: ""}
  action step = any {
    {nondet quiet = Bool.oneOf(); request(quiet)}, cancelPending, launchDial, clearError,
    {nondet app = AppIds.oneOf(); launchApp(app)},
    {nondet id = ReadIds.oneOf(); nondet ok = Bool.oneOf();
      nondet entries = Set(List(), List(1), List(2, 3, 2), List(3, 1, 2, 0)).oneOf(); listReply(id, ok, entries)},
    {nondet id = ReadIds.oneOf(); nondet dial = 0.to(2).oneOf(); dialReply(id, dial)},
    {nondet id = LaunchIds.oneOf(); nondet ok = Bool.oneOf(); launchReply(id, ok)}, s' = s,
  }
  val TypeOK = s.status.in(Set("idle", "loading", "ready", "failed")) and s.apps == uniqueApps(s.apps)
    and s.dial.in(0.to(2)) and s.error.in(Set("", "stale-app", "launch-failed", "dial-failed"))
    and s.launching.in(0.to(4)) and s.generation.in(0.to(8)) and s.lifetime.in(0.to(8))
    and s.pendingReads.subseteq(ReadIds) and s.reads.keys() == ReadIds and s.nextLaunch.in(0.to(4))
    and s.pendingLaunches.subseteq(LaunchIds) and s.launches.keys() == LaunchIds
  val CurrentLaunch = {
    val active = s.pendingLaunches.filter(id => s.launches.get(id).lifetime == s.lifetime)
    if (s.launching == 0) active == Set() else
      active.size() == 1 and active.forall(id => s.launches.get(id).target == s.launching)
  }
  val NoUnsettledReadback = s.pendingReads.forall(id => not(s.reads.get(id).listDone and s.reads.get(id).dialDone))
  val NoFailedInventory = s.status != "failed" or s.apps == List()
  val safety = TypeOK and CurrentLaunch and NoUnsettledReadback and NoFailedInventory
  run listWaitsForDefaultTest = init.then(request(false)).then(listReply(1, true, List(1, 2, 1, 3)))
    .expect(s.status == "loading" and s.apps == List()).then(dialReply(1, 2))
    .expect(s.status == "ready" and s.apps == List(1, 2, 3) and s.dial == 2 and safety)
  run staleReadCannotReplaceAppsOrDialTest = init.then(request(false)).then(request(false))
    .then(listReply(2, true, List(3))).then(dialReply(2, 2)).then(dialReply(1, 1)).then(listReply(1, true, List(1)))
    .expect(s.apps == List(3) and s.dial == 2 and safety)
  run staleLaunchCannotClearNewOwnerTest = init.then(request(false)).then(listReply(1, true, List(1))).then(dialReply(1, 1))
    .then(launchApp(1)).then(cancelPending).then(launchDial).then(launchReply(1, false))
    .expect(s.launching == DialTarget and s.error == "" and s.pendingReads == Set() and safety)
  run failedDialRefreshesBothReadsTest = init.then(request(false)).then(listReply(1, true, List(1))).then(dialReply(1, 1))
    .then(launchDial).then(launchReply(1, false))
    .expect(s.error == "dial-failed" and s.pendingReads == Set(2)).then(dialReply(2, 0)).then(listReply(2, false, List()))
    .expect(s.status == "failed" and s.apps == List() and s.dial == 0 and safety)
}
