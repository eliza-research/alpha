// Current per-volume Files preview ownership. Provider storage and full browser
// load/filter/review state are separate obligations.
module FilesPreview {
  type State = { active: bool, epoch: int, pending: bool, requestedEpoch: int,
    preview: int, released: bool, publishedActive: bool, publishedRequestEpoch: int, publishedCurrentEpoch: int }
  var s: State
  action init = s' = {active: true, epoch: 0, pending: false, requestedEpoch: 0,
    preview: 0, released: false, publishedActive: false, publishedRequestEpoch: -1, publishedCurrentEpoch: -1}
  action beginPreview = all {s.active, not(s.pending),
    s' = {...s, pending: true, requestedEpoch: s.epoch, released: false}}
  action leave = all {s.epoch < 3,
    s' = {...s, active: false, epoch: s.epoch + 1}}
  action enter = s' = {...s, active: true}
  action previewReply = all {s.pending,
    s' = {...s, pending: false,
      preview: if (s.active and s.requestedEpoch == s.epoch) 1 else s.preview,
      released: not(s.active and s.requestedEpoch == s.epoch),
      publishedActive: if (s.active and s.requestedEpoch == s.epoch) s.active else s.publishedActive,
      publishedRequestEpoch: if (s.active and s.requestedEpoch == s.epoch) s.requestedEpoch else s.publishedRequestEpoch,
      publishedCurrentEpoch: if (s.active and s.requestedEpoch == s.epoch) s.epoch else s.publishedCurrentEpoch}}
  action step = any {beginPreview, leave, enter, previewReply, s' = s}
  val TypeOK = s.epoch.in(0.to(3)) and s.requestedEpoch.in(0.to(3))
    and Set(0, 1).contains(s.preview)
  val NoStalePublication = s.preview == 0 or
    (s.publishedActive and s.publishedRequestEpoch == s.publishedCurrentEpoch)
  val ReleasedAfterSettlement = s.released implies not(s.pending)
  val safety = TypeOK and NoStalePublication and ReleasedAfterSettlement
  run visiblePreviewTest = init.then(beginPreview).then(previewReply)
    .expect(s.preview == 1 and not(s.released) and safety)
  run retiredVisiblePreviewTest = init.then(beginPreview).then(leave).then(previewReply)
    .expect(s.preview == 0 and s.released and safety)
  run returnedViewRejectsOldPreviewTest = init.then(beginPreview).then(leave).then(enter).then(previewReply)
    .expect(s.preview == 0 and s.released and safety)
}
