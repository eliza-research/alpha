import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {build} from 'esbuild';
import {materializeHistoricalFormalSources} from './formal-source-inventory.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const args = new Map(process.argv.slice(2).map(argument => {
  const match = /^--(vendor-dir|temporal-out|out|tlc-jar)=(.+)$/.exec(argument);
  if (!match) throw Error(`Unknown argument ${argument}`);
  return [match[1], match[2]];
}));
const vendor = resolve(root, args.get('vendor-dir') ?? 'vendor/eliza');
const temporal = resolve(root, args.get('temporal-out') ?? 'test-results/quint-core-configurations/temporal');
const out = resolve(root, args.get('out') ?? 'test-results/quint-core-configurations/interactive-task-refinement');
const tlcJar = resolve(args.get('tlc-jar') ?? resolve(homedir(), '.quint/apalache-dist-0.62.4/apalache/lib/apalache.jar'));
mkdirSync(out, {recursive: true});
const digest = data => createHash('sha256').update(data).digest('hex');
const hash = path => digest(readFileSync(path));
const graphRelative = 'packages/core/tla/InteractiveTask.reducer.graph.json';
const coreTest = resolve(vendor, 'packages/core/test/interactive-task-conformance.test.ts');
const parserRelative = 'packages/core/scripts/tla-graph.ts';
const currentGraph = resolve(vendor, 'packages/core/quint/InteractiveTask.reducer.graph.json');
const model = resolve(root, 'specs/quint/legacy/CoreInteractiveTask.qnt');
const inventoryPath = resolve(root, 'specs/quint/legacy/core/source-inventory.json');
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const vendorRevision = execFileSync('git', ['-C', vendor, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const history = materializeHistoricalFormalSources(root,['vendor/eliza/'+graphRelative,'vendor/eliza/'+parserRelative]);
const graphSource = resolve(root,history.resolveSource('vendor/eliza/'+graphRelative));
const parser = resolve(root,history.resolveSource('vendor/eliza/'+parserRelative));
const upstreamGraph = readFileSync(graphSource);
const historical = inventory.historicalArtifacts.find(artifact => artifact.path === graphRelative);
assert.equal(digest(upstreamGraph), historical.sha256, 'Vendor reducer graph matches the pinned conversion evidence');
const receiptPath = resolve(temporal, 'receipt.json');
const checkReceipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const finite = checkReceipt.results.find(result => result.model === 'InteractiveTask' && result.profile === 'reducer' && result.check === 'finite-temporal');
assert.equal(finite?.passed, true, 'A successful finite reducer check is required before graph comparison');
assert.equal(checkReceipt.inputHashes['specs/quint/legacy/CoreInteractiveTask.qnt'], hash(model));
const work = resolve(temporal, 'InteractiveTask-reducer');
const tla = resolve(work, 'CoreInteractiveTask.tla'), cfg = resolve(work, 'CoreInteractiveTask.cfg');
assert.equal(hash(tla), finite.generatedModelSha256);
assert.equal(hash(cfg), finite.generatedConfigSha256);

// The upstream suite uses only describe, it and deep equality. Preserve every
// test body and import; supply those three harness operations without installing
// the vendor's entire development dependency tree.
const testBundle = await build({absWorkingDir: vendor, entryPoints: [coreTest], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
  define: {'import.meta.url': JSON.stringify(pathToFileURL(coreTest).href)},
  plugins: [{name: 'upstream-test-registration', setup(builder) {
    builder.onResolve({filter: /^vitest$/}, () => ({path: 'vitest', namespace: 'harness'}));
    builder.onLoad({filter: /.*/, namespace: 'harness'}, () => ({loader: 'js', contents: `
      import assert from 'node:assert/strict';
      export const registered = [];
      export const describe = (_name, callback) => callback();
      export const it = (name, callback) => registered.push({name, callback});
      export const expect = (actual, message) => ({toEqual: expected => assert.deepEqual(actual, expected, message)});
    `}));
  }}], footer: {js: 'export { registered };'}});
const sources = [...new Set(Object.keys(testBundle.metafile.inputs).filter(path => !path.startsWith('harness:') && !path.startsWith('<')).map(path => resolve(vendor, path)))];
const provenance = Object.fromEntries([...sources, ...history.sources, currentGraph, parser, model, inventoryPath, receiptPath, tla, cfg, tlcJar, fileURLToPath(import.meta.url)]
  .map(path => [path, hash(path)]));
for (const path of [...sources, currentGraph]) {
  const relative = path.slice(vendor.length + 1);
  const committed = execFileSync('git', ['-C', vendor, 'cat-file', 'blob', `${vendorRevision}:${relative}`]);
  assert.equal(provenance[path], digest(committed), `${relative} matches the exact vendor revision`);
}
const result = {format: 'alpha-interactive-task-refinement-v1', vendorRevision, historicalSpecificationRevision:history.revision, inputs: provenance, startedAt: new Date().toISOString(), passed: false};
const save = () => writeFileSync(resolve(out, 'receipt.json'), JSON.stringify(result, null, 2) + '\n');
save();
try {
  const dot = resolve(out, 'Quint-reducer.dot');
  const javaArgs = ['-Xmx512m', '-Xss8m', '-cp', tlcJar, 'tlc2.TLC', '-workers', '1', '-lncheck', 'final',
    '-dump', 'dot', dot, '-metadir', resolve(out, 'states'), '-config', cfg, tla];
  const checked = spawnSync('java', javaArgs, {cwd: out, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024});
  const log = `${checked.stdout ?? ''}${checked.stderr ?? ''}`;
  writeFileSync(resolve(out, 'tlc.log'), log);
  assert.equal(checked.status, 0, log);
  assert.ok(log.includes('Model checking completed. No error has been found.'));
  const parserText = stripTypeScriptTypes(readFileSync(parser, 'utf8'), {mode: 'strip'});
  const {stateGraphFromDot} = await import(`data:text/javascript;base64,${Buffer.from(parserText).toString('base64')}`);
  // TLC wraps record-valued state fields. Join wrapped indents while preserving
  // the /\ separators between top-level variables for the upstream parser.
  const graph = stateGraphFromDot(readFileSync(dot, 'utf8').replace(/\\n +/g, ' '));
  assert.ok(graph.states.every(state => state.history.outcomesFinal && state.history.revocationFinal));
  const canonical = graph.states.map(state => JSON.stringify(state.s));
  const expected = JSON.parse(upstreamGraph.toString('utf8'));
  const expectedIndex = new Map(expected.states.map((state, i) => [JSON.stringify(state), i]));
  assert.equal(new Set(canonical).size, canonical.length, 'History projection is injective on the reachable reducer states');
  assert.deepEqual([...canonical].sort(), [...expectedIndex.keys()].sort());
  assert.deepEqual(graph.initial.map(i => canonical[i]), expected.initial.map(i => JSON.stringify(expected.states[i])));
  for (const [i, successors] of graph.next.entries()) {
    const state = canonical[i];
    assert.deepEqual(successors.map(next => canonical[next]).sort(),
      expected.next[expectedIndex.get(state)].map(next => JSON.stringify(expected.states[next])).sort(), state);
  }
  result.graph = {states: canonical.length, edges: graph.next.reduce((sum, next) => sum + next.length, 0), initial: graph.initial.length,
    sourceGraphSha256: digest(upstreamGraph), dotSha256: hash(dot), javaArgs};
  const {registered} = await import(`data:text/javascript;base64,${Buffer.from(testBundle.outputFiles[0].contents).toString('base64')}`);
  assert.equal(registered.length, 2, 'Both original conformance checks must execute');
  result.sourceChecks = [];
  for (const test of registered) {
    await test.callback();
    result.sourceChecks.push(test.name);
  }
  for (const [path, before] of Object.entries(provenance)) assert.equal(hash(path), before, `${path} changed during conformance`);
  assert.equal(execFileSync('git', ['-C', vendor, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), vendorRevision);
  assert.equal(digest(readFileSync(graphSource)), historical.sha256);
  result.passed = true;
  console.log(`PASS InteractiveTask exact graph ${result.graph.states} states and ${result.graph.edges} edges, ${result.sourceChecks.length} source checks`);
} catch (error) {
  result.error = error.message;
  throw error;
} finally {
  result.finishedAt = new Date().toISOString();
  save();
}
