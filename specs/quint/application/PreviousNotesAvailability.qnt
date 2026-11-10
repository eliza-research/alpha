// Read-only Previous Notes presence is owned by the selected account and visible visit.
module PreviousNotesAvailability {
  type State = {device: bool, visible: bool, hidden: bool, suspended: bool, owner: str, mode: str, epoch: int,
    legacyOwner: str, probeOwner: str, probeEpoch: int, active: int, started: int, pending: int -> str,
    draftReads: int, availability: str, paints: int, cleared: int, canonical: int}
  var s: State

  pure def initial(device: bool): State = {device: device, visible: false, hidden: false, suspended: false,
    owner: "a", mode: "canonical", epoch: 0, legacyOwner: "", probeOwner: "", probeEpoch: -1,
    active: 0, started: 0, pending: Map(), draftReads: 0, availability: "none", paints: 0, cleared: 0, canonical: 0}
  action initBrowser = s' = initial(false)
  action initDevice = s' = initial(true)
  action init = any {initBrowser, initDevice}
  pure def eligible(state: State): bool = state.visible and not(state.hidden) and not(state.suspended)
  pure def sync(before: State): State = {
    if (before.mode == "legacy" and before.legacyOwner == before.owner) {...before, active: 0}
    else {
      val state = if (before.mode == "legacy") {...before, mode: "canonical", epoch: before.epoch + 1,
        legacyOwner: "", active: 0, cleared: before.cleared + 1, canonical: before.canonical + 1} else before
      val owner = if (eligible(state)) state.owner else ""
      val epoch = if (eligible(state)) state.epoch else -1
      if (state.probeOwner == owner and state.probeEpoch == epoch) state
      else if (owner == "") {...state, probeOwner: "", probeEpoch: -1, active: 0, availability: "none"}
      else {
        val id = state.started + 1
        {...state, probeOwner: owner, probeEpoch: epoch, active: id, started: id, availability: "none",
          pending: state.pending.put(id, if (state.device) "collection" else "browser")}
      }
    }
  }

  action move(visible: bool): bool = all {s.started < 3, s' = sync({...s, visible: visible})}
  action hide(hidden: bool): bool = all {s.started < 3, s' = sync({...s, hidden: hidden})}
  action suspend(suspended: bool): bool = all {s.started < 3, s' = sync({...s, suspended: suspended})}
  action changeOwner(owner: str): bool = all {s.started < 3, owner.in(Set("a", "b")), s' = sync({...s, owner: owner})}
  action enterLegacy = all {
    s.started < 3, s.mode == "canonical", eligible(s),
    s' = sync({...s, mode: "legacy", legacyOwner: s.owner}),
  }
  action resolve(id: int, result: str): bool = all {
    s.pending.keys().contains(id), result.in(Set("present", "absent", "unavailable")),
    val phase = s.pending.get(id)
    val done = {...s, pending: s.pending.keys().exclude(Set(id)).mapBy(key => s.pending.get(key))}
    s' = if (id != s.active) done
      else if (phase == "collection" and result == "absent") {...s, pending: s.pending.put(id, "draft"), draftReads: s.draftReads + 1}
      else {...done, availability: result, paints: s.paints + 1},
  }
  action step = any {
    move(true), move(false), hide(true), hide(false), suspend(true), suspend(false), changeOwner("a"), changeOwner("b"), enterLegacy,
    {nondet id = Set(1, 2, 3).oneOf(); nondet result = Set("present", "absent", "unavailable").oneOf(); resolve(id, result)},
    s' = s,
  }

  val ActiveProbeHasExactOwner = s.active != 0 implies
    (eligible(s) and s.mode == "canonical" and s.probeOwner == s.owner and s.probeEpoch == s.epoch)
  val DraftReadsFollowDeviceCollection = s.draftReads <= s.started and (s.device or s.draftReads == 0)
  val LegacyRetirementClearsBeforeCanonical = s.cleared == s.canonical
  val safety = ActiveProbeHasExactOwner and DraftReadsFollowDeviceCollection and LegacyRetirementClearsBeforeCanonical

  run ownerABADoesNotReviveOldProbeTest = initBrowser.then(move(true)).then(changeOwner("b")).then(changeOwner("a"))
    .then(resolve(1, "present")).then(resolve(2, "unavailable")).expect(s.availability == "none" and s.paints == 0 and safety)
    .then(resolve(3, "absent")).expect(s.availability == "absent" and s.paints == 1 and safety)
  run viewRetirementDoesNotReadNativeDraftTest = initDevice.then(move(true)).then(move(false))
    .then(resolve(1, "absent")).expect(s.draftReads == 0 and s.paints == 0 and safety)
  run nativeDraftPresenceRequiresCurrentCollectionTest = initDevice.then(move(true)).then(resolve(1, "absent"))
    .expect(s.pending.get(1) == "draft" and s.paints == 0 and safety)
    .then(resolve(1, "present")).expect(s.availability == "present" and s.draftReads == 1 and safety)
  run ownerSwitchClearsVisibleLegacyBeforeNewProbeTest = initBrowser.then(move(true)).then(enterLegacy)
    .then(changeOwner("b")).then(resolve(1, "present")).then(resolve(2, "unavailable"))
    .expect(s.mode == "canonical" and s.epoch == 1 and s.cleared == 1 and s.availability == "unavailable" and safety)
  run hideAndSuspendRetireVisibleProbeTest = initBrowser.then(move(true)).then(hide(true)).then(hide(false)).then(suspend(true))
    .then(resolve(1, "present")).then(resolve(2, "present")).expect(s.paints == 0 and s.active == 0 and safety)
  run blockedStoreRemainsUnavailableTest = initBrowser.then(move(true)).then(resolve(1, "unavailable"))
    .expect(s.availability == "unavailable" and s.draftReads == 0 and s.paints == 1 and safety)
}
