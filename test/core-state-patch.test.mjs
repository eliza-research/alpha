import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess, {execFileSync, spawnSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {CORE_STATE_TARGET, NOTES_STATE_TARGET, ROOM_QUEUE_TARGET, EMBEDDING_STATE_TARGET, PLUGIN_CONNECTOR_TARGET, CORE_STATE_MANIFEST, coreStatePatch, coreStateReceipt,
  coreStateBuildPlugin, coreStateBuildRecord, verifyCoreStateBuildRecord, coreRuntimeArguments, combinedCoreRuntime, coreStateRequiredTargets} from '../scripts/core-state-patch.mjs';
import {sourceManifest} from '../scripts/combined-agent-source.mjs';
import {writeCoreStateFixture} from './fixtures/core-state-root.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, simple = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-core-state-'));
  const source = path.join(root, 'source'), pin = '1'.repeat(40);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  writeCoreStateFixture(root, source, pin, simple);
  fs.writeFileSync(path.join(root, 'upstream.lock.json'), JSON.stringify({commit: pin}));
  return {root, source, file: path.join(source, CORE_STATE_TARGET),
    manifest: () => JSON.parse(fs.readFileSync(path.join(root, CORE_STATE_MANIFEST))),
    save: value => fs.writeFileSync(path.join(root, CORE_STATE_MANIFEST), JSON.stringify(value))};
}
test('reviewed TaskService patch materializes exact bytes while preserving original source', t => {
  const f = fixture(t), before = fs.readFileSync(f.file), prepared = coreStatePatch(f.root, f.source);
  assert.deepEqual(fs.readFileSync(f.file), before);
  const entry = prepared.files.get(CORE_STATE_TARGET);
  assert.equal(hash(entry.bytes), entry.afterSha256);
  assert.match(entry.bytes.toString(), /assertAcceptingExecution\(\)/);
  assert.match(entry.bytes.toString(), /startTimer\(\) \{\s+if \(this.stopped\) return/);
  assert.deepEqual([...prepared.files.keys()], f.manifest().patches.flatMap(patch => patch.targets.map(target => target.path)));
  assert.ok(prepared.files.has(ROOM_QUEUE_TARGET));
  assert.ok(prepared.files.has(EMBEDDING_STATE_TARGET));
});
test('missing, modified and wrong-pin patch inputs fail closed', t => {
  for (const mode of ['missing', 'digest', 'pin', 'target', 'output', 'input', 'linked']) {
    const f = fixture(t), patch = path.join(f.root, 'patches/eliza/task-service-stop.patch'), manifest = f.manifest();
    if (mode === 'missing') fs.unlinkSync(patch);
    if (mode === 'digest') fs.appendFileSync(patch, '\nchanged');
    if (mode === 'pin') { manifest.baseCommit = '2'.repeat(40); f.save(manifest); }
    if (mode === 'target') { manifest.patches[0].targets[0].path = 'packages/core/src/other.ts'; f.save(manifest); }
    if (mode === 'output') { manifest.patches[0].targets[0].afterSha256 = '0'.repeat(64); f.save(manifest); }
    if (mode === 'input') fs.appendFileSync(f.file, '\nchanged');
    if (mode === 'linked') { fs.renameSync(patch, patch+'.real'); fs.symlinkSync(patch+'.real', patch); }
    assert.throws(() => coreStatePatch(f.root, f.source), undefined, mode);
  }
});
test('build interception binds exact selected source and reports required transforms', t => {
  const f = fixture(t), prepared = coreStateBuildPlugin(f.root, f.source); let load;
  prepared.plugin.setup({onLoad(options, fn) { assert.ok(options.filter.test(f.file)); load = fn; }});
  const loaded = load({path: f.file});
  assert.equal(loaded.loader, 'ts');
  assert.equal(hash(loaded.contents), prepared.receipt.files[CORE_STATE_TARGET].afterSha256);
  const record = coreStateBuildRecord(f.root, prepared.transforms, true);
  verifyCoreStateBuildRecord(f.root, record, true);
  assert.throws(() => coreStateBuildRecord(f.root, [], true), /transformation/);
  assert.throws(() => verifyCoreStateBuildRecord(f.root, {...record, baseCommit: '0'.repeat(40)}), /changed/);
  assert.throws(() => load({path: path.join(f.root, 'other', CORE_STATE_TARGET)}), /Unexpected/);
  fs.appendFileSync(f.file, '\nchanged');
  assert.throws(() => load({path: f.file}), /changed/);
});
test('real Bun preload transforms the selected clean source and refuses subsequent source drift', t => {
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
  assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout.trim(), 'after after');
  assert.match(fs.readFileSync(f.file, 'utf8'), /before/);
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
  assert.equal(frozen.status, 0, frozen.stderr); assert.equal(frozen.stdout.trim(), 'after after');
  fs.appendFileSync(path.join(f.source, 'entry.mjs'), '// second change\n');
  const changed = spawnSync(process.env.ALPHA_BUN || 'bun', selected.args, {encoding: 'utf8', timeout: 30000,
    env: {...env, ...selected.environment}});
  assert.notEqual(changed.status, 0); assert.equal(changed.stdout.trim(), '');

});
test('all selected product source launchers install the authenticated core preload', () => {
  for (const file of ['cloud-resident-host.mjs', 'start-local-remote.mjs', 'start-cloud-qa.mjs', 'start-local-voice-agent.mjs', 'start-reviewed-workflow-agent.mjs']) {
    const source = fs.readFileSync(new URL('../scripts/'+file, import.meta.url), 'utf8');
    assert.match(source, /coreRuntimeArguments\(root,source,\[/, file);
    assert.match(source, /ALPHA_CORE_STATE_SOURCE:source/, file);
  }
  const combined = fs.readFileSync(new URL('../scripts/start-combined-agent.mjs', import.meta.url), 'utf8');
  assert.match(combined, /combinedCoreRuntime\(repo,realSource,manifestPath,actual,/);
  assert.match(combined, /env:\{\.\.\.env,\.\.\.core.environment\}/);
});

test('independently frozen revisions retain their explicit version contract', t => {
  const f = fixture(t), receipt = coreStateReceipt(f.root), args = ['entry.ts'];
  const snapshot = {revision: receipt.baseCommit, entries: Object.fromEntries(Object.entries(receipt.files).map(([name, target]) => [name, {sha256: target.beforeSha256}]))};
  const matched = combinedCoreRuntime(f.root, f.source, '/frozen/manifest.json', snapshot, args);
  assert.equal(matched.status.applied, true);
  assert.deepEqual(matched.args.slice(0, 2), ['--preload', path.join(f.root, 'scripts/core-state-preload.mjs')]);
  assert.equal(matched.environment.ALPHA_CORE_STATE_FROZEN_MANIFEST, '/frozen/manifest.json');
  for (const input of [{...snapshot, revision: '2'.repeat(40)}, {...snapshot, entries: {}}]) {
    const independent = combinedCoreRuntime(f.root, f.source, '/frozen/manifest.json', input, args);
    assert.deepEqual(independent.args, args); assert.deepEqual(independent.environment, {});
    assert.equal(independent.status.applied, false);
  }
});

test('patch consumes the verified Buffer when its pathname is replaced before execution', t => {
  const f = fixture(t), original = childProcess.execFileSync;
  let intercepted = 0;
  const expected = f.manifest();
  try {
    childProcess.execFileSync = (command, args, options) => {
      if (command === 'patch') {
        assert.equal(hash(options.input), expected.patches[intercepted++].sha256);
        assert.equal(args.includes('--input'), false);
        for (const patch of expected.patches) fs.writeFileSync(path.join(f.root, 'patches/eliza', patch.file), 'changed after verification');
      }
      return original(command, args, options);
    };
    syncBuiltinESMExports();
    const result = coreStatePatch(f.root, f.source);
    assert.equal(intercepted, expected.patches.length);
    assert.equal(hash(result.files.get(CORE_STATE_TARGET).bytes), f.manifest().patches[0].targets[0].afterSha256);
  } finally { childProcess.execFileSync = original; syncBuiltinESMExports(); }
});

test('development backend requires its selected TaskService transformation', t => {
  const source = fs.readFileSync(new URL('../backend/loader.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("coreStateRequiredTargets(Object.keys(built.metafile!.inputs))"));
  const f = fixture(t), skipped = coreStateBuildPlugin(f.root, f.source);
  assert.throws(() => coreStateBuildRecord(f.root, skipped.transforms, true), /transformation/);
});

test('each producer must transform exactly its selected reviewed targets', t => {
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
  assert.throws(() => coreStateBuildRecord(f.root, [...prepared.transforms, prepared.transforms[0]], both), /transformation/);
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
