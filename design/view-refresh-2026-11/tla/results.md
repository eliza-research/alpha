# View refresh TLA+ results (TLC 2026-11-06)

Run: `design/view-refresh-2026-11/tla/check.sh <tla2tools.jar>` (writes <area>/results/, untracked).

| Spec | Config | Result | Distinct states |
|---|---|---|---|
| camera-session | AsBuilt_AgentQueue | Action property AgentFailsOnlyForCause is violated | 38 |
| camera-session | AsBuilt_ChatGrace | Action property ChatKeepsPreview is violated | 34 |
| camera-session | AsBuilt_Focus | Invariant NoLostShutter is violated | 103 |
| camera-session | AsBuilt_Leave | Invariant NoStuckCapture is violated | 310 |
| camera-session | AsBuilt_Lens | Invariant LensSettingsValid is violated | 88 |
| camera-session | Design | No error has been found | 2,742 |
| photos-library | AsBuilt_Cap | Invariant NoSelectionCap is violated | 940 |
| photos-library | AsBuilt_FavToggle | Invariant FavoriteReversible is violated | 1009 |
| photos-library | AsBuilt_Patch | Invariant NoSpuriousClear is violated | 787 |
| photos-library | AsBuilt_Window | Invariant NewestNeverDropped is violated | initial state |
| photos-library | Design | No error has been found | 204,208 |
| notes-view | Ablate_RestoreFolder | Invariant FolderRefsValid is violated | 1259 |
| notes-view | AsBuilt_Cap | Invariant NoLengthLimit is violated | 104 |
| notes-view | AsBuilt_Segments | Action property CrashKeepsAudio is violated | 2535 |
| notes-view | AsBuilt_StreamAsr | Temporal property TranscriptKeepsUp was violated | 59216 |
| notes-view | Design | No error has been found | 131,110 |
| files-browser | Ablate_Conflict | Invariant NoOverwriteWithoutConfirm is violated | 255 |
| files-browser | AsBuilt_Categories | Invariant CategoryIsQuery is violated | initial state |
| files-browser | Design | No error has been found | 112,117 |

camera-session re-checked 2026-11-06 (TLC 2.19, 4 workers) after the camera port added the chat sheet
(variable `chat`, actions ChatOpen/ChatGraceEnds/ChatClose, constant FixChatGrace, properties
ChatKeepsPreview and ChatGraceReleases; PLAN item 7). An agent capture after the grace released the
session starts it again and is queued. OpenReachesPreviewOrError also accepts a start that the chat
grace released while the chat is open; closing the chat starts again. AsBuilt_Lens now reports
LensSettingsValid (Flash offered on the front lens) before FlipNeverRejected; both are as-built defects.
