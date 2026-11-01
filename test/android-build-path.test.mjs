import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {checkoutProblems, embeddingHostProblems, preparedRuntimeProblems, VOICE_ASSET_ROOT, VOICE_HOST_MANIFEST} from '../scripts/android-build-preflight.mjs';
import {TURBO_AGENT_DETECTION_ENV, preparedSourceEnv} from '../scripts/local-agent-source.mjs';
import {ensurePreparedWorkflowWorker} from '../scripts/prepared-workflow-worker.mjs';
import {workerHash} from '../scripts/workflow-worker-artifact.mjs';

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

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-android-preflight-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const upstream = path.join(root, 'vendor/eliza');
  fs.mkdirSync(upstream, {recursive: true});
  const git = (...args) => execFileSync('git', args, {cwd: upstream, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(upstream, 'README'), 'pinned\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'pin');
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

test('preflight names the exact command for each missing build input', t => {
  const f = fixture(t);
  // A distribution build needs the staged on-device voice outputs (speech is on-device only); the explicit
  // unpackaged developer lane may omit them, and local speech then reports unavailable.
  assert.match(checkoutProblems(f.root)[0], /On-device voice outputs are not staged in \.eliza\/paradee-voice\/native/);
  assert.deepEqual(checkoutProblems(f.root, {allowUnpackagedRuntime: true}), []);
  let problems = checkoutProblems(f.root, {voiceHost: () => { throw Error('Voice bundle lacks the ASR slot'); }});
  assert.equal(problems.length, 1);
  assert.ok(problems[0].startsWith(`The on-device voice outputs in ${VOICE_ASSET_ROOT} are not admitted by ${VOICE_HOST_MANIFEST} (Voice bundle lacks the ASR slot; Gradle :app:verifyVoiceHost rejects the build).`), problems[0]);
  assert.match(problems[0], /npm run android:build:local does not produce them: stage them with node scripts\/android-stage-voice-models\.mjs --from <directory of the recorded voice outputs and models> \(see docs\/fused-speech\.md\)\./);
  // Staged outputs that the record does not admit are refused by the real verifier, never repaired, in either lane.
  f.write(`${VOICE_ASSET_ROOT}/build-record.json`, '{}');
  assert.match(checkoutProblems(f.root, {allowUnpackagedRuntime: true})[0], /are not admitted by android\/voice-host\/qualified-voice-host\.json/);
  fs.rmSync(path.join(f.root, '.eliza'), {recursive: true});
  assert.deepEqual(checkoutProblems(f.root, {allowUnpackagedRuntime: true}), []);

  // A clean checkout: no prepared source. This is what used to fail deep in Gradle.
  problems = preparedRuntimeProblems(f.root, f.source);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /:app:stageLocalAgentSources/);
  assert.match(problems[0], /Run: npm run android:build:local/);
  assert.match(problems[0], /npm run agent:prepare before npm run android:build -- --allow-unpackaged-runtime/);

  f.write(path.relative(f.root, path.join(f.source, '.alpha-runtime-source.json')), '{"stamp":1}\n');
  // The embedding host has its own test below; here it is staged.
  const embeddingHost = () => ({});
  assert.deepEqual(preparedRuntimeProblems(f.root, f.source, {allowUnpackagedRuntime: true}), []);
  assert.deepEqual(preparedRuntimeProblems(f.root, f.source, {testMocks: true, embeddingHost}), []);
  assert.match(preparedRuntimeProblems(f.root, f.source, {embeddingHost})[0], /not staged.*npm run agent:build-workflow-worker && npm run agent:stage-android/);

  f.write('android/app/src/main/assets/agent/workflow-worker/manifest.json', '{}');
  f.write('android/app/src/main/assets/agent/alpha-source.json', '{"stamp":0}\n');
  assert.match(preparedRuntimeProblems(f.root, f.source, {embeddingHost})[0], /different prepared source/);
  f.write('android/app/src/main/assets/agent/alpha-source.json', '{"stamp":1}\n');
  assert.deepEqual(preparedRuntimeProblems(f.root, f.source, {embeddingHost}), []);
});

test('preflight rejects an unpinned checkout and android:build stops before sync and Gradle', t => {
  const f = fixture(t);
  f.write('upstream.lock.json', JSON.stringify({commit: 'f'.repeat(40)}));
  assert.match(checkoutProblems(f.root)[0], /vendor\/eliza is at .*pins f{40}\. Run: git submodule update --init vendor\/eliza/);
  // The real entry point exits with status 2 and the guidance, without starting the build.
  for (const file of ['android-abis.mjs', 'embedding-native-contract.mjs', 'paradee-runtime.mjs', 'voice-host.mjs', 'build-android.mjs', 'android-build-preflight.mjs', 'stage-embedding-host.mjs', 'build-embedding-host.mjs', 'toolchain.mjs', 'copy-file-clone.mjs'])
    f.write('scripts/' + file, read('scripts/' + file));
  // build-android.mjs reads the release-signing environment names from the host descriptor.
  f.write('android/consumer-host.json', read('android/consumer-host.json'));
  const result = spawnSync(process.execPath, ['scripts/build-android.mjs'], {cwd: f.root, encoding: 'utf8'});
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Android build prerequisites are missing/);
  assert.match(result.stderr, /git submodule update --init vendor\/eliza/);
  assert.equal(fs.existsSync(path.join(f.root, 'artifacts')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'web-dist')), false);
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

test('android:build:local builds the workflow worker before staging and stages before the strict build', () => {
  // The chain once stopped in agent:stage-android because nothing had built the worker artifact
  // that staging verifies first. Each step consumes the previous step's output, so order matters.
  const scripts = JSON.parse(read('package.json')).scripts;
  const chain = scripts['android:build:local'].split('&&').map(step => step.trim());
  assert.deepEqual(chain, [
    'node scripts/android-build-preflight.mjs --before-prepare',
    // Before the long preparation: it either has the reviewed libraries, reproduces them, or
    // stops in under a second naming the person who must supply them.
    'npm run agent:build-embedding-host',
    'npm run agent:prepare',
    'npm run agent:build-workflow-worker',
    'npm run agent:stage-android',
    // The shipped notices must list the staged runtime, or verify-apks records the releases
    // distributable:false ("notices lack the packaged runtime"). It rewrites the tracked
    // notices in the working tree for this build; that change is not committed.
    'npm run licenses:packaged-runtime',
    'npm run android:build',
  ]);
  assert.equal(scripts['licenses:packaged-runtime'], 'node scripts/generate-licenses.mjs --packaged-runtime');
  for (const step of chain.slice(1)) assert.ok(scripts[step.replace('npm run ', '')], step);
  // The chain ends in the strict build: no developer override may be baked into it.
  assert.doesNotMatch(scripts['android:build:local'], /--allow-unpackaged-runtime|--allow-unqualified-runtime|--test-mocks|--skip-instrumentation/);
  assert.equal(scripts['android:build'], 'node scripts/build-android.mjs');
  assert.equal(scripts['agent:build-embedding-host'], 'node scripts/build-embedding-host.mjs', 'no --candidate or other option in the chain');
  // Staging itself refuses a missing or foreign worker artifact before the long mobile bundle build.
  const stage = read('scripts/stage-local-agent-runtime.mjs');
  assert.ok(stage.indexOf('verifyWorkerArtifact(workerArtifactDirectory(root)') > 0);
  assert.ok(stage.indexOf('verifyWorkerArtifact(workerArtifactDirectory(root)') < stage.indexOf("'build:mobile'"));
});

test('preflight names the embedding host and who must supply it when the build step cannot', t => {
  // Gradle's :app:verifyEmbeddingHost failed a fully prepared and staged checkout 18 seconds into
  // the first assemble task: the reviewed libraries are ignored by Git and staged from a receipt.
  const f = fixture(t);
  f.write(path.relative(f.root, path.join(f.source, '.alpha-runtime-source.json')), '{"stamp":1}\n');
  f.write('android/app/src/main/assets/agent/workflow-worker/manifest.json', '{}');
  f.write('android/app/src/main/assets/agent/alpha-source.json', '{"stamp":1}\n');
  const missing = () => { throw new Error('Qualified embedding host library missing or changed: libelizainference.so'); };
  let problems = preparedRuntimeProblems(f.root, f.source, {embeddingHost: missing});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /qualified embedding host is not staged \(Qualified embedding host library missing or changed: libelizainference\.so; Gradle :app:verifyEmbeddingHost/);
  assert.match(problems[0], /npm run agent:build-embedding-host \(a step of npm run android:build:local\) stages the libraries only when it can reproduce the reviewed bytes/);
  assert.match(problems[0], /Needs a person: .*node scripts\/stage-embedding-host\.mjs --receipt/);
  // Test-mocks builds run the same strict Gradle check.
  assert.equal(preparedRuntimeProblems(f.root, f.source, {testMocks: true, embeddingHost: missing}).length, 1);

  // The real verifier: a staged resident payload is never admitted as "unpackaged", so the
  // developer override does not help until the payload is removed or the host is staged.
  f.write('android/embedding-host/qualified-host.json', JSON.stringify({qualificationReceiptSha256: 'not reviewed'}));
  problems = preparedRuntimeProblems(f.root, f.source, {allowUnpackagedRuntime: true});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /must have no resident payload at all/);
  fs.rmSync(path.join(f.root, 'android/app/src/main/assets/agent'), {recursive: true});
  assert.deepEqual(preparedRuntimeProblems(f.root, f.source, {allowUnpackagedRuntime: true}), []);
  assert.deepEqual(embeddingHostProblems(f.root, {allowUnpackagedRuntime: true}), []);
  assert.equal(embeddingHostProblems(f.root).length, 1);
});
