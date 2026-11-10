import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensurePreparedWorkflowWorker} from '../../../../scripts/prepared-workflow-worker.mjs';
import {verifyWorkerArtifact, workerHash} from '../../../../scripts/workflow-worker-artifact.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const model = 'PreparedWorkflowWorker';
const modelPath = 'specs/quint/services/PreparedWorkflowWorker.qnt';
const root = resolve(import.meta.dirname, '../../../..');
const producerPath = 'test/fixtures/prepared-worker-producer.mjs';
const symbol = Symbol.for('alpha.quint.preparedWorkerPorts');
const corruptionTargets = {
  corrupt: 'dependencies.json',
  corruptRequired: 'node_modules/zod/package.json',
  addUnexpected: 'unexpected.txt',
  corruptManifest: 'manifest.json',
};
// Independent inventory includes names, kinds, modes and every file byte. It
// also covers files omitted from or unreadable through a malformed manifest.
function artifactDigest(directory) {
  const inventory = [];
  function visit(path, name) {
    const stat = fs.lstatSync(path);
    if (stat.isDirectory()) {
      inventory.push([name, 'directory', stat.mode & 0o777]);
      for (const child of fs.readdirSync(path).sort()) visit(join(path, child), name + '/' + child);
    } else {
      assert.ok(stat.isFile(), 'The closed producer emits only ordinary files');
      inventory.push([name, 'file', stat.mode & 0o777, workerHash(fs.readFileSync(path))]);
    }
  }
  visit(directory, '.');
  return workerHash(Buffer.from(JSON.stringify(inventory)));
}

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
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs',
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
      const retainedOutputs = new Map();
      const writeSource = () => {
        fs.writeFileSync(stamp, 'stamp-' + stampId);
        fs.writeFileSync(lock, 'lock-' + lockId);
      };
      writeSource();
      const observe = () => {
        for (const [directory, digest] of retainedOutputs) {
          assert.equal(artifactDigest(directory), digest, 'Interrupted worker output retains every original byte');
        }
        let quality = 'absent', outputStamp = 0, outputLock = 0;
        if (fs.existsSync(output)) {
          const digest = artifactDigest(output);
          const manifestPath = join(output, 'manifest.json');
          if (!fs.existsSync(manifestPath)) quality = 'partial';
          else {
            quality = 'corrupt';
            let manifest;
            try {manifest = JSON.parse(fs.readFileSync(manifestPath));}
            catch (error) {assert.ok(error instanceof SyntaxError);}
            if (manifest) {
              outputStamp = [1, 2].find(n => manifest.sourceStampSha256 === workerHash(Buffer.from('stamp-' + n))) ?? 0;
              outputLock = [1, 2].find(n => manifest.lockSha256 === workerHash(Buffer.from('lock-' + n))) ?? 0;
            }
            try {verifyWorkerArtifact(output); quality = 'valid';}
            catch (error) {assert.ok(error instanceof Error);}
          }
          assert.equal(artifactDigest(output), digest, 'Artifact observation does not alter the output tree');
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
            const digest = artifactDigest(output);
            try {const value = await ensurePreparedWorkflowWorker(fixtureRoot, source, output); result = value.reused ? 'reused' : 'built';}
            catch {result = 'refused';}
            assert.equal(artifactDigest(output), digest, 'Existing worker admission leaves all output bytes intact');
          }
        } else if (operation === 'finish') {
          gate.resolve(args[0]); await pending;
          if (args[0] === 'partial') retainedOutputs.set(output, artifactDigest(output));
        }
        else if (operation === 'source') {[stampId, lockId] = args; writeSource(); result = 'none';}
        else if (Object.hasOwn(corruptionTargets, operation)) {
          fs.writeFileSync(join(output, corruptionTargets[operation]), 'Corrupted bytes'); result = 'none';
        }
        else if (operation === 'freshOutput') {
          assert.equal(fs.readFileSync(join(output, 'incomplete.txt'), 'utf8'), 'Retained interrupted producer output');
          output += '-fresh'; result = 'none';
        }
        else throw Error('Unknown replay operation ' + operation);
        const action = operation === 'corruptRequired' || operation === 'addUnexpected' ? 'corrupt' : operation;
        trace.steps.push({label: operation + ' on product preparation', action: {name: action, args}, expect: observe()});
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
    await scenario('changed required package bytes refuse reuse', [begin, good, ['corruptRequired'], begin]);
    await scenario('an unexpected output file refuses reuse', [begin, good, ['addUnexpected'], begin]);
    await scenario('malformed manifest bytes refuse reuse', [begin, good, ['corruptManifest'], begin]);
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
        'One sequential caller, two source/lock identities and at most three builds. The complete output tree is independently fingerprinted before and after existing-output admission. Interrupted output retains its original tree fingerprint through every later checkpoint, including a build into another directory.',
        'The actual artifact verifier classifies all emitted files, manifest validity and unexpected files. Controlled corruptions cover dependencies.json, another required package, an extra file and a malformed manifest. Process interruption and concurrent producers require separate schedules.',
        'SDK bundling, Android packaging, native host addition and installed worker execution remain separate obligations.',
      ]});
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
}
