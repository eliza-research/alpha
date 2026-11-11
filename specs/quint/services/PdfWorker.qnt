/// Permissionless PDF worker request CAS, resource ownership and read-only output transfer.
module PdfWorker {
  type Worker = {
    isolated: bool, phase: str, busy: bool, request: int, descriptor: bool,
    bitmap: bool, shared: bool, mapped: bool, readOnly: bool, renderValid: bool,
    recipientHandle: bool, publishedReadOnly: bool, replies: int, rejected: int, elapsed: int
  }
  var s: Worker
  action initFor(isolated: bool): bool = s' = {
    isolated: isolated, phase: "idle", busy: false, request: 0, descriptor: false,
    bitmap: false, shared: false, mapped: false, readOnly: false, renderValid: false,
    recipientHandle: false, publishedReadOnly: false, replies: 0, rejected: 0, elapsed: 0 }
  action init = {
    nondet isolated = Set(false, true).oneOf()
    initFor(isolated)
  }
  action receive(request: int, valid: bool): bool = all {
    s.phase != "dead", request.in(Set(1, 2)),
    if (not(s.isolated) or not(valid) or s.busy)
      s' = { ...s, rejected: if (s.rejected < 2) s.rejected + 1 else 2 }
    else s' = { ...s, phase: "admitted", busy: true, request: request, descriptor: true,
      bitmap: false, shared: false, mapped: false, readOnly: false, renderValid: false, elapsed: 0 }
  }
  action openPage(boundsValid: bool): bool = all {
    s.phase == "admitted",
    s' = { ...s, phase: if (boundsValid) "rendering" else "cleanup", bitmap: boundsValid }
  }
  action render = all {
    s.phase == "rendering", s.bitmap,
    s' = { ...s, phase: "mapping", shared: true, mapped: true }
  }
  action unmap = all {
    s.phase == "mapping", s.mapped, s' = { ...s, mapped: false, phase: "protecting" }
  }
  action protect(success: bool): bool = all {
    s.phase == "protecting",
    s' = { ...s, readOnly: success, renderValid: success, phase: "cleanup" }
  }
  action renderFailure = all {
    s.phase.in(Set("rendering", "mapping", "protecting")),
    s' = { ...s, phase: "cleanup", renderValid: false }
  }
  /// The worker finally closes the input and all bitmap/mapping resources before main-thread reply.
  action cleanup = all {
    s.phase == "cleanup",
    s' = { ...s, phase: "reply-ready", descriptor: false, bitmap: false, mapped: false }
  }
  action reply(delivered: bool): bool = all {
    s.phase == "reply-ready", s.replies < 2,
    s' = { ...s, phase: "idle", busy: false, shared: false,
      recipientHandle: s.recipientHandle or delivered and s.renderValid,
      publishedReadOnly: s.publishedReadOnly or delivered and s.renderValid and s.readOnly,
      replies: s.replies + 1 }
  }
  /// Kernel-owned descriptor teardown follows timeout, memory, unbind and process death.
  action kill = all {
    s.isolated,
    s' = { ...s, phase: "dead", busy: false, descriptor: false, bitmap: false,
      shared: false, mapped: false }
  }
  action tick = all {
    s.busy, s.elapsed < 2,
    if (s.elapsed == 1 and s.isolated)
      s' = { ...s, phase: "dead", busy: false, descriptor: false, bitmap: false,
        shared: false, mapped: false, elapsed: 2 }
    else s' = { ...s, elapsed: s.elapsed + 1 }
  }
  action memoryLimit = all { s.busy, s.isolated, kill }
  action clientCloses = s' = { ...s, recipientHandle: false }
  action step = any {
    receive(1, true), receive(2, true), receive(1, false), openPage(true), openPage(false),
    render, unmap, protect(true), protect(false), renderFailure, cleanup,
    reply(true), reply(false), kill, tick, memoryLimit, clientCloses, s' = s
  }
  val IsolatedAdmission = s.busy implies s.isolated
  val ActiveRequestOwned = s.busy implies s.request.in(Set(1, 2))
  val MappingHasStorage = s.mapped implies s.shared and s.bitmap
  val ReadyResourcesClosed = s.phase.in(Set("reply-ready", "idle", "dead")) implies not(s.descriptor or s.bitmap or s.mapped)
  val PublishedReadOnly = s.recipientHandle implies s.publishedReadOnly
  val ReadOnlyNotMapped = s.readOnly implies not(s.mapped)
  val MappedOutputWitness = s.mapped and s.shared and s.busy
  val WatchdogKilledWitness = s.phase == "dead" and s.elapsed == 2
  val BusyRefusalWitness = s.busy and s.rejected > 0
  val safety = IsolatedAdmission and ActiveRequestOwned and MappingHasStorage and ReadyResourcesClosed and PublishedReadOnly and ReadOnlyNotMapped
  run renderAndReplyTest = initFor(true).then(receive(1, true)).then(openPage(true)).then(render)
    .then(unmap).then(protect(true)).then(cleanup).then(reply(true))
    .expect(s.recipientHandle and not(s.busy or s.shared or s.descriptor) and safety)
  run busyRejectTest = initFor(true).then(receive(1, true)).then(receive(2, true))
    .expect(s.request == 1 and s.rejected == 1 and s.busy and safety)
  run invalidBoundsTest = initFor(true).then(receive(1, true)).then(openPage(false))
    .then(cleanup).then(reply(true)).expect(not(s.recipientHandle) and safety)
  run protectionFailureTest = initFor(true).then(receive(1, true)).then(openPage(true)).then(render)
    .then(unmap).then(protect(false)).then(cleanup).then(reply(true)).expect(not(s.recipientHandle) and safety)
  run timeoutCleanupTest = initFor(true).then(receive(1, true)).then(openPage(true)).then(render)
    .then(tick).then(tick).expect(s.phase == "dead" and safety)
  run memoryAbortTest = initFor(true).then(receive(1, true)).then(openPage(true)).then(render)
    .then(memoryLimit).expect(s.phase == "dead" and not(s.shared or s.mapped or s.descriptor) and safety)
  run nonIsolatedRefusedTest = initFor(false).then(receive(1, true))
    .expect(not(s.busy or s.descriptor) and s.rejected == 1 and safety)
}
