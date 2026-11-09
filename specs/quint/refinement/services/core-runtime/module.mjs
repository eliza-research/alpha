import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, relative, sep} from 'node:path';
import {build} from 'esbuild';
import {captureInputs} from '../../check-traces.mjs';
import {CORE_STATE_INPUTS, coreStatePatch, coreStateBuildRecord, coreStateRequiredTargets} from '../../../../../scripts/core-state-patch.mjs';

/** Compile the real shared classes and bind exact input bytes before evaluating them. */
async function loadCoreSource(contents, extraSources) {
  const compiled = new Map(), effective = new Map(), transforms = [];
  const root = process.cwd(), source = resolve(root, 'vendor/eliza');
  const prepared = coreStatePatch(root, source);
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
        const sourceSha256 = createHash('sha256').update(contents).digest('hex');
        compiled.set(args.path, sourceSha256);
        const name = relative(source, args.path).split(sep).join('/');
        const patch = prepared.files.get(name);
        if (patch) {
          assert.equal(sourceSha256, patch.beforeSha256);
          transforms.push({path: name, sourceSha256, outputSha256: patch.afterSha256});
        }
        effective.set(args.path, patch?.afterSha256 ?? sourceSha256);
        const extension = args.path.split('.').at(-1);
        const loader = {mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts'}[extension] ?? extension;
        return {contents: patch?.bytes ?? contents, loader, resolveDir: dirname(args.path)};
      });
    }}],
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input === 'core-runtime-entry.ts') continue;
    assert.ok(compiled.has(resolve(root, input)), `Unobserved bundled input ${input}`);
  }
  const sources = [...compiled.keys(), fileURLToPath(import.meta.url), 'package-lock.json', 'upstream.lock.json', ...CORE_STATE_INPUTS, ...extraSources];
  const driverHashes = captureInputs(sources);
  for (const [path, digest] of compiled) assert.equal(driverHashes[resolve(path)], digest, 'Core source changed during compilation');
  for (const [path, digest] of Object.entries(prepared.receipt.inputHashes)) assert.equal(driverHashes[resolve(path)], digest, 'Core patch input changed before capture');
  const coreState = coreStateBuildRecord(root, transforms, coreStateRequiredTargets([...compiled.keys()]));
  const compiledHashes = Object.fromEntries([...compiled].map(([path, sourceSha256]) => [path, {sourceSha256, effectiveSha256: effective.get(path)}]));
  const module = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  return {...module, sources, driverHashes, coreState, compiledHashes};
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

export function loadTurnControllers(extraSources = []) {
  return loadCoreSource("export {TurnControllerRegistry} from './vendor/eliza/packages/core/src/runtime/turn-controller.ts';", extraSources);
}

export function loadProviderStateComposer(extraSources = []) {
  return loadCoreSource(`
    export {AgentRuntime} from './vendor/eliza/packages/core/src/runtime.ts';
    export {ProviderStateComposer} from './vendor/eliza/packages/core/src/runtime/state-composition.ts';
    export {runWithStreamingContext} from './vendor/eliza/packages/core/src/streaming-context.ts';
  `, extraSources);
}

export function loadRuntimeEmbeddings(extraSources = []) {
  return loadCoreSource(`
    export {RuntimeEmbeddings, EMBEDDING_STORE_IDENTITY_CACHE_KEY, EMBEDDING_STORE_ACCEPT_MODEL_SETTING}
      from './vendor/eliza/packages/core/src/runtime/embeddings.ts';
    export {ModelType} from './vendor/eliza/packages/core/src/types/model.ts';
  `, extraSources);
}
