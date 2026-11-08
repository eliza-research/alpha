# Service implementation trace checks

## Current main-based port

The current owned campaign executes 134 bounded source schedules and 771
checkpoints across 14 service models. It produces 15 receipts because
`InboxCoordinator` has separate admission and per-write cleanup campaigns.
Identity and native credential campaigns are maintained by the native migration.
The root aggregate integrates those campaigns separately.

The effective client sources come from upstream
`475a8d59dc1811c2cde093613519906a5a3f6457`. `serviceInputs()` checks the
343-file staged projection against its provenance, verifies the 339 original
upstream files, and binds the patch manifests, patch files, preparers, package
lock, driver and explicitly declared product sources before execution. This
broad provenance set does not imply behavioral coverage for every hashed file.

| Model | Actual source exercised | Remaining boundary |
| --- | --- | --- |
| ServiceAuthorization | Shared subscription entitlement verification and refresher, through Alpha export | Managed-service route and backend authorization |
| GoogleAccounts | Alpha account facade, native Workspace-return preparation/drain, canonical optional disconnect cleanup | Installed OAuth/App Links, native return persistence, complete Calendar select/resume flow |
| CalendarLinkedSync | Shared reconciler, linked-store CAS, controller review/enable, concurrent admission and full sync | Canonical AgentCalendar service, native Calendar provider, process death between writes |
| InboxDelivery | Shared operation journal through Alpha attachment-review wrapper | Actual provider authorization and delivery |
| InboxCoordinator | Shared review/draft controllers with Alpha account, attachment and retained-draft ports | Arbitrary shelf collections, simultaneous cleanups, Inbox row reconciliation |
| InboxProviderDrafts | Shared create/replace/delete review, provider-reference adoption and forwarded-part identity | Arbitrary repeated replacements and actual Gmail semantics |
| MapsNavigation | Shared device navigation, MapsController and Alpha provider transport | Native GPS, full renderer and background service |
| WorkflowExecution | Shared workflow client validation, save-receipt parser and Alpha durable intent store | Worker effects, approval and trigger orchestration |
| NoticesAndCaches | Alpha cache and shared notice-owner coordinator | Native delivery ledger and notification platform |
| BrowserSiteState | Shared site-permission record persistence | WebView creation, disabled-default WebAuthn, permission callbacks and HTTP-auth prompts |
| BrowserReadingState | Shared capability probe and Alpha question-review DOM | Isolated extraction and native speech-token lifecycle |
| BrowserDownloads | Shared cookie-origin and download-history policies | Native transfer, blob capture and publication |
| ScanDocument | Alpha DOM/IndexedDB and patched shared scan controller | PDF conversion, OCR and arbitrary multi-page schedules |
| PdfWorker | Shared isolated render service via Alpha component | Real renderer, kernel isolation, transfer, memory pressure and process death |

`CalendarSync` describes the removed Google outbox API. Its previous source
traces are historical, and `calendarRefinement()` now checks `CalendarLinkedSync`.
The old model is retained as a historical-source model in the legacy family. No compatibility transition is treated as current source evidence.

The BrowserSiteState port also distinguishes the current source policy. The
shared host reads back cookie isolation and checks multiprocess availability.
It leaves WebAuthn at the fresh WebView disabled default. The old explicit
passkey-settings readback helper no longer exists and is not exercised.

## Applied source repairs

The reviewed three-target patch is authenticated by
`patches/eliza/service-state-client-manifest.json`. It applies only to generated
client sources. The pinned vendor checkout remains unchanged.

- Shared Inbox review gates forwarded originals on current forwarding capability.
- Shared draft editing retains exact reviewed forwarded-part metadata and canonical
  `{draftId, providerDigest}` references, including legacy reference normalization.
- Failed shelf cleanup after provider-confirmed send retains remaining copies and
  reports incomplete cleanup.
- Shared scan autosaves preserve explicit Save/Load ownership, so confirmed export
  removes only drafts created solely by automatic saving.

The Inbox campaigns retain 27 source schedules from the previous branch plus
25 provider/forward schedules. They execute the current shared controllers and
Alpha injection wrappers. The previous b25-pin receipts remain historical.

## Reproduction and limits

```sh
node --test test/quint-inbox-provider-drafts.test.mjs
node --test test/quint-calendar-linked-refinement.test.mjs
node --test test/client-service-state.test.mjs test/client-service-patch.test.mjs
```

Chromium supplies real DOM and IndexedDB behavior for scan and question review.
Playwright's installed browser is used unless `ALPHA_CHROMIUM_PATH` is set.
JVM fixtures execute real shared Java service/helper code with controlled Android
primitives. They do not establish kernel, Keystore, installed provider or device
behavior.

Each recorded checkpoint checks observed implementation fields and the registered
model safety predicate. Unobserved fields, unexecuted actions and unbounded
schedules remain obligations. These checks do not prove universal implementation
refinement. Current source summaries and per-model formal logs are stored under
`test-results/quint-main-services`.
