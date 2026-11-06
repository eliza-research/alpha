# View refresh TLA+ results (TLC 2026-11-06)

Run: `design/view-refresh-2026-11/tla/check.sh <tla2tools.jar>` (writes <area>/results/, untracked).

| Spec | Config | Result | Distinct states |
|---|---|---|---|
| camera-session | AsBuilt_AgentQueue | Action property AgentFailsOnlyForCause is violated | 57 |
| camera-session | AsBuilt_Focus | Invariant NoLostShutter is violated | 144 |
| camera-session | AsBuilt_Leave | Invariant NoStuckCapture is violated | 283 |
| camera-session | AsBuilt_Lens | Invariant FlipNeverRejected is violated | 92 |
| camera-session | Design | No error has been found | 1,344 |
| photos-library | AsBuilt_Cap | Invariant NoSelectionCap is violated | 940 |
| photos-library | AsBuilt_FavToggle | Invariant FavoriteReversible is violated | 1009 |
| photos-library | AsBuilt_Patch | Invariant NoSpuriousClear is violated | 787 |
| photos-library | AsBuilt_Window | Invariant NewestNeverDropped is violated | initial state |
| photos-library | Design | No error has been found | 204,208 |
| notes-view | Ablate_RestoreFolder | Invariant FolderRefsValid is violated | 2174 |
| notes-view | AsBuilt_Cap | Invariant NoLengthLimit is violated | 220 |
| notes-view | AsBuilt_Segments | Action property CrashKeepsAudio is violated | 6764 |
| notes-view | AsBuilt_StreamAsr | Temporal property TranscriptKeepsUp was violated | 169238 |
| notes-view | Design | No error has been found | 4,199,034 |
| notes-view | Rename | No error has been found | 1,477,710 |
| files-browser | Ablate_Conflict | Invariant NoOverwriteWithoutConfirm is violated | 255 |
| files-browser | AsBuilt_Categories | Invariant CategoryIsQuery is violated | initial state |
| files-browser | Design | No error has been found | 112,117 |

notes-view models folder names (`Names`, `RenameFolder`, `FolderNamesUnique`,
`RenameKeepsMembership`). Design uses two names, so a rename needs a freed name; `Rename`
checks renames with three names and smaller recorder bounds (MaxSeg 1, Budget 1).
