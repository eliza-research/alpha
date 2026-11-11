import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {captureInputs} from '../../check-traces.mjs';
import {CORE_STATE_INPUTS, coreStateBuildRecord, coreStatePatch, coreStateRequiredTargets} from '../../../../../scripts/core-state-patch.ts';

const scheduler = 'packages/core/src/services/task-scheduler.ts';
const task = 'packages/core/src/services/task.ts';
let instances = 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// The only instrumentation is a module-local timer port and a read-only view
// of the source owners. No scheduler actions, guards or ordering are rewritten.
const observer = `
let schedulerClock;
export function installSchedulerClock(clock) { schedulerClock = clock; }
function setInterval(callback, milliseconds) { return schedulerClock.setInterval(callback, milliseconds); }
function clearInterval(handle) { schedulerClock.clearInterval(handle); }
export function observeScheduler() {
  return { registry: [...registry], dirtyAgents: [...dirtyAgents], timer, adapter,
    activeTick, schedulerGeneration, nextRegistrationId, busyServices: [...busyServices],
    processTasks: [...processTasks] };
}
`;

/** Compile both actual classes into one module instance with a byte-bound observer. */
export async function loadSchedulerSource(extraSources = []) {
  const root = process.cwd(), source = path.resolve(root, 'vendor/eliza');
  const core = coreStatePatch(root, source), compiled = new Map(), transforms = [];
  const built = await build({
    stdin: {contents: `export * from './vendor/eliza/${scheduler}';\nexport {TaskService} from './vendor/eliza/${task}';`,
      resolveDir: root, sourcefile: 'scheduler-refinement-entry.ts'},
    bundle: true, write: false, metafile: true, platform: 'node', format: 'esm',
    plugins: [{name: 'byte-bound-scheduler-observer', setup(builder) {
      builder.onLoad({filter: /\.(?:[cm]?[jt]sx?|json)$/, namespace: 'file'}, args => {
        const bytes = readFileSync(args.path), sourceSha256 = hash(bytes);
        compiled.set(args.path, sourceSha256);
        const relative = path.relative(source, args.path).split(path.sep).join('/');
        const patch = core.files.get(relative);
        if (patch) {
          assert.equal(sourceSha256, patch.beforeSha256);
          transforms.push({path: relative, sourceSha256, outputSha256: patch.afterSha256});
        }
        const contents = patch?.bytes ?? bytes;
        const extension = args.path.split('.').at(-1);
        const loader = {mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts'}[extension] ?? extension;
        return {contents: relative === scheduler ? contents.toString() + observer : contents, loader, resolveDir: path.dirname(args.path)};
      });
    }}],
  });
  for (const input of Object.keys(built.metafile.inputs)) {
    if (input !== 'scheduler-refinement-entry.ts') assert.ok(compiled.has(path.resolve(root, input)), `Unobserved compiled input: ${input}`);
  }
  const sources = [...compiled.keys(), fileURLToPath(import.meta.url), 'bun.lock', 'upstream.lock.json', ...CORE_STATE_INPUTS, ...extraSources];
  const driverHashes = captureInputs(sources);
  for (const [file, digest] of compiled) assert.equal(driverHashes[path.resolve(file)], digest, 'Scheduler source changed during compilation');
  for (const [file, digest] of Object.entries(core.receipt.inputHashes)) {
    assert.equal(driverHashes[path.resolve(file)], digest, 'Scheduler transform input changed before source capture');
  }
  const coreState = coreStateBuildRecord(root, transforms, coreStateRequiredTargets([...compiled.keys()]));
  assert.ok(coreState.transforms.some(entry => entry.path === task), 'Actual TaskService must receive its runtime repair');
  // Bun rejects a fragment after base64 data, so a trailing comment makes each instance a distinct module.
  const text = built.outputFiles[0].text;
  return {sources, driverHashes, coreState, newInstance: () => import(`data:text/javascript;base64,${Buffer.from(`${text}\n// scheduler-${++instances}`).toString('base64')}`)};
}
