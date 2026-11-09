// Committed Camera view and synchronous retirement before the next shell commit.
module CameraPreviewRetirement {
  type State = {view: str, phase: str, released: bool, current: int, preview: int,
    lastRequest: int, requests: int -> str}
  var s: State

  pure val Requests = Set(1, 2)
  action init = s' = {view: "home", phase: "off", released: false, current: 0, preview: 0,
    lastRequest: 0, requests: Map()}
  action open = all {
    s.view == "home", s.lastRequest < 2,
    val id = s.lastRequest + 1
    s' = {...s, view: "camera", phase: "starting", current: id, lastRequest: id, requests: s.requests.put(id, "pending")},
  }
  action firstFrame(id: int): bool = all {
    s.view == "camera", s.phase == "starting", not(s.released), s.current == id,
    s' = {...s, phase: "ready", preview: id, requests: s.requests.set(id, "live")},
  }
  action beginLeave = all {
    s.view == "camera", s.phase.in(Set("starting", "ready")), not(s.released),
    s' = {...s, phase: "off", released: true, current: 0},
  }
  action releasePreview = all {
    s.view == "camera", s.released,
    s' = {...s, preview: 0, requests: if (s.preview == 0) s.requests else s.requests.set(s.preview, "ended")},
  }
  action commitHome = all {
    s.view == "camera", s.released, s.preview == 0,
    s' = {...s, view: "home", released: false},
  }
  action lateStream(id: int): bool = all {
    not(s.released), s.view == "home" or s.phase == "ready",
    s.requests.keys().contains(id), s.requests.get(id) == "pending", id != s.current,
    s' = {...s, requests: s.requests.set(id, "ended")},
  }
  action step = any {
    open, beginLeave, releasePreview, commitHome,
    {nondet id = Requests.oneOf(); firstFrame(id)},
    {nondet id = Requests.oneOf(); lateStream(id)},
    s' = s,
  }

  val RetirementStopsAdmission = s.released implies (s.view == "camera" and s.phase == "off" and s.current == 0)
  val CurrentRequestOwnsPreview = (s.phase == "starting" implies (s.current != 0 and s.requests.get(s.current) == "pending" and s.preview == 0))
    and (s.phase == "ready" implies (s.current != 0 and s.preview == s.current))
  val VisibleTrackMatchesRequest = s.requests.keys().filter(id => s.requests.get(id) == "live") ==
    (if (s.preview == 0) Set() else Set(s.preview))
  val safety = RetirementStopsAdmission and CurrentRequestOwnsPreview and VisibleTrackMatchesRequest

  run pendingLeaveBeforeHomeFencesPreviewTest = init.then(open).then(beginLeave).then(releasePreview)
    .expect(s.view == "camera" and s.released and s.lastRequest == 1 and safety)
    .then(commitHome).then(lateStream(1)).then(open).then(firstFrame(2))
    .expect(s.requests == Map(1 -> "ended", 2 -> "live") and safety)
  run readyLeaveReleasesItsExactTrackTest = init.then(open).then(firstFrame(1)).then(beginLeave)
    .expect(s.phase == "off" and s.preview == 1 and s.released and safety)
    .then(releasePreview).then(commitHome)
    .expect(s.requests == Map(1 -> "ended") and s.preview == 0 and safety)
  run retiredStreamCannotReplaceTheFreshPreviewTest = init.then(open).then(beginLeave).then(releasePreview)
    .then(commitHome).then(open).then(firstFrame(2)).then(lateStream(1))
    .expect(s.preview == 2 and s.requests == Map(1 -> "ended", 2 -> "live") and safety)
}
