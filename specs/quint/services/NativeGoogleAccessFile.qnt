module NativeGoogleAccessFile {
  type Access = {gmailChanges: bool, calendarEdits: bool}
  type Request = {kind: str, phase: str}
  type State = {file: str, access: Access, sidecars: bool, writes: int, refusals: int,
    readerOpen: bool, snapshot: Access, lastRead: Access,
    hostGeneration: int, requests: int -> Request}

  pure val off: Access = {gmailChanges: false, calendarEdits: false}
  pure val idle: Request = {kind: "none", phase: "idle"}
  pure val slots = Set(1, 2)
  pure val writeable = Set("missing", "invalid", "fifo", "valid")
  pure val refused = Set("link", "linked-parent", "directory")
  pure val unavailable = writeable.exclude(Set("valid")).union(refused)
  pure val operations = Set("gmail", "calendar", "lookup")

  var s: State
  val effective = if (s.file == "valid") s.access else off
  def permits(kind: str): bool = kind == "lookup" or
    (kind == "gmail" and effective.gmailChanges) or
    (kind == "calendar" and effective.calendarEdits)
  val waiting = slots.exists(id => s.requests.get(id).phase == "verification")

  action init = s' = {file: "missing", access: off, sidecars: false, writes: 0, refusals: 0,
    readerOpen: false, snapshot: off, lastRead: off, hostGeneration: 1, requests: slots.mapBy(_ => idle)}

  action replaceWith(kind: str): bool = all {
    not(s.readerOpen), kind.in(unavailable), kind != "linked-parent" or not(s.sidecars),
    s' = {...s, file: kind, access: off}
  }

  action leaveSidecars = all {
    s.file != "linked-parent", not(s.sidecars),
    s' = {...s, sidecars: true}
  }

  // The observable commit is the atomic rename of one forced Java temp file.
  action publish(gmail: bool, calendar: bool): bool = all {
    s.file.in(writeable), s.writes < 5,
    s' = {...s, file: "valid", access: {gmailChanges: gmail, calendarEdits: calendar}, writes: s.writes + 1}
  }

  action refuseWrite = all {
    s.file.in(refused), s.refusals < 3,
    s' = {...s, refusals: s.refusals + 1}
  }

  action readNow = all {
    not(s.readerOpen),
    s' = {...s, lastRead: effective}
  }

  action openReader = all {
    not(s.readerOpen), s.file == "valid",
    s' = {...s, readerOpen: true, snapshot: effective}
  }

  action finishReader = all {
    s.readerOpen,
    s' = {...s, readerOpen: false, lastRead: s.snapshot, snapshot: off}
  }

  // Admission samples the file once before verification. A later request samples again.
  action request(id: int, kind: str): bool = all {
    not(s.readerOpen), id.in(slots), kind.in(operations), s.requests.get(id) == idle,
    val phase = if (permits(kind)) "verification" else "changes-off"
    s' = {...s, requests: s.requests.set(id, {kind: kind, phase: phase})}
  }

  action stopAtVerification(id: int): bool = all {
    id.in(slots), s.requests.get(id).phase == "verification",
    s' = {...s, requests: s.requests.set(id, {...s.requests.get(id), phase: "verification-failed"})}
  }

  action restartHost = all {
    not(waiting), not(s.readerOpen), s.hostGeneration == 1,
    s' = {...s, hostGeneration: 2, requests: slots.mapBy(_ => idle)}
  }

  action step = any {
    nondet kind = unavailable.oneOf()
    replaceWith(kind),
    leaveSidecars,
    nondet gmail = Set(false, true).oneOf()
    nondet calendar = Set(false, true).oneOf()
    publish(gmail, calendar),
    refuseWrite,
    readNow, openReader, finishReader,
    nondet id = slots.oneOf()
    nondet kind = operations.oneOf()
    request(id, kind),
    nondet id = slots.oneOf()
    stopAtVerification(id),
    restartHost,
    s' = s
  }

  val UnavailableRecordIsOff = (s.file != "valid") implies (effective == off and s.access == off)
  val SnapshotOnlyLivesInOpenReader = (not(s.readerOpen) implies s.snapshot == off)
    and (s.readerOpen implies s.file == "valid")
  val LookupDoesNotRequireWriteAccess = slots.forall(id => {
    val current = s.requests.get(id)
    (current.kind == "lookup") implies current.phase != "changes-off"
  })
  val safety = UnavailableRecordIsOff and SnapshotOnlyLivesInOpenReader and LookupDoesNotRequireWriteAccess
    and s.file.in(writeable.union(refused)) and (s.sidecars implies s.file != "linked-parent")
    and s.writes.in(0.to(5)) and s.refusals.in(0.to(3)) and s.hostGeneration.in(Set(1, 2))

  run missingCanonicalRecordDoesNotRecoverSidecarsTest = init.then(leaveSidecars).then(readNow)
    .expect(safety and s.lastRead == off and s.sidecars)
    .then(publish(true, false)).then(readNow)
    .expect(safety and s.lastRead == {gmailChanges: true, calendarEdits: false} and s.sidecars)

  run invalidAndLinkedRecordsDenyBothSwitchesTest = init.then(publish(true, true))
    .then(replaceWith("invalid")).then(readNow).expect(safety and s.lastRead == off)
    .then(replaceWith("link")).then(refuseWrite).then(readNow)
    .expect(safety and s.file == "link" and s.lastRead == off)
    .then(replaceWith("linked-parent")).then(refuseWrite).then(readNow)
    .expect(safety and s.lastRead == off)

  run replacementPreservesAlreadyOpenedReaderTest = init.then(publish(true, false)).then(openReader)
    .then(publish(false, true)).then(finishReader)
    .expect(safety and s.lastRead == {gmailChanges: true, calendarEdits: false})
    .then(readNow).expect(safety and s.lastRead == {gmailChanges: false, calendarEdits: true})

  run nextAdmissionSeesRevocationWhileEarlierVerificationWaitsTest = init.then(publish(true, false))
    .then(request(1, "gmail")).then(publish(false, false)).then(request(2, "gmail"))
    .expect(safety and s.requests.get(1).phase == "verification" and s.requests.get(2).phase == "changes-off")
    .then(stopAtVerification(1)).then(restartHost).then(request(1, "gmail"))
    .expect(safety and s.requests.get(1).phase == "changes-off")

  run lookupContinuesWithUnavailableRecordTest = init.then(replaceWith("fifo")).then(request(1, "lookup"))
    .then(request(2, "calendar")).then(stopAtVerification(1))
    .expect(safety and s.requests.get(1).phase == "verification-failed" and s.requests.get(2).phase == "changes-off")

  run rejectedDirectoryReplaceCanRecoverAfterRemovalTest = init.then(replaceWith("directory")).then(refuseWrite)
    .then(readNow).expect(safety and s.lastRead == off and s.file == "directory")
    .then(replaceWith("missing")).then(publish(false, true)).then(restartHost).then(readNow)
    .expect(safety and s.lastRead == {gmailChanges: false, calendarEdits: true})
}
