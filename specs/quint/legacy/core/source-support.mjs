import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {captureInputs} from '../../refinement/check-traces.mjs';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
const designInventory = 'specs/quint/legacy/core/source-inventory.json';

/** Retained translations describe this historical design, while runtime probes use the current pin. */
export function historicalCoreSource(filename) {
  const prefix = 'vendor/eliza/';
  const relative = filename.startsWith(prefix) ? filename.slice(prefix.length) : filename;
  const inventory = JSON.parse(readFileSync(resolve(root, designInventory), 'utf8'));
  const registered = [...inventory.models.flatMap(model => [
    {path: model.source, sha256: model.sha256}, ...model.configs,
  ]), ...inventory.historicalArtifacts];
  const expected = registered.find(row => row.path === relative);
  assert.ok(expected, `Unregistered historical design input ${relative}`);
  const bytes = execFileSync('git', ['--no-lazy-fetch', '-C', resolve(root, 'vendor/eliza'), 'cat-file', 'blob', `${inventory.revision}:${relative}`]);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, 'Historical design bytes match their recorded immutable revision');
  const output = resolve(root, 'test-results/quint-legacy-core-source', inventory.revision, String(process.pid), relative);
  mkdirSync(dirname(output), {recursive: true});
  writeFileSync(output, bytes);
  return output;
}

export function bindLegacyCoreSources(sources) {
  return [...sources.map(source => source.startsWith('vendor/eliza/packages/core/tla/')
    ? historicalCoreSource(source) : source), resolve(root, designInventory), fileURLToPath(import.meta.url)];
}

/** Explicit verification preparation; requires the recorded Git revision to be present locally. */
export function materializeHistoricalCoreSources() {
  const inventory = JSON.parse(readFileSync(resolve(root, designInventory), 'utf8'));
  const rows = [...inventory.models.flatMap(model => [model.source, ...model.configs.map(row => row.path)]),
    ...inventory.historicalArtifacts.map(row => row.path)];
  return {revision: inventory.revision, files: Object.fromEntries(rows.map(path => [path, historicalCoreSource(path)]))};
}
export const tick = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, refuse) => {resolve = accept; reject = refuse;});
  return {promise, resolve, reject};
}
export async function bundleVendorCore(vendorPath, exports, driverSources, plugins = []) {
  const vendor = resolve(root, vendorPath ?? 'vendor/eliza');
  const revision = execFileSync('git', ['--no-lazy-fetch', '-C', vendor, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const bundled = await build({absWorkingDir: vendor, nodePaths: [resolve(root, 'node_modules')],
    stdin: {contents: exports, resolveDir: vendor}, bundle: true, platform: 'node', format: 'cjs', write: false,
    metafile: true, logLevel: 'silent', plugins});
  const vendorFiles = Object.keys(bundled.metafile.inputs).filter(path => !path.startsWith('<')).map(path => resolve(vendor, path));
  const sources = [...new Set([...vendorFiles, fileURLToPath(import.meta.url), ...bindLegacyCoreSources(driverSources)])];
  const driverHashes = captureInputs(sources);
  for (const path of vendorFiles.filter(path => path.startsWith(vendor + '/') && !path.includes('/node_modules/'))) {
    const relative = path.slice(vendor.length + 1);
    const blob = execFileSync('git', ['--no-lazy-fetch', '-C', vendor, 'cat-file', 'blob', `${revision}:${relative}`]);
    assert.equal(driverHashes[path], createHash('sha256').update(blob).digest('hex'), `${relative} is the exact upstream blob`);
  }
  return {sources, driverHashes, revision, instantiate(observe) {
    const module = {exports: {}};
    new Function('require', 'module', 'exports', '__quint', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, observe);
    return module.exports;
  }};
}
export function observeFile(builder, filename, edits, readSource = path => readFileSync(path, 'utf8')) {
  builder.onLoad({filter: new RegExp(`/${filename.replaceAll('.', '\\.')}$`)}, ({path}) => {
    let source = readSource(path);
    for (const [before, after] of edits) {
      assert.equal(source.split(before).length, 2, `One observer seam in ${filename} for ${before}`);
      source = source.replace(before, after);
    }
    return {loader: 'ts', contents: source};
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ['--prepare'], 'Usage: node specs/quint/legacy/core/source-support.mjs --prepare');
  const pin = JSON.parse(readFileSync(resolve(root, 'upstream.lock.json'), 'utf8'));
  const inventory = JSON.parse(readFileSync(resolve(root, designInventory), 'utf8'));
  assert.match(pin.commit, /^[a-f0-9]{40}$/);
  assert.match(inventory.revision, /^[a-f0-9]{40}$/);
  const vendor = resolve(root, 'vendor/eliza');
  const git = args => execFileSync('git', ['--no-lazy-fetch', '-C', vendor, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  const current = () => {
    assert.equal(git(['rev-parse', 'HEAD']).trim(), pin.commit, 'Prepare the locked upstream checkout first');
    git(['diff', '--quiet', 'HEAD']);
  };
  current();
  let fetched = false;
  try {git(['cat-file', '-e', `${inventory.revision}^{commit}`]);}
  catch {
    // Only explicit preparation may fetch this one immutable, reviewed design revision.
    git(['fetch', '--no-tags', '--depth=1', pin.url, inventory.revision]);
    fetched = true;
  }
  const materialized = materializeHistoricalCoreSources();
  current();
  console.log(JSON.stringify({sourcePin: pin.commit, historicalRevision: materialized.revision,
    files: Object.keys(materialized.files).length, fetched}));
}
