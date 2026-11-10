import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {captureInputs} from '../../refinement/check-traces.mjs';
import {materializeHistoricalFormalSources} from './formal-source-inventory.mjs';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const tick = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, refuse) => {resolve = accept; reject = refuse;});
  return {promise, resolve, reject};
}
export async function bundleVendorCore(vendorPath, exports, driverSources, plugins = [], historicalRuntime = []) {
  const vendor = resolve(root, vendorPath ?? 'vendor/eliza');
  const revision = execFileSync('git', ['-C', vendor, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const history = materializeHistoricalFormalSources(root, [...driverSources, ...historicalRuntime.map(name => resolve(vendor, name))]);
  const archived = new Map(historicalRuntime.map(name => {
    const original = resolve(vendor, name), source = history.resolveSource(original);
    assert.notEqual(source, original, 'Historical runtime fragments need an explicit inventory hash');
    return [original, source];
  }));
  const compiledHistorical = new Map();
  const historicalPlugin = {name: 'authenticated-historical-runtime-fragments', setup(builder) {
    builder.onLoad({filter: /\.(?:ts|tsx)$/}, args => {
      const source = archived.get(args.path);
      if (source) {
        const bytes = readFileSync(source);
        compiledHistorical.set(source, createHash('sha256').update(bytes).digest('hex'));
        return {contents: bytes, loader: 'ts', resolveDir: dirname(args.path)};
      }
    });
  }};
  const bundled = await build({absWorkingDir: vendor, nodePaths: [resolve(root, 'node_modules')],
    stdin: {contents: exports, resolveDir: vendor}, bundle: true, platform: 'node', format: 'cjs', write: false,
    metafile: true, logLevel: 'silent', plugins: [historicalPlugin, ...plugins]});
  const vendorFiles = Object.keys(bundled.metafile.inputs).filter(path => !path.startsWith('<')).map(path => resolve(vendor, path));
  for (const original of archived.keys()) assert.ok(vendorFiles.includes(original), 'Historical runtime fragment was not executed: '+original);
  const sources = [...new Set([...vendorFiles.map(history.resolveSource), fileURLToPath(import.meta.url), ...history.sources])];
  const driverHashes = captureInputs(sources);
  for (const [source, digest] of compiledHistorical) assert.equal(driverHashes[source], digest, 'Historical source changed during compilation');
  for (const path of vendorFiles.filter(path => path.startsWith(vendor + '/') && !path.includes('/node_modules/'))) {
    const relative = path.slice(vendor.length + 1);
    const sourceRevision = archived.has(path) ? history.revision : revision;
    const blob = execFileSync('git', ['-C', vendor, 'cat-file', 'blob', `${sourceRevision}:${relative}`]);
    assert.equal(driverHashes[history.resolveSource(path)], createHash('sha256').update(blob).digest('hex'), `${relative} is the exact upstream blob at ${sourceRevision}`);
  }
  return {sources, driverHashes, revision, historicalRevision: archived.size ? history.revision : undefined,
    historicalRuntime: [...historicalRuntime], resolveHistoricalSource:history.resolveSource, instantiate(observe) {
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
