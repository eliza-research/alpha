/// The sign-in readiness probe in the connection step slot: who owns it, the automatic entry's
/// single probe, Back during a probe, saving own keys over a probe, and a late readiness answer.
///
/// A probe that is ended early (Back, or an own-keys save) unwinds before any other event is
/// handled, so ending it and freeing the slot are one step. The agent start that follows an
/// owner's probe is counted, not held in the slot.
module SignInReadinessProbe {
  type State = {
    // android: sign-in is required while signed out. preview: the browser resident preview, whose
    // first run shows the sign-in page. browser: sign-in is shown only when the owner opens it.
    host: str,
    // The step in the slot: none, probe (a readiness check), step (anything else) or own-keys.
    operation: str,
    // The readiness owner names the probe now or last in the slot, until another step takes it.
    readinessOwner: bool, probeAutomatic: bool,
    // The owner opened the account sign-in.
    account: bool, chooser: bool, startupResolved: bool,
    // Once rendered, the automatic page keeps its underlying sign-out reason through a retry.
    // Startup completion gates its first admission, not an already visible page.
    pageLatched: bool,
    // The automatic entry probes once until a chooser is shown or the entry ends.
    latch: bool, probes: int,
    // A late readiness answer for the last settled probe may still arrive.
    late: bool, lateAdopted: int, lateDropped: int,
    // Saving own keys: none, waiting (one short wait after ending a probe), saving, refused (slot
    // busy; the refusal stays on screen) or saved.
    ownKeys: str,
    residentStarts: int,
    // How the last probe left the slot (none while one runs or before the first: settled, back,
    // takeover) and whether the agent was ensured after it.
    probeEnd: str, probeEndStarted: bool
  }
  var s: State
  action init = s' = {
    host: "browser", operation: "none", readinessOwner: false, probeAutomatic: false,
    account: false, chooser: false, startupResolved: false, pageLatched: false, latch: false, probes: 0,
    late: false, lateAdopted: 0, lateDropped: 0, ownKeys: "none", residentStarts: 0,
    probeEnd: "none", probeEndStarted: false
  }
  /// The sign-in entry shown: none, required (the automatic page, no Back), first-run (the
  /// preview's automatic page) or opened (a dialog the owner opened). Saved own keys end it. The
  /// required page also appears before startup settles once an error is on screen.
  pure def entryOf(v: State): str =
    if (v.ownKeys == "saved") "none"
    else if (v.host == "android" and (v.startupResolved or v.ownKeys == "refused" or v.pageLatched)) "required"
    else if (v.account) "opened"
    else if (v.host == "preview" and v.startupResolved) "first-run"
    else "none"
  // cancelSignIn uses the controller's raw page predicate, which has no React latch.
  pure def page(v: State): bool = entryOf({ ...v, pageLatched: false }).in(Set("required", "first-run"))
  /// The settled render records the actual automatic-page latch. Host changes and a saved
  /// provider still remove its reason; clearing a refusal while startup is pending does not.
  pure def rendered(v: State): State = { ...v, pageLatched: entryOf(v).in(Set("required", "first-run")) }
  pure def explicit(v: State): bool = v.ownKeys != "saved" and (v.account or entryOf(v) == "first-run")
  pure def probing(v: State, automatic: bool): State =
    { ...v, operation: "probe", readinessOwner: true, probeAutomatic: automatic, late: false, probes: v.probes + 1,
      probeEnd: "none", probeEndStarted: false }
  /// The probe leaves the slot. The agent is ensured after a probe the owner started, unless an
  /// own-keys save ended it; an automatic probe starts nothing.
  pure def probeEnds(v: State, reason: str): State =
    val ensures = not(v.probeAutomatic) and reason != "takeover"
    { ...v, operation: "none", probeEnd: reason, probeEndStarted: ensures,
      residentStarts: if (ensures) v.residentStarts + 1 else v.residentStarts }
  /// The host is fixed before anything else happens.
  action host(kind: str): bool = all {
    kind.in(Set("android", "preview", "browser")), not(s.startupResolved), s.probes == 0, s.operation == "none", s.ownKeys == "none",
    s' = rendered({ ...s, host: kind })
  }
  action startupSettles = all { not(s.startupResolved), s.ownKeys != "saved", s' = rendered({ ...s, startupResolved: true }) }
  /// The automatic entry checks readiness once: with no chooser shown, nothing in the slot and
  /// startup settled. It starts neither email nor Google.
  action automaticProbe = all {
    entryOf(s) != "none", not(s.chooser), not(s.latch), s.operation == "none", s.startupResolved, s.probes < 4,
    s' = rendered(probing({ ...s, latch: true }, true))
  }
  /// The latch is released when a chooser is shown or no entry is required.
  action latchReleases = all { s.latch, s.chooser or entryOf(s) == "none", s' = rendered({ ...s, latch: false }) }
  /// The owner opens sign-in (account, plan) or retries. A step in the slot refuses it. It clears
  /// an earlier refusal from the screen.
  action ownerProbe = all {
    s.operation == "none", s.probes < 4, s.ownKeys != "saved",
    s' = rendered(probing({ ...s, account: s.account or entryOf(s) == "none", ownKeys: if (s.ownKeys == "refused") "none" else s.ownKeys }, false))
  }
  /// Readiness answers, or its wait runs out: the chooser is shown. After a probe the owner
  /// started the agent is ensured; an automatic probe starts nothing.
  action probeSettles(lateFollows: bool): bool = all {
    s.operation == "probe",
    s' = rendered({ ...probeEnds(s, "settled"), chooser: true, late: lateFollows })
  }
  /// The late answer changes the offered methods only while the probe is still the readiness
  /// owner, nothing holds the slot and the same chooser is shown.
  action lateReadiness = all {
    s.late,
    val adopted = s.readinessOwner and s.operation == "none" and s.chooser
    s' = rendered({ ...s, late: false, lateAdopted: if (adopted) s.lateAdopted + 1 else s.lateAdopted,
      lateDropped: if (adopted) s.lateDropped else s.lateDropped + 1 })
  }
  /// Any other step takes the slot and ends the probe's ownership.
  action stepStarts = all {
    s.operation == "none", s.ownKeys != "saved",
    s' = rendered({ ...s, operation: "step", readinessOwner: false, ownKeys: if (s.ownKeys == "refused") "none" else s.ownKeys })
  }
  action stepEnds = all { s.operation == "step", s' = rendered({ ...s, operation: "none" }) }
  /// Saving own keys ends a readiness probe (it is not the owner's attempt): that probe shows no
  /// chooser and starts nothing, and the save takes the slot after one short wait. With the slot
  /// free it saves at once; behind any other step it is refused.
  action saveOwnKeys = all {
    s.ownKeys.in(Set("none", "refused")),
    s' = rendered(if (s.operation == "probe") { ...probeEnds(s, "takeover"), ownKeys: "waiting", late: false }
      else if (s.operation == "none") { ...s, ownKeys: "saving", operation: "own-keys", readinessOwner: false }
      else { ...s, ownKeys: "refused" })
  }
  action ownKeysTakeSlot = all {
    s.ownKeys == "waiting", s.operation == "none", s' = rendered({ ...s, ownKeys: "saving", operation: "own-keys", readinessOwner: false })
  }
  /// The short wait ends with the slot taken by a step that started meanwhile: that step is not
  /// displaced, and the save is refused and says so.
  action ownKeysWaitEnds = all { s.ownKeys == "waiting", s.operation != "none", s' = rendered({ ...s, ownKeys: "refused" }) }
  /// The save finishes, which ends the sign-in entry, or the owner cancels it.
  action ownKeysEnd(saved: bool): bool = all {
    s.operation == "own-keys",
    s' = rendered(if (saved) { ...s, operation: "none", ownKeys: "saved", chooser: false }
      else { ...s, operation: "none", ownKeys: "none" })
  }
  /// Back. On an automatic page showing its chooser with nothing pending it does nothing. During
  /// a probe it ends the probe: an owner's probe still ensures the agent, and a dialog the owner
  /// opened closes. During another step it cancels that step. With nothing pending it closes a
  /// dialog the owner opened. Whatever it changes, it clears a refusal from the screen.
  action back = all {
    entryOf(s) != "none",
    val cleared = { ...s, ownKeys: if (s.ownKeys == "refused") "none" else s.ownKeys }
    s' = rendered(if (s.operation == "none" and s.chooser and page(s)) s
      else if (s.operation == "probe")
        val ended = { ...probeEnds(cleared, "back"), late: false }
        if (not(explicit(s)) or (s.chooser and page(s))) ended
        else { ...ended, chooser: false, account: false }
      else if (s.operation != "none")
        { ...cleared, operation: "none", ownKeys: if (s.operation == "own-keys") "none" else cleared.ownKeys }
      else { ...cleared, chooser: false, account: if (explicit(s)) false else s.account })
  }
  action step = {
    nondet flag = Set(true, false).oneOf()
    nondet kind = Set("android", "preview", "browser").oneOf()
    any { host(kind), startupSettles, automaticProbe, latchReleases, ownerProbe, probeSettles(flag),
      lateReadiness, stepStarts, stepEnds, saveOwnKeys, ownKeysTakeSlot, ownKeysWaitEnds, ownKeysEnd(flag), back, s' = s }
  }
  val ProbeIsReadinessOwner = s.operation == "probe" implies s.readinessOwner
  val SavingHoldsSlot = (s.ownKeys == "saving") == (s.operation == "own-keys")
  val LateOnlyAfterSettledProbe = s.late implies s.operation != "probe"
  val ChooserNeedsEntry = s.chooser implies entryOf(s) != "none"
  val AutomaticProbeAfterStartup = s.latch implies s.startupResolved
  /// Saved own keys leave no sign-in entry and nothing in the slot.
  /// A probe ended for an own-keys save starts nothing: the save takes the slot next.
  val TakeoverStartsNothing = s.probeEnd == "takeover" implies not(s.probeEndStarted)
  /// An entry closes only once its probe has left the slot.
  val ClosingNeedsEndedProbe = s.operation == "probe" implies entryOf(s) != "none" and s.probeEnd == "none"
  val SavedEndsEntry = s.ownKeys == "saved" implies not(s.chooser) and s.operation == "none"
  val TypeOK = s.operation.in(Set("none", "probe", "step", "own-keys")) and s.host.in(Set("android", "preview", "browser"))
    and s.ownKeys.in(Set("none", "waiting", "saving", "refused", "saved")) and s.probes.in(0.to(4))
    and s.residentStarts <= s.probes and s.lateAdopted + s.lateDropped <= s.probes
    and s.probeEnd.in(Set("none", "settled", "back", "takeover"))
  val safety = TypeOK and ProbeIsReadinessOwner and SavingHoldsSlot and LateOnlyAfterSettledProbe and ChooserNeedsEntry
    and AutomaticProbeAfterStartup and SavedEndsEntry and TakeoverStartsNothing and ClosingNeedsEndedProbe and PageLatchMatchesEntry
  val PageLatchMatchesEntry = s.pageLatched == entryOf(s).in(Set("required", "first-run"))

  val OwnKeysOverProbeWitness = s.ownKeys == "saving" and s.probes > 0 and not(s.chooser) and s.residentStarts == 0
  val LateAnswerDroppedWitness = s.lateDropped > 0
  val LateAnswerAdoptedWitness = s.lateAdopted > 0
  val BackClosedOpenedEntryWitness = entryOf(s) == "none" and s.probes > 0 and s.operation == "none" and not(s.chooser) and s.residentStarts > 0
  val LatchedWithoutChooserWitness = s.latch and s.operation == "none" and not(s.chooser) and entryOf(s) == "required"
  /// A probe that starts during the save's short wait is not displaced by it.
  val SaveRefusedBehindNewProbeWitness = s.ownKeys == "refused" and s.operation == "probe"
  /// A save takes a slot that Back freed by ending an owner's probe; the agent was still ensured.
  val SaveAfterBackStillEnsuresAgentWitness = s.ownKeys == "saving" and s.probeEnd == "back" and s.probeEndStarted
  val SaveRefusedBehindStepWitness = s.ownKeys == "refused" and s.operation == "step"
  val RefusalBeforeStartupShowsPageWitness = entryOf(s) == "required" and not(s.startupResolved)

  /// The automatic page probes once; cancelling that probe leaves the page without a second probe.
  run automaticProbeOnceTest = init.then(host("android")).then(startupSettles).then(automaticProbe)
    .expect(s.operation == "probe" and s.latch and safety)
    .then(back).expect(LatchedWithoutChooserWitness and s.residentStarts == 0 and safety)
    .then(automaticProbe.fail())
  run automaticProbeWaitsForStartupTest = init.then(host("android")).then(automaticProbe.fail())
  run chooserReleasesLatchTest = init.then(host("android")).then(startupSettles).then(automaticProbe)
    .then(probeSettles(false)).expect(s.chooser and s.residentStarts == 0 and safety)
    .then(latchReleases).then(back).expect(s.chooser and entryOf(s) == "required" and safety)
  /// Saving own keys during the probe ends it, starts nothing else and then holds the slot.
  run ownKeysOverProbeTest = init.then(ownerProbe).then(saveOwnKeys)
    .expect(s.ownKeys == "waiting" and s.operation == "none" and s.residentStarts == 0 and safety)
    .then(ownKeysTakeSlot).expect(OwnKeysOverProbeWitness and safety)
    .then(ownKeysEnd(true)).expect(s.ownKeys == "saved" and entryOf(s) == "none" and safety)
  /// Another step that takes the slot during the short wait is not displaced: the save is refused.
  run saveRefusedBehindStepTest = init.then(ownerProbe).then(saveOwnKeys).then(stepStarts)
    .then(ownKeysWaitEnds).expect(SaveRefusedBehindStepWitness and safety)
    .then(stepEnds).then(saveOwnKeys).expect(s.ownKeys == "saving" and safety)
    .then(ownKeysEnd(false)).expect(s.ownKeys == "none" and s.operation == "none" and safety)
  /// Back during the probe of a dialog the owner opened closes it, as Back does once it settled.
  run backDuringOwnerProbeTest = init.then(ownerProbe).then(back)
    .expect(BackClosedOpenedEntryWitness and s.residentStarts == 1 and not(s.account) and safety)
  run backAfterOwnerProbeTest = init.then(ownerProbe).then(probeSettles(false)).then(back)
    .expect(entryOf(s) == "none" and not(s.chooser) and safety)
  /// The preview's first-run page keeps its chooser through Back, also during a retry's probe.
  run firstRunPageKeepsChooserTest = init.then(host("preview")).then(startupSettles).then(automaticProbe).then(probeSettles(false))
    .then(back).expect(s.chooser and entryOf(s) == "first-run" and safety)
    .then(ownerProbe).then(back).expect(s.chooser and s.operation == "none" and s.residentStarts == 1 and safety)
  /// A late readiness answer is adopted for the chooser its probe showed, and dropped once another step ran.
  run lateReadinessTest = init.then(ownerProbe).then(probeSettles(true)).then(lateReadiness)
    .expect(LateAnswerAdoptedWitness and safety)
    .then(back).then(ownerProbe).then(probeSettles(true)).then(stepStarts).then(stepEnds).then(lateReadiness)
    .expect(LateAnswerDroppedWitness and s.lateAdopted == 1 and safety)
  /// Back during an owner's probe ends it and still ensures the agent; a save after it finds the slot free.
  run saveAfterBackTest = init.then(ownerProbe).then(back).then(saveOwnKeys)
    .expect(SaveAfterBackStillEnsuresAgentWitness and s.operation == "own-keys" and s.residentStarts == 1 and safety)
  /// Back cancels a save in flight.
  run backCancelsSaveTest = init.then(ownerProbe).then(probeSettles(false)).then(saveOwnKeys).then(back)
    .expect(s.operation == "none" and s.ownKeys == "none" and s.chooser and safety)
  run secondProbeRefusedTest = init.then(ownerProbe).then(ownerProbe.fail())
  /// A refused key save can show the required page before startup finishes. Retrying readiness
  /// clears the refusal but keeps that already visible page and its owned probe together.
  run refusalRetryBeforeStartupTest = init.then(host("android")).then(stepStarts).then(saveOwnKeys)
    .expect(entryOf(s) == "required" and s.pageLatched and not(s.startupResolved) and safety)
    .then(stepEnds).then(ownerProbe)
    .expect(s.operation == "probe" and s.ownKeys == "none" and entryOf(s) == "required" and safety)
    .then(probeSettles(false)).expect(s.chooser and s.pageLatched and not(s.startupResolved) and safety)
    .then(back).expect(not(s.chooser) and s.pageLatched and entryOf(s) == "required" and safety)
  /// A retained page with its refusal already cleared still cannot start an automatic probe
  /// while startup is pending. The refusal must be terminal in a Quint scenario.
  run latchedPageWaitsForStartupTest = init.then(host("android")).then(stepStarts).then(saveOwnKeys)
    .then(stepEnds).then(ownerProbe).then(back)
    .expect(s.pageLatched and not(s.startupResolved) and s.operation == "none" and s.ownKeys == "none" and safety)
    .then(automaticProbe.fail())
  run latchedPageEndsForOwnKeysTest = init.then(host("android")).then(stepStarts).then(saveOwnKeys)
    .then(stepEnds).then(ownerProbe).then(back).then(saveOwnKeys).then(ownKeysEnd(true))
    .expect(not(s.pageLatched) and entryOf(s) == "none" and safety)
}
