// One live launcher MainActivity: second-instance hand-off, bring-to-front starts and task kind.
module HomeInstanceHandoff {
  // Task 1 is the display's home task (home activity type); task 2 is a standard task.
  type State = {
    liveTask: int, liveTaskId: int, liveTaskHome: bool, pages: Set[int],
    unacked: int, unreliable: bool, frontInFlight: int,
    starts: int, delivered: int, handOffs: int, handedOffWhileUnreliable: bool,
    operation: str
  }
  var s: State
  action check(condition: bool): bool = all {assert(condition), s' = s}
  pure val MAX_UNACKED = 3
  action init = s' = {
    liveTask: 0, liveTaskId: -1, liveTaskHome: false, pages: Set(),
    unacked: 0, unreliable: false, frontInFlight: 0,
    starts: 0, delivered: 0, handOffs: 0, handedOffWhileUnreliable: false,
    operation: "init"
  }
  // An instance that keeps its page becomes the page owner. The kind is read from the start intent
  // only for the first instance in a task; a relaunch in the same task keeps the stored answer.
  pure def owning(state: State, task: int, intentHome: bool): State = {
    liveTask: task, liveTaskId: task, pages: state.pages.union(Set(task)),
    liveTaskHome: if (task != state.liveTaskId) intentHome else state.liveTaskHome, ...state
  }
  // A HOME, launcher, notification or sign-in-return start. Android resolves a home-type intent to
  // the home task and every other intent to a standard task, and reuses the instance of that task.
  action externalStart(home: bool, moveWorks: bool, startWorks: bool): bool = {
    val task = if (home) 1 else 2
    val counted = {starts: s.starts + 1, delivered: s.delivered + 1, ...s}
    all {
      s.starts < 4,
      if (s.pages.contains(task)) s' = {operation: "new-intent", ...counted}
      else if (s.liveTask != 0 and not(s.unreliable)) {
        // A standard live task is moved by id; a home-type one needs the marked HOME start.
        val moved = not(s.liveTaskHome) and moveWorks
        val started = moved or startWorks
        val unacked = if (started) s.unacked + 1 else s.unacked
        s' = {handOffs: s.handOffs + 1, unacked: unacked,
          frontInFlight: if (not(moved) and startWorks) s.frontInFlight + 1 else s.frontInFlight,
          unreliable: not(started) or unacked >= MAX_UNACKED,
          handedOffWhileUnreliable: s.unreliable, operation: "hand-off", ...counted}
      }
      else s' = {operation: "own-page", ...owning(counted, task, home)}
    }
  }
  // The marked bring-to-front start reaches the live instance, makes another instance, or comes
  // back to the finishing instance that asked. It carries no intent of its own.
  action frontStartArrives(outcome: str, home: bool): bool = all {
    s.frontInFlight > 0, outcome.in(Set("live", "new-instance", "returned")),
    {
      val landed = s.with("frontInFlight", s.frontInFlight - 1)
      val task = if (home) 1 else 2
      if (outcome == "live") all {
        s.liveTask != 0, s' = {unacked: 0, operation: "front-acknowledged", ...landed}
      }
      else if (outcome == "returned") s' = {operation: "front-returned", ...landed}
      else if (s.liveTask != 0) s' = {unreliable: true, operation: "front-made-instance", ...landed}
      else all {
        // No live instance is left: the instance keeps its page, and its own start intent, which
        // carries the marker, reaches it as the page owner and answers every outstanding start.
        not(s.pages.contains(task)),
        s' = {unacked: 0, operation: "own-page", ...owning(landed, task, home)}
      }
    }
  }
  action liveResumes = all {
    s.liveTask != 0, s' = {unacked: 0, operation: "resume", ...s}
  }
  // Renderer recovery or a configuration change: same task, whatever intent setIntent last held.
  action relaunch(heldIntentHome: bool): bool = all {
    s.liveTask != 0,
    s' = {operation: "relaunch", ...owning(s, s.liveTask, heldIntentHome)}
  }
  action destroyLive = all {
    s.liveTask != 0,
    s' = {liveTask: 0, pages: s.pages.exclude(Set(s.liveTask)), operation: "destroy", ...s}
  }
  action step = {
    nondet home = Set(false, true).oneOf()
    nondet first = Set(false, true).oneOf()
    nondet second = Set(false, true).oneOf()
    nondet outcome = Set("live", "new-instance", "returned").oneOf()
    any {externalStart(home, first, second), frontStartArrives(outcome, home), liveResumes,
      relaunch(home), destroyLive, s' = s}
  }
  val TypeOK = s.unacked.in(0.to(MAX_UNACKED)) and s.liveTask.in(0.to(2)) and
    s.pages.subseteq(Set(1, 2)) and s.frontInFlight >= 0 and s.frontInFlight <= s.handOffs
  val OnePageOwnerWhileReliable = s.pages.size() > 1 implies s.unreliable
  val LiveOwnsPage = s.liveTask != 0 implies s.pages.contains(s.liveTask) and s.liveTaskId == s.liveTask
  val HandOffBounded = s.unacked >= MAX_UNACKED implies s.unreliable
  val NoHandOffAfterUnreliable = not(s.handedOffWhileUnreliable)
  val TaskKindFixed = s.liveTask != 0 implies s.liveTaskHome == (s.liveTask == 1)
  val IntentDeliveredOnce = s.delivered == s.starts
  val safety = TypeOK and OnePageOwnerWhileReliable and LiveOwnsPage and HandOffBounded and
    NoHandOffAfterUnreliable and TaskKindFixed and IntentDeliveredOnce

  val FallbackWitness = s.pages.size() == 2
  val UnacknowledgedHandOffWitness = s.unacked > 0 and not(s.unreliable)
  val FrontStartMadeInstanceWitness = s.operation == "front-made-instance"
  val HomeRelaunchWitness = s.operation == "relaunch" and s.liveTaskHome

  run roleGrantHandsOffToRunningStandardTest = init.then(externalStart(false, true, true))
    .then(check(s.liveTask == 2 and not(s.liveTaskHome)))
    .then(externalStart(true, true, true))
    .then(check(safety and s.pages == Set(2) and s.handOffs == 1 and s.frontInFlight == 0 and s.unacked == 1))
    .then(liveResumes).then(check(safety and s.unacked == 0 and s.delivered == 2))
  run homeLiveNeedsMarkedStartTest = init.then(externalStart(true, true, true))
    .then(externalStart(false, true, true))
    .then(check(s.frontInFlight == 1 and s.pages == Set(1)))
    .then(frontStartArrives("live", true))
    .then(check(safety and s.unacked == 0 and not(s.unreliable)))
  // The live instance never comes forward: the hand-off stops after three unanswered starts and
  // the next HOME start keeps its own page instead of finishing and being started again.
  run unansweredHandOffStopsLoopingTest = init.then(externalStart(false, true, true))
    .then(externalStart(true, true, true)).then(externalStart(true, true, true))
    .then(check(not(s.unreliable) and s.unacked == 2))
    .then(externalStart(true, true, true))
    .then(check(safety and s.unreliable and s.handOffs == 3 and s.pages == Set(2)))
  run frontStartThatMakesAnInstanceEndsHandOffTest = init.then(externalStart(true, true, true))
    .then(externalStart(false, false, true)).then(frontStartArrives("new-instance", false))
    .then(check(safety and s.unreliable and s.pages == Set(1)))
    .then(externalStart(false, true, true))
    .then(check(safety and s.pages == Set(1, 2) and s.handOffs == 1 and s.delivered == 3))
  run failedFrontStartIsUnreliableTest = init.then(externalStart(true, true, true))
    .then(externalStart(false, false, false))
    .then(check(safety and s.unreliable and s.unacked == 0 and s.frontInFlight == 0))
  // A home-type owner relaunched while holding the sign-in return intent stays home-type.
  run relaunchKeepsHomeKindTest = init.then(externalStart(true, true, true))
    .then(relaunch(false)).then(check(safety and s.liveTaskHome))
    .then(externalStart(false, false, true))
    .then(check(safety and s.frontInFlight == 1 and s.handOffs == 1))
  // The live instance died before the front start landed: the instance it makes owns the page
  // and no hand-off stays unanswered.
  run frontStartAfterOwnerDiedOwnsPageTest = init.then(externalStart(true, true, true))
    .then(externalStart(false, false, true)).then(check(s.unacked == 1 and s.frontInFlight == 1))
    .then(destroyLive).then(frontStartArrives("new-instance", true))
    .then(check(safety and s.liveTask == 1 and s.liveTaskHome and s.unacked == 0 and not(s.unreliable)))
  run destroyedOwnerIsReplacedTest = init.then(externalStart(false, true, true)).then(destroyLive)
    .then(check(safety and s.pages == Set())).then(externalStart(true, true, true))
    .then(check(safety and s.liveTask == 1 and s.liveTaskHome and s.handOffs == 0))
}
