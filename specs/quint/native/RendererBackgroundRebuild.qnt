// A renderer lost while a surface is in the background: an uncounted memory reclaim, a counted
// crash, and the rebuild that waits for the surface's next start. The launcher and assistant
// surfaces share one renderer process and one recovery budget.
module RendererBackgroundRebuild {
  type Surface = {
    // alive: its WebView has a renderer. owed: that renderer died and the surface has not been
    // told yet; owedCrash says whether it crashed or was reclaimed.
    alive: bool, owed: bool, owedCrash: bool,
    // Deaths the budget had counted when this surface's WebView was created.
    createdAt: int,
    // The activity is started (visible to the user).
    started: bool,
    recovering: bool, pendingRebuild: bool, escape: bool,
    // The posted recreation: none, now or backoff.
    scheduled: str,
    recreateRequested: bool,
    // The surface was started when its loss was reported.
    reportVisible: bool
  }
  type State = {
    // Alpha is the HOME app; only the launcher surface shows Home.
    home: bool,
    // The budget: losses in the current window (saturating at 4), deaths counted, and whether
    // the 60 s window has passed since its first loss.
    losses: int, deaths: int, stale: bool,
    surfaces: str -> Surface,
    // Renderer deaths that happened, and whether a background reclaim ever spent budget.
    rendererDeaths: int, reclaimSpent: bool
  }
  var s: State
  action check(condition: bool): bool = all {assert(condition), s' = s}
  pure val NAMES = Set("launcher", "assistant")
  pure def fresh(deaths: int, started: bool): Surface = {
    alive: true, owed: false, owedCrash: false, createdAt: deaths, started: started,
    recovering: false, pendingRebuild: false, escape: false, scheduled: "none",
    recreateRequested: false, reportVisible: false
  }
  // prior: counted crashes of the launcher's page earlier in this window, each already recovered,
  // before the assistant surface was opened.
  action initWith(home: bool, prior: int): bool = s' = {
    home: home, losses: prior, deaths: prior, stale: false,
    surfaces: Map("launcher" -> fresh(prior, true), "assistant" -> fresh(prior, false)),
    rendererDeaths: prior, reclaimSpent: false
  }
  action init = {
    nondet home = Set(false, true).oneOf()
    nondet prior = 0.to(3).oneOf()
    initWith(home, prior)
  }
  action start(name: str): bool = {
    val u = s.surfaces.get(name)
    all {
      not(u.started),
      // onStart rebuilds a surface whose renderer went while it was hidden.
      s' = s.with("surfaces", s.surfaces.put(name, {started: true, pendingRebuild: false,
        recreateRequested: u.recreateRequested or u.pendingRebuild, ...u}))
    }
  }
  action stop(name: str): bool = {
    val u = s.surfaces.get(name)
    all {u.started, s' = s.with("surfaces", s.surfaces.put(name, u.with("started", false)))}
  }
  // The shared renderer process dies: every WebView that had it is owed one report.
  action rendererDies(crashed: bool): bool = all {
    s.rendererDeaths < 6, NAMES.exists(name => s.surfaces.get(name).alive),
    s' = {rendererDeaths: s.rendererDeaths + 1,
      surfaces: s.surfaces.keys().mapBy(name => {
        val u = s.surfaces.get(name)
        if (u.alive) {alive: false, owed: true, owedCrash: crashed, ...u} else u
      }), ...s}
  }
  // onRenderProcessGone for this surface's own WebView. The first report of a death counts it,
  // except a reclaim seen by a hidden surface; a WebView older than a counted death spends nothing.
  action report(name: str): bool = {
    val u = s.surfaces.get(name)
    val reclaimedHidden = not(u.owedCrash) and not(u.started)
    val spend = u.createdAt == s.deaths and not(reclaimedHidden)
    val losses = if (not(spend)) s.losses
      else if (s.deaths == 0 or s.stale) 1 else if (s.losses < 4) s.losses + 1 else 4
    val showsHome = s.home and name == "launcher"
    val decision = if (reclaimedHidden) "REBUILD_ON_START"
      else if (losses > 3 and showsHome) "SHOW_ESCAPE"
      else if (not(u.started)) "REBUILD_ON_START"
      else if (losses <= 3) "RECREATE_NOW" else "RECREATE_AFTER_BACKOFF"
    all {
      u.owed,
      s' = {losses: losses, deaths: if (spend) s.deaths + 1 else s.deaths,
        stale: if (spend) false else s.stale,
        reclaimSpent: s.reclaimSpent or (reclaimedHidden and spend),
        surfaces: s.surfaces.put(name, {owed: false, recovering: true, reportVisible: u.started,
          escape: decision == "SHOW_ESCAPE", pendingRebuild: decision == "REBUILD_ON_START",
          scheduled: if (decision == "RECREATE_NOW") "now"
            else if (decision == "RECREATE_AFTER_BACKOFF") "backoff" else "none", ...u}), ...s}
    }
  }
  // A second callback for the WebView already being recovered changes nothing.
  action repeatReport(name: str): bool = all {s.surfaces.get(name).recovering, s' = s}
  action timerFires(name: str): bool = {
    val u = s.surfaces.get(name)
    all {
      u.scheduled != "none",
      s' = s.with("surfaces", s.surfaces.put(name, {scheduled: "none", recreateRequested: true, ...u}))
    }
  }
  // Reload on the native escape view.
  action reload(name: str): bool = {
    val u = s.surfaces.get(name)
    all {
      u.escape, not(u.recreateRequested),
      s' = s.with("surfaces", s.surfaces.put(name, u.with("recreateRequested", true)))
    }
  }
  // Android destroys the instance and creates its successor with a new WebView.
  action recreated(name: str): bool = {
    val u = s.surfaces.get(name)
    all {
      u.recreateRequested,
      s' = s.with("surfaces", s.surfaces.put(name, fresh(s.deaths, u.started)))
    }
  }
  // More than 60 s pass since the window's first loss.
  action windowPasses = all {s.deaths > 0, not(s.stale), s' = s.with("stale", true)}
  action step = {
    nondet name = NAMES.oneOf()
    nondet crashed = Set(false, true).oneOf()
    any {start(name), stop(name), rendererDies(crashed), report(name), repeatReport(name),
      timerFires(name), reload(name), recreated(name), windowPasses, s' = s}
  }
  pure def all_surfaces(state: State, holds: (str, Surface) => bool): bool =
    NAMES.forall(name => holds(name, state.surfaces.get(name)))
  val TypeOK = s.losses.in(0.to(4)) and s.deaths.in(0.to(6)) and s.rendererDeaths.in(0.to(6)) and
    (s.losses > 0 implies s.deaths > 0) and (s.stale implies s.deaths > 0) and
    all_surfaces(s, (name, u) => u.scheduled.in(Set("none", "now", "backoff")) and u.createdAt.in(0.to(6)))
  // A surface whose renderer is gone always has a way back: a posted recreation, a rebuild at the
  // next start, the escape view, or a recreation already requested.
  val NoStrandedSurface = all_surfaces(s, (name, u) => u.recovering implies
    (u.scheduled != "none" or u.pendingRebuild or u.escape or u.recreateRequested))
  val RebuildWaitsForStart = all_surfaces(s, (name, u) => u.pendingRebuild implies not(u.started))
  val HiddenLossNeverRecreatesAtOnce = all_surfaces(s, (name, u) => u.scheduled != "none" implies u.reportVisible)
  val EscapeOnlyWhileHome = all_surfaces(s, (name, u) => u.escape implies (s.home and name == "launcher"))
  val DeathCountedAtMostOnce = s.deaths <= s.rendererDeaths
  val ReclaimNeverSpendsBudget = not(s.reclaimSpent)
  val LiveSurfaceIsIdle = all_surfaces(s, (name, u) => u.alive implies
    (not(u.owed) and not(u.recovering) and not(u.pendingRebuild) and not(u.escape) and u.scheduled == "none"))
  val safety = TypeOK and NoStrandedSurface and RebuildWaitsForStart and HiddenLossNeverRecreatesAtOnce and
    EscapeOnlyWhileHome and DeathCountedAtMostOnce and ReclaimNeverSpendsBudget and LiveSurfaceIsIdle

  val BackgroundRebuildWitness = s.surfaces.get("launcher").pendingRebuild
  val UncountedReclaimWitness = s.rendererDeaths > 0 and s.deaths == 0 and
    all_surfaces(s, (name, u) => not(u.owed))
  val HiddenEscapeWitness = s.surfaces.get("launcher").escape and not(s.surfaces.get("launcher").started)
  val SharedDeathSpentOnceWitness = s.rendererDeaths == 1 and s.deaths == 1 and
    all_surfaces(s, (name, u) => u.recovering)
  // A WebView made after an uncounted reclaim, then overtaken by the late, counted report of that
  // same reclaim: its own next death is taken for the counted one and spends nothing.
  val OvertakenSurfaceWitness = NAMES.exists(name =>
    s.surfaces.get(name).alive and s.surfaces.get(name).createdAt < s.deaths)

  run backgroundReclaimWaitsForStartTest = initWith(true, 0).then(stop("launcher"))
    .then(rendererDies(false)).then(report("launcher")).then(report("assistant"))
    .then(check(safety and s.deaths == 0 and s.losses == 0 and
      s.surfaces.get("launcher").pendingRebuild and s.surfaces.get("assistant").pendingRebuild))
    .then(start("launcher"))
    .then(check(safety and s.surfaces.get("launcher").recreateRequested and not(s.surfaces.get("launcher").pendingRebuild)))
    .then(recreated("launcher"))
    .then(check(safety and s.surfaces.get("launcher").alive and s.surfaces.get("launcher").createdAt == 0))
  // Repeated reclaims in the background leave the whole budget for a visible crash.
  run reclaimsLeaveTheBudgetTest = initWith(false, 0).then(stop("launcher"))
    .then(rendererDies(false)).then(report("launcher")).then(start("launcher")).then(recreated("launcher"))
    .then(stop("launcher"))
    .then(rendererDies(false)).then(report("launcher")).then(start("launcher")).then(recreated("launcher"))
    .then(check(safety and s.deaths == 0 and s.rendererDeaths == 2))
    .then(rendererDies(true)).then(report("launcher"))
    .then(check(safety and s.losses == 1 and s.deaths == 1 and s.surfaces.get("launcher").scheduled == "now"))
  // The hidden assistant surface reports the shared crash first: it is counted once, the hidden
  // surface waits for its start and the visible one recreates at once without spending.
  run sharedCrashIsSpentOnceTest = initWith(false, 0).then(rendererDies(true)).then(report("assistant"))
    .then(check(s.deaths == 1 and s.surfaces.get("assistant").pendingRebuild))
    .then(report("launcher"))
    .then(check(safety and SharedDeathSpentOnceWitness and s.losses == 1 and
      s.surfaces.get("launcher").scheduled == "now"))
    .then(repeatReport("launcher")).then(check(s.deaths == 1))
    .then(timerFires("launcher")).then(recreated("launcher"))
    .then(check(safety and s.surfaces.get("launcher").createdAt == 1))
  // Past the budget a crash in the background still waits when Alpha is not HOME, and shows the
  // escape view, hidden, when it is.
  run hiddenCrashPastBudgetTest = initWith(true, 0)
    .then(rendererDies(true)).then(report("launcher")).then(timerFires("launcher")).then(recreated("launcher"))
    .then(rendererDies(true)).then(report("launcher")).then(timerFires("launcher")).then(recreated("launcher"))
    .then(rendererDies(true)).then(report("launcher")).then(timerFires("launcher")).then(recreated("launcher"))
    .then(check(s.losses == 3 and s.surfaces.get("assistant").owed))
    .then(stop("launcher")).then(rendererDies(true)).then(report("launcher"))
    .then(check(safety and HiddenEscapeWitness and s.losses == 4))
    .then(report("assistant"))
    .then(check(safety and s.deaths == 4 and s.surfaces.get("assistant").pendingRebuild))
    .then(reload("launcher")).then(recreated("launcher"))
    .then(check(safety and s.surfaces.get("launcher").alive))
  run spentBudgetShowsEscapeToHiddenHomeTest = initWith(true, 3).then(stop("launcher"))
    .then(rendererDies(true)).then(report("assistant"))
    .then(check(safety and s.losses == 4 and s.surfaces.get("assistant").pendingRebuild))
    .then(report("launcher")).then(check(safety and HiddenEscapeWitness and s.deaths == 4))
  // A reclaim while visible is counted, and a new window starts once 60 s have passed.
  run visibleReclaimCountsAndWindowRestartsTest = initWith(false, 0)
    .then(rendererDies(false)).then(report("launcher"))
    .then(check(safety and s.deaths == 1 and s.losses == 1))
    .then(timerFires("launcher")).then(recreated("launcher")).then(windowPasses)
    .then(rendererDies(true)).then(report("launcher"))
    .then(check(safety and s.losses == 1 and s.deaths == 2 and not(s.stale)))
  // The late report of an uncounted reclaim overtakes a rebuilt surface, whose own crash then
  // spends nothing.
  run overtakenSurfaceMissesItsCrashTest = initWith(false, 0).then(stop("launcher"))
    .then(rendererDies(false)).then(report("launcher")).then(start("launcher")).then(recreated("launcher"))
    .then(start("assistant")).then(report("assistant"))
    .then(check(safety and OvertakenSurfaceWitness and s.deaths == 1))
    .then(rendererDies(true)).then(report("launcher"))
    .then(check(safety and s.deaths == 1 and s.losses == 1 and s.rendererDeaths == 2 and
      s.surfaces.get("launcher").scheduled == "now"))
}
