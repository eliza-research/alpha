import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('current service models check real-source component and coordinator traces', {timeout: 900000}, () => {
  const result = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '-e', `
    import {runServicesRefinement} from './specs/quint/refinement/services/index.mjs';
    const result = await runServicesRefinement();
    const models = new Set(result.receipts.map(receipt => receipt.coverageModel || receipt.model));
    const expected = new Set(['ServiceAuthorization', 'GoogleAccounts', 'CalendarLinkedSync', 'InboxDelivery', 'InboxCoordinator', 'InboxProviderDrafts', 'MapsNavigation', 'WorkflowExecution', 'NoticesAndCaches', 'BrowserSiteState', 'BrowserReadingState', 'BrowserDownloads', 'ScanDocument', 'PdfWorker', 'IdentitySession', 'NativeCredentialMutation', 'WorkflowEngineAdmission', 'WorkflowWakeups', 'WorkflowScheduleTasks', 'CoreRuntimeRetirement']);
    if (models.size !== expected.size || [...expected].some(model => !models.has(model)) || result.receipts.some(receipt => !receipt.passed || !receipt.inputsUnchanged || !receipt.driverInputsBound)) throw Error('Incomplete service model checks');
    console.log(JSON.stringify({models: models.size, traces: result.receipts.reduce((sum, receipt) => sum + receipt.traces, 0), obligations: result.obligations.length}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 870000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"models":20/);
  assert.match(result.stdout, /"obligations":\d+/);
});
