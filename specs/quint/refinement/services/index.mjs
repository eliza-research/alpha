import {collectRefinementCampaigns} from '../campaigns.mjs';
import {fileURLToPath} from 'node:url';
import {checkBrowserGoogleReturn} from './browser-google-return.mjs';
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
import {runSignInCoordinatorRefinement} from './sign-in-coordinator.mjs';
import {runInboxCoordinatorRefinement} from './inbox-coordinator.mjs';
import {runInboxCleanupRefinement} from './inbox-cleanup.mjs';
import {calendarLinkedRefinement} from './calendar-linked.mjs';
import {runInboxProviderDraftsRefinement} from './inbox-provider-drafts.mjs';
import {runWorkflowEngineRefinement} from './workflow-engine/index.mjs';
import {runWorkflowWakeupRefinement} from './workflow-scheduler/index.mjs';
import {runWorkflowTaskRefinement} from './workflow-scheduler/registration.mjs';
import {googleAccountsLifecycleRefinement} from './google-accounts-lifecycle.mjs';
import {runCoreRetirementRefinement} from './core-runtime/retirement.mjs';
import {runCoreServiceLifecycleRefinement} from './core-runtime/lifecycle.mjs';
import {runCoreRuntimeShutdownRefinement} from './core-runtime/shutdown.mjs';
import {runTurnControllerRefinement} from './core-runtime/turns.mjs';
import {runCanonicalNotesRefinement} from './notes-store/index.mjs';
import {runTaskServiceRefinement} from './task-service/index.mjs';
import {runTaskSchedulerRuntimeRefinement} from './task-scheduler/runtime.mjs';
import {runPilotApkUpdateRefinement} from './pilot-update.mjs';
import {runEmbeddingStoreIdentityRefinement} from './embedding-store-identity.mjs';
import {runFactWriteScopeRefinement} from './fact-write-scope.mjs';
import {runNativeGoogleAccessFileRefinement} from './native-google-access-file.mjs';
import {runNamedEmbeddingProvenanceRefinement} from './named-embedding-provenance.mjs';
import {checkCombinedAgentLauncher} from './combined-agent-launcher.mjs';
import {checkReviewedWorkflowLauncher} from './reviewed-workflow-launcher.mjs';
import {checkCoreConnectorCustody} from './core-runtime/connector-custody.mjs';
import {checkMobileBundleAdmission} from './mobile-bundle-admission.mjs';
import {checkWorkflowWorkerStaging} from './workflow-worker-staging.mjs';
import {checkNativeGoogleHostArtifact} from './native-google-host-artifact.mjs';
import {checkPreparedSourceStamp} from './prepared-source-stamp.mjs';
import {checkClientFeaturePublication} from './client-feature-publication.mjs';
import {checkCloudQaLauncher} from './cloud-qa-launcher.mjs';
import {checkBrowserCloudRequestCustody} from './browser-cloud-request-custody.mjs';
import {checkGmailAgentMailboxRecovery} from './gmail-agent-mailbox-recovery.mjs';
import {checkDevelopmentDigestPending} from './development-digest-pending.mjs';
import {checkAndroidGzipAssetStage} from './android-gzip-asset-stage.mjs';
import {checkResidentJavaSourceStage} from './resident-java-source-stage.mjs';
import {checkAndroidBrowserModuleStage} from './android-browser-module-stage.mjs';
import {checkAndroidBuildInputReadiness} from './android-build-input-readiness.mjs';
import {checkLifeOpsScheduledTaskRoute} from './lifeops-scheduled-task-route.mjs';
import {checkPersonalAssistantScheduledTaskCustody} from './personal-assistant-scheduled-task-custody.mjs';

export async function runServicesRefinement(onProgress) {
  const driver = fileURLToPath(import.meta.url);
  const direct = check => [check.name, () => check()];
  const withDriver = check => [check.name, () => check([driver])];
  const campaigns = [
    ...[authorizationRefinement, googleAccountsRefinement, googleAccountsLifecycleRefinement, calendarRefinement,
      calendarLinkedRefinement, inboxRefinement, mapsRefinement, cacheRefinement, workflowRefinement, policyRefinement,
      readingRefinement, scanRefinement, credentialRefinement, pdfRefinement, runSignInCoordinatorRefinement,
      runCoreRetirementRefinement, runCoreServiceLifecycleRefinement, runCoreRuntimeShutdownRefinement,
      runTurnControllerRefinement].map(direct),
    ...[checkBrowserGoogleReturn, checkCombinedAgentLauncher, checkReviewedWorkflowLauncher,
      checkCoreConnectorCustody, checkMobileBundleAdmission, checkWorkflowWorkerStaging, checkNativeGoogleHostArtifact,
      checkPreparedSourceStamp, checkClientFeaturePublication, checkCloudQaLauncher, checkBrowserCloudRequestCustody, checkGmailAgentMailboxRecovery,
      checkDevelopmentDigestPending, checkAndroidGzipAssetStage, checkResidentJavaSourceStage,
      checkAndroidBrowserModuleStage, checkAndroidBuildInputReadiness, checkLifeOpsScheduledTaskRoute,
      checkPersonalAssistantScheduledTaskCustody].map(withDriver),
    ...[runInboxCoordinatorRefinement, runInboxCleanupRefinement, runInboxProviderDraftsRefinement,
      runWorkflowEngineRefinement, runWorkflowWakeupRefinement, runWorkflowTaskRefinement, runCanonicalNotesRefinement,
      runTaskServiceRefinement, runTaskSchedulerRuntimeRefinement, runPilotApkUpdateRefinement,
      runEmbeddingStoreIdentityRefinement].map(direct),
    ...[runFactWriteScopeRefinement, runNativeGoogleAccessFileRefinement, runNamedEmbeddingProvenanceRefinement].map(withDriver),
  ];
  const obligations = [
    {model: 'BrowserGoogleReturn', obligation: 'Canonical account readback and browser presentation', reason: 'The real callback only emits a candidate wakeup. Account verification, panel dismissal, tab closing and live Google authorization require their own UI and integration evidence.'},
    {model: 'CombinedAgentLauncher', obligation: 'Confirm runtime readiness at the service boundary',
      reason: 'The receipt establishes spawn and process custody. The source campaign uses a closed child process, and live HTTP readiness is a separate observation.'},
    {model: 'ReviewedWorkflowLauncher', obligation: 'Confirm live workflow readiness and capability admission',
      reason: 'Source schedules observe reviewed bytes, child custody and preload rejection under closed ports. The metadata receipt alone does not observe HTTP readiness or permission to execute work.'},
    {model: 'CoreConnectorCustody', obligation: 'Arbitrary detached callbacks and direct host mutation',
      reason: 'The bounded source campaign holds selected service, disposal and detached continuations. Untracked host registry mutation and arbitrary scheduling remain separate.'},
    {model: 'MobileBundleAdmission', obligation: 'Staging and installation after mobile receipt admission',
      reason: 'The producer functions and readback execute against reviewed inputs and synthetic bundle generations. The full mobile compiler, staged copy under interruption and installed execution are separate.'},
    {model: 'WorkflowWorkerStaging', obligation: 'Interruption and recovery after partial worker publication',
      reason: 'The helper can leave a verified backup after a refused restore or failed cleanup. The scratch campaign observes the settled disk states. Process interruption, concurrent publishers and subsequent recovery remain separate.'},
    {model: 'PreparedSourceStamp', obligation: 'Concurrent qualification and interrupted stamp publication',
      reason: 'The source-only schedules observe settled outcomes and one candidate refusal on local disposable Git trees. Racing writers, restart after process loss and the full dependency install retain separate evidence.'},
    {model: 'ClientFeaturePublication', obligation: 'Other targets, interruption, cleanup failures and independent cache readers',
      reason: 'Three actual publishers cover one vanished-winner collision. Model scenarios cover selected refusal/failure branches; abrupt process loss, arbitrary generations, orphan recovery and a stable path lease for independent readers remain separate.'},
    {model: 'CloudQaLauncher', obligation: 'Concurrent launcher, kernel signal and live readiness behavior',
      reason: 'Private files and receipts use the real implementation in scratch, with closed child events. Concurrent profile writers, kernel delivery and a running Cloud session retain separate evidence.'},
    {model: 'BrowserCloudRequestCustody', obligation: 'Authenticated requests, real HTTP and process restart',
      reason: 'Closed request and response ports drive the real handler on the public entitlement route. Authenticated routes, Node socket delivery and process restart remain separate.'},
    {model: 'GmailAgentMailboxRecovery', obligation: 'Provider receipt durability and concurrent calls',
      reason: 'The caller and protocol read exact synthetic receipts and run one recovery lookup after dispatch failure. Provider durability, concurrent invocations and installed account behavior remain separate.'},
    {model: 'DevelopmentDigestPending', obligation: 'Physical storage and overlapping renderer calls',
      reason: 'The renderer and host compare exact bytes through an in-memory filesystem port. Physical durability, multiple writes inside one renderer and actual provider dispatch remain separate.'},
    {model: 'AndroidGzipAssetStage', obligation: 'Concurrent sync, partial wrapper writes and installed OCR',
      reason: 'The scratch replay exercises the actual wrapper and byte comparison. The modeled merge uses a one-layer fixture. Independent APK checks and installed OCR have separate evidence.'},
    {model: 'ResidentJavaSourceStage', obligation: 'Concurrent readers, process interruption and Gradle consumption',
      reason: 'Serial source replay observes exact settled trees and manifests, including a retained backup when restore is refused. Reader timing, cleanup failures and actual Gradle builds remain separate.'},
    {model: 'AndroidBuildInputReadiness', obligation: 'Full runtime and APK admission',
      reason: 'The native prerequisite gates and report execute on bounded private inputs with controlled verification ports. A successful report does not exercise Gradle, APK verification, signing or installed behavior.'},
    {model: 'AndroidBrowserModuleStage', obligation: 'Concurrent module publication, Gradle configuration and APK consumption',
      reason: 'The selected browser module executes actual source staging, Gradle host generation and receipt verification in scratch. Concurrent processes, the full module graph, Gradle and installed input handling remain separate.'},
    {model: 'NativeGoogleHostArtifact', obligation: 'Cross-process publication, interruption and installed use',
      reason: 'The source replay verifies a private candidate and restore under the serial producer contract. Independent readers, process death between the two publication renames and installed host execution remain separate.'},
    {model: 'CoreTurnControllers', obligation: 'Detached callbacks, reentrant observers and provider composition', reason: 'The source campaign checks lookup, cancellation and closure in two registries. Arbitrary reentrant observers and detached callbacks require separate source schedules.'},
    {model: 'IdentitySession', obligation: 'Installed sign-in integration and physical storage', reason: 'The patched shared sign-in coordinator executes callback claim, credential/receipt commit, acknowledgement, cancellation and replacement under controlled ports. App Link trust, real HTTPS, Keystore durability and process recreation remain external.'},
    {model: 'ServiceAuthorization', obligation: 'Managed-service dispatch authorization', reason: 'Entitlement refresh and admission views execute; exact route validation and server authorization still need their own dispatch trace adapter.'},
    {model: 'GoogleAccounts', obligation: 'Account-list consumers and native return delivery', reason: 'Connect/disconnect orchestration executes with controlled browser return and retirement ports; Inbox/Calendar cache consumers and installed App Link delivery remain separate.'},
    {model: 'CalendarSync', obligation: 'Linked native Calendar consent and mutation', reason: 'Outbox claim/revision/undo/restart/unknown-outcome paths execute. Linked-store reconciliation and installed Calendar provider mutation remain outside this adapter.'},
    {model: 'InboxDelivery', obligation: 'Full UI grant restoration and source-draft cleanup', reason: 'Actual operation CAS/review/dispatch/restart is traced. Composer attachment editing, account-list withdrawal/regrant and cleanup across all local copies remain further orchestration obligations.'},
    {model: 'MapsNavigation', obligation: 'Native GPS, full renderer and background navigation', reason: 'DeviceNavigation and MapsController execute against controlled surface/provider/location ports. Full adapter and native service lifecycle still require installed traces.'},
    {model: 'WorkflowExecution', obligation: 'Execution admission, effects and development triggers', reason: 'Real canonicalization, receipt verification and durable intent-store paths execute. No worker execution or provider idempotency is established by those source observations.'},
    {model: 'NoticesAndCaches', obligation: 'Native delivery claims, posting, tap consumption and acknowledgements', reason: 'Real cache CAS/expiry/restart and owner retry execute. Delivery-ledger actions need native source traces.'},
    {model: 'BrowserSiteState', obligation: 'Installed WebView and permission orchestration', reason: 'Real permission records and browser download/history helpers execute. Passkey defaults, cookie profiles, Android permission callbacks and HTTP-auth UI require installed tests.'},
    {model: 'BrowserReadingState', obligation: 'Isolated world and speech-token consumption', reason: 'Actual capability probes and question-review DOM execute. Extraction-world authenticity, token expiry and native speech consumption need Android provider traces.'},
    {model: 'BrowserDownloads', obligation: 'Native transfer, capture and publication', reason: 'Real cookie-origin and history policy executes. Byte transfer, blob nonce/chunk handling and MediaStore completion require native BrowserDownloads execution.'},
    {model: 'ScanDocument', obligation: 'Full image/PDF conversion and arbitrary draft schedules', reason: 'Actual UI, IndexedDB draft storage and picker/export policy execute for four schedules. PDF conversion, OCR/correction and exhaustive multi-page schedules remain outside the bounded adapter.'},
    {model: 'NativeCredentialMutation', obligation: 'Real shutdown, encryption and lock interleavings', reason: 'Actual credential-store classification, recheck, admission invalidation and preflight run against primitive storage/lifecycle ports. Those ports do not establish native shutdown or encrypted persistence.'},
    {model: 'PdfWorker', obligation: 'Kernel isolation, descriptor transfer, watchdog and memory kill', reason: 'Actual service request/render/cleanup/reply code executes against Android primitives. Host stubs cannot establish kernel or real PDF renderer behavior.', requires: ['IsolatedPdfInstrumentedTest on a disposable admitted installation']},
  ];
  return collectRefinementCampaigns(campaigns, obligations, onProgress);
}
