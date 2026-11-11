/// Focus ownership of a phone-positioned modal: focus is held inside the modal while it is the
/// top layer, Back and Escape close it only then, and closing returns focus to the control that
/// opened it without taking focus from anything that received it meanwhile.
module InlineModalFocus {
  type State = {
    mounted: bool,
    // Where focus is: "opener", "modal", "assistant" (the pill, composer or conversation),
    // "other" (another control or layer) or "body" (nothing).
    focus: str,
    // The modal leaves the assistant usable beside it, or covers it.
    covers: bool,
    // A native dialog is open above the modal.
    native: bool,
    // The opening control can take focus: it is connected and neither inert, hidden nor disabled.
    openerReady: bool,
    // A closed modal is still waiting, for a bounded time, to return focus.
    waiting: bool,
    closes: int, restores: int, deferred: int, ignored: int,
    // What held focus when a restore last moved it.
    restoredOver: str
  }
  var s: State

  pure val Places = Set("opener", "assistant", "other", "body")
  pure def more(n: int): int = if (n < 3) n + 1 else 3
  pure def owns(v: State): bool = v.mounted and not(v.native)
  /// Focus that lands on a control outside the modal is brought back, except onto the assistant
  /// it leaves usable. Focus dropped to nothing stays there until the next Tab or change inside.
  pure def contained(v: State, place: str): str =
    if (owns(v) and place != "body" and not(place == "assistant" and not(v.covers))) "modal" else place
  /// Returning focus: never over a control that holds it, and only to an opener that can take it.
  pure def restored(v: State): State =
    if (v.focus != "body") { ...v, waiting: false }
    else if (v.openerReady) { ...v, focus: "opener", waiting: false, restores: more(v.restores), restoredOver: v.focus,
      deferred: if (v.waiting) more(v.deferred) else v.deferred }
    else { ...v, waiting: true }

  action initWith(covers: bool): bool = s' = { mounted: false, focus: "opener", covers: covers, native: false,
    openerReady: true, waiting: false, closes: 0, restores: 0, deferred: 0, ignored: 0, restoredOver: "" }
  action init = { nondet covers = Set(true, false).oneOf() initWith(covers) }
  /// Mounting focuses the modal, which also ends an earlier modal's wait.
  action mount = all { not(s.mounted), not(s.native), s' = { ...s, mounted: true, focus: "modal", waiting: false } }
  /// Focus moves by the keyboard, a tap or a script.
  action focusMoves(place: str): bool = all { place.in(Places), place != "opener" or (s.openerReady and not(s.mounted)),
    val landed = contained(s, place)
    s' = { ...s, focus: landed, waiting: s.waiting and landed == "body" } }
  action nativeOpens = all { not(s.native), s' = { ...s, native: true, focus: "other", waiting: false } }
  /// A closed native dialog hands focus back to the modal under it, or leaves it nowhere.
  action nativeCloses = all { s.native, s' = { ...s, native: false, focus: if (s.mounted) "modal" else "body" } }
  /// Back, Escape or a press on the assistant asks the owner to close; only the top layer is asked.
  action dismiss = all { s.mounted,
    s' = if (owns(s)) { ...s, closes: more(s.closes) } else { ...s, ignored: more(s.ignored) } }
  /// The owner unmounts the modal: focus that was inside it is left nowhere, then returned.
  action unmount = all { s.mounted,
    s' = restored({ ...s, mounted: false, focus: if (s.focus == "modal") "body" else s.focus }) }
  /// The opener is removed, hidden or made inert by a reload of its toolbar, and comes back.
  action openerLeaves = all { s.openerReady, s' = { ...s, openerReady: false, focus: if (s.focus == "opener") "body" else s.focus } }
  action openerReturns = all { not(s.openerReady),
    s' = if (s.waiting and not(s.mounted)) restored({ ...s, openerReady: true }) else { ...s, openerReady: true } }
  action waitEnds = all { s.waiting, s' = { ...s, waiting: false } }
  action step = {
    nondet place = Places.oneOf()
    any { mount, focusMoves(place), nativeOpens, nativeCloses, dismiss, unmount, openerLeaves, openerReturns, waitEnds, s' = s }
  }

  /// While the modal is the top layer, focus never rests on a control behind it: it is inside
  /// the modal, nowhere, or on the assistant the modal leaves usable.
  val FocusContained = owns(s) implies s.focus == "modal" or s.focus == "body" or (s.focus == "assistant" and not(s.covers))
  /// Returning focus never takes it from a control that holds it.
  val RestoreNeverSteals = s.restoredOver == "" or s.restoredOver == "body"
  /// A wait exists only for a closed modal whose opener cannot take focus, with focus nowhere.
  val WaitIsForMissingOpener = s.waiting implies not(s.mounted) and not(s.openerReady) and s.focus == "body"
  val FocusIsSomewhere = (s.focus == "modal" implies s.mounted) and (s.focus == "opener" implies s.openerReady)
  val DeferredAreRestores = s.deferred <= s.restores
  val safety = FocusContained and RestoreNeverSteals and WaitIsForMissingOpener and FocusIsSomewhere and DeferredAreRestores

  val DeferredRestoreWitness = s.deferred > 0 and s.focus == "opener"
  val DisplacedCloseWitness = not(s.mounted) and s.closes > 0 and s.focus == "other" and s.restores == 0 and not(s.native)
  val AbandonedWaitWitness = not(s.waiting) and not(s.mounted) and s.focus == "body" and not(s.openerReady) and s.closes > 0
  val LowerLayerIgnoresBackWitness = s.ignored > 0 and s.mounted

  run closeReturnsFocusToOpenerTest = initWith(true).then(mount).expect(s.focus == "modal" and safety)
    .then(dismiss).then(unmount).expect(s.focus == "opener" and s.restores == 1 and not(s.waiting) and safety)
  run focusIsBroughtBackTest = initWith(true).then(mount).then(focusMoves("other")).expect(s.focus == "modal" and safety)
    .then(focusMoves("assistant")).expect(s.focus == "modal" and safety)
    .then(focusMoves("body")).expect(s.focus == "body" and safety)
  run assistantStaysUsableTest = initWith(false).then(mount).then(focusMoves("assistant"))
    .expect(s.focus == "assistant" and safety)
    .then(unmount).expect(s.focus == "assistant" and s.restores == 0 and safety)
  // The opener's toolbar reloads as the modal closes: focus returns when it is back.
  run restoreWaitsForOpenerTest = initWith(true).then(mount).then(openerLeaves).then(unmount)
    .expect(s.waiting and s.focus == "body" and safety)
    .then(openerReturns).expect(s.focus == "opener" and s.deferred == 1 and not(s.waiting) and safety)
  run waitEndsWhenFocusMovesTest = initWith(true).then(mount).then(openerLeaves).then(unmount)
    .then(focusMoves("other")).expect(not(s.waiting) and safety)
    .then(openerReturns).expect(s.focus == "other" and s.restores == 0 and safety)
  run nativeDialogOwnsBackTest = initWith(true).then(mount).then(nativeOpens).then(dismiss)
    .expect(s.closes == 0 and s.ignored == 1 and s.focus == "other" and safety)
    .then(nativeCloses).expect(s.focus == "modal" and safety)
  run remountEndsWaitTest = initWith(true).then(mount).then(openerLeaves).then(unmount).then(mount)
    .expect(not(s.waiting) and s.focus == "modal" and safety)
}
