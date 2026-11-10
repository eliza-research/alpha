import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensurePreparedWorkflowWorker} from '../../../../scripts/prepared-workflow-worker.mjs';
import {workerHash} from '../../../../scripts/workflow-worker-artifact.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const model = 'PreparedWorkflowWorker';
const modelPath = 'specs/quint/services/PreparedWorkflowWorker.qnt';
const root = resolve(import.meta.dirname, '../../../..');
const producerPath = 'test/fixtures/prepared-worker-producer.mjs';
const symbol = Symbol.for('alpha.quint.preparedWorkerPorts');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};

export async function checkPreparedWorkflowWorker(extraSources = []) {
  const sources = [modelPath, fileURLToPath(import.meta.url), producerPath,
    'scripts/prepared-workflow-worker.mjs', 'scripts/local-agent-source.mjs',
    'scripts/workflow-worker-artifact.mjs', 'scripts/build-workflow-worker.ts',
    'scripts/copy-file-clone.mjs', 'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    ...extraSources];
  const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'alpha-quint-prepared-worker-')));
  const driverHashes = captureInputs(sources);
  const traces = [], generatedSources = [];
  globalThis[symbol] ??= new Map();
  try {
    let serial = 0;
    async function scenario(name, operations) {
      const fixtureRoot = join(directory, String(++serial));
      const source = join(fixtureRoot, 'artifacts/source');
      let output = join(fixtureRoot, 'artifacts/worker');
      fs.mkdirSync(source, {recursive: true});
      const stamp = join(source, '.alpha-runtime-source.json');
      const lock = join(source, 'bun.lock');
      const producer = join(source, 'packages/scripts/plugins/plugin-workflow/build-workflow-artifact.ts');
      fs.mkdirSync(join(source, 'packages/scripts/plugins/plugin-workflow'), {recursive: true});
      fs.copyFileSync(join(root, producerPath), producer);
      generatedSources.push(producer);
      driverHashes[producer] = workerHash(fs.readFileSync(producer));
      let stampId = 1, lockId = 1, phase = 'idle', result = 'none', builds = 0;
      let capturedStamp = 0, capturedLock = 0, pending, gate;
      const writeSource = () => {
        fs.writeFileSync(stamp, 'stamp-' + stampId);
        fs.writeFileSync(lock, 'lock-' + lockId);
      };
      writeSource();
      const observe = () => {
        let quality = 'absent', outputStamp = 0, outputLock = 0;
        if (fs.existsSync(output)) {
          const manifestPath = join(output, 'manifest.json');
          if (!fs.existsSync(manifestPath)) quality = 'partial';
          else {
            const manifest = JSON.parse(fs.readFileSync(manifestPath));
            outputStamp = [1, 2].find(n => manifest.sourceStampSha256 === workerHash(Buffer.from('stamp-' + n)));
            outputLock = [1, 2].find(n => manifest.lockSha256 === workerHash(Buffer.from('lock-' + n)));
            quality = fs.readFileSync(join(output, 'dependencies.json'), 'utf8') === '{}' ? 'valid' : 'corrupt';
          }
        }
        return Object.fromEntries(Object.entries({stamp: stampId, lock: lockId, outputStamp, outputLock,
          quality, phase, capturedStamp, capturedLock, result, builds}).map(([key, value]) => ['s.' + key, value]));
      };
      const trace = {name, init: {name: 'init'}, expect: observe(), steps: []};
      for (const [operation, ...args] of operations) {
        if (operation === 'begin') {
          const absent = !fs.existsSync(output);
          if (absent) {
            capturedStamp = stampId; capturedLock = lockId;
            phase = 'building'; result = 'pending';
            const entered = deferred(); gate = deferred();
            globalThis[symbol].set(source, {enter() {builds++; entered.resolve();}, release: gate.promise});
            pending = ensurePreparedWorkflowWorker(fixtureRoot, source, output).then(
              value => {result = value.reused ? 'reused' : 'built'; phase = 'idle';},
              () => {result = 'refused'; phase = 'idle';});
            await entered.promise;
          } else {
            try {const value = await ensurePreparedWorkflowWorker(fixtureRoot, source, output); result = value.reused ? 'reused' : 'built';}
            catch {result = 'refused';}
          }
        } else if (operation === 'finish') {gate.resolve(args[0]); await pending;}
        else if (operation === 'source') {[stampId, lockId] = args; writeSource(); result = 'none';}
        else if (operation === 'corrupt') {fs.writeFileSync(join(output, 'dependencies.json'), 'Corrupted bytes'); result = 'none';}
        else if (operation === 'freshOutput') {
          assert.equal(fs.readFileSync(join(output, 'incomplete.txt'), 'utf8'), 'Retained interrupted producer output');
          output += '-fresh'; result = 'none';
        }
        else throw Error('Unknown replay operation ' + operation);
        trace.steps.push({label: operation + ' on product preparation', action: {name: operation, args}, expect: observe()});
      }
      assert.equal(phase, 'idle');
      globalThis[symbol].delete(source);
      traces.push(trace);
    }
    const begin = ['begin'], good = ['finish', 'valid'];
    await scenario('build then exact reuse', [begin, good, begin]);
    await scenario('stale stamp refuses reuse without a second producer', [begin, good, ['source', 2, 1], begin]);
    await scenario('stale lock refuses reuse', [begin, good, ['source', 1, 2], begin]);
    await scenario('changed worker bytes refuse reuse', [begin, good, ['corrupt'], begin]);
    await scenario('stamp drift while building is refused', [begin, ['source', 2, 1], good, begin]);
    await scenario('lock drift while building is refused', [begin, ['source', 1, 2], good, begin]);
    await scenario('partial output survives failure and refuses reuse', [begin, ['finish', 'partial'], begin]);
    await scenario('corrupt producer output refuses build and reuse', [begin, ['finish', 'corrupt'], begin]);
    await scenario('failure before output permits normal retry', [begin, ['finish', 'failed'], begin, good]);
    await scenario('fresh directory preserves interrupted output', [begin, ['finish', 'partial'], ['freshOutput'], begin, good]);
    sources.push(...generatedSources);
    // Stable inputs were captured before any source execution. Each generated
    // producer was captured before importing it and is retained by checksum.
    return await checkTraces({model, modelPath, sources, generatedSources, driverHashes, traces,
      scope: 'bounded-orchestration', assumptions: [
        'Executes actual ensure/build helpers and artifact verifier with a closed synthetic generic producer in disposable directories.',
        'One sequential caller, two source/lock identities and at most three builds. Process interruption and concurrent producers require separate schedules.',
        'SDK bundling, Android packaging, native host addition and installed worker execution remain separate obligations.',
      ]});
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
}
