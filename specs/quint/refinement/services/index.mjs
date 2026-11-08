import {authorizationRefinement} from './authorization.mjs';
import {googleAccountsRefinement} from './google-accounts.mjs';
import {calendarRefinement} from './calendar.mjs';
import {inboxRefinement} from './inbox.mjs';
import {mapsRefinement} from './maps.mjs';
import {cacheRefinement} from './cache.mjs';
import {workflowRefinement} from './workflow.mjs';
import {runWorkflowEngineRefinement} from './workflow-engine/index.mjs';
import {runWorkflowWakeupRefinement} from './workflow-scheduler/index.mjs';
import {runWorkflowTaskRefinement} from './workflow-scheduler/registration.mjs';
import {policyRefinement} from './policies.mjs';
import {readingRefinement} from './reading.mjs';
import {scanRefinement} from './scan.mjs';
import {pdfRefinement} from './pdf.mjs';
import {runSignInCoordinatorRefinement} from './sign-in-coordinator.mjs';
import {runInboxCoordinatorRefinement} from './inbox-coordinator.mjs';
import {runInboxCleanupRefinement} from './inbox-cleanup.mjs';
import {runInboxProviderDraftsRefinement} from './inbox-provider-drafts.mjs';
import {checkCredentialLeasePolicies} from '../native/credential-leases.mjs';
import {checkCredentialCoordinator} from '../native/credential-coordinator.mjs';
import {fileURLToPath} from 'node:url';

export async function runServicesRefinement() {
  const receipts = [];
  const driverSources = [fileURLToPath(import.meta.url), 'test/quint-services-refinement.test.mjs'];
  for (const check of [authorizationRefinement, googleAccountsRefinement, calendarRefinement,
    inboxRefinement, mapsRefinement, cacheRefinement, workflowRefinement, policyRefinement,
    readingRefinement, scanRefinement, pdfRefinement]) {
    const result = await check(driverSources);
    receipts.push(...(Array.isArray(result) ? result : [result]));
  }
  receipts.push(await runSignInCoordinatorRefinement(undefined, driverSources));
  const inboxCoordinator = await runInboxCoordinatorRefinement(driverSources);
  receipts.push(...inboxCoordinator.receipts);
  const inboxCleanup = await runInboxCleanupRefinement(driverSources);
  receipts.push(...inboxCleanup.receipts);
  const providerDrafts = await runInboxProviderDraftsRefinement(driverSources);
  receipts.push(...providerDrafts.receipts);
  receipts.push(await checkCredentialLeasePolicies(driverSources));
  const credential = await checkCredentialCoordinator(driverSources, ['NativeCredentialMutation']);
  receipts.push(...credential.receipts);
  const workflowEngine = await runWorkflowEngineRefinement(driverSources);
  receipts.push(...workflowEngine.receipts);
  const workflowWakeups = await runWorkflowWakeupRefinement(driverSources);
  receipts.push(...workflowWakeups.receipts);
  const workflowTasks = await runWorkflowTaskRefinement(driverSources);
  receipts.push(...workflowTasks.receipts);
  const obligations = [
    {model: 'IdentitySession', obligation: 'Native authorization, encrypted storage and wider concurrent activation', reason: 'Twenty-one full-plugin schedules cover callback retirement, cancellation races, receipt/key commits, overlapping acknowledgement and newer attempts, previous-key revocation and restart. Native authorization timing, actual Keystore behavior and arbitrary overlapping attempts remain further obligations.'},
    {model: 'ServiceAuthorization', obligation: 'Managed-service dispatch authorization', reason: 'Entitlement refresh and admission views execute; exact route validation and server authorization still need their own dispatch trace adapter.'},
    {model: 'GoogleAccounts', obligation: 'Account-list consumers and native return delivery', reason: 'Connect/disconnect orchestration executes with controlled browser return and retirement ports; Inbox/Calendar cache consumers and installed App Link delivery remain separate.'},
    {model: 'CalendarLinkedSync', obligation: 'Native Calendar provider and abrupt process death', reason: 'The current shared linked-store reconciler executes review, enable, pause, concurrent admission, mutation and recovery schedules. Installed Calendar provider effects and power-loss durability require platform evidence.'},
    {model: 'InboxDelivery', obligation: 'Unbounded shelf collections and installed Gmail effects', reason: 'Actual operation CAS, review, dispatch, restart, interrupted cleanup and provider-draft/forward schedules execute. Arbitrary collection sizes and real provider acceptance remain outside the bounded campaign.'},
    {model: 'MapsNavigation', obligation: 'Native GPS, full renderer and background navigation', reason: 'DeviceNavigation and MapsController execute against controlled surface/provider/location ports. Full adapter and native service lifecycle still require installed traces.'},
    {model: 'WorkflowExecution', obligation: 'Execution admission, effects and development triggers', reason: 'Real canonicalization, receipt verification and durable intent-store paths execute. No worker execution or provider idempotency is established by those source observations.'},
    {model: 'NoticesAndCaches', obligation: 'Native delivery claims, posting, tap consumption and acknowledgements', reason: 'Real cache CAS/expiry/restart and owner retry execute. Delivery-ledger actions need native source traces.'},
    {model: 'BrowserSiteState', obligation: 'Installed WebView and permission orchestration', reason: 'The current shared site-permission records execute. WebAuthn remains disabled by the fresh WebView default. Cookie profile creation, Android permission callbacks and HTTP-auth UI require installed tests.'},
    {model: 'BrowserReadingState', obligation: 'Isolated world and speech-token consumption', reason: 'Actual capability probes and question-review DOM execute. Extraction-world authenticity, token expiry and native speech consumption need Android provider traces.'},
    {model: 'BrowserDownloads', obligation: 'Native transfer, capture and publication', reason: 'Real cookie-origin and history policy executes. Byte transfer, blob nonce/chunk handling and MediaStore completion require native BrowserDownloads execution.'},
    {model: 'ScanDocument', obligation: 'Full image/PDF conversion and arbitrary draft schedules', reason: 'Actual UI, IndexedDB draft storage and picker/export policy execute for four schedules. PDF conversion, OCR/correction and exhaustive multi-page schedules remain outside the bounded adapter.'},
    {model: 'NativeCredentialMutation', obligation: 'Installed shutdown, encryption and wider lock interleavings', reason: 'The complete credential, connection and resident plugins execute against controlled storage/service ports, including strict shutdown, partial commits and destroyed-bridge reservation races. Installed process termination and encrypted persistence remain separate obligations.'},
    {model: 'PdfWorker', obligation: 'Kernel isolation, descriptor transfer, watchdog and memory kill', reason: 'Actual service request/render/cleanup/reply code executes against Android primitives. Host stubs cannot establish kernel or real PDF renderer behavior.', requires: ['IsolatedPdfInstrumentedTest on a disposable admitted installation']},
  ];
  obligations.push(...inboxCoordinator.obligations);
  obligations.push(...inboxCleanup.obligations);
  obligations.push(...credential.obligations);
  obligations.push(...providerDrafts.obligations);
  obligations.push(...workflowEngine.obligations);
  obligations.push(...workflowWakeups.obligations);
  obligations.push(...workflowTasks.obligations);
  return {receipts, obligations};
}
