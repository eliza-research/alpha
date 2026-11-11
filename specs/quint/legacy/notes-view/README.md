# Historical Notes view source replay

The driver mounts flag-off Notes in Chromium. Canonical Notes uses the
existing closed app-record provider fixture and reads actual accepted
controller snapshots. Previous notes uses Alpha's real browser Notes and
folder documents. The campaign opens the same string note ID in the two
different sources, checks the selected object when it is current, and checks
retirement on Back, source switch and owner replacement. Canonical delete and
restore keep the same committed ID. Canonical Recently deleted is restore-only.

The retained folder adapter still renames a folder without moving its notes
and clears a missing folder reference when a note is recovered. The driver
calls the installed folder adapter for rename and removal because the current
list has no visible folder controls. It uses the mounted Recently deleted
controls for Trash and Recover and reads the persisted results. The replay
checks the historical Rename and Design actions and keeps the
Ablate_RestoreFolder mismatch separate.

A synthetic oscillator drives the actual browser capture and mounted recorder
controls. The fixture shortens only the rollover interval. A completed live
segment remains in the browser recorder. The finalized whole recording is
stored on Stop and the visible note offers transcription as a separate action.
The replay compares the supported phase and segment projections of the
historical segment and post-stop ASR profiles. Separate mismatches capture the
historical first-segment cap and the Design requirement that a live segment
already be durable. The canonical selected object's collection-wide revision
also differs from the historical per-note revision.

The original NotesView model and all seven profiles are retained. Notes source
identity and selected-object retirement are additional mounted assertions.
The campaign leaves native audio recovery, process death, hidden ASR liveness,
arbitrary folder data, installed device acceptance and actual provider behavior
outside its bounds.

With authenticated client features and Playwright Chromium prepared, run
`bun test ./test/quint-legacy-notes-view-refinement.test.mjs`.
