/// A busy mark in a development fixture view that only one of the view's own timers clears: a
/// running workflow step, a settings check, the browser agent's step. Leaving the view cancels
/// its timers, so its leave handler clears the mark with them, except while the browser agent
/// waits on the owner's confirmation. Two views stand for all: a plain one and the confirming one.
module FixtureBusyLatch {
  type State = {
    // The view in front ("" is Home or any other view).
    front: str,
    // Per view: the mark is set, a timer that advances or clears it is armed, and (confirming
    // view only) it waits on the owner's answer.
    marked: Set[str], armed: Set[str], confirming: bool,
    // The owner said yes: the confirming view's last step is armed.
    confirmed: bool,
    leaves: int, cleared: int, kept: int
  }
  var s: State

  pure val Plain = "plain"
  pure val Confirming = "confirming"
  pure val Views = Set(Plain, Confirming)
  pure def more(n: int): int = if (n < 3) n + 1 else 3
  /// Leaving a view cancels its timers and clears its mark, unless it waits on a confirmation.
  pure def left(v: State): State =
    if (v.front == "") v
    else
      val waits = v.front == Confirming and v.confirming
      val clears = v.marked.contains(v.front) and not(waits)
      { ...v, armed: v.armed.exclude(Set(v.front)),
        marked: if (clears) v.marked.exclude(Set(v.front)) else v.marked,
        confirmed: v.confirmed and v.front != Confirming,
        leaves: more(v.leaves), cleared: if (clears) more(v.cleared) else v.cleared,
        kept: if (waits) more(v.kept) else v.kept }

  action init = s' = { front: "", marked: Set(), armed: Set(), confirming: false, confirmed: false, leaves: 0, cleared: 0, kept: 0 }
  /// A view opened afresh starts from its initial state: a mark left waiting there is gone.
  pure def fresh(v: State, view: str): State =
    { ...v, marked: v.marked.exclude(Set(view)), confirming: v.confirming and view != Confirming }
  /// Opening a view leaves the one in front. A kept return (Back's stack, a view reopened as it
  /// was left) keeps the target's state; any other open starts it afresh. Opening the view
  /// already in front changes nothing.
  action open(view: str, kept: bool): bool = all { view.in(Views),
    s' = if (view == s.front) s
      else if (kept) { ...left(s), front: view }
      else { ...fresh(left(s), view), front: view } }
  action home = all { s.front != "", s' = { ...left(s), front: "" } }
  /// The owner starts the timed work of the view in front.
  action start = all { s.front != "", not(s.marked.contains(s.front)),
    s' = { ...s, marked: s.marked.union(Set(s.front)), armed: s.armed.union(Set(s.front)) } }
  /// The view's timer runs: the plain view's work ends, the confirming view asks the owner.
  action timer(view: str): bool = all { s.armed.contains(view),
    s' = if (view == Confirming and not(s.confirmed))
        { ...s, armed: s.armed.exclude(Set(view)), confirming: true }
      else { ...s, armed: s.armed.exclude(Set(view)), marked: s.marked.exclude(Set(view)),
        confirmed: s.confirmed and view != Confirming } }
  /// The owner answers from the confirming view: yes arms the last step, no ends the work.
  action answer(yes: bool): bool = all { s.confirming, s.front == Confirming,
    s' = if (yes) { ...s, confirming: false, confirmed: true, armed: s.armed.union(Set(Confirming)) }
      else { ...s, confirming: false, marked: s.marked.exclude(Set(Confirming)) } }
  action step = {
    nondet view = Views.oneOf()
    nondet yes = Set(true, false).oneOf()
    any { open(view, yes), home, start, timer(view), answer(yes), s' = s }
  }

  /// A mark always has something that will clear it: an armed timer or the owner's answer.
  val NoStuckMark = s.marked.forall(view => s.armed.contains(view) or (view == Confirming and s.confirming))
  /// A view's timers run only while it is in front.
  val TimersNeedFront = s.armed.forall(view => view == s.front)
  val ConfirmationHoldsMark = (s.confirming implies s.marked.contains(Confirming) and not(s.armed.contains(Confirming))) and
    (s.confirmed implies s.armed.contains(Confirming) and not(s.confirming))
  val LeavesAccounted = s.cleared + s.kept <= s.leaves or s.leaves == 3
  val safety = NoStuckMark and TimersNeedFront and ConfirmationHoldsMark and LeavesAccounted

  val ClearedOnLeaveWitness = s.cleared > 0 and s.marked == Set()
  /// The confirmation survives leaving the view and is answerable after a kept return.
  val ConfirmationSurvivesLeaveWitness = s.confirming and s.front != Confirming and s.kept > 0
  val AnsweredAfterReturnWitness = s.confirmed and s.kept > 0
  val FinishedInFrontWitness = s.leaves == 0 and s.marked == Set() and s.cleared == 0 and s.front == Plain and s.armed == Set()

  // Leaving while a step is running cancels its timer; the mark goes with it.
  run leaveClearsRunningMarkTest = init.then(open(Plain, false)).then(start).expect(s.marked == Set(Plain) and safety)
    .then(home).expect(s.marked == Set() and s.armed == Set() and s.cleared == 1 and safety)
    .then(timer(Plain).fail())
  run timerEndsWorkInFrontTest = init.then(open(Plain, false)).then(start).then(timer(Plain))
    .expect(s.marked == Set() and s.cleared == 0 and safety)
  run confirmationSurvivesLeaveTest = init.then(open(Confirming, false)).then(start).then(timer(Confirming))
    .expect(s.confirming and s.armed == Set() and safety)
    .then(open(Plain, false)).expect(s.confirming and s.marked == Set(Confirming) and s.kept == 1 and safety)
    .then(open(Confirming, true)).then(answer(true)).then(timer(Confirming)).expect(s.marked == Set() and safety)
  // Opening the view afresh instead drops the waiting confirmation with the rest of its state.
  run freshOpenDropsConfirmationTest = init.then(open(Confirming, false)).then(start).then(timer(Confirming))
    .then(home).expect(s.confirming and safety)
    .then(open(Confirming, false)).expect(not(s.confirming) and s.marked == Set() and safety)
    .then(answer(true).fail())
  run agentStepStopsOnLeaveTest = init.then(open(Confirming, false)).then(start).then(open(Plain, false))
    .expect(s.marked == Set() and not(s.confirming) and s.cleared == 1 and safety)
  run declinedConfirmationEndsWorkTest = init.then(open(Confirming, false)).then(start).then(timer(Confirming)).then(answer(false))
    .expect(s.marked == Set() and not(s.confirming) and safety)
  run reopeningFrontViewKeepsWorkTest = init.then(open(Plain, false)).then(start).then(open(Plain, false))
    .expect(s.marked == Set(Plain) and s.armed == Set(Plain) and s.leaves == 0 and safety)
}
