import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {build} from 'esbuild';
import {captureInputs} from '../../check-traces.mjs';

/** Compile the real shared classes and bind exact input bytes before evaluating them. */
async function loadCoreSource(contents, extraSources) {
  const compiled = new Map();
  const root = process.cwd();
  const result = await build({
    stdin: {
      contents,
      resolveDir: root,
      sourcefile: 'core-runtime-entry.ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    metafile: true,
    plugins: [{name: 'observed-core-source', setup(builder) {
      builder.onLoad({filter: /\.(?:[cm]?[jt]sx?|json)$/, namespace: 'file'}, args => {
        const contents = readFileSync(args.path);
        compiled.set(args.path, createHash('sha256').update(contents).digest('hex'));
        const extension = args.path.split('.').at(-1);
        const loader = {mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts'}[extension] ?? extension;
        return {contents, loader, resolveDir: dirname(args.path)};
      });
    }}],
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input === 'core-runtime-entry.ts') continue;
    assert.ok(compiled.has(resolve(root, input)), `Unobserved bundled input ${input}`);
  }
  const sources = [...compiled.keys(), fileURLToPath(import.meta.url), 'package-lock.json', 'upstream.lock.json', ...extraSources];
  const driverHashes = captureInputs(sources);
  for (const [path, digest] of compiled) assert.equal(driverHashes[resolve(path)], digest, 'Core source changed during compilation');
  const module = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  return {...module, sources, driverHashes};
}

export function loadCoreRuntime(extraSources = []) {
  return loadCoreSource(`
    export {RuntimeRetirement} from './vendor/eliza/packages/core/src/runtime/retirement.ts';
    export {RuntimeServiceLifecycle} from './vendor/eliza/packages/core/src/runtime/service-lifecycle.ts';
  `, extraSources);
}

export function loadAgentRuntime(extraSources = []) {
  return loadCoreSource(`
    export {AgentRuntime} from './vendor/eliza/packages/core/src/runtime.ts';
    export {trackPostDeliveryTask, pendingPostDeliveryTaskCount}
      from './vendor/eliza/packages/core/src/services/post-delivery-task-tracker.ts';
  `, extraSources);
}
