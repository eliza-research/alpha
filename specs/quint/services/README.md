# Service and data state models

The service manifest records finite state abstractions, exact source mappings,
scenario names and model bounds. Source-executing adapters and their limitations
are described in [the service refinement report](../refinement/services/README.md).

## Current source ownership

The main-based port uses upstream
`475a8d59dc1811c2cde093613519906a5a3f6457`. Shared controllers execute from
an authenticated client projection. Reviewed patches and their preimage/output
hashes are listed in `patches/eliza/service-state-client-manifest.json`.

| Module | Main state and safety boundary |
| --- | --- |
| [IdentitySession](IdentitySession.qnt) | Credential intent, interactive attempt, durable activation and acknowledgement. Native-family migration maintains its current source correspondence. |
| [ServiceAuthorization](ServiceAuthorization.qnt) | Signed entitlement, fallback billing view, expiry, retry and current request ownership. |
| [GoogleAccounts](GoogleAccounts.qnt) | Current grants, one-use native return drain, queued notification, account readback and independent optional disconnect cleanup. |
| [CalendarLinkedSync](CalendarLinkedSync.qnt) | Current linked-event semantic comparison, durable pending operation, provider result, local CAS, quarantine/readback recovery and exact consent review. |
| [InboxDelivery](InboxDelivery.qnt) | Durable review/dispatch journal, unknown outcomes and one-shot retained operation ownership. |
| [InboxCoordinator](InboxCoordinator.qnt) | Current capabilities, two retained account slots, exact composer/attachment identity and individual local cleanup writes. |
| [InboxProviderDrafts](InboxProviderDrafts.qnt) | Three separately reviewed create/replace/delete requests, provider-reference adoption, forward-part identity and partial persistence. |
| [MapsNavigation](MapsNavigation.qnt) | Route ownership, permission/fix admission, direct-start approval and retained route during rerouting. |
| [WorkflowExecution](WorkflowExecution.qnt) | Reviewed submission, retained identity, admission and effect approval. Only validation/receipt/intent-store paths have service source traces. |
| [NoticesAndCaches](NoticesAndCaches.qnt) | Owner-fenced cache writes and expiry, notice claim/post/consume states. Native delivery remains a distinct source obligation. |
| [BrowserSiteState](BrowserSiteState.qnt) | Profile/cookie admission, origin permissions and manual HTTP authentication. WebAuthn stays at the shared fresh-WebView disabled default. |
| [BrowserReadingState](BrowserReadingState.qnt) | Isolated extraction, sensitive-page refusal, single-use reviewed excerpt and local question draft. |
| [BrowserDownloads](BrowserDownloads.qnt) | Reviewed download, origin-bound cookies, ordered blob chunks and publication evidence. |
| [ScanDocument](ScanDocument.qnt) | Ordered page/text pairs, serialized CAS save, explicit draft ownership, picker visibility and export retry lock. |
| [NativeCredentialMutation](NativeCredentialMutation.qnt) | Credential/provider CAS, shutdown admission and partial commit. Native-family migration maintains source correspondence. |
| [PdfWorker](PdfWorker.qnt) | Busy admission, descriptor/bitmap/mapping cleanup and read-only output publication. |

[CalendarSync](../legacy/CalendarSync.qnt) is retained historical modeling of the removed
GoogleCalendarOutbox API. Its undo-clock and explicit unknown-create-retry actions
have no current main-source correspondence. It is classified as a historical-source model in the legacy manifest. New Calendar source traces check
`CalendarLinkedSync`.

## Boundaries

Opaque IDs, revisions, digests and content become explicit finite equality
classes. Those classes preserve the ownership comparisons exercised by each
model. They do not prove parser correctness, cryptography, arbitrary collections
or platform persistence. Every model has explicit stuttering and executable
scenarios. `safety` combines the named invariants declared in the manifest.

A model safety result quantifies over its finite abstraction. Source trace checks
exercise selected concrete schedules and compare observed fields against the
model at checkpoints. They do not establish an unrestricted refinement proof.
Native permissions, encrypted durability, OS process death, network/provider
behavior and physical-device acceptance require their own execution evidence.

Current source repairs preserve successful explicit scan Save/Load ownership
through later autosaves and export, canonicalize retained Inbox provider refs,
keep reviewed forwarded parts, apply current forward capability checks and
report incomplete local cleanup after successful provider send. Their source
regressions execute generated shared code without changing the vendor checkout.

## Reproduction

```sh
node_modules/.bin/quint typecheck specs/quint/services/CalendarLinkedSync.qnt
node_modules/.bin/quint test specs/quint/services/CalendarLinkedSync.qnt
node_modules/.bin/quint run specs/quint/services/CalendarLinkedSync.qnt --backend=typescript --seed=123 --max-samples=1000 --max-steps=80 --invariant=safety
node_modules/.bin/quint verify specs/quint/services/CalendarLinkedSync.qnt --max-steps=4 --invariant=safety --server-endpoint=localhost:8891
```

The source campaign has 134 schedules and 771 observed checkpoints across
14 current owned service models. The two native-maintained models are integrated
separately. See `test-results/quint-main-services` for the current per-model
logs, command/version records and hashes. Earlier b25-pin service, Inbox and scan
receipts are historical evidence for their recorded source bytes only.
