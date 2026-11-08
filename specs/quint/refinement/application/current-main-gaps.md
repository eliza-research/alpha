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

| Client contracts | `runtime/alpha-client.ts` with current shared imports | Owner replacement, deferred transport, reviewed proposal consumption and automatic workflow cancellation boundaries execute current source. |
| Existing device notes | Explicit `Previous notes` through installed `agent-adapter.ts` | Queued write failure before/after commit and explicit reopen execute the current retained source. The unsaved draft remains for a separate recovery review. Canonical Notes is separate. |
| Files preview | `files-browser-adapter.ts` storage selection and leave | Current, retired and return-before-reply schedules. Storage/plugin and modal ports are controlled. `FilesTree` is historical. |
| Layout and drafts | Shared responsive-layout, durable-draft and deletion-planner imports | Existing bounded helper/contract checks now execute current re-exports. |

## Remaining coordinator and source obligations

| Application area | Current source | Required state/transition work |
| --- | --- | --- |
| Main shell | `main.tsx`, `prototype/model.js`, `prototype/home-shell.ts` | Rebind mounted shell/agent coordinator traces to the current shell join. Cover startup admission, external view requests, assistant detents, current-context cancellation and owner changes. The Settings focus trace covers only its row protocol. |
| Launcher | `prototype/home-shell.ts`, `prototype/apps-drawer.tsx`, shared native-system launcher and mobile-shell join | Model app-list load generations, package/activity/profile identities, native launch in flight, default handling, favorites persistence/migration, observation cleanup and stale completion. Model Home edit/drag, long press and drawer menu ownership separately where needed. The old `home-launcher.ts` draft remains historical. |
| Canonical Notes | `prototype/canonical-notes-ui.ts`, `canonical-notes-controller.ts`, `canonical-notes-editor.ts` | Bind canonical/local source switching, load/selection revisions, edit ownership, pending writes, filters and pinned/ordinary row membership. Retain the valid legacy-store model as a separate contract. |
| Notes recorder UI | `prototype/note-recorder.ts`, `runtime/note-recorder-driver.ts`, consumed shared recorder control | Cover control phase, selected recording/note ownership, asynchronous command results, ASR segment progress, visibility and recovery. Native segmented recording and service/notification ownership belong to `NativeNoteRecording` and `NativeNoteRecordingService`. |
| Notes folders | `prototype/notes-folders-adapter.ts`, `runtime/notes-folders.ts`, `notes-folders-model.ts` | Cover source-bound folder IDs, create/rename/delete, filtering, note moves, stale selections and restore-to-missing-folder behavior. |
| Files | `prototype/files-browser-adapter.ts`, `runtime/files-storage.ts`, `files-agent-contract.ts` | The obsolete tree-token projection is historical. Extend beyond the current `FilesPreview` callback model with a current per-volume path/identity model. Cover load/filter generations, watch lifecycle, selection, clipboard/move/copy, conflict outcomes, reviewed identity, Trash and refreshed listings. |
| Photos | `prototype/photo-library-adapter.ts`, `runtime/photos-view.ts`, `photos-view-contract.ts` | Cover loaded window/query state, page/refresh generations, store revisions, selection/viewer preservation, patch/delete/restore and late responses. The legacy `PhotosLibrary` design is not current controller refinement. |
| Calendar presentation | `prototype/calendar-form-draft-adapter.ts`, `runtime/calendar-form-draft.ts`, `agent-calendar-view.ts` | Bind canonical draft owner/revision, local edits, queued/delayed readback, view selection and transitions between canonical and retained local data. Linked-sync protocols remain separately owned. |
| Browser host | `prototype/browser-adapter.ts`, `browser/browser-surface.ts`, shared native browser store | Cover session hydration admission, per-tab navigation sequence, committed/error state, private lifetime, reopen, mutation and stale callback ownership through the actual host APIs. |
| Shared list focus | `prototype/subview-accessibility.ts`, current Notes/Photos/Files/Browser templates | Port the shared helper only where current source needs it. Verify stable item identity, cross-parent restoration, newer render/intent cancellation, hidden/inert surfaces and removal. The removed helper and its `ListFocus` model are historical and supply no current-source evidence. |
| Remaining application contracts | Current credential-vault, durable-store, notification, attachment, draft and presentation entry points | Execute the existing adapters against current imports and record each remaining field/action obligation. Root owns shared codec/recovery and the global source inventory. |

Native and service models cover their own producers. Their presence does not
replace the renderer's consumer-state checks. New coordinator models must carry
current source observations and explicit ports/scheduling assumptions. Historical
source paths remain historical metadata when their implementations are removed.

## Next canonical Notes split

The current canonical source adds three linked controllers. The controller and draft/save core now have current source-bound models.
Delete/restore continuations and UI state remain separate from the
retained-device Notes contract.

- `CanonicalNotesController` is modeled and source-executed through fourteen bounded schedules. It owns an authority-bound snapshot, a coalesced read,
  an abortable read token, one writing operation, invalidation during either
  operation, monotonic accepted revisions and authenticated event subscription.
  An interrupted read and a later write can both still have outstanding transport
  promises. Retiring the controller ends authority before those promises settle.
- Shared `NotesEditor` has a source-bound `CanonicalNotesDraft` model for open/begin/edit/save/reconcile/close and selection. Delete/restore continuations remain open. It owns a draft token, record identity, base revision, edit
  version, authored content/format, an active save and one queued edit version.
  A successful save updates only its captured draft token. Dirty external
  revisions require review, while clean drafts follow current snapshots. Empty
  new drafts, delete-after-save and restore use separate guarded paths.
- `CanonicalNotesUi` owns presentation/review classification, pending idle
  waiters, projected base rows and editable rows, open/draft identity, Trash
  rows, source-derived status and action decoration. It also mediates selection
  after saves, creation in a folder, voice transcript creation, note-to-Calendar
  draft handoff and dictation returning to the current editor.

Source-bound tests must retain the distinction between canonical and explicitly
selected Previous notes. The latter's passing queued-write traces do not cover
these canonical controllers.
