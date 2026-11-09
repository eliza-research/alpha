// Selected media identity, lifecycle fences, reviewed bytes and unpublished capture cleanup.
module MediaLifecycle {
  type State = {
    scope: str, foreground: bool, unlocked: bool, epoch: int, revision: int,
    phase: str, selected: bool, selectedRevision: int, requestEpoch: int,
    loaded: bool, reviewed: bool, reviewedRevision: int, published: bool,
    publishedRevision: int, publicationReviewedRevision: int, publicationAdmitted: bool, ownedCapture: bool, temporaryBytes: bool,
    catalogRows: int, playback: bool
  }
  var s: State
  action check(condition: bool): bool = all { assert(condition), s' = s }
  action init = s' = {
    scope: "denied", foreground: true, unlocked: true, epoch: 0, revision: 0,
    phase: "idle", selected: false, selectedRevision: -1, requestEpoch: -1,
    loaded: false, reviewed: false, reviewedRevision: -1, published: false,
    publishedRevision: -1, publicationReviewedRevision: -1, publicationAdmitted: false, ownedCapture: false, temporaryBytes: false,
    catalogRows: 0, playback: false
  }
  action grant(scope: str): bool = all {
    scope.in(Set("full", "selected")), s.phase == "idle",
    s' = s.with("scope", scope)
  }
  action selectMedia = all {
    s.scope != "denied", s.foreground, s.unlocked,
    s' = {selected: true, selectedRevision: s.revision, phase: "selected",
      loaded: false, reviewed: false, catalogRows: 1, playback: false,
      ownedCapture: false, temporaryBytes: false, ...s}
  }
  action beginRead = all {
    s.selected, s.foreground, s.unlocked, s.scope != "denied",
    s.selectedRevision == s.revision,
    s' = {phase: "reading", requestEpoch: s.epoch, ...s}
  }
  action readComplete(ticket: int, revision: int): bool =
    if (s.phase == "reading" and ticket == s.epoch and ticket == s.requestEpoch and
        revision == s.revision and s.foreground and s.unlocked and s.scope != "denied")
      s' = {phase: "loaded", loaded: true, temporaryBytes: true, ...s}
    else s' = s
  action review = all {
    s.loaded, s.phase == "loaded", s.selectedRevision == s.revision,
    s' = {phase: "reviewed", reviewed: true, reviewedRevision: s.revision, ...s}
  }
  action publish = all {
    s.phase == "reviewed", s.reviewed, s.foreground, s.unlocked,
    s.scope != "denied" or s.ownedCapture,
    s.reviewedRevision == s.revision, s.selectedRevision == s.revision,
    s' = {phase: "published", published: true, publishedRevision: s.selectedRevision,
      publicationReviewedRevision: s.reviewedRevision,
      publicationAdmitted: s.foreground and s.unlocked and (s.scope != "denied" or s.ownedCapture),
      temporaryBytes: false, ownedCapture: false, ...s}
  }
  action capture = all {
    s.foreground, s.unlocked, s.phase == "idle",
    s' = {phase: "loaded", loaded: true, selected: true,
      selectedRevision: s.revision, ownedCapture: true, temporaryBytes: true, ...s}
  }
  action playback = all {
    s.loaded, s.foreground, s.unlocked,
    s' = s.with("playback", true)
  }
  action invalidate(reason: str): bool = all {
    reason.in(Set("revoke", "pause", "lock", "source")), s.epoch < 3,
    s' = {
      scope: if (reason == "revoke") "denied" else s.scope,
      foreground: if (reason == "pause") false else s.foreground,
      unlocked: if (reason == "lock") false else s.unlocked,
      revision: if (reason == "source") 1 - s.revision else s.revision,
      epoch: s.epoch + 1, phase: "idle", selected: false,
      loaded: false, reviewed: false, temporaryBytes: false, ownedCapture: false,
      catalogRows: 0, playback: false, ...s
    }
  }
  action resume = s' = {foreground: true, unlocked: true, ...s}
  action cancel = s' = {phase: "idle", selected: false, loaded: false,
    reviewed: false, ownedCapture: false, temporaryBytes: false, playback: false, ...s}
  action step = {
    nondet ticket = Set(-1, 0, 1, 2, 3).oneOf()
    nondet revision = Set(0, 1).oneOf()
    nondet scope = Set("full", "selected").oneOf()
    nondet reason = Set("revoke", "pause", "lock", "source").oneOf()
    any { grant(scope), selectMedia, beginRead, readComplete(ticket, revision),
      review, publish, capture, playback, invalidate(reason), resume, cancel, s' = s }
  }
  val ActiveReadAdmitted = s.phase == "reading" implies
    s.foreground and s.unlocked and s.scope != "denied" and s.requestEpoch == s.epoch
  val ReviewBindsRevision = s.reviewed implies s.loaded and s.reviewedRevision == s.revision
  val PlaybackAdmitted = s.playback implies s.foreground and s.unlocked and s.loaded
  val PublishedBytesReviewed = s.published implies s.publicationAdmitted and s.publishedRevision == s.publicationReviewedRevision
  val IdleHasNoTemporaryCapture = s.phase == "idle" implies not(s.temporaryBytes) and not(s.ownedCapture)
  val DeniedCatalogEmpty = s.scope == "denied" implies s.catalogRows == 0
  val safety = ActiveReadAdmitted and ReviewBindsRevision and PlaybackAdmitted and
    PublishedBytesReviewed and IdleHasNoTemporaryCapture and DeniedCatalogEmpty

  run reviewedPublicationTest = init.then(grant("selected")).then(selectMedia).then(beginRead)
    .then(readComplete(0, 0)).then(review).then(publish).then(check(safety and s.published))
  run revokeWhileReadingTest = init.then(grant("full")).then(selectMedia).then(beginRead)
    .then(invalidate("revoke")).then(readComplete(0, 0))
    .then(check(safety and not(s.loaded) and s.catalogRows == 0))
  run changedSourceInvalidatesReviewTest = init.then(grant("full")).then(selectMedia).then(beginRead)
    .then(readComplete(0, 0)).then(review).then(invalidate("source"))
    .then(check(safety and not(s.reviewed) and not(s.published)))
  run cancelledCaptureDeletesTemporaryTest = init.then(capture).then(cancel)
    .then(check(safety and not(s.temporaryBytes) and not(s.published)))
  run replacingSelectionStopsPlaybackTest = init.then(grant("full")).then(selectMedia)
    .then(beginRead).then(readComplete(0, 0)).then(playback).then(selectMedia)
    .then(check(safety and not(s.playback) and not(s.loaded)))
  run pauseRejectsLateReadTest = init.then(grant("full")).then(selectMedia).then(beginRead)
    .then(invalidate("pause")).then(resume).then(readComplete(0, 0))
    .then(check(safety and not(s.loaded)))
}
