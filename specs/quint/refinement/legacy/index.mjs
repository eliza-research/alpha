import {fileURLToPath} from 'node:url';
import {checkActionSettlementRefinement} from '../../legacy/core/check-action-settlement-refinement.mjs';
import {checkApprovalServiceRefinement} from '../../legacy/core/check-approval-service-refinement.mjs';
import {checkEmbeddingSqlRefinement} from '../../legacy/core/check-embedding-sql-refinement.mjs';
import {checkInteractionSessionRefinement} from '../../legacy/core/check-interaction-session-refinement.mjs';
import {runProviderExecutionRefinement} from '../../legacy/core/check-provider-execution-refinement.mjs';
import {checkRoomHandlerQueueRefinement} from '../../legacy/core/check-room-handler-queue-refinement.mjs';
import {runSingleFlightRefinement} from '../../legacy/core/check-single-flight-refinement.mjs';
import {checkTaskSchedulingRefinement} from '../../legacy/core/check-task-scheduling-refinement.mjs';
import {runTaskSchedulerRefinement} from '../services/task-scheduler/index.mjs';

const driver = fileURLToPath(import.meta.url);

export async function runLegacyRefinement() {
  const receipts = [], obligations = [];
  const campaigns = [
    ['CoreActionSettlement', checkActionSettlementRefinement],
    ['CoreApprovalService', () => checkApprovalServiceRefinement(undefined, [driver])],
    ['CoreEmbeddingDimension', () => checkEmbeddingSqlRefinement([driver])],
    ['CoreInteractionSession', () => checkInteractionSessionRefinement(undefined, [driver])],
    ['CoreProviderExecution', runProviderExecutionRefinement],
    ['CoreRoomHandlerQueue', () => checkRoomHandlerQueueRefinement(undefined, [driver])],
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
