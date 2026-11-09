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
const noAttempt = {projection: false, version: false, compile: false, moduleWritten: false, metadata: false, tempClean: true,
  previousHost: 0, previousReceipt: {bundle: 0, source: 0, connector: false}};
const productFiles = [
  'scripts/build-native-google-host.ts', 'scripts/local-agent-source.mjs', 'scripts/native-google-host-artifact.mjs',
  'scripts/prepare-client-features.mjs', 'scripts/client-speech-patch.mjs', 'package.json', 'tsconfig.json',
  'vendor/eliza/tsconfig.json',
];
const optionalFiles = ['patches/eliza/cloud-speech-client-manifest.json', 'patches/eliza/cloud-speech-client.patch',
    'patches/eliza/managed-google-agent-manifest.json', 'patches/eliza/managed-google-agent.patch'];
const workerFiles = ['node_modules/smthrs/package.json', 'node_modules/zod/package.json',
  'node_modules/effect/package.json', 'node_modules/@smthrs/engine/package.json', 'dependencies.json', 'lib/worker.js'];

function setup(number, simpleCore = false) {
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
  writeCoreStateFixture(root, sdk, '0'.repeat(40), simpleCore);
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
  const transient = ['linked-input.ts', 'unavailable-input.ts'].map(name => path.join(root, name));
  const fixedInput = path.join(root, 'scripts/client-speech-patch.mjs');
  const fixedInputBytes = fs.readFileSync(fixedInput);
  const readPair = () => ({
    host: fs.existsSync(modulePath) ? {bytes: fs.readFileSync(modulePath), mode: fs.statSync(modulePath).mode} : null,
    manifest: {bytes: fs.readFileSync(manifestPath), mode: fs.statSync(manifestPath).mode},
  });
  write(bun, `#!${process.execPath}\nimport ${JSON.stringify(port)};\n`);
  fs.chmodSync(bun, 0o700);
  const generic = {version: 1, sourceStampSha256: 'a'.repeat(64), lockSha256: 'b'.repeat(64), files: {}};
  for (const name of workerFiles) {
    const bytes = Buffer.from(name.endsWith('.js') ? 'export const worker = true;' : '{}');
    write(path.join(directory, name), bytes);
    generic.files[name] = workerHash(bytes);
  }
  json(manifestPath, generic);
  fs.chmodSync(manifestPath, 0o640);
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
    if (host) assert.deepEqual(Object.keys(host).sort(), ['bunVersion','coreState','inputs','module','version']);
    const manifestBundle = classify(moduleHashes, manifest.files['google-host.mjs'] ?? null);
    const boundSource = classify(sourceHashes, host?.inputs[productInput] ?? null);
    const exactCore = host?.coreState.transforms.some(row => row.path === PLUGIN_CONNECTOR_TARGET) ?? false;
    for (const row of host?.coreState.transforms ?? []) {
      const name = path.relative(root, path.join(sdk, row.path));
      assert.equal(host.inputs[name], row.sourceSha256, 'Public receipt binds the raw transform preimage');
      assert.notEqual(row.sourceSha256, row.outputSha256);
    }
    const module = fs.existsSync(modulePath) ? classify(moduleHashes, digest(fs.readFileSync(modulePath))) : 0;
    for (const [name, hash] of Object.entries(generic.files)) {
      assert.equal(manifest.files[name], hash, 'Original worker inventory row preserved');
      assert.equal(workerHash(fs.readFileSync(path.join(directory, name))), hash);
    }
    let workerReady;
    try {verifyWorkerArtifact(directory, generic); workerReady = true;}
    catch (error) {assert.match(error.message, /Unexpected worker file|Worker file hash mismatch|Invalid or missing worker file/); workerReady = false;}
    return {
      's.source': classify(sourceHashes, digest(fs.readFileSync(source))),
      's.sdkCurrent': fs.readFileSync(sdkConfig, 'utf8') === sdkConfigBytes,
      's.host': module, 's.receipt': {bundle: manifestBundle, source: boundSource, connector: exactCore},
      's.attempt': attempt, 's.outcome': outcome, workerReady,
      ReceiptBindsCompiledSource: manifestBundle === 0 || manifestBundle === boundSource,
      FailedBuildPreservesPriorPair: outcome.operation !== 'build' || ['accepted', 'worker'].includes(outcome.result)
        || (module === attempt.previousHost && manifestBundle === attempt.previousReceipt.bundle
          && boundSource === attempt.previousReceipt.source && exactCore === attempt.previousReceipt.connector),
    };
  }
  function result(error) {
    const detail = error.stderr?.toString() ?? error.message;
    const rules = [
      [/Fixture projection refused/, 'projection'], [/requires pinned Bun/, 'bun'],
      [/Unexpected runtime source change/, 'sdk'],
      [/Native host compilation failed/, 'compiler'], [/did not produce its module and source graph/, 'output'],
      [/SDK dependency escaped/, 'resolver'], [/source graph escaped|source graph lacks exact input bytes|compiler input graph is incomplete/, 'graph'],
      [/selected core transformation/, 'transform'], [/EISDIR.*meta\.json/, 'metadata'],
      [/ENOENT.*unavailable-input/, 'input'],
      [/Fixture manifest publication refused/, 'manifest'], [/Fixture module publication refused/, 'module'],
      [/fixed build input changed/, 'fixed'], [/candidate bytes differ from compiler output/, 'candidate'], [/worker artifact changed during build/, 'worker'], [/artifact is missing/, 'missing'],
      [/host source changed/, 'source'], [/host bytes changed|ENOENT.*google-host\.mjs/, 'bytes'],
    ];
    const match = rules.find(([rule]) => rule.test(detail));
    if (!match) throw error;
    return match[1];
  }
  return {
    observe, root, sdk, write,
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
      for (const file of transient) {
        fs.rmSync(file, {force: true});
        write(file, 'export const temporaryFixture = true;');
      }
      const before = observe(), pair = readPair(), originalRename = fs.renameSync;
      let finalRenameRefused = false;
      if (['manifest-refused', 'module-refused'].includes(mode)) fs.renameSync = (from, to) => {
        if (mode === 'manifest-refused' && to === manifestPath) {
          const current = readPair();
          assert.deepEqual(current.manifest, pair.manifest);
          assert.notDeepEqual(current.host, pair.host, 'The candidate reached the live module before the refusal');
          finalRenameRefused = true;
          throw Error('Fixture manifest publication refused');
        }
        if (mode === 'module-refused' && to === modulePath) throw Error('Fixture module publication refused');
        return originalRename(from, to);
      };
      let actual;
      try {addNativeGoogleHostArtifact(root, directory); actual = 'accepted';}
      catch (error) {actual = result(error);}
      finally {
        fs.renameSync = originalRename;
        if (mode === 'fixed-drift') write(fixedInput, fixedInputBytes);
      }
      assert.equal(actual, expected, mode+' build result');
      if (mode === 'manifest-refused') assert.ok(finalRenameRefused);
      if (!['accepted', 'worker'].includes(actual)) assert.deepEqual(readPair(), pair, 'Previous exact worker pair retained');
      if (actual === 'worker') {
        const current = readPair();
        assert.deepEqual(current.manifest, pair.manifest);
        assert.equal(digest(current.host.bytes), moduleHashes[2]);
      }
      const rows = fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).map(row => JSON.parse(row));
      assert.deepEqual(rows, ['projection', 'version', 'compile', 'module', 'metadata'].filter(stage => rows.includes(stage)));
      attempt = {
        projection: rows.includes('projection'), version: rows.includes('version'), compile: rows.includes('compile'),
        moduleWritten: rows.includes('module'), metadata: rows.includes('metadata'),
        tempClean: !fs.readdirSync(path.dirname(directory)).some(name => name.startsWith('.native-google-host-build-')),
        previousHost: before['s.host'], previousReceipt: before['s.receipt'],
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

function bunCompatibility(bun) {
  const {root, sdk, write} = setup('bun', true);
  const inputFiles = {
    'backend/typed.ts': 'export const value: number = 1;',
    'backend/module.mts': 'export const value: number = 2;',
    'backend/common.cts': 'export const value: number = 3;',
    'backend/ordinary.js': 'export const value = 4;',
    'backend/module.mjs': 'export const value = 5;',
    'backend/common.cjs': 'module.exports = {value: 6};',
    'backend/data.json': '{"value":7}',
    'backend/component.tsx': 'export const value = <span />.value;',
    'backend/component.jsx': 'export const value = <span />.value;',
    'backend/text.txt': 'synthetic fixture text',
  };
  // Use inert automatic-JSX substitutes from a closed package in this scratch tree.
  const jsxRoot = path.join(root, 'node_modules', 'fixture-jsx');
  const jsxPackage = path.join(jsxRoot, 'package.json'), jsxRuntime = path.join(jsxRoot, 'runtime.js');
  write(jsxPackage, '{"name":"fixture-jsx","exports":{"./jsx-runtime":"./runtime.js","./jsx-dev-runtime":"./runtime.js"}}');
  write(jsxRuntime, 'export const jsx = () => ({value: 8}); export const jsxDEV = jsx;');
  for (const name of ['backend/component.tsx', 'backend/component.jsx'])
    inputFiles[name] = '/** @jsxImportSource fixture-jsx */\n' + inputFiles[name];
  for (const [name, bytes] of Object.entries(inputFiles)) write(path.join(root, name), bytes);
  const coreName = path.relative(root, path.join(sdk, PLUGIN_CONNECTOR_TARGET));
  const entry = [
    ...Object.keys(inputFiles).map((name, index) =>
      name.endsWith('.txt') ? `import v${index} from "./${path.basename(name)}" with { type: "text" };`
        : name.endsWith('.json') ? `import {default as v${index}} from "./${path.basename(name)}";`
          : `import {value as v${index}} from "./${path.basename(name)}";`),
    `import {value as effective} from "../${coreName}";`,
    'export const observed = [v0,v1,v2,v3,v4,v5,v6.value,v7,v8,v9,effective];',
  ].join('\n');
  write(path.join(root, productInput), entry);
  process.env.ALPHA_BUN = bun;
  projection = ({root: expected}) => assert.equal(expected, root);
  const directory = path.join(root, 'artifacts/worker');
  const host = addNativeGoogleHostArtifact(root, directory);
  assert.deepEqual(verifyNativeGoogleHostArtifact(root, directory), host);
  verifyWorkerArtifact(directory);
  for (const name of [...Object.keys(inputFiles), productInput, coreName, path.relative(root, jsxRuntime)])
    assert.equal(host.inputs[name], digest(fs.readFileSync(path.join(root, name))), name);
  const connector = host.coreState.transforms.find(row => row.path === PLUGIN_CONNECTOR_TARGET);
  assert.deepEqual(connector, {path: PLUGIN_CONNECTOR_TARGET,
    sourceSha256: digest('export const value = "before";\n'),
    outputSha256: digest('export const value = "after";\n')});
  const observed = JSON.parse(execFileSync(bun, ['-e', 'import {observed} from "./artifacts/worker/google-host.mjs"; console.log(JSON.stringify(observed))'],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  assert.deepEqual(observed, [1, 2, 3, 4, 5, 6, 7, 8, 8, 'synthetic fixture text', 'after']);
  assert.ok(!fs.readdirSync(path.join(root, 'artifacts')).some(name => name.startsWith('.native-google-host-build-')));
  return {bun: execFileSync(bun, ['--version'], {encoding: 'utf8'}).trim(), inputs: Object.keys(inputFiles),
    graphInputsChecked: Object.keys(inputFiles).length+3, rawCoreInput: connector.sourceSha256,
    effectiveCoreInput: connector.outputSha256};
}

if (process.argv[3]) {
  process.stdout.write(JSON.stringify(bunCompatibility(path.resolve(process.argv[3]))));
  process.exit(0);
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
scenario('coherent drift while compiling refuses mismatched source publication', point => {
  point('seed a prior verified artifact', 'build', 'ok', false, 'accepted');
  point('compiler reads old source, then product input changes before metadata', 'build', 'input-drift', false, 'source');
  point('readback refuses the old pair while its source is stale', 'verify', 'source');
  point('restore the old source to verify the previous exact pair', 'setSource', 1);
  point('previous module and receipt are still usable', 'verify', 'accepted');
  point('source advances again', 'setSource', 2);
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
for (const [mode, error, core] of [['escape-graph','graph',false], ['unbound-graph','graph',false],
  ['incomplete-graph','graph',false], ['missing-transform','transform',true], ['metadata-refused','metadata',false],
  ['missing-input','input',false], ['linked-input','source',false], ['fixed-drift','fixed',false],
  ['manifest-refused','manifest',false], ['module-refused','module',false], ['output-drift','candidate',false], ['sdk-drift','sdk',false]]) {
  scenario(mode+' leaves the previous exact pair intact', point => {
    point('seed a prior verified artifact', 'build', 'ok', false, 'accepted');
    point('product source advances', 'setSource', 2);
    point('candidate build is refused', 'build', mode, core, error);
    if (mode === 'sdk-drift') point('restore exact prepared SDK', 'setSdk', true);
    point('restore original product source to test the old manifest', 'setSource', 1);
    point('the old pair still admits the old source', 'verify', 'accepted');
    point('new build publishes output and receipt coherently', 'build', 'ok', core, 'accepted');
    point('readback succeeds', 'verify', 'accepted');
  });
}
scenario('first manifest publication failure removes only its candidate module', point => {
  point('no prior module exists before this failed handoff', 'build', 'manifest-refused', false, 'manifest');
  point('readback has no host record and worker remains ready', 'verify', 'missing');
  point('fresh candidate publishes normally', 'build', 'ok', false, 'accepted');
});
scenario('independent live host replacement is retained while the candidate is refused', point => {
  point('seed a prior verified artifact', 'build', 'ok', false, 'accepted');
  point('a peer replaces the live module during compilation', 'build', 'worker-drift', false, 'worker');
  point('readback sees the independent change against the old receipt', 'verify', 'bytes');
  point('restore the exact original module', 'setModule', 1);
  point('old receipt again matches', 'verify', 'accepted');
});
scenario('readback rejects independently replaced module bytes', point => {
  point('seed a prior verified artifact', 'build', 'ok', false, 'accepted');
  point('replace the module without changing the receipt', 'setModule', 2);
  point('native and worker verification see distinct written bytes', 'verify', 'bytes');
  point('restore the exact original module', 'setModule', 1);
  point('receipt again matches current bytes', 'verify', 'accepted');
  point('the module disappears independently', 'setModule', 0);
  point('native and worker verification see the missing module', 'verify', 'bytes');
});
process.stdout.write(JSON.stringify(traces));
