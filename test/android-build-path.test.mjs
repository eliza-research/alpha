import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {git as fixtureGit} from './fixtures/git-fixture.mjs';
import {checkoutProblems, VOICE_ASSET_ROOT, VOICE_HOST_MANIFEST} from '../scripts/android-build-preflight.ts';
import {TURBO_AGENT_DETECTION_ENV, preparedSourceEnv} from '../scripts/local-agent-source.ts';
import {ensurePreparedWorkflowWorker} from '../scripts/prepared-workflow-worker.ts';
import {workerHash} from '../scripts/workflow-worker-artifact.ts';
import {verifyNativeGoogleHost} from '../scripts/runtime-profile.ts';
import {coreStateBuildRecord} from '../scripts/core-state-patch.ts';
import {writeCoreStateFixture} from './fixtures/core-state-root.mjs';
import {realNode} from '../scripts/run-node-only-tests.ts';

const read = file => fs.readFileSync(file, 'utf8');

test('scrubbed children leave a turbo-style AGENTS.md updater with nothing to detect', t => {
  // Stand-in for turbo's detector: appends a managed block when any variable is set.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-agents-md-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'upstream\n');
  const updater = `const fs=require('fs');const names=${JSON.stringify(TURBO_AGENT_DETECTION_ENV)};if(names.some(n=>process.env[n]))fs.appendFileSync('AGENTS.md','<!-- BEGIN:turborepo-agent-rules -->\\n');`;
  const run = env => execFileSync(process.execPath, ['-e', updater], {cwd: dir, env});
  run(preparedSourceEnv({...process.env, CLAUDECODE: '1', AI_AGENT: 'claude', CODEX_SANDBOX: 'seatbelt'}));
  assert.equal(read(path.join(dir, 'AGENTS.md')), 'upstream\n');
  run({...process.env, CLAUDECODE: '1'});
  assert.notEqual(read(path.join(dir, 'AGENTS.md')), 'upstream\n');
});

test('prepared upstream children retain genuine Node generation through a Bun package-script parent', t => {
  const node = realNode();
  assert.ok(node, 'upstream Node tooling needs the installed genuine Node.js');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-prepared-node-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const tools = path.join(dir, 'tools'), selectedBun = path.join(dir, 'selected-bun');
  fs.mkdirSync(tools);fs.mkdirSync(selectedBun);
  // Keep an explicit alias-only Bun directory. A genuine Node directory may also
  // contain a different bun command, so promoting it must not change Bun selection.
  const bun = execFileSync('bun', ['-p', 'process.execPath'], {encoding: 'utf8'}).trim();
  fs.symlinkSync(node, path.join(tools, 'node'));
  fs.symlinkSync(bun, path.join(selectedBun, 'bun'));
  fs.symlinkSync(bun, path.join(selectedBun, 'node'));
  fs.writeFileSync(path.join(tools, 'bun'), '#!/bin/sh\necho competing-bun\n', {mode: 0o755});
  const inputPath = [tools, process.env.PATH].join(path.delimiter);
  const generator = path.join(dir, 'generate.mjs');
  const controlChannel = new URL('../vendor/eliza/plugins/plugin-native-browser-surface/scripts/control-channel.mjs', import.meta.url).href;
  fs.writeFileSync(generator, `import {installControlChannel} from ${JSON.stringify(controlChannel)};process.stdout.write(installControlChannel.toString());`);
  const generatedByNode = execFileSync(node, [generator], {encoding: 'utf8'});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'prepared-node-probe', scripts: {probe: 'bun probe.mjs'}}));
  fs.writeFileSync(path.join(dir, 'bunfig.toml'), `[run]
bun = true
`);
  const source = new URL('../scripts/local-agent-source.ts', import.meta.url).href;
  fs.writeFileSync(path.join(dir, 'probe.mjs'), `
import {execFileSync} from 'node:child_process';
import {preparedSourceEnv} from ${JSON.stringify(source)};
const original = {...process.env, PATH:${JSON.stringify(selectedBun)}+${JSON.stringify(path.delimiter)}+process.env.PATH, AI_AGENT:'fixture', ALPHA_BUN:${JSON.stringify(path.join(selectedBun,'bun'))}, KEPT:'original', OVERRIDDEN:'original'};
const env = preparedSourceEnv({...original,PATH:'unused-base-path'}, {PATH:original.PATH,OVERRIDDEN:'extra'});
const run = (command,args,environment=env) => execFileSync(command,args,{env:environment,encoding:'utf8'}).trim();
console.log(JSON.stringify({
  beforeRuntime:run('node',['-p','process.versions.bun || ""'],original),
  beforeGenerated:run('node',[${JSON.stringify(generator)}],original),
  afterRuntime:run('node',['-p','JSON.stringify({bun:process.versions.bun,node:process.versions.node})']),
  afterGenerated:run('node',[${JSON.stringify(generator)}]),
  bun:run('bun',['-p','process.execPath']),
  pathBefore:original.PATH,pathAfter:env.PATH,kept:env.KEPT,overridden:env.OVERRIDDEN,agent:env.AI_AGENT,
}));
`);
  const output = execFileSync(bun, ['run', 'probe'], {cwd: dir, env: {...process.env, PATH: inputPath}, encoding: 'utf8', timeout: 30_000});
  const result = JSON.parse(output.trim());
  assert.ok(result.beforeRuntime, 'the real Bun package script reproduces the inherited Node alias');
  assert.notEqual(result.beforeGenerated, generatedByNode.trim(), 'Bun transforms the function source used by the upstream generator');
  assert.deepEqual(JSON.parse(result.afterRuntime), {node: execFileSync(node, ['-p','process.versions.node'], {encoding: 'utf8'}).trim()});
  assert.equal(result.afterGenerated, generatedByNode.trim());
  assert.equal(fs.realpathSync(result.bun), fs.realpathSync(bun), 'the selected Bun remains executable');
  const before = result.pathBefore.split(path.delimiter), after = result.pathAfter.split(path.delimiter);
  assert.ok(after.includes(tools));assert.ok(after.includes(selectedBun));
  assert.ok(before.length > after.length, 'the actual injected alias directory is removed');
  const promoted = after[0];
  assert.deepEqual(after.filter(entry => entry !== promoted), before.filter(entry => after.includes(entry) && entry !== promoted), 'unrelated PATH entries retain their order');
  assert.equal(result.kept, 'original');assert.equal(result.overridden, 'extra');assert.equal(result.agent, undefined);
});

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-android-preflight-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const upstream = path.join(root, 'vendor/eliza');
  fs.mkdirSync(upstream, {recursive: true});
  const git = (...args) => fixtureGit(upstream, ...args);
  git('init', '-q');
  fs.writeFileSync(path.join(upstream, 'README'), 'pinned\n');
  git('add', '.');
  git('commit', '-q', '-m', 'pin');
  const commit = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'upstream.lock.json'), JSON.stringify({commit}));
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, text);
  };
  // Model a checkout's committed metadata, not native artifacts or qualification.
  const voice = JSON.parse(read(VOICE_HOST_MANIFEST));
  write('app.config.json', read('app.config.json'));
  write('android/paradee-voice/asr-inputs.json', read('android/paradee-voice/asr-inputs.json'));
  write(VOICE_HOST_MANIFEST, JSON.stringify({...voice, pin: commit, qualified: false, evidence: {deviceExecuted: false, emulatorDeviceExecuted: false, userAccepted: false, scope: 'Synthetic checkout metadata only; no native execution or acceptance'}}));
  const source = path.join(root, 'artifacts/local-agent-resident-' + commit);
  return {root, source, write, commit};
}

test('preflight names the exact command for a missing or refused voice input', t => {
  const f = fixture(t);
  // Every build needs the staged on-device voice outputs.
  assert.match(checkoutProblems(f.root)[0], /On-device voice outputs are not staged in \.eliza\/paradee-voice\/native/);
  let problems = checkoutProblems(f.root, {voiceHost: () => { throw Error('Voice bundle lacks the ASR slot'); }});
  assert.equal(problems.length, 1);
  assert.ok(problems[0].startsWith(`The on-device voice outputs in ${VOICE_ASSET_ROOT} are not admitted by ${VOICE_HOST_MANIFEST} (Voice bundle lacks the ASR slot; Gradle :app:verifyVoiceHost rejects the build).`), problems[0]);
  assert.match(problems[0], /bun run android:build:local produces them automatically from pinned public source and model inputs/);
  // Staged outputs that the record does not admit are refused by the real verifier, never repaired, in either lane.
  f.write(`${VOICE_ASSET_ROOT}/build-record.json`, '{}');
  assert.match(checkoutProblems(f.root)[0], /are not admitted by android\/voice-host\/qualified-voice-host\.json/);
});

test('Gradle\'s Google host check refuses a staged native Google host older than its product sources', t => {
  const f = fixture(t);
  f.write(path.relative(f.root, path.join(f.source, '.alpha-runtime-source.json')), '{"stamp":1}\n');
  f.write('android/app/src/main/assets/agent/alpha-source.json', '{"stamp":1}\n');
  f.write('android/app/src/main/assets/agent/alpha-runtime-profile.json', JSON.stringify({version: 1, runtimeProfile: 'native'}));
  // A built host artifact recording the hash of one product input, staged as agent:stage-android does.
  const hash = text => workerHash(Buffer.from(text));
  const artifact = `artifacts/mobile-workflow-worker-${f.commit}`, staged = 'android/app/src/main/assets/agent/workflow-worker';
  const previous = {source: process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR, worker: process.env.ALPHA_WORKFLOW_WORKER_OUTPUT};
  process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR = f.source;
  process.env.ALPHA_WORKFLOW_WORKER_OUTPUT = path.join(f.root, artifact);
  t.after(() => {
    for (const [name, value] of [['ALPHA_LOCAL_AGENT_SOURCE_DIR', previous.source], ['ALPHA_WORKFLOW_WORKER_OUTPUT', previous.worker]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  f.write('.eliza/client-features/packages/app/src/runtime/managed-google-agent/managed-google-route-policy.ts', 'export const policy = 1;\n');
  writeCoreStateFixture(f.root, f.source, f.commit);
  const manifest = JSON.stringify({version: 1, files: {'google-host.mjs': hash('host-1')}, nativeGoogleHost: {version: 1, module: 'google-host.mjs', bunVersion: '1.4.2', inputs: {'.eliza/client-features/packages/app/src/runtime/managed-google-agent/managed-google-route-policy.ts': hash('export const policy = 1;\n')}, coreState: coreStateBuildRecord(f.root, [], [])}});
  for (const directory of [artifact, staged]) {
    f.write(`${directory}/manifest.json`, manifest);
    f.write(`${directory}/google-host.mjs`, 'host-1');
  }
  verifyNativeGoogleHost(f.root);
  // An edited input without restaging: this used to pass every gate and ship the old host.
  f.write('.eliza/client-features/packages/app/src/runtime/managed-google-agent/managed-google-route-policy.ts', 'export const policy = 2;\n');
  assert.throws(() => verifyNativeGoogleHost(f.root), /Native Google host source changed; build a fresh host artifact/);
  // A rebuilt artifact that was never staged.
  f.write('.eliza/client-features/packages/app/src/runtime/managed-google-agent/managed-google-route-policy.ts', 'export const policy = 1;\n');
  f.write(`${staged}/google-host.mjs`, 'host-0');
  assert.throws(() => verifyNativeGoogleHost(f.root), /Staged native Google host differs from the built host artifact/);
});

test('preflight rejects an unpinned checkout and android:build stops before sync and Gradle', t => {
  const f = fixture(t);
  f.write('upstream.lock.json', JSON.stringify({commit: 'f'.repeat(40)}));
  assert.match(checkoutProblems(f.root)[0], /vendor\/eliza is at .*pins f{40}\. Run: git submodule update --init vendor\/eliza/);
  // The real entry point exits with status 2 and the guidance, without starting the build.
  for (const file of ['android-abis.ts', 'embedding-native-contract.ts', 'paradee-runtime.ts', 'voice-host.ts', 'build-android.ts', 'update-channel.ts', 'android-build-preflight.ts', 'mobile-uuid-adapter.ts', 'build-policy-source.ts', 'core-state-patch.ts', 'stage-embedding-host.ts', 'build-embedding-host.ts', 'toolchain.ts', 'copy-file-clone.ts', 'native-build-inputs.ts', 'android-stage-voice-models.ts'])
    f.write('scripts/' + file, read('scripts/' + file));
  // build-android.ts reads the release-signing environment names from the host descriptor.
  f.write('android/consumer-host.json', read('android/consumer-host.json'));
  const result = spawnSync(process.execPath, ['scripts/build-android.ts'], {cwd: f.root, encoding: 'utf8'});
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Android build prerequisites are missing/);
  assert.match(result.stderr, /git submodule update --init vendor\/eliza/);
  assert.equal(fs.existsSync(path.join(f.root, 'artifacts')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'web-dist')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'artifacts')), false);
});

test('worker build reuses only an artifact that verifies against the prepared source', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-worker-reuse-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, 'artifacts/source'), output = path.join(root, 'artifacts/worker');
  fs.mkdirSync(source, {recursive: true});
  fs.writeFileSync(path.join(source, '.alpha-runtime-source.json'), 'stamp-a');
  fs.writeFileSync(path.join(source, 'bun.lock'), 'lock');
  const producer = path.join(source, 'packages/scripts/plugins/plugin-workflow/build-workflow-artifact.ts');
  fs.mkdirSync(path.dirname(producer), {recursive: true});
  fs.writeFileSync(producer, `import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export async function buildWorkflowArtifact({sourceRoot,outputDir,sourceIdentity}){const hash=x=>createHash('sha256').update(x).digest('hex');const files={};for(const name of ['node_modules/smthrs/package.json','node_modules/zod/package.json','node_modules/effect/package.json','node_modules/@smthrs/engine/package.json','dependencies.json']){const f=path.join(outputDir,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'{}');files[name]=hash('{}');}fs.writeFileSync(path.join(outputDir,'manifest.json'),JSON.stringify({version:1,sourceStampSha256:sourceIdentity,lockSha256:hash(fs.readFileSync(path.join(sourceRoot,'bun.lock'))),files}));fs.appendFileSync(path.join(sourceRoot,'builds'),'x');}
`);
  const first = await ensurePreparedWorkflowWorker(root, source, output);
  assert.equal(first.reused, false);
  assert.equal(first.manifest.sourceStampSha256, workerHash(Buffer.from('stamp-a')));
  const second = await ensurePreparedWorkflowWorker(root, source, output);
  assert.equal(second.reused, true);
  assert.equal(read(path.join(source, 'builds')), 'x');
  // A re-prepared source never adopts the old artifact.
  fs.writeFileSync(path.join(source, '.alpha-runtime-source.json'), 'stamp-b');
  await assert.rejects(ensurePreparedWorkflowWorker(root, source, output), /does not match the prepared runtime source .*ALPHA_WORKFLOW_WORKER_OUTPUT/);
  assert.equal(read(path.join(source, 'builds')), 'x');
});

test('android:build:local builds the workflow worker before staging and stages before the build', () => {
  // The chain once stopped in agent:stage-android because nothing had built the worker artifact
  // that staging verifies first. Each step consumes the previous step's output, so order matters.
  const scripts = JSON.parse(read('package.json')).scripts;
  const chain = scripts['android:build:local'].split('&&').map(step => step.trim());
  assert.deepEqual(chain, [
    'bun scripts/android-build-preflight.ts',
    // Before the long preparation: it either has the reviewed libraries, reproduces them, or
    // stops in under a second naming the person who must supply them.
    'bun run agent:build-embedding-host',
    'bun run agent:prepare',
    'bun run agent:build-workflow-worker',
    'bun run agent:stage-android',
    // The shipped notices must list the staged runtime, or verify-apks records the releases
    // distributable:false ("notices lack the packaged runtime"). It rewrites the tracked
    // notices in the working tree for this build; that change is not committed.
    'bun run licenses:packaged-runtime',
    'bun run android:build',
  ]);
  assert.equal(scripts['licenses:packaged-runtime'], 'bun scripts/generate-licenses.ts --packaged-runtime');
  for (const step of chain.slice(1)) assert.ok(scripts[step.replace('bun run ', '')], step);
  assert.equal(scripts['android:build'], 'bun scripts/build-android.ts');
  assert.equal(scripts['agent:build-embedding-host'], 'bun scripts/build-embedding-host.ts', 'no option in the chain');
  // Staging itself refuses a missing or foreign worker artifact before the long mobile bundle build.
  const stage = read('scripts/stage-local-agent-runtime.ts');
  assert.ok(stage.indexOf('verifyWorkerArtifact(workerArtifactDirectory(root)') > 0);
  assert.ok(stage.indexOf('verifyWorkerArtifact(workerArtifactDirectory(root)') < stage.indexOf("'scripts/build-mobile-agent.ts'"));
});
