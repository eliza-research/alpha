/// Phone on the Alpha image: recent calls are read only while Phone is in front, held in
/// memory only until it is not, and every dial is a handoff to the system dial screen.
module PhoneRecents {
  type Read = { token: int, request: bool }
  /// A dial handoff in flight: the showing of Phone it started in, and its ordinal.
  type Dial = { session: int, id: int }
  type State = {
    mounted: bool, phoneView: bool, hidden: bool,
    // The adapter's view of "Phone is showing". A newer read supersedes an older one (epoch); a
    // dial belongs to the showing it started in (session). Each kind of work holds its own latch,
    // and the controls are disabled while either is held.
    active: bool, epoch: int, session: int, reading: bool, dialing: bool,
    rows: bool, needsAccess: bool, notice: str,
    // Call-log access on the device: "prompt", "granted", "denied" or "unsupported".
    access: str,
    reads: Set[Read], dials: Set[Dial],
    // Reads the owner asked access for, system prompts shown, and results that arrived for an
    // epoch already left.
    requests: int, prompts: int, discarded: int, handoffs: int
  }
  var s: State

  pure val MaxEpoch = 6
  pure def available(v: State): bool = v.mounted and v.phoneView and not(v.hidden)
  pure def busy(v: State): bool = v.reading or v.dialing
  pure def cleared(v: State): State =
    { ...v, epoch: v.epoch + 1, session: v.session + 1, rows: false, notice: "", reading: false, dialing: false,
      needsAccess: false }
  pure def startRead(v: State, request: bool): State =
    if (not(available(v))) { ...v, epoch: v.epoch + 1 }
    else { ...v, epoch: v.epoch + 1, reading: true, reads: v.reads.union(Set({ token: v.epoch + 1, request: request })),
      requests: v.requests + (if (request) 1 else 0) }
  /// Each shell update and visibility change brings the adapter in line: showing starts a
  /// read, anything else forgets the rows.
  pure def synced(v: State): State =
    if (available(v) == v.active) v
    else if (available(v)) startRead({ ...v, active: true }, false)
    else cleared({ ...v, active: false })

  action initWith(access: str): bool = all { access.in(Set("prompt", "granted", "unsupported")),
    s' = { mounted: true, phoneView: false, hidden: false, active: false, epoch: 0, session: 0, reading: false, dialing: false,
      rows: false, needsAccess: false, notice: "", access: access, reads: Set(), dials: Set(),
      requests: 0, prompts: 0, discarded: 0, handoffs: 0 } }
  action init = { nondet access = Set("prompt", "granted", "unsupported").oneOf() initWith(access) }
  val room = s.epoch + 2 <= MaxEpoch
  action openPhone = all { room, s.mounted, not(s.phoneView), s' = synced({ ...s, phoneView: true }) }
  action leavePhone = all { room, s.phoneView, s' = synced({ ...s, phoneView: false }) }
  action hide = all { room, not(s.hidden), s' = synced({ ...s, hidden: true }) }
  action show = all { room, s.hidden, s' = synced({ ...s, hidden: false }) }
  action unmount = all { room, s.mounted, s' = cleared({ ...s, mounted: false, phoneView: false, active: false }) }
  /// Refresh, the owner's Allow control, and returning to the app each start a new read. Returning
  /// to the app is not gated by the controls, so a read can start while a dial handoff is in flight.
  action refresh(request: bool): bool = all { room, s.active, s' = startRead(s, request) }
  /// Android asks only inside a read the owner started from the Allow control.
  action systemPrompt(read: Read, granted: bool): bool = all { read.in(s.reads), read.request,
    s.access == "prompt", s' = { ...s, access: if (granted) "granted" else "denied", prompts: s.prompts + 1 } }
  action readSettles(read: Read, failed: bool): bool = all { read.in(s.reads),
    val reads = s.reads.exclude(Set(read))
    s' = if (read.token != s.epoch or not(available(s)))
        { ...s, reads: reads, discarded: if (s.discarded < 3) s.discarded + 1 else 3,
          reading: s.reading and read.token != s.epoch }
      else if (failed) { ...s, reads: reads, rows: false, reading: false }
      else { ...s, reads: reads, reading: false, rows: s.access == "granted",
        needsAccess: s.access == "prompt" or s.access == "denied" } }
  action dial(valid: bool): bool = all { not(busy(s)), available(s), s.handoffs < 3,
    s' = if (valid) { ...s, dialing: true, dials: s.dials.union(Set({ session: s.session, id: s.handoffs + 1 })),
        handoffs: s.handoffs + 1, notice: "" }
      else { ...s, notice: "invalid" } }
  /// The handoff result is shown if Phone has been showing since the dial, whatever reads ran meanwhile.
  action dialSettles(d: Dial): bool = all { d.in(s.dials),
    s' = if (d.session == s.session) { ...s, dials: s.dials.exclude(Set(d)), dialing: false, notice: "handoff" }
      else { ...s, dials: s.dials.exclude(Set(d)), discarded: if (s.discarded < 3) s.discarded + 1 else 3 } }
  action step = {
    nondet flag = Set(true, false).oneOf()
    any { openPhone, leavePhone, hide, show, unmount, refresh(flag), dial(flag),
      all { s.reads.size() > 0, { nondet read = s.reads.oneOf() any { readSettles(read, flag), systemPrompt(read, flag) } } },
      all { s.dials.size() > 0, { nondet d = s.dials.oneOf() dialSettles(d) } },
      s' = s }
  }

  /// Call-log rows exist only while Phone is the foreground view.
  val RowsOnlyWhileShowing = s.rows implies s.active and available(s) and s.access == "granted"
  val ActiveTracksShowing = s.active == available(s)
  /// The read latch always has a current read that will release it.
  val ReadingHasCurrentRead = s.reading implies s.reads.exists(read => read.token == s.epoch)
  /// The dial latch is held exactly while a handoff from this showing of Phone is in flight, so a
  /// read that starts or settles meanwhile cannot release it.
  val DialingTracksHandoff = s.dialing == s.dials.exists(d => d.session == s.session)
  /// At most one dial handoff from the current showing is in flight.
  val OneHandoffPerShowing = s.dials.filter(d => d.session == s.session).size() <= 1
  val PromptOnlyOnRequest = s.prompts <= s.requests
  val AccessStateExclusive = not(s.rows and s.needsAccess) and (s.needsAccess implies s.active)
  val safety = RowsOnlyWhileShowing and ActiveTracksShowing and ReadingHasCurrentRead and DialingTracksHandoff and
    OneHandoffPerShowing and PromptOnlyOnRequest and AccessStateExclusive

  val RowsWitness = s.rows
  val DiscardedResultWitness = s.discarded > 0 and s.active
  val AccessNeededWitness = s.needsAccess and s.prompts == 1
  val DialNoticeWitness = s.notice == "handoff"
  val ReadDuringHandoffWitness = s.dialing and s.reading

  // A read still in flight when Phone is left must not bring rows back after the view cleared.
  run lateReadAfterLeavingTest = initWith("granted").then(openPhone).expect(s.reading and s.epoch == 1)
    .then(leavePhone).expect(not(busy(s)) and not(s.rows))
    .then(readSettles({ token: 1, request: false }, false))
    .expect(not(s.rows) and s.discarded == 1 and safety)
  run rowsClearedWhenHiddenTest = initWith("granted").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).expect(s.rows and not(busy(s)))
    .then(hide).expect(not(s.rows) and not(s.active) and safety)
    .then(show).expect(s.reading and s.epoch == 3 and safety)
  run openingPhoneNeverPromptsTest = initWith("prompt").then(openPhone)
    .then(systemPrompt({ token: 1, request: false }, true).fail())
  run accessAskedOnlyFromControlTest = initWith("prompt").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).expect(s.needsAccess and not(s.rows) and s.prompts == 0)
    .then(refresh(true)).then(systemPrompt({ token: 2, request: true }, true))
    .then(readSettles({ token: 2, request: true }, false)).expect(s.rows and not(s.needsAccess) and s.prompts == 1 and safety)
  run newerReadReleasesBusyTest = initWith("granted").then(openPhone).then(refresh(false))
    .then(readSettles({ token: 1, request: false }, false)).expect(s.reading and not(s.rows) and safety)
    .then(readSettles({ token: 2, request: false }, false)).expect(not(s.reading) and s.rows and safety)
  run dialIsOneHandoffTest = initWith("granted").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).then(dial(true))
    .expect(s.dialing and s.handoffs == 1)
    .then(dialSettles({ session: 0, id: 1 })).expect(not(busy(s)) and s.notice == "handoff" and safety)
  run busyRefusesSecondDialTest = initWith("granted").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).then(dial(true)).then(dial(true).fail())
  run dialResultAfterLeavingIsDroppedTest = initWith("granted").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).then(dial(true)).then(hide)
    .then(dialSettles({ session: 0, id: 1 })).expect(s.notice == "" and not(busy(s)) and s.discarded == 1 and safety)
  run failedReadClearsRowsTest = initWith("granted").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).then(refresh(false))
    .then(readSettles({ token: 2, request: false }, true)).expect(not(s.rows) and not(busy(s)) and safety)
  // A read that starts and settles while a dial handoff is in flight leaves the handoff latched:
  // no second dial starts, and the handoff's result is still shown.
  run refreshDuringHandoffKeepsDialTest = initWith("granted").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).then(dial(true))
    .then(refresh(false)).expect(s.dialing and s.reading and safety)
    .then(readSettles({ token: 2, request: false }, false)).expect(s.dialing and not(s.reading) and s.rows and safety)
    .then(dialSettles({ session: 0, id: 1 })).expect(not(busy(s)) and s.notice == "handoff" and s.handoffs == 1 and safety)
  run settledReadAdmitsNoSecondDialTest = initWith("granted").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).then(dial(true))
    .then(refresh(false)).then(readSettles({ token: 2, request: false }, false))
    .then(dial(true).fail())
  // A handoff result from a showing that ended does not release a dial started in the next one.
  run staleHandoffLeavesLaterDialTest = initWith("granted").then(openPhone)
    .then(readSettles({ token: 1, request: false }, false)).then(dial(true)).then(leavePhone).then(openPhone)
    .then(readSettles({ token: 3, request: false }, false)).then(dial(true)).expect(s.dials.size() == 2 and safety)
    .then(dialSettles({ session: 0, id: 1 })).expect(s.dialing and s.notice == "" and s.discarded == 1 and safety)
    .then(dialSettles({ session: 1, id: 2 })).expect(not(s.dialing) and s.notice == "handoff" and safety)
}
