# View refresh plan: Camera, Photos, Notes, Files, Apps

Status: **proposal for review**. Nothing here is implemented. The interactive prototype
(`index.html` in this folder) shows each before/after pair and records your decisions.

Before-state screenshots in `before/` were captured from the dev UI (`npm run dev:ui`,
412×915 @2x, fake camera) on 2026-11-06. They show the browser build, so a few
native-only elements (Android permission rows, Device library) are described from code
rather than pictured.

Principles applied to every view:

1. **No narration.** Remove explanatory and privacy-narration text. Show state with
   standard affordances (icons, counts, dates). Keep only errors that need action, and keep
   them to one short line.
2. **Standard patterns.** Follow iOS Photos/Notes/Files and Google Photos/Keep/Files where
   they agree. Where they disagree, pick the simpler one.
3. **Search moves to the agent.** Photos, Notes and Files drop their search inputs. You
   ask Alpha ("photos from last weekend", "my note about the term sheet", "the bank PDF"),
   and the view shows the result as a dismissible filter chip. The agent tools are
   read-only filters, so this adds no new side effects.
4. **One model per flow.** Each view gets a TLA+ spec next to the existing ones in
   `design/view-refresh-2026-11/tla/`. Each spec checks the as-built behaviour (with fix
   flags), then the fixed design. Implementation follows the checked design.

---

## 1. Camera

### UI changes
| Before | After |
|---|---|
| Header: Back, "Camera" title, Flash, **Choose image**, **Scan document**, **Ask Alpha (alpha mark)** | Back and Flash only. No title, as in system camera apps. Flash is hidden on lenses without a flash unit |
| Video hint "Stops and saves when you leave. Maximum 5 minutes or 100 MB." | Removed. The timer shows during recording; the limit appears only when reached |
| ".5" chip shown on every lens | Zoom chips come from the bound lens's real zoom range |
| Status pill "Starting camera…" | Removed. The viewfinder fades in on the first real frame |
| Modes: Video · Photo · Scan | Video · Photo (decision C1: Scan removed as a mode; ask Alpha to scan what Camera sees) |

"Ask Alpha about this" stays reachable through the chat pill. When Camera is open, the
agent already has `camera_capture_photo` and ask-about-frame, so it doesn't need a button.

### Start and shutter speed (native, CameraX: `vendor/eliza/plugins/plugin-native-camera`, via `patches/eliza`)
Measured path today: render → rAF → `start()` → `await stopping` → bridge →
`stopPreviewInternal` → `ProcessCameraProvider.getInstance` (cold) → bind
Preview + ImageCapture(MAXIMIZE_QUALITY) + VideoCapture(HIGHEST) → **sequential**
restore of WB → exposure → EV → zoom → flash (torch and an empty capture-options call) →
focus → JS `mask(true)` DOM walk. The viewfinder stays black until all of that resolves.
At the same time, 40 base64 thumbnails cross the bridge just to draw the last-capture tile.

Changes:
1. Prewarm `ProcessCameraProvider` in plugin `load()` (app start), not on first open.
2. Bind **Preview + ImageCapture** only, using `CAPTURE_MODE_MINIMIZE_LATENCY` for
   ImageCapture. Bind VideoCapture when Video mode is selected; it already rebinds today.
3. Resolve `startPreview` on the first `onCaptureCompleted` frame. Restore settings in
   parallel, and skip any value that equals the default.
4. Unmask the viewfinder on the first frame, and cache the sibling list for `mask()`.
5. After ready, load the last-capture thumbnail with `limit:1`.
6. Shutter: `OutputFileOptions(contentResolver)` writes straight to MediaStore. Return the
   URI plus a ≤256 px thumbnail, not a base64 full JPEG.
7. Keep the camera bound while the chat sheet is open for less than 10 s, so asking Alpha
   doesn't tear down the session.
8. Replace the body-wide `MutationObserver` and rAF loop with view-enter/leave events.

Target, to measure on the Pixel 10a: cold open to first frame **< 400 ms** (warm < 200 ms),
and shutter to thumbnail **< 250 ms**. We'll add a Perfetto trace marker
(`alpha.camera.firstFrame`) and an instrumented test that records both numbers. The
before numbers are captured on-device in phase 0. This review doesn't claim them.

### Bugs fixed along the way (found in review)
- Tap-to-focus holds `controlBusy` for up to ~10 s, and the shutter is silently dropped
  during it. Focus must never block capture.
- Leaving during `takePicture` shuts down the executor that delivers the result, so
  `capturing` can stick at true. Await the capture or cancel it explicitly.
- Flipping with flash on, or at a zoom the front lens doesn't support, is rejected. Reset
  the target's settings before switching.
- An agent capture during `starting` fails. Queue it until `ready`.
- The Scan-document "Capture page" path uses `getUserMedia` while CameraX holds the
  camera. It goes away with the header button. Scan mode stays CameraX.
- The `file://` gallery result on Android ≤9 is reported as a failure.
- Dead UI: the focus ring, the model's scan-found sheet, `scanPages`, and the viewfinder
  gestures promised by its aria-label.

### TLA+: `tla/camera-session/Spec.tla`
- **Variables:** `view∈{away,camera}`, `vis∈{fg,bg}`, `chat∈{closed,open}` (modelled since the
  port: the chat keeps the session for a grace period, then releases it),
  `phase∈{off,starting,ready,error}`, `perm∈{unknown,granted,denied}`,
  `mode∈{photo,video,scan}`, `lens`, `zoom`, `flash`, `capture∈{idle,photo,recStarting,recording,finalizing}`,
  `focusBusy`, `pendingAgentCapture`, `epoch`, `media` (a set of committed items), `thumb`.
- **Actions:** Open, Leave, Background, Resume, ChatOpen/Close, PermissionResult,
  FirstFrame, StartFail, Shutter, CaptureDone/CaptureFail, RecStart/RecStop/RecLimit,
  Flip, Zoom, Flash, Focus, FocusDone, AgentCapture, ProcessDeath.
- **Safety:**
  - `NoLostShutter`: when ready, a shutter press either starts a capture or is visibly
    refused. It is never dropped because of focus.
  - `NoStuckCapture`: leaving resolves every in-flight capture.
  - `SavedIsShown`: a committed item becomes `thumb` and appears in Photos.
  - `NoOrphanRecording`: a recording never outlives the camera session.
  - `LensSettingsValid`: zoom and flash are always valid for the bound lens.
  - `StaleEpochIgnored`: results from an earlier epoch don't change state.
- **Liveness:** `OpenReachesPreviewOrError`; `AgentCaptureSettles`;
  `RecordingFinalizes` (under weak fairness).

---

## 2. Photos

### UI changes
| Before | After |
|---|---|
| Header: Library/Albums icon toggle, search icon, select (check) icon | Title "Photos", with text tabs **Library · Albums** and **Select** at top right |
| Group label "Captured on this device" / "Permitted library · up to 240 loaded items" / "N matches so far" | Day headers: "Today", "Yesterday", "Sat, Oct 31", "October 2026" for older items |
| 3 columns, 2 px gap, tiles flush to the edges, a lone tile looks broken | 4 columns (pinch for 3 or 5), 2 px gap. Day headers and a 12 px top inset give the grid structure. Edge-to-edge is what both iOS and Google Photos do. An inset variant with rounded tiles is in the prototype for comparison (decision P1) |
| Search box (filename or keyword) | Removed. "Ask Alpha" filters the grid; a chip "Last weekend · 14 ✕" shows the active filter |
| Select: max 20, no select-all in Library, Favorite can't unfavorite | Select via the **Select** button or a long press, and drag to extend. "N selected" in the title, plus Select all. Bottom bar: Share, Favorite (toggles), Add to album, Delete. Large selections are batched internally |
| Viewer title "Captured photo", subtitle "W × H · saved to Android Photos"; swipe and tap do nothing | Title is the date and time. Swipe moves between photos, tap hides the controls. Bottom bar: Share, Favorite, Edit, Info, Delete. Info shows date, size, dimensions and album |
| Editor status "Saves a new copy · original unchanged · …" | Removed. Save shows "Save copy" / "Replace" |
| Albums: Favorites, Videos, custom, **Device library (scope label)**, Recover albums | Favorites, Videos, Screenshots, Camera, then custom albums with covers. "Recently deleted" sits at the bottom with a count |
| Access strip "Only photos and videos saved by Alpha" + "Choose photo access" | When access is partial or denied, one row at the top: "Allow access to all photos" (opens the system sheet). Nothing otherwise |
| Trash hint "Open to preview, or select items to recover or delete." | Removed. Each tile shows the days left |

### Data and behaviour
- **One catalog.** Merge `AlphaPhotos` (app-owned) and `AlphaPhotoLibrary` (permitted)
  into one paged MediaStore cursor, sorted by `DATE_TAKEN desc`. Keep a stable sort with
  newest first. This fixes the `slice(-240)` bug, which drops the newest items.
- **Day grouping** runs over the cursor window, with a virtualised grid.
- MediaStore changes **patch** the visible window. They don't clear the selection or close
  the viewer.
- Favorite and restore no longer reorder items.

### Agent tools (replacing the search box)
- `photos_filter{from?,to?,kind?,favorite?,album?,text?}` sets the visible filter chip.
  It is read-only. `text` is matched on device against date words, places and OCR text.
  Filenames aren't exposed to the model.
- The existing `photo_library_search/inspect/select/review` stay. `select` now works in
  the main Library, not only in Device library.
- `photos_open{id}`, `photos_album_create{name, ids}` (reviewed), `photos_share{ids}`
  (opens the system share sheet), `photos_trash{ids}` (reviewed, undoable).

### TLA+: `tla/photos-library/Spec.tla`
- **Variables:** `items` (id → {trashed, fav, albums, rev}), `window`, `tab`,
  `selection`, `viewer`, `filter`, `pending` ops, `access∈{none,partial,full}`,
  `storeEvents`.
- **Actions:** Load/Page, StoreInsert/Delete/Update (external), EnterSelect,
  Toggle, DragSelect, SelectAll, Share, FavoriteToggle, Trash/Undo, Restore,
  DeleteForever (confirmed), AgentFilter/ClearFilter, AgentSelect, AgentReviewApply,
  OpenViewer, Swipe, AccessChange, Background.
- **Safety:**
  - `SelectionSubsetOfVisible`
  - `NoActionOnStaleRev`: a reviewed action applies only to the revision that was reviewed.
  - `TrashReversibleUntilExpiry`
  - `DeleteForeverOnlyConfirmed`
  - `NewestNeverDropped`
  - `ViewerShowsExistingItem`
  - `FilterIsReadOnly`: a filter never mutates `items`.
- **Liveness:** pending ops settle; the selection survives unrelated store events.

---

## 3. Notes

### UI changes
| Before | After |
|---|---|
| Header: Record, Import (test builds), Trash, New note; a Search pill under the header | Header: **Record** (mic) and **New note**. No search pill; the agent searches |
| No organisation; Trash is a separate overlay opened from the header | **Folders.** A chip row: All · *user folders* · + . **Recently deleted** is the last folder, shown only when it isn't empty. The trash icon goes away |
| "Deleted notes stay here for 3 days, then they are deleted permanently." | Each item shows its days left ("29d"). Retention changes from 3 to **30 days**, matching Apple Notes and Google Photos (decision N2). Header action: Empty |
| Recorder: "Record up to 29 seconds. English transcription runs on this phone…" and ~25 route-specific privacy lines; flat bars "Waveform levels are unavailable" | Large timer counting up with **no limit**, a live waveform from native mic peaks, and Pause, Stop and Discard. No instruction text. One short line appears only on error |
| 2-column cards dealt alternately (unbalanced heights) | One-column list with title, two-line preview and date (Apple style). The 2-column grid is in the prototype as an option (decision N3) |
| Editor toolbar: Back, Read aloud, Dictate, Checklist, Pin, Share, Delete | Back · Checklist · Share · ⋯ (Pin, Move to folder, Delete). Read aloud and dictate go through Alpha |
| "No notes yet. Create a note to get started." | Empty list with only the compose affordance |

### Unlimited recording
- Native: drop the 29 s/59 s whitelist and the 4 MiB cap for notes. Record AAC to
  `noBackupFilesDir/note-audio/<id>.m4a`, with progressive writes and pause/resume
  (`MediaRecorder.pause/resume`). Stop on low storage with a clear line.
- Transcription: stream through `NativeAsr.openStream/feed/partial/finish` (already used
  by live dictation) in VAD segments of 30 s or less. The 29 s cap was a leftover from an
  earlier windowed model. Partials save as the recording goes, so a crash keeps the
  transcript up to that point.
- Paired and Cloud routes upload in 55 s chunks, since those servers cap one request at
  60 s. There's no user-visible limit on any route.
- Recording continues with the screen off, in a foreground service with a notification,
  as Recorder apps do. As built, segments are transcribed while Notes is shown; segments
  recorded with Notes hidden are transcribed when it is shown again, or at Done (spec
  notes-view `shown`, AsrWhileHidden = FALSE). Native background transcription is open work.

### Data model
- Add `folderId` to the note record. Folders are a new `notes-folders:v1:device` slot.
  Deleting a folder moves its notes to All, never to Trash.
- Trash stays the existing write-ahead trash. "Recently deleted" is a view over it, and
  retention is a constant read by the UI.
- Fix: the agent's content search also matches checklist items and transcripts.

### Agent tools
- `notes_filter{text?,folder?,kind?}`: read-only, shows a chip.
- `notes_move{noteId,folderId}` and `notes_folder_create{name}`: reviewed.
- `notes_record{start|stop}`: starts and stops a voice note while Notes is open.
- The existing `create_note`, `notes_update`, `notes_delete` (to Trash) and `notes_query`
  stay. `notes_restore{noteId}` is added.

### TLA+: extend `specs/notes-merge` into `tla/notes-view/Spec.tla`
The existing merge/trash/draft spec covers storage. The new module adds:
- **Variables:** `folders`, `noteFolder`, `rec∈{idle,recording,paused,finalizing}`,
  `audioBytes`, `asrCommitted`, `asrPending`, `filter`, `screen∈{list,editor,recorder,deleted}`.
- **Actions:** Record, Pause, Resume, Stop, Discard, ChunkCommit, AsrPartial,
  AsrFinal, ProcessDeath, ScreenOff, MoveToFolder, DeleteFolder, Trash, Restore,
  Expire, AgentFilter, AgentMove (reviewed), AgentRecord.
- **Safety:**
  - `NoLengthLimit`: Stop is the only end, apart from storage or error.
  - `CrashKeepsAudio`: committed chunks survive process death.
  - `TranscriptPrefixOfAudio`
  - `FolderDeleteKeepsNotes`
  - `TrashedNotInFolders`
  - `RestoreReturnsToFolder` (falls back to All if the folder was deleted)
  - `AgentMoveOnlyReviewed`
- **Liveness:** recording finalizes; `AsrSettles`; `ExpiredPurged` (reused).

---

## 4. Files

### Root cause of "every location shows the same files"
None of the tiles lists a folder. Downloads, Documents, Receipts and Recordings each call
`ACTION_OPEN_DOCUMENT` with a MIME filter and no `EXTRA_INITIAL_URI`
(`files-tree-adapter.ts:15-20,145`; `DailyAppsPlugin.java:132-136`). The picker opens at
its own Recent view, so a camera photo shows under "Downloads". Receipts is a fixture
concept with no real data behind it.

### UI changes
| Before | After |
|---|---|
| Tiles: Downloads, Documents, Receipts, Recordings, Photos, App files, Import folder, storage tile, each with an instruction subtitle | **Browse** list in the Android Files / iOS Files style. **Categories:** Downloads, Images, Videos, Audio, Documents. **Storage:** Internal storage (free space shown), plus any SD or USB volume. **Trash** |
| "No recent files. Files you open here or save from scans appear here." | Removed. There is no Recents section (decision F2) |
| Search icon in the header | Removed. Ask Alpha shows a result chip |
| Folder view only for one SAF-picked folder | A real tree from Internal storage: breadcrumbs, sort (Name, Date, Size), list or grid, select mode with Share, Move, Copy, Rename, Delete (to Trash) |

What each entry shows:
- **Downloads:** `Download/` only.
- **Images / Videos / Audio:** MediaStore collections, grouped by folder (Camera,
  Screenshots, Recordings, …). Tapping Camera lists `DCIM/Camera` (or our current
  `Pictures/`). See decision C2 on moving captures to `DCIM/Camera`.
- **Documents:** pdf, office and text MIME types anywhere in shared storage.
- **Internal storage:** the folder tree.

A camera photo therefore appears in Images › Camera and in Internal storage › DCIM ›
Camera, and nowhere else.

### Access (decision F1)
A real file browser needs one of these:
- **(A, recommended) All-files access** (`MANAGE_EXTERNAL_STORAGE`). On the AOSP image
  it's pre-granted via `default-permissions` / appop. In the APK variant it's granted once
  through the system "All files access" screen.
- **(B)** MediaStore only (Images/Videos/Audio/Downloads that we created). Downloads from
  other apps and Documents would be invisible, so B can't meet the goal.
- **(C)** SAF tree grants per root. This works without the special permission, but it
  costs one system picker per root and can't reach `Download/` or the storage root on
  Android 11+.

### Agent tools
- `files_filter{text?,kind?,folder?,from?,to?}`: read-only, shows a chip.
- `files_open{path}`, `files_share{paths}`, `files_move{paths,dest}` (reviewed),
  `files_trash{paths}` (reviewed, undoable), `files_folder_create{parent,name}` (reviewed).
- The model's fixture `reply()` regexes are deleted.

### TLA+: `tla/files-browser/Spec.tla`
- **Variables:** `fs` (a tree of path → {kind, mime, trashed}), `cwd`, `root∈{category,storage,trash}`,
  `selection`, `clipboard/op`, `filter`, `access`.
- **Actions:** Navigate, Up, OpenCategory, Select, Move, Copy, Rename, Trash,
  Restore, EmptyTrash, ExternalCreate/Delete (another app or the camera), AgentFilter,
  AgentMove (reviewed), AccessRevoke.
- **Safety:**
  - `CategoryIsQuery`: each category's listing equals its predicate over `fs`, so a camera
    JPEG is never in Downloads.
  - `DownloadsIsFolder`
  - `MoveConservesFiles`: no loss or duplication.
  - `NoOverwriteWithoutConfirm`
  - `TrashReversible`
  - `SelectionExists`
  - `FilterIsReadOnly`
- **Liveness:** listings converge after external changes.

---

## 5. Apps (formerly "All apps")

| Before | After |
|---|---|
| Home tile and drawer title "All apps"; count "14 APPS" | "Apps". No count |
| Lists every product view (Inbox … Settings) as Favorites, with up, down and star controls on every row | Lists **installed Android apps only** (the AOSP set on the image: Calculator, Clock, Contacts, Files, Settings, …, plus anything installed). 4-column icon grid, alphabetical, with a search field (decision A1) |
| Reordering and choosing Home apps happens in the drawer | Moves to Home: long-press an icon → Remove / Move. Long-press an Android app in Apps → Add to Home. Hidden product views come back through Home edit mode → "+" |

Implementation: filter `alpha:` keys out of `matching`, `pinned` and `count` in
`home-launcher.ts:318-348`, not out of `snap.apps` (which Home is built from). Product
views keep their Home placement. No TLA+ spec is needed beyond a unit test; the drawer is
a pure projection of `DeviceApps.list`.

---

## Decisions
Answered 2026-11-06:
- **F1: All-files access.** Pre-granted to the launcher on the AOSP image. The standalone
  APK asks for it at the beginning, as a step in the startup permission walkthrough
  (`startup-permission-flow.ts`, which already has a checked spec in
  `specs/startup-permissions`; that spec gains the step). `MANAGE_EXTERNAL_STORAGE` is an
  app-op, not a runtime permission, so `default-permissions` XML can't grant it. The image
  sets the app-op for the launcher during provisioning (to be verified on Cuttlefish and the
  Pixel 10a image).
- **N2:** Recently deleted keeps notes for 30 days, matching Apple Notes.
- **C2:** New captures go to `DCIM/Camera`, the Android standard.

Final:
- **C1:** Scan is removed as a camera mode. Scanning goes through the agent: asking Alpha to scan
  while Camera is open captures one frame into scan review.
- **P1:** Photo grid edge-to-edge.
- **P2:** No photo search box; agent filter tools.
- **N1:** Folders.
- **N3:** One-column notes list.
- **F2:** No Recents.
- **A1:** Apps drawer is a 4-column icon grid.

## TLA+ models (written and checked 2026-11-06)
Specs are in `design/view-refresh-2026-11/tla/{camera-session,photos-library,notes-view,files-browser}`,
run by `tla/check.sh <tla2tools.jar>`; results in `tla/results.md`.
`Design.cfg` is the proposed design. Each `AsBuilt_*.cfg` turns off one fix, to show that
today's code has the defect. Each `Ablate_*.cfg` turns off one design rule, to show the
rule is needed.

Design changes the models found:
- **Camera:** if the agent queues a photo during start and you then start recording, the
  agent's request would wait as long as you record. Rule: starting a recording refuses the
  queued agent capture, and the agent says so.
- **Camera:** every start re-checks access, since you may have granted it in Settings after
  a denial. Without this, Camera could stay "starting" forever.
- **Files:** moving or restoring into a folder that already has that name picks a free
  "name (1)" and never replaces the existing file.

## Phases after approval
0. On the Pixel 10a, measure camera cold and warm first frame and shutter latency, and
   record the before numbers.
1. Write the TLA+ specs. Run the as-built configuration to reproduce the bugs listed
   above, then the fixed design. Specs and run logs go under
   `design/view-refresh-2026-11/tla/`.
2. Camera: the header cleanup and the native startup and shutter work (as a
   `patches/eliza` patch), then re-measure.
3. Photos: the unified catalog, grid, selection, viewer and agent filter.
4. Notes: folders, recently deleted, unlimited recorder and streaming ASR.
5. Files: the access model, browse roots, tree and trash.
6. Apps drawer.
7. Run `npm run verify` and `npm run android:build:local`, and check both distribution
   variants. Do an emulator HOME-role run, then a device run on the Pixel 10a. Each
   phase's evidence is reported separately: an APK build doesn't prove an image boot, and
   neither proves device acceptance.
