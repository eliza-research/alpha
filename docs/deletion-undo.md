# Durable Calendar and reminder deletion

Implementation work for #414. This document describes source behavior and explicit
remaining acceptance, not a completed device or provider qualification.

The window is shared elizaOS code consumed through the pin. The native engine is
`@elizaos/capacitor-action-journal`'s `ai.eliza.plugins.actionjournal.deletion` package
(`DeletionDeadline`, `DeferredDeletionJournal`, `DeletionDispatchClaim`,
`DeletionReceiptRecovery` and `DeferredDeletionCoordinator` with slot, clock, owner, reminder,
Calendar and scheduler ports). The renderer contract is `@elizaos/contracts/deletion-window`
and the Undo notice is `@elizaos/ui`'s `DeferredDeletionNotice`. Alpha keeps bindings only:
`NativeDeletionCoordinator` (installed slots `native-delete-journal:v1` and
`native-delete-installation:v1`, boot-count clock, owner route, reminder engine, Calendar
writes and the `alpha-delete-window` WorkManager job), the `AlphaDeletions` review dialogs and
bridge, and `runtime/deletion-undo.tsx`.

A reviewed deletion records the exact target and a ten-second monotonic deadline
before any deletion. Reminder admission persists suspension in the same envelope
as the intent; delivery and rearming read that suspension. Undo removes suspension
without changing occurrence identity, due time, revision or the saved record. A due
occurrence then follows the existing delivery policy. Expiry and Undo serialize
through the native journal or browser document transaction.

Native work uses Android boot identity and elapsed time. Restart in the same boot
continues the original deadline. Unknown boot identity, reboot, or browser renderer
replacement cannot prove clock continuity, so the saved intent waits for explicit
Undo and renewed review. Owner/permission refusal pauses the intent permanently;
restoring access does not silently execute a formerly blocked deletion.

Manual operations bind the private installation and exact source. Agent review
captures authenticated native owner context off the UI thread. Confirmation fences
all provider/session/enrollment inputs without UI HTTP. Expiry obtains fresh native
authentication. A returning matching account, agent and enrollment can cancel a
retained intent after authentication, but cannot authorize an old session's write.
Visibility caching is bounded and invalidated by changed local authority inputs;
it is never write authority.

A native dispatch claim in the existing action journal survives bounded deletion
history retention. Cached renderer recovery cannot remove or replace the claim.
Only exact scope/proposal/operation-hash receipts can reconcile a terminal unknown
result. Verified deletion reports success; Undo reports the unchanged item without
a deletion result. Dispatching or missing evidence remains unknown, with no replay.
The browser development journal uses exact document receipts and CAS recovery.

The explicit shared patches are admitted by `patches/eliza/native-manifest.json`.
The pinned vendor checkout remains unchanged. The native deletion journal and
installation slots are denied to renderer credential APIs.

## Scope and evidence

The browser supports local events and series through the existing recurrence
model, and reminders. Native reminders use the shared persisted scheduler. Native
Calendar has a scoped follow-up under qualification: explicit version-two identities
bind one event, one original recurrence instance, or an entire series. The native
review states scope and potential calendar-service/guest propagation. Source,
family, attendee and reminder snapshots are asserted together before dispatch.
Old numeric agent targets retain the previous local nonrecurring boundary. RRULE
occurrences use Android's exception API; RDATE-only occurrence cancellation remains
unavailable rather than widening to series deletion. Remote service completion,
installed review/process-death behavior, and provider-specific recurrence behavior
remain acceptance work; this is not a claim that #414 is complete.

Focused host tests cover monotonic deadlines, process-restored journals, Undo/expiry
races, original reminder occurrence retention, revision/owner refusal, immutable
claims after 600 terminal records, and exact read-only receipt recovery. Controlled
browser UI tests cover review cancellation, delayed expiry, Undo, renderer restart,
late completion, uncertain admission responses, two-tab storage and retained legacy
unknown receipts. Exact run results are recorded with the review candidate.

Installed native proof remains required for scheduler/process-death behavior and
Calendar provider readback in both distribution variants. A shared-store native
fixture is registered as `ReminderDeletionJournal`; its fresh-store reconstruction
is not a substitute for killing and restarting the installed process. Real synced
Calendar integration and device/user acceptance remain separate.

Uncertain outcomes offer **Refresh receipt**, which re-reads the saved status without repeating
the provider write. It does not claim a new provider verification. **Dismiss outcome** hides
the notice for the same owner while retaining the unknown receipt and its no-replay state.
Dismissal does not restore an item or assert that deletion failed. The canonical deletion
journal remains the only scheduler and Undo authority in both browser and Android.
