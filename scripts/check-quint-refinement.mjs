import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {repositoryRoot, loadModels, sha256} from './quint-lib.mjs';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {modelStateInventory, traceActionCoverage, unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';

const args = process.argv.slice(2);
const runners = {
  application: 'runApplicationRefinement',
  services: 'runServicesRefinement',
  native: 'runNativeRefinement',
  composition: 'runCompositionRefinement',
  legacy: 'runLegacyRefinement',
};
const families = Object.keys(runners);
const requested = args.find(arg => arg.startsWith('--families='))?.slice(11).split(',') || families;
const output = resolve(repositoryRoot, args.find(arg => arg.startsWith('--out='))?.slice(6) || 'test-results/quint-refinement/summary.json');
for (const arg of args) if (!arg.startsWith('--families=') && !arg.startsWith('--out=') && arg !== '--require-complete') throw Error(`Unknown option ${arg}`);
for (const family of requested) if (!families.includes(family)) throw Error(`Unknown family ${family}`);
const ledgerPath = 'specs/quint/coverage.json';
const auditPath = 'specs/quint/state-audit.json';
const familyModule = family => `specs/quint/refinement/${family}/index.mjs`;
const reportingInputs = ['scripts/check-quint-refinement.mjs', 'specs/quint/refinement/model-state.mjs',
  'specs/quint/refinement/check-traces.mjs', 'specs/quint/refinement/campaigns.mjs', 'package-lock.json',
  'scripts/quint-lib.mjs', 'scripts/quint-state-audit.mjs', ledgerPath, auditPath,
  ...['application', 'services', 'native', 'legacy'].map(family => `specs/quint/${family}/manifest.json`),
  ...families.map(familyModule).filter(path => existsSync(join(repositoryRoot, path)))];
const {inputHashes, sourceInventory} = (() => {
  const captured = new Map(reportingInputs.map(path => [path, readFileSync(join(repositoryRoot, path))]));
  const inputHashes = Object.fromEntries([...captured].map(([path, bytes]) => [path, sha256(bytes)]));
  const ledger = JSON.parse(captured.get(ledgerPath));
  const audit = JSON.parse(captured.get(auditPath));
  const sourceInventory = {sourcePin: audit.sourcePin, files: ledger.files.length,
    provisionalFiles: ledger.files.filter(file => file.reviewStatus === 'state-audit-required').length,
    languageReviewFiles: audit.counts.languageReview, unassignedSyntacticWrites: audit.counts.unassignedWrites,
    auditMatchesLedger: audit.ledgerSha256 === inputHashes[ledgerPath] && audit.counts.files === ledger.files.length};
  return {inputHashes, sourceInventory};
})();
const models = loadModels();
const report = {schemaVersion: 1, startedAt: new Date().toISOString(), evidence: 'implementation trace refinement with explicit projections',
  reportingInputHashes: inputHashes, sourceInventory,
  modelCount: models.length, families: [], models: [], obligations: [], checksPassed: false, completeApplicationRefinement: false};
let failed = !sourceInventory.auditMatchesLedger;
if (failed) report.obligations.push({obligation: 'current source state audit', reason: 'The candidate audit is out of sync with the coverage ledger.'});

mkdirSync(dirname(output), {recursive: true});
function publish(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  renameSync(temporary, path);
}
function checkpoint(status, activeFamily) {
  const currentFamilies = activeFamily ? [...report.families, activeFamily] : report.families;
  publish(`${output}.progress.json`, {schemaVersion: 1, status, startedAt: report.startedAt,
    finishedAt: report.finishedAt, reportingInputHashes: inputHashes, sourceInventory,
    modelCount: models.length, requestedFamilies: requested, checksPassed: report.checksPassed,
    families: currentFamilies.map(({family, status, receipts, failures, error}) => ({family, status,
      receiptPaths: receipts?.map(receipt => receipt.receiptPath).filter(Boolean) ?? [],
      failureCount: (failures?.length ?? 0) + Number(Boolean(error))}))});
}
checkpoint('running');
function diagnostic(error) {
  const lines = [];
  let cause = error;
  for (let depth = 0; depth < 4; depth++) {
    lines.push(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
    if (!(cause instanceof Error) || cause.cause === undefined) break;
    cause = cause.cause;
  }
  return lines.join('\nCaused by: ').replace(/data:text\/javascript;base64,[\w+/=]+(?:#tsx-namespace=[\w-]+)?/g, '[bundled source]');
}
for (const family of requested) {
  const modulePath = join(repositoryRoot, familyModule(family));
  if (!existsSync(modulePath)) {
    failed = true;
    report.families.push({family, status: 'pending'});
    report.obligations.push({family, obligation: 'source-adapter coverage', reason: 'Family adapters are still being implemented.'});
    checkpoint('running');
    continue;
  }
  const onProgress = ({receipts = [], failures = []} = {}) =>
    checkpoint('running', {family, status: 'running', receipts, failures});
  onProgress();
  try {
    // Services and historical core adapters import parameter-property TypeScript.
    // Serialized browser fixtures supply any helpers from that transform locally.
    const module = family === 'services' || family === 'legacy'
      ? await tsImport(pathToFileURL(modulePath).href, import.meta.url)
      : await import(pathToFileURL(modulePath).href);
    const run = module[runners[family]];
    if (typeof run !== 'function') throw Error(`Missing runner for ${family}`);
    const result = await (family === 'composition' ? run() : run(onProgress));
    if (!Array.isArray(result.receipts) || !Array.isArray(result.obligations)) throw Error(`Invalid adapter report for ${family}`);
    const failures = result.failures?.map(({campaign, error}) => ({campaign, error: diagnostic(error)})) ?? [];
    if (failures.length) failed = true;
    report.families.push({family, status: failures.length ? 'failed' : 'checked', receipts: result.receipts,
      ...(failures.length ? {failures} : {})});
    report.obligations.push(...result.obligations);
  } catch (error) {
    failed = true;
    report.families.push({family, status: 'failed', error: diagnostic(error)});
  }
  checkpoint('running');
}
for (const model of models) {
  const receipts = report.families.flatMap(family => family.receipts || []).filter(receipt =>
    receipt.coverageModel === model.module || receipt.model === model.module ||
    basename(receipt.receiptPath || '', '.json') === model.module);
  const currentHash = sha256(readFileSync(join(repositoryRoot, model.path)));
  const current = receipts.filter(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound &&
    receipt.sourceHashesAfter?.[join(repositoryRoot, model.path)] === currentHash &&
    verifyRefinementReceiptInputs(receipt));
  const inventory = modelStateInventory(join(repositoryRoot, model.path), model.module);
  const entry = {model: model.module, family: model.family, modelSha256: currentHash,
    status: current.length ? 'trace-checked' : 'unverified',
    traceCount: current.reduce((sum, receipt) => sum + receipt.traces, 0),
    checkpoints: current.reduce((sum, receipt) => sum + receipt.checkpoints, 0),
    declaredStateVariables: inventory.variables,
    declaredStateFields: inventory.fields,
    observedFields: [...new Set(current.flatMap(receipt => receipt.observedFields))].sort(),
    ...traceActionCoverage(current),
    scopes: [...new Set(current.map(receipt => receipt.scope))],
    receipts: current.map(receipt => receipt.receiptPath)};
  entry.unobservedStateFields = unobservedStateFields(inventory, entry.observedFields);
  const modelOperations = inventory.actions.filter(action =>
    !['init', 'step', 'check'].includes(action) && !entry.modelInitializers.includes(action));
  entry.unexercisedModelActions = modelOperations.filter(action => !entry.modelActions.includes(action));
  entry.unexercisedModelTransitions = modelOperations.filter(action => !entry.modelTransitionActions.includes(action));
  report.models.push(entry);
  if (!current.length && (model.family !== 'legacy' || requested.includes('legacy')))
    report.obligations.push({model: model.module, obligation: 'implementation transition relation', reason: 'No passing source-bound adapter receipt for this model revision in the selected campaigns.'});
}
report.traceCheckedModels = report.models.filter(model => model.status === 'trace-checked').length;
report.campaignCoverageComplete = report.traceCheckedModels === report.modelCount;
const runtimeFamilies = families.filter(family => family !== 'legacy');
report.runtimeCampaignCoverageComplete = report.models.every(model => model.family === 'legacy' || model.status === 'trace-checked');
if (runtimeFamilies.every(family => requested.includes(family)) && !report.runtimeCampaignCoverageComplete) failed = true;
report.reportingInputsUnchanged = reportingInputs.every(path => {
  try {return inputHashes[path] === sha256(readFileSync(join(repositoryRoot, path)));}
  catch {return false;}
});
if (!report.reportingInputsUnchanged) failed = true;
report.unobservedStateFieldCount = report.models.reduce((count, model) => count + model.unobservedStateFields.length, 0);
report.unexercisedModelTransitionCount = report.models.reduce((count, model) => count + model.unexercisedModelTransitions.length, 0);
report.checksPassed = !failed;
report.finishedAt = new Date().toISOString();
report.obligations.push({obligation: 'unbounded implementation refinement', reason: 'Concrete trace campaigns establish their recorded finite/bounded projections. A universal simulation-relation proof requires separately discharged source semantics and environment assumptions.'});
publish(output, report);
checkpoint('finished');
console.log(`${report.traceCheckedModels}/${report.modelCount} registered models have current source-bound trace evidence from these campaigns.`);
console.log(`${report.obligations.length} explicit refinement obligations remain. Report ${output}`);
process.exitCode = failed ? 1 : args.includes('--require-complete') ? 2 : 0;
