import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {repositoryRoot, loadModels, sha256} from './quint-lib.mjs';

const args = process.argv.slice(2);
const families = ['application', 'services', 'native', 'composition'];
const requested = args.find(arg => arg.startsWith('--families='))?.slice(11).split(',') || families;
const output = resolve(repositoryRoot, args.find(arg => arg.startsWith('--out='))?.slice(6) || 'test-results/quint-refinement/summary.json');
for (const arg of args) if (!arg.startsWith('--families=') && !arg.startsWith('--out=') && arg !== '--require-complete') throw Error(`Unknown option ${arg}`);
for (const family of requested) if (!families.includes(family)) throw Error(`Unknown family ${family}`);
const models = loadModels().filter(model => model.family !== 'legacy');
const report = {schemaVersion: 1, startedAt: new Date().toISOString(), evidence: 'implementation trace refinement with explicit projections',
  modelCount: models.length, families: [], models: [], obligations: [], checksPassed: false, completeApplicationRefinement: false};
let failed = false;
for (const family of requested) {
  const modulePath = join(repositoryRoot, 'specs/quint/refinement', family, 'index.mjs');
  if (!existsSync(modulePath)) {
    failed = true;
    report.families.push({family, status: 'pending'});
    report.obligations.push({family, obligation: 'source-adapter coverage', reason: 'Family adapters are still being implemented.'});
    continue;
  }
  try {
    // Service adapters import parameter-property TypeScript. Browser fixture
    // functions retain Node's plain stripping so serialized callbacks have no
    // out-of-scope transform helpers.
    const module = family === 'services'
      ? await tsImport(pathToFileURL(modulePath).href, import.meta.url)
      : await import(pathToFileURL(modulePath).href);
    const run = module[{application: 'runApplicationRefinement', services: 'runServicesRefinement', native: 'runNativeRefinement', composition: 'runCompositionRefinement'}[family]];
    if (typeof run !== 'function') throw Error(`Missing runner for ${family}`);
    const result = await run();
    if (!Array.isArray(result.receipts) || !Array.isArray(result.obligations)) throw Error(`Invalid adapter report for ${family}`);
    report.families.push({family, status: 'checked', receipts: result.receipts});
    report.obligations.push(...result.obligations);
  } catch (error) {
    failed = true;
    report.families.push({family, status: 'failed', error: error instanceof Error ? error.stack : String(error)});
  }
}
for (const model of models) {
  const receipts = report.families.flatMap(family => family.receipts || []).filter(receipt =>
    receipt.coverageModel === model.module || receipt.model === model.module ||
    basename(receipt.receiptPath || '', '.json') === model.module);
  const currentHash = sha256(readFileSync(join(repositoryRoot, model.path)));
  const current = receipts.filter(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound &&
    receipt.sourceHashesAfter?.[join(repositoryRoot, model.path)] === currentHash &&
    Object.entries(receipt.sourceHashesAfter).every(([path, expected]) =>
      existsSync(path) && sha256(readFileSync(path)) === expected));
  const text = readFileSync(join(repositoryRoot, model.path), 'utf8').split(`module ${model.module} {`).at(-1);
  const declaredActions = [...text.matchAll(/\baction\s+(\w+)/g)].map(match => match[1]);
  const entry = {model: model.module, family: model.family, modelSha256: currentHash,
    status: current.length ? 'trace-checked' : 'unverified',
    traceCount: current.reduce((sum, receipt) => sum + receipt.traces, 0),
    checkpoints: current.reduce((sum, receipt) => sum + receipt.checkpoints, 0),
    observedFields: [...new Set(current.flatMap(receipt => receipt.observedFields))].sort(),
    modelActions: [...new Set(current.flatMap(receipt => Object.keys(receipt.actions)))].sort(),
    modelInitializers: [...new Set(current.flatMap(receipt => receipt.traceInputs.map(trace => trace.init?.name || 'init')))].sort(),
    scopes: [...new Set(current.map(receipt => receipt.scope))],
    receipts: current.map(receipt => receipt.receiptPath)};
  entry.unexercisedModelActions = [...new Set(declaredActions)].filter(action =>
    !['init', 'step', 'check'].includes(action) && !entry.modelActions.includes(action) && !entry.modelInitializers.includes(action));
  report.models.push(entry);
  if (!current.length) report.obligations.push({model: model.module, obligation: 'implementation transition relation', reason: 'No passing source-bound adapter receipt for this model revision.'});
}
report.traceCheckedModels = report.models.filter(model => model.status === 'trace-checked').length;
report.campaignCoverageComplete = report.traceCheckedModels === report.modelCount;
if (families.every(family => requested.includes(family)) && !report.campaignCoverageComplete) failed = true;
report.checksPassed = !failed;
report.finishedAt = new Date().toISOString();
report.obligations.push({obligation: 'unbounded implementation refinement', reason: 'Concrete trace campaigns establish their recorded finite/bounded projections. A universal simulation-relation proof requires separately discharged source semantics and environment assumptions.'});
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.traceCheckedModels}/${report.modelCount} runtime models have current source-bound trace evidence.`);
console.log(`${report.obligations.length} explicit refinement obligations remain. Report ${output}`);
process.exitCode = failed ? 1 : args.includes('--require-complete') ? 2 : 0;
