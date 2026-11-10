import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import {captureInputs} from '../check-traces.mjs';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
const captured = new Map();
export function captureSources(paths) {
  for (const [path, hash] of Object.entries(captureInputs(paths.map(path => resolve(root, path))))) {
    if (!captured.has(path)) captured.set(path, hash);
  }
}
captureSources(['specs/quint/refinement/application/support.mjs', 'specs/quint/refinement/check-traces.mjs',
  'specs/quint/refinement/application/index.mjs', 'test/quint-application-refinement.test.mjs',
  'test/support/strip-types.mjs', 'upstream.lock.json', 'scripts/prepare-client-features.ts',
  ...readdirSync(resolve(root, 'patches/eliza')).filter(name => /\.(patch|json)$/.test(name)).map(name => 'patches/eliza/' + name)]);
export function boundInputs(options) {
  const sources = [...new Set([...options.sources, ...captured.keys(), 'specs/quint/refinement/application/index.mjs',
    'test/quint-application-refinement.test.mjs'])];
  for (const source of sources) {
    if (!captured.has(resolve(root, source))) throw Error(`Source was not captured before execution: ${source}`);
  }
  return {...options, sources, driverHashes: Object.fromEntries(captured)};
}
export const read = path => {
  captureSources([path]);
  return readFileSync(resolve(root, path), 'utf8');
};
export async function sourceModule(path) {
  return (await bundledSource(path, {'import.meta.env': '{}'})).exports;
}
export async function bundledSource(path, define = {}) {
  const built = buildSync({absWorkingDir: root, entryPoints: [path], bundle: true, write: false,
    platform: 'node', format: 'esm', metafile: true, define});
  const sources = Object.keys(built.metafile.inputs).filter(path => !path.startsWith('node_modules/') && !path.startsWith('<'));
  captureSources([path, ...sources]);
  return {exports: await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`),
    sources};
}
export function sourceContext(paths, names, globals = {}, prefix = '') {
  const context = vm.createContext({console, URL, AbortController, AbortSignal, DOMException,
    Event, CustomEvent, TextEncoder, structuredClone, setTimeout, clearTimeout, ...globals});
  const code = paths.map(path => stripTypeScriptTypes(read(path), {mode: 'strip'})
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/^export \{[^}]*\};?\s*$/gm, '')
    .replace(/^export /gm, '')).join('\n');
  vm.runInContext(`${prefix}\n${code}\nglobalThis.api = {${names.join(',')}};`, context);
  return context.api;
}
export function memoryStore({failWrites = false} = {}) {
  const values = new Map();
  return {values, failWrites,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { if (this.failWrites) throw Error('Injected storage failure'); values.set(key, String(value)); },
    removeItem(key) { if (this.failWrites) throw Error('Injected storage failure'); values.delete(key); },
  };
}
export const tick = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
export function checkpoint(trace, label, action, expect) {
  trace.steps.push({label, action, expect: structuredClone(expect)});
}
export const call = (name, ...args) => ({name, args});
export function trace(name, expect, init = call('init')) {
  return {name, init, expect: structuredClone(expect), steps: []};
}
