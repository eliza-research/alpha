import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {repositoryRoot, loadModels, sha256} from './quint-lib.ts';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {modelStateInventory, traceActionCoverage, unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';

interface TraceReceipt {
  coverageModel?: string;
  model: string;
  receiptPath?: string;
  passed: boolean;
  inputsUnchanged: boolean;
  driverInputsBound: boolean;
  sourceHashesAfter?: Record<string, string>;
  traces: number;
  checkpoints: number;
  observedFields: string[];
  scope: string;
}
interface Obligation {
  family?: string;
  model?: string;
  obligation: string;
  reason: string;
}
interface AdapterReport {
  receipts: TraceReceipt[];
  obligations: Obligation[];
  failures?: {campaign: string; error: unknown}[];
}
interface FamilyReport {
  family: string;
  status: 'pending' | 'failed' | 'checked';
  receipts?: TraceReceipt[];
  failures?: {campaign: string; error: string}[];
  error?: string;
}
interface ModelReport {
  model: string;
  family: string;
  modelSha256: string;
  status: 'trace-checked' | 'unverified';
  traceCount: number;
  checkpoints: number;
  declaredStateVariables: string[];
  declaredStateFields: string[];
  observedFields: string[];
  modelInitializers: string[];
  modelActions: string[];
  modelTransitionActions: string[];
  modelRejectedActions: string[];
  scopes: string[];
  receipts: (string | undefined)[];
  unobservedStateFields: string[];
  unexercisedModelActions: string[];
  unexercisedModelTransitions: string[];
}

const args = process.argv.slice(2);
const runners = {
  application: 'runApplicationRefinement',
  services: 'runServicesRefinement',
  native: 'runNativeRefinement',
  composition: 'runCompositionRefinement',
  legacy: 'runLegacyRefinement',
};
type Family = keyof typeof runners;
const families = Object.keys(runners) as Family[];
const isFamily = (family: string): family is Family => Object.hasOwn(runners, family);
const requestedNames = args.find(arg => arg.startsWith('--families='))?.slice(11).split(',') || families;
const output = resolve(repositoryRoot, args.find(arg => arg.startsWith('--out='))?.slice(6) || 'test-results/quint-refinement/summary.json');
for (const arg of args) if (!arg.startsWith('--families=') && !arg.startsWith('--out=') && arg !== '--require-complete') throw Error(`Unknown option ${arg}`);
const requested = requestedNames.map(family => {
  if (!isFamily(family)) throw Error(`Unknown family ${family}`);
  return family;
});
const models = loadModels();
const reportingInputs = ['scripts/check-quint-refinement.ts', 'specs/quint/refinement/model-state.mjs',
  'specs/quint/refinement/legacy/index.mjs', 'specs/quint/refinement/check-traces.mjs', 'package-lock.json'];
const startedAt = new Date().toISOString();
const reportingInputHashes = Object.fromEntries(reportingInputs.map(path => [path, sha256(readFileSync(join(repositoryRoot, path)))]));
const familyReports: FamilyReport[] = [];
const modelReports: ModelReport[] = [];
const obligations: Obligation[] = [];
let failed = false;
function diagnostic(error: unknown) {
  const lines: string[] = [];
  let cause = error;
  for (let depth = 0; depth < 4; depth++) {
    lines.push(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
    if (!(cause instanceof Error) || cause.cause === undefined) break;
    cause = cause.cause;
  }
  return lines.join('\nCaused by: ').replace(/data:text\/javascript;base64,[\w+/=]+(?:#tsx-namespace=[\w-]+)?/g, '[bundled source]');
}
for (const family of requested) {
  const modulePath = join(repositoryRoot, 'specs/quint/refinement', family, 'index.mjs');
  if (!existsSync(modulePath)) {
    failed = true;
    familyReports.push({family, status: 'pending'});
    obligations.push({family, obligation: 'source-adapter coverage', reason: 'Family adapters are still being implemented.'});
    continue;
  }
  try {
    // Services and historical core adapters import parameter-property TypeScript.
    // Serialized browser fixtures supply any helpers from that transform locally.
    const module: Record<string, unknown> = family === 'services' || family === 'legacy'
      ? await tsImport(pathToFileURL(modulePath).href, import.meta.url)
      : await import(pathToFileURL(modulePath).href);
    const run = module[runners[family]];
    if (typeof run !== 'function') throw Error(`Missing runner for ${family}`);
    const result: AdapterReport = await run();
    if (!Array.isArray(result.receipts) || !Array.isArray(result.obligations)) throw Error(`Invalid adapter report for ${family}`);
    const failures = result.failures?.map(({campaign, error}) => ({campaign, error: diagnostic(error)})) ?? [];
    if (failures.length) failed = true;
    familyReports.push({family, status: failures.length ? 'failed' : 'checked', receipts: result.receipts,
      ...(failures.length ? {failures} : {})});
    obligations.push(...result.obligations);
  } catch (error) {
    failed = true;
    familyReports.push({family, status: 'failed', error: diagnostic(error)});
  }
}
for (const model of models) {
  const receipts = familyReports.flatMap(family => family.receipts || []).filter(receipt =>
    receipt.coverageModel === model.module || receipt.model === model.module ||
    basename(receipt.receiptPath || '', '.json') === model.module);
  const currentHash = sha256(readFileSync(join(repositoryRoot, model.path)));
  const current = receipts.filter(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound &&
    receipt.sourceHashesAfter?.[join(repositoryRoot, model.path)] === currentHash &&
    verifyRefinementReceiptInputs(receipt));
  const inventory = modelStateInventory(join(repositoryRoot, model.path), model.module);
  const observedFields = [...new Set(current.flatMap(receipt => receipt.observedFields))].sort();
  const coverage = traceActionCoverage(current);
  const modelOperations = inventory.actions.filter((action: string) =>
    !['init', 'step', 'check'].includes(action) && !coverage.modelInitializers.includes(action));
  modelReports.push({model: model.module, family: model.family, modelSha256: currentHash,
    status: current.length ? 'trace-checked' : 'unverified',
    traceCount: current.reduce((sum, receipt) => sum + receipt.traces, 0),
    checkpoints: current.reduce((sum, receipt) => sum + receipt.checkpoints, 0),
    declaredStateVariables: inventory.variables,
    declaredStateFields: inventory.fields,
    observedFields,
    ...coverage,
    scopes: [...new Set(current.map(receipt => receipt.scope))],
    receipts: current.map(receipt => receipt.receiptPath),
    unobservedStateFields: unobservedStateFields(inventory, observedFields),
    unexercisedModelActions: modelOperations.filter((action: string) => !coverage.modelActions.includes(action)),
    unexercisedModelTransitions: modelOperations.filter((action: string) => !coverage.modelTransitionActions.includes(action)),
  });
  if (!current.length && (model.family !== 'legacy' || requested.includes('legacy')))
    obligations.push({model: model.module, obligation: 'implementation transition relation', reason: 'No passing source-bound adapter receipt for this model revision in the selected campaigns.'});
}
const traceCheckedModels = modelReports.filter(model => model.status === 'trace-checked').length;
const runtimeFamilies = families.filter(family => family !== 'legacy');
const runtimeCampaignCoverageComplete = modelReports.every(model => model.family === 'legacy' || model.status === 'trace-checked');
if (runtimeFamilies.every(family => requested.includes(family)) && !runtimeCampaignCoverageComplete) failed = true;
const reportingInputsUnchanged = reportingInputs.every(path => reportingInputHashes[path] === sha256(readFileSync(join(repositoryRoot, path))));
if (!reportingInputsUnchanged) failed = true;
obligations.push({obligation: 'unbounded implementation refinement', reason: 'Concrete trace campaigns establish their recorded finite/bounded projections. A universal simulation-relation proof requires separately discharged source semantics and environment assumptions.'});
const report = {
  schemaVersion: 1, startedAt, evidence: 'implementation trace refinement with explicit projections', reportingInputHashes,
  modelCount: models.length, families: familyReports, models: modelReports, obligations,
  checksPassed: !failed, completeApplicationRefinement: false, traceCheckedModels,
  campaignCoverageComplete: traceCheckedModels === models.length,
  runtimeCampaignCoverageComplete, reportingInputsUnchanged,
  unobservedStateFieldCount: modelReports.reduce((count, model) => count + model.unobservedStateFields.length, 0),
  unexercisedModelTransitionCount: modelReports.reduce((count, model) => count + model.unexercisedModelTransitions.length, 0),
  finishedAt: new Date().toISOString(),
};
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.traceCheckedModels}/${report.modelCount} registered models have current source-bound trace evidence from these campaigns.`);
console.log(`${obligations.length} explicit refinement obligations remain. Report ${output}`);
process.exitCode = failed ? 1 : args.includes('--require-complete') ? 2 : 0;
