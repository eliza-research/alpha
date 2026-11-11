/// The sign-in readiness probe in the connection step slot: who owns it, the automatic entry's
/// single probe, Back during a probe, saving own keys over a probe, and a late readiness answer.
module SignInReadinessProbe {
  type State = {
    // The step in the slot: none, probe (a readiness check), step (anything else) or own-keys.
    operation: str,
    // The readiness owner names the probe now or last in the slot, until another step takes it.
    readinessOwner: bool, probeAutomatic: bool,
    // How the probe in the slot was ended early: none, cancelled (Back) or takeover (own keys).
    probeAbort: str,
    // The sign-in entry: none, required (the automatic page, no Back), first-run (the automatic
    // page of an entry the owner's first run opened) or opened (a dialog the owner opened).
    entry: str, chooser: bool, closing: bool, startupResolved: bool,
    // The automatic entry probes once until a chooser is shown or the entry ends.
    latch: bool, probes: int,
    // A late readiness answer for the last settled probe may still arrive.
    late: bool, lateAdopted: int, lateDropped: int,
    // Saving own keys: none, waiting (for the probe to unwind), saving or refused (slot busy).
    ownKeys: str,
    residentStarts: int, startsAfterTakeover: int, startsBeforeWaitingSave: int
  }
  var s: State
  action init = s' = {
    operation: "none", readinessOwner: false, probeAutomatic: false, probeAbort: "none",
    entry: "none", chooser: false, closing: false, startupResolved: false, latch: false, probes: 0,
    late: false, lateAdopted: 0, lateDropped: 0, ownKeys: "none", residentStarts: 0, startsAfterTakeover: 0, startsBeforeWaitingSave: 0
  }
  pure def probing(v: State, automatic: bool): State =
    { ...v, operation: "probe", readinessOwner: true, probeAutomatic: automatic, probeAbort: "none", late: false, probes: v.probes + 1 }
  action startupSettles = all { not(s.startupResolved), s' = { ...s, startupResolved: true } }
  /// Signed out where sign-in is required, or the first run of a resident preview.
  action entryRequired(kind: str): bool = all {
    kind.in(Set("required", "first-run")), s.entry == "none", s.startupResolved, s' = { ...s, entry: kind }
  }
  /// The automatic entry checks readiness once: with no chooser shown, nothing in the slot and
  /// startup settled. It starts neither email nor Google.
  action automaticProbe = all {
    s.entry != "none", not(s.chooser), not(s.latch), s.operation == "none", s.startupResolved, s.probes < 4,
    s' = probing({ ...s, latch: true }, true)
  }
  /// The latch is released when a chooser is shown or no entry is required.
  action latchReleases = all { s.latch, s.chooser or s.entry == "none", s' = { ...s, latch: false } }
  /// The owner opens sign-in (account, plan) or retries. A step in the slot refuses it.
  action ownerProbe = all {
    s.operation == "none", s.probes < 4,
    s' = probing({ ...s, entry: if (s.entry == "none") "opened" else s.entry }, false)
  }
  /// Readiness answers: the chooser is shown. After a probe the owner started the agent is
  /// ensured; an automatic probe starts nothing.
  action probeSettles(lateFollows: bool): bool = all {
    s.operation == "probe", s.probeAbort == "none",
    s' = { ...s, operation: "none", chooser: true, late: lateFollows,
      residentStarts: if (s.probeAutomatic) s.residentStarts else s.residentStarts + 1 }
  }
  /// A probe ended early unwinds: no chooser is shown by it. After Back the owner's probe still
  /// ensures the agent; after an own-keys takeover it starts nothing, so the key save gets the slot.
  /// The first reason given to the probe stays: a save that follows Back before the probe has
  /// unwound waits behind a probe that still ensures the agent.
  /// Back during the probe of an entry the owner opened closes that entry.
  action probeUnwinds = all {
    s.operation == "probe", s.probeAbort != "none",
    val ensures = not(s.probeAutomatic) and s.probeAbort != "takeover"
    s' = { ...s, operation: "none", late: false, closing: false,
      entry: if (s.closing) "none" else s.entry, chooser: if (s.closing) false else s.chooser,
      residentStarts: if (ensures) s.residentStarts + 1 else s.residentStarts,
      startsAfterTakeover: if (ensures and s.probeAbort == "takeover") s.startsAfterTakeover + 1 else s.startsAfterTakeover,
      startsBeforeWaitingSave: if (ensures and s.ownKeys == "waiting") s.startsBeforeWaitingSave + 1 else s.startsBeforeWaitingSave }
  }
  /// The late answer changes the offered methods only while the probe is still the readiness
  /// owner, nothing holds the slot and the same chooser is shown.
  action lateReadiness = all {
    s.late,
    val adopted = s.readinessOwner and s.operation == "none" and s.chooser
    s' = { ...s, late: false, lateAdopted: if (adopted) s.lateAdopted + 1 else s.lateAdopted,
      lateDropped: if (adopted) s.lateDropped else s.lateDropped + 1 }
  }
  /// Any other step takes the slot and ends the probe's ownership.
  action stepStarts = all { s.operation == "none", s' = { ...s, operation: "step", readinessOwner: false } }
  action stepEnds = all { s.operation == "step", s' = { ...s, operation: "none" } }
  /// Saving own keys ends a readiness probe (it is not the owner's attempt) and waits for it to
  /// unwind; with the slot free it saves; behind any other step it is refused.
  action saveOwnKeys = all {
    s.ownKeys.in(Set("none", "refused")),
    s' = if (s.operation == "probe" and s.readinessOwner)
        { ...s, ownKeys: "waiting", probeAbort: if (s.probeAbort == "none") "takeover" else s.probeAbort }
      else if (s.operation == "none") { ...s, ownKeys: "saving", operation: "own-keys", readinessOwner: false }
      else { ...s, ownKeys: "refused" }
  }
  action ownKeysTakeSlot = all {
    s.ownKeys == "waiting", s.operation == "none", s' = { ...s, ownKeys: "saving", operation: "own-keys", readinessOwner: false }
  }
  /// The bounded wait ends with the slot still held (the probe has not unwound, or another step
  /// took the slot first): the save is refused and says so.
  action ownKeysWaitEnds = all { s.ownKeys == "waiting", s.operation != "none", s' = { ...s, ownKeys: "refused" } }
  action ownKeysEnd = all { s.operation == "own-keys", s' = { ...s, operation: "none", ownKeys: "none" } }
  /// Back. On the automatic page with nothing pending it does nothing. During a probe it ends the
  /// probe and, for an entry the owner opened, closes it once the probe has unwound. With nothing
  /// pending it closes a dialog the owner opened. During another step it cancels that step.
  action back = all {
    s.entry != "none",
    s' = if (s.operation == "none" and s.chooser and s.entry.in(Set("required", "first-run"))) s
      else if (s.operation == "probe" and s.readinessOwner)
        { ...s, probeAbort: if (s.probeAbort == "none") "cancelled" else s.probeAbort,
          closing: s.closing or s.entry.in(Set("first-run", "opened")) }
      else if (s.operation == "none" and s.entry == "opened") { ...s, chooser: false, entry: "none" }
      else if (s.operation == "step") { ...s, operation: "none" }
      else s
  }
  action step = {
    nondet flag = Set(true, false).oneOf()
    nondet kind = Set("required", "first-run").oneOf()
    any { startupSettles, entryRequired(kind), automaticProbe, latchReleases, ownerProbe, probeSettles(flag), probeUnwinds,
      lateReadiness, stepStarts, stepEnds, saveOwnKeys, ownKeysTakeSlot, ownKeysWaitEnds, ownKeysEnd, back, s' = s }
  }
  val ProbeIsReadinessOwner = s.operation == "probe" implies s.readinessOwner
  /// A probe ended for an own-keys save starts nothing that would take the slot first.
  val TakeoverStartsNothing = s.startsAfterTakeover == 0
  val SavingHoldsSlot = (s.ownKeys == "saving") == (s.operation == "own-keys")
  val LateOnlyAfterSettledProbe = s.late implies s.operation != "probe" and s.probeAbort == "none"
  val ClosingNeedsEndedProbe = s.closing implies s.operation == "probe" and s.probeAbort != "none" and s.entry.in(Set("first-run", "opened"))
  val ChooserNeedsEntry = s.chooser implies s.entry != "none"
  val AutomaticProbeAfterStartup = s.probes > 0 and s.latch implies s.startupResolved
  val TypeOK = s.operation.in(Set("none", "probe", "step", "own-keys")) and s.probeAbort.in(Set("none", "cancelled", "takeover"))
    and s.entry.in(Set("none", "required", "first-run", "opened")) and s.ownKeys.in(Set("none", "waiting", "saving", "refused"))
    and s.probes.in(0.to(4))
  val safety = TypeOK and ProbeIsReadinessOwner and TakeoverStartsNothing and SavingHoldsSlot and
    LateOnlyAfterSettledProbe and ClosingNeedsEndedProbe and ChooserNeedsEntry and AutomaticProbeAfterStartup

  val OwnKeysOverProbeWitness = s.ownKeys == "saving" and s.probes > 0 and not(s.chooser)
  val LateAnswerDroppedWitness = s.lateDropped > 0
  val LateAnswerAdoptedWitness = s.lateAdopted > 0
  val BackClosedOpenedEntryWitness = s.entry == "none" and s.probes > 0 and s.operation == "none" and not(s.chooser) and s.residentStarts > 0
  val LatchedWithoutChooserWitness = s.latch and s.operation == "none" and not(s.chooser) and s.entry == "required"
  val SaveAfterBackStillEnsuresAgentWitness = s.startsBeforeWaitingSave > 0
  /// A probe that starts after the ended one unwound is not displaced by the waiting save.
  val SaveRefusedBehindNewProbeWitness = s.ownKeys == "refused" and s.operation == "probe" and s.probeAbort == "none"
  val SaveRefusedBehindStepWitness = s.ownKeys == "refused" and s.operation == "step"

  /// The automatic page probes once; cancelling that probe leaves the page without a second probe.
  run automaticProbeOnceTest = init.then(startupSettles).then(entryRequired("required")).then(automaticProbe)
    .expect(s.operation == "probe" and s.latch and safety)
    .then(back).then(probeUnwinds).expect(LatchedWithoutChooserWitness and s.residentStarts == 0 and safety)
    .then(automaticProbe.fail())
  run automaticProbeWaitsForStartupTest = init.then(automaticProbe.fail())
  run chooserReleasesLatchTest = init.then(startupSettles).then(entryRequired("required")).then(automaticProbe)
    .then(probeSettles(false)).expect(s.chooser and s.residentStarts == 0 and safety)
    .then(latchReleases).then(back).expect(s.chooser and s.entry == "required" and safety)
  /// Saving own keys during the probe ends it, starts nothing else and then holds the slot.
  run ownKeysOverProbeTest = init.then(ownerProbe).then(saveOwnKeys)
    .expect(s.probeAbort == "takeover" and s.ownKeys == "waiting" and safety)
    .then(probeUnwinds).expect(s.operation == "none" and s.residentStarts == 0 and safety)
    .then(ownKeysTakeSlot).expect(OwnKeysOverProbeWitness and safety)
    .then(ownKeysEnd).expect(s.ownKeys == "none" and safety)
  /// Another step that takes the slot before the save does is not displaced: the save is refused.
  run saveRefusedBehindStepTest = init.then(ownerProbe).then(saveOwnKeys).then(probeUnwinds).then(stepStarts)
    .then(ownKeysWaitEnds).expect(SaveRefusedBehindStepWitness and safety)
  /// Back during the probe of a dialog the owner opened closes it, as Back does once it settled.
  run backDuringOwnerProbeTest = init.then(ownerProbe).then(back).expect(s.closing and s.probeAbort == "cancelled" and safety)
    .then(probeUnwinds).expect(BackClosedOpenedEntryWitness and s.residentStarts == 1 and safety)
  run backAfterOwnerProbeTest = init.then(ownerProbe).then(probeSettles(false)).then(back)
    .expect(s.entry == "none" and not(s.chooser) and safety)
  /// A late readiness answer is adopted for the chooser its probe showed, and dropped once another step ran.
  run lateReadinessTest = init.then(ownerProbe).then(probeSettles(true)).then(lateReadiness)
    .expect(LateAnswerAdoptedWitness and safety)
    .then(back).then(ownerProbe).then(probeSettles(true)).then(stepStarts).then(stepEnds).then(lateReadiness)
    .expect(LateAnswerDroppedWitness and s.lateAdopted == 1 and safety)
  run saveAfterBackTest = init.then(ownerProbe).then(back).then(saveOwnKeys)
    .expect(s.probeAbort == "cancelled" and s.ownKeys == "waiting" and safety)
    .then(probeUnwinds).expect(SaveAfterBackStillEnsuresAgentWitness and s.residentStarts == 1 and safety)
  run secondProbeRefusedTest = init.then(ownerProbe).then(ownerProbe.fail())
}
