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
| notes-view | Ablate_RestoreFolder | Invariant FolderRefsValid is violated | 1259 |
| notes-view | AsBuilt_Cap | Invariant NoLengthLimit is violated | 104 |
| notes-view | AsBuilt_Segments | Action property CrashKeepsAudio is violated | 2535 |
| notes-view | AsBuilt_StreamAsr | Temporal property TranscriptKeepsUp was violated | 59216 |
| notes-view | Design | No error has been found | 131,110 |
| files-browser | Ablate_Conflict | Invariant NoOverwriteWithoutConfirm is violated | 218 |
| files-browser | AsBuilt_Categories | Invariant CategoryIsQuery is violated | initial state |
| files-browser | Design | No error has been found | 1,554,984 |

## files-browser, revised with the implementation (TLC 2026-11-06)

The code forced one change. The renderer cannot know about an external change before
Android reports it (`storageChanged`), so selection actions are no longer guarded by
`~stale`. Instead a selected row that is gone is skipped (the "missing" outcome) in
`TrashSel`/`MoveSel`, `Refresh` prunes the selection to the listing, `SelectionExists`
becomes `~stale => sel \subseteq Listing(cwd)`, and the new action property
`SelectionActsOnlyOnPresent` (checked in every cfg) says a selection action touches only
files that are really in the open folder. Rerun with 2 workers: Design 10,657,224 states
generated, 1,554,984 distinct, no error (all invariants and temporal properties);
Ablate_Conflict and AsBuilt_Categories still fail as above (non-vacuity).

Extra SD/USB volumes are separate trees: every storage call names one volume and a move
or copy stays inside it, so the single-volume model covers each of them. The F1 Files step
in the startup walkthrough uses the request, settings, resume and refresh path that
`specs/startup-permissions` already models over K abstract keys; it needs no change there.

## notes-view, revised for review finding 6 (TLC 2026-11-06)

The renderer transcribes Notes segments only while Notes is shown (note-recorder.ts `pump`),
so the spec now has `shown` (Hide/Show actions) and the constant `AsrWhileHidden` (FALSE: the
code). `AsrSegment` needs `shown \/ AsrWhileHidden`; TranscriptKeepsUp and AsrSettles claim
catching up only while Notes is shown, and a recording made with Notes hidden is transcribed
when it is shown again or at Done. Every notes-view cfg sets `AsrWhileHidden = FALSE`.
New `AsBuilt_Hidden.cfg` (Design with the old unconditional property `TranscriptKeepsUpHidden`):
Temporal property TranscriptKeepsUpHidden is violated (51,655 distinct states), i.e. the
deviation is real and recorded. Design (4 workers): 73,280,298 states generated, 8,398,068 distinct, no error (all invariants and temporal properties). The other notes-view cfgs only gained the constant and were not rerun.
Agent-notes Done (outside the modelled state) is now refused until asr = recorded (comment only).
