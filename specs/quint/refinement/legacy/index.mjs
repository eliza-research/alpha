import {fileURLToPath} from 'node:url';
import {checkChatInputRefinement} from '../../legacy/chat-input/check-chat-input-refinement.mjs';
import {checkFilesBrowserRefinement} from '../../legacy/files-browser/check-files-browser-refinement.mjs';
import {checkGoogleConnectRefinement} from '../../legacy/google-connect/check-google-connect-refinement.mjs';
import {checkHomeLayoutRefinement} from '../../legacy/home-layout/check-home-layout-refinement.mjs';
import {checkMapsRefinement} from '../../legacy/maps/check-maps-refinement.mjs';
import {checkNotesViewRefinement} from '../../legacy/notes-view/check-notes-view-refinement.mjs';
import {checkPhotosLibraryRefinement} from '../../legacy/photos-library/check-photos-library-refinement.mjs';
import {checkSettingsNavRefinement} from '../../legacy/settings-nav/check-settings-nav-refinement.mjs';
import {checkSignInRefinement} from '../../legacy/sign-in/check-sign-in-refinement.mjs';
import {checkActionSettlementRefinement} from '../../legacy/core/check-action-settlement-refinement.mjs';
import {checkApprovalServiceRefinement} from '../../legacy/core/check-approval-service-refinement.mjs';
import {checkEmbeddingSqlRefinement} from '../../legacy/core/check-embedding-sql-refinement.mjs';
import {checkFactWriteDedupeRefinement} from '../../legacy/core/check-fact-write-dedupe-refinement.mjs';
import {checkInteractiveTaskTraces} from '../../legacy/core/check-interactive-task-traces.mjs';
import {checkInteractionSessionRefinement} from '../../legacy/core/check-interaction-session-refinement.mjs';
import {checkPluginLifecycleRefinement} from '../../legacy/core/check-plugin-lifecycle-refinement.mjs';
import {runProviderExecutionRefinement} from '../../legacy/core/check-provider-execution-refinement.mjs';
import {checkRoomHandlerQueueRefinement} from '../../legacy/core/check-room-handler-queue-refinement.mjs';
import {checkRuntimeLifecycleRefinement} from '../../legacy/core/check-runtime-lifecycle-refinement.mjs';
import {checkServiceLifecycleDesignRefinement} from '../../legacy/core/check-service-lifecycle-refinement.mjs';
import {runSingleFlightRefinement} from '../../legacy/core/check-single-flight-refinement.mjs';
import {checkTaskSchedulingRefinement} from '../../legacy/core/check-task-scheduling-refinement.mjs';
import {checkTaskServiceRefinement} from '../../legacy/core/check-task-service-refinement.mjs';
import {runTaskSchedulerRefinement} from '../services/task-scheduler/index.mjs';
import {checkHistoricalCalendarNavigation} from './calendar-navigation.mjs';
import {checkHistoricalCameraSession} from './camera-session.mjs';

const driver = fileURLToPath(import.meta.url);
const chatInputDifferences = {
  ChatInputCurrentOutsideTap: ['A mounted outside tap retires composer focus first',
    'The original current design can open the underlying app on that first touch. The source preserves the current view and draft.'],
  ChatInputCurrentBackOrder: ['Back after the IME dismisses lowers the raised composer',
    'The original current design can leave the app at this step. The source leaves the app on a later Back.'],
  ChatInputCurrentContentDrag: ['An upward Home content drag preserves the resting composer',
    'The original current design can open the composer sheet from content. The mounted source accepts the dock gesture separately.'],
  ChatInputCurrentDockGuard: ['The raised app composer owns the pointer scrim',
    'The original current design guards the sheet. The mounted source also guards the raised dock input.'],
};
const pluginDifferences = {
  PluginLateStartConnector: ['Late service start can register a connector after unload',
    'The runtime stops the late instance but leaves its connector registered after ownership has been removed. The original design forbids that orphan.'],
  PluginRegistrationRollbackVisibility: ['Registration rollback removes public visibility before settlement',
    'During held disposal the runtime hides the plugin while both registrations are pending. The original action combines removal and settlement.'],
  PluginRuntimeStopLookup: ['Runtime shutdown clears the public service lookup',
    'The source clears both service indexes. The original final shutdown step leaves the public lookup unchanged.'],
};
const settingsNavDifferences = {
  SettingsNavCurrentDirectSignOut: ['Browser sign-out requires explicit confirmation',
    'The mounted source opens a confirmation dialog and preserves the synthetic owner when it is dismissed. The original current profile signs out directly.'],
  SettingsNavCurrentRootWifi: ['Settings groups connectivity controls',
    'The original current profile exposes the Wi-Fi row at the root. The mounted root uses categories.'],
  SettingsNavCurrentLicenseDetails: ['The current-profile license list can open a selected detail',
    'The mounted source can navigate to a packaged notice from the filtered list. The historical current profile ends at the list.'],
  SettingsNavProposedLicenseDetails: ['The proposed-profile license list can open a selected detail',
    'The mounted source can navigate to a packaged notice from the filtered list. The historical proposed profile ends at the list.'],
  SettingsNavProposedInfoRows: ['The mounted Settings information includes an AI connection entry',
    'The original proposed profile restricts the information rows to its historical set.'],
};
const homeLayoutDifferences = {
  HomeLayoutCurrentEmptyBrief: ['The current Home brief keeps an empty shell',
    'The original current profile only displays the brief when it has content.'],
  HomeLayoutProposedEmptyShells: ['Home keeps empty Calendar, Workflows, Inbox and Brief shells',
    'The original proposed profile displays those cards only when their content is available.'],
  HomeLayoutProposedDateLine: ['The mounted Home omits the historical date line',
    'The proposed design requires the date line in its Home header.'],
  HomeLayoutProposedSetupLink: ['The mounted Home omits the historical setup row',
    'The proposed design exposes its setup row when Home role needs attention. The source checks the Settings offer separately.'],
};
const filesBrowserDifferences = {
  FilesBrowserHistoricalDownloads: ['Downloads remains a physical folder view',
    'The mounted view excludes the unrelated Camera image. The historical category ablation includes every present file.'],
  FilesBrowserHistoricalOverwrite: ['A collision preserves both canonical files',
    'The mounted move creates a distinct conflict name. The historical conflict ablation overwrites the destination.'],
  FilesBrowserHistoricalStaleReview: ['A rewritten file invalidates the previously reviewed identity',
    'The mounted runner refuses the old identity and accepts a fresh one. The historical identity ablation admits the stale request.'],
};
const notesViewDifferences = {
  NotesViewCanonicalCollectionRevision: ['Canonical Notes advances the selected object revision when a peer changes',
    'The current owner-bound controller publishes the collection revision. The historical revision belongs to the individual note.'],
  NotesViewHistoricalRestoreFolder: ['Restore after folder deletion returns a previous note to the root',
    'The browser store clears the obsolete folder binding. The historical recovery returns the previous folder binding.'],
  NotesViewHistoricalRecordingCap: ['The mounted browser recorder keeps recording at the historical cap',
    'The historical transition stops at four abstract units. The source rolls to the next segment.'],
  NotesViewHistoricalLiveDurability: ['Mounted browser audio is published durably on Stop',
    'The historical recording step updates durable audio during capture. The observed Previous Notes record publishes audio at Stop.'],
};
const photosLibraryDifferences = {
  PhotosLibraryHistoricalOldestWindow: ['Mounted Photos uses the newest catalog prefix',
    'The historical window ablation chooses the oldest rows.'],
  PhotosLibraryMountedWindowWidth: ['Mounted Photos retains three rows in the fixture',
    'The historical window is bounded to two rows. The positive comparison uses the newest-two prefix.'],
  PhotosLibraryHistoricalSelectionCap: ['Mounted Photos permits the second selected identity',
    'The historical selection ablation admits only one.'],
  PhotosLibraryHistoricalFavoriteToggle: ['A second mounted favorite action clears the selected favorites',
    'The historical favorite ablation always sets them.'],
  PhotosLibraryHistoricalSelectionClear: ['An unrelated peer deletion keeps the still-present selection',
    'The historical patch ablation clears the selection on the same change.'],
  PhotosLibraryCurrentEditCopy: ['Save copy keeps the original and creates a new identity',
    'The historical edit operation updates the existing identity.'],
};
const mapsDifferences = {
  MapsHistoricalPassiveOfflineNotice: ['Passive capability failure leaves the base Maps prompt visible',
    'The source records the failure separately. The historical failure action changes the visible error.'],
  MapsHistoricalOfflinePrompt: ['An explicit search waiting on a failed read displays a typed offline error',
    'The historical current profile displays its generic provider prompt.'],
  MapsHistoricalDirectionsBeforeOrigin: ['Directions asks for an explicit origin before the route request',
    'The historical action already admits the route.'],
  MapsHistoricalChatInterruption: ['Minimizing chat keeps the live guidance route',
    'The historical current profile leaves navigation.'],
  MapsHistoricalArrivalClearsRoute: ['Arrival releases the location watch and retains the accepted route',
    'The historical arrival clears its route.'],
  MapsHistoricalFailedRerouteKeepsRoute: ['A failed reroute clears guidance and the accepted route',
    'The historical proposed fault and off-route sequence retains the route.'],
};

export async function runLegacyRefinement() {
  const campaigns = [
    ['ChatInput', async () => {
      const {receipts, mismatches} = await checkChatInputRefinement([driver]);
      const obligations = mismatches.map(mismatch => {
        const [obligation, reason] = chatInputDifferences[mismatch.id];
        return {model: 'ChatInput', obligation, reason, evidence: mismatch.receiptPath};
      });
      return {receipts, obligations};
    }],
    ['SettingsNav', async () => {
      const {receipts, mismatches} = await checkSettingsNavRefinement([driver]);
      const obligations = mismatches.map(mismatch => {
        const [obligation, reason] = settingsNavDifferences[mismatch.id];
        return {model: 'SettingsNav', obligation, reason, evidence: mismatch.receiptPath};
      });
      return {receipts, obligations};
    }],
    ['HomeLayout', async () => {
      const {receipts, mismatches} = await checkHomeLayoutRefinement([driver]);
      const obligations = mismatches.map(mismatch => {
        const [obligation, reason] = homeLayoutDifferences[mismatch.id];
        return {model: 'HomeLayout', obligation, reason, evidence: mismatch.receiptPath};
      });
      return {receipts, obligations};
    }],
    ['FilesBrowser', async () => {
      const {receipts, mismatches} = await checkFilesBrowserRefinement([driver]);
      const obligations = mismatches.map(mismatch => {
        const [obligation, reason] = filesBrowserDifferences[mismatch.id];
        return {model: 'FilesBrowser', obligation, reason, evidence: mismatch.receiptPath};
      });
      return {receipts, obligations};
    }],
    ['NotesView', async () => {
      const {receipts, mismatches} = await checkNotesViewRefinement([driver]);
      const obligations = mismatches.map(mismatch => {
        const [obligation, reason] = notesViewDifferences[mismatch.id];
        return {model: 'NotesView', obligation, reason, evidence: mismatch.receiptPath};
      });
      return {receipts, obligations};
    }],
    ['PhotosLibrary', async () => {
      const {receipts, mismatches} = await checkPhotosLibraryRefinement([driver]);
      const obligations = mismatches.map(mismatch => {
        const [obligation, reason] = photosLibraryDifferences[mismatch.id];
        return {model: 'PhotosLibrary', obligation, reason, evidence: mismatch.receiptPath};
      });
      return {receipts, obligations};
    }],
    ['Calendar', () => checkHistoricalCalendarNavigation([driver])],
    ['CameraSession', () => checkHistoricalCameraSession([driver])],
    ['Maps', async () => {
      const {receipts, mismatches} = await checkMapsRefinement([driver]);
      const obligations = mismatches.map(mismatch => {
        const [obligation, reason] = mapsDifferences[mismatch.id];
        return {model: 'Maps', obligation, reason, evidence: mismatch.receiptPath};
      });
      return {receipts, obligations};
    }],
    ['SignIn', async () => {
      const {receipts, mismatch} = await checkSignInRefinement([driver]);
      return {receipts, obligations: [{model: 'SignIn',
        obligation: 'Current sign-in opens the chooser directly after local readiness',
        reason: 'The historical current profile requires a separate gate and user probe step. The mounted source reaches the in-app choices after startup.',
        evidence: mismatch.receiptPath}]};
    }],
    ['GoogleConnect', async () => {
      const {receipts, mismatches} = await checkGoogleConnectRefinement([driver]);
      const differences = {
        GoogleConnectProposedDirectConsent: ['The unlinked Inbox opens a Google accounts review',
          'The original proposed profile goes from Inbox directly to consent. The mounted first tap opens the panel without dispatching authorization.'],
        GoogleConnectCurrentReadOnlyRequest: ['The current Google accounts consent offers Gmail send and Calendar write',
          'The historical current request includes only Gmail read and Calendar read.'],
      };
      return {receipts, obligations: mismatches.map(mismatch => {
        const [obligation, reason] = differences[mismatch.id];
        return {model: 'GoogleConnect', obligation, reason, evidence: mismatch.receiptPath};
      })};
    }],
    ['CoreActionSettlement', checkActionSettlementRefinement],
    ['CoreApprovalService', () => checkApprovalServiceRefinement(undefined, [driver])],
    ['CoreEmbeddingDimension', () => checkEmbeddingSqlRefinement([driver])],
    ['CoreFactWriteDedupe', () => checkFactWriteDedupeRefinement([driver])],
    ['CoreInteractiveTask', async () => {
      const {receipts, mismatch} = await checkInteractiveTaskTraces([driver]);
      return {receipts, obligations: [
        {model: 'CoreInteractiveTask', obligation: 'Trusted rebind adds a reducer transition',
          reason: 'Current active-to-active rebind clears the observation and cancels the prepared operation while advancing the epoch. The exact target is absent from the original finite graph.',
          evidence: mismatch.receiptPath},
      ]};
    }],
    ['CoreInteractionSession', () => checkInteractionSessionRefinement(undefined, [driver])],
    ['CorePluginLifecycle', async () => {
      const {receipts, mismatches} = await checkPluginLifecycleRefinement([driver]);
      const obligations = mismatches.map(mismatch => {
        const [obligation, reason] = pluginDifferences[mismatch.name];
        return {model: 'CorePluginLifecycle', obligation, reason, evidence: mismatch.receiptPath};
      });
      return {receipts, obligations};
    }],
    ['CoreProviderExecution', runProviderExecutionRefinement],
    ['CoreRoomHandlerQueue', () => checkRoomHandlerQueueRefinement(undefined, [driver])],
    ['CoreRuntimeLifecycle', () => checkRuntimeLifecycleRefinement([driver])],
    ['CoreServiceLifecycleDesign', async () => {
      const {receipts, mismatch} = await checkServiceLifecycleDesignRefinement([driver]);
      return {receipts, obligations: [
        {model: 'CoreServiceLifecycleDesign', obligation: 'Published instance with a failed send-handler setup',
          reason: 'Actual startup retains the failed-class flag and returns the published service. The original StartEvent clears the flag.',
          evidence: mismatch.receiptPath},
        {model: 'CoreServiceLifecycleDesign', obligation: 'Service lifecycle beyond the original finite profiles',
          reason: 'The selected schedules abstract the remaining eager retry budget, lookup ordering, stop-failure reports and temporal fairness.'},
      ]};
    }],
    ['CoreSingleFlightMemo', runSingleFlightRefinement],
    [null, () => checkTaskSchedulingRefinement(undefined, [driver])],
    ['CoreTaskScheduler', () => runTaskSchedulerRefinement([driver])],
    ['CoreTaskService', async () => {
      const {receipts, mismatch} = await checkTaskServiceRefinement([driver]);
      return {receipts, obligations: [
        {model: 'CoreTaskService', obligation: 'Current task failures can persist auto-pause',
          reason: 'The repeating task auto-pauses at its configured failure threshold. The original Write failure branch leaves pause unchanged.',
          evidence: mismatch.receiptPath},
      ]};
    }],
  ];
  return collectLegacyCampaigns(campaigns);
}

export async function collectLegacyCampaigns(campaigns) {
  const receipts = [], obligations = [], failures = [];
  for (const [coverageModel, run] of campaigns) {
    try {
      const result = await run();
      const profiles = result.receipts ?? (Array.isArray(result) ? result : [result]);
      for (const receipt of profiles) receipts.push(coverageModel ? {...receipt, coverageModel} : receipt);
      obligations.push(...(result.obligations ?? []));
    } catch (error) {
      failures.push({campaign: coverageModel ?? 'Core task scheduling profiles', error});
    }
  }
  return {receipts, obligations, failures};
}
