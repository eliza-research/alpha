import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';

export const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return {promise, resolve: resolvePromise, reject: rejectPromise};
};
export async function until(predicate, description) {
  const deadline = performance.now() + 10000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, `Timed out waiting for ${description}`);
    await new Promise(resolve => setImmediate(resolve));
  }
}
export async function sourceModule(path, stubs = {}) {
  const result = await build({
    absWorkingDir: process.cwd(), entryPoints: [path], bundle: true, write: false,
    platform: 'node', format: 'esm', define: {'import.meta.env': '{}'},
    plugins: [{name: 'controlled-external-ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => Object.hasOwn(stubs, args.path)
        ? {path: args.path, namespace: 'external-port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'external-port'}, args => ({contents: stubs[args.path], loader: 'js'}));
    }}],
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(url);
}
export function casStore() {
  let raw = null;
  const events = [];
  const store = {
    async read() { events.push({kind: 'read'}); return structuredClone(raw); },
    async compareExchange(before, next) {
      const accepted = JSON.stringify(before) === JSON.stringify(raw);
      events.push({kind: 'cas', accepted, before: structuredClone(before), next: structuredClone(next)});
      if (accepted) raw = structuredClone(next);
      return accepted ? 'saved' : 'conflict';
    },
  };
  return {store, events, read: () => structuredClone(raw), replace: value => { raw = structuredClone(value); }};
}
export const action = (name, ...args) => ({name, ...(args.length ? {args} : {})});
export const rootPath = path => resolve(process.cwd(), path);
