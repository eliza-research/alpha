# Current-main application refinement work

This records source-transition obligations during reconciliation with upstream
`475a8d59dc1811c2cde093613519906a5a3f6457`. A model declaration or a historical
receipt does not discharge a current-source obligation.

## Current source bindings

| Scope | Checked entry points | Qualification |
| --- | --- | --- |
| Settings focus | `dc-lite.js`, `settings-adapter.ts`, mounted Settings native-role readback | Real Chromium insertion/focus/activation trace. Other mutable Settings collections still need identity review. |
| Browser snapshot | Shared `browsing-session.ts` snapshot/restore helpers | Normal/private persistence and non-pristine refusal are covered. Host navigation and native persistence remain separate. |
| Permission step | Alpha `startup-permission-flow.ts` over the shared permission-step implementation | Persistent and failed attempt writes are exercised through the current helper. |
| Permission coordinator | `startup-permissions.tsx`, progress reader/writer, native and browser ports | Current seven/four-step flow, lifecycle ownership, review, skip and persistence behavior are source-executed. Exact receipt counts are recorded in the coordinator notes. |

## Remaining coordinator and source obligations

| Application area | Current source | Required state/transition work |
| --- | --- | --- |
| Main shell | `main.tsx`, `prototype/model.js`, `prototype/home-shell.ts` | Rebind mounted shell/agent coordinator traces to the current shell join. Cover startup admission, external view requests, assistant detents, current-context cancellation and owner changes. The Settings focus trace covers only its row protocol. |
| Launcher | `prototype/home-shell.ts`, `prototype/apps-drawer.tsx`, shared native-system launcher and mobile-shell join | Model app-list load generations, package/activity/profile identities, native launch in flight, default handling, favorites persistence/migration, observation cleanup and stale completion. Model Home edit/drag, long press and drawer menu ownership separately where needed. The old `home-launcher.ts` draft remains historical. |
| Canonical Notes | `prototype/canonical-notes-ui.ts`, `canonical-notes-controller.ts`, `canonical-notes-editor.ts` | Bind canonical/local source switching, load/selection revisions, edit ownership, pending writes, filters and pinned/ordinary row membership. Retain the valid legacy-store model as a separate contract. |
| Notes recorder UI | `prototype/note-recorder.ts`, `runtime/note-recorder-driver.ts`, consumed shared recorder control | Cover control phase, selected recording/note ownership, asynchronous command results, ASR segment progress, visibility and recovery. Native segmented recording and service/notification ownership belong to `NativeNoteRecording` and `NativeNoteRecordingService`. |
| Notes folders | `prototype/notes-folders-adapter.ts`, `runtime/notes-folders.ts`, `notes-folders-model.ts` | Cover source-bound folder IDs, create/rename/delete, filtering, note moves, stale selections and restore-to-missing-folder behavior. |
| Files | `prototype/files-browser-adapter.ts`, `runtime/files-storage.ts`, `files-agent-contract.ts` | Replace the obsolete tree-token projection with the current per-volume path/identity model. Cover load/filter generations, watch lifecycle, selection, clipboard/move/copy, conflict outcomes, reviewed identity, Trash and refreshed listings. |
| Photos | `prototype/photo-library-adapter.ts`, `runtime/photos-view.ts`, `photos-view-contract.ts` | Cover loaded window/query state, page/refresh generations, store revisions, selection/viewer preservation, patch/delete/restore and late responses. The legacy `PhotosLibrary` design is not current controller refinement. |
| Calendar presentation | `prototype/calendar-form-draft-adapter.ts`, `runtime/calendar-form-draft.ts`, `agent-calendar-view.ts` | Bind canonical draft owner/revision, local edits, queued/delayed readback, view selection and transitions between canonical and retained local data. Linked-sync protocols remain separately owned. |
| Browser host | `prototype/browser-adapter.ts`, `browser/browser-surface.ts`, shared native browser store | Cover session hydration admission, per-tab navigation sequence, committed/error state, private lifetime, reopen, mutation and stale callback ownership through the actual host APIs. |
| Shared list focus | `prototype/subview-accessibility.ts`, current Notes/Photos/Files/Browser templates | Port the shared helper only where current source needs it. Verify stable item identity, cross-parent restoration, newer render/intent cancellation, hidden/inert surfaces and removal. The missing former helper path is not current evidence. |
| Remaining application contracts | Current credential-vault, durable-store, notification, attachment, draft and presentation entry points | Execute the existing adapters against current imports and record each remaining field/action obligation. Root owns shared codec/recovery and the global source inventory. |

Native and service models cover their own producers. Their presence does not
replace the renderer's consumer-state checks. New coordinator models must carry
current source observations and explicit ports/scheduling assumptions. Historical
source paths remain historical metadata when their implementations are removed.
