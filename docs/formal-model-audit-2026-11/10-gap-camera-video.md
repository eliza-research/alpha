# 10. Gap pass: Camera and video

Single-pass findings from a second auditor covering files the first pass read only in part. Not adversarially verified; each is re-verified before a fix.

## A. Model-vs-code discrepancies (`specs/quint/native/MediaLifecycle.qnt`)

1. **Pause does not clear owned media.** `invalidate("pause")` clears `loaded`, `catalogRows` and `temporaryBytes` (qnt:61-71). The code clears `captures`/`preview` only under `permittedLibrary()` (camera-adapter.ts:959); in browser or denied scope both survive hide. The scan frame is deliberately retained while a system picker is up (camera-adapter.ts:586-587), contradicting `IdleHasNoTemporaryCapture`.
2. **`DeniedCatalogEmpty` is not what the code does.** With scope denied the code lists app-owned captures through `library.list` (camera-adapter.ts:299). `catalogRows` only describes the permitted catalog; the model has no owned catalog.
3. **Source change does not always stop playback.** `invalidate("source")` clears playback and selection (qnt:67-70). `invalidateLibrary(true)` keeps `preview`, the open viewer and the playing video after the app's own video copy (camera-adapter.ts:210, 961-965).
4. **Publish is atomic and fenced in the model only.** `publish` requires foreground and matching revisions (qnt:43-51). Native `keepScan` commits with no pre-commit fence and checks the signal afterwards (camera-adapter.ts:720). The model has no "committed, outcome unknown" phase, though the code has three (camera-adapter.ts:710, 248, 260).
5. **Unreviewed publication is the normal path.** Model `capture` must pass `review` before `publish` (qnt:52-56, 43). Normal photo, video and agent capture publish straight to the gallery (camera-adapter.ts:652, 641, 706); only scan mode matches.
6. **The model is weaker than the code on late reads.** `selectMedia` and `cancel` do not bump `epoch` (qnt:23-28, 74), so a read begun for selection A is accepted for selection B at the same epoch. The code fences per read and per id (camera-adapter.ts:492, 498).
7. **`PublishedBytesReviewed` cannot fail.** `publish` assigns all three fields from its own guards (qnt:46-49) and `published` is never reset.
8. **Lock is unimplemented here.** The model has `unlocked` and `invalidate("lock")`; the audited files react only to `document.hidden` and `pagehide`.

## B. Unmodeled state machines

No Quint module covers camera preview or recording: a grep of `specs/quint` for camera/recording/viewfinder matches only listener specs and manifests.

1. **Preview lifecycle** (camera-adapter.ts:162, 585-608, 955).
   - States: `phase` off/starting/ready/error × `epoch` × `denied` × browser `generation`/`stream`/`starting` (browser-camera.ts:244-245).
   - Events: sync, start(retry), stop, switchCamera, track ended, resume grant, visibility.
   - Invariant at risk: `phase == ready` implies a live preview track (broken, see C3/C4).
2. **Recording** (camera-adapter.ts:166-167, 616-647, 945-951; video-capture.ts Session).
   - States: `recordingStarting`/`recording`/`finalizing` × Session (`settled`, `ended`, `stopping`, `bytes`) × `videoSession`/`videoSave`.
   - Events: shutter, limits, track ended, microphone loss, leave, poll.
   - Invariant at risk: a recording with bytes ends in exactly one saved row or an explicit failure, and limits truncate rather than discard (broken, C1).
3. **Capture exclusivity**: `capturing`/`controlBusy`/`requestedCaptureActive` plus agent capture results succeeded/failed/unknown (camera-adapter.ts:696-712).
   - Invariant at risk: "failed" implies no photo; "succeeded" implies exactly one row.
4. **Copy-edit receipt**: prepared/saving/saved/failed/cancelled/unchanged (browser-camera.ts:58, 94-133, 166-177) × adapter intent and recovery (camera-adapter.ts:225-263).
   - Invariants: at most one copy per `operationId`; reading an uncommitted outcome retires it; copy and receipt commit together. This looks correct on reading and is the best candidate for a model.
5. **Trash-delete confirmation**: prepare/cancel/delete with per-item revisions (browser-camera.ts:229-233; camera-adapter.ts:422-455).
6. **Focus writes**: per-track serialisation with an epoch (camera-focus.ts:26-35).
7. **Dialog state machines**: scan-page capture (scan-page-camera.ts:5-16), image import (browser-image-import.ts:16-32), trim editor (video-edit-review.ts:15, 38-42).

## C. Defects

**Verdicts on the earlier claims**

| Claim | Verdict |
|---|---|
| Size limit discards all chunks (video-capture.ts:54) | Confirmed (C1) |
| List reads deserialise full rows (browser-camera.ts:43-44, 183-184) | Confirmed, and wider than claimed (C2) |
| Agent capture fails while preview is starting (camera-adapter.ts:702, 593) | Confirmed (C3) |
| Ended track leaves phase ready (browser-camera.ts:275, 281) | Confirmed for phase; stale-frame consequence only partly verified (C4) |
| `keepCapture` then `throwIfAborted` reports failure after commit (camera-adapter.ts:720) | Partly (C5) |
| Trim clock can show 0:60.0 (video-edit-review.ts:18) | Confirmed (C6) |

**C1. Size limit destroys the whole recording.** Confidence: high.
- `bytes > maxFileSize` calls `finish(Error)`, which clears `chunks` and rejects (video-capture.ts:54, 42).
- The save-at-limit branch `bytes === maxFileSize` needs exact byte equality on a 250 ms chunk boundary, so it is effectively unreachable.
- The adapter then shows "Video could not be finalized" (camera-adapter.ts:631), while the hint promises "Maximum 5 minutes or 100 MB" (camera-adapter.ts:802).
- Fix: on overflow, drop only the overflowing chunk and call `stop()`.

**C2. Whole-store deserialisation of video payloads.** Confidence: high (performance).
- `rows()` uses `openCursor` and reads `cursor.value` for every row (browser-camera.ts:42-43). Video rows carry the full data URL in `path` (browser-camera.ts:313-314), up to about 133 MB each.
- `metadata=true` strips fields only after the clone and has no page limit (browser-camera.ts:44-45). It runs for `summary`, `albums` and `prepareDeleteTrash` (browser-camera.ts:183, 184, 229).
- The adapter triggers `loadCounts` and `loadCustomAlbums` on every first-page refresh and every mutation (camera-adapter.ts:306, 351, 452, 484).
- `list()` returns `path` unstripped, so `captures` pins up to 40 video payloads (browser-camera.ts:44, 181). Filtered lists clone every non-matching row too.
- `finishVideo` re-reads the row it just wrote (camera-adapter.ts:626). The edit path reads it twice more and fetches it into a blob (camera-adapter.ts:196; browser-camera.ts:167; video-edit.ts:22).
- Scenario: five 60 MB clips make every Photos refresh clone about 400 MB three times.
- Fix: move video bytes to a separate object store as a `Blob` keyed by id, and strip `path` from list results. Counts can use an index `count()`.

**C3. Agent capture fails during preview start.** Confidence: high.
- `takeRequestedPhoto` awaits `start(true)` (camera-adapter.ts:702), but `start` returns immediately when `phase === 'starting'` (camera-adapter.ts:593).
- Line 704 then returns "Camera access or preview is unavailable".
- Scenario: the agent opens Camera and requests a photo before `getUserMedia` or CameraX resolves.
- Fix: keep the in-flight start promise and return it from `start()` when already starting.

**C4. `phase` can be ready with no live stream, and there is no in-view recovery.** Confidence: medium.
- Track ended: the handler only clears the light and focus reticle (browser-camera.ts:275). The adapter is never told.
- `capturePhoto` checks `video.readyState`, not track liveness (browser-camera.ts:281), unlike video-capture.ts:22 and scan-page-camera.ts:8. Whether a frozen frame is then saved as a new photo depends on browser behaviour I could not verify by reading.
- Failed flip: `switchCamera` calls `startPreview`, which releases the old preview first (browser-camera.ts:294, 257). On rejection `control()` only shows a message (camera-adapter.ts:613) and `phase` stays ready with `preview === null`.
- After either, `capture()` restarts only when `phase !== 'ready'` (camera-adapter.ts:667), so every shutter press fails until the user leaves the view.
- Fix: require a live track in `capturePhoto`, and have `control()` set `phase = 'error'` and call `showAccess('unavailable')` when a flip fails or the track ends.

**C5. Native keep commits, then throws on abort.** Confidence: medium; low severity.
- `signal.throwIfAborted()` runs after `keepCapture` resolves (camera-adapter.ts:720).
- The signal aborts only when the review is disposed, and its rejection handler is guarded by `!closed` (scan-review.ts:27, 35). So no failure is shown.
- The real effect: the photo is committed, but `loaded = false` and `setView` (camera-adapter.ts:722) are skipped, leaving the Photos cache stale.
- `operationId` is a fresh UUID per call, so a retry cannot be deduplicated.
- Fix: check the signal before the call; after a saved result, always set `loaded = false`; derive `operationId` once per review.

**C6. Trim clock rounds seconds up to 60.** Confidence: high.
- `(value % 60).toFixed(1)` rounds independently of the minutes (video-edit-review.ts:18): 59.97 shows "0:60.0", 119.96 shows "1:60.0". Dragging produces arbitrary floats (video-edit-review.ts:46).
- Fix: `const t = Math.round(value*10)`, then `${Math.floor(t/600)}:${((t%600)/10).toFixed(1).padStart(4,'0')}`.

**C7. Retake after the camera stops destroys the only capture.** Confidence: medium.
- The ended handler disables only Capture (scan-page-camera.ts:16).
- Retake revokes the blob and re-enables Capture (scan-page-camera.ts:9), whose live-track guard then returns silently (scan-page-camera.ts:8).
- Fix: disable Retake in the ended handler.

**C8. Edit receipts are never deleted.** Confidence: high; low severity.
- `edit:<uuid>` records are added per editor open and per video save (browser-camera.ts:90, 170). The only `store.delete` targets media rows (browser-camera.ts:232).
- Fix: delete terminal receipts on acknowledgement or by age.

**C9. Stored video duration overstates the media.** Confidence: low.
- Duration is measured from Session creation to stop (video-capture.ts:36, 50), and an edited copy reports `end - start` even if the source ended early (video-edit.ts:38, 46).

## D. Modeling opportunities

**New Quint modules**

1. `CameraPreview`: phase × epoch × trackLive × denied.
   - `ReadyImpliesLiveTrack`.
   - `StartIsJoinable`: a capture request during starting resolves with the start outcome.
   - `StaleEpochNeverSetsReady`.
   - `DenialRestartsOnlyOnGrant` (`restartAfterResume`, camera-adapter.ts:53-59).
2. `VideoRecording`: Session × limits × leave.
   - `LimitTruncatesNotDiscards`.
   - `SettledExactlyOnce`.
   - `CancelledSessionNeverWritesRow` (browser-camera.ts:315).
   - `LeaveFinalisesBeforePreviewStop` (camera-adapter.ts:588-589).
3. `CopyReceipt`: receipt status × intent × attempt.
   - `AtMostOneCopyPerOperation`.
   - `ReadRetiresUncommitted`.
   - `CopyIffSavedReceipt`.
   - `SourceNeverWritten`.
4. `CaptureOutcome` for agent capture: `FailedImpliesNoRow`, `SucceededImpliesOneRow`, unknown only after dispatch.
5. Extensions to `MediaLifecycle`:
   - a selection id or per-read ticket;
   - split owned and permitted catalogs;
   - split `publish` into begin and commit with an abort in between;
   - model the picker-retention exemption;
   - replace the tautological invariant with one over an independently tracked committed revision.

**Pure functions suited to pre/postcondition checks**

- `clock` (video-edit-review.ts:18): seconds field below 60.0, monotone.
- Trim clamp (video-edit-review.ts:40): `0 ≤ start ≤ end − 0.1`, `end ≤ duration`, and the result always passes `validateVideoEdit` (video-edit.ts:4-8).
- `drawEditedVideo` dimension maths (video-edit.ts:51-52): even, at least 2, long edge at most 1920, aspect swapped on 90/270.
- `drawCameraFrame` crop rectangle (camera-frame.ts:10-11): inside the source for zoom 1 to 8.
- Focus point mapping (camera-focus.ts:22-23): result in [0,1], mirror is an involution.
- `pageCursor`/`pageBoundary` round trip, and pagination with no duplicates or gaps (browser-camera.ts:32-36, 45, 181).
- `outcome`, `parameters`, `selectedMedia`, `editKey` (browser-camera.ts:63-66, 139-142).
- `mediaAccessDenied`, `captureSearchWords`, `captureMatches`, `restartAfterResume` (camera-adapter.ts:100-122, 53-59).
- MIME normalisation (video-capture.ts:48) and container sniffing (video-edit.ts:15-19).
- Size-limit accounting (video-capture.ts:54), extracted as a reducer `(bytes, chunk, max) → {keep, stop}`.

No Java was in the audited set.
