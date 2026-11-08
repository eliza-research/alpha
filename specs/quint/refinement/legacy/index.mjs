import {fileURLToPath} from 'node:url';
import {checkChatInputRefinement} from '../../legacy/chat-input/check-chat-input-refinement.mjs';
import {checkSettingsNavRefinement} from '../../legacy/settings-nav/check-settings-nav-refinement.mjs';
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

export async function runLegacyRefinement() {
  const receipts = [], obligations = [];
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
  for (const [coverageModel, run] of campaigns) {
    const result = await run();
    const profiles = result.receipts ?? (Array.isArray(result) ? result : [result]);
    for (const receipt of profiles) receipts.push(coverageModel ? {...receipt, coverageModel} : receipt);
    obligations.push(...(result.obligations ?? []));
  }
  return {receipts, obligations};
}
