# Service implementation trace checks

`runServicesRefinement()` returns fourteen receipts plus explicit remaining obligations.
Every receipt binds the observed source, adapter and support code before execution,
then checks recorded observations and the model safety predicate at each checkpoint.

The adapters execute production functions and classes with controlled external ports.
They exercise 55 bounded schedules across all fourteen service models. The receipts
retain the implementation observations, selected model transitions and input hashes.

| Model | Executed source | Remaining boundary |
| --- | --- | --- |
| IdentitySession | Pending serialization, callback parsing and matching | Full native sign-in and acknowledgement orchestration |
| ServiceAuthorization | Signed/fallback entitlement checks and refresher timers | Managed-service route and backend authorization |
| GoogleAccounts | Connect flow, callback matching, disconnect and account readback | Installed App Links, background retirement and consumers |
| CalendarSync | Durable outbox, competing claims, Undo, reboot and uncertain create | Linked native Calendar sync |
| InboxDelivery | Real operation CAS, review validation, dispatch and restoration | Full composer/grant/cleanup orchestration |
| MapsNavigation | Device navigation and shared MapsController | Native location, full surface and background service |
| WorkflowExecution | Canonicalization, validation receipts and intent storage | Worker effects, approval and trigger orchestration |
| NoticesAndCaches | Cache persistence/expiry and owner transition retry | Native delivery ledger and notification platform |
| BrowserSiteState | Site record persistence and passkey policy readback | Installed WebView, permissions and HTTP-auth prompts |
| BrowserReadingState | Capability probe and actual question-review DOM | Isolated extraction and native speech token |
| BrowserDownloads | Cookie-origin and history policies | Native transfer, blob capture and publication |
| ScanDocument | Actual DOM, IndexedDB draft store and export/picker wrapper | PDF conversion, OCR and arbitrary multi-page schedules |
| NativeCredentialMutation | Real store classification, recheck and invalidation | Shutdown orchestrator and encrypted storage primitives |
| PdfWorker | Actual service admission, render cleanup and reply code | Real renderer, kernel isolation, transfer and process death |

Chromium supplies the real DOM and IndexedDB for scan and content-question checks.
The default is Playwright's installed Chromium. `ALPHA_CHROMIUM_PATH` explicitly
selects another binary. Java component checks use the installed JDK and pinned
`org.json` jar. Android primitive ports record calls and resource state but do not
establish Android kernel, Keystore or physical-device behavior.

The scan source now preserves an explicitly saved or loaded draft through later
autosaves and confirmed exports. Its preservation predicate is part of safety.
The earlier expected-violation scenario has been retired. The four scan schedules
exercise automatic cleanup, explicit preservation, a later autosave and an
unverified export through the normal UI entry point.

```sh
bun test test/quint-services-refinement.test.mjs
bun test test/quint-scan-conformance.test.mjs
```

These are bounded component and orchestration checks. Remaining obligations in
`index.mjs` are part of the result and prevent a claim of universal implementation
refinement or complete Android/provider acceptance.
