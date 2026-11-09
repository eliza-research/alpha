import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {writeCoreStateFixture} from '../../../../test/fixtures/core-state-root.mjs';
import {workerHash, verifyWorkerArtifact} from '../../../../scripts/workflow-worker-artifact.mjs';
import {CORE_STATE_MANIFEST, PLUGIN_CONNECTOR_TARGET} from '../../../../scripts/core-state-patch.mjs';
import {controlName, digest, eventsName, fixtureModule, fixtureSource, productInput}
  from '../../../../test/fixtures/native-google-host-builder-port.mjs';

const repository = path.resolve(import.meta.dirname, '../../../..');
const scratch = path.resolve(process.argv[2]);
assert.equal(process.cwd(), scratch);
assert.equal(process.env.TMPDIR, scratch);
const artifactSource = pathToFileURL(path.join(repository, 'scripts/native-google-host-artifact.mjs')).href;
let projection;
globalThis.nativeGoogleFixtureProjection = options => projection(options);
const hooks = registerHooks({resolve(specifier, context, next) {
  if (context.parentURL === artifactSource && specifier === './prepare-client-features.mjs') return {
    url: 'data:text/javascript,export const prepareClientFeatures = globalThis.nativeGoogleFixtureProjection;',
    shortCircuit: true,
  };
  return next(specifier, context);
}});
const {addNativeGoogleHostArtifact, verifyNativeGoogleHostArtifact} = await import(artifactSource);
hooks.deregister();

const port = pathToFileURL(path.join(repository, 'test/fixtures/native-google-host-builder-port.mjs')).href;
const action = (name, ...args) => ({name, args});
const idle = {operation: 'none', result: 'none'};
const noAttempt = {projection: false, version: false, compile: false, moduleWritten: false, metadata: false, tempClean: true};
const productFiles = [
  'scripts/build-native-google-host.ts', 'scripts/local-agent-source.mjs', 'scripts/native-google-host-artifact.mjs',
  'scripts/prepare-client-features.mjs', 'scripts/client-speech-patch.mjs', 'package.json', 'tsconfig.json',
  'vendor/eliza/tsconfig.json',
];
const optionalFiles = ['patches/eliza/cloud-speech-client-manifest.json', 'patches/eliza/cloud-speech-client.patch'];
const workerFiles = ['node_modules/smthrs/package.json', 'node_modules/zod/package.json',
  'node_modules/effect/package.json', 'node_modules/@smthrs/engine/package.json', 'dependencies.json', 'lib/worker.js'];

function setup(number) {
  const root = path.join(scratch, 'product-'+number), sdk = path.join(root, 'artifacts/sdk');
  const directory = path.join(root, 'artifacts/worker'), manifestPath = path.join(directory, 'manifest.json');
  const modulePath = path.join(directory, 'google-host.mjs'), sdkConfig = path.join(sdk, 'tsconfig.json');
  const source = path.join(root, productInput), bun = path.join(root, 'fixture-bun.mjs');
  const write = (file, bytes) => {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, bytes);
  };
  const json = (file, value) => write(file, JSON.stringify(value));
  const copy = name => write(path.join(root, name), fs.readFileSync(path.join(repository, name)));
  for (const name of productFiles) copy(name);
  for (const name of optionalFiles) if (fs.existsSync(path.join(repository, name))) copy(name);
  writeCoreStateFixture(root, sdk, '0'.repeat(40));
  const sdkConfigBytes = '{"compilerOptions":{}}';
  write(sdkConfig, sdkConfigBytes);
  write(path.join(sdk, 'fixture-dependency.ts'), 'export const fixture = true;\n');
  json(path.join(sdk, 'package.json'), {name: 'fixture', workspaces: []});
  json(path.join(sdk, 'turbo.json'), {tasks: {}});
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
    {cwd: sdk, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'synthetic SDK');
  const pin = git('rev-parse', 'HEAD');
  const coreManifest = path.join(root, CORE_STATE_MANIFEST);
  json(coreManifest, {...JSON.parse(fs.readFileSync(coreManifest)), baseCommit: pin});
  json(path.join(root, 'upstream.lock.json'), {commit: pin});
  json(path.join(sdk, '.alpha-runtime-source.json'), {base: pin, patches: []});
  write(source, fixtureSource(1));
  write(path.join(root, 'linked-target.ts'), 'export const synthetic = true;');
  fs.symlinkSync('linked-target.ts', path.join(root, 'linked-input.ts'));
  write(bun, `#!${process.execPath}\nimport ${JSON.stringify(port)};\n`);
  fs.chmodSync(bun, 0o700);
  const generic = {version: 1, sourceStampSha256: 'a'.repeat(64), lockSha256: 'b'.repeat(64), files: {}};
  for (const name of workerFiles) {
    const bytes = Buffer.from(name.endsWith('.js') ? 'export const worker = true;' : '{}');
    write(path.join(directory, name), bytes);
    generic.files[name] = workerHash(bytes);
  }
  json(manifestPath, generic);
  process.env.ALPHA_BUN = bun;
  process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR = sdk;
  const events = path.join(root, eventsName), controlFile = path.join(root, controlName);
  const moduleBytes = [null, fixtureModule(fixtureSource(1)), fixtureModule(fixtureSource(2))];
  const moduleHashes = moduleBytes.map(bytes => bytes === null ? null : digest(bytes));
  const sourceHashes = [null, digest(fixtureSource(1)), digest(fixtureSource(2))];
  const classify = (versions, value) => {
    const id = versions.indexOf(value);
    assert.notEqual(id, -1, 'Unexpected fixture version');
    return id;
  };
  let outcome = idle, attempt = noAttempt;
  function observe() {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const host = manifest.nativeGoogleHost;
    const manifestBundle = classify(moduleHashes, manifest.files['google-host.mjs'] ?? null);
    const boundSource = classify(sourceHashes, host?.inputs[productInput] ?? null);
    const exactCore = host?.coreState.transforms.some(row => row.path === PLUGIN_CONNECTOR_TARGET) ?? false;
    const module = fs.existsSync(modulePath) ? classify(moduleHashes, digest(fs.readFileSync(modulePath))) : 0;
    for (const [name, hash] of Object.entries(generic.files)) {
      assert.equal(manifest.files[name], hash, 'Original worker inventory row preserved');
      assert.equal(workerHash(fs.readFileSync(path.join(directory, name))), hash);
    }
    let workerReady;
    try {verifyWorkerArtifact(directory, generic); workerReady = true;}
    catch (error) {assert.match(error.message, /Unexpected worker file|Worker file hash mismatch/); workerReady = false;}
    return {
      's.source': classify(sourceHashes, digest(fs.readFileSync(source))),
      's.sdkCurrent': fs.readFileSync(sdkConfig, 'utf8') === sdkConfigBytes,
      's.host': module, 's.receipt': {bundle: manifestBundle, source: boundSource, connector: exactCore},
      's.attempt': attempt, 's.outcome': outcome, workerReady,
      ReceiptBindsCompiledSource: manifestBundle === 0 || manifestBundle === boundSource,
    };
  }
  function result(error) {
    const detail = error.stderr?.toString() ?? error.message;
    const rules = [
      [/Fixture projection refused/, 'projection'], [/requires pinned Bun/, 'bun'],
      [/Unexpected runtime source change/, 'sdk'],
      [/Native host compilation failed/, 'compiler'], [/did not produce its module and source graph/, 'output'],
      [/SDK dependency escaped/, 'resolver'], [/source graph escaped/, 'graph'],
      [/selected core transformation/, 'transform'], [/EISDIR.*meta\.json/, 'metadata'],
      [/ENOENT.*unavailable-input/, 'input'], [/build input is not regular/, 'input'],
      [/Fixture manifest write refused/, 'manifest'], [/artifact is missing/, 'missing'],
      [/host source changed/, 'source'], [/host bytes changed/, 'bytes'],
    ];
    const match = rules.find(([rule]) => rule.test(detail));
    if (!match) throw error;
    return match[1];
  }
  return {
    observe,
    setSource(version) {write(source, fixtureSource(version)); outcome = idle;},
    setSdk(current) {write(sdkConfig, current ? sdkConfigBytes : sdkConfigBytes+'\n'); outcome = idle;},
    setModule(version) {
      if (!version) fs.rmSync(modulePath, {force: true});
      else write(modulePath, moduleBytes[version]);
      outcome = idle;
    },
    build(mode, selectedCore, expected) {
      json(controlFile, {mode, selectedCore});
      write(events, '');
      projection = ({root: requestedRoot}) => {
        assert.equal(requestedRoot, root);
        if (mode === 'projection-refused') throw Error('Fixture projection refused');
        fs.appendFileSync(events, JSON.stringify('projection')+'\n');
      };
      const originalWrite = fs.writeFileSync;
      if (mode === 'manifest-refused') fs.writeFileSync = (file, ...args) => {
        if (file === manifestPath) throw Error('Fixture manifest write refused');
        return originalWrite(file, ...args);
      };
      let actual;
      try {addNativeGoogleHostArtifact(root, directory); actual = 'accepted';}
      catch (error) {actual = result(error);}
      finally {fs.writeFileSync = originalWrite;}
      assert.equal(actual, expected, mode+' build result');
      const rows = fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).map(row => JSON.parse(row));
      assert.deepEqual(rows, ['projection', 'version', 'compile', 'module', 'metadata'].filter(stage => rows.includes(stage)));
      attempt = {
        projection: rows.includes('projection'), version: rows.includes('version'), compile: rows.includes('compile'),
        moduleWritten: rows.includes('module'), metadata: rows.includes('metadata'),
        tempClean: !fs.readdirSync(scratch).some(name => name.startsWith('alpha-google-host-build-')),
      };
      outcome = {operation: 'build', result: actual};
    },
    verify(expected) {
      let actual;
      try {verifyNativeGoogleHostArtifact(root, directory); actual = 'accepted';}
      catch (error) {actual = result(error);}
      assert.equal(actual, expected, 'verify result');
      outcome = {operation: 'verify', result: actual};
    },
  };
}

const traces = [];
function scenario(name, run) {
  const fixture = setup(traces.length+1), trace = {name, expect: fixture.observe(), steps: []};
  function point(label, method, ...args) {
    fixture[method](...args);
    const modelArgs = ['verify','build'].includes(method) ? args.slice(0,-1) : args;
    trace.steps.push({label, action: action(method, ...modelArgs), expect: fixture.observe()});
  }
  run(point);
  traces.push(trace);
}
scenario('fresh artifact builds, reads back and preserves ordinary worker bytes', point => {
  point('initial worker carries no host receipt', 'verify', 'missing');
  point('exact producer writes a current host with a genuine zero-selected-core graph', 'build', 'ok', false, 'accepted');
  point('verified host receipt is rechecked against file and current source', 'verify', 'accepted');
  point('product input advances independently of the SDK', 'setSource', 2);
  point('old receipt refuses changed product input', 'verify', 'source');
  point('fresh build and declared connector transform bind the current bytes', 'build', 'ok', true, 'accepted');
  point('current host is admitted after rebuild', 'verify', 'accepted');
});
scenario('coherent drift while compiling yields an accepted mismatched source observation', point => {
  point('compiler reads old source, then product input changes before metadata', 'build', 'input-drift', false, 'accepted');
  point('readback admits current input hashes with old compiled bytes', 'verify', 'accepted');
  point('new build emits from the current coherent input', 'build', 'ok', false, 'accepted');
  point('current receipt and compiled source now agree', 'verify', 'accepted');
});
scenario('preflight refusal leaves the prior usable artifact', point => {
  point('seed a prior verified artifact', 'build', 'ok', false, 'accepted');
  for (const [mode, refusal] of [['projection-refused','projection'], ['wrong-bun','bun'],
    ['compiler-refused','compiler'], ['no-output','output'], ['escape-resolver','resolver']]) {
    point(mode+' fails before replacing output', 'build', mode, false, refusal);
    point('the previous artifact remains usable', 'verify', 'accepted');
  }
  point('prepared SDK becomes dirty before a new attempt', 'setSdk', false);
  point('precompile SDK guard refuses before compiler or output', 'build', 'ok', false, 'sdk');
  point('restore exact prepared SDK bytes', 'setSdk', true);
  point('prior host remains usable', 'verify', 'accepted');
});
for (const [mode, error, core] of [['escape-graph','graph',false], ['missing-transform','transform',true],
  ['metadata-refused','metadata',false], ['missing-input','input',false], ['linked-input','input',false],
  ['manifest-refused','manifest',false], ['sdk-drift','sdk',false]]) {
  scenario(mode+' can leave written output without a new receipt', point => {
    point('seed a prior verified artifact', 'build', 'ok', false, 'accepted');
    point('product source advances', 'setSource', 2);
    point('attempt fails after writing the module', 'build', mode, core, error);
    if (mode === 'sdk-drift') point('restore exact prepared SDK', 'setSdk', true);
    point('restore original product source to test the old manifest', 'setSource', 1);
    point('the old manifest now rejects the replaced module', 'verify', 'bytes');
    point('new build repairs output and receipt coherently', 'build', 'ok', core, 'accepted');
    point('readback is restored', 'verify', 'accepted');
  });
}
scenario('readback rejects independently replaced module bytes', point => {
  point('seed a prior verified artifact', 'build', 'ok', false, 'accepted');
  point('replace the module without changing the receipt', 'setModule', 2);
  point('native and worker verification see distinct written bytes', 'verify', 'bytes');
  point('restore the exact original module', 'setModule', 1);
  point('receipt again matches current bytes', 'verify', 'accepted');
});
process.stdout.write(JSON.stringify(traces));
