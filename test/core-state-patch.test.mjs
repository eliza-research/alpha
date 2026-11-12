import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {CORE_STATE_TARGET, NOTES_STATE_TARGET, ROOM_QUEUE_TARGET, EMBEDDING_STATE_TARGET, PLUGIN_CONNECTOR_TARGET, CORE_STATE_MANIFEST, coreStatePatch, coreStateReceipt,
  coreStateBuildPlugin, coreStateBuildRecord, verifyCoreStateBuildRecord, coreRuntimeArguments, combinedCoreRuntime, coreStateRequiredTargets} from '../scripts/core-state-patch.ts';
import {sourceManifest} from '../scripts/combined-agent-source.ts';
import {parseBuildPolicy} from '../scripts/build-policy-source.ts';
import {policySource, writeCoreStateFixture} from './fixtures/core-state-root.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, simple = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-core-state-')));
  const source = path.join(root, 'source'), pin = '1'.repeat(40);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  writeCoreStateFixture(root, source, pin, simple);
  fs.writeFileSync(path.join(root, 'upstream.lock.json'), JSON.stringify({commit: pin}));
  return {root, source, file: path.join(source, CORE_STATE_TARGET),
    manifest: () => parseBuildPolicy(fs.readFileSync(path.join(root, CORE_STATE_MANIFEST))),
    save: value => fs.writeFileSync(path.join(root, CORE_STATE_MANIFEST), policySource(value))};
}
test('reviewed core files are read without changing their bytes', t => {
  const f = fixture(t), before = fs.readFileSync(f.file), prepared = coreStatePatch(f.root, f.source);
  assert.deepEqual(fs.readFileSync(f.file), before);
  const entry = prepared.files.get(CORE_STATE_TARGET);
  assert.equal(hash(entry.bytes), entry.afterSha256);
  assert.deepEqual(entry.bytes, before);
  assert.equal(entry.beforeSha256, entry.afterSha256);
  assert.deepEqual([...prepared.files.keys()], Object.keys(f.manifest().files));
  assert.ok(prepared.files.has(ROOM_QUEUE_TARGET));
  assert.ok(prepared.files.has(EMBEDDING_STATE_TARGET));
});
test('the independent APK verifier admits exactly the reviewed Android core inputs', () => {
  const root = path.resolve(import.meta.dirname, '..');
  coreStateReceipt(root);
  const manifest = parseBuildPolicy(fs.readFileSync(path.join(root, CORE_STATE_MANIFEST)));
  const targets = Object.keys(manifest.files);
  const verifier = path.join(root, 'scripts/verify-packaged-runtime.py');
  const policy = execFileSync('python3', ['-c',
    'import json,runpy,sys; print(json.dumps(runpy.run_path(sys.argv[1])["MOBILE_CORE_SOURCE_TARGETS"]))', verifier],
  {encoding: 'utf8'});
  assert.deepEqual(JSON.parse(policy), targets);
});
test('missing, modified and wrong-pin core inputs fail closed', t => {
  for (const mode of ['missing', 'digest', 'pin', 'target', 'input', 'linked', 'program']) {
    const f = fixture(t), catalog = path.join(f.root, CORE_STATE_MANIFEST), manifest = f.manifest();
    if (mode === 'missing') fs.unlinkSync(catalog);
    if (mode === 'program') fs.appendFileSync(catalog, '\nprocess.exit(0);');
    if (mode === 'digest') { manifest.files[CORE_STATE_TARGET] = '0'.repeat(64); f.save(manifest); }
    if (mode === 'pin') { manifest.baseCommit = '2'.repeat(40); f.save(manifest); }
    if (mode === 'target') { delete manifest.files[CORE_STATE_TARGET]; manifest.files['packages/core/src/other.ts'] = '0'.repeat(64); f.save(manifest); }
    if (mode === 'input') fs.appendFileSync(f.file, '\nchanged');
    if (mode === 'linked') { fs.renameSync(catalog, catalog+'.real'); fs.symlinkSync(catalog+'.real', catalog); }
    assert.throws(() => coreStatePatch(f.root, f.source), undefined, mode);
  }
});
test('build interception binds exact selected source and reports exact source observations', t => {
  const f = fixture(t), prepared = coreStateBuildPlugin(f.root, f.source); let load;
  prepared.plugin.setup({onLoad(options, fn) { assert.ok(options.filter.test(f.file)); load = fn; }});
  const loaded = load({path: f.file});
  assert.equal(loaded.loader, 'ts');
  assert.equal(hash(loaded.contents), prepared.receipt.files[CORE_STATE_TARGET].afterSha256);
  const record = coreStateBuildRecord(f.root, prepared.transforms, true);
  verifyCoreStateBuildRecord(f.root, record, true);
  assert.throws(() => coreStateBuildRecord(f.root, [], true), /observation/);
  assert.throws(() => verifyCoreStateBuildRecord(f.root, {...record, baseCommit: '0'.repeat(40)}), /changed/);
  assert.throws(() => load({path: path.join(f.root, 'other', CORE_STATE_TARGET)}), /Unexpected/);
  fs.appendFileSync(f.file, '\nchanged');
  assert.throws(() => load({path: f.file}), /changed/);
});
test('real Bun preload authenticates the selected clean source and refuses subsequent source drift', t => {
  const f = fixture(t, true);
  fs.writeFileSync(path.join(f.source, 'package.json'), JSON.stringify({workspaces: []}));
  fs.writeFileSync(path.join(f.source, 'turbo.json'), JSON.stringify({tasks: {}}));
  fs.writeFileSync(path.join(f.source, 'entry.mjs'), `import {value} from './${CORE_STATE_TARGET}'; import {value as connector} from './${PLUGIN_CONNECTOR_TARGET}'; console.log(value, connector);\n`);
  const env = {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
  execFileSync('git', ['init', '-q', f.source], {env});
  execFileSync('git', ['-C', f.source, 'add', '.'], {env});
  execFileSync('git', ['-C', f.source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], {env});
  const pin = execFileSync('git', ['-C', f.source, 'rev-parse', 'HEAD'], {env, encoding: 'utf8'}).trim();
  const manifest = f.manifest(); manifest.baseCommit = pin; f.save(manifest);
  fs.writeFileSync(path.join(f.root, 'upstream.lock.json'), JSON.stringify({commit: pin}));
  const args = coreRuntimeArguments(f.root, f.source, [path.join(f.source, 'entry.mjs')]);
  const run = spawnSync(process.env.ALPHA_BUN || 'bun', args, {encoding: 'utf8', timeout: 30000,
    env: {...env, ALPHA_CORE_STATE_SOURCE: f.source}});
  assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout.trim(), 'reviewed reviewed');
  assert.match(fs.readFileSync(f.file, 'utf8'), /reviewed/);
  fs.appendFileSync(path.join(f.source, 'entry.mjs'), '// source drift\n');
  const rejected = spawnSync(process.env.ALPHA_BUN || 'bun', args, {encoding: 'utf8', timeout: 30000,
    env: {...env, ALPHA_CORE_STATE_SOURCE: f.source}});
  assert.notEqual(rejected.status, 0); assert.equal(rejected.stdout.trim(), '');
  // A separately frozen custom snapshot uses its own manifest guard.
  const snapshot = sourceManifest(f.source), manifestFile = path.join(f.root, 'frozen.json');
  fs.writeFileSync(manifestFile, JSON.stringify(snapshot));
  const selected = combinedCoreRuntime(f.root, f.source, manifestFile, snapshot, [path.join(f.source, 'entry.mjs')]);
  const frozen = spawnSync(process.env.ALPHA_BUN || 'bun', selected.args, {encoding: 'utf8', timeout: 30000,
    env: {...env, ...selected.environment}});
  assert.equal(frozen.status, 0, frozen.stderr); assert.equal(frozen.stdout.trim(), 'reviewed reviewed');
  fs.appendFileSync(path.join(f.source, 'entry.mjs'), '// second change\n');
  const changed = spawnSync(process.env.ALPHA_BUN || 'bun', selected.args, {encoding: 'utf8', timeout: 30000,
    env: {...env, ...selected.environment}});
  assert.notEqual(changed.status, 0); assert.equal(changed.stdout.trim(), '');

});

test('independently frozen revisions retain their explicit version contract', t => {
  const f = fixture(t), receipt = coreStateReceipt(f.root), args = ['entry.ts'];
  const snapshot = {revision: receipt.baseCommit, entries: Object.fromEntries(Object.entries(receipt.files).map(([name, target]) => [name, {sha256: target.beforeSha256}]))};
  const matched = combinedCoreRuntime(f.root, f.source, '/frozen/manifest.json', snapshot, args);
  assert.equal(matched.status.applied, true);
  assert.deepEqual(matched.args.slice(0, 2), ['--preload', path.join(f.root, 'scripts/core-state-preload.ts')]);
  assert.equal(matched.environment.ALPHA_CORE_STATE_FROZEN_MANIFEST, '/frozen/manifest.json');
  for (const input of [{...snapshot, revision: '2'.repeat(40)}, {...snapshot, entries: {}}]) {
    const independent = combinedCoreRuntime(f.root, f.source, '/frozen/manifest.json', input, args);
    assert.deepEqual(independent.args, args); assert.deepEqual(independent.environment, {});
    assert.equal(independent.status.applied, false);
  }
});

test('each producer must observe exactly its selected reviewed targets', t => {
  const f = fixture(t), prepared = coreStateBuildPlugin(f.root, f.source); let load;
  prepared.plugin.setup({onLoad(_options, callback) { load = callback; }});
  load({path: path.join(f.source, CORE_STATE_TARGET)});
  const both = coreStateRequiredTargets([path.join(f.source, CORE_STATE_TARGET), path.join(f.source, NOTES_STATE_TARGET)]);
  assert.deepEqual(both, [CORE_STATE_TARGET, NOTES_STATE_TARGET]);
  assert.throws(() => coreStateBuildRecord(f.root, prepared.transforms, both), /selected core/);
  assert.throws(() => coreStateBuildRecord(f.root, prepared.transforms, []), /selected core/);
  load({path: path.join(f.source, NOTES_STATE_TARGET)});
  const record = coreStateBuildRecord(f.root, prepared.transforms, both);
  verifyCoreStateBuildRecord(f.root, record, both);
  assert.throws(() => coreStateBuildRecord(f.root, [...prepared.transforms, prepared.transforms[0]], both), /observation/);
  const embeddingFile = path.join(f.source, EMBEDDING_STATE_TARGET);
  const connectorFile = path.join(f.source, PLUGIN_CONNECTOR_TARGET);
  const all = [...both, ...coreStateRequiredTargets([embeddingFile, connectorFile])];
  assert.deepEqual(all, [...both, EMBEDDING_STATE_TARGET, PLUGIN_CONNECTOR_TARGET]);
  assert.throws(() => coreStateBuildRecord(f.root, prepared.transforms, all), /selected core/);
  load({path: embeddingFile});
  assert.throws(() => coreStateBuildRecord(f.root, prepared.transforms, all), /selected core/);
  load({path: connectorFile});
  verifyCoreStateBuildRecord(f.root, coreStateBuildRecord(f.root, prepared.transforms, all), all);
  assert.deepEqual(coreStateRequiredTargets(['/host/transport.ts']), []);
});
