import {authorizationRefinement} from './authorization.mjs';
import {googleAccountsRefinement} from './google-accounts.mjs';
import {calendarRefinement} from './calendar.mjs';
import {inboxRefinement} from './inbox.mjs';
import {mapsRefinement} from './maps.mjs';
import {cacheRefinement} from './cache.mjs';
import {workflowRefinement} from './workflow.mjs';
import {policyRefinement} from './policies.mjs';
import {readingRefinement} from './reading.mjs';
import {scanRefinement} from './scan.mjs';
import {credentialRefinement} from './credentials.mjs';
import {pdfRefinement} from './pdf.mjs';

export async function runServicesRefinement() {
  const receipts = [];
  for (const check of [authorizationRefinement, googleAccountsRefinement, calendarRefinement,
    inboxRefinement, mapsRefinement, cacheRefinement, workflowRefinement, policyRefinement,
    readingRefinement, scanRefinement, credentialRefinement, pdfRefinement]) {
    const result = await check();
    receipts.push(...(Array.isArray(result) ? result : [result]));
  }
  const obligations = [
    {model: 'IdentitySession', obligation: 'Native sign-in orchestration', reason: 'Observed Pending parsing, state matching and expiry do not cover callback burn, credential/receipt commit, acknowledgement and transient-session cleanup.', requires: ['controlled native sign-in transport', 'encrypted store', 'process recreation']},
    {model: 'ServiceAuthorization', obligation: 'Managed-service dispatch authorization', reason: 'Entitlement refresh and admission views execute; exact route validation and server authorization still need their own dispatch trace adapter.'},
    {model: 'GoogleAccounts', obligation: 'Account-list consumers and native return delivery', reason: 'Connect/disconnect orchestration executes with controlled browser return and retirement ports; Inbox/Calendar cache consumers and installed App Link delivery remain separate.'},
    {model: 'CalendarSync', obligation: 'Linked native Calendar consent and mutation', reason: 'Outbox claim/revision/undo/restart/unknown-outcome paths execute. Linked-store reconciliation and installed Calendar provider mutation remain outside this adapter.'},
    {model: 'InboxDelivery', obligation: 'Full UI grant restoration and source-draft cleanup', reason: 'Actual operation CAS/review/dispatch/restart is traced. Composer attachment editing, account-list withdrawal/regrant and cleanup across all local copies remain further orchestration obligations.'},
    {model: 'MapsNavigation', obligation: 'Native GPS, full renderer and background navigation', reason: 'DeviceNavigation and MapsController execute against controlled surface/provider/location ports. Full adapter and native service lifecycle still require installed traces.'},
    {model: 'WorkflowExecution', obligation: 'Execution admission, effects and development triggers', reason: 'Real canonicalization, receipt verification and durable intent-store paths execute. No worker execution or provider idempotency is established by those source observations.'},
    {model: 'NoticesAndCaches', obligation: 'Native delivery claims, posting, tap consumption and acknowledgements', reason: 'Real cache CAS/expiry/restart and owner retry execute. Delivery-ledger actions need native source traces.'},
    {model: 'BrowserSiteState', obligation: 'Installed WebView and permission orchestration', reason: 'Real passkey readback and permission record helpers execute; cookie profile creation, Android permission callbacks and HTTP-auth UI require installed tests.'},
    {model: 'BrowserReadingState', obligation: 'Isolated world and speech-token consumption', reason: 'Actual capability probes and question-review DOM execute. Extraction-world authenticity, token expiry and native speech consumption need Android provider traces.'},
    {model: 'BrowserDownloads', obligation: 'Native transfer, capture and publication', reason: 'Real cookie-origin and history policy executes. Byte transfer, blob nonce/chunk handling and MediaStore completion require native BrowserDownloads execution.'},
    {model: 'ScanDocument', obligation: 'Full image/PDF conversion and arbitrary draft schedules', reason: 'Actual UI, IndexedDB draft storage and picker/export policy execute for four schedules. PDF conversion, OCR/correction and exhaustive multi-page schedules remain outside the bounded adapter.'},
    {model: 'NativeCredentialMutation', obligation: 'Real shutdown, encryption and lock interleavings', reason: 'Actual credential-store classification, recheck, admission invalidation and preflight run against primitive storage/lifecycle ports. Those ports do not establish native shutdown or encrypted persistence.'},
    {model: 'PdfWorker', obligation: 'Kernel isolation, descriptor transfer, watchdog and memory kill', reason: 'Actual service request/render/cleanup/reply code executes against Android primitives. Host stubs cannot establish kernel or real PDF renderer behavior.', requires: ['IsolatedPdfInstrumentedTest on a disposable admitted installation']},
  ];
  return {receipts, obligations};
}
