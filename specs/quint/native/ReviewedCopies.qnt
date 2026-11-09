/// Alpha's main and assistant bridges share a temporary attachment cache in one process.
module ReviewedCopies {
  type State = {
    sweeper: int, swept: bool, present: Set[int], allocated: Set[int],
    owners: int -> int, inFlight: int -> int, ages: int -> str, revokedBy: int -> int,
    startupOwned: Set[int], startupPurged: Set[int], lastWrite: str, lastOpen: str,
    lastReadMode: bool, lastUriShape: bool,
  }
  var s: State
  pure val ids = 1.to(5)
  pure val bridges = Set(1, 2)
  pure val ages = Set("fresh", "boundary", "older", "future")
  pure val none = ids.mapBy(_ => 0)
  action init = s' = {sweeper: 0, swept: false, present: Set(), allocated: Set(), owners: none,
    inFlight: none, ages: ids.mapBy(_ => "fresh"), revokedBy: none, startupOwned: Set(), startupPurged: Set(),
    lastWrite: "none", lastOpen: "none", lastReadMode: false, lastUriShape: false}

  action abandon(id: int, age: str): bool = all {
    s.sweeper == 0, ids.contains(id), not(s.allocated.contains(id)), ages.contains(age),
    s' = {...s, present: s.present.union(Set(id)), allocated: s.allocated.union(Set(id)), ages: s.ages.set(id, age)}
  }
  action changeAge(id: int, age: str): bool = all {
    s.sweeper == 0, s.present.contains(id), ages.contains(age), s' = {...s, ages: s.ages.set(id, age)}
  }
  action beginWrite(owner: int, id: int): bool = all {
    s.sweeper == 0, bridges.contains(owner), ids.contains(id), not(s.allocated.contains(id)),
    s' = {...s, present: s.present.union(Set(id)), allocated: s.allocated.union(Set(id)),
      owners: s.owners.set(id, owner), inFlight: s.inFlight.set(id, owner), ages: s.ages.set(id, "fresh")}
  }
  pure def drop(state: State, removed: Set[int], caller: int): State = {...state,
    present: state.present.exclude(removed), owners: ids.mapBy(id => if (removed.contains(id)) 0 else state.owners.get(id)),
    revokedBy: ids.mapBy(id => if (removed.contains(id)) {
      val owner = state.owners.get(id)
      if (owner != 0) owner else caller
    } else state.revokedBy.get(id))}
  action finishWrite(id: int, ioOk: bool): bool = all {
    s.sweeper == 0, ids.contains(id), s.inFlight.get(id) != 0,
    val stillOwned = s.owners.get(id) == s.inFlight.get(id)
    val retired = {...s, inFlight: s.inFlight.set(id, 0),
      lastWrite: if (not(ioOk)) "failed" else if (stillOwned) "written" else "revoked"}
    s' = if (not(ioOk) and stillOwned) drop(retired, Set(id), s.inFlight.get(id)) else retired
  }
  action revoke(owner: int, id: int): bool = all {
    s.sweeper == 0, bridges.contains(owner), ids.contains(id),
    s' = if (s.owners.get(id) == owner) drop(s, Set(id), owner) else s
  }
  action clear(owner: int): bool = all {
    s.sweeper == 0, bridges.contains(owner), s' = drop(s, ids.filter(id => s.owners.get(id) == owner), owner)
  }
  action beginSweep(owner: int): bool = all {
    s.sweeper == 0, bridges.contains(owner), s' = {...s, sweeper: owner}
  }
  pure def expired(state: State, id: int): bool = state.ages.get(id).in(Set("boundary", "older"))
  action finishSweep(listed: bool): bool = all {
    s.sweeper != 0,
    val prior = {...s, sweeper: 0}
    if (not(listed)) s' = prior else {
      val first = not(s.swept)
      val removed = s.present.filter(id => {
        val owner = s.owners.get(id)
        if (owner == 0) first or expired(s, id)
        else not(first) and owner != s.sweeper and s.inFlight.get(id) == 0 and expired(s, id)
      })
      val done = {...prior, swept: true,
        startupOwned: if (first) ids.filter(id => s.owners.get(id) != 0) else s.startupOwned,
        startupPurged: if (first) removed else s.startupPurged}
      s' = drop(done, removed, s.sweeper)
    }
  }
  action providerOpen(id: int, readOnly: bool, uriShape: bool): bool = all {
    s.sweeper == 0, ids.contains(id),
    val candidate = readOnly and uriShape and s.present.contains(id)
    val unusable = s.ages.get(id).in(Set("older", "future"))
    s' = {...s, lastReadMode: readOnly, lastUriShape: uriShape,
      lastOpen: if (candidate and not(unusable)) "opened" else "denied",
      present: if (candidate and unusable) s.present.exclude(Set(id)) else s.present}
  }

  val writing = ids.filter(id => s.inFlight.get(id) != 0 and s.owners.get(id) != 0)
  val AllocatedOwnEveryFile = s.present.subseteq(s.allocated) and
    ids.filter(id => s.owners.get(id) != 0 or s.inFlight.get(id) != 0).subseteq(s.allocated)
  val InFlightKeepsItsOwner = ids.forall(id => (s.inFlight.get(id) != 0 and s.owners.get(id) != 0)
    implies s.inFlight.get(id) == s.owners.get(id))
  val RevokedPathsNeverResurrect = ids.forall(id => s.revokedBy.get(id) != 0
    implies s.allocated.contains(id) and not(s.present.contains(id)) and s.owners.get(id) == 0)
  val FirstSweepProtectsLiveCopies = s.startupOwned.intersect(s.startupPurged) == Set()
  val ProviderOpensReadOnly = s.lastOpen == "opened" implies s.lastReadMode and s.lastUriShape
  val safety = AllocatedOwnEveryFile and InFlightKeepsItsOwner and RevokedPathsNeverResurrect and
    FirstSweepProtectsLiveCopies and ProviderOpensReadOnly
  action step = any {
    beginSweep(1), beginSweep(2), finishSweep(true), finishSweep(false), clear(1), clear(2),
    {nondet id = ids.oneOf(); any {
      abandon(id, "fresh"), abandon(id, "older"), changeAge(id, "boundary"), changeAge(id, "older"),
      changeAge(id, "future"), beginWrite(1, id), beginWrite(2, id), finishWrite(id, true), finishWrite(id, false),
      revoke(1, id), revoke(2, id), providerOpen(id, true, true), providerOpen(id, false, true), providerOpen(id, true, false)}},
    s' = s
  }

  run firstSweepCompletesBeforePeerCopyTest = init.then(abandon(1, "fresh")).then(beginSweep(1))
    .then(finishSweep(true)).then(beginWrite(2, 2)).then(finishWrite(2, true))
    .expect(s.present == Set(2) and s.owners.get(2) == 2 and s.swept and safety)
  run heldSweepBlocksPeerWriteTest = init.then(beginSweep(1)).then(beginWrite(2, 2).fail())
  run unavailableListingKeepsStartupPendingTest = init.then(abandon(1, "fresh")).then(beginSweep(1)).then(finishSweep(false))
    .then(beginWrite(2, 2)).then(finishWrite(2, true)).then(beginSweep(1)).then(finishSweep(true))
    .expect(s.startupOwned == Set(2) and s.startupPurged == Set(1) and s.present == Set(2) and safety)
  run clearAndWrongTimerPreservePeerTest = init.then(beginWrite(1, 1)).then(finishWrite(1, true))
    .then(beginWrite(2, 2)).then(finishWrite(2, true)).then(revoke(1, 2)).then(clear(1)).then(revoke(1, 1))
    .expect(s.present == Set(2) and s.revokedBy.get(1) == 1 and s.revokedBy.get(2) == 0 and safety)
  run expirySkipsOwnCopyAndPendingPeerTest = init.then(beginSweep(1)).then(finishSweep(true))
    .then(beginWrite(1, 1)).then(finishWrite(1, true)).then(beginWrite(2, 2))
    .then(changeAge(1, "boundary")).then(changeAge(2, "older")).then(beginSweep(1)).then(finishSweep(true))
    .then(beginSweep(2)).then(finishSweep(true))
    .expect(s.present == Set(2) and s.revokedBy.get(1) == 1 and writing == Set(2) and safety)
  run cancelledWriterCannotRepublishTest = init.then(beginWrite(1, 1)).then(clear(1)).then(finishWrite(1, true))
    .expect(s.lastWrite == "revoked" and s.present == Set() and s.inFlight.get(1) == 0 and safety)
  run providerRefusesWriteAndExpiresReadTest = init.then(beginWrite(1, 1)).then(finishWrite(1, true))
    .then(providerOpen(1, false, true)).expect(s.lastOpen == "denied" and s.present == Set(1))
    .then(providerOpen(1, true, true)).expect(s.lastOpen == "opened")
    .then(changeAge(1, "older")).then(providerOpen(1, true, true)).then(revoke(1, 1))
    .expect(s.lastOpen == "denied" and s.present == Set() and s.revokedBy.get(1) == 1 and safety)
}
