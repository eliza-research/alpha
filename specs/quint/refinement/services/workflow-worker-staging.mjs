import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageWorkerArtifact, verifyWorkerArtifact, workerHash} from '../../../../scripts/workflow-worker-artifact.mjs';
import {writeWorkerFixture} from '../../../../test/fixtures/workflow-worker-assets.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'WorkflowWorkerStaging';
const worker = 'lib/worker.js';
const qualityErrors = new Map([
  ['Worker file hash mismatch', 'hash'],
  ['Invalid or missing worker file', 'missing'],
  ['Unexpected worker file', 'extra'],
  ['Worker sourceStampSha256 mismatch', 'wrongPin'],
  ['Worker lockSha256 mismatch', 'wrongLock'],
  ['Patched worker artifact is not upstream source; rebuild into a fresh directory', 'overlay'],
  ['Worker artifact contains a symlink', 'symlink'],
]);
const action = (name, ...args) => ({name, args});

function fixture(root, prior) {
  const source = join(root, 'source');
  const parent = join(root, 'assets');
  const target = join(parent, 'worker');
  const overlay = source+'.patch-overlay.json';
  const expected = {sourceStampSha256: 'a'.repeat(64), lockSha256: 'b'.repeat(64)};
  const known = new Map();

  function replaceSource(generation) {
    fs.rmSync(source, {recursive: true, force: true});
    fs.rmSync(overlay, {force: true});
    const manifest = writeWorkerFixture(source, 'generation-'+generation);
    known.set(generation, manifest);
  }
  if (prior) {
    replaceSource(prior);
    stageWorkerArtifact(source, target, expected);
  }
  replaceSource(2);

  function sourceGeneration() {
    const hash = JSON.parse(fs.readFileSync(join(source, 'manifest.json'), 'utf8')).files[worker];
    const generation = [...known].find(([, manifest]) => manifest.files[worker] === hash)?.[0];
    assert.ok(generation, 'Fixture source manifest carries a known generation');
    return generation;
  }

  function readSlot(directory) {
    if (!fs.existsSync(directory)) return 0;
    const manifestBytes = fs.readFileSync(join(directory, 'manifest.json'));
    const version = [...known].find(([, manifest]) => Buffer.from(JSON.stringify(manifest)).equals(manifestBytes))?.[0];
    assert.ok(version, 'Published and backup manifests must retain their exact bytes');
    const entries = [...Object.entries(known.get(version).files), ['manifest.json', workerHash(manifestBytes)]];
    for (const [name, hash] of entries)
      assert.equal(workerHash(fs.readFileSync(join(directory, name))), hash, 'Exact staged bytes for '+name);
    const index = entries.map(([name, hash]) => hash+'\t'+name+'\n').join('');
    assert.equal(fs.readFileSync(join(directory, 'files.sha256'), 'utf8'), index);
    const files = fs.readdirSync(directory, {recursive: true, withFileTypes: true})
      .filter(entry => entry.isFile()).length;
    assert.equal(files, entries.length+1, 'Staged artifact contains exactly the indexed files plus its index');
    return version;
  }

  function sourceQuality() {
    try {
      verifyWorkerArtifact(source, expected);
      return 'ready';
    } catch (error) {
      const quality = qualityErrors.get(error.message);
      assert.ok(quality, 'Unexpected source verification error '+error.message);
      return quality;
    }
  }

  function corrupt(kind) {
    const path = join(source, worker);
    switch (kind) {
      case 'hash': fs.appendFileSync(path, 'invalid fixture bytes'); break;
      case 'missing': fs.unlinkSync(path); break;
      case 'extra': fs.writeFileSync(join(source, 'extra.js'), 'unindexed fixture'); break;
      case 'wrongPin':
      case 'wrongLock': {
        const manifest = structuredClone(known.get(sourceGeneration()));
        manifest[kind === 'wrongPin' ? 'sourceStampSha256' : 'lockSha256'] = 'c'.repeat(64);
        fs.writeFileSync(join(source, 'manifest.json'), JSON.stringify(manifest));
        break;
      }
      case 'overlay': fs.writeFileSync(overlay, JSON.stringify({overlay: {fixture: 'retired'}})); break;
      case 'symlink': {
        const outside = join(root, 'synthetic-worker.js');
        fs.copyFileSync(path, outside);
        fs.unlinkSync(path);
        fs.symlinkSync(outside, path);
        break;
      }
      default: throw Error('Unknown fixture fault '+kind);
    }
  }

  let previous = prior, lastSource = 0, result = 'none';
  function stage(fault) {
    previous = readSlot(target);
    lastSource = sourceGeneration();
    const original = {copyFileSync: fs.copyFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync};
    const isTemporary = path => dirname(path) === parent && path.startsWith(join(parent, '.workflow-worker-'));
    let drifted = false, published = false, info;
    // These synchronous hooks only fault paths inside this fixture. They run
    // during the exact product helper and restore the Node bindings afterward.
    fs.copyFileSync = (from, to) => {
      if (fault === 'manifestDrift' && from.startsWith(source+'/') && !drifted) {
        drifted = true;
        replaceSource(3-lastSource);
      }
      original.copyFileSync(from, to);
      if (fault === 'copyBytes' && from === join(source, worker))
        fs.appendFileSync(to, 'corrupted fixture copy');
    };
    fs.renameSync = (from, to) => {
      if (to === target && isTemporary(from)) {
        const restoring = from.endsWith('.previous');
        if (fault === 'restoreRefusal' || fault === 'publishRefusal' && !restoring)
          throw Error(restoring ? 'fixture restore refused' : 'fixture publication refused');
        original.renameSync(from, to);
        if (!restoring) published = true;
      } else {
        original.renameSync(from, to);
      }
    };
    fs.rmSync = (path, options) => {
      if (fault === 'cleanupRefusal' && isTemporary(path) && path.endsWith('.previous'))
        throw Error('fixture backup cleanup refused');
      original.rmSync(path, options);
    };
    syncBuiltinESMExports();
    try {
      info = stageWorkerArtifact(source, target, expected);
    } catch (error) {
      const messages = new Map([
        ['copyBytes', 'Worker file hash mismatch'], ['manifestDrift', 'Worker manifest changed during staging'],
        ['publishRefusal', 'fixture publication refused'], ['restoreRefusal', 'fixture restore refused'],
        ['cleanupRefusal', 'fixture backup cleanup refused'],
      ]);
      if (fault === 'none') assert.ok(qualityErrors.has(error.message), error.message);
      else assert.equal(error.message, messages.get(fault));
    } finally {
      Object.assign(fs, original);
      syncBuiltinESMExports();
    }
    const current = readSlot(target);
    if (info) {
      assert.ok(published);
      assert.equal(info.files, Object.keys(known.get(current).files).length+1);
      assert.equal(info.indexSha256, workerHash(fs.readFileSync(join(target, 'files.sha256'))));
    }
    result = info ? 'published' : published ? 'publishUnconfirmed' : previous && !current ? 'stranded' : 'refused';
  }

  function observe() {
    const candidates = fs.existsSync(parent) ? fs.readdirSync(parent).filter(name => name.startsWith('.workflow-worker-')) : [];
    const backups = candidates.filter(name => name.endsWith('.previous'));
    assert.ok(backups.length <= 1);
    const active = readSlot(target);
    return {'s.source': sourceGeneration(), 's.quality': sourceQuality(), 's.target': active,
      's.previous': previous, 's.lastSource': lastSource, 's.backup': backups.length ? readSlot(join(parent, backups[0])) : 0,
      's.indexed': active !== 0, 's.temporary': candidates.length > backups.length, 's.result': result};
  }
  return {stage, observe, replaceSource, corrupt};
}

export async function checkWorkflowWorkerStaging(extraSources = []) {
  const sources = ['scripts/workflow-worker-artifact.mjs', 'scripts/stage-workflow-worker.mjs',
    'test/fixtures/workflow-worker-assets.mjs', driver, ...extraSources];
  const driverHashes = captureInputs(sources);
  const stage = (fault = 'none') => ['stage', fault];
  const cases = [
    ['first-publication', 0, [stage()]],
    ['replace-verified-previous', 1, [stage()]],
    ...[...qualityErrors.values()].map(kind => [kind+'-refusal-preserves-previous', 1,
      [['corrupt', kind], stage(), ['replaceSource', 2], stage()]]),
    ['copied-file-drift', 1, [stage('copyBytes'), stage()]],
    ['coherent-replacement-during-copy', 1, [stage('manifestDrift'), ['replaceSource', 2], stage()]],
    ['second-rename-refused-and-restored', 1, [stage('publishRefusal'), stage()]],
    ['restore-refused-preserves-the-exact-backup', 1, [stage('restoreRefusal'), stage()]],
    ['published-but-cleanup-refused', 1, [stage('cleanupRefusal'), stage()]],
  ];
  const traces = cases.map(([name, prior, steps]) => {
    const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'alpha-quint-worker-staging-')));
    try {
      const f = fixture(root, prior);
      const expect = f.observe();
      return {name, init: action('initFor', prior), expect, steps: steps.map(([op, ...args]) => {
        f[op](...args);
        return {label: [op, ...args].join(' '), action: action(op, ...args), expect: f.observe()};
      })};
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
  return checkTraces({model, sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'The actual synchronous worker verification, copy, index, backup and publish helpers execute inside private scratch directories.',
    'Two synthetic artifact generations, exact manifest/index/bytes and controlled copy or rename failure. All published and backup files are rehashed.',
    'One stranded backup is observed across a later stage. Process death, concurrent publishers, actual Android extraction and recovery of an abandoned backup remain separate.',
  ]});
}
