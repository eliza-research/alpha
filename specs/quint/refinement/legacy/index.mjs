import {fileURLToPath} from 'node:url';
import {checkActionSettlementRefinement} from '../../legacy/core/check-action-settlement-refinement.mjs';
import {checkApprovalServiceRefinement} from '../../legacy/core/check-approval-service-refinement.mjs';
import {checkEmbeddingSqlRefinement} from '../../legacy/core/check-embedding-sql-refinement.mjs';
import {checkFactWriteDedupeRefinement} from '../../legacy/core/check-fact-write-dedupe-refinement.mjs';
import {checkInteractionSessionRefinement} from '../../legacy/core/check-interaction-session-refinement.mjs';
import {checkPluginLifecycleRefinement} from '../../legacy/core/check-plugin-lifecycle-refinement.mjs';
import {runProviderExecutionRefinement} from '../../legacy/core/check-provider-execution-refinement.mjs';
import {checkRoomHandlerQueueRefinement} from '../../legacy/core/check-room-handler-queue-refinement.mjs';
import {checkRuntimeLifecycleRefinement} from '../../legacy/core/check-runtime-lifecycle-refinement.mjs';
import {checkServiceLifecycleDesignRefinement} from '../../legacy/core/check-service-lifecycle-refinement.mjs';
import {runSingleFlightRefinement} from '../../legacy/core/check-single-flight-refinement.mjs';
import {checkTaskSchedulingRefinement} from '../../legacy/core/check-task-scheduling-refinement.mjs';
import {runTaskSchedulerRefinement} from '../services/task-scheduler/index.mjs';

const driver = fileURLToPath(import.meta.url);
const pluginDifferences = {
  PluginLateStartConnector: ['Late service start can register a connector after unload',
    'The runtime stops the late instance but leaves its connector registered after ownership has been removed. The original design forbids that orphan.'],
  PluginRegistrationRollbackVisibility: ['Registration rollback removes public visibility before settlement',
    'During held disposal the runtime hides the plugin while both registrations are pending. The original action combines removal and settlement.'],
  PluginRuntimeStopLookup: ['Runtime shutdown clears the public service lookup',
    'The source clears both service indexes. The original final shutdown step leaves the public lookup unchanged.'],
};

export async function runLegacyRefinement() {
  const receipts = [], obligations = [];
  const campaigns = [
    ['CoreActionSettlement', checkActionSettlementRefinement],
    ['CoreApprovalService', () => checkApprovalServiceRefinement(undefined, [driver])],
    ['CoreEmbeddingDimension', () => checkEmbeddingSqlRefinement([driver])],
    ['CoreFactWriteDedupe', () => checkFactWriteDedupeRefinement([driver])],
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
  ];
  for (const [coverageModel, run] of campaigns) {
    const result = await run();
    const profiles = result.receipts ?? (Array.isArray(result) ? result : [result]);
    for (const receipt of profiles) receipts.push(coverageModel ? {...receipt, coverageModel} : receipt);
    obligations.push(...(result.obligations ?? []));
  }
  return {receipts, obligations};
}
